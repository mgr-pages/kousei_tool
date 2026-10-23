// 見た目(画像)で変更箇所を検出する: ブロック分割 → 読み順 → 行 → 字形の切り出し → 字形の照合 → 並びの比較
'use strict';
(function () {
  const { median, runs, rowSums, colSums, morph } = PC;

  // 表の罫線・枠線など、細くて長い線だけを取り出す
  function ruleLines(ink, w, h) {
    const hl = morph(ink, w, h, 'open', 120, 1), vl = morph(ink, w, h, 'open', 1, 120);
    const thick = morph(morph(ink, w, h, 'open', 9, 9), w, h, 'dilate', 5, 5);
    const out = new Uint8Array(w * h);
    for (let i = 0; i < out.length; i++) out[i] = (hl[i] || vl[i]) && !thick[i] ? 1 : 0;
    return out;
  }
  // 罫線を除いたインク
  PC.textInk = img => {
    const { w, h } = img, ink = PC.inkMask(img), rl = morph(ruleLines(ink, w, h), w, h, 'dilate', 3, 3);
    for (let i = 0; i < ink.length; i++) if (rl[i]) ink[i] = 0;
    return ink;
  };

  PC.blocks = (img, ink) => {
    const { w, h } = img, dil = morph(ink, w, h, 'dilate', 41, 31), cc = PC.cc(dil, w, h), out = [];
    for (let i = 1; i < cc.n; i++) {
      const s = cc.st[i], bw = s.x1 - s.x0 + 1, bh = s.y1 - s.y0 + 1;
      const sub = new Uint8Array(bw * bh); let any = false, tx0 = 1e9, ty0 = 1e9, tx1 = -1, ty1 = -1;
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const gi = (s.y0 + y) * w + s.x0 + x;
        if (ink[gi] && cc.lab[gi] === i) { sub[y * bw + x] = 1; any = true; if (x < tx0) tx0 = x; if (x > tx1) tx1 = x; if (y < ty0) ty0 = y; if (y > ty1) ty1 = y; }
      }
      if (!any) continue;
      const sc = PC.cc(sub, bw, bh); let largest = 0;
      for (let j = 1; j < sc.n; j++) { const t = sc.st[j]; largest = Math.max(largest, (t.x1 - t.x0 + 1) * (t.y1 - t.y0 + 1)); }
      const tw = tx1 - tx0 + 1, th = ty1 - ty0 + 1;
      let kind;
      if (Math.min(tw, th) <= 6) kind = 'rule';
      else if (largest > 0.3 * bw * bh) kind = 'image';
      else {   // 何も書かれていない行・列の割合で、横組みか縦組みかを決める
        const rs = rowSums(sub, bw, bh), cs = colSums(sub, bw, bh);
        const zr = rs.filter(v => v === 0).length / bh, zc = cs.filter(v => v === 0).length / bw;
        if (zr > zc + 0.08) kind = 'htext';
        else if (zc > zr + 0.08) kind = 'vtext';
        else kind = th > 1.5 * tw ? 'vtext' : 'htext';
      }
      out.push({ box: [s.x0, s.y0, s.x0 + bw, s.y0 + bh], kind });
    }
    // 縦組みの段落の最終行のように短い列は、上端がそろう縦組みの列があれば縦組みとみなす
    const vw = out.filter(b => b.kind === 'vtext').map(b => b.box[2] - b.box[0]);
    if (vw.length) {
      const mw = median(vw);
      for (const b of out) if (b.kind === 'htext' && b.box[2] - b.box[0] <= 1.3 * mw && out.some(c => c.kind === 'vtext' && Math.abs(b.box[1] - c.box[1]) < 40)) b.kind = 'vtext';
    }
    return out;
  };

  // 読み順: 上下・左右のうち、いちばん広いすき間で切り分けることを繰り返す(縦組みは左右を右から)
  function xycut(bs, rtl, gap = 8) {
    if (bs.length <= 1) return [...bs];
    let best = null;
    for (const axis of [1, 0]) {
      const iv = bs.map(b => [b.box[axis], b.box[axis + 2]]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
      let end = iv[0][1];
      for (const [a0, a1] of iv.slice(1)) {
        if (a0 - end >= gap && (!best || a0 - end > best[0])) best = [a0 - end, axis, (end + a0) / 2];
        end = Math.max(end, a1);
      }
    }
    if (!best) return [...bs].sort(rtl ? (p, q) => (q.box[2] - p.box[2]) || (p.box[1] - q.box[1]) : (p, q) => (p.box[1] - q.box[1]) || (p.box[0] - q.box[0]));
    const [, axis, c] = best;
    let g1 = bs.filter(b => (b.box[axis] + b.box[axis + 2]) / 2 <= c), g2 = bs.filter(b => (b.box[axis] + b.box[axis + 2]) / 2 > c);
    if (axis === 0 && rtl) [g1, g2] = [g2, g1];
    return [...xycut(g1, rtl, gap), ...xycut(g2, rtl, gap)];
  }

  // 隙間が小さく、まとめても1文字幅程度に収まる断片を1つの字形にまとめる
  function group(parts, em) {
    const out = [];
    for (const p of parts) {
      const q = out[out.length - 1];
      if (q && p[0] - q[1] <= 0.3 * em && p[1] - q[0] <= 1.05 * em) q[1] = p[1]; else out.push([p[0], p[1]]);
    }
    return out;
  }

  // テキストブロックを行に分け、字形の単位(トークン)を読み順に並べる
  PC.tokens = (img, ink, blks) => {
    const W = img.w, toks = [], lines = [];
    const hB = xycut(blks.filter(b => b.kind === 'htext'), false), vB = xycut(blks.filter(b => b.kind === 'vtext'), true);
    for (const b of [...hB, ...vB]) {
      const [x0, y0, x1, y1] = b.box, vert = b.kind === 'vtext', bw = x1 - x0, bh = y1 - y0;
      const sub = PC.sub(ink, W, x0, y0, x1, y1).a;
      let bands = runs(vert ? colSums(sub, bw, bh).reverse() : rowSums(sub, bw, bh), 3);
      if (bands.length > 1) {   // 細すぎる帯(字の一部)は隣とまとめる
        const med = median(bands.map(([p, q]) => q - p)), mb = [bands[0].slice()];
        for (const [b0, b1] of bands.slice(1)) {
          const pr = mb[mb.length - 1];
          if ((b1 - b0 < 0.5 * med || pr[1] - pr[0] < 0.5 * med) && b0 - pr[1] < 0.5 * med && b1 - pr[0] < 1.4 * med) pr[1] = b1; else mb.push([b0, b1]);
        }
        bands = mb;
      }
      for (const [a0, a1] of bands) {
        let lb, parts, c0, c1, band, bandW, bandH;
        if (vert) {
          c0 = x1 - a1 - x0; c1 = x1 - a0 - x0; bandW = c1 - c0; bandH = bh;
          band = PC.sub(sub, bw, c0, 0, c1, bh).a; parts = group(runs(rowSums(band, bandW, bandH), 0), c1 - c0);
          lb = [x0 + c0, y0, x0 + c1, y1];
        } else {
          bandW = bw; bandH = a1 - a0; band = PC.sub(sub, bw, 0, a0, bw, a1).a;
          parts = group(runs(colSums(band, bandW, bandH), 0), a1 - a0); lb = [x0, y0 + a0, x1, y0 + a1];
        }
        const li = lines.length; lines.push({ box: lb, vert, toks: [], blk: [x0, y0, x1, y1] });
        for (const [p0, p1] of parts) {
          let tb;
          if (vert) {
            const seg = PC.sub(band, bandW, 0, p0, bandW, p1).a, cs = runs(colSums(seg, bandW, p1 - p0), 0);
            tb = [x0 + c0 + cs[0][0], y0 + p0, x0 + c0 + cs[cs.length - 1][1], y0 + p1];
          } else {
            const seg = PC.sub(band, bandW, p0, 0, p1, bandH).a, rs = runs(rowSums(seg, p1 - p0, bandH), 0);
            tb = [x0 + p0, y0 + a0 + rs[0][0], x0 + p1, y0 + a0 + rs[rs.length - 1][1]];
          }
          lines[li].toks.push(toks.length); toks.push({ box: tb, line: li });
        }
      }
    }
    // 同じ段に並ぶ行
    const colGroup = l => {
      const bx = l.box;
      if (l.vert) return lines.filter(m => m.vert && m.toks.length && Math.min(m.box[3], bx[3]) - Math.max(m.box[1], bx[1]) > 0.5 * Math.min(m.box[3] - m.box[1], bx[3] - bx[1]) && Math.abs(m.box[0] - bx[0]) < 600);
      return lines.filter(m => !m.vert && m.toks.length && Math.min(m.box[2], bx[2]) - Math.max(m.box[0], bx[0]) > 0.5 * Math.min(m.box[2] - m.box[0], bx[2] - bx[0]));
    };
    for (const l of lines) if (l.toks.length) l.mid = median(l.toks.map(k => l.vert ? (toks[k].box[0] + toks[k].box[2]) / 2 : (toks[k].box[1] + toks[k].box[3]) / 2));
    const first = m => toks[m.toks[0]].box[m.vert ? 1 : 0];
    for (const l of lines) {   // 段落の先頭: 段の行頭位置の中央値から0.5字以上下がっている(字下げ)
      if (!l.toks.length) { l.para = false; continue; }
      const g = colGroup(l), base = g.length >= 3 ? median(g.map(first)) : Math.min(...g.map(first));
      const em = median(g.map(m => m.vert ? m.box[2] - m.box[0] : m.box[3] - m.box[1]));
      l.para = first(l) - base > 0.5 * em;
    }
    return { toks, lines };
  };

  // ---- 字形どうしの見た目の差: 0.33画素刻みで位置を合わせ、5×5の範囲で平均した差の最大値をとる ----
  const SH = [0, -1 / 3, 1 / 3, -2 / 3, 2 / 3, -1, 1];
  function place(g, gw, gh, W, H, dx, dy) {
    const c = new Float32Array(W * H).fill(255), oy = (H - gh) >> 1, ox = (W - gw) >> 1;
    if (!dx && !dy) { for (let y = 0; y < gh; y++) c.set(g.subarray(y * gw, y * gw + gw), (oy + y) * W + ox); return c; }
    // 平行移動(双線形補間、範囲外は白)
    const at = (x, y) => (x < ox || y < oy || x >= ox + gw || y >= oy + gh) ? 255 : g[(y - oy) * gw + (x - ox)];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const sx = x - dx, sy = y - dy, fx = Math.floor(sx), fy = Math.floor(sy), ax = sx - fx, ay = sy - fy;
      c[y * W + x] = (1 - ay) * ((1 - ax) * at(fx, fy) + ax * at(fx + 1, fy)) + ay * ((1 - ax) * at(fx, fy + 1) + ax * at(fx + 1, fy + 1));
    }
    return c;
  }
  const r101 = (i, n) => (n === 1 ? 0 : i < 0 ? -i : i >= n ? 2 * n - 2 - i : i);
  function blurMax(d, W, H) {   // 5×5の平均(端は鏡映)の最大値
    const t = new Float32Array(W * H); let mx = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0; for (let k = -2; k <= 2; k++) s += d[y * W + r101(x + k, W)]; t[y * W + x] = s; }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0; for (let k = -2; k <= 2; k++) s += t[r101(y + k, H) * W + x]; s /= 25; if (s > mx) mx = s; }
    return mx;
  }
  // tol未満の位置合わせが見つかった時点で打ち切る(判定には「tol未満か」だけを使う)
  PC.localDiff = (a, b, tol = 0) => {
    const H = Math.max(a.h, b.h) + 6, W = Math.max(a.w, b.w) + 6, A = place(a.d, a.w, a.h, W, H, 0, 0), d = new Float32Array(W * H);
    let best = 1e9;
    for (const dy of SH) for (const dx of SH) {
      const B = place(b.d, b.w, b.h, W, H, dx, dy);
      for (let i = 0; i < d.length; i++) d[i] = Math.abs(A[i] - B[i]);
      const v = blurMax(d, W, H);
      if (v < best) best = v;
      if (best < tol) return best;
    }
    return best;
  };

  // 面積平均による縮小(8×8の粗い形)
  function resizeArea(g, w, h, ow, oh) {
    const out = new Float32Array(ow * oh), sx = w / ow, sy = h / oh;
    for (let oy = 0; oy < oh; oy++) for (let ox = 0; ox < ow; ox++) {
      const xa = ox * sx, xb = xa + sx, ya = oy * sy, yb = ya + sy; let s = 0, wsum = 0;
      for (let y = Math.floor(ya); y < Math.min(h, Math.ceil(yb)); y++) {
        const wy = Math.min(yb, y + 1) - Math.max(ya, y);
        for (let x = Math.floor(xa); x < Math.min(w, Math.ceil(xb)); x++) { const wx = Math.min(xb, x + 1) - Math.max(xa, x); s += g[y * w + x] * wx * wy; wsum += wx * wy; }
      }
      out[oy * ow + ox] = wsum ? s / wsum : 255;
    }
    return out;
  }

  // 見た目が同じ字形に同じ番号を振る(形・色・太さ・行の中での位置で比べる)
  PC.Codebook = class {
    constructor(tol = 75) { this.protos = []; this.tol = tol; }
    id(img, t, line) {
      const [x0, y0, x1, y1] = t.box, c = PC.crop(img, x0, y0, x1, y1), w = c.w, h = c.h, n = w * h, g = PC.gray(c);
      let gmin = 255, cr = 0, cg = 0, cb = 0, cnt = 0;
      for (let i = 0; i < n; i++) {
        if (g[i] < gmin) gmin = g[i];
        const r = c.d[i * 4], gg = c.d[i * 4 + 1], bb = c.d[i * 4 + 2];
        if (255 - Math.min(r, gg, bb) > 50) { cr += r; cg += gg; cb += bb; cnt++; }
      }
      const col = cnt ? [cr / cnt, cg / cnt, cb / cnt] : [0, 0, 0];
      const off = line.vert ? (x0 + x1) / 2 - line.mid : (y0 + y1) / 2 - line.mid;
      const norm = new Float32Array(n), den = Math.max(1, 255 - gmin); let inkq = 0;
      for (let i = 0; i < n; i++) { const cov = Math.min(1, Math.max(0, (255 - g[i]) / den)); norm[i] = 255 - 255 * cov; inkq += cov; }
      const small = resizeArea(norm, w, h, 8, 8), me = { h, w, off, col, norm: { d: norm, w, h }, small, ink: inkq };
      for (let i = 0; i < this.protos.length; i++) {
        const p = this.protos[i];
        if (Math.abs(p.h - h) > 2 || Math.abs(p.w - w) > 2 || Math.abs(p.off - off) > 3) continue;
        let sd = 0; for (let k = 0; k < 64; k++) sd += Math.abs(p.small[k] - small[k]);
        if (sd / 64 > 40) continue;
        if (Math.max(...p.col.map((v, k) => Math.abs(v - col[k]))) > 40) continue;
        if (Math.abs(p.ink - inkq) > 0.15 * Math.max(p.ink, inkq)) continue;
        if (PC.localDiff(p.norm, me.norm, this.tol) < this.tol) return i;
      }
      this.protos.push(me); return this.protos.length - 1;
    }
    shapeSame(a, b) { const p = this.protos[a], q = this.protos[b]; return Math.abs(p.h - q.h) <= 2 && Math.abs(p.w - q.w) <= 2 && PC.localDiff(p.norm, q.norm, this.tol) < this.tol; }
    colorDiff(a, b) { const p = this.protos[a].col, q = this.protos[b].col; return Math.max(...p.map((v, k) => Math.abs(v - q[k]))); }
  };

  // トークンa..bを行の高さで切り出してつなぎ(縦組みは回転)、インクのない列を詰めた濃淡画像
  function strip(img, T, L, a, b) {
    const parts = [];
    for (let k = a; k < b; k++) {
      const t = T[k], l = L[t.line], [x0, y0, x1, y1] = t.box;
      let c = l.vert ? PC.crop(img, l.box[0], y0, l.box[2], y1) : PC.crop(img, x0, l.box[1], x1, l.box[3]);
      let g = PC.gray(c), w = c.w, h = c.h;
      if (l.vert) {   // 反時計回りに90度回す(np.rot90と同じ)
        const r = new Uint8Array(w * h);
        for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) r[i * h + j] = g[j * w + (w - 1 - i)];
        g = r; [w, h] = [h, w];
      }
      parts.push({ g, w, h });
    }
    if (!parts.length) return null;
    const H = Math.max(...parts.map(p => p.h)), cols = [];
    for (const p of parts) for (let x = 0; x < p.w; x++) {
      const col = new Float32Array(H).fill(255); let mx = 0;
      for (let y = 0; y < p.h; y++) { col[y] = p.g[y * p.w + x]; mx = Math.max(mx, 255 - col[y]); }
      if (mx > 50) cols.push(col);
    }
    const W = cols.length, d = new Float32Array(W * H);
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) d[y * W + x] = cols[x][y];
    return { d, w: W, h: H };
  }
  function sameLook(old, nw, ot, ol, nt, nl, i1, i2, j1, j2) {
    const a = strip(old, ot, ol, i1, i2), b = strip(nw, nt, nl, j1, j2);
    if (!a || !b || Math.abs(a.w - b.w) > 3 || Math.abs(a.h - b.h) > 4) return false;
    const h = Math.min(a.h, b.h), w = Math.min(a.w, b.w), cut = s => { const o = new Float32Array(w * h); for (let y = 0; y < h; y++) o.set(s.d.subarray(y * s.w, y * s.w + w), y * w); return { d: o, w, h }; };
    let ia = 0, ib = 0; for (const v of a.d) ia += 255 - v; for (const v of b.d) ib += 255 - v;
    return PC.localDiff(cut(a), cut(b), 75) < 75 && Math.abs(ia - ib) < 0.1 * Math.max(ia, ib);
  }

  // lookPairs: 「余白を詰めると見た目が同じ」として差分から外した字形の組(文字データでの裏取りに回す)
  PC.textChanges = (cb, ot, nt, oids, nids, old, nw, ol, nl, skip, lookPairs = []) => {
    const out = [], oi = [], ni = [];
    for (let k = 0; k < oids.length; k++) if (!skip[0].has(k)) oi.push(k);
    for (let k = 0; k < nids.length; k++) if (!skip[1].has(k)) ni.push(k);
    for (const [tag, a1, a2, b1, b2] of PC.opcodes(oi.map(k => oids[k]), ni.map(k => nids[k]))) {
      if (tag === 'equal') continue;
      // 絞り込んだ並びの位置を、元のトークン番号に戻す
      const i1 = a1 < oi.length ? oi[a1] : oids.length, i2 = a2 > a1 ? oi[a2 - 1] + 1 : i1;
      const j1 = b1 < ni.length ? ni[b1] : nids.length, j2 = b2 > b1 ? ni[b2 - 1] + 1 : j1;
      if (tag === 'replace' && i2 - i1 <= 6 && j2 - j1 <= 6 && sameLook(old, nw, ot, ol, nt, nl, i1, i2, j1, j2)) {
        if (a2 - a1 === b2 - b1) for (let q = 0; q < a2 - a1; q++) lookPairs.push([oi[a1 + q], ni[b1 + q]]);
        continue;
      }
      const c = { tag, oi: [i1, i2], nj: [j1, j2], pj: b1 > 0 ? ni[b1 - 1] : null };
      c.obox = i2 > i1 ? PC.union(ot.slice(i1, i2).map(t => t.box)) : null;
      c.nbox = j2 > j1 ? PC.union(nt.slice(j1, j2).map(t => t.box)) : null;
      if (tag === 'replace' && i2 - i1 === j2 - j1) {
        let same = true;
        for (let k = 0; k < i2 - i1 && same; k++) same = cb.shapeSame(oids[i1 + k], nids[j1 + k]);
        if (same) { let mx = 0; for (let k = 0; k < i2 - i1; k++) mx = Math.max(mx, cb.colorDiff(oids[i1 + k], nids[j1 + k])); c.look = mx > 40 ? 'color' : 'same_look'; }
      }
      out.push(c);
    }
    return out;
  };

  // 画像・図版: 同じ見た目を修正後から探し、同じ位置=変化なし/別の位置=移動/見つからない=差分の範囲
  PC.imageChanges = (old, nw, ob, nb) => {
    const out = [], ng = PC.toMat(PC.gray(nw), nw.w, nw.h), og = PC.gray(old);
    const iou = (a, c) => Math.max(0, Math.min(a[2], c[2]) - Math.max(a[0], c[0])) * Math.max(0, Math.min(a[3], c[3]) - Math.max(a[1], c[1]));
    for (const b of ob.filter(x => x.kind === 'image')) {
      const [x0, y0, x1, y1] = b.box, t = PC.sub(og, old.w, x0, y0, x1, y1, old.h), tpl = PC.toMat(t.a, t.w, t.h), res = new cv.Mat();
      cv.matchTemplate(ng, tpl, res, cv.TM_SQDIFF_NORMED);
      const mm = cv.minMaxLoc(res); tpl.delete(); res.delete();
      if (mm.minVal < 0.003) {
        if (Math.abs(mm.minLoc.x - x0) <= 2 && Math.abs(mm.minLoc.y - y0) <= 2) continue;
        out.push({ kind: 'moved', obox: b.box, nbox: [mm.minLoc.x, mm.minLoc.y, mm.minLoc.x + x1 - x0, mm.minLoc.y + y1 - y0] }); continue;
      }
      const cands = nb.filter(x => x.kind === 'image');
      let best = null; for (const c of cands) if (!best || iou(b.box, c.box) > iou(b.box, best.box)) best = c;
      if (!best || iou(b.box, best.box) === 0) { out.push({ kind: 'removed', obox: b.box }); continue; }
      const u = PC.union([b.box, best.box]), uw = u[2] - u[0], uh = u[3] - u[1], dm = new Uint8Array(uw * uh);
      for (let y = 0; y < uh; y++) for (let x = 0; x < uw; x++) {
        const gi = ((u[1] + y) * old.w + u[0] + x) * 4;
        dm[y * uw + x] = Math.max(Math.abs(old.d[gi] - nw.d[gi]), Math.abs(old.d[gi + 1] - nw.d[gi + 1]), Math.abs(old.d[gi + 2] - nw.d[gi + 2])) > 40 ? 1 : 0;
      }
      const op = morph(dm, uw, uh, 'open', 3, 3); let ax0 = 1e9, ay0 = 1e9, ax1 = -1, ay1 = -1;
      for (let y = 0; y < uh; y++) for (let x = 0; x < uw; x++) if (op[y * uw + x]) { ax0 = Math.min(ax0, x); ax1 = Math.max(ax1, x); ay0 = Math.min(ay0, y); ay1 = Math.max(ay1, y); }
      if (ax1 >= 0) out.push({ kind: 'changed', obox: [u[0] + ax0, u[1] + ay0, u[0] + ax1, u[1] + ay1], nbox: best.box });
    }
    ng.delete();
    return out;
  };
})();
