// 1つのHTMLファイルに、pdf.js・OpenCV.js・CMap・標準フォント・形態素解析(kuromoji.js と辞書 IPADIC)・英語の辞書(SCOWL)・本体のコードをすべて埋め込む
//   node build.js  →  dist/朱書き照合ツール.html(配る・手元で開くもの)と index.html(GitHub Pages で公開するもの。中身は同じ)
'use strict';
const fs = require('fs'), path = require('path');
const nm = p => path.join(__dirname, 'node_modules', p);
const b64 = p => fs.readFileSync(p).toString('base64');
const safe = s => s.replace(/<\/script/gi, '<\\/script');   // HTMLの中に埋め込んでも閉じタグと誤認されないように

const cmaps = {}, fonts = {};
for (const f of fs.readdirSync(nm('pdfjs-dist/cmaps'))) if (f.endsWith('.bcmap')) cmaps[f.replace('.bcmap', '')] = b64(nm('pdfjs-dist/cmaps/' + f));
for (const f of fs.readdirSync(nm('pdfjs-dist/standard_fonts'))) if (/\.(pfb|ttf)$/.test(f)) fonts[f] = b64(nm('pdfjs-dist/standard_fonts/' + f));
const order = ['util', 'myers', 'docsrc', 'pdfio', 'vision', 'marks', 'scan', 'content', 'jcheck', 'echeck', 'records', 'pairing', 'analyze', 'ui'];
// 英語の辞書: SCOWL 由来の Hunspell 辞書(en_US)を、nspell で活用形まで広げた語の一覧にする(使うときは一覧を引くだけ)
const enWords = Object.keys(require('nspell')({ aff: fs.readFileSync(nm('dictionary-en/index.aff')), dic: fs.readFileSync(nm('dictionary-en/index.dic')) }).data).sort();
const app = order.map(n => `// ---- ${n}.js ----\n` + fs.readFileSync(path.join(__dirname, 'src/js', n + '.js'), 'utf8')).join('\n');
const pkg = n => JSON.parse(fs.readFileSync(nm(n + '/package.json'), 'utf8')).version;

const assets = `
<script id="pdfjs-lib" type="text/plain">${b64(nm('pdfjs-dist/build/pdf.min.mjs'))}</script>
<script id="pdfjs-worker" type="text/plain">${b64(nm('pdfjs-dist/build/pdf.worker.min.mjs'))}</script>
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
<script id="third-party-notices" type="text/plain">
${['pdfjs-dist/LICENSE', '@techstark/opencv-js/LICENSE', 'kuromoji/LICENSE-2.0.txt', 'kuromoji/NOTICE.md', 'nspell/license', 'dictionary-en/license'].filter(f => fs.existsSync(nm(f))).map(f => `==== ${f} ====\n` + safe(fs.readFileSync(nm(f), 'utf8'))).join('\n\n')}
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
const out = path.join(__dirname, 'dist', '朱書き照合ツール.html');
fs.writeFileSync(out, html);
// GitHub Pages で公開するページ(リポジトリ直下の index.html。中身は同じ)
fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log(out, (html.length / 1e6).toFixed(1) + ' MB');
