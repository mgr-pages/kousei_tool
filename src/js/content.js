// レイアウトが違う原稿(ラフ・前回の印刷物に指示を書き込んだもの)と成果物の照合: 文字データの対応づけ
//   位置は pt(1/72インチ、ページの左上が原点)で持つ
'use strict';
(function () {
  const { union } = PC;

  // ---- 照合用に字をそろえる: 全角・半角、波ダッシュ・ハイフン類などの書き方の違いは同じ字とみなす ----
  const VAR = {};
  for (const c of '‐‑‒–—―−﹣') VAR[c] = '-';
  for (const c of '～〜∼') VAR[c] = '~';
  Object.assign(VAR, { '◯': '○', '·': '・', '“': '"', '”': '"', '‘': "'", '’': "'" });
  PC.fold = c => { let k = c.normalize('NFKC'); if ([...k].length !== 1) k = c; return VAR[k] || k; };

  const area = b => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const inter = (a, b) => area([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);
  const iou = (a, b) => { const i = inter(a, b); return i / Math.max(1e-9, area(a) + area(b) - i); };
  PC.iou = iou;
  PC.center = b => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  PC.gap = (a, b) => Math.hypot(Math.max(0, a[0] - b[2], b[0] - a[2]), Math.max(0, a[1] - b[3], b[1] - a[3]));   // 枠どうしのすき間
  // 仕上がりの範囲(TrimBox。ページの外枠と同じなら外はないので null)と、枠の中心が仕上がりの外か
  PC.trimOf = B => { const t = B && B.trim; return t && (t[0] > 1 || t[1] > 1 || t[2] < B.w - 1 || t[3] < B.h - 1) ? t : null; };
  PC.outside = (t, b) => { const [x, y] = PC.center(b); return x < t[0] || x > t[2] || y < t[1] || y > t[3]; };

  // ---- ページの文字データ: 1字ずつ { c: 字, k: 照合用の字, box, it: まとまりの番号 } ----
  //   同じ位置に同じ文字列が重ねて描かれたもの(縁取りの文字など)は1つにする
  //   書体の名前(太字の指示の確認に使う)。ページを描画したあとでないと分からないため、分からなければ ''
  const fontOf = (page, id) => { try { return page.commonObjs.has(id) ? String(page.commonObjs.get(id).name || '') : ''; } catch (e) { return ''; } };
  PC.pageText = async (doc, pno) => {
    const page = await doc.getPage(pno + 1), vp = page.getViewport({ scale: 1 }), tc = await page.getTextContent();
    const items = [], chars = [];
    let wide = false, spc = false;   // 直前に幅の広い空白(全角の空白など)があった・直前に空白があった(英語の語の切れ目を戻すのに使う)
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) { if (it.str) spc = true; if (it.str && (it.str.includes('\u3000') || it.width >= 0.6 * (Math.hypot(it.transform[2], it.transform[3]) || 1))) wide = true; continue; }
      const st = tc.styles[it.fontName] || {}, [a, b, c, d, e, f] = it.transform;
      const size = Math.hypot(c, d) || Math.hypot(a, b) || 1, chs = [...it.str], n = chs.length, vert = !!st.vertical;
      const asc = st.ascent ? Math.min(st.ascent, 1) : 0.88, desc = st.descent ? Math.min(-st.descent, 0.3) : 0.12;
      // 文字データにはまとまりの幅しかないため、全角1・半角0.55・空白0.3の割合で字に割り振る(半角の字が混じっても位置がずれないように)
      const wt = chs.map(ch => (!ch.trim() ? 0.3 : /^[\u0020-\u007e\uff61-\uff9f]$/.test(ch) ? 0.55 : 1)), tot = wt.reduce((x, y) => x + y, 0) || 1;
      let acc = 0;
      //   回転した文字(図の寸法の縦向きの注記など): 字の並ぶ向き(a, b)と上の向き(c, d)に沿って枠の四隅を求める
      const rot = !vert && (Math.abs(b) > 1e-3 * size || Math.abs(c) > 1e-3 * size || a < 0), ua = Math.hypot(a, b) || 1, uc = Math.hypot(c, d) || 1;
      const rects = chs.map((_, i) => {
        const a0 = acc / tot; acc += wt[i]; const a1 = acc / tot;
        let r;
        if (rot) {
          const ps = [[a0 * it.width, -desc * size], [a1 * it.width, -desc * size], [a0 * it.width, asc * size], [a1 * it.width, asc * size]]
            .map(([x, y]) => vp.convertToViewportPoint(e + x * a / ua + y * c / uc, f + x * b / ua + y * d / uc));
          return [Math.min(...ps.map(p => p[0])), Math.min(...ps.map(p => p[1])), Math.max(...ps.map(p => p[0])), Math.max(...ps.map(p => p[1]))];
        }
        if (vert) { const H = it.height || size * n; r = [e, f - a1 * H, e + (it.width || size), f - a0 * H]; }
        else { r = [e + a0 * it.width, f - desc * size, e + a1 * it.width, f + asc * size]; }
        const p = vp.convertToViewportRectangle(r);
        return [Math.min(p[0], p[2]), Math.min(p[1], p[3]), Math.max(p[0], p[2]), Math.max(p[1], p[3])];
      });
      const box = union(rects);
      if (items.some(q => q.s === it.str && iou(q.box, box) > 0.6)) { wide = false; continue; }
      const idx = items.length;
      items.push({ s: it.str, box, vert, size, font: fontOf(page, it.fontName) });
      // 全角の空白・2つ以上続く空白のあとの字には印(見出しと中身の区切りとして、まとまりを分ける)
      let ws = '';
      chs.forEach((ch, i) => { if (!ch.trim()) { ws += ch; return; } chars.push({ c: ch, k: PC.fold(ch), box: rects[i], it: idx, brk: wide || /\u3000|\s{2,}/.test(ws), sp: spc || !!ws }); ws = ''; wide = false; spc = false; });
    }
    // 少しずらして重ねて描いた文字(影・縁取り)で、ほかの文字列の一部だけが重なって描かれたものも除く
    const key = s => s.replace(/\s/g, '');
    const drop = items.map((it, k) => { const t = key(it.s); return !!t && items.some((o, j) => j !== k && key(o.s).length > t.length && key(o.s).includes(t) && inter(o.box, it.box) >= 0.6 * Math.min(area(o.box), area(it.box))); });
    // 仕上がりの範囲(trim)・裁ち落としの範囲(bleed)。PDFに書かれていなければ null
    const bx = page.pcBoxes, vr = r => { const p = vp.convertToViewportRectangle(r); return [Math.min(p[0], p[2]), Math.min(p[1], p[3]), Math.max(p[0], p[2]), Math.max(p[1], p[3])]; };
    const trim = bx && bx.TrimBox ? vr(bx.TrimBox) : null, bleed = bx && bx.BleedBox ? vr(bx.BleedBox) : null;
    if (!drop.some(Boolean)) return { w: vp.width, h: vp.height, trim, bleed, items, chars };
    const map = []; let n = 0; drop.forEach((x, k) => { map[k] = x ? -1 : n++; });
    return { w: vp.width, h: vp.height, trim, bleed, items: items.filter((_, k) => !drop[k]), chars: chars.filter(c => !drop[c.it]).map(c => ({ ...c, it: map[c.it] })) };
  };

  // ---- 字の枠を、描画した画像の字の形(インク)に合わせる(表示の枠がずれないように) ----
  //   字と字の境目を、近くのインクのない(少ない)列へ寄せ、枠を字の形まで縮める。地の色と違う色をインクとみなす(白抜きの字・色地の上の字も)
  //   写真の上の字など、地の色が一様でないまとまりは、そのままにする。img: ページの描画、k: pt → 画素の倍率
  PC.snapChars = (T, img, k) => {
    const { w, h, d } = img, byItem = new Map();
    T.chars.forEach(c => { let l = byItem.get(c.it); if (!l) byItem.set(c.it, l = []); l.push(c); });
    for (const [idx, cs] of byItem) {
      const it = T.items[idx];
      if (it.vert) continue;
      const y0 = Math.max(0, Math.floor(it.box[1] * k)), y1 = Math.min(h, Math.ceil(it.box[3] * k)), x0 = Math.max(0, Math.floor(it.box[0] * k) - 2), x1 = Math.min(w, Math.ceil(it.box[2] * k) + 2);
      const W = x1 - x0, H = y1 - y0;
      if (W < 3 || H < 3) continue;
      const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)], med = [0, 0, 0];
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const j = (y * w + x) * 4; hist[0][d[j]]++; hist[1][d[j + 1]]++; hist[2][d[j + 2]]++; }
      for (let ch = 0; ch < 3; ch++) { let a = 0, n = 0; while (a < 255 && n + hist[ch][a] < W * H / 2) { n += hist[ch][a]; a++; } med[ch] = a; }
      const ink = new Uint8Array(W * H), col = new Int32Array(W);
      let plain = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const j = (y * w + x) * 4, dd = Math.max(Math.abs(d[j] - med[0]), Math.abs(d[j + 1] - med[1]), Math.abs(d[j + 2] - med[2]));
        if (dd <= 40) plain++;
        if (dd > 60) { ink[(y - y0) * W + x - x0] = 1; col[x - x0]++; }
      }
      if (plain < 0.5 * W * H) continue;
      // 隣り合う字の境目を、前後0.4字の範囲でいちばんインクの少ない列(同じなら推定に近い列)へ
      for (let i = 0; i + 1 < cs.length; i++) {
        const a = cs[i].box, b = cs[i + 1].box;
        if (Math.abs(a[2] - b[0]) > 0.05 * it.size) continue;   // 空白をはさむ字どうしは、そのまま
        const e = a[2] * k - x0, cw = 0.4 * Math.min(a[2] - a[0], b[2] - b[0]) * k;
        let best = Math.round(e), bc = Infinity;
        for (let x = Math.max(0, Math.ceil(e - cw)); x <= Math.min(W - 1, Math.floor(e + cw)); x++) { const c = col[x] * 1000 + Math.abs(x - e); if (c < bc) { bc = c; best = x; } }
        a[2] = b[0] = (best + x0) / k;
      }
      // 字の枠を、その範囲のインクまで縮める(インクがなければそのまま)
      for (const c of cs) {
        const l = Math.max(0, Math.floor(c.box[0] * k) - x0), r = Math.min(W, Math.ceil(c.box[2] * k) - x0);
        let cl = -1, cr = -1, rt = -1, rb = -1;
        for (let y = 0; y < H; y++) for (let x = l; x < r; x++) if (ink[y * W + x]) { if (cl < 0 || x < cl) cl = x; if (x > cr) cr = x; if (rt < 0) rt = y; rb = y; }
        if (cl >= 0) c.box = [(cl + x0) / k, (rt + y0) / k, (cr + 1 + x0) / k, (rb + 1 + y0) / k];
      }
    }
  };

  // ---- 字形で比べるページの字と位置(画素): 全角・半角の幅を考えて割り振り(PC.pageText)、描画した字の形に合わせる ----
  //   img: そのページを PC.DPI で描画したもの。返り値 [[字, 枠], ...](枠は PC.DPI の画素)
  //   ocr: 文字データのない所を OCR で読んだ字も加える(字形で比べたあとの、違う字の表示に使う)
  PC.textCharsSnapped = async (doc, pno, img, ocr = false) => {
    const T = await PC.pageText(doc, pno), k = PC.DPI / 72;
    PC.snapChars(T, img, k);
    if (ocr && PC.ocrAugment) await PC.ocrAugment(doc, pno, T, img);
    return T.chars.map(c => (c.ocr ? [c.c, c.box.map(v => v * k), 'ocr'] : [c.c, c.box.map(v => v * k)]));
  };

  // ---- まとまり(段落・テキストボックス): 字の並び(描かれた順)を、続きでない所で切る ----
  //   同じ行でも全角の空白や1字分以上のすき間がある所(「締切日　2027年…」のような見出しと中身)は切る(デザインで別々に配置されることが多いため)
  //   返り値: [[開始, 終了), ...]。大きすぎるまとまりは maxLen 字ごとに切る
  PC.blocksOf = (cs, items, maxLen = 400) => {
    const out = []; let s = 0, bx = null;
    for (let k = 0; k < cs.length; k++) {
      if (k > s) {
        const p = items[cs[k - 1].it], q = items[cs[k].it], size = Math.min(p.size, q.size), a = cs[k - 1].box, b = cs[k].box;
        const spaced = cs[k].brk || (!p.vert && !q.vert && Math.abs((a[1] + a[3]) - (b[1] + b[3])) / 2 < 0.5 * size && b[0] - a[2] >= 0.9 * size);
        let cont = cs[k - 1].it === cs[k].it && !spaced;
        if (!cont && !p.vert && !q.vert) {
          const sameLine = !spaced && Math.abs((p.box[1] + p.box[3]) - (q.box[1] + q.box[3])) / 2 < 0.6 * size && q.box[0] > p.box[0] - size && q.box[0] - p.box[2] < 3 * size;
          const nextLine = q.box[1] >= p.box[1] + 0.3 * size && q.box[1] - p.box[3] < 1.5 * size && q.box[0] < bx[2] + size && q.box[2] > bx[0] - size;
          cont = sameLine || nextLine;
        } else if (!cont && p.vert && q.vert) {
          const sameCol = Math.abs((p.box[0] + p.box[2]) - (q.box[0] + q.box[2])) / 2 < 0.6 * size && q.box[1] > p.box[1] - size && q.box[1] - p.box[3] < 3 * size;
          const nextCol = q.box[2] <= p.box[2] - 0.3 * size && p.box[0] - q.box[2] < 1.5 * size && q.box[1] < bx[3] + size && q.box[3] > bx[1] - size;
          cont = sameCol || nextCol;
        }
        if (!cont || k - s >= maxLen) { out.push([s, k]); s = k; bx = null; }
      }
      bx = bx ? union([bx, cs[k].box]) : cs[k].box.slice();
    }
    if (cs.length > s) out.push([s, cs.length]);
    return out;
  };

  // ---- ページに置かれた画像の範囲(pt): 描画命令をたどり、画像が描かれる単位正方形を写す ----
  PC.imageBoxes = async (doc, pno) => {
    const page = await doc.getPage(pno + 1), vp = page.getViewport({ scale: 1 }), ol = await page.getOperatorList(), O = pdfjsLib.OPS;
    const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
    const IMG = new Set([O.paintImageXObject, O.paintInlineImageXObject, O.paintImageMaskXObject, O.paintJpegXObject].filter(x => x !== undefined));
    const out = [], stack = [];
    let m = [1, 0, 0, 1, 0, 0];
    for (let k = 0; k < ol.fnArray.length; k++) {
      const fn = ol.fnArray[k], args = ol.argsArray[k];
      if (fn === O.save) stack.push(m);
      else if (fn === O.restore) m = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (fn === O.transform) m = mul(m, args);
      else if (fn === O.paintFormXObjectBegin) { stack.push(m); if (args && args[0]) m = mul(m, args[0]); }
      else if (fn === O.paintFormXObjectEnd) m = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (IMG.has(fn)) {
        const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => vp.convertToViewportPoint(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]));
        const b = [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
        const c = [Math.max(0, b[0]), Math.max(0, b[1]), Math.min(vp.width, b[2]), Math.min(vp.height, b[3])];
        if (c[2] - c[0] > 4 && c[3] - c[1] > 4) out.push(c);
      }
    }
    return out;
  };

  // ---- 長く一致する文字列(対応づけの手がかり): {i, j, n} = A[i..i+n) と B[j..j+n) が同じ ----
  //   位置の手がかりにも使うため、どちらかで行(縦組みは列)が変わる所・離れた所で区切って返す
  //   (区切りは字の位置で見る。PDFの文字のまとまり(item)は、書体が替わるたびに1字ずつに分かれることがあるので使わない)
  const cont = (p, c) => {   // 同じ行(列)で続く字か: 高さ(縦組みは幅)が半分以上重なり、すき間が字の大きさの1.5倍まで
    const hp = p.box[3] - p.box[1], hc = c.box[3] - c.box[1], wp = p.box[2] - p.box[0], wc = c.box[2] - c.box[0], s = Math.max(hp, hc, wp, wc, 1);
    const oy = Math.min(p.box[3], c.box[3]) - Math.max(p.box[1], c.box[1]), ox = Math.min(p.box[2], c.box[2]) - Math.max(p.box[0], c.box[0]);
    return PC.gap(p.box, c.box) <= 1.5 * s && (oy >= 0.5 * Math.min(hp, hc) || ox >= 0.5 * Math.min(wp, wc));
  };
  PC.textAnchors = (A, B, K = 6) => {
    const out = [], idx = new Map(), key = (X, i) => { let s = ''; for (let t = 0; t < K; t++) s += X[i + t].k + '\u0001'; return s; };
    if (A.length < K || B.length < K) return out;
    for (let j = 0; j + K <= B.length; j++) { const s = key(B, j); let l = idx.get(s); if (!l) idx.set(s, l = []); l.push(j); }
    for (let i = 0; i + K <= A.length; i++) {
      const l = idx.get(key(A, i));
      if (!l || l.length > 12) continue;   // 何度も出てくる並び(罫線代わりの記号など)は手がかりにしない
      for (const j of l) {
        if (i > 0 && j > 0 && A[i - 1].k === B[j - 1].k) continue;   // 左へ延ばせるものは、その位置から始まる一致に含まれる
        let n = K; while (i + n < A.length && j + n < B.length && A[i + n].k === B[j + n].k) n++;
        let t0 = 0;
        for (let t = 1; t <= n; t++) if (t === n || !cont(A[i + t - 1], A[i + t]) || !cont(B[j + t - 1], B[j + t])) { out.push({ i: i + t0, j: j + t0, n: t - t0 }); t0 = t; }
      }
    }
    return out;
  };

  // ---- 原稿 → 成果物の位置の変換をRANSACで当てはめる(重みつき) ----
  //   T = [a, b, tx, ty, ay]: x' = a x - b y + tx, y' = b x + ay y + ty (ay を省くと ay = a)
  //   mode 'sim': 相似変換(回転あり。スキャンの画像の手がかり)、'axis': 縦と横の倍率を別々に(回転なし。文字の手がかり。
  //   デザインで縦横の詰め方が変わっても当てはまるように。配置の違いを回転と取り違えないよう、回転は求めない)
  const ay = T => (T.length > 4 ? T[4] : T[0]);
  PC.applyT = (T, x, y) => [T[0] * x - T[1] * y + T[2], T[1] * x + ay(T) * y + T[3]];
  PC.mapBox = (T, b) => {
    const ps = [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]].map(([x, y]) => PC.applyT(T, x, y));
    return [Math.min(...ps.map(p => p[0])), Math.min(...ps.map(p => p[1])), Math.max(...ps.map(p => p[0])), Math.max(...ps.map(p => p[1]))];
  };
  PC.invT = T => {
    const a = T[0], b = T[1], d = ay(T), det = a * d + b * b;
    return [d / det, -b / det, -(d * T[2] + b * T[3]) / det, -(-b * T[2] + a * T[3]) / det, a / det];
  };
  PC.scaleOf = T => Math.sqrt(Math.hypot(T[0], T[1]) * Math.hypot(ay(T), T[1]));   // 縦横の倍率の相乗平均
  PC.aspectOf = T => ay(T) / T[0];   // 縦の倍率 ÷ 横の倍率
  function fitW(P, Q, w, idx, mode) {
    let sw = 0, mx = 0, my = 0, nx = 0, ny = 0;
    for (const k of idx) { sw += w[k]; mx += w[k] * P[k][0]; my += w[k] * P[k][1]; nx += w[k] * Q[k][0]; ny += w[k] * Q[k][1]; }
    if (sw <= 0) return null;
    mx /= sw; my /= sw; nx /= sw; ny /= sw;
    let sxx = 0, syy = 0, sa = 0, sb = 0, sx = 0, sy = 0;
    for (const k of idx) {
      const px = P[k][0] - mx, py = P[k][1] - my, qx = Q[k][0] - nx, qy = Q[k][1] - ny;
      sxx += w[k] * px * px; syy += w[k] * py * py; sa += w[k] * (px * qx + py * qy); sb += w[k] * (px * qy - py * qx); sx += w[k] * px * qx; sy += w[k] * py * qy;
    }
    if (mode === 'axis') {
      if (sxx < 1e-9 || syy < 1e-9) return null;
      const a = sx / sxx, d = sy / syy;
      return [a, 0, nx - a * mx, ny - d * my, d];
    }
    if (sxx + syy < 1e-9) return null;
    const a = sa / (sxx + syy), b = mode === 'sim' ? sb / (sxx + syy) : 0;
    return [a, b, nx - (a * mx - b * my), ny - (b * mx + a * my)];
  }
  // 裏返し・大きな回転・極端な縦横比はない
  const sane = T => { const s = PC.scaleOf(T), r = PC.aspectOf(T); return T[0] > 0 && ay(T) > 0 && s > 0.25 && s < 4 && r > 0.67 && r < 1.5 && Math.abs(T[1]) < 0.1 * s; };
  PC.fitSimilarity = (P, Q, w, thr, opt = {}) => {
    const n = P.length, rand = PC.prng(opt.seed || 20261026), mode = opt.mode || 'iso';
    const err = (T, k) => { const p = PC.applyT(T, P[k][0], P[k][1]); return Math.hypot(p[0] - Q[k][0], p[1] - Q[k][1]); };
    if (n < 2) return null;
    const all = [...Array(n).keys()], score = T => { let s = 0; for (let k = 0; k < n; k++) if (err(T, k) < thr) s += w[k]; return s; };
    let best = null, bs = 0;
    for (let it = 0; it < Math.min(opt.iters || 3000, n * n); it++) {
      const a = Math.floor(rand() * n), b = Math.floor(rand() * n);
      if (a === b || Math.hypot(P[a][0] - P[b][0], P[a][1] - P[b][1]) < 10) continue;
      if (mode === 'axis' && (Math.abs(P[a][0] - P[b][0]) < 10 || Math.abs(P[a][1] - P[b][1]) < 10)) continue;
      const T = fitW(P, Q, w, [a, b], mode);
      if (!T || !sane(T)) continue;
      const s = score(T);
      if (s > bs) { bs = s; best = T; }
    }
    if (!best) return null;
    for (let r = 0; r < 3; r++) { const inl = all.filter(k => err(best, k) < thr), T = inl.length >= 2 ? fitW(P, Q, w, inl, mode) : null; if (!T || !sane(T)) break; best = T; }
    const inl = all.filter(k => err(best, k) < thr);
    return { T: best, inl, score: inl.reduce((s, k) => s + w[k], 0), err: k => err(best, k) };
  };

  // ---- 並べ替えに強い対応づけ ----
  //   Aの字の並びを、Bのいくつかの区間につなぎ合わせて対応させる。区間の中は普通の編集(一致・置換・Bにだけある字・Aにだけある字)、
  //   別の区間へ移るたびに jump の手間がかかる(段組み・配置の違い)。near[j] は、Bのj字目から始めるときの追加の手間(Aのまとまりが
  //   来るはずの範囲から遠いほど大きい。Aの字ごとに変えると、字を捨てて手間の小さい位置を選ぶ抜け道ができるため、まとまり単位で決める)
  //   used[j]: ほかのまとまりがすでに対応づけたBの字(同じ文が2か所にあるとき、同じ所に2度当てないよう、一致しない字と同じ扱いにする)
  //   Bの字のまとまり(item)の境目をまたぐたびに、ごく小さな手間(XI)をかける: 手間が同じ並べ方のうち、まとまりをまたがない方を選ぶ
  //   (左右のページ番号「11」「12」の「11」を、「11」の2字目と「12」の1字目に当てないように)
  //   返り値 ops: ['=', i, j] 同じ字 / ['~', i, j] 書き方だけ違う / ['x', i, j] 違う字 / ['-', i] Aにだけある / ['+', j] Bにだけある / ['|'] 別の区間へ
  const XI = 0.01;
  PC.collate = (A, B, opt = {}) => {
    const n = A.length, m = B.length, J = opt.jump ?? 3, nr = opt.near || null, W = m + 1, near = nr ? (i, j) => nr[j] : null, used = opt.used || null, strict = !!opt.strict;
    if (!n) return [];
    if (!m) return A.map((_, i) => ['-', i]);
    const D = new Float32Array((n + 1) * W), op = new Uint8Array((n + 1) * W), from = new Int32Array(n + 1);
    //   opt.bseg(成果物の字ごとの段落の番号): 段落をまたいで続けるときは、別の区間へ移るのと同じ手間をかける
    //   (成果物の字の並びの順番で隣でも、紙面では離れた段落(注記のあとに表の見出しが並ぶなど)に続けて当てないように)
    const bseg = opt.bseg || null, xi = new Float32Array(m);
    for (let j = 1; j < m; j++) { if (B[j].it !== B[j - 1].it) xi[j] = XI; if (bseg && bseg[j] !== bseg[j - 1]) xi[j] = J; }
    //   OCR で読んだ字(alt: 読み違えやすい字の候補)は、候補の字とも同じとみなす
    const alt = B.some(c => c.alt) || A.some(c => c.alt), same = (a, b) => a.k === b.k || (alt && ((b.alt && b.alt.has(a.k)) || (a.alt && a.alt.has(b.k))));
    for (let j = 0; j <= m; j++) { D[j] = J + (near && j < m ? near(0, j) : 0); op[j] = 3; }
    from[0] = -1;
    for (let i = 0; i < n; i++) {
      const r0 = i * W, r1 = r0 + W, ak = A[i].k;
      for (let j = 0; j <= m; j++) { D[r1 + j] = D[r0 + j] + 1; op[r1 + j] = 1; }
      for (let j = 0; j < m; j++) { const v = D[r0 + j] + ((ak === B[j].k || (alt && same(A[i], B[j]))) && !(used && used[j]) ? 0 : 1) + (op[r0 + j] === 3 ? 0 : xi[j]); if (v < D[r1 + j + 1]) { D[r1 + j + 1] = v; op[r1 + j + 1] = 0; } }
      for (let j = 0; j < m; j++) { const v = D[r1 + j] + 1 + (op[r1 + j] === 3 ? 0 : xi[j]); if (v < D[r1 + j + 1]) { D[r1 + j + 1] = v; op[r1 + j + 1] = 2; } }
      let best = Infinity, bj = 0;
      for (let j = 0; j <= m; j++) if (D[r1 + j] < best) { best = D[r1 + j]; bj = j; }
      from[i + 1] = bj;
      //   strict: 前へ戻る飛び越し(すでに当てた成果物の字に当て直すことになる)は、手間を倍にする
      //   (消えた文の字を後ろの文の字との置き換えとし、後ろの文に戻って当て直す並べ方が、文をそのまま消す並べ方と同じ手間にならないように)
      if (i + 1 < n) for (let j = 0; j < m; j++) { const v = best + J + (strict && j < bj ? J : 0) + (near ? near(i + 1, j) : 0); if (v < D[r1 + j]) { D[r1 + j] = v; op[r1 + j] = 3; } }
    }
    let i = n, j = 0, best = Infinity;
    for (let q = 0; q <= m; q++) if (D[n * W + q] < best) { best = D[n * W + q]; j = q; }
    // strict(データファイルの原稿): 最後の字は、手間が同じなら字を消すより置き換えとみなす(「4444」→「4445」を、4を消して5を足す、としない)
    if (strict && j < m && D[n * W + j + 1] === best && op[n * W + j + 1] === 0 && !(used && used[j])) j++;
    const ops = [];
    while (i > 0) {
      const o = op[i * W + j];
      if (o === 0) { i--; j--; ops.push([A[i].c === B[j].c || (A[i].k !== B[j].k && alt && same(A[i], B[j])) ? '=' : A[i].k === B[j].k ? '~' : 'x', i, j]); }
      else if (o === 1) { i--; ops.push(['-', i]); }
      else if (o === 2) { j--; ops.push(['+', j]); }
      else { ops.push(['|']); j = from[i]; }
    }
    ops.reverse();
    // strict: 最初の字も、消してすぐ後ろから当てるのと手間が同じなら、すぐ前の成果物の字(同じまとまり・未使用)との置き換えとみなす
    //   (「秋の新商品」→「冬の新商品」を、「秋」を消して「冬」が余る、としない)
    if (strict && ops.length > 1 && ops[0][0] === '-' && ops[0][1] === 0 && ops[1].length === 3 && ops[1][1] === 1) {
      const j1 = ops[1][2];
      if (j1 > 0 && B[j1 - 1].it === B[j1].it && !(used && used[j1 - 1])) ops[0] = [A[0].c === B[j1 - 1].c ? '=' : A[0].k === B[j1 - 1].k ? '~' : 'x', 0, j1 - 1];
    }
    // strict: 1つのまとまりの中で、同じ成果物の字を2度使わない(抜けた文が、前の文の字に当たり直さないように)。一致の多い区間を残す
    if (strict) {
      const segOf = [], hitsOf = []; let sg = 0;
      ops.forEach((o, k) => { if (o[0] === '|') { sg++; return; } segOf[k] = sg; hitsOf[sg] = (hitsOf[sg] || 0) + (o[0] === '=' || o[0] === '~' ? 1 : 0); });
      const owner = new Map();
      ops.forEach((o, k) => { const jj = o.length === 3 ? o[2] : o[0] === '+' ? o[1] : -1; if (jj < 0) return; const s0 = owner.get(jj); if (s0 === undefined || hitsOf[segOf[k]] > hitsOf[s0]) owner.set(jj, segOf[k]); });
      for (let k = 0; k < ops.length; k++) {
        const o = ops[k], jj = o.length === 3 ? o[2] : o[0] === '+' ? o[1] : -1;
        if (jj >= 0 && owner.get(jj) !== segOf[k]) ops[k] = o[0] === '+' ? null : ['-', o[1]];
        else if (jj >= 0) owner.set(jj, -1);   // 同じ区間の中でも1度だけ
      }
      for (let k = ops.length - 1; k >= 0; k--) if (!ops[k]) ops.splice(k, 1);
    }
    // 一致した字が少ない区間(区間のAの字の半分未満、かつ3字未満)は、たまたま同じ字に当たっただけとみなし、対応させない
    //   strict のとき、6字以上の区間で一致した字が1字ずつばらばらなもの(2字続けて一致した所がない)も同じ
    const out = []; let seg = [];
    const run2 = () => seg.some((o, k) => k > 0 && (o[0] === '=' || o[0] === '~') && (seg[k - 1][0] === '=' || seg[k - 1][0] === '~'));
    const flush = () => {
      const a = seg.filter(o => o[0] !== '+').length, hit = seg.filter(o => o[0] === '=' || o[0] === '~').length;
      if (hit >= Math.min(3, Math.ceil(a / 2)) && !(strict && a >= 6 && !run2())) out.push(...seg);
      else for (const o of seg) if (o[0] !== '+') out.push(['-', o[1]]);
      seg = [];
    };
    for (const o of ops) { if (o[0] === '|') { flush(); out.push(o); } else seg.push(o); }
    flush();
    // strict: 区間の端の置き換え(x)の続きで、成果物の字がその区間の一致した字と同じ行で続いていないものは、消えた字とする
    //   (まとまりの最後の文が消えたとき、その字が、すぐ後ろの別の行の字(表の見出しなど)との置き換えとして食い込まないように)
    if (strict && B[0] && B[0].box) {
      const near2 = (p, c) => { const s = Math.max(p.box[3] - p.box[1], c.box[3] - c.box[1], p.box[2] - p.box[0], c.box[2] - c.box[0], 1); return PC.gap(p.box, c.box) <= 1.5 * s; };
      let k0 = 0;
      for (let k = 0; k <= out.length; k++) {
        if (k < out.length && out[k][0] !== '|') continue;
        const seg = out.slice(k0, k), eq = seg.map((o, t) => (o[0] === '=' || o[0] === '~' ? t : -1)).filter(t => t >= 0);
        if (eq.length) {
          const first = eq[0], last = eq[eq.length - 1];
          for (let t = last + 1, pj = seg[last][2]; t < seg.length; t++) { const o = seg[t]; if (o[0] !== 'x') continue; if (near2(B[pj], B[o[2]])) { pj = o[2]; continue; } for (let u = t; u < seg.length; u++) if (seg[u][0] === 'x') out[k0 + u] = ['-', seg[u][1]]; break; }
          for (let t = first - 1, pj = seg[first][2]; t >= 0; t--) { const o = seg[t]; if (o[0] !== 'x') continue; if (near2(B[pj], B[o[2]])) { pj = o[2]; continue; } for (let u = t; u >= 0; u--) if (seg[u][0] === 'x') out[k0 + u] = ['-', seg[u][1]]; break; }
        }
        k0 = k + 1;
      }
    }
    // 区間の先頭・末尾の「Bにだけある字」は、区間の始め方・終わり方の都合で入っただけなので除く
    const keep = out.map(() => true);
    for (let k = 0; k < out.length; k++) {
      if (out[k][0] !== '+') continue;
      let a = k; while (a > 0 && out[a - 1][0] === '+') a--;
      let b = k; while (b + 1 < out.length && out[b + 1][0] === '+') b++;
      const atStart = a === 0 || out[a - 1][0] === '|', atEnd = b === out.length - 1 || out[b + 1][0] === '|';
      if ((atStart || atEnd) && !(opt.keepEdge && opt.keepEdge(out[k][1]))) keep[k] = false;
    }
    return PC.shiftEdits(out.filter((_, k) => keep[k]), A, B);
  };

  // ---- 違いの位置を整える(手間が同じ並べ方のうち、まとまった・切れ目のよい方を選ぶ) ----
  //   「[QX-12AB]」→「[QX-12AB][QX-12AB2]」を、「[QX-12AB]」を足して離れた所に「2」を足す、とせず、「[QX-12AB2]」を足す、とする
  //   1) 足した字(+)・消した字(-)だけの続きを、前後の同じ字(=)の上で滑らせ、同じ種類の違いとつながる所があればつなげる
  //   2) 滑らせられる範囲で、かっこ・空白・句読点・字の種類の切れ目にそろう位置に寄せる(同じなら元の位置のまま)
  //   区間の切れ目(|)・置き換わり(x)・書き方の違い(~)はまたがない
  const OPENB = /[（(「『【〔［[｛{〈《]/, CLOSEB = /[）)」』】〕］\]｝}〉》]/;
  const charClass = c => (/\d|[０-９]/.test(c) ? 1 : /[A-Za-zＡ-Ｚａ-ｚ]/.test(c) ? 2 : /[\p{Script=Hiragana}]/u.test(c) ? 3 : /[\p{Script=Katakana}ー]/u.test(c) ? 4 : /\p{Script=Han}/u.test(c) ? 5 : 6);
  const cutScore = (l, r) => {
    if (l == null || r == null) return 4;
    if (/[\s　]/.test(l) || /[\s　]/.test(r)) return 3;
    if (OPENB.test(r) || CLOSEB.test(l)) return 3;
    if (/[、。，．,.:;：；・\/／]/.test(l)) return 2;
    return charClass(l) !== charClass(r) ? 1 : 0;
  };
  PC.cutScore = cutScore;
  PC.shiftEdits = (ops, A, B) => {
    const out = ops.slice();
    // k から始まる同じ種類(+ か -)の続きの終わり
    const runEnd = k => { let l = k; while (l < out.length && out[l][0] === out[k][0]) l++; return l; };
    const idx = o => (o[0] === '+' ? o[1] : o[1]);   // + は B の字の番号、- は A の字の番号
    const X = t => (t === '+' ? B : A);
    // 1字右へ滑らせる: 続き [k, l) のすぐ後ろの = を前へ回す。できなければ false
    const right = (k, l) => {
      const t = out[k][0], e = out[l];
      if (!e || e[0] !== '=') return false;
      const s0 = idx(out[k]), s1 = idx(out[l - 1]) + 1, nxt = t === '+' ? e[2] : e[1];
      if (s1 - s0 !== l - k || nxt !== s1 || X(t)[s0].c !== X(t)[s1].c) return false;
      const eq = t === '+' ? ['=', e[1], s0] : ['=', s0, e[2]];
      const run = []; for (let q = s0 + 1; q <= s1; q++) run.push([t, q]);
      out.splice(k, l - k + 1, eq, ...run);
      return true;
    };
    // 1字左へ滑らせる: 続きのすぐ前の = を後ろへ回す
    const left = (k, l) => {
      const t = out[k][0], e = out[k - 1];
      if (!e || e[0] !== '=') return false;
      const s0 = idx(out[k]), s1 = idx(out[l - 1]) + 1, prv = t === '+' ? e[2] : e[1];
      if (s1 - s0 !== l - k || prv !== s0 - 1 || X(t)[s0 - 1].c !== X(t)[s1 - 1].c) return false;
      const eq = t === '+' ? ['=', e[1], s1 - 1] : ['=', s1 - 1, e[2]];
      const run = []; for (let q = s0 - 1; q <= s1 - 2; q++) run.push([t, q]);
      out.splice(k - 1, l - k + 1, ...run, eq);
      return true;
    };
    const pure = k => out[k] && (out[k][0] === '+' || out[k][0] === '-');
    // 1) つなげる: 右(または左)へ滑らせて、同じ種類の違いのすぐ隣まで行けるなら行く
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      for (let k = 0; k < out.length; k++) {
        if (!pure(k) || (k > 0 && out[k - 1][0] === out[k][0])) continue;
        const t = out[k][0], snap = out.slice();
        let kk = k, ll = runEnd(k), moved = 0, ok = false;
        while (right(kk, ll)) { kk++; ll++; moved++; if (out[ll] && out[ll][0] === t) { ok = true; break; } }
        if (!ok) {
          out.splice(0, out.length, ...snap); kk = k; ll = runEnd(k);
          while (left(kk, ll)) { kk--; ll--; if (kk > 0 && out[kk - 1][0] === t) { ok = true; break; } }
          if (!ok) out.splice(0, out.length, ...snap);
        }
        if (ok) changed = true;
      }
      if (!changed) break;
    }
    // 2) 切れ目のよい位置に寄せる
    for (let k = 0; k < out.length; k++) {
      if (!pure(k) || (k > 0 && out[k - 1][0] === out[k][0])) continue;
      const t = out[k][0], x = X(t), l0 = runEnd(k), len = l0 - k;
      const score = (k1) => { const s0 = idx(out[k1]), s1 = s0 + len; return cutScore(x[s0 - 1] && x[s0 - 1].c, x[s0].c) + cutScore(x[s1 - 1].c, x[s1] && x[s1].c); };
      const snap = out.slice(); let best = score(k), bestAt = 0, at = 0, kk = k, ll = l0;
      while (right(kk, ll)) { kk++; ll++; at++; const v = score(kk); if (v > best) { best = v; bestAt = at; } }
      out.splice(0, out.length, ...snap); kk = k; ll = l0; at = 0;
      while (left(kk, ll)) { kk--; ll--; at--; const v = score(kk); if (v > best) { best = v; bestAt = at; } }
      out.splice(0, out.length, ...snap); kk = k; ll = l0;
      if (bestAt > 0) for (let q = 0; q < bestAt; q++) { right(kk, ll); kk++; ll++; }
      if (bestAt < 0) for (let q = 0; q > bestAt; q--) { left(kk, ll); kk--; ll--; }
      k = kk + len - 1;
    }
    return out;
  };

  // 通貨の記号(数字のすぐ前後にあれば、あるなし・前後の違いを書き方の違いとみなす: 「¥1,280」と「1,280円」)
  PC.UNIT = /^[¥￥円$＄]$/;
  // ---- opsを、違いのまとまり(hunk)に分ける: [開始, 終了) は ops の番号 ----
  //   区間の切れ目('|')は違いではない(配置が違うだけ)。同じ字が2字以上続く所、区間の切れ目で分ける
  //   A・B(字の並び)を渡すと、数字のまとまり(桁区切り・小数点・時刻・日付の区切りを含む)の中の違いは1つにまとめる
  //   (「1,234,567」→「1,334,568」を2件にしない。間が数字と区切りだけ(6字まで)で、両方の違いに数字があるもの)
  PC.NUMC = /[0-9０-９,，.．:：\/／\-－]/; PC.DIGC = /[0-9０-９]/;
  // 違い(segs)が数字のまとまりにかかるときは、数字全体を「旧→新」の1か所で示す(「4,[73→06]0」でなく「4,730→5,060」)
  //   違いの字が入っている旧・新の数字のまとまり(数字と、数字にはさまれた区切り)の字を、すべて違いに入れる。数字の外の違い・同じ字はそのまま
  //   (「10:00〜18:00」→「11:30〜19:00」は「10:00→11:30」と「18:00→19:00」の2か所。「〜」は同じ字のまま)
  PC.numberSegs = segs => {
    if (!segs || !segs.some(g => g[0] !== '=')) return segs;
    // 字ごとの列: [種類, 字, 旧の字の番号, 新の字の番号]
    const cols = [], O = [], N = [];
    for (const [t, s] of segs) for (const c of s) { cols.push([t, c, t !== '+' ? O.length : -1, t !== '-' ? N.length : -1]); if (t !== '+') O.push(c); if (t !== '-') N.push(c); }
    const tokens = C => { const id = new Int32Array(C.length).fill(-1); let n = 0; for (let i = 0; i < C.length; i++) { if (!PC.DIGC.test(C[i])) continue; let e = i + 1; while (e < C.length && (PC.DIGC.test(C[e]) || (PC.NUMC.test(C[e]) && PC.DIGC.test(C[e + 1] || '')))) e++; id.fill(n++, i, e); i = e - 1; } return id; };
    const tO = tokens(O), tN = tokens(N), hot = cols.map(c => c[0] !== '='), hO = new Set(), hN = new Set();
    for (let grew = true; grew;) {
      grew = false;
      cols.forEach((c, k) => { if (!hot[k]) return; if (c[2] >= 0 && tO[c[2]] >= 0) hO.add(tO[c[2]]); if (c[3] >= 0 && tN[c[3]] >= 0) hN.add(tN[c[3]]); });
      cols.forEach((c, k) => { if (!hot[k] && ((c[2] >= 0 && hO.has(tO[c[2]])) || (c[3] >= 0 && hN.has(tN[c[3]])))) { hot[k] = true; grew = true; } });
    }
    if (cols.every((c, k) => hot[k] === (c[0] !== '='))) return segs;
    const out = [], push = (t, s) => { if (!s) return; const g = out[out.length - 1]; if (g && g[0] === t) g[1] += s; else out.push([t, s]); };
    for (let k = 0; k < cols.length;) {
      if (!hot[k]) { push('=', cols[k][1]); k++; continue; }
      let e = k; while (e < cols.length && hot[e]) e++;
      const run = cols.slice(k, e);
      push('-', run.filter(c => c[2] >= 0).map(c => c[1]).join('')); push('+', run.filter(c => c[3] >= 0).map(c => c[1]).join(''));
      k = e;
    }
    return out;
  };
  PC.hunksOf = (ops, A, B) => {
    const out = []; let s = -1, e = -1;
    for (let k = 0; k < ops.length; k++) {
      const t = ops[k][0];
      if (t === '=' || t === '|') {
        if (s >= 0 && (t === '|' || (k + 1 < ops.length && ops[k + 1][0] === '=') || k + 1 === ops.length)) { out.push([s, e]); s = -1; }
        continue;
      }
      if (s < 0) s = k;
      e = k + 1;
    }
    if (s >= 0) out.push([s, e]);
    if (A && B) {
      const digs = ([s, e]) => ops.slice(s, e).some(o => (o[0] === '+' ? PC.DIGC.test(B[o[1]].c) : PC.DIGC.test(A[o[1]].c) || (o.length === 3 && PC.DIGC.test(B[o[2]].c))));
      for (let i = out.length - 2; i >= 0; i--) {
        const mid = ops.slice(out[i][1], out[i + 1][0]);
        if (mid.length <= 6 && mid.every(o => o[0] === '=' && PC.NUMC.test(A[o[1]].c)) && digs(out[i]) && digs(out[i + 1])) out.splice(i, 2, [out[i][0], out[i + 1][1]]);
      }
    }
    return out.map(([s, e]) => ({ s, e, variant: ops.slice(s, e).every(o => o[0] === '~' || o[0] === '=') }));
  };

  // ---- 成果物の書き込み(アタリ・未支給・質問など): ピンクの帯に白抜きの文字、または決まった言い方 ----
  //   img: 成果物の描画、k: pt → 画素の倍率。返り値: 書き込みとみなした字のまとまり(item)の番号の集合
  const NOTE_WORD = /^(アタリ|あたり)\s*[:：]|未支給|ご指示ください|ご指示下さい|要確認|入れますか|差し?替え$|[?？]$/;
  PC.designerNotes = (B, img, k) => {
    const out = new Set(), { w, h, d } = img;
    B.items.forEach((it, idx) => {
      if (NOTE_WORD.test(it.s.trim())) { out.add(idx); return; }
      const m = 1.5, x0 = Math.max(0, Math.floor((it.box[0] - m) * k)), y0 = Math.max(0, Math.floor((it.box[1] - m) * k)), x1 = Math.min(w, Math.ceil((it.box[2] + m) * k)), y1 = Math.min(h, Math.ceil((it.box[3] + m) * k));
      let n = 0, pink = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const j = (y * w + x) * 4, r = d[j], g = d[j + 1], b = d[j + 2]; n++; if (r >= 170 && g <= 110 && b >= 50 && r - g >= 120) pink++; }
      if (n && pink >= 0.35 * n) out.add(idx);
    });
    return out;
  };

  // ---- 原稿の書き込みのうち、指示とみなすもの ----
  //   短い書き込みで指示の言い方を含むもの、または図版の場所を示す言葉だけのもの(成果物に見当たらないときだけ指示とみなす)
  const INSTR = /カエ|替え|後送|共通|のみ|追加|削除|トル|イキ|ママ|変更|差し?替|入れ替|お願い|ください|加工|作成|アタリ|ファイル名|\.(png|jpe?g|psd|ai|pdf|tiff?|eps|gif)\b/i;
  const PLACE = /^(モデル|写真|画像|イメージ|ロゴ|QR|ＱＲ|図|イラスト|地図|表|グラフ)(写真|画像|コード|後送)?$/;
  // 指示の文から、成果物にあるはずの文字(want)・なくなるはずの文字(drop)を取り出す。取り出せなければ null(文字では判定できない)
  //   「A」→「B」、「A」を「B」に変更、「B」に修正、「B」を追加、「A」トル(かぎかっこがなくても、短い文なら同じ形を読む)
  const QT = '[「『"“]([^」』"”]+)[」』"”]', DO = '(?:する|して(?:ください|下さい)?|願います|お願いします)?$';
  const INSTR_RULES = [
    [new RegExp(`^${QT}を?(?:→|⇒|->|＞|>)${QT}`), m => ({ drop: m[1], want: m[2] })],
    [new RegExp(`^${QT}を${QT}に(?:変更|修正|訂正|差し?替え?|直す|直して)?`), m => ({ drop: m[1], want: m[2] })],
    [new RegExp(`^(?:→|⇒)?${QT}に(?:変更|修正|訂正|差し?替え?|統一|直す|直して)`), m => ({ want: m[1] })],
    [new RegExp(`^${QT}を?(?:追加|追記|挿入|入れる|入れて|加える|加えて)`), m => ({ want: m[1] })],
    [new RegExp(`^${QT}を?(?:トル|削除|取る|取って|カット|不要)`), m => ({ drop: m[1] })],
    [/^([^→⇒]{1,30}?)(?:→|⇒|->)([^→⇒]{1,30})$/, m => ({ drop: m[1], want: m[2] })],
    [new RegExp(`^(.{1,30})を(.{1,30}?)に(?:変更|修正|訂正|差し?替え?)${DO}`), m => ({ drop: m[1], want: m[2] })],
    [new RegExp(`^(.{1,30}?)に(?:変更|修正|訂正|差し?替え?|統一)${DO}`), m => ({ want: m[1] })],
    [new RegExp(`^(.{1,30}?)を?(?:追加|追記|挿入)${DO}`), m => ({ want: m[1] })],
    [new RegExp(`^(.{1,30}?)を?(?:トル|削除)${DO}`), m => ({ drop: m[1] })],
  ];
  //   書式・レイアウトの言葉(「太字に変更」の「太字」は、成果物に載る文字ではない)
  PC.LAYOUT_WORD = /太字|細字|書体|ゴシック|明朝|イタリック|斜体|色|サイズ|大きく|小さく|字下げ|改行|追い込み|揃え|そろえ|センター|中央|左寄せ|右寄せ|行間|字間|詰め|アキ|空き|位置|移動|写真|画像|図|トリミング|ルビ|下線|囲み|網/;
  PC.instrTarget = s => {
    const t = String(s || '').replace(/[（(][^）)]*(以下同様|全体|同様)[^）)]*[）)]/g, '').replace(/\s+/g, '');
    for (const [re, f] of INSTR_RULES) {
      const m = t.match(re);
      if (!m) continue;
      const r = f(m), quoted = re.source.startsWith('^' + QT) || re.source.startsWith('^(?:→|⇒)?' + QT);
      if (!quoted && [r.want, r.drop].some(x => x && (PC.LAYOUT_WORD.test(x) || /^(赤|青|黒|白|緑|黄|ピンク|オレンジ|グレー|紺|金|銀)[色字]?$/.test(x)))) return null;
      return r;
    }
    return null;
  };
  PC.isInstr = s => { const t = s.replace(/\s/g, ''); return PLACE.test(t) || ([...t].length <= 24 && INSTR.test(t)); };

  // 位置の手がかりがない原稿(データファイル)のまとまり(段落・表の行)を、候補の成果物ページ(cands: [{ B }]、手がかりの多い順)に振り分ける
  //   まとまりの字のかたまり(2字以上)がそのまま最も多く(半分以上)含まれるページ。どのページにもないまとまりは、前(なければ後ろ)のまとまりと同じページ
  //   返り値: who(まとまりごとに、cands の何番目か)・also(表の見出しの行が、そのまま載っているほかのページ)
  PC.splitFree = (A, blocks, cands) => {
    const ks = cands.map(c => PC.keyStr(c.B.chars, true).s), idxs = ks.map(K => PC.gramIndex(K));
    //   グラフの項目名・値(kind 'chart')は短いため、ほかのページにも同じ字があることが多い。自分の字では決めず、前後のまとまり(表題など)と同じページにする
    const who = blocks.map(([s, e, kind]) => {
      if (kind === 'chart') return -1;
      const byIt = new Map();
      for (let i = s; i < e; i++) { const c = A.chars[i]; if (!byIt.has(c.it)) byIt.set(c.it, []); byIt.get(c.it).push(c); }
      const sc = cands.map(() => 0); let n = 0;
      //   字は4字ずつの並びで数える(直しの入ったまとまりも、直しの前後の並びで振り分けられるように: PC.gramHit)
      for (const cs of byIt.values()) { const k = PC.keyStr(cs, true).s; if ([...k].length < 2) continue; n += k.length; ks.forEach((K, ci) => { sc[ci] += PC.gramHit(k, K, idxs[ci]).n; }); }
      //   字の半分以上が含まれるページだけを数える(「1個」のような短い字が合っただけのページには振り分けない)
      let best = -1; sc.forEach((v, ci) => { if (v >= 0.5 * n && v > 0 && (best < 0 || v > sc[best])) best = ci; });
      return best;
    });
    for (let b = 0; b < who.length; b++) if (who[b] < 0) { let k = b - 1; while (k >= 0 && who[k] < 0) k--; if (k >= 0) who[b] = who[k]; }
    for (let b = who.length - 1; b >= 0; b--) if (who[b] < 0) who[b] = b + 1 < who.length ? who[b + 1] : 0;
    const also = blocks.map(([s, e, , tag], b) => {
      if (tag !== 'head') return [];
      const k = PC.keyStr(A.chars.slice(s, e), true).s;
      return ks.map((K, ci) => (ci !== who[b] && [...k].length >= 2 && K.includes(k) ? ci : -1)).filter(ci => ci >= 0);
    });
    return { who, also };
  };

  // ---- 原稿の1ページ(文字データあり・レイアウトが違う)を、成果物のページと照合する ----
  //   A: 原稿の文字データ、B: 成果物の文字データ、pr: ページの対応(T・範囲)、used: 成果物の字のうち、すでに対応づいたもの(ページの間で共有)
  //   skip: 照合に使わない成果物のまとまり(成果物の書き込み)
  //   返り値 blocks: [{ s, e, ops, instr, found }] (s, e は原稿の字の番号、ops は PC.collate の結果。字の番号はまとまりの中での番号)
  //   A.blocks があれば、まとまりはそれを使う(データファイル: 段落 'para'・表の行 'row')。pr.free(位置の手がかりがない原稿)のときは位置を問わない
  //   A.loose(Excel・CSV): 数字の桁区切りの「,」は、あってもなくても同じとみなす
  //   pr.noInstr: 指示(欄外の書き込み)を見分けない、pr.strict: データファイルと同じく厳しめに対応づける(旧版と成果物を比べるとき)
  PC.collatePage = (A, B, pr, used, skip) => {
    const free = !!pr.free, strict = free || !!pr.strict, T = free ? null : pr.Tt || pr.T, R = pr.region, D = 0.5 * Math.hypot(R[2] - R[0], R[3] - R[1]);
    const Bk = B.chars.map(c => (skip.has(c.it) ? { c: c.c, k: '\uFFFF', box: c.box, it: c.it } : c));   // 書き込みの字は、どの字とも一致しない字に置き換える
    const ctr = B.items.map(it => PC.center(it.box));
    const dist = (p, b) => Math.hypot(Math.max(b[0] - p[0], 0, p[0] - b[2]), Math.max(b[1] - p[1], 0, p[1] - b[3]));
    // まとまりが来るはずの範囲(写した枠を少し広げたもの)から遠いほど、そこから始める手間を大きくする
    //   (字ごとの位置でなだらかに、最大1.5まで: 隣の字との差が、字を1つ足す・替える手間を超えないように)
    const nearFor = box => {
      if (!T) return null;
      const bb = PC.mapBox(T, box), M = 0.08 * D, ex = [bb[0] - M, bb[1] - M, bb[2] + M, bb[3] + M], out = new Float32Array(Bk.length);
      Bk.forEach((c, j) => { out[j] = 1.5 * Math.min(1, dist(PC.center(c.box), ex) / (0.25 * D)); });
      return out;
    };
    // 指示の書き込み(欄外にあることが多く、位置は当てにならない): 対応する範囲の中なら手間なし
    const nearRegion = (() => { const M = 0.1 * D, ex = [R[0] - M, R[1] - M, R[2] + M, R[3] + M], out = new Float32Array(Bk.length); Bk.forEach((c, j) => { out[j] = dist(ctr[c.it], ex) > 0 ? 6 : 0; }); return out; })();
    // 欄外の書き込み: 原稿のうち成果物と位置が対応する範囲の外にあり、成果物と長く一致する文字も少ないまとまり
    //   (段組みを組み替えたデザインでは、本文でも位置の対応から外れるため、長く一致する文字があれば本文とみなす)
    const src = pr.src, inSrc = c => { const [x, y] = PC.center(c.box); return x >= src[0] && x <= src[2] && y >= src[1] && y <= src[3]; };
    const cov = new Uint8Array(A.chars.length);
    const anchors = free ? [] : PC.textAnchors(A.chars, Bk, 6);
    for (const x of anchors) cov.fill(1, x.i, x.i + x.n);
    const blocks = (A.blocks || PC.blocksOf(A.chars, A.items).map(([s, e]) => [s, e, 'para'])).map(([s, e, kind, , , chartsrc]) => {
      const cs = A.chars.slice(s, e), text = cs.map(c => c.c).join('');
      let inside = 0, hit = 0; for (let k = s; k < e; k++) { if (inSrc(A.chars[k])) inside++; if (cov[k]) hit++; }
      return { s, e, cs, text, kind, chartsrc: !!chartsrc, margin: !free && !pr.noInstr && inside < 0.5 * cs.length && hit < 0.5 * cs.length, instr: false, ops: [] };
    });
    // 桁区切りの「,」を除いた並びで対応づけ、字の番号を元に戻す(A.loose のとき)
    const comma = (X, j) => (X[j].k === ',' || X[j].k === '，') && j > 0 && j + 1 < X.length && /\d/.test(X[j - 1].k) && /\d/.test(X[j + 1].k);
    const bmap = A.loose ? Bk.map((_, j) => j).filter(j => !comma(Bk, j)) : null, Bf = bmap ? bmap.map(j => Bk[j]) : Bk;
    // 数字のすぐ前後の通貨の記号(「1,280円」の「円」など)は、まとまりの端にあっても外さない(書き方の違いとして示すため)
    const keepEdge = free ? j => PC.UNIT.test(Bk[j].c) && [j - 1, j + 1].some(t => Bk[t] && Bk[t].it === Bk[j].it && /\d/.test(Bk[t].k)) : null;
    //   対応づいた数字のすぐ前後にある、まだ使われていない通貨の記号も、そのまとまりの字として加える(「1,050」に対する「1,050円」の「円」)
    const units = (ops, u) => {
      if (!free) return ops;
      const has = new Set(ops.flatMap(o => (o.length === 3 ? [o[2]] : o[0] === '+' ? [o[1]] : [])));
      const out = [];
      ops.forEach((o, k) => {
        const dig = o.length === 3 && o[0] !== 'x' && /\d/.test(Bk[o[2]].k), add = t => Bk[t] && Bk[t].it === Bk[o[2]].it && PC.UNIT.test(Bk[t].c) && !u[t] && !has.has(t);
        if (dig && add(o[2] - 1) && !(k > 0 && ops[k - 1].length === 3 && ops[k - 1][2] === o[2] - 1)) { out.push(['+', o[2] - 1]); has.add(o[2] - 1); }
        out.push(o);
        if (dig && add(o[2] + 1)) { out.push(['+', o[2] + 1]); has.add(o[2] + 1); }
      });
      return out;
    };
    //   旧版との比べ合わせ(同じレイアウト。位置の手がかりあり)では、成果物の段落をまたいで続けるときに手間をかける(PC.collate の bseg)
    //   (データファイルの表の行は、成果物ではセルごとの段落に分かれるので使わない)
    const bseg = T && pr.strict ? (() => { const id = new Int32Array(Bk.length).fill(-1); PC.blocksOf(B.chars, B.items).forEach(([s, e], k) => id.fill(k, s, e)); return id; })() : null;
    const coll = (cs, near, u = used) => units(collRaw(cs, near, u), u);
    const collRaw = (cs, near, u) => {
      if (!bmap) return PC.collate(cs, Bk, { jump: 3, near, used: u, strict, keepEdge, bseg });
      const amap = cs.map((_, i) => i).filter(i => !comma(cs, i));
      const ops = PC.collate(amap.map(i => cs[i]), Bf, { jump: 3, near: near ? Float32Array.from(bmap, j => near[j]) : null, used: Uint8Array.from(bmap, j => u[j]), strict, keepEdge: keepEdge && (j => keepEdge(bmap[j])), bseg: bseg && Int32Array.from(bmap, j => bseg[j]) });
      return ops.map(o => (o[0] === '|' ? o : o[0] === '-' ? ['-', amap[o[1]]] : o[0] === '+' ? ['+', bmap[o[1]]] : [o[0], amap[o[1]], bmap[o[2]]]));
    };
    // 表の行: いちばん長く一致した区間の成果物での行(上下に字の高さの1.6倍まで)から外れた所から始める手間を大きくする
    //   (同じ値が別の行にもあるとき、別の行の値に当ててしまい、この行の値の違いを見落とさないように)
    const band = ops => {
      let best = [], cur = [];
      for (const o of [...ops, ['|']]) { if (o[0] === '=' || o[0] === '~') cur.push(o); else { if (cur.length > best.length) best = cur; cur = []; } }
      if (best.length < 2) return null;
      const bs = best.map(o => Bk[o[2]].box), yc = bs.reduce((t, b) => t + (b[1] + b[3]) / 2, 0) / bs.length, hh = Math.max(...bs.map(b => b[3] - b[1]));
      return Float32Array.from(Bk, c => (Math.abs((c.box[1] + c.box[3]) / 2 - yc) <= 1.6 * hh ? 0 : 6));
    };
    const hits = ops => ops.filter(o => o[0] === '=' || o[0] === '~').length;
    //   行の範囲に絞ると一致が2割以上減るとき(表の行と列を入れ替えて組んだときなど)は、絞らない
    const rowColl = (b, ops, u = used) => { if (b.kind !== 'row') return ops; const nb = band(ops); if (!nb) return ops; const o2 = coll(b.cs, nb, u); return hits(o2) >= 0.8 * hits(ops) ? o2 : ops; };
    // 対応づいた成果物の字に印を付け、新しく印を付けた字を返す(指示として扱い直すときは、その字の印だけを外す)
    const mark = ops => { const js = []; for (const o of ops) { const j = o.length === 3 ? o[2] : o[0] === '+' ? o[1] : -1; if (j >= 0 && !used[j]) { used[j] = 1; js.push(j); } } return js; };
    const byLen = xs => xs.slice().sort((x, y) => (y.e - y.s) - (x.e - x.s) || x.s - y.s);
    // 短い区間(同じ字だけ、12字まで)が、同じ文字の並びが成果物に何か所もあるうちの離れた所に当たっていたら、
    // まだ使われていない同じ並びのうち、前後の区間に近いものへ移す(見出しと本文に同じ語がある場合など)
    const reanchor = (ops, cs) => {
      const segs = [[]];
      ops.forEach((o, k) => { if (o[0] === '|') segs.push([]); else segs[segs.length - 1].push(k); });
      segs.forEach((ks, s) => {
        const os = ks.map(k => ops[k]);
        if (!os.length || os.length > 12 || !os.every(o => o[0] === '=' || o[0] === '~')) return;
        const nb = [], prev = s > 0 && segs[s - 1].map(k => ops[k]).filter(o => o.length === 3).pop(), next = s + 1 < segs.length && segs[s + 1].map(k => ops[k]).find(o => o.length === 3);
        if (prev) nb.push(Bk[prev[2]].box); if (next) nb.push(Bk[next[2]].box);
        if (!nb.length) return;
        const d = j => Math.min(...nb.map(b => PC.gap(Bk[j].box, b))), j0 = os[0][2], L = os.length;
        let best = j0, bd = d(j0);
        for (let j = 0; j + L <= Bk.length; j++) {
          if (j === j0) continue;
          let ok = true; for (let t = 0; t < L && ok; t++) ok = Bk[j + t].k === Bk[j0 + t].k && !used[j + t];
          if (ok) { const dj = d(j); if (dj < 0.7 * bd) { bd = dj; best = j; } }
        }
        if (best !== j0) for (const k of ks) { const o = ops[k], j = o[2] + best - j0; ops[k] = [cs[o[1]].c === Bk[j].c ? '=' : '~', o[1], j]; }
      });
    };
    // 1) 本文(欄外でないまとまり): 長いものから、まだ対応づいていない成果物の字に当てる
    //   位置の手がかりがない原稿は、まず全部を(印を付けずに)当ててみて、よく一致したまとまりから決める
    //   (成果物に載っていない表の行が、似た別の行の字を先に取ってしまわないように)
    let order = byLen(blocks.filter(b => !b.margin));
    //   グラフの項目名・値(kind 'chart')があるページは、表の行を最後に当てる(ほかは長い順)
    //   (表の行(「4月 120」)が、グラフの棒の下の「4月」と隣の棒の上の「180」に当たってしまわないように)
    if (order.some(b => b.kind === 'chart')) { const rank = b => (b.kind === 'row' ? 1 : 0); order = order.slice().sort((x, y) => rank(x) - rank(y) || (y.e - y.s) - (x.e - x.s) || x.s - y.s); }
    else if (free) {
      const rate = new Map();
      for (const b of order) rate.set(b, hits(rowColl(b, coll(b.cs, null))) / b.cs.length);
      order = order.slice().sort((x, y) => rate.get(y) - rate.get(x) || (y.e - y.s) - (x.e - x.s) || x.s - y.s);
    }
    //   旧版との比べ合わせ(同じレイアウト。位置の手がかりあり): 写した位置のすぐ近くで6字以上そのまま一致する所は、そのまとまりのものとして押さえ、
    //   ほかのまとまりには使わせない(消えた行の字が、離れた所の同じ字の並び(表の中の商品名など)を取ってしまわないように)
    const own = T && pr.strict ? new Int32Array(Bk.length).fill(-1) : null;
    if (own) {
      const blockAt = new Int32Array(A.chars.length).fill(-1); blocks.forEach((b, bi) => blockAt.fill(bi, b.s, b.e));
      //   押さえるのは、写した位置に重なる(ずれが字の高さの3割まで)ものだけ(隣の行の同じ並び(表の日付の列など)は押さえない)
      for (const x of anchors) {
        if (x.n < 6 || blockAt[x.i] < 0) continue;
        const a = PC.mapBox(T, PC.union(A.chars.slice(x.i, x.i + x.n).map(c => c.box))), bb = PC.union(Bk.slice(x.j, x.j + x.n).map(c => c.box));
        if (PC.gap(a, bb) > 0.3 * Math.max(4, bb[3] - bb[1])) continue;
        for (let t = 0; t < x.n; t++) if (own[x.j + t] < 0 && blockAt[x.i + t] >= 0) own[x.j + t] = blockAt[x.i + t];   // 字ごとに、その字のまとまりのものとする
      }
    }
    const usedFor = b => { if (!own) return used; const bi = blocks.indexOf(b); return Uint8Array.from(used, (v, j) => (v || (own[j] >= 0 && own[j] !== bi) ? 1 : 0)); };
    for (const b of order) {
      const u = usedFor(b);
      b.ops = coll(b.cs, nearFor(PC.union(b.cs.map(c => c.box))), u);
      b.ops = rowColl(b, b.ops, u);
      reanchor(b.ops, b.cs);
      const low = hits(b.ops) < 0.5 * b.cs.length;
      // 成果物に見当たらない短い書き込みで、指示の言い方のもの → 指示として扱い直す
      if (low && b.kind !== 'row' && !pr.noInstr && PC.isInstr(b.text)) { b.instr = true; continue; }
      // データファイルの原稿: 半分も一致しないまとまりは、成果物に載っていないとみなす(似た別の行・文の字を取らないように)
      if (low && strict) { b.ops = b.cs.map((_, i) => ['-', i]); continue; }
      mark(b.ops);
    }
    // 2) 指示(欄外の書き込み・指示の言い方の書き込み): 残りの成果物の字から探す(新しく入れる文の指示なら、成果物にあるはず)
    for (const b of byLen(blocks.filter(b => b.margin || b.instr))) {
      b.instr = true;
      b.ops = coll(b.cs, nearRegion);
      b.found = hits(b.ops) / b.cs.length;
      if (b.found >= 0.8) mark(b.ops);
    }
    return blocks.map(({ s, e, ops, instr, found, text, kind, chartsrc }) => ({ s, e, ops, instr, found, text, kind, chartsrc }));
  };
})();
