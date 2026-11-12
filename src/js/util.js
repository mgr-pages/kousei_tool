// 共通の小道具: 画像・2値マスク・連結成分・矩形・統計
'use strict';
const PC = (window.PC = window.PC || {});

PC.DPI = 200;
PC.S = PC.DPI / 72;

// 処理の途中で画面を更新できるよう、ときどき制御を返す
PC.tick = () => new Promise(r => setTimeout(r, 0));

// 決まった乱数(同じ入力なら同じ結果になるように)
PC.prng = seed => () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

PC.median = a => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
PC.ov = (a, b, m = 0) => a[0] - m < b[2] && b[0] - m < a[2] && a[1] - m < b[3] && b[1] - m < a[3];
PC.union = boxes => {
  if (!boxes.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) { x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); }
  return [x0, y0, x1, y1];
};

// 画像は {w, h, d: Uint8ClampedArray(RGBA)} で持つ
PC.gray = img => {
  // OpenCVのRGB→GRAYと同じ係数(0.299, 0.587, 0.114)を整数で丸める
  const n = img.w * img.h, g = new Uint8Array(n), d = img.d;
  for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = (d[j] * 4899 + d[j + 1] * 9617 + d[j + 2] * 1868 + 8192) >> 14;
  return g;
};
PC.inkMask = (img, t = 50) => {
  const n = img.w * img.h, m = new Uint8Array(n), d = img.d;
  for (let i = 0, j = 0; i < n; i++, j += 4) m[i] = 255 - Math.min(d[j], d[j + 1], d[j + 2]) > t ? 1 : 0;
  return m;
};
PC.crop = (img, x0, y0, x1, y1) => {
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(img.w, x1); y1 = Math.min(img.h, y1);
  const w = Math.max(0, x1 - x0), h = Math.max(0, y1 - y0), d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) d.set(img.d.subarray(((y0 + y) * img.w + x0) * 4, ((y0 + y) * img.w + x0 + w) * 4), y * w * 4);
  return { w, h, d };
};
// 1チャンネル配列の部分切り出し(範囲外は切り詰める)
PC.sub = (a, W, x0, y0, x1, y1, H) => {
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W, x1); if (H !== undefined) y1 = Math.min(H, y1);
  const w = Math.max(0, x1 - x0), h = Math.max(0, y1 - y0), o = new a.constructor(w * h);
  for (let y = 0; y < h; y++) o.set(a.subarray((y0 + y) * W + x0, (y0 + y) * W + x0 + w), y * w);
  return { a: o, w, h, x0, y0 };
};

// ---- OpenCVで行う形態処理(マスクは0/1または0/255のUint8Array) ----
PC.toMat = (m, w, h) => { const mat = new cv.Mat(h, w, cv.CV_8UC1); mat.data.set(m); return mat; };
PC.fromMat = mat => new Uint8Array(mat.data);
PC.morph = (m, w, h, op, kw, kh) => {
  const src = PC.toMat(m, w, h), dst = new cv.Mat(), k = cv.Mat.ones(kh, kw, cv.CV_8U);
  const anchor = new cv.Point(-1, -1);
  if (op === 'dilate') cv.dilate(src, dst, k, anchor, 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
  else if (op === 'erode') cv.erode(src, dst, k, anchor, 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
  else cv.morphologyEx(src, dst, op === 'open' ? cv.MORPH_OPEN : cv.MORPH_CLOSE, k, anchor, 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
  const out = PC.fromMat(dst); src.delete(); dst.delete(); k.delete();
  return out;
};

// ---- デジタルどうしの描画の違い(確かな証拠) ----
//   同じ大きさで、ずれなく重なる2つの描画(スキャンでないPDFどうし)の、色が違う画素を調べる。
//   同じ内容は同じ画素に描かれるので、描画がまったく同じ所には、変化も赤字の書き込みもない。
//   字形の比べ方・赤の取り出しのような推定より先に、この証拠を使う(同じPDFどうしで項目を出さないため)
//   tol: どれかの色の差がこれを超えたら「違う」(目に見えない程度の差は違いとしない)
//   返り値: null(大きさが違う)。{ m: 違う画素=1, count: その数, same: 違う画素のまわり2画素を除いた「確かに同じ」画素=1,
//           has(box, margin): 枠(margin 画素広げる)の中に違う画素があるか }
PC.pixelDiff = (a, b, tol = 8) => {
  if (!a || !b || a.w !== b.w || a.h !== b.h) return null;
  const w = a.w, h = a.h, n = w * h, m = new Uint8Array(n), da = a.d, db = b.d;
  let count = 0;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    if (Math.abs(da[j] - db[j]) > tol || Math.abs(da[j + 1] - db[j + 1]) > tol || Math.abs(da[j + 2] - db[j + 2]) > tol) { m[i] = 1; count++; }
  }
  //   枠の中の違う画素の数を、すぐ求められるようにする(左上からの合計)
  const W1 = w + 1, sum = new Int32Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += m[y * w + x]; sum[(y + 1) * W1 + x + 1] = sum[y * W1 + x + 1] + row; } }
  const has = (box, margin = 0) => {
    const x0 = Math.max(0, Math.floor(box[0] - margin)), y0 = Math.max(0, Math.floor(box[1] - margin)), x1 = Math.min(w, Math.ceil(box[2] + margin)), y1 = Math.min(h, Math.ceil(box[3] + margin));
    if (x1 <= x0 || y1 <= y0) return false;
    return sum[y1 * W1 + x1] - sum[y0 * W1 + x1] - sum[y1 * W1 + x0] + sum[y0 * W1 + x0] > 0;
  };
  let same = null;
  if (count) { const near = PC.morph(m, w, h, 'dilate', 5, 5); same = new Uint8Array(n); for (let i = 0; i < n; i++) same[i] = near[i] ? 0 : 1; }
  else same = new Uint8Array(n).fill(1);
  return { m, w, h, count, same, has };
};

