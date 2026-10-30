// 1つのHTMLファイルに、pdf.js・OpenCV.js・CMap・標準フォント・形態素解析(kuromoji.js と辞書 IPADIC)・英語の辞書(SCOWL)・本体のコードをすべて埋め込む
//   node build.js  →  dist/校正ツール.html(配る・手元で開くもの)と index.html(GitHub Pages で公開するもの。中身は同じ)
'use strict';
const fs = require('fs'), path = require('path');
const nm = p => path.join(__dirname, 'node_modules', p);
const b64 = p => fs.readFileSync(p).toString('base64');
const safe = s => s.replace(/<\/script/gi, '<\\/script');   // HTMLの中に埋め込んでも閉じタグと誤認されないように

const cmaps = {}, fonts = {};
for (const f of fs.readdirSync(nm('pdfjs-dist/cmaps'))) if (f.endsWith('.bcmap')) cmaps[f.replace('.bcmap', '')] = b64(nm('pdfjs-dist/cmaps/' + f));
for (const f of fs.readdirSync(nm('pdfjs-dist/standard_fonts'))) if (/\.(pfb|ttf)$/.test(f)) fonts[f] = b64(nm('pdfjs-dist/standard_fonts/' + f));
// pdf.js の文字の読み取りに、Noto Sans CJK JP（Source Han Sans）の「文字番号 → 文字」の表を足す
//   文字の対応表(ToUnicode)のないこのフォントは、どの読み取りでも文字が化ける(文字番号をそのまま文字として返し、
//   アラビア文字などの番号に当たると字の並びまで入れ替わる)。表は src/data/make_noto_cid2u.py でフォントから作る
const cid2u = JSON.parse(fs.readFileSync(path.join(__dirname, 'src/data/noto_cjk_cid2u.json'), 'utf8'));
const workerHook = `globalThis.__pcCidToUnicode = (() => {
  const R = ${JSON.stringify(cid2u.runs)};
  let M = null;
  const table = () => { if (!M) { M = new Map(); for (let i = 0; i < R.length; i += 3) for (let k = 0; k < R[i + 2]; k++) M.set(R[i] + k, R[i + 1] + k); } return M; };
  // 対象: CFF の CID フォント(文字番号の並びが Adobe-Identity)で、名前が Noto Sans CJK JP・Noto Sans JP・Source Han Sans のもの
  const FONT = /(?:^|\\+)(?:NotoSansCJK(?:jp|JP)|NotoSansJP|NotoSansMonoCJK(?:jp|JP)|SourceHanSans(?:JP)?)(?:-|$)/;
  return p => {
    if (!p.composite || !p.file || p.subtype !== 'CIDFontType0C' || !p.cidSystemInfo || p.cidSystemInfo.registry !== 'Adobe' || p.cidSystemInfo.ordering !== 'Identity' || !FONT.test(p.name || '')) return null;
    const m = table(), out = [];
    p.cMap.forEach((code, cid) => { const u = m.get(cid); if (u) out[code] = String.fromCodePoint(u); });
    return out;
  };
})();
`;
const workerSrc = (() => {
  const src = fs.readFileSync(nm('pdfjs-dist/build/pdf.worker.min.mjs'), 'utf8');
  const at = 'return new IdentityToUnicodeMap(e.firstChar,e.lastChar)}async readToUnicode(';
  if (src.split(at).length !== 2) throw new Error('pdf.worker の差し込み場所が見つかりません(pdf.js の版が変わった?)');
  return workerHook + src.replace(at, '{const __pcM=globalThis.__pcCidToUnicode&&globalThis.__pcCidToUnicode(e);if(__pcM)return new ToUnicodeMap(__pcM)}' + at);
})();
const order = ['util', 'myers', 'docsrc', 'pdfio', 'vision', 'marks', 'scan', 'content', 'ocr', 'jcheck', 'echeck', 'records', 'pairing', 'analyze', 'ui'];
// OCR(Tesseract.js 7.0.0・本体 tesseract.js-core 7.0.0・日本語の学習データ 4.0.0_best_int)。文字データのない所を読むのに使う
//   作業者(Worker)は、本体(SIMD・LSTMだけの版。WebAssembly を埋め込んだもの)を先に読み込んでおき、外から本体を読みに行かないようにする
//   Tesseract.js 7.0.0 は、学習データを直接渡すと言語の名前の代わりにデータをつなげてしまうため、名前(code)を使うよう1か所直す
const tessWorker = (() => {
  const w = fs.readFileSync(nm('tesseract.js/dist/worker.min.js'), 'utf8'), at = 't:t.data})).join("+"),c="initializing api"';
  if (w.split(at).length !== 2) throw new Error('Tesseract.js の作業者の差し込み場所が見つかりません(版が変わった?)');
  // 学習データを読むときに出る「Parameter not found」(古い設定項目の知らせ。動作には関係ない)は、コンソールに出さない
  const quiet = `(() => { const ok = m => !/^Warning: Parameter not found/.test(String(m)); for (const k of ['log', 'warn', 'error']) { const f = console[k].bind(console); console[k] = (...a) => { if (ok(a[0])) f(...a); }; } })();\n`;
  return quiet + fs.readFileSync(nm('tesseract.js-core/tesseract-core-simd-lstm.wasm.js'), 'utf8') + '\n' + w.replace(at, 't:t.code})).join("+"),c="initializing api"');
})();
// 英語の辞書: SCOWL 由来の Hunspell 辞書(en_US)を、nspell で活用形まで広げた語の一覧にする(使うときは一覧を引くだけ)
const enWords = Object.keys(require('nspell')({ aff: fs.readFileSync(nm('dictionary-en/index.aff')), dic: fs.readFileSync(nm('dictionary-en/index.dic')) }).data).sort();
const app = order.map(n => `// ---- ${n}.js ----\n` + fs.readFileSync(path.join(__dirname, 'src/js', n + '.js'), 'utf8')).join('\n');
const pkg = n => JSON.parse(fs.readFileSync(nm(n + '/package.json'), 'utf8')).version;

