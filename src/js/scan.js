// 紙の赤字原稿(スキャン) × 修正後PDF: スキャンを修正後の画像に重ね、赤字を除いた字形を修正後の字形と1字ずつ比べる
//   位置合わせ → 赤字の除去 → 色・ぼけを合わせる → 字形の照合(行ごとの基準) → 差分
'use strict';
(function () {
  const { median, union, morph } = PC;

  // ---- 小道具 ----
  const prng = PC.prng;
  const toMatRGBA = img => cv.matFromImageData(new ImageData(new Uint8ClampedArray(img.d), img.w, img.h));
  const fromMatRGBA = m => ({ w: m.cols, h: m.rows, d: new Uint8ClampedArray(m.data) });
  // 度数分布からの分位点(numpyのpercentileと同じく、順位の間を直線で補う)
  function pctHist(hist, m, q) {
    if (!m) return NaN;
    const r = q / 100 * (m - 1), lo = Math.floor(r), hi = Math.ceil(r);
    let s = 0, vlo = null, vhi = null;
    for (let v = 0; v < hist.length; v++) {
      s += hist[v];
      if (vlo === null && s > lo) vlo = v;
      if (s > hi) { vhi = v; break; }
    }
    return vlo + (vhi - vlo) * (r - lo);
  }

  // ---- 位置合わせ: スキャンを修正後の描画に重ねる(回転・拡大縮小・平行移動のみ) ----
  const grayNoRed = img => { const g = PC.gray(img), r = PC.redMask(img); for (let i = 0; i < g.length; i++) if (r[i]) g[i] = 255; return g; };
  // 文字などのある範囲(左端・上端・右端)。赤は除く。小さな点に左右されないよう端から0.5%の位置で測る
  function inkExtent(img) {
    const { w, h, d } = img, r = PC.redMask(img), cx = new Float64Array(w), cy = new Float64Array(h);
    let n = 0;
    for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
      const j = i * 4;
      if (255 - Math.min(d[j], d[j + 1], d[j + 2]) > 60 && !r[i]) { cx[x]++; cy[y]++; n++; }
    }
    if (n < 100) return null;
    return [pctHist(cx, n, 0.5), pctHist(cy, n, 0.5), pctHist(cx, n, 99.5)];
  }
  // 相似変換 [a, -b, tx, b, a, ty] を最小二乗で求める
  function fitSim(P, Q, idx) {
    let n = 0, mx = 0, my = 0, nx = 0, ny = 0;
    for (const i of idx) { mx += P[2 * i]; my += P[2 * i + 1]; nx += Q[2 * i]; ny += Q[2 * i + 1]; n++; }
    if (n < 2) return null;
    mx /= n; my /= n; nx /= n; ny /= n;
    let sxx = 0, sa = 0, sb = 0;
    for (const i of idx) {
      const px = P[2 * i] - mx, py = P[2 * i + 1] - my, qx = Q[2 * i] - nx, qy = Q[2 * i + 1] - ny;
      sxx += px * px + py * py; sa += px * qx + py * qy; sb += px * qy - py * qx;
    }
    if (sxx < 1e-9) return null;
    const a = sa / sxx, b = sb / sxx;
    return [a, -b, nx - (a * mx - b * my), b, a, ny - (b * mx + a * my)];
  }
  const simErr = (A, P, Q, k) => { const x = P[2 * k], y = P[2 * k + 1]; return Math.hypot(A[0] * x + A[1] * y + A[2] - Q[2 * k], A[3] * x + A[4] * y + A[5] - Q[2 * k + 1]); };
  // RANSACで相似変換を当てはめ、当てはまった点で最小二乗をやり直す
  function ransacSim(P, Q, idx, thr, maxIt, rand) {
    const m = idx.length;
    if (m < 2) return null;
    let best = null, bestN = 0, need = maxIt;
    for (let it = 0; it < need; it++) {
      const a = idx[Math.floor(rand() * m)], b = idx[Math.floor(rand() * m)];
      if (a === b || Math.hypot(P[2 * a] - P[2 * b], P[2 * a + 1] - P[2 * b + 1]) < 4) continue;
      const A = fitSim(P, Q, [a, b]);
      if (!A) continue;
      let n = 0; for (const k of idx) if (simErr(A, P, Q, k) < thr) n++;
      if (n > bestN) {
        bestN = n; best = A;
        const w = n / m, q = 1 - w * w;
        need = q <= 1e-9 ? 0 : Math.min(maxIt, Math.ceil(Math.log(0.001) / Math.log(q)));
      }
    }
    if (!best) return null;
    let A = best;
    for (let r = 0; r < 3; r++) {
      const inl = idx.filter(k => simErr(A, P, Q, k) < thr), B = inl.length >= 2 ? fitSim(P, Q, inl) : null;
      if (!B) break;
      A = B;
    }
    return { A, inl: idx.filter(k => simErr(A, P, Q, k) < thr) };
  }
  // 文章が動いたページでは「動いた部分だけが合う重ね方」も候補になるため、候補を複数作り、
  // 文字のある範囲(左端・上端・右端)がいちばんよく重なるものを選ぶ(余白の位置は文章が動いても変わらない)
  //   dpi: スキャンの解像度(PDFは300で描画)。画像ファイルは不明なので、ページの幅で合わせる
  PC.registerScan = (sc, ref, dpi) => {
    const s = dpi ? PC.DPI / dpi : ref.w / sc.w, src = toMatRGBA(sc), sm = new cv.Mat();
    cv.resize(src, sm, new cv.Size(Math.round(sc.w * s), Math.round(sc.h * s)), 0, 0, cv.INTER_AREA);
    src.delete();
    const small = fromMatRGBA(sm); sm.delete();
    const g1 = PC.toMat(grayNoRed(small), small.w, small.h), g2 = PC.toMat(grayNoRed(ref), ref.w, ref.h);
    const orb = new cv.ORB(8000), k1 = new cv.KeyPointVector(), k2 = new cv.KeyPointVector(), d1 = new cv.Mat(), d2 = new cv.Mat(), none = new cv.Mat();
    orb.detectAndCompute(g1, none, k1, d1); orb.detectAndCompute(g2, none, k2, d2);
    const P = [], Q = [];
    if (d1.rows && d2.rows) {
      const bf = new cv.BFMatcher(cv.NORM_HAMMING, false), mm = new cv.DMatchVectorVector();
      bf.knnMatch(d1, d2, mm, 2);
      for (let i = 0; i < mm.size(); i++) {
        const v = mm.get(i);
        if (v.size() === 2) {
          const a = v.get(0), b = v.get(1);
          if (a.distance < 0.85 * b.distance) { const p = k1.get(a.queryIdx).pt, q = k2.get(a.trainIdx).pt; P.push(p.x, p.y); Q.push(q.x, q.y); }
        }
        v.delete();
      }
      bf.delete(); mm.delete();
    }
    [g1, g2, orb, k1, k2, d1, d2, none].forEach(o => o.delete());
    const n = P.length / 2, rand = prng(20261026), hyps = [];
    let idx = [...Array(n).keys()];
    for (let hN = 0; hN < 5 && idx.length >= 12; hN++) {
      const r = ransacSim(P, Q, idx, 2.0, 5000, rand);
      if (!r) break;
      let cnt = 0; for (let k = 0; k < n; k++) if (simErr(r.A, P, Q, k) < 3.0) cnt++;
      hyps.push([cnt, r.A]);
      const inl = new Set(r.inl); idx = idx.filter(k => !inl.has(k));
    }
    let A = [1, 0, 0, 0, 1, 0], ok = 0;
    if (hyps.length) {
      const eR = inkExtent(ref), eS = inkExtent(small), top = Math.max(...hyps.map(h => h[0]));
      const miss = M => {
        if (!eR || !eS) return 0;
        const c = (x, y) => [M[0] * x + M[1] * y + M[2], M[3] * x + M[4] * y + M[5]], a = c(eS[0], eS[1]), b = c(eS[2], eS[1]);
        return Math.abs(a[0] - eR[0]) + Math.abs(a[1] - eR[1]) + Math.abs(b[0] - eR[2]);
      };
      const best = hyps.filter(h => h[0] >= 0.25 * top).reduce((p, q) => (miss(q[1]) < miss(p[1]) ? q : p));
      A = best[1]; ok = best[0];
    }
    const M = cv.matFromArray(2, 3, cv.CV_64F, A), s2 = toMatRGBA(small), out = new cv.Mat();
    cv.warpAffine(s2, out, M, new cv.Size(ref.w, ref.h), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));
    const W = fromMatRGBA(out);
    [M, s2, out].forEach(o => o.delete());
    return { W, matched: ok, A, s };   // A: 縮めたスキャン(s 倍)の位置 → 修正後の位置
  };

  // ---- 赤字の除去 ----
  // 赤ペンらしい色: 色相が赤(HSV)、または赤みが強く緑と青が同じくらい(薄い赤のにじみ)。黄・橙は含めない
  const reddish = (r, g, b) => r - Math.max(g, b) > 40 && g - b < 40;
  // スキャンの赤いまとまりのうち、修正後にも(近くに)同じ形で印刷されている赤。位置が少しずれていても探す
  function printedRed(w, ref, search = 20) {
    const W = w.w, H = w.h, n = W * H, d = w.d, rw = PC.redMask(w), rnM = PC.redMask(ref), out = new Uint8Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) if (reddish(d[j], d[j + 1], d[j + 2])) rw[i] = 255;
    const cc = PC.cc(morph(rw, W, H, 'dilate', 3, 3), W, H);
    for (let c = 1; c < cc.n; c++) {
      const s = cc.st[c], x = s.x0, y = s.y0, ww = s.x1 - s.x0 + 1, hh = s.y1 - s.y0 + 1;
      if (s.area < 6) continue;
      const comp = new Float32Array(ww * hh); let cs = 0;
      for (let yy = 0; yy < hh; yy++) for (let xx = 0; xx < ww; xx++) { const g = (y + yy) * W + x + xx; if (cc.lab[g] === c && rw[g]) { comp[yy * ww + xx] = 1; cs++; } }
      if (cs < 4) continue;
      const x0 = Math.max(0, x - search), y0 = Math.max(0, y - search), x1 = Math.min(W, x + ww + search), y1 = Math.min(H, y + hh + search), rW = x1 - x0, rH = y1 - y0;
      if (rH < hh || rW < ww) continue;
      const sub = new Uint8Array(rW * rH); let any = false;
      for (let yy = 0; yy < rH; yy++) for (let xx = 0; xx < rW; xx++) if (rnM[(y0 + yy) * W + x0 + xx]) { sub[yy * rW + xx] = 1; any = true; }
      if (!any) continue;
      const reg = morph(sub, rW, rH, 'dilate', 3, 3), rm = new cv.Mat(rH, rW, cv.CV_32FC1), tm = new cv.Mat(hh, ww, cv.CV_32FC1), res = new cv.Mat();
      for (let k = 0; k < reg.length; k++) rm.data32F[k] = reg[k] ? 1 : 0;
      tm.data32F.set(comp);
      cv.matchTemplate(rm, tm, res, cv.TM_CCORR);
      const mm = cv.minMaxLoc(res); [rm, tm, res].forEach(o => o.delete());
      if (mm.maxVal < 0.3 * cs) continue;
      // いちばん重なるずらし方で、修正後の赤と重なる画素だけを「印刷の赤」にする(赤ペンの線が触れていても分けられる)
      const sh = new Uint8Array(ww * hh);
      for (let yy = 0; yy < hh; yy++) for (let xx = 0; xx < ww; xx++) sh[yy * ww + xx] = reg[(mm.maxLoc.y + yy) * rW + mm.maxLoc.x + xx] ? 1 : 0;
      const dsh = morph(sh, ww, hh, 'dilate', 3, 3);
      for (let k = 0; k < comp.length; k++) if (comp[k] && dsh[k]) out[(y + Math.floor(k / ww)) * W + x + (k % ww)] = 1;
    }
    return out;
  }
  // 赤字(修正後にも印刷されている赤以外の赤)を紙の色で消し、まわりの赤の跡と小さな点も消す
  PC.cleanScan = (w, ref) => {
    const W = w.w, H = w.h, n = W * H, d = w.d, hsv = PC.redMask(w), pr = printedRed(w, ref), core = new Uint8Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) core[i] = (reddish(d[j], d[j + 1], d[j + 2]) || hsv[i]) && !pr[i] ? 1 : 0;
    const near = morph(core, W, H, 'dilate', 7, 7), g = PC.gray(w), ink = PC.inkMask(w);
    const bg = [0, 1, 2].map(c => { const hist = new Float64Array(256); let m = 0; for (let i = 0; i < n; i++) if (!ink[i]) { hist[d[i * 4 + c]]++; m++; } return m ? Math.trunc(pctHist(hist, m, 50)) : 255; });
    const o = { w: W, h: H, d: new Uint8ClampedArray(d) }, paint = i => { o.d[i * 4] = bg[0]; o.d[i * 4 + 1] = bg[1]; o.d[i * 4 + 2] = bg[2]; };
    for (let i = 0; i < n; i++) if ((near[i] && g[i] > 110) || core[i]) paint(i);
    const cc = PC.cc(PC.inkMask(o), W, H);
    for (let i = 0; i < n; i++) { const l = cc.lab[i]; if (l && cc.st[l].area < 8) paint(i); }
    // 赤字の形を読むための赤: 色相が赤のはっきりした画素だけ(にじみまで含めると線が太り、くさびの形などが崩れる)
    const pen = new Uint8Array(n); for (let i = 0; i < n; i++) pen[i] = hsv[i] && !pr[i] ? 255 : 0;
    return { O: o, core, pen, pr };
  };

  // ---- 色合わせ ----
  // 文字のブロックの範囲
  function region(blks, w, h) {
    const m = new Uint8Array(w * h);
    for (const b of blks) if (b.kind === 'htext' || b.kind === 'vtext') for (let y = b.box[1]; y < b.box[3]; y++) m.fill(1, y * w + b.box[0], y * w + b.box[2]);
    return m;
  }
  // 文字の部分の、紙の色(明るい側)と文字の黒(暗い側)を色ごとに測る
  function levels(img, tm) {
    const g = PC.gray(img), d = img.d, n = img.w * img.h, gh = new Float64Array(256); let m = 0;
    for (let i = 0; i < n; i++) if (tm[i]) { gh[g[i]]++; m++; }
    if (!m) return [[255, 255, 255], [0, 0, 0]];
    const paperG = pctHist(gh, m, 75), med = sel => [0, 1, 2].map(c => { const h = new Float64Array(256); let k = 0; for (let i = 0; i < n; i++) if (tm[i] && sel(g[i])) { h[d[i * 4 + c]]++; k++; } return k ? pctHist(h, k, 50) : 0; });
    const paper = med(v => v >= paperG - 3);
    const dh = new Float64Array(256); let dm = 0; for (let v = 0; v < 256; v++) if (v < paperG - 80) { dh[v] = gh[v]; dm += gh[v]; }
    const darkG = dm > 100 ? pctHist(dh, dm, 20) : 0;
    return [paper, med(v => v <= darkG + 10)];
  }
  // 修正後(RGBA)を色ごとに a*x+b で変換した実数の画像(RGB)
  function tone(N, coef) {
    const n = N.w * N.h, f = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) f[i * 3 + c] = Math.min(255, Math.max(0, coef[c][0] * N.d[i * 4 + c] + coef[c][1]));
    return f;
  }
  // RGBA の画像を、ガウスぼかしした RGBA の画素にする
  function blurRGBA(img, sg) {
    const m = toMatRGBA(img), o = new cv.Mat();
    cv.GaussianBlur(m, o, new cv.Size(0, 0), sg, sg, cv.BORDER_DEFAULT);
    const r = new Uint8ClampedArray(o.data); m.delete(); o.delete();
    return r;
  }
  function blurF3(f, w, h, sg) {
    if (!(sg > 0)) return new Float32Array(f);   // ぼかさない(デジタルのPDFの原稿)
    const m = new cv.Mat(h, w, cv.CV_32FC3), o = new cv.Mat();
    m.data32F.set(f);
    cv.GaussianBlur(m, o, new cv.Size(0, 0), sg, sg, cv.BORDER_DEFAULT);
    const r = new Float32Array(o.data32F); m.delete(); o.delete();
    return r;
  }
  const toU8 = (f, w, h) => { const n = w * h, d = new Uint8ClampedArray(n * 4); for (let i = 0; i < n; i++) { d[i * 4] = Math.round(f[i * 3]); d[i * 4 + 1] = Math.round(f[i * 3 + 1]); d[i * 4 + 2] = Math.round(f[i * 3 + 2]); d[i * 4 + 3] = 255; } return { w, h, d }; };

  // ---- 字形の特徴 ----
  // ガウスぼかし(端は鏡映。OpenCVと同じ大きさの重み)
  function gaussK(sg) {
    const n = (Math.round(sg * 8 + 1) | 1), r = (n - 1) / 2, k = new Float64Array(n); let s = 0;
    for (let i = 0; i < n; i++) { k[i] = Math.exp(-((i - r) ** 2) / (2 * sg * sg)); s += k[i]; }
    for (let i = 0; i < n; i++) k[i] /= s;
    return k;
  }
  const r101 = (i, n) => (n === 1 ? 0 : i < 0 ? Math.min(n - 1, -i) : i >= n ? Math.max(0, 2 * n - 2 - i) : i);
  function blurSmall(a, w, h, sg) {   // a: RGBの実数(3チャンネル)
    const k = gaussK(sg), r = (k.length - 1) / 2, t = new Float32Array(a.length), o = new Float32Array(a.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) { let s = 0; for (let q = -r; q <= r; q++) s += k[q + r] * a[(y * w + r101(x + q, w)) * 3 + c]; t[(y * w + x) * 3 + c] = s; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) { let s = 0; for (let q = -r; q <= r; q++) s += k[q + r] * t[(r101(y + q, h) * w + x) * 3 + c]; o[(y * w + x) * 3 + c] = s; }
    return o;
  }
  // img: { w, h, d, ch } (ch=4: RGBAの整数、ch=3: RGBの実数)の矩形をRGBの実数で取り出す(範囲外は切り詰める)
  function crop3(img, x0, y0, x1, y1) {
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(img.w, x1); y1 = Math.min(img.h, y1);
    const w = Math.max(0, x1 - x0), h = Math.max(0, y1 - y0), o = new Float32Array(w * h * 3), C = img.ch;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = ((y0 + y) * img.w + x0 + x) * C, t = (y * w + x) * 3; o[t] = img.d[s]; o[t + 1] = img.d[s + 1]; o[t + 2] = img.d[s + 2]; }
    return { a: o, w, h, x0, y0 };
  }
  // 字形の特徴: 枠ちょうどで切り出す(隣の字を入れない)。濃さ = 色ごとの「紙より暗い量」の最大を、字形の中の最大で割る。
  //   sg>0 なら、この字形だけをぼかしてから(修正後の描画をスキャンに寄せる用)、gm で太さを寄せる。zone: 比べない画素(赤字の所)
  //   halo: 赤ペンのにじみが届く範囲(スキャン側だけ)。そこで赤みのある画素は、赤の成分の濃さで測る
  //   (赤チャンネルでは、赤いにじみはほぼ白、黒い字は黒のまま見える。字の上の赤のにじみに引きずられないように)
  function feats(img, box, line, paper, zone, sg = 0, gm = 1, halo = null) {
    let [x0, y0, x1, y1] = box;
    x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0)); x1 = Math.min(img.w, Math.round(x1)); y1 = Math.min(img.h, Math.round(y1));
    if (x1 <= x0) x1 = Math.min(img.w, x0 + 1), x0 = x1 - 1;
    if (y1 <= y0) y1 = Math.min(img.h, y0 + 1), y0 = y1 - 1;
    const w = x1 - x0, h = y1 - y0;
    let a;
    if (sg > 0) {
      const m = 4, big = crop3(img, x0 - m, y0 - m, x1 + m, y1 + m), bl = blurSmall(big.a, big.w, big.h, sg), ox = x0 - big.x0, oy = y0 - big.y0;
      a = new Float32Array(w * h * 3);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) a[(y * w + x) * 3 + c] = bl[((oy + y) * big.w + ox + x) * 3 + c];
    } else a = crop3(img, x0, y0, x0 + w, y0 + h).a;
    const n = w * h, dark = new Float32Array(n); let hi = 1;
    for (let i = 0; i < n; i++) {
      const r = a[i * 3], g = a[i * 3 + 1], b = a[i * 3 + 2];
      let v = Math.max(paper[0] - r, paper[1] - g, paper[2] - b);
      if (halo && halo[(y0 + Math.floor(i / w)) * img.w + x0 + (i % w)] && r - Math.max(g, b) > 15 && g - b < 40) v = paper[0] - r;
      dark[i] = v; if (v > hi) hi = v;
    }
    const norm = new Float32Array(n); let ink = 0;
    for (let i = 0; i < n; i++) { let c = Math.min(1, Math.max(0, dark[i] / hi)); if (gm !== 1) c = Math.pow(c, gm); norm[i] = 255 - 255 * c; ink += c; }
    const off = line.vert ? (x0 + x1) / 2 - line.mid : (y0 + y1) / 2 - line.mid;
    let mask = null, mf = 0;
    if (zone) {
      const z = new Float32Array(n); let any = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (zone[(y0 + y) * img.w + x0 + x]) { z[y * w + x] = 1; any++; }
      if (any) { mask = z; mf = any / n; }
    }
    return { h, w, off, norm: { d: norm, w, h }, small: PC.resizeArea(norm, w, h, 8, 8), ink, mask, mf };
  }
  const pre = (q, f, ink) => {
    if (Math.abs(q.h - f.h) > 2 || Math.abs(q.w - f.w) > 2 || Math.abs(q.off - f.off) > 3) return false;
    let s = 0; for (let k = 0; k < 64; k++) s += Math.abs(q.small[k] - f.small[k]);
    return s / 64 <= 40 && Math.abs(q.ink - f.ink) <= ink * Math.max(q.ink, f.ink);
  };

  // ---- 字形どうしの差(赤字の所を除いて比べる) ----
  // 0.33画素刻みで位置を合わせ(双線形補間はx・yに分けて計算できる)、5×5の範囲で平均した差の最大値の、いちばん小さいもの。
  // ma(aの側)が1の画素は比べない。tol を渡すと、tol 未満が見つかった時点で打ち切る(「tol未満か」だけを使うとき)
  const SH = [-1, -2 / 3, -1 / 3, 0, 1 / 3, 2 / 3, 1];
  function shiftX(src, W, H, dx, dst) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const sx = x - dx, fx = Math.floor(sx), ax = sx - fx, r = y * W;
      const p = fx >= 0 && fx < W ? src[r + fx] : 255, q = fx + 1 >= 0 && fx + 1 < W ? src[r + fx + 1] : 255;
      dst[r + x] = (1 - ax) * p + ax * q;
    }
  }
  function shiftY(src, W, H, dy, dst) {
    for (let y = 0; y < H; y++) {
      const sy = y - dy, fy = Math.floor(sy), ay = sy - fy, ok0 = fy >= 0 && fy < H, ok1 = fy + 1 >= 0 && fy + 1 < H;
      for (let x = 0; x < W; x++) { const p = ok0 ? src[fy * W + x] : 255, q = ok1 ? src[(fy + 1) * W + x] : 255; dst[y * W + x] = (1 - ay) * p + ay * q; }
    }
  }
  function box5(src, W, H, tmp, dst) {   // 5×5の平均(端は鏡映)。内側は折り返しの計算を省く
    for (let y = 0; y < H; y++) {
      const r = y * W;
      for (let x = 0; x < W; x++) {
        if (x >= 2 && x < W - 2) tmp[r + x] = src[r + x - 2] + src[r + x - 1] + src[r + x] + src[r + x + 1] + src[r + x + 2];
        else { let s = 0; for (let k = -2; k <= 2; k++) s += src[r + r101(x + k, W)]; tmp[r + x] = s; }
      }
    }
    for (let y = 0; y < H; y++) {
      const r = y * W;
      if (y >= 2 && y < H - 2) {
        const a = r - 2 * W, b = r - W, c = r + W, d = r + 2 * W;
        for (let x = 0; x < W; x++) dst[r + x] = (tmp[a + x] + tmp[b + x] + tmp[r + x] + tmp[c + x] + tmp[d + x]) / 25;
      } else for (let x = 0; x < W; x++) { let s = 0; for (let k = -2; k <= 2; k++) s += tmp[r101(y + k, H) * W + x]; dst[r + x] = s / 25; }
    }
  }
  // 作業用の配列は使い回す(字形の比較は数万回になるため)
  let SCR = null;
  const scratch = n => {
    if (!SCR || SCR.n < n) { const m = Math.max(n, 8192), f = () => new Float32Array(m); SCR = { n: m, A: f(), B0: f(), M: f(), wb: f(), tmp: f(), bd: f(), D: f(), Bs: f(), BX: SH.map(f) }; }
    return SCR;
  };
  const placeInto = (c, g, W, H) => { c.fill(255, 0, W * H); const oy = (H - g.h) >> 1, ox = (W - g.w) >> 1; for (let y = 0; y < g.h; y++) c.set(g.d.subarray(y * g.w, y * g.w + g.w), (oy + y) * W + ox); return c; };
  PC.maskedDiff = (a, b, ma, tol = 0) => {
    const H = Math.max(a.h, b.h) + 6, W = Math.max(a.w, b.w) + 6, n = W * H, S = scratch(n);
    const A = placeInto(S.A, a, W, H), B0 = placeInto(S.B0, b, W, H), { tmp, bd, D, Bs } = S;
    let M = null, wb = null;
    if (ma) {
      M = S.M; M.fill(1, 0, n); wb = S.wb;
      const oy = (H - a.h) >> 1, ox = (W - a.w) >> 1;
      for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) M[(oy + y) * W + ox + x] = 1 - ma[y * a.w + x];
      box5(M, W, H, tmp, wb);
    }
    // x方向にずらした版を先に作る(双線形補間はx・yに分けられる)
    SH.forEach((dx, k) => shiftX(B0, W, H, dx, S.BX[k]));
    let best = 1e9;
    for (const dy of SH) for (let xi = 0; xi < SH.length; xi++) {
      shiftY(S.BX[xi], W, H, dy, Bs);
      if (M) for (let i = 0; i < n; i++) D[i] = Math.abs(A[i] - Bs[i]) * M[i];
      else for (let i = 0; i < n; i++) D[i] = Math.abs(A[i] - Bs[i]);
      box5(D, W, H, tmp, bd);
      let mx = 0;
      if (M) { for (let i = 0; i < n; i++) if (wb[i] >= 0.4) { const v = bd[i] / Math.max(wb[i], 1e-3); if (v > mx) mx = v; } }
      else for (let i = 0; i < n; i++) if (bd[i] > mx) mx = bd[i];
      if (mx < best) best = mx;
      if (best < tol) return best;
    }
    return best;
  };

  // ---- スキャンの文字のブロック(修正後のブロックを手がかりにする) ----
  // 赤字を消した跡(にじみ)で離れた文字どうしがつながらないよう、赤字のまわり(zone)を除いてブロックを作る。
  // ブロックの向き(横組み・縦組み)と読む順番は、重なる修正後のブロックに合わせる(余白の書き込みなどで変わらないように)。
  // 修正後のどのブロックにも重ならないブロック(余白の書き込み、修正後で消えた文章)は最後に読む
  function guided(O, oink, nb, zone, w, h) {
    const nlab = nb.lab, bOf = new Map(nb.map((b, k) => [b.cid, k])), gi = new Uint8Array(oink.length);
    for (let i = 0; i < gi.length; i++) gi[i] = oink[i] && !zone[i] ? 1 : 0;
    const text = b => b.kind === 'htext' || b.kind === 'vtext';
    const ob = PC.blocks(O, gi, true), lab = ob.lab, byCid = new Map(ob.map(b => [b.cid, b]));
    const norder = [...PC.xycut(nb.filter(b => b.kind === 'htext'), false), ...PC.xycut(nb.filter(b => b.kind === 'vtext'), true)];
    const rank = new Map(norder.map((b, r) => [nb.indexOf(b), r]));
    // スキャンのブロックごとに、いちばん多く重なる修正後のブロック
    const votes = new Map();
    for (let i = 0; i < gi.length; i++) if (gi[i] && lab[i] && nlab[i]) { const k = bOf.get(nlab[i]); if (k === undefined) continue; let m = votes.get(lab[i]); if (!m) votes.set(lab[i], m = new Map()); m.set(k, (m.get(k) || 0) + 1); }
    const own = [...PC.xycut(ob.filter(b => b.kind === 'htext'), false), ...PC.xycut(ob.filter(b => b.kind === 'vtext'), true)];
    const ownRank = new Map(own.map((b, r) => [b, r]));
    for (const b of ob) {
      let bk = -1, bc = 0; for (const [k, v] of votes.get(b.cid) || []) if (v > bc) { bc = v; bk = k; }
      b.lid = b.cid;
      if (bk >= 0 && text(nb[bk]) && text(b)) { b.kind = nb[bk].kind; b.rank = rank.get(bk); }
      else b.rank = Infinity;
    }
    const order = ob.filter(text).sort((p, q) => (p.rank - q.rank) || ((ownRank.get(p) ?? 1e9) - (ownRank.get(q) ?? 1e9)));
    // 赤字のまわりのインクは、そこを含むブロック(膨らませた範囲)に入れる
    const olab = new Int32Array(w * h);
    for (let i = 0; i < oink.length; i++) if (oink[i] && lab[i] && byCid.has(lab[i])) olab[i] = lab[i];
    // 修正後の画素のブロック番号(ぼかした描画のインクが、ブロックの枠から少しはみ出しても拾えるように、膨らませた範囲で決める)
    const nl2 = new Int32Array(w * h); for (let i = 0; i < nlab.length; i++) if (nlab[i]) { const k = bOf.get(nlab[i]); if (k !== undefined && text(nb[k])) nl2[i] = k + 1; }
    return { oblocks: order, olab, norder: norder.map(b => ({ kind: b.kind, lid: nb.indexOf(b) + 1, box: b.box })), nlab: nl2 };
  }
  // 赤字を消した跡: ほとんど赤字の範囲に入っていて、行の高さに比べてとても細い字形(取り消し線・引き出し線のにじみ)
  function dropRemnants({ toks, lines }, zone, w) {
    const keep = toks.map(t => {
      const L = lines[t.line], em = L.vert ? L.box[2] - L.box[0] : L.box[3] - L.box[1], [x0, y0, x1, y1] = t.box;
      if (Math.min(x1 - x0, y1 - y0) > 0.3 * em) return true;
      let z = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (zone[y * w + x]) z++;
      return z < 0.85 * (x1 - x0) * (y1 - y0);
    });
    const idx = new Map(), T = [];
    toks.forEach((t, k) => { if (keep[k]) { idx.set(k, T.length); T.push(t); } });
    for (const l of lines) l.toks = l.toks.filter(k => keep[k]).map(k => idx.get(k));
    for (const l of lines) if (l.toks.length) l.mid = median(l.toks.map(k => l.vert ? (T[k].box[0] + T[k].box[2]) / 2 : (T[k].box[1] + T[k].box[3]) / 2));
    return { toks: T, lines };
  }
  // ブロックの番号ごとに、インクのある範囲
  function boxesByLab(ink, lab, w) {
    const bb = new Map();
    for (let i = 0; i < ink.length; i++) if (ink[i] && lab[i]) {
      const x = i % w, y = (i - x) / w; let q = bb.get(lab[i]);
      if (!q) bb.set(lab[i], q = [x, y, x + 1, y + 1]);
      else { if (x < q[0]) q[0] = x; if (y < q[1]) q[1] = y; if (x + 1 > q[2]) q[2] = x + 1; if (y + 1 > q[3]) q[3] = y + 1; }
    }
    return bb;
  }

  // ---- 1ページの照合 ----
  //   W: 修正後に重ねたスキャン(RGBA)、N: 修正後の描画(RGBA)。どちらも200dpi・同じ大きさ
  //   opt.digital: 原稿がスキャンでないPDF(成果物と同じように描いたもの)。スキャンのぼけに寄せる代わりに、原稿と修正後の両方に
  //   同じ弱いぼかし(DSG)をかけて比べる(文字を線にした所(アウトライン)の描き方のわずかな違いで、同じ字を違うとしないように)
  PC.DIGITAL_SG = 0.7;
  PC.ScanPage = class {
    constructor(W, N, opt = {}) {
      Object.assign(this, { tolS: 40, tolL: 45, tolM: 80 }, opt);
      if (this.digital) W = { w: W.w, h: W.h, d: blurRGBA(W, PC.DIGITAL_SG) };
      Object.assign(this, { W, N, w: N.w, h: N.h, Wi: { w: N.w, h: N.h, d: W.d, ch: 4 } });
    }
    // step(説明, 0〜1): 進み具合の表示
    async init(step = () => {}) {
      const { W, N, w, h } = this;
      step('赤字を除いています', 0.05); await PC.tick();
      const { O, core, pen, pr } = PC.cleanScan(W, N);
      this.O = O; this.core = core; this.pen = pen; this.zone = morph(core, w, h, 'dilate', 11, 11);
      // 赤ペンのにじみが届く範囲(印刷の赤のまわりは除く)
      const far = morph(core, w, h, 'dilate', 21, 21), prd = morph(pr, w, h, 'dilate', 7, 7);
      this.halo = new Uint8Array(w * h); for (let i = 0; i < far.length; i++) this.halo[i] = far[i] && !prd[i] ? 1 : 0;
      const oink = PC.textInk(O); this.oink = oink; this.oblocks = PC.blocks(O, oink);
      // 修正後の描画を、スキャンの紙の色・文字の黒に合わせる(赤字のまわりは測らない)
      const nink = PC.textInk(N), nb = PC.blocks(N, nink, true), tO = region(this.oblocks, w, h), avoid = morph(core, w, h, 'dilate', 15, 15);
      this.nblocks = nb;
      for (let i = 0; i < tO.length; i++) if (avoid[i]) tO[i] = 0;
      const [pO, iO] = levels(O, tO), [pN0, iN] = levels(N, region(nb, w, h)); this.iO = iO;
      this.coef = [0, 1, 2].map(c => { const a = (pO[c] - iO[c]) / Math.max(1, pN0[c] - iN[c]); return [a, pO[c] - a * pN0[c]]; });
      this.Nt = { w, h, d: tone(N, this.coef), ch: 3 };
      this.pO = levels(W, region(this.oblocks, w, h))[0];
      const g = guided(O, oink, nb, this.zone, w, h); this.norder = g.norder; this.nlab = g.nlab; this.gblocks = g.oblocks;
      // 修正後の行(描画から求める)を、スキャンの行の切り分けの手がかりにする
      const guide = PC.tokens(N, nink, g.norder, { ordered: true, lab: g.nlab }).lines.filter(l => l.toks.length).map(l => ({ box: l.box, vert: l.vert }));
      ({ toks: this.ot, lines: this.ol } = dropRemnants(PC.tokens(O, oink, g.oblocks, { ordered: true, lab: g.olab, guide }), this.zone, w));
      this.of = this.ot.map(t => feats(this.Wi, t.box, this.ol[t.line], this.pO, this.zone, 0, 1, this.halo));
      // 赤字の指示が付いた字形(取り消し線・囲み・書き込み・挿入の両隣)。赤字で隠れて比べにくいので、ここだけは
      // 「変わっていない」寄りに比べる(誤って「変わった」とすると、直っていない赤字を見逃すため)。
      // 引き出し線がたまたま横切っただけの字は、ふつうの基準で比べる(本当の修正を見逃さないため)
      this.instructed = new Set();
      const pre0 = PC.anchors(morph(pen, w, h, 'open', 2, 2), w, h, this.ol.filter(l => l.toks.length), this.ot, this.oblocks.filter(b => b.kind === 'image')).an;
      for (const a of pre0) {
        if (a.kind === 'tokens') a.toks.forEach(k => this.instructed.add(k));
        else if (a.kind === 'insert') [a.at - 1, a.at].forEach(k => { if (k >= 0 && k < this.ot.length) this.instructed.add(k); });
      }
      this.sg = this.digital ? PC.DIGITAL_SG : 1.0; this.gm = 1.0;
      await this.run(true, step, 0.1, 0.55);
      // 2回目: 1回目で対応した字の組で、ぼけと太さを合わせ直す
      step('ぼけ・太さを合わせています', 0.55); await PC.tick();
      const pairs = [];
      for (const [tag, i1, i2, j1] of this.ops) if (tag === 'equal') for (let q = 0; q < i2 - i1; q++) if (!this.of[i1 + q].mask) pairs.push([i1 + q, j1 + q]);
      pairs.sort((p, q) => this.cmp(p[0], p[1]) - this.cmp(q[0], q[1]));
      const P = pairs.slice(0, 80);
      let best = null;
      for (const sg of this.digital ? [PC.DIGITAL_SG] : [0.7, 0.85, 1.0, 1.2, 1.4, 1.7]) for (const gm of [1.0, 0.85, 0.7]) {
        let s = 0;
        for (const [i, j] of P) s += PC.maskedDiff(this.of[i].norm, feats(this.Nt, this.nt[j].box, this.nl[this.nt[j].line], this.pN, null, sg, gm).norm, null);
        s = P.length ? s / P.length : 0;
        if (!best || s < best[0]) best = [s, sg, gm];
        await PC.tick();
      }
      if (best[1] !== this.sg || best[2] !== this.gm) { this.sg = best[1]; this.gm = best[2]; await this.run(false, step, 0.6, 1); }
      return this;
    }
    async run(first, step, f0, f1) {
      const { w, h } = this, at = f => f0 + (f1 - f0) * f;
      step('字形を照合しています', at(0)); await PC.tick();
      this.Nsf = blurF3(this.Nt.d, w, h, this.sg);
      const sim = toU8(this.Nsf, w, h), sink = PC.textInk(sim);
      this.sim = sim;
      if (first) this.pN = levels(sim, region(this.nblocks, w, h))[0];
      const bb = boxesByLab(sink, this.nlab, w), nbk = this.norder.map(b => ({ ...b, box: bb.get(b.lid) || b.box }));
      ({ toks: this.nt, lines: this.nl } = PC.tokens(sim, sink, nbk, { ordered: true, lab: this.nlab }));
      this.nf = this.nt.map(t => feats(this.Nt, t.box, this.nl[t.line], this.pN, null, this.sg, this.gm));
      this.cache = new Map();
      // 修正後の字形に番号を振る(修正後どうしは描画なので厳しめで安定)
      const protos = [], nids = [];
      this.nf.forEach((f, j) => {
        let k = protos.findIndex(p => pre(p.f, f, 0.15) && PC.maskedDiff(p.f.norm, f.norm, null, 30) < 30);
        if (k < 0) { protos.push({ f, j }); k = protos.length - 1; }
        nids.push(k);
      });
      // スキャンの字形は、修正後の番号のうちいちばん近いもの(厳しめ)
      const oids = []; this.obest = [];
      for (let i = 0; i < this.of.length; i++) {
        const f = this.of[i]; let bd = 1e9, bk = -1;
        // 形の粗い差が小さい順に比べ、とても近いもの(差15未満)が見つかれば打ち切る(修正後の字形は差30以上で別の番号なので、それより近い別の字はない)
        const cand = [];
        protos.forEach((p, k) => { if (pre(p.f, f, f.mask ? 1.0 : 0.25)) { let s = 0; for (let q = 0; q < 64; q++) s += Math.abs(p.f.small[q] - f.small[q]); cand.push([s, k]); } });
        cand.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        for (const [, k] of cand) { const d = PC.maskedDiff(f.norm, protos[k].f.norm, f.mask); if (d < bd) { bd = d; bk = k; } if (bd < 15) break; }
        oids.push(bd < this.tolS ? bk : -1 - i); this.obest.push([bk, bd]);
        if (i % 60 === 59) { step('字形を照合しています', at(0.1 + 0.5 * i / this.of.length)); await PC.tick(); }
      }
      this.protos = protos; this.oids = oids; this.nids = nids;
      const firstOps = PC.opcodes(oids, nids);
      // 行ごとの雑音の大きさ(1回目で同じとした字どうしの差の中央値)。基準はその2.6倍(35〜tolL)
      const per = new Map();
      for (const [tag, i1, i2, j1] of firstOps) if (tag === 'equal') for (let q = 0; q < i2 - i1; q++) {
        const i = i1 + q; if (this.of[i].mask) continue;
        const l = this.ot[i].line; if (!per.has(l)) per.set(l, []); per.get(l).push(this.cmp(i, j1 + q));
      }
      step('並びを比べています', at(0.65)); await PC.tick();
      const allv = [].concat(...per.values()), pmed = allv.length ? median(allv) : 20, clip = (v, cap = this.tolL) => Math.min(cap, Math.max(35, v));
      // 小さい字(行の高さ24画素未満、およそ8.5ポイント未満)は、スキャンの雑音が大きいので上限をゆるめる
      const capOf = l => { const L = this.ol[l], e = L.vert ? L.box[2] - L.box[0] : L.box[3] - L.box[1]; return e >= 30 ? this.tolL : e <= 22 ? 70 : this.tolL + (70 - this.tolL) * (30 - e) / 8; };
      this.thr = new Map(); for (const [l, vs] of per) this.thr.set(l, clip(2.6 * (vs.length >= 4 ? median(vs) : pmed), capOf(l)));
      this.thrDef = clip(2.6 * pmed);
      this.ops = [];
      for (const op of firstOps) {
        const [tag, i1, i2, j1, j2] = op;
        if (tag === 'equal' || i2 === i1 || j2 === j1 || (i2 - i1) + (j2 - j1) > 3000 || (i2 - i1) * (j2 - j1) > 250000) { this.ops.push(op); continue; }
        for (const [t2, a1, a2, b1, b2] of PC.opcodesBy(i2 - i1, j2 - j1, (x, y) => this.same(i1 + x, j1 + y))) this.ops.push([t2, i1 + a1, i1 + a2, j1 + b1, j1 + b2]);
      }
    }
    th(i) { const l = this.ot[i].line; return this.thr.has(l) ? this.thr.get(l) : this.thrDef; }
    same(i, j) {
      const a = this.of[i], b = this.nf[j];
      if (Math.abs(a.h - b.h) > 3 || Math.abs(a.w - b.w) > 3) return false;
      return this.cmp(i, j) < (a.mask && this.instructed.has(i) ? this.tolM : this.th(i));
    }
    cmp(i, j) {
      const key = i * 1048576 + j;
      if (!this.cache.has(key)) this.cache.set(key, PC.maskedDiff(this.of[i].norm, this.nf[j].norm, this.of[i].mask));
      return this.cache.get(key);
    }
    // 赤字でほとんど隠れた字形だけが並ぶ区間(小さい字の取り消し線など)は、字形を比べても決められない。
    // スキャンと修正後で、その区間の端から端までの位置が同じなら「変わっていない」とみなす(「直っていない」の側に倒す)。
    // 戻り値: 差分として扱わない op の番号の集合
    heavyBlocks(H = 0.6) {
      const { ops, ot, nt, ol, of } = this, off = new Map();
      for (const [tag, i1, i2, j1] of ops) if (tag === 'equal') for (let q = 0; q < i2 - i1; q++) {
        const i = i1 + q; if (of[i].mask) continue;
        const l = ot[i].line; if (!off.has(l)) off.set(l, []); off.get(l).push([ot[i].box[0] - nt[j1 + q].box[0], ot[i].box[1] - nt[j1 + q].box[1]]);
      }
      const lo = l => off.has(l) ? [median(off.get(l).map(v => v[0])), median(off.get(l).map(v => v[1]))] : [0, 0];
      const nbox = (j, l) => { const [dx, dy] = lo(l), b = nt[j].box; return [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy]; };
      const hn = (j, l) => {
        const [x0, y0, x1, y1] = nbox(j, l).map(Math.round); let s = 0, c = 0;
        for (let y = Math.max(0, y0); y < Math.min(this.h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(this.w, x1); x++) { s += this.zone[y * this.w + x] ? 1 : 0; c++; }
        return c > 0 && s / c >= H;
      };
      // 赤字でほとんど隠れた字形。赤字のそばで欠けて小さくなった字のかけら(行の高さの6割未満)も含める
      const em = i => { const L = ol[ot[i].line]; return L.vert ? L.box[2] - L.box[0] : L.box[3] - L.box[1]; };
      const ho = i => of[i].mask && (of[i].mf >= H || (of[i].mf >= 0.2 && (ol[ot[i].line].vert ? of[i].w : of[i].h) < 0.6 * em(i)));
      const oline = k => {
        const [, i1, i2] = ops[k];
        if (i2 > i1) { const ls = new Set(ot.slice(i1, i2).map(t => t.line)); return ls.size === 1 ? [...ls][0] : null; }
        return i1 > 0 ? ot[i1 - 1].line : i1 < ot.length ? ot[i1].line : null;
      };
      const ok = (k, l) => {
        const [, i1, i2, j1, j2] = ops[k];
        if (l === null) return false;
        for (let i = i1; i < i2; i++) if (ot[i].line !== l || !ho(i)) return false;
        if (new Set(nt.slice(j1, j2).map(t => t.line)).size > 1) return false;
        for (let j = j1; j < j2; j++) if (!hn(j, l)) return false;
        return true;
      };
      const drop = new Set();
      for (let k = 0; k < ops.length;) {
        if (ops[k][0] === 'equal' || !ok(k, oline(k))) { k++; continue; }
        const l = oline(k); let a = k, b = k;
        while (a > 0 && ok(a - 1, l) && ops[a - 1][2] - ops[a - 1][1] + ops[a - 1][4] - ops[a - 1][3] > 0) a--;
        while (b + 1 < ops.length && ok(b + 1, l)) b++;
        const ob = [], nb = [];
        for (let q = a; q <= b; q++) { const [, i1, i2, j1, j2] = ops[q]; for (let i = i1; i < i2; i++) ob.push(ot[i].box); for (let j = j1; j < j2; j++) nb.push(nbox(j, l)); }
        // 字の数が合わない区間(赤字で字が欠けて切り分けが崩れた所)だけを対象にする。1字ずつ対応する所は、見えている部分の差を信じる
        let uneven = false; for (let q = a; q <= b; q++) if (ops[q][2] - ops[q][1] !== ops[q][4] - ops[q][3]) uneven = true;
        if (uneven && ob.length && nb.length) {
          // 区間のすぐ前・すぐ後の対応した字のずれ(行に沿った向き)で、修正後の位置をスキャンの位置に直して比べる。
          // 前後でずれが違えば、区間の中で字数が変わった(文章が詰まった・延びた)ということなので、変わっていないとはみなさない
          const L = ol[l], em = L.vert ? L.box[2] - L.box[0] : L.box[3] - L.box[1], [s0, s1] = L.vert ? [1, 3] : [0, 2];
          const near = (q, dir) => {
            for (let k2 = q + dir; k2 >= 0 && k2 < ops.length; k2 += dir) {
              const [t, i1, i2, j1, j2] = ops[k2];
              if (t !== 'equal' || i2 === i1) continue;
              const i = dir < 0 ? i2 - 1 : i1, j = dir < 0 ? j2 - 1 : j1;
              return ot[i].line === l ? ot[i].box[s0] - nt[j].box[s0] : null;
            }
            return null;
          };
          let dl = near(a, -1), dr = near(b, 1);
          if (dl === null && dr === null) dl = dr = lo(l)[L.vert ? 1 : 0];
          else if (dl === null) dl = dr; else if (dr === null) dr = dl;
          const u = union(ob), v = union(nb), base = lo(l)[L.vert ? 1 : 0];   // nb は行の中央値でずらしてあるので戻す
          const v0 = v[s0] - base + dl, v1 = v[s1] - base + dr;
          if (Math.abs(dl - dr) <= 0.4 * em && Math.abs(u[s0] - v0) <= 0.5 * em && Math.abs(u[s1] - v1) <= 0.5 * em) for (let q = a; q <= b; q++) if (ops[q][0] !== 'equal') drop.add(q);
        }
        k = b + 1;
      }
      return drop;
    }
    // 赤以外の書き込み(鉛筆・黒ペンなど)の字形: 修正後のどのブロックにも重ならないブロックで、修正後の字とほとんど形が合わないもの
    handwriting() {
      const blk = new Map(this.gblocks.map(b => [b.box.join(','), b])), hw = new Set(), per = new Map();
      this.ot.forEach((t, i) => {
        const b = blk.get(this.ol[t.line].blk.join(','));
        if (!b || b.rank !== Infinity) return;
        if (!per.has(b)) per.set(b, []);
        per.get(b).push(i);
      });
      for (const ks of per.values()) if (ks.filter(i => this.obest[i][1] < 60).length < 0.3 * ks.length) ks.forEach(i => hw.add(i));
      return hw;
    }
    // ---- 1段目: 違いの候補をすべて挙げる ----
    // [{ tag, oi: [i1, i2], nj: [j1, j2], pj, obox, nbox, hw, heavy }]
    //   hw: 赤以外の書き込みだけの候補、heavy: 赤字で字がほとんど隠れていて、前後の位置が合う候補
    candidates() {
      const out = [], drop = this.heavyBlocks(), { ot, nt } = this, hw = this.hw || (this.hw = this.handwriting());
      const ops = [];   // 書き込みの字形は、ほかの字形と別の候補にする
      for (const op of this.ops) {
        const [tag, i1, i2, j1, j2] = op;
        if (tag === 'equal' || i2 === i1) { ops.push(op); continue; }
        let a = i1; const mixed = [];
        for (let i = i1 + 1; i <= i2; i++) if (i === i2 || hw.has(i) !== hw.has(a)) { mixed.push([a, i, hw.has(a)]); a = i; }
        if (mixed.length === 1) { ops.push(op); continue; }
        const rest = mixed.filter(m => !m[2]);
        for (const [a1, a2, isHw] of mixed) if (isHw) ops.push(['delete', a1, a2, j1, j1]);
        if (rest.length) ops.push([j2 > j1 ? 'replace' : 'delete', rest[0][0], rest[rest.length - 1][1], j1, j2]);
        else if (j2 > j1) ops.push(['insert', i2, i2, j1, j2]);
      }
      ops.forEach(([tag, i1, i2, j1, j2]) => {
        if (tag === 'equal') return;
        const c = { tag, oi: [i1, i2], nj: [j1, j2], pj: j1 > 0 ? j1 - 1 : null, obox: i2 > i1 ? union(ot.slice(i1, i2).map(t => t.box)) : null, nbox: j2 > j1 ? union(nt.slice(j1, j2).map(t => t.box)) : null };
        c.hw = i2 > i1 && j2 === j1 && ot.slice(i1, i2).every((t, k) => hw.has(i1 + k));
        c.heavy = this.ops.some((o, q) => drop.has(q) && o[1] === i1 && o[2] === i2 && o[3] === j1 && o[4] === j2);
        const p = out[out.length - 1];   // 同じ行で1字以内に隣り合う候補はまとめる(書き込みどうし・それ以外どうしだけ)
        if (p && p.hw === c.hw && i1 - p.oi[1] <= 1 && j1 - p.nj[1] <= 1 && p.oi[1] > 0 && i1 < ot.length && ot[i1].line === ot[p.oi[1] - 1].line) {
          p.oi = [p.oi[0], i2]; p.nj = [p.nj[0], j2]; p.tag = 'replace'; p.heavy = p.heavy && c.heavy;
          p.obox = union([p.obox, c.obox].filter(Boolean)); p.nbox = union([p.nbox, c.nbox].filter(Boolean));
        } else out.push(c);
      });
      return out;
    }
    // ---- 2段目: 候補ごとに、本当に違うかを別の方法で確かめ直す ----
    // 誤検出と確かめられた候補だけを消し、確かめられないものは残す(見逃しを出さないため)。
    // 戻り値: 誤検出なら、その理由。残すなら null
    verify(c, log = null) {
      const no = m => { if (log) log.push(m); return null; };
      if (c.hw) return '赤以外の書き込み';
      if (c.heavy) return '赤字で字が隠れているが、前後の字の位置が合う';
      const { ot, nt, ol, nl } = this, [i1, i2] = c.oi, [j1, j2] = c.nj;
      if (j2 === j1) return no('修正後にない字');   // 修正後にない字(消えた字)は、そのまま残す
      // 修正後の字を行ごとに分け、それぞれスキャンのどこに重なるかを探す
      const segs = []; for (let j = j1; j < j2; j++) { const s = segs[segs.length - 1]; if (s && nt[s[s.length - 1]].line === nt[j].line) s.push(j); else segs.push([j]); }
      const pairs = this.pairList || (this.pairList = this.pairs());
      const off = (i, j) => [ot[i].box[0] - nt[j].box[0], ot[i].box[1] - nt[j].box[1]];
      const marked = ot.slice(i1, i2).some((t, k) => this.of[i1 + k].mask && this.instructed.has(i1 + k));
      const th = i1 < i2 ? this.th(i1) : this.thrDef, boxes = [];
      for (const js of segs) {
        const L = nl[nt[js[0]].line], em = L.vert ? L.box[2] - L.box[0] : L.box[3] - L.box[1], ax = L.vert ? 1 : 0;
        // 前後の対応した字(同じ行)のずれ。前と後でずれが違えば、間で字数が変わった(本当の挿入・削除)
        let before = null, after = null;
        for (const [i, j] of pairs) { if (j < js[0] && nt[j].line === nt[js[0]].line) before = [i, j]; if (j > js[js.length - 1] && nt[j].line === nt[js[0]].line && !after) after = [i, j]; }
        const sameO = q => q && (i1 >= i2 || ot[q[0]].line === ot[Math.min(Math.max(i1, 0), ot.length - 1)].line);
        const dl = before && sameO(before) ? off(...before) : null, dr = after && sameO(after) ? off(...after) : null;
        if (dl && dr && Math.abs(dl[ax] - dr[ax]) > 0.4 * em) return no(`前後のずれが違う ${dl} ${dr}`);
        // ずれの見込みは複数試す(前後の字の対応がずれていることがあるため): 前後の字のずれ・区間どうしの重なり・ずれなし
        const bases = [dl, dr, [0, 0]];
        if (i1 < i2) { const ob = union(ot.slice(i1, i2).map(t => t.box)), nb = union(js.map(j => nt[j].box)); bases.push([ob[0] - nb[0], ob[1] - nb[1]]); }
        let at = null;
        for (const b0 of bases) { if (!b0) continue; const r = this.locate(js, b0); if (r && (!at || r[2] < at[2])) at = r; }
        if (!at) return no('位置が見つからない');
        for (const j of js) {
          const [x0, y0, x1, y1] = nt[j].box, b = [x0 + at[0], y0 + at[1], x1 + at[0], y1 + at[1]], f = feats(this.Wi, b, nl[nt[j].line], this.pO, this.zone, 0, 1, this.halo);
          const dd = PC.maskedDiff(f.norm, this.nf[j].norm, f.mask);
          if (dd >= (f.mask && marked ? this.tolM : th)) return no(`字${j}の差 ${dd.toFixed(0)} 基準 ${th.toFixed(0)} ずれ ${at}`);
          boxes.push(b);
        }
      }
      // スキャン側に、修正後の字では説明できないインク(消えた字・増えた記号)がないか。ごく薄いインク(鉛筆など)は数えない
      if (i1 < i2) {
        const { w } = this, cov = (x, y) => boxes.some(b => x >= b[0] - 2 && x < b[2] + 2 && y >= b[1] - 2 && y < b[3] + 2);
        const dark = (this.pO[0] + this.pO[1] + this.pO[2] - this.iO[0] - this.iO[1] - this.iO[2]) / 3;
        let all = 0, rest = 0;
        for (let i = i1; i < i2; i++) {
          const [x0, y0, x1, y1] = ot[i].box;
          for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            const g = y * w + x; if (!this.oink[g] || this.zone[g]) continue;
            const d = this.W.d, v = Math.max(this.pO[0] - d[g * 4], this.pO[1] - d[g * 4 + 1], this.pO[2] - d[g * 4 + 2]);
            if (v < 0.35 * dark) continue;
            all++; if (!cov(x, y)) rest++;
          }
        }
        if (rest > Math.max(12, (marked ? 0.06 : 0.03) * all)) return no(`説明できないインク ${rest}/${all}`);
      }
      return '字の切り分け・位置の違い(同じ字)';
    }
    // 修正後の字の並び js を、スキャンのどこに重なるか。base(ずれの見込み)のまわり±6画素で、赤字の所を除いていちばん合う位置
    locate(js, base) {
      const { nt, W, w, h } = this, nb = union(js.map(j => nt[j].box)), bw = nb[2] - nb[0], bh = nb[3] - nb[1];
      if (bw <= 0 || bh <= 0) return null;
      const A = new Float32Array(bw * bh);
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const s = ((nb[1] + y) * w + nb[0] + x) * 3, v = Math.max(this.pN[0] - this.Nsf[s], this.pN[1] - this.Nsf[s + 1], this.pN[2] - this.Nsf[s + 2]);
        A[y * bw + x] = 255 - 255 * Math.min(1, Math.max(0, v / 200));
      }
      let best = null;
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const x0 = nb[0] + Math.round(base[0]) + dx, y0 = nb[1] + Math.round(base[1]) + dy;
        if (y0 < 0 || x0 < 0 || y0 + bh > h || x0 + bw > w) continue;
        let s = 0, c = 0;
        for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
          const g = (y0 + y) * w + x0 + x; if (this.zone[g]) continue;
          const r = W.d[g * 4], gg = W.d[g * 4 + 1], bb = W.d[g * 4 + 2];
          const v = this.halo[g] && r - Math.max(gg, bb) > 15 && gg - bb < 40 ? this.pO[0] - r : Math.max(this.pO[0] - r, this.pO[1] - gg, this.pO[2] - bb);
          s += Math.abs(A[y * bw + x] - (255 - 255 * Math.min(1, Math.max(0, v / 200)))); c++;
        }
        const e = c ? s / c : 0;
        if (!best || e < best[0]) best = [e, x0 - nb[0], y0 - nb[1]];
      }
      return best ? [best[1], best[2], best[0]] : null;
    }
    // 差分の一覧(1段目の候補のうち、2段目で誤検出と確かめられなかったもの)。消した候補と理由は removed に残す
    changes() {
      const all = this.candidates(), ok = all.map(c => this.verify(c));
      this.removed = [];
      // 残った候補は、隣り合う候補(間に対応した字が1つ以下。2段目で消えたものも含む)とまとめても確かめる
      // (字の切れ方の違いで、ずれが前後の候補に分かれることがあるため)
      const near = (p, q) => !p.hw && !q.hw && q.oi[0] - p.oi[1] <= 1 && q.nj[0] - p.nj[1] <= 1;
      all.forEach((c, k) => {
        if (ok[k] || c.hw) return;
        for (let span = 1; span <= 3 && !ok[k]; span++) for (let a = k - span; a <= k && !ok[k]; a++) {
          const b = a + span; if (a < 0 || b >= all.length) continue;
          let linked = true; for (let q = a; q < b; q++) if (!near(all[q], all[q + 1])) linked = false;
          if (!linked) continue;
          const why = this.verify({ tag: 'replace', oi: [all[a].oi[0], all[b].oi[1]], nj: [all[a].nj[0], all[b].nj[1]] });
          if (why) ok[k] = why + '（前後の候補とまとめて確認）';
        }
      });
      const out = [];
      all.forEach((c, k) => { if (ok[k]) this.removed.push({ c, why: ok[k] }); else out.push(c); });
      return out;
    }
    // 見た目で対応づいた字形の組 [スキャンの番号, 修正後の番号]
    pairs() { const P = []; for (const [tag, i1, i2, j1] of this.ops) if (tag === 'equal') for (let q = 0; q < i2 - i1; q++) P.push([i1 + q, j1 + q]); return P; }
    // 写真・図版: スキャン(赤字を消したもの)の画像を、修正後(スキャンに寄せた描画)から探す。相関0.9以上で見つかれば変化なし/移動
    imageChanges() {
      const { w, h } = this, out = [], og = PC.gray(this.O), ng = PC.toMat(PC.gray(this.sim), w, h);
      const iou = (a, c) => Math.max(0, Math.min(a[2], c[2]) - Math.max(a[0], c[0])) * Math.max(0, Math.min(a[3], c[3]) - Math.max(a[1], c[1]));
      for (const b of this.oblocks.filter(x => x.kind === 'image')) {
        const [x0, y0, x1, y1] = b.box, t = PC.sub(og, w, x0, y0, x1, y1, h), tpl = PC.toMat(t.a, t.w, t.h), res = new cv.Mat();
        cv.matchTemplate(ng, tpl, res, cv.TM_CCOEFF_NORMED);
        const mm = cv.minMaxLoc(res); tpl.delete(); res.delete();
        if (mm.maxVal >= 0.9) {
          if (Math.abs(mm.maxLoc.x - x0) <= 6 && Math.abs(mm.maxLoc.y - y0) <= 6) continue;
          out.push({ kind: 'moved', obox: b.box, nbox: [mm.maxLoc.x, mm.maxLoc.y, mm.maxLoc.x + x1 - x0, mm.maxLoc.y + y1 - y0] }); continue;
        }
        let best = null; for (const c of this.nblocks.filter(x => x.kind === 'image')) if (!best || iou(b.box, c.box) > iou(b.box, best.box)) best = c;
        if (!best || iou(b.box, best.box) === 0) { out.push({ kind: 'removed', obox: b.box }); continue; }
        out.push({ kind: 'changed', obox: b.box, nbox: best.box });
      }
      ng.delete();
      return out;
    }
    // 照合のあとは使わない大きな画像を手放す
    release() { this.Nt = this.Nsf = this.sim = this.N = this.oink = this.halo = null; this.cache = null; }
  };
})();