// ---- 連結成分(8近傍)。OpenCVと同じく、ラスタ順に最初に現れた順で番号を振る ----
PC.cc = (m, w, h) => {
  const lab = new Int32Array(w * h), parent = [0];
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) { if (a < b) parent[b] = a; else parent[a] = b; } };
  let next = 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!m[i]) continue;
      // 左・左上・上・右上のうち、すでに番号のある近傍
      const a = x > 0 ? lab[i - 1] : 0, r = i - w;
      const b = y > 0 && x > 0 ? lab[r - 1] : 0, c = y > 0 ? lab[r] : 0, d = y > 0 && x < w - 1 ? lab[r + 1] : 0;
      let l = 0;
      for (const q of [a, b, c, d]) if (q && (!l || q < l)) l = q;
      if (!l) { l = next++; parent.push(l); }
      else { if (a) unite(l, a); if (b) unite(l, b); if (c) unite(l, c); if (d) unite(l, d); }
      lab[i] = l;
    }
  }
  // 代表番号を、ラスタ順の出現順に1から振り直す
  const remap = new Int32Array(next); let n = 1;
  for (let i = 0; i < w * h; i++) {
    if (!lab[i]) continue;
    const r = find(lab[i]);
    if (!remap[r]) remap[r] = n++;
    lab[i] = remap[r];
  }
  const st = Array.from({ length: n }, () => ({ x0: Infinity, y0: Infinity, x1: -1, y1: -1, area: 0 }));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const l = lab[y * w + x];
    if (!l) continue;
    const s = st[l]; s.area++;
    if (x < s.x0) s.x0 = x; if (x > s.x1) s.x1 = x; if (y < s.y0) s.y0 = y; if (y > s.y1) s.y1 = y;
  }
  return { n, lab, st };
};
// 成分jの画素座標(xs, ys)
PC.pixelsOf = (lab, w, j, s) => {
  const xs = [], ys = [];
  for (let y = s.y0; y <= s.y1; y++) for (let x = s.x0; x <= s.x1; x++) if (lab[y * w + x] === j) { xs.push(x); ys.push(y); }
  return { xs, ys };
};

// 1次元の射影からインクのある区間を返す(gap以下の隙間は連結)
PC.runs = (v, gap = 1) => {
  const out = []; let s = -1, p = -1;
  for (let i = 0; i < v.length; i++) {
    if (v[i] <= 0) continue;
    if (s < 0) { s = p = i; continue; }
    if (i - p > gap + 1) { out.push([s, p + 1]); s = i; }
    p = i;
  }
  if (s >= 0) out.push([s, p + 1]);
  return out;
};
PC.rowSums = (a, w, h) => { const r = new Float64Array(h); for (let y = 0; y < h; y++) { let s = 0; for (let x = 0; x < w; x++) s += a[y * w + x]; r[y] = s; } return r; };
PC.colSums = (a, w, h) => { const c = new Float64Array(w); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) c[x] += a[y * w + x]; return c; };

PC.esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
