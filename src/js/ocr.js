// 文字データのない所(文字をアウトライン化した所・画像の中の文字)を OCR(Tesseract)で読み、照合に使う字を足す
//   部品(Tesseract.js・本体・日本語(横書き・縦書き)の学習データ)は HTML に埋め込んである。外部へは通信しない
//   OCR で読んだ字には ocr の印を付ける(読み違えやすい字は alt に別の候補を持たせ、照合では同じ字とみなす)
'use strict';
(function () {
  const bytes = id => { const el = document.getElementById(id); return el ? PC.b64bytes(el.textContent) : null; };
  // ---- Tesseract の作業者(横書き・縦書きで1つずつ。初めて使うときに作る) ----
  const workers = {};
  async function worker(vert) {
    const key = vert ? 'v' : 'h';
    if (!workers[key]) workers[key] = (async () => {
      if (!window.Tesseract) return null;
      const src = bytes('tess-worker'), lang = bytes(vert ? 'tess-jpn_vert' : 'tess-jpn');
      if (!src || !lang) return null;
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      const w = await Tesseract.createWorker([{ code: vert ? 'jpn_vert' : 'jpn', data: lang }], 1, { workerPath: url, workerBlobURL: false, corePath: 'embedded.js', cacheMethod: 'none', logger: () => {}, errorHandler: () => {} });
      // 横書きはひとまとまりの文(6)、縦書きは縦のひとまとまり(5)として読む。字の間に空白を入れない
      await w.setParameters({ tessedit_pageseg_mode: vert ? '5' : '6', preserve_interword_spaces: '1' });
      return w;
    })().catch(() => null);
    return workers[key];
  }
  PC.ocrAvailable = () => !!(window.Tesseract && document.getElementById('tess-worker'));
  PC.ocrDebug = { worker, readRegion };
  PC.ocrRelease = async () => { for (const k of Object.keys(workers)) { const w = await workers[k]; if (w) await w.terminate(); delete workers[k]; } };

  // 読み違えやすい字の組(OCR の字は、組のほかの字とも同じとみなす)
  //   濁点・半濁点(゛゜)は小さく、OCR では読み違えやすい(「ぽ」を「ほ」「ぼ」と読む)ため、清音・濁音・半濁音も同じ組にする
  const CONFUSE = [',.、。・･', 'ー一-－―‐ｰ', '0OoＯｏ〇ロ口', '1lI|ｌＩ｜', 'カ力', 'エ工', 'ニ二', 'ハ八', 'タ夕', 'ト卜', 'りリ', 'ロ口', '〜~～',
    'はばぱ', 'ひびぴ', 'ふぶぷ', 'へべぺヘベペ', 'ほぼぽ', 'ハバパ', 'ヒビピ', 'フブプ', 'ホボポ', 'かが', 'きぎ', 'くぐ', 'けげ', 'こご', 'さざ', 'しじ', 'すず', 'せぜ', 'そぞ', 'ただ', 'ちぢ', 'つづ', 'てで', 'とど',
    'カガ', 'キギ', 'クグ', 'ケゲ', 'コゴ', 'サザ', 'シジ', 'スズ', 'セゼ', 'ソゾ', 'タダ', 'チヂ', 'ツヅ', 'テデ', 'トド', 'ウヴ'];
  const altOf = c => { const k = PC.fold(c), gs = CONFUSE.filter(s => s.includes(c) || s.includes(k)); return gs.length ? new Set(gs.flatMap(g => [...g].map(PC.fold)).filter(x => x !== k)) : null; };

  // ---- 文字データのない、文字らしい所を探す ----
  //   img: ページの描画(倍率 k = 画素/pt)、B: ページの文字データ。返り値: [{ box(pt), vert, size(字の大きさ pt) }]
  //   罫線を除いたインクのうち、文字データの字の枠(少し広げたもの)にかからない所を、字の間・行の間ほど膨らませて段落ごとにまとめ、
  //   字らしい大きさ・形のまとまりだけを残す(写真や塗りの大きな面は除く)。大きなページは半分に縮めて調べる(速さのため)
  PC.noTextRegions = (img, B, k) => {
    const ink0 = PC.textInk(img), W0 = img.w, H0 = img.h, f = W0 * H0 > 4e6 ? 2 : 1, w = Math.ceil(W0 / f), h = Math.ceil(H0 / f), K = k / f;
    const cov = new Uint8Array(w * h);
    for (const c of B.chars) {
      const x0 = Math.max(0, Math.floor(c.box[0] * K) - 2), y0 = Math.max(0, Math.floor(c.box[1] * K) - 2), x1 = Math.min(w, Math.ceil(c.box[2] * K) + 2), y1 = Math.min(h, Math.ceil(c.box[3] * K) + 2);
      for (let y = y0; y < y1; y++) cov.fill(1, y * w + x0, y * w + x1);
    }
    const ink = new Uint8Array(w * h); let n = 0;
    for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) if (ink0[y * W0 + x]) { const j = ((y / f) | 0) * w + ((x / f) | 0); if (!cov[j] && !ink[j]) { ink[j] = 1; n++; } }
    if (n < 40 / f) return [];
    const cc0 = PC.cc(ink, w, h), big = new Set();
    for (let i = 1; i < cc0.n; i++) { const t = cc0.st[i]; if (t.x1 - t.x0 > 0.25 * w || t.y1 - t.y0 > 0.25 * h) big.add(i); }   // 字にしては大きすぎる線・面
    if (big.size) for (let i = 0; i < ink.length; i++) if (ink[i] && big.has(cc0.lab[i])) ink[i] = 0;
    //   字の間・行の間(4mm ほど)を埋めて、段落ごとのまとまりにする(1字ずつに分けると、離れた1字を読み落とすため)
    const R = Math.max(5, Math.round(31 * K / (PC.DPI / 72))) | 1, cc = PC.cc(PC.morph(ink, w, h, 'dilate', R, R), w, h), out = [];
    for (let i = 1; i < cc.n; i++) {
      const t = cc.st[i], bw = t.x1 - t.x0 + 1, bh = t.y1 - t.y0 + 1;
      if (Math.min(bw, bh) < 14 / f || bw * bh > 0.3 * w * h) continue;
      let px = 0; const rows = new Uint32Array(bh), cols = new Uint32Array(bw);
      for (let y = t.y0; y <= t.y1; y++) for (let x = t.x0; x <= t.x1; x++) { const j = y * w + x; if (ink[j] && cc.lab[j] === i) { px++; rows[y - t.y0]++; cols[x - t.x0]++; } }
      if (px < 30 / (f * f) || px > 0.6 * bw * bh) continue;   // 点や塗りつぶした面は除く
      // 横書きか縦書きか: 何も書かれていない列(縦書きの行の間)が、何も書かれていない行(横書きの行の間)より多いか、細長い列
      const zr = rows.filter(v => !v).length / bh, zc = cols.filter(v => !v).length / bw, vert = (bh > 2 * bw && bw < 0.08 * w) || (bh > bw && zc > zr + 0.1);
      // 字の大きさ(pt): 行(縦書きは列)の太さの中央値。字の大きさに合わせて OCR の解像度を決める
      const prof = vert ? cols : rows, runs = []; let r = 0; for (const v of prof) { if (v) r++; else if (r) { runs.push(r); r = 0; } } if (r) runs.push(r);
      runs.sort((a, b) => a - b);
      out.push({ box: [t.x0 / K, t.y0 / K, (t.x1 + 1) / K, (t.y1 + 1) / K], vert, size: (runs.length ? runs[runs.length >> 1] : Math.min(bw, bh)) / K, ink: px * f * f });
    }
    return out;
  };

  // ---- 範囲を OCR で読み、文字データの形の字にする ----
  //   範囲だけを描いて読む。返り値: [{ s, box, vert, chars: [{ c, box(pt), conf }] }](行ごと)
  //   解像度: 字の高さが 40画素ほどになるように(試した範囲では、字が大きすぎても小さすぎても読み違いが増えた)。150〜400dpi
  PC.OCR_DPI = 0;   // 0 のときは字の大きさから決める(試すときに決まった値にできる)
  async function readRegion(doc, q, R) {
    const dpi = PC.OCR_DPI || Math.max(150, Math.min(400, Math.round(40 / Math.max(1, R.size || 16) * 72 / 10) * 10));
    const m = 2, box = [R.box[0] - m, R.box[1] - m, R.box[2] + m, R.box[3] + m], k = dpi / 72;
    const c = await PC.renderRegion(doc, q, box, dpi);
    if (c.width < 8 || c.height < 8) return [];
    const w = await worker(R.vert); if (!w) return [];
    const r = await w.recognize(c, {}, { blocks: true, text: false });
    const lines = [];
    for (const bl of r.data.blocks || []) for (const p of bl.paragraphs) for (const l of p.lines) {
      const cs = [];
      for (const wd of l.words) for (const s of wd.symbols) {
        const t = (s.text || '').trim(); if (!t || s.confidence < 40) continue;   // とても自信のない字は使わない
        const b = s.bbox;
        cs.push({ c: t, box: [box[0] + b.x0 / k, box[1] + b.y0 / k, box[0] + b.x1 / k, box[1] + b.y1 / k], conf: s.confidence });
      }
      if (cs.length) lines.push({ s: cs.map(x => x.c).join(''), box: PC.union(cs.map(x => x.box)), vert: R.vert, chars: cs });
    }
    return lines;
  }

  // ---- 見当たらない字の続きの近くを OCR で読み、ページの文字データ B に字を足す(足した字の数を返す) ----
  //   targets: [{ box(pt、成果物での見込みの位置。分からなければ null), text(見当たらない字) }]
  //   読むのは次のときだけ(アウトライン化・画像化した文字を確かめるため。ふつうの直しや図・アイコンを読まないように)
  //     ・見当たらない字が2字以上 ・その辺りに文字データの字がほとんどない(位置の分かるとき) ・その辺りに文字データのない文字らしい所がある
  //   読んだ行は、見当たらない字とよく似たもの(同じ字の並びが2字以上で、行の字の半分以上)だけを足す(意味のない読み取りを捨てる)
  //   位置の分からない字(データファイルの原稿)は、ページの候補のうちインクの多いものから max か所まで読む
  //   候補(文字データのない文字らしい所)はページごとに1回だけ探し、読んだ結果も覚えておく(2度は読まない)
  const same = (a, b) => a === b || (() => { const s = altOf(a); return !!s && s.has(PC.fold(b)); })();
  const lcs = (a, b) => { const A = [...a].map(PC.fold), B = [...b].map(PC.fold); let prev = new Uint16Array(B.length + 1); for (const x of A) { const cur = new Uint16Array(B.length + 1); for (let j = 1; j <= B.length; j++) cur[j] = same(x, B[j - 1]) ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]); prev = cur; } return prev[B.length]; };
  PC.ocrAugment = async (doc, q, B, img, targets, step = () => {}, max = 30) => {
    if (!PC.ocrAvailable() || !targets || !targets.length) return 0;
    const grow = (a, r) => { const m = r * Math.max(a[2] - a[0], a[3] - a[1], 12); return [a[0] - m, a[1] - m, a[2] + m, a[3] + m]; };
    const meet = (b, a) => b[0] < a[2] && b[2] > a[0] && b[1] < a[3] && b[3] > a[1];
    const live = a => B.chars.reduce((n, c) => { const x = (c.box[0] + c.box[2]) / 2, y = (c.box[1] + c.box[3]) / 2; return n + (!c.ocr && x >= a[0] && x <= a[2] && y >= a[1] && y <= a[3] ? 1 : 0); }, 0);
    //   先に、読む見込みのある見当たらない字だけを残す(候補を探すのはページを描いて調べるので重い。残ったときだけ探す)
    const todo = targets.filter(t => {
      const n = [...t.text].filter(c => /[\p{L}\p{N}]/u.test(c)).length; if (n < 2) return false;
      return !t.box || live(t.box) <= 0.2 * n;   // その辺りに文字データの字がある: ふつうの直し
    });
    if (!todo.length) return 0;
    if (!B.ocrCand) { img = img || await PC.renderPage(doc, q, PC.DPI, false); B.ocrCand = PC.noTextRegions(img, B, img.w / B.w); B.ocrRead = new Map(); B.ocrAdded = new Set(); }
    if (!B.ocrCand.length) return 0;
    const wants = new Map();   // 候補 → 見当たらない字の一覧
    const add = (R, t) => { if (!wants.has(R)) wants.set(R, []); wants.get(R).push(t); };
    for (const t of todo) {
      if (!t.box) { B.ocrCand.slice().sort((a, b) => b.ink - a.ink).slice(0, max).forEach(R => add(R, t.text)); continue; }
      const a = grow(t.box, 0.3);
      for (const R of B.ocrCand) if (meet(R.box, a)) add(R, t.text);
    }
    if (!wants.size) return 0;
    let added = 0, first = true;
    for (const [R, ws] of wants) {
      if (!B.ocrRead.has(R)) { if (first) { step('文字データのない所を読み取っています（OCR）'); first = false; } B.ocrRead.set(R, await readRegion(doc, q, R)); await PC.tick(); }
      for (const l of B.ocrRead.get(R)) {
        if (B.ocrAdded.has(l)) continue;
        const n = [...l.s].length, best = Math.max(...ws.map(w => lcs(l.s, w)));
        if (best < 2 || best < 0.5 * n) continue;   // 見当たらない字と似ていない読み取り(図・アイコン・読み違い)は使わない
        B.ocrAdded.add(l);
        const it = B.items.length;
        B.items.push({ s: l.s, box: l.box, vert: l.vert, size: l.vert ? l.box[2] - l.box[0] : l.box[3] - l.box[1], font: '', ocr: true });
        for (const c of l.chars) for (const ch of [...c.c]) { B.chars.push({ c: ch, k: PC.fold(ch), box: c.box, it, brk: false, sp: false, ocr: true, conf: c.conf, alt: altOf(ch) }); added++; }
      }
    }
    return added;
  };
})();