const assets = `
<script id="pdfjs-lib" type="text/plain">${b64(nm('pdfjs-dist/build/pdf.min.mjs'))}</script>
<script id="pdfjs-worker" type="text/plain">${Buffer.from(workerSrc, 'utf8').toString('base64')}</script>
<script>window.PC = { ASSETS: { cmaps: ${JSON.stringify(cmaps)}, fonts: ${JSON.stringify(fonts)} }, VERSIONS: { pdfjs: '${pkg('pdfjs-dist')}', opencv: '${pkg('@techstark/opencv-js')}', kuromoji: '${pkg('kuromoji')}' } };</script>
<script>${safe(fs.readFileSync(nm('@techstark/opencv-js/dist/opencv.js'), 'utf8'))}</script>
<script>${safe(app)}</script>
<script>
// 形態素解析(kuromoji.js)。辞書は下に埋め込んだもの(ipadic-*)を PC.DictXHR で渡す(外部・ローカルの別ファイルを読みに行かない)
(function (XMLHttpRequest) {
${safe(fs.readFileSync(nm('kuromoji/build/kuromoji.js'), 'utf8'))}
})(PC.DictXHR);
</script>
${fs.readdirSync(nm('kuromoji/dict')).filter(f => f.endsWith('.dat.gz')).map(f => `<script id="ipadic-${f}" type="text/plain">${b64(nm('kuromoji/dict/' + f))}</script>`).join('\n')}
<script id="en-words" type="text/plain">${enWords.join('\n')}</script>
<script>${safe(fs.readFileSync(nm('tesseract.js/dist/tesseract.min.js'), 'utf8'))}</script>
<script id="tess-worker" type="text/plain">${Buffer.from(tessWorker, 'utf8').toString('base64')}</script>
<script id="tess-jpn" type="text/plain">${b64(nm('@tesseract.js-data/jpn/4.0.0_best_int/jpn.traineddata.gz'))}</script>
<script id="tess-jpn_vert" type="text/plain">${b64(nm('@tesseract.js-data/jpn_vert/4.0.0_best_int/jpn_vert.traineddata.gz'))}</script>
<script id="third-party-notices" type="text/plain">
${['pdfjs-dist/LICENSE', '@techstark/opencv-js/LICENSE', 'kuromoji/LICENSE-2.0.txt', 'kuromoji/NOTICE.md', 'nspell/license', 'dictionary-en/license', 'tesseract.js/LICENSE.md', 'tesseract.js/LICENSE', 'tesseract.js-core/LICENSE'].filter(f => fs.existsSync(nm(f))).map(f => `==== ${f} ====\n` + safe(fs.readFileSync(nm(f), 'utf8'))).join('\n\n')}

==== @tesseract.js-data/jpn・jpn_vert 1.0.0(4.0.0_best_int) ====
Japanese traineddata for Tesseract (https://github.com/naptha/tessdata, package license: MIT).
The data is derived from the Tesseract OCR trained data (https://github.com/tesseract-ocr/tessdata_best, Apache License 2.0).

==== Noto Sans CJK JP (src/data/noto_cjk_LICENSE.txt) ====
${safe(fs.readFileSync(path.join(__dirname, 'src/data/noto_cjk_LICENSE.txt'), 'utf8'))}
</script>
<script type="module">
// pdf.jsは埋め込んだコードからBlob URLで読み込む(file://で開いても外部・ローカルの別ファイルを読みに行かない)
const blobUrl = id => URL.createObjectURL(new Blob([Uint8Array.from(atob(document.getElementById(id).textContent), c => c.charCodeAt(0))], { type: 'text/javascript' }));
window.pdfjsLib = await import(blobUrl('pdfjs-lib'));
pdfjsLib.GlobalWorkerOptions.workerSrc = blobUrl('pdfjs-worker');
const cvReady = () => new Promise(r => { if (window.cv && window.cv.Mat) return r(); if (window.cv instanceof Promise) return window.cv.then(m => { window.cv = m; r(); }); window.cv.onRuntimeInitialized = r; });
await cvReady();
PC.ready();
</script>`;
const html = fs.readFileSync(path.join(__dirname, 'src/index.html'), 'utf8').replace('<!--ASSETS-->', () => assets);
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
const out = path.join(__dirname, 'dist', '校正ツール.html');
fs.writeFileSync(out, html);
// GitHub Pages で公開するページ(リポジトリ直下の index.html。中身は同じ)
fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log(out, (html.length / 1e6).toFixed(1) + ' MB');
