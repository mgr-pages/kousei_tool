// 赤字の取得と解釈: 注釈の描画差分 → 赤字マスク → 指示箇所(アンカー)と引き出し線・注記の切り分け(紙のスキャンの赤字は scan.js で取り出す)
'use strict';
(function () {
  const { morph } = PC;
  PC.MARKUP = new Set(['StrikeOut', 'Underline', 'Squiggly', 'Highlight']);

  // 赤い画素(HSVの色相が赤、彩度・明度が一定以上)
  PC.redMask = img => {
    const src = cv.matFromImageData(new ImageData(new Uint8ClampedArray(img.d), img.w, img.h)), rgb = new cv.Mat(), hsv = new cv.Mat();
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB); cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
    const n = img.w * img.h, out = new Uint8Array(n), d = hsv.data;
    for (let i = 0, j = 0; i < n; i++, j += 3) {
      const H = d[j], S = d[j + 1], V = d[j + 2];
      out[i] = S >= 90 && V >= 90 && (H <= 10 || (H >= 165 && H <= 180)) ? 255 : 0;
    }
    src.delete(); rgb.delete(); hsv.delete();
    return out;
  };

  // デジタル: 注釈あり/なしで描画した差分が朱入れ。挿入(Caret)注釈は位置情報から直接読むため描画からは除く
  PC.fromAnnots = (withA, without, notes) => {
    const n = withA.w * withA.h, rm = new Uint8Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) rm[i] = Math.max(Math.abs(withA.d[j] - without.d[j]), Math.abs(withA.d[j + 1] - without.d[j + 1]), Math.abs(withA.d[j + 2] - without.d[j + 2])) > 40 ? 255 : 0;
    // 挿入・取り消し線・下線・マーカーの注釈は、位置情報から直接読むため描画からは除く
    const clear = ([x0, y0, x1, y1]) => { for (let y = Math.max(0, Math.round(y0) - 3); y < Math.min(withA.h, Math.round(y1) + 3); y++) for (let x = Math.max(0, Math.round(x0) - 3); x < Math.min(withA.w, Math.round(x1) + 3); x++) rm[y * withA.w + x] = 0; };
    for (const nt of notes) { if (nt.type === 'Caret') clear(nt.box); else if (PC.MARKUP.has(nt.type) && nt.quads.length) nt.quads.forEach(clear); }
    return { rm, shown: withA };
  };

  // 赤字から「どこを指しているか」を取り出す。引き出し線(行を突き抜けるだけの線・行間を走る線)は指示とみなさない
  PC.anchors = (rm, W, H, lines, toks, iblocks) => {
    const used = new Uint8Array(W * H), out = [];
    const center = t => [Math.floor((t.box[0] + t.box[2]) / 2), Math.floor((t.box[1] + t.box[3]) / 2)];
    // 1) 囲み: 閉じた赤線の内側にある文字・画像
    const closed = morph(rm, W, H, 'close', 5, 5), cm = PC.toMat(closed, W, H), cnts = new cv.MatVector(), hier = new cv.Mat();
    cv.findContours(cm, cnts, hier, cv.RETR_CCOMP, cv.CHAIN_APPROX_NONE);
    for (let i = 0; i < cnts.size(); i++) {
      const par = hier.intPtr(0, i)[3], c = cnts.get(i);
      if (par < 0 || cv.contourArea(c) < 400) { c.delete(); continue; }
      const hm = cv.Mat.zeros(H, W, cv.CV_8UC1); cv.drawContours(hm, cnts, i, new cv.Scalar(255), -1);
      const hole = PC.fromMat(hm); hm.delete();
      const br = cv.boundingRect(c); c.delete();
      const ring = morph(hole, W, H, 'dilate', 15, 15), er = morph(hole, W, H, 'erode', 7, 7);
      for (let k = 0; k < ring.length; k++) ring[k] = ring[k] && !er[k] && rm[k] ? 255 : 0;
      const inside = new Set(); toks.forEach((t, k) => { const [cx, cy] = center(t); if (hole[cy * W + cx]) inside.add(k); });
      const box = [br.x, br.y, br.x + br.width, br.y + br.height];
      if (inside.size) { out.push({ kind: 'tokens', toks: inside, how: '囲み', box }); for (let k = 0; k < ring.length; k++) if (ring[k]) used[k] = 255; }
      let hn = 0; for (const v of hole) if (v) hn++;
      for (const b of iblocks) {
        let o = 0; for (let y = b.box[1]; y < b.box[3]; y++) for (let x = b.box[0]; x < b.box[2]; x++) if (hole[y * W + x]) o++;
        if (o > 0.5 * hn) { out.push({ kind: 'image', how: '囲み', box }); for (let k = 0; k < ring.length; k++) if (ring[k]) used[k] = 255; }
      }
    }
    cm.delete(); cnts.delete(); hier.delete();
    const free = new Uint8Array(rm); for (let k = 0; k < free.length; k++) if (used[k]) free[k] = 0;

    // 2) 行の上の赤: 行を突き抜けるだけの線は除き、文字の中央を通る線・書き込みを指示とみなす
    const reach = (x0, y0, x1, y1, vertAxis, rev) => {   // 窓の中の赤が、行の端からどこまで伸びているか
      x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W, x1); y1 = Math.min(H, y1);
      const len = vertAxis ? y1 - y0 : x1 - x0; let mn = Infinity, mx = -1;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (free[y * W + x]) { const v = vertAxis ? y - y0 : x - x0; if (v < mn) mn = v; if (v > mx) mx = v; }
      if (mx < 0) return 0;
      return rev ? len - mn : mx + 1;
    };
    for (const [li, l] of lines.entries()) {
      const [x0, y0, x1, y1] = l.box, v = l.vert, xs0 = Math.max(0, x0 - 5);
      const reg = PC.sub(free, W, xs0, y0, x1 + 5, y1, H), cc = PC.cc(reg.a, reg.w, reg.h), h = v ? x1 - x0 : y1 - y0;
      for (let j = 1; j < cc.n; j++) {
        const { xs, ys } = PC.pixelsOf(cc.lab, reg.w, j, cc.st[j]), gx = xs.map(x => x + xs0), gy = ys.map(y => y + y0);
        const gxMin = Math.min(...gx), gxMax = Math.max(...gx), gyMin = Math.min(...gy), gyMax = Math.max(...gy);
        let aMin, aMax, cExt;
        if (v) { aMin = gxMin <= x0; aMax = gxMax >= x1 - 1; cExt = gyMax - gyMin; }
        else { aMin = gyMin === y0; aMax = gyMax === y1 - 1; cExt = gxMax - gxMin; }
        if (aMin && aMax && cExt <= 1.5 * h) {   // 両側へ長く伸びていれば「突き抜けるだけの引き出し線」
          const e = Math.floor(0.8 * h); let s1, s2;
          if (v) { s1 = reach(x0 - e, gyMin - h, x0, gyMax + h, false, true); s2 = reach(x1, gyMin - h, x1 + e, gyMax + h, false, false); }
          else { s1 = reach(gxMin - h, y0 - e, gxMax + h, y0, true, true); s2 = reach(gxMin - h, y1, gxMax + h, y1 + e, true, false); }
          if (s1 > 0.6 * h && s2 > 0.6 * h) continue;
        }
        // 行の中央から外れた位置(字の上端・下端付近)を通る細い線は、取り消し線ではなく引き出し線とみなす
        const thin = v ? gxMax - gxMin + 1 : gyMax - gyMin + 1, midOff = v ? (gx.reduce((p, q) => p + q, 0) / gx.length - (x0 + x1) / 2) : (gy.reduce((p, q) => p + q, 0) / gy.length - (y0 + y1) / 2);
        if (thin <= 0.25 * h && cExt > h && Math.abs(midOff) > 0.2 * h) continue;
        const hit = new Set(), tol = cExt <= 0.6 * h ? Math.floor(0.3 * h) : 0;
        // 短い斜線(1〜2字を斜めに消す線)は、字の端をかすめても当たるよう、行の幅いっぱいで判定する
        const across = v ? gxMax - gxMin + 1 : gyMax - gyMin + 1, slash = across >= 0.5 * h && cExt <= 3 * h, lo = slash ? 0 : 0.2, hi = slash ? 1 : 0.8;
        for (const k of l.toks) {
          const [tx0, ty0, tx1, ty1] = toks[k].box; let r0, r1, c0, c1;
          if (v) { r0 = Math.max(0, ty0 - y0 - tol); r1 = ty1 - y0 + tol; c0 = Math.trunc(tx0 - xs0 + lo * (tx1 - tx0)); c1 = Math.trunc(tx0 - xs0 + hi * (tx1 - tx0)); }
          else { r0 = Math.trunc(lo * h); r1 = Math.trunc(hi * h); c0 = Math.max(0, tx0 - xs0 - tol); c1 = tx1 - xs0 + tol; }
          r1 = Math.min(r1, reg.h); c1 = Math.min(c1, reg.w); let cnt = 0;
          for (let y = r0; y < r1 && cnt < 3; y++) for (let x = Math.max(0, c0); x < c1; x++) if (cc.lab[y * reg.w + x] === j) cnt++;
          if (cnt >= 3) hit.add(k);
        }
        if (hit.size) {
          // 細い線は、同じ行で途切れた続きとまとめ、まとめて行のほぼ全長にわたれば引き出し線の可能性として示すため、行と長さを記録しておく
          out.push({ kind: 'tokens', toks: hit, how: '取消線・書込み', box: [gxMin, gyMin, gxMax, gyMax], thin: thin <= 0.25 * h, li, vert: v, span: v ? y1 - y0 : x1 - x0, h });
          for (let q = 0; q < gx.length; q++) used[gy[q] * W + gx[q]] = 255;
        }
      }
    }
    for (let k = 0; k < free.length; k++) if (used[k]) free[k] = 0;

    // 3) 挿入記号(くさび): 行のすぐ下の「Λ」、または行のすぐ上の「V」
    const apexes = (reg, rw, rh, h) => {   // 上側の輪郭から、左右とも下がっている頂点を探し、下へ2本の線が開いていくもの
      const res = [], cc = PC.cc(reg, rw, rh);
      for (let j = 1; j < cc.n; j++) {
        const { xs, ys } = PC.pixelsOf(cc.lab, rw, j, cc.st[j]);
        if (cc.st[j].y1 - cc.st[j].y0 < 0.25 * h) continue;
        const xmax = cc.st[j].x1, top = new Array(xmax + 12).fill(1e6);
        for (let q = 0; q < xs.length; q++) if (ys[q] < top[xs[q]]) top[xs[q]] = ys[q];
        let doneX = -100;
        const ux = [...new Set(xs)].sort((a, b) => a - b);
        for (const ax of ux) {
          const ay = top[ax], L = top.slice(Math.max(0, ax - 10), ax), R = top.slice(ax + 1, ax + 11);
          if (ax - doneX < 12 || L.length < 5 || R.length < 5 || ay > Math.min(...L, ...R)) continue;
          const lv = L.filter(t => t < 1e6), rv = R.filter(t => t < 1e6);
          if (lv.length < 4 || rv.length < 4 || !(lv[0] > ay + 0.15 * h && rv[rv.length - 1] > ay + 0.15 * h)) continue;
          const spread = [];   // 頂点の左右にある最も内側の点どうしの間隔が、下へ行くほど広がるか(線の途切れには影響されない)
          let inner = 0;        // 頂点の真下(2本の腕の内側)に線がある字(「木」など)は除く
          for (const dy of [Math.trunc(0.25 * h), Math.trunc(0.35 * h), Math.trunc(0.45 * h)]) {
            let lmax = -Infinity, rmin = Infinity, lf = false, rf = false;
            for (let q = 0; q < xs.length; q++) {
              if (ys[q] < ay + dy - 1 || ys[q] > ay + dy + 1 || Math.abs(xs[q] - ax) >= h) continue;
              if (xs[q] < ax - 1) { lf = true; lmax = Math.max(lmax, xs[q]); }
              else if (xs[q] > ax + 1) { rf = true; rmin = Math.min(rmin, xs[q]); }
              else if (dy >= Math.trunc(0.35 * h)) inner++;
            }
            spread.push(lf && rf ? rmin - lmax : -1);
          }
          if (inner) continue;
          const ok = spread.filter(g => g > 0);
          let sorted = true; for (let q = 1; q < ok.length; q++) if (ok[q] < ok[q - 1]) sorted = false;
          if (ok.length >= 2 && sorted && ok[ok.length - 1] >= ok[0] + 3 && ok[ok.length - 1] >= 8) { res.push([ax, ay]); doneX = ax; }
        }
      }
      return res;
    };
    for (const l of lines.filter(l => !l.vert)) {
      const [x0, y0, x1, y1] = l.box, h = y1 - y0, xa = Math.max(0, x0 - h);   // 行頭・行末の挿入のため左右に1字分広げる
      const below = [y1 - Math.trunc(0.15 * h), y1 + Math.trunc(0.9 * h)], above = [Math.max(0, y0 - Math.trunc(0.9 * h)), y0 + Math.trunc(0.15 * h)];
      const rb = PC.sub(free, W, xa, below[0], x1 + h, below[1], H), found = apexes(rb.a, rb.w, rb.h, h).map(([ax, ay]) => [ax, below[0] + ay]);
      const ra = PC.sub(free, W, xa, above[0], x1 + h, above[1], H), fl = new Uint8Array(ra.a.length);
      for (let y = 0; y < ra.h; y++) fl.set(ra.a.subarray(y * ra.w, (y + 1) * ra.w), (ra.h - 1 - y) * ra.w);   // 上下反転して同じ方法で探す
      for (const [ax, ay] of apexes(fl, ra.w, ra.h, h)) found.push([ax, above[0] + ra.h - 1 - ay]);
      for (const [ax, gy] of found) {
        const gx = ax + xa;
        let k = l.toks.find(k => (toks[k].box[0] + toks[k].box[2]) / 2 > gx); if (k === undefined) k = l.toks[l.toks.length - 1] + 1;
        out.push({ kind: 'insert', at: k, how: '挿入記号', box: [gx - 12, gy - 10, gx + 12, gy + 10] });
      }
    }
    // 4) 画像の上の赤(囲み以外): 縁を突き抜ける・縁から入るだけの細い線は除く
    for (const b of iblocks) {
      const [x0, y0, x1, y1] = b.box, reg = PC.sub(free, W, x0, y0, x1, y1, H), cc = PC.cc(reg.a, reg.w, reg.h);
      for (let j = 1; j < cc.n; j++) {
        const s = cc.st[j], w = s.x1 - s.x0 + 1, h = s.y1 - s.y0 + 1;
        const edges = (s.x0 === 0) + (s.y0 === 0) + (s.x0 + w >= x1 - x0) + (s.y0 + h >= y1 - y0);
        if (edges >= 1 && s.area / Math.hypot(w, h) < 6) continue;
        if (s.area > 60) out.push({ kind: 'image', how: '書込み', box: [x0 + s.x0, y0 + s.y0, x0 + s.x0 + w, y0 + s.y0 + h] });
      }
    }
    // 一続きの赤字の番号(同じ赤字が隣の字にかかっているかの判定に使う)
    const sc = PC.cc(morph(rm, W, H, 'dilate', 5, 5), W, H);
    for (const a of out) {
      const [x0, y0, x1, y1] = a.box.map(v => Math.trunc(v)), cnt = new Map();
      for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) { const l = sc.lab[y * W + x]; if (l) cnt.set(l, (cnt.get(l) || 0) + 1); }
      let best = -1, bc = 0; for (const [l, c] of [...cnt.entries()].sort((p, q) => p[0] - q[0])) if (c > bc) { bc = c; best = l; }
      a.stroke = best;
    }
    return { an: out, used };
  };
})();
