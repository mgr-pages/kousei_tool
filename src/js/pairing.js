// 原稿のページが、成果物のどのページのどの範囲に当たるかを求める(ページの順番・数・大きさが違ってもよい)
//   手がかり: 画像の特徴点(ORB)の対応と、文字データの長い一致。位置の関係(拡大縮小・平行移動)がそろうものだけを数える
//   座標は pt(画像ファイルの原稿は、小さく描画した画像の画素を 60dpi とみなした値)
'use strict';
(function () {
  const VDPI = 60, PT = 72 / VDPI;
  const area = b => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const inter = (a, b) => area([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);
  const diag = b => Math.hypot(b[2] - b[0], b[3] - b[1]);

  const shrink = (img, w, h) => {
    const a = cv.matFromImageData(new ImageData(new Uint8ClampedArray(img.d), img.w, img.h)), b = new cv.Mat();
    cv.resize(a, b, new cv.Size(w, h), 0, 0, cv.INTER_AREA);
    const out = { w, h, d: new Uint8ClampedArray(b.data) }; a.delete(); b.delete();
    return out;
  };
  // 小さく描画した画像の特徴点(赤は白にしてから取る: 赤字が手がかりにならないように)
  function orbOf(img) {
    const g = PC.gray(img), r = PC.redMask(img);
    for (let i = 0; i < g.length; i++) if (r[i]) g[i] = 255;
    const m = PC.toMat(g, img.w, img.h), orb = new cv.ORB(3000, 1.2, 8, 15, 0, 2), kp = new cv.KeyPointVector(), des = new cv.Mat(), none = new cv.Mat();
    if (orb.setFastThreshold) orb.setFastThreshold(10);   // 薄い印刷・小さい画像でも特徴点が取れるように
    orb.detectAndCompute(m, none, kp, des);
    const pts = []; for (let k = 0; k < kp.size(); k++) { const p = kp.get(k).pt; pts.push([p.x * PT, p.y * PT]); }
    [m, orb, kp, none].forEach(o => o.delete());
    return { pts, des };
  }
  function visualPairs(a, b) {
    const P = [], Q = [];
    if (!a.des.rows || !b.des.rows) return { P, Q };
    const bf = new cv.BFMatcher(cv.NORM_HAMMING, false), mm = new cv.DMatchVectorVector();
    bf.knnMatch(a.des, b.des, mm, 2);
    for (let i = 0; i < mm.size(); i++) {
      const v = mm.get(i);
      if (v.size() === 2) { const x = v.get(0), y = v.get(1); if (x.distance < 0.8 * y.distance) { P.push(a.pts[x.queryIdx]); Q.push(b.pts[x.trainIdx]); } }
      v.delete();
    }
    bf.delete(); mm.delete();
    return { P, Q };
  }

  // 1つの組(原稿ページ a × 成果物ページ b)の対応: 当てはめた変換 T、手がかりの量、成果物での範囲
  //   画像の手がかりから求めた変換と文字の手がかりから求めた変換のうち、両方の手がかりをより多く説明するほうを使う
  function pairOf(a, b) {
    if (a.free) return pairFree(a, b);
    const pageB = [0, 0, b.w, b.h], dB = diag(pageB), dA = diag([0, 0, a.w, a.h]);
    const vis = visualPairs(a.orb, b.orb);
    const fv = vis.P.length >= 8 ? PC.fitSimilarity(vis.P, vis.Q, vis.P.map(() => 1), 5 * PT, { mode: 'sim' }) : null;
    const an = a.text && b.text ? PC.textAnchors(a.text.chars, b.text.chars, 6) : [];
    const aP = an.map(x => PC.center(a.text.chars[x.i].box)), aQ = an.map(x => PC.center(b.text.chars[x.j].box));
    const ft = an.length >= 2 ? PC.fitSimilarity(aP, aQ, an.map(x => x.n), 0.05 * dB, { mode: 'axis' }) : null;
    const nA = a.text ? a.text.chars.length : 0;
    const cover = xs => { if (!a.text) return 0; const c = new Uint8Array(nA); for (const x of xs) c.fill(1, x.i, x.i + x.n); return c.reduce((s, v) => s + v, 0); };
    const spread = ks => ks.length ? diag(PC.union(ks.map(k => [...vis.P[k], ...vis.P[k]]))) / dA : 0;
    // 画像の手がかりは、原稿のページを10×10に分けたます目のうち、手がかりのあるます目の数で数える
    // (同じ写真が両方にあるだけで、その写真の手がかりがページ全体の対応を決めてしまわないように)
    const cells = ks => new Set(ks.map(k => Math.min(9, Math.floor(vis.P[k][0] / a.w * 10)) * 10 + Math.min(9, Math.floor(vis.P[k][1] / a.h * 10)))).size;
    const evalT = (T, how) => {
      const errV = k => { const p = PC.applyT(T, ...vis.P[k]); return Math.hypot(p[0] - vis.Q[k][0], p[1] - vis.Q[k][1]); };
      const errA = k => { const p = PC.applyT(T, ...aP[k]); return Math.hypot(p[0] - aQ[k][0], p[1] - aQ[k][1]); };
      const vIn = vis.P.map((_, k) => k).filter(k => errV(k) < 6 * PT), loose = an.filter((_, k) => errA(k) < 0.06 * dB);
      const txt = cover(loose);
      return { T, how, vIn, loose, txt, score: txt + 15 * cells(vIn) };
    };
    const cands = [];
    if (fv && fv.inl.length >= 12) cands.push(evalT(fv.T, 'image'));
    if (ft && ft.score >= 12) cands.push(evalT(ft.T, 'text'));
    if (!cands.length) return null;
    const best = cands.reduce((x, y) => (y.score > x.score ? y : x));
    // 対応とみなす条件: 画像の手がかりがページの広い範囲で30以上そろう、または原稿の文字の4割以上(30字以上、3か所以上)が成果物の対応する位置にある
    //   (指示の書き込み1文だけが成果物の見出しと同じ、といった組を対応とみなさないように)。PDFどうしで2倍を超える拡大縮小はない
    const okV = best.vIn.length >= 30 && spread(best.vIn) >= 0.25 && cells(best.vIn) >= 6, okT = best.txt >= 30 && best.txt >= 0.4 * nA && best.loose.length >= 3;
    if (!(okV || okT) || (!a.image && (PC.scaleOf(best.T) < 0.5 || PC.scaleOf(best.T) > 2))) return null;
    const { T, vIn, loose } = best;
    // 原稿で手がかりのある範囲(手がかりを含む画像は画像全体) → 成果物での範囲
    const pts = [...vIn.map(k => vis.P[k]), ...loose.flatMap(x => a.text.chars.slice(x.i, x.i + x.n).map(c => PC.center(c.box)))];
    let src = PC.union(pts.map(p => [p[0], p[1], p[0], p[1]]));
    for (const ib of a.images || []) if (vIn.filter(k => vis.P[k][0] >= ib[0] && vis.P[k][0] <= ib[2] && vis.P[k][1] >= ib[1] && vis.P[k][1] <= ib[3]).length >= 5) src = PC.union([src, ib]);
    const m = 0.02 * dA, srcE = [src[0] - m, src[1] - m, src[2] + m, src[3] + m];
    const reg = PC.mapBox(T, srcE), region = [Math.max(0, reg[0]), Math.max(0, reg[1]), Math.min(b.w, reg[2]), Math.min(b.h, reg[3])];
    if (area(region) < 0.03 * area(pageB)) return null;
    // 同じレイアウト(原稿のページ全体が成果物のページの中にほぼそのまま収まり、内容の位置もそろう)か
    const pageMap = PC.mapBox(T, [0, 0, a.w, a.h]), inside = inter(pageMap, pageB) / Math.max(1, area(pageMap)), s = PC.scaleOf(T);
    //   文字データのある原稿: 原稿の文字の半分以上が、ほぼ同じ位置(ページの対角の1.2%以内)にある、または見た目の手がかりが100以上そろう
    //   (赤字で文章が送られたページは、文字の位置がずれるため)
    //   スキャン(文字データなし): 画像の手がかりが40以上そろう(文章が動いたページは、手がかりがページの一部に偏り、
    //   変換も少しずれるため、広がり・はみ出しは緩めに見る。細かな位置合わせはスキャンの照合でやり直す)
    const tightChars = () => {
      const ok = new Uint8Array(nA);
      for (const x of an) for (let t = 0; t < x.n; t++) {
        if (ok[x.i + t]) continue;
        const p = PC.applyT(T, ...PC.center(a.text.chars[x.i + t].box)), q = PC.center(b.text.chars[x.j + t].box);
        if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.012 * dB) ok[x.i + t] = 1;
      }
      return ok.reduce((n, v) => n + v, 0);
    };
    const same = nA >= 20 ? inside >= 0.9 && (a.image || Math.abs(s - 1) < 0.06) && Math.abs(PC.aspectOf(T) - 1) < 0.05 && (tightChars() >= 0.5 * nA || (vIn.length >= 100 && spread(vIn) >= 0.3))
      : inside >= 0.7 && (a.image || Math.abs(s - 1) < 0.1) && vIn.length >= 40;
    const Tt = cands.find(c => c.how === 'text'), Tv = cands.find(c => c.how === 'image');
    if (window.__pcDebug) (PC._pairDbg = PC._pairDbg || []).push({ vis: vIn.length, nv: vis.P.length, spread: +spread(vIn).toFixed(2), s: +s.toFixed(3), inside: +inside.toFixed(2), nA, tight: nA ? tightChars() : 0, how: best.how, same });
    return {
      T, how: best.how, score: best.score, vis: vIn.length, txt: best.txt, region, src: srcE, same,
      Tt: Tt && Tt.txt >= 0.4 * nA ? Tt.T : null, Tv: Tv && Tv.vIn.length >= 30 ? Tv.T : null,
      // 原稿のページが成果物のページの一部(見開きの片側など)に当たるときだけ、その部分を切り出して比べる
      crop: same && inter(pageMap, pageB) < 0.75 * area(pageB) ? [Math.max(0, pageMap[0]), Math.max(0, pageMap[1]), Math.min(b.w, pageMap[2]), Math.min(b.h, pageMap[3])] : null,
    };
  }

  // 位置の手がかりがない原稿(Excel・Word・テキストなどのデータファイル)の対応:
  //   原稿の文字のまとまり(2字以上)が、成果物のページの文字にそのまま含まれる量で決める。成果物での範囲は、含まれていた所を囲む範囲
  //   (数字の桁区切りの「,」は、あってもなくても同じとみなす)
  const keyStr = (cs, loose) => {
    let s = ''; const at = [];
    cs.forEach((c, j) => { if (loose && (c.k === ',' || c.k === '，') && /\d/.test((cs[j - 1] || {}).k || '') && /\d/.test((cs[j + 1] || {}).k || '')) return; s += c.k; at.push(j); });
    return { s, at };
  };
  PC.keyStr = keyStr;
  //   原稿の1ページ(表・文章)が成果物の何ページかに分かれて載ることや、支給された表の一部の行だけが載ることがあるため、
  //   まとまり(表の行・段落)の半分以上の字がそのまま含まれる所が2つ以上(まとまりが1つだけの原稿は1つ)あるページを候補にする
  //   (どのまとまりをどのページで照合するかは、照合のときに決める: PC.splitFree)
  function pairFree(a, b) {
    if (!b.text) return null;
    const B = b.kfree || (b.kfree = keyStr(b.text.chars, true)), byIt = new Map();
    a.text.chars.forEach(c => { if (!byIt.has(c.it)) byIt.set(c.it, []); byIt.get(c.it).push(c); });
    let all = 0, hit = 0; const boxes = [], found = new Set(), kh = new Map();
    for (const [it, cs] of byIt) {
      const k = keyStr(cs, true).s;
      if ([...k].length < 2) continue;
      all += k.length;
      const pos = B.s.indexOf(k);
      if (pos < 0) continue;
      hit += k.length; found.add(it); kh.set(it, k.length);
      boxes.push(PC.union(B.at.slice(pos, pos + k.length).map(j => b.text.chars[j].box)));
    }
    const blocks = a.blocks || [[0, a.text.chars.length]];
    const strong = blocks.filter(([s, e]) => {
      const its = new Set(); for (let i = s; i < e; i++) its.add(a.text.chars[i].it);
      let n = 0, h = 0; for (const it of its) { const k = keyStr(byIt.get(it), true).s.length; n += k; h += kh.get(it) || 0; }
      return n >= 2 && h >= 0.5 * n;
    }).length;
    if (hit < 8 || strong < Math.min(2, blocks.length)) return null;
    const u = PC.union(boxes), m = 0.02 * diag([0, 0, b.w, b.h]);
    return { T: null, free: true, how: 'text', score: hit, vis: 0, txt: hit, all, found, region: [Math.max(0, u[0] - m), Math.max(0, u[1] - m), Math.min(b.w, u[2] + m), Math.min(b.h, u[3] + m)], src: [0, 0, a.w, a.h], same: false, crop: null, Tt: null, Tv: null };
  }

  // 手がかりを集める: 原稿は src(PC.markSource)、成果物は newDoc
  async function cluesOf(get, n, step) {
    const out = [];
    for (let k = 0; k < n; k++) { out.push(await get(k)); if (step) step(k); await PC.tick(); }
    return out;
  }

  // 返り値: 原稿のページごとに { q: 成果物のページ番号(なければ -1), T, region, same, crop, score, how }
  PC.pairPages = async (src, newDoc, progress = () => {}) => {
    const N = await cluesOf(async q => {
      const img = await PC.renderPage(newDoc, q, VDPI, false), t = await PC.pageText(newDoc, q);
      return { w: t.w, h: t.h, orb: orbOf(img), text: t.chars.length ? t : null };
    }, newDoc.numPages, k => progress(`成果物 ${k + 1}/${newDoc.numPages} ページの特徴を読み取り`, 0.5 * (k + 1) / (newDoc.numPages + src.numPages)));
    const M = await cluesOf(async p => {
      const it = src.page(p);
      if (it.virt) { const t = it.virt.text; return { w: t.w, h: t.h, orb: null, text: t, blocks: it.virt.blocks, image: false, images: [], free: true }; }
      if (it.doc) {
        const img = await PC.renderPage(it.doc, it.i, VDPI, false), t = await PC.pageText(it.doc, it.i);
        return { w: t.w, h: t.h, orb: orbOf(img), text: t.chars.length ? t : null, image: false, images: await PC.imageBoxes(it.doc, it.i) };
      }
      const { img } = await src.image(p), k = 1000 / Math.max(img.w, img.h), small = shrink(img, Math.round(img.w * k), Math.round(img.h * k));
      return { w: small.w * PT, h: small.h * PT, orb: orbOf(small), text: null, image: true };
    }, src.numPages, k => progress(`原稿 ${k + 1}/${src.numPages} ページの特徴を読み取り`, 0.5 * (newDoc.numPages + k + 1) / (newDoc.numPages + src.numPages)));
    // 候補: ページの数が同じなら、まず同じ番号どうし(同じレイアウトと確かめられれば、ほかとは比べない)
    const cand = [], done = new Set();
    if (src.numPages === newDoc.numPages) for (let p = 0; p < src.numPages; p++) { const r = pairOf(M[p], N[p]); if (r && r.same) { cand.push({ p, q: p, ...r }); done.add(p); } }
    for (let p = 0; p < src.numPages; p++) {
      if (done.has(p)) continue;
      for (let q = 0; q < newDoc.numPages; q++) { const r = pairOf(M[p], N[q]); if (r) cand.push({ p, q, ...r }); }
      progress(`ページの対応を調べています（原稿 ${p + 1}/${src.numPages}）`, 0.5 + 0.5 * (p + 1) / src.numPages);
      await PC.tick();
    }
    // 手がかりの多い組から決める。同じ成果物ページで範囲が重なる組は、あとのほうを捨てる
    //   (似た原稿が何ページもあるとき、隣の原稿ページがすでにどれかの成果物ページに決まっているものを少し優先する)
    const res = Array.from({ length: src.numPages }, () => ({ q: -1 }));
    const clash = (x, y) => x.q === y.q && inter(x.region, y.region) >= 0.5 * Math.min(area(x.region), area(y.region));
    const left = cand.slice();
    while (left.length) {
      const near = c => res.some((r, p) => r.q >= 0 && Math.abs(p - c.p) === 1) ? 1.1 : 1;
      left.sort((x, y) => y.score * near(y) - x.score * near(x) || x.p - y.p || x.q - y.q);
      const c = left.shift();
      if (res[c.p].q >= 0 || (!c.free && res.some(r => r.q >= 0 && !r.free && clash(r, c)))) continue;
      res[c.p] = c;
    }
    // 位置の手がかりがない原稿: 候補のページ全部(手がかりの多い順)を持たせる
    res.forEach((r, p) => {
      if (!r.free) return;
      r.qs = cand.filter(c => c.p === p).sort((x, y) => y.score - x.score || x.q - y.q).map(c => ({ q: c.q, score: c.score, region: c.region }));
    });
    [...M, ...N].forEach(x => { if (x.orb) x.orb.des.delete(); });
    return res.map(r => r.q < 0 ? r : { q: r.q, T: r.T, Tt: r.Tt, Tv: r.Tv, region: r.region, src: r.src, same: r.same, crop: r.crop, score: r.score, how: r.how, vis: r.vis, txt: r.txt, free: !!r.free, qs: r.qs || null });
  };
})();
