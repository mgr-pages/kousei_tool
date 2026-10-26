// 照合の本体: 赤字原稿(紙のスキャン/注釈を入れたPDF) × 修正後PDF → 要確認箇所の一覧
'use strict';
(function () {
  const { ov, union } = PC;
  PC.CAT = {
    A: '赤字あり・変更あり（内容を人が確認）', A_IMG: '赤字あり・画像の変更あり（人が確認）',
    B: '赤字あり・変更なし（修正漏れの疑い）', B2: '続きの赤字（軽）',
    C1: '全体・以下同様で説明できる変更', C2: '指示外の変更（文字・組み）', C3: '指示外の変更（画像・図版・色・位置）',
    D: '全体・以下同様の直し忘れの候補', E: '見た目では分からない文字の違い',
    F: '指示箇所に結びつかない赤字（人が読む）', F2: '引き出し線・注記（指示箇所に付随）', G: '全体指示として読み取った注記',
    M: 'ママ・イキ（変更しない指示）どおり変更なし', H: '赤以外の書き込み（鉛筆・黒など）',
    T: '原稿と違う文字', V: '書き方だけの違い（全角・半角など）', N: '原稿にない文字', I: '原稿が画像の部分（文字では比べられない）',
    K: '原稿の指示（書き込み・コメント）', W: '成果物の書き込み（アタリ・確認事項）',
  };
  const KEEP = /ママ|イキ/;

  // 枠に中心が入る文字をつなげる(PyMuPDFのget_textboxに相当)
  const textIn = (cs, b) => b ? cs.filter(([, r]) => { const cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2; return cx >= b[0] && cx <= b[2] && cy >= b[1] && cy <= b[3]; }).map(c => c[0]).join('') : '';
  // 修正後の文字データを読み順に並べ、枠に重なる文字の前後pad字までをつなげる(行の折り返しをまたぐ語も確認できる)
  function around(cs, b, pad) {
    const idx = [];
    cs.forEach(([, r], i) => { const cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2; if (cx >= b[0] - 12 && cx <= b[2] + 12 && cy >= b[1] - 12 && cy <= b[3] + 12) idx.push(i); });
    if (!idx.length) return '';
    return cs.slice(Math.max(0, Math.min(...idx) - pad), Math.min(cs.length, Math.max(...idx) + pad + 1)).map(c => c[0]).join('').replace(/\s/g, '');
  }
  // 字形(トークン)に対応する文字: 中心が字形に入る文字 → 字形の中心を含む文字 → 近くの文字
  function tokText(cs, box) {
    const [x0, y0, x1, y1] = box, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const inside = cs.filter(([, b]) => x0 - 2 <= (b[0] + b[2]) / 2 && (b[0] + b[2]) / 2 <= x1 + 2 && y0 - 2 <= (b[1] + b[3]) / 2 && (b[1] + b[3]) / 2 <= y1 + 2);
    if (inside.length) return inside.map(c => c[0]).join('');
    const cont = cs.filter(([, b]) => b[0] - 1 <= cx && cx <= b[2] + 1 && b[1] - 1 <= cy && cy <= b[3] + 1);
    if (cont.length) return cont.reduce((p, q) => ((q[1][2] - q[1][0]) * (q[1][3] - q[1][1]) < (p[1][2] - p[1][0]) * (p[1][3] - p[1][1]) ? q : p))[0];
    let best = null, bd = Infinity;
    for (const c of cs) { const d = ((c[1][0] + c[1][2]) / 2 - cx) ** 2 + ((c[1][1] + c[1][3]) / 2 - cy) ** 2; if (d < bd) { bd = d; best = c; } }
    return best && Math.abs((best[1][0] + best[1][2]) / 2 - cx) < 40 && Math.abs((best[1][1] + best[1][3]) / 2 - cy) < 40 ? best[0] : '';
  }

  // 字形(トークン)の範囲 [a, b) に対応する文字を、位置つきで読み順に取り出す(tokText と同じ選び方)
  function tokChars(cs, T, a, b) {
    const out = [], seen = new Set();
    for (let k = Math.max(0, a); k < Math.min(T.length, b); k++) {
      const [x0, y0, x1, y1] = T[k].box;
      const inside = cs.filter(c => !seen.has(c) && x0 - 2 <= (c[1][0] + c[1][2]) / 2 && (c[1][0] + c[1][2]) / 2 <= x1 + 2 && y0 - 2 <= (c[1][1] + c[1][3]) / 2 && (c[1][1] + c[1][3]) / 2 <= y1 + 2);
      if (inside.length) { inside.forEach(c => seen.add(c)); out.push(...inside); continue; }
      const t = tokText(cs, T[k].box);
      if (t) out.push([t, T[k].box]);
    }
    return out;
  }
  // 挿入・削除の位置を示す細い枠(隣の字の境目)
  function caret(A, i) {
    const p = A[i - 1], q = A[i];
    if (!p && !q) return null;
    const vert = p && q ? Math.abs((q[1][1] + q[1][3]) - (p[1][1] + p[1][3])) > Math.abs((q[1][0] + q[1][2]) - (p[1][0] + p[1][2])) : false;
    if (p) { const b = p[1]; return vert ? [b[0], b[3] - 2, b[2], b[3] + 2] : [b[2] - 2, b[1], b[2] + 2, b[3]]; }
    const b = q[1]; return vert ? [b[0], b[1] - 2, b[2], b[1] + 2] : [b[0] - 2, b[1], b[0] + 2, b[3]];
  }
  // ピンポイントの違い: 変わった範囲の文字データを比べ、違う字だけを取り出す(表示用の並びと、違う字の位置)
  //   segs: [['=', 同じ字], ['-', 修正前だけの字], ['+', 修正後だけの字], ...]。前後の字(ctx)も添える
  function pinDiff(A, B, pre, post) {
    const ops = PC.opcodes(A.map(c => c[0]), B.map(c => c[0])), segs = [], ob = [], nb = [];
    const str = (X, i, j) => X.slice(i, j).map(c => c[0]).join('');
    if (pre.length) segs.push(['=', str(pre, 0, pre.length)]);
    for (const [tag, i1, i2, j1, j2] of ops) {
      if (tag === 'equal') { segs.push(['=', str(A, i1, i2)]); continue; }
      if (i2 > i1) segs.push(['-', str(A, i1, i2)]);
      if (j2 > j1) segs.push(['+', str(B, j1, j2)]);
      ob.push(i2 > i1 ? union(A.slice(i1, i2).map(c => c[1])) : caret(A, i1));
      nb.push(j2 > j1 ? union(B.slice(j1, j2).map(c => c[1])) : caret(B, j1));
    }
    if (post.length) segs.push(['=', str(post, 0, post.length)]);
    return { segs, same: !ops.some(o => o[0] !== 'equal'), ob: ob.filter(Boolean).map(b => b.map(Math.trunc)), nb: nb.filter(Boolean).map(b => b.map(Math.trunc)) };
  }

  // 文字の並び(コードポイント単位)の中から、文字列sの出現位置をすべて探す
  function findAll(cs, s) {
    if (s instanceof RegExp) {   // 型で探す(1字=1要素の並びを文字列にして、一致した範囲を要素の番号に戻す)
      const str = cs.map(c => c[0]).join(''), pos = [], out = []; let k = 0;
      cs.forEach(c => { pos.push(k); k += c[0].length; }); pos.push(k);
      const at = new Map(pos.map((v, i) => [v, i]));
      for (const m of str.matchAll(new RegExp(s.source, 'gu'))) { const a = at.get(m.index), b = at.get(m.index + m[0].length); if (a !== undefined && b !== undefined && b > a) out.push([a, b]); }
      return out;
    }
    const target = [...s], n = target.length, out = [];
    if (!n) return out;
    for (let i = 0; i + n <= cs.length; i++) { let ok = true; for (let k = 0; k < n && ok; k++) ok = cs[i + k][0] === target[k]; if (ok) out.push([i, i + n]); }
    return out;
  }

  // 修正前と修正後で字形の並びがまったく同じブロック(位置が近いもの同士を組にする)
  function sameBlocks(ot, ol, nt, nl, oids, nids) {
    const perBlock = (T, L, ids) => {
      const d = new Map();
      T.forEach((t, k) => { const key = L[t.line].blk.join(','); if (!d.has(key)) d.set(key, { box: L[t.line].blk, ks: [] }); d.get(key).ks.push(k); });
      for (const v of d.values()) v.seq = v.ks.map(k => ids[k]).join(',');
      return d;
    };
    const ob = perBlock(ot, ol, oids), nb = perBlock(nt, nl, nids), so = new Set(), sn = new Set(), uo = new Set(), un = new Set();
    const c = b => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], cand = [];
    for (const [bk, b] of ob) for (const [nk, n] of nb) if (b.seq === n.seq) cand.push([Math.hypot(c(b.box)[0] - c(n.box)[0], c(b.box)[1] - c(n.box)[1]), bk, nk]);
    cand.sort((p, q) => p[0] - q[0] || (p[1] < q[1] ? -1 : p[1] > q[1] ? 1 : 0) || (p[2] < q[2] ? -1 : p[2] > q[2] ? 1 : 0));
    for (const [, bk, nk] of cand) {
      if (uo.has(bk) || un.has(nk)) continue;
      uo.add(bk); un.add(nk); ob.get(bk).ks.forEach(k => so.add(k)); nb.get(nk).ks.forEach(k => sn.add(k));
    }
    return [so, sn];
  }

  // 文字は同じだが、段落の始まり(改行・追い込み・字下げ)が変わった箇所
  function layoutChanges(ot, ol, nt, nl, pairs) {
    const out = [], fo = new Map(), fn = new Map();
    ol.forEach(l => { if (l.toks.length) fo.set(l.toks[0], l); }); nl.forEach(l => { if (l.toks.length) fn.set(l.toks[0], l); });
    for (const [k, m] of pairs) {
      const po = fo.has(k) && fo.get(k).para, pn = fn.has(m) && fn.get(m).para;
      if (po !== pn) out.push({ kind: 'text', tag: 'layout', oi: [k, k + 1], nj: [m, m + 1], obox: ot[k].box, nbox: nt[m].box, show: pn ? '（改行・段落の追加）' : '（追い込み・段落の解除）', before: '', after: '', nline: '' });
    }
    return out;
  }


  // 表示用の画像(赤字原稿を薄く／修正後を薄く)をJPEGにして手放す
  const blend = img => { const d = new Uint8ClampedArray(img.d.length); for (let k = 0; k < d.length; k++) d[k] = (k & 3) === 3 ? 255 : Math.round(img.d[k] * 0.55 + 255 * 0.45); return { w: img.w, h: img.h, d }; };
  //   大きなページ(A3・見開きなど)は長い辺を2400画素までに縮める(w, h は元の大きさ。表示のときに縮めた分を戻す)
  async function toThumb(img) {
    let c = PC.toCanvas(blend(img));
    const k = Math.min(1, 2400 / Math.max(img.w, img.h));
    if (k < 1) { const d = document.createElement('canvas'); d.width = Math.round(img.w * k); d.height = Math.round(img.h * k); d.getContext('2d').drawImage(c, 0, 0, d.width, d.height); c = d; }
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    return { url: URL.createObjectURL(blob), w: img.w, h: img.h };
  }

  // 差分に、文字(修正前→修正後)とピンポイントの違いを付ける(注釈PDF・スキャン共通)
  function describe(ch, ot, ol, nt, nl, oc, nc) {
    const tt = (cs, T, a, b) => { let s = ''; for (let k = Math.max(0, a); k < Math.min(T.length, b); k++) s += tokText(cs, T[k].box); return s; };
    for (const c of ch) {
      if (!c.obox) { const k = Math.max(0, c.oi[0] - 1), b = ot[k].box; c.obox = ol[ot[k].line].vert ? [b[0], b[3] - 3, b[2], b[3] + 3] : [b[2] - 3, b[1], b[2] + 3, b[3]]; }
      if (!c.nbox && (c.pj !== null || c.nj[0] < nt.length)) {
        if (c.pj !== null) { const b = nt[c.pj].box; c.nbox = nl[nt[c.pj].line].vert ? [b[0], b[3] - 3, b[2], b[3] + 3] : [b[2] - 3, b[1], b[2] + 3, b[3]]; }
        else { const b = nt[c.nj[0]].box; c.nbox = nl[nt[c.nj[0]].line].vert ? [b[0], b[1] - 3, b[2], b[1] + 3] : [b[0] - 3, b[1], b[0] + 3, b[3]]; }
      }
      c.kind = 'text';
      c.before = tt(oc, ot, c.oi[0], c.oi[1]); c.after = tt(nc, nt, c.nj[0], c.nj[1]);
      c.show = `${tt(oc, ot, c.oi[0] - 1, c.oi[1] + 1)}→${tt(nc, nt, c.nj[0] - 1, c.nj[1] + 1)}`;
      c.nline = nl.filter(l => l.toks.length && c.nbox && ov(l.box, c.nbox)).map(l => tt(nc, nt, l.toks[0], l.toks[l.toks.length - 1] + 1)).join('');
      const A = tokChars(oc, ot, c.oi[0], c.oi[1]), B = tokChars(nc, nt, c.nj[0], c.nj[1]);
      if (A.length || B.length) c.diff = pinDiff(A, B, tokChars(oc, ot, c.oi[0] - 6, c.oi[0]), tokChars(oc, ot, c.oi[1], c.oi[1] + 6));   // 文字データがなければ作らない
    }
  }
  // 指示に使われなかった赤字のまとまり(注記・印鑑など)
  //   書き込みの字の間(全角の空き)でまとまりが分かれないよう、横に広めに膨らませてまとめる。
  //   丸の中に字がある印鑑(閉じた輪で、中に印刷の字がない)は stamp とする
  function restBoxesOf(rm, used, w, h) {
    const rest = new Uint8Array(rm.length); for (let k = 0; k < rm.length; k++) rest[k] = rm[k] && !used[k] ? 1 : 0;
    const rc = PC.cc(PC.morph(rest, w, h, 'dilate', 45, 25), w, h), comps = new Map();
    for (let i = 0; i < rest.length; i++) if (rest[i]) { const l = rc.lab[i]; let c = comps.get(l); if (!c) comps.set(l, c = []); c.push(i); }
    const out = [];
    for (const [j, px] of comps) {
      if (px.length < 60) continue;
      const s = rc.st[j], b = [s.x0, s.y0, s.x1 + 1, s.y1 + 1];
      const bw = b[2] - b[0], bh = b[3] - b[1];
      let stamp = false;
      if (bw >= 60 && bh >= 60 && bw < 3.5 * PC.DPI / 2.54 && bh < 3.5 * PC.DPI / 2.54 && bw / bh > 0.7 && bw / bh < 1.4) {   // 3.5cm角までの丸いもの
        const m = new Uint8Array(bw * bh); for (const i of px) m[(Math.floor(i / w) - b[1]) * bw + (i % w) - b[0]] = 255;
        const cm = PC.toMat(PC.morph(m, bw, bh, 'close', 5, 5), bw, bh), cn = new cv.MatVector(), hi = new cv.Mat();
        cv.findContours(cm, cn, hi, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);
        for (let k = 0; k < cn.size(); k++) { const c = cn.get(k); if (hi.intPtr(0, k)[3] >= 0 && cv.contourArea(c) >= 0.25 * bw * bh) stamp = true; c.delete(); }
        cm.delete(); cn.delete(); hi.delete();
      }
      out.push({ box: b, px, stamp });
    }
    return out;
  }
  // 指示箇所(赤字)につながる書き込みのうち、指示箇所からいちばん遠い所(引き出し線の先)のまわり = 何に直すかの書き込み
  function noteBoxOf(r, abox, w) {
    const cx = (abox[0] + abox[2]) / 2, cy = (abox[1] + abox[3]) / 2; let fx = 0, fy = 0, fd = -1;
    for (const i of r.px) { const x = i % w, y = Math.floor(i / w), d = (x - cx) ** 2 + (y - cy) ** 2; if (d > fd) { fd = d; fx = x; fy = y; } }
    let b = null;
    for (const i of r.px) { const x = i % w, y = Math.floor(i / w); if (Math.abs(x - fx) > 260 || Math.abs(y - fy) > 260) continue; b = b ? [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x + 1), Math.max(b[3], y + 1)] : [x, y, x + 1, y + 1]; }
    return b;
  }
  // [1,2,3,5] → 「1〜3・5」
  const spans = ns => { const out = []; for (let k = 0; k < ns.length; k++) { let e = k; while (e + 1 < ns.length && ns[e + 1] === ns[e] + 1) e++; out.push(e > k ? `${ns[k]}〜${ns[e]}` : `${ns[k]}`); k = e; } return out.join('・'); };
  const imageShow = c => { c.show = { changed: '画像・図版の変化', moved: '画像・図版の移動', removed: '画像・図版の削除' }[c.kind]; };

  // 注釈を入れたPDFのページ: 注釈を消した描画が修正前、注釈ありとの描画の差が赤字
  async function annotPage(src, p, nw, nc, cb, step) {
    const { doc, i } = src.page(p);
    const old = await PC.renderPage(doc, i, PC.DPI, false), oc = await PC.textChars(doc, i);
    step('文字のまとまりを解析', 0.1); await PC.tick();
    const oink = PC.textInk(old), nink = PC.textInk(nw);
    const ob = PC.blocks(old, oink), nb = PC.blocks(nw, nink);
    const { toks: ot, lines: ol } = PC.tokens(old, oink, ob), { toks: nt, lines: nl } = PC.tokens(nw, nink, nb);
    step('字形を照合', 0.25); await PC.tick();
    const oids = [], nids = [];
    for (let k = 0; k < ot.length; k++) { oids.push(cb.id(old, ot[k], ol[ot[k].line])); if (k % 80 === 79) await PC.tick(); }
    for (let k = 0; k < nt.length; k++) { nids.push(cb.id(nw, nt[k], nl[nt[k].line])); if (k % 80 === 79) await PC.tick(); }
    step('変更箇所を検出', 0.55); await PC.tick();
    const sk = sameBlocks(ot, ol, nt, nl, oids, nids), lookPairs = [], ch = PC.textChanges(cb, ot, nt, oids, nids, old, nw, ol, nl, sk, lookPairs);
    const oi_ = [], ni_ = []; for (let k = 0; k < oids.length; k++) if (!sk[0].has(k)) oi_.push(k); for (let k = 0; k < nids.length; k++) if (!sk[1].has(k)) ni_.push(k);
    const pairs = PC.pairs(oi_.map(k => oids[k]), ni_.map(k => nids[k])).map(([a, b]) => [oi_[a], ni_[b]]);
    if (sk[0].size === sk[1].size) { const a = [...sk[0]].sort((x, y) => x - y), b = [...sk[1]].sort((x, y) => x - y); a.forEach((k, i) => pairs.push([k, b[i]])); }
    const merged = [];   // 同じ行で1字以内に隣接する差分は1件にまとめる
    for (const c of ch) {
      const q = merged[merged.length - 1];
      if (q && c.oi[0] - q.oi[1] <= 1 && c.nj[0] - q.nj[1] <= 1 && q.oi[1] > 0 && c.oi[0] < ot.length && ot[c.oi[0]].line === ot[q.oi[1] - 1].line) {
        q.oi = [q.oi[0], c.oi[1]]; q.nj = [q.nj[0], c.nj[1]]; q.tag = 'replace';
        q.obox = union([q.obox, c.obox].filter(Boolean)); q.nbox = union([q.nbox, c.nbox].filter(Boolean));
      } else merged.push(c);
    }
    describe(merged, ot, ol, nt, nl, oc, nc);
    merged.push(...layoutChanges(ot, ol, nt, nl, pairs));
    const im = PC.imageChanges(old, nw, ob, nb); im.forEach(imageShow);
    step('赤字を読み取り', 0.7); await PC.tick();
    const notes = await PC.annotations(doc, i), withA = await PC.renderPage(doc, i, PC.DPI, true);
    const { rm, shown } = PC.fromAnnots(withA, old, notes);
    const { an, used } = PC.anchors(rm, old.w, old.h, ol.filter(l => l.toks.length), ot, ob.filter(b => b.kind === 'image'));
    for (const n of notes) {   // 挿入の注釈は位置情報から直接読む
      if (n.type !== 'Caret') continue;
      const [x0, y0, x1] = n.box;
      for (const l of ol) {
        const lb = l.box, h = lb[3] - lb[1];
        if (!l.vert && lb[1] - 0.3 * h <= y0 && y0 <= lb[3] + 0.6 * h && lb[0] <= x0 && x0 <= lb[2]) {
          const ks = l.toks.filter(k => (x0 - h / 2 <= ot[k].box[2] && ot[k].box[2] <= x1 + h / 2) || (x0 - h / 2 <= ot[k].box[0] && ot[k].box[0] <= x1 + h / 2));
          if (ks.length) { an.push({ kind: 'insert', at: Math.min(...ks) + 1, span: [Math.min(...ks), Math.max(...ks) + 1], how: '挿入(注釈)', box: n.box.map(Math.trunc), stroke: -1, note: n.text }); break; }
        }
      }
    }
    // 取り消し線・下線・マーカーの注釈: 引いた範囲に重なる字形を指示箇所にする
    const MK = { StrikeOut: '取消線(注釈)', Underline: '下線(注釈)', Squiggly: '波線(注釈)', Highlight: 'マーカー(注釈)' };
    for (const n of notes) {
      if (!PC.MARKUP.has(n.type) || !n.quads.length) continue;
      const area = b => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]), inter = (p_, q) => area([Math.max(p_[0], q[0]), Math.max(p_[1], q[1]), Math.min(p_[2], q[2]), Math.min(p_[3], q[3])]);
      const toks = new Set(); ot.forEach((t, k) => { if (n.quads.some(q => inter(t.box, q) >= 0.4 * area(t.box))) toks.add(k); });
      const box = union(n.quads).map(Math.trunc);
      if (toks.size) an.push({ kind: 'tokens', toks, how: MK[n.type], box, stroke: -1, note: n.text });
      else if (ob.some(b => b.kind === 'image' && ov(b.box, box))) an.push({ kind: 'image', how: MK[n.type], box, stroke: -1, note: n.text });
    }
    for (const a of an) if (a.note === undefined) a.note = (notes.find(n => n.type !== 'Caret' && ov(n.box, a.box, 8)) || {}).text || (notes.find(n => n.type === 'Caret' && ov(n.box, a.box, 2)) || {}).text || '';
    return { kind: 'annot', ot, ol, nt, nl, ch: merged, im, an, notes, pairs: [...pairs, ...lookPairs], oc, nc, restBoxes: restBoxesOf(rm, used, old.w, old.h), left: shown, right: nw, w: old.w };
  }

  // スキャンの字形の文字(推定): 見た目で対応づいた修正後の字の文字。対応しない字形は、見た目がいちばん近い修正後の字の文字
  // (十分近いときだけ)、なければ「□」
  function synthChars(sp, nc) {
    const pm = new Map(sp.pairs()), out = [];
    sp.ot.forEach((t, i) => {
      let j = pm.get(i);
      const paired = j !== undefined;
      if (!paired) { const [k, d] = sp.obest[i]; j = k >= 0 && d < sp.tolS && sp.of[i].mf < 0.6 ? sp.protos[k].j : -1; }   // 似た別の字を当てないよう厳しめ
      const cs = j >= 0 ? tokChars(nc, sp.nt, j, j + 1) : [];
      if (cs.length) cs.forEach(([c]) => out.push([c, t.box]));
      else if (!paired) out.push(['□', t.box]);
    });
    return out;
  }
  // 紙の赤字原稿(スキャン)のページ: スキャンを修正後に重ねて字形を比べる。修正前の文字は、修正後の文字から推定する
  async function scanPage(src, p, nw, nc, step) {
    step('スキャンを読み込み', 0.02); await PC.tick();
    const { img, dpi } = await src.image(p);
    step('位置を合わせています', 0.05); await PC.tick();
    const { W, matched } = PC.registerScan(img, nw, dpi);
    const sp = await new PC.ScanPage(W, nw).init((s, f) => step(s, 0.08 + 0.77 * f));
    const pairs = sp.pairs(), oc = synthChars(sp, nc), ch = sp.changes();
    describe(ch, sp.ot, sp.ol, sp.nt, sp.nl, oc, nc);
    ch.push(...layoutChanges(sp.ot, sp.ol, sp.nt, sp.nl, pairs));
    step('写真・図版を比べています', 0.86); await PC.tick();
    const im = sp.imageChanges(); im.forEach(imageShow);
    step('赤字を読み取り', 0.9); await PC.tick();
    const { w, h } = nw, rm = PC.morph(sp.pen, w, h, 'open', 2, 2);
    // 赤以外の書き込みだけの行は、赤字の指す先にしない(書き込みに重ねた赤字は「読み取れない赤字」になる)
    const hw = sp.hw || (sp.hw = sp.handwriting());
    const { an, used } = PC.anchors(rm, w, h, sp.ol.filter(l => l.toks.length && !l.toks.every(k => hw.has(k))), sp.ot, sp.oblocks.filter(b => b.kind === 'image'));
    // 修正後で赤く印刷されている字の範囲に収まる赤は、赤字ではなく「赤い文字そのものが変わった」可能性が高い
    // (修正前のPDFがないため、変わった赤い文字は印刷の赤と見分けられない)。指示どおりの変更とはみなさない
    const nred = PC.redMask(nw), zone = new Uint8Array(w * h);
    for (const t of sp.nt) {
      const [x0, y0, x1, y1] = t.box; let r = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (nred[y * w + x]) r++;
      if (r < 0.15 * (x1 - x0) * (y1 - y0)) continue;
      for (let y = Math.max(0, y0 - 3); y < Math.min(h, y1 + 3); y++) zone.fill(1, y * w + Math.max(0, x0 - 3), y * w + Math.min(w, x1 + 3));
    }
    const sc = PC.cc(PC.morph(rm, w, h, 'dilate', 5, 5), w, h), inZ = new Float64Array(sc.n), all = new Float64Array(sc.n);
    for (let k = 0; k < rm.length; k++) if (rm[k]) { const l = sc.lab[k]; all[l]++; if (zone[k]) inZ[l]++; }
    for (const a of an) { a.note = ''; a.printedLike = a.stroke > 0 && all[a.stroke] > 0 && inZ[a.stroke] >= 0.9 * all[a.stroke]; }
    const res = { kind: 'scan', ot: sp.ot, ol: sp.ol, nt: sp.nt, nl: sp.nl, ch, im, an, notes: [], pairs, oc, nc, restBoxes: restBoxesOf(rm, used, w, h), left: W, right: nw, matched, w };
    if (window.__pcDebug) { res.sp = sp; res.removed = sp.removed.map(r => ({ oi: r.c.oi, nj: r.c.nj, obox: r.c.obox, nbox: r.c.nbox, why: r.why })); } else sp.release();
    return res;
  }

  // 見た目が似た別の字(修正後の文字データだけで調べる): カタカナの間の漢字・記号、漢字の間のカタカナ
  const TO_KATA = { '一': 'ー', '−': 'ー', '‐': 'ー', '－': 'ー', '―': 'ー', '─': 'ー', '口': 'ロ', '力': 'カ', '工': 'エ', '二': 'ニ', '八': 'ハ', '卜': 'ト', '夕': 'タ', '才': 'オ' };
  const TO_KAN = { 'ー': '一', 'ロ': '口', 'カ': '力', 'エ': '工', 'ニ': '二', 'ハ': '八', 'ト': '卜', 'タ': '夕', 'オ': '才' };
  const isKata = c => /^[ァ-ヺー]$/.test(c), isKan = c => /^\p{Script=Han}$/u.test(c);
  function lookalikeChars(cs) {
    const out = [], near = (a, b) => { const s = Math.max(a[2] - a[0], a[3] - a[1], b[2] - b[0], b[3] - b[1]); return Math.hypot((a[0] + a[2] - b[0] - b[2]) / 2, (a[1] + a[3] - b[1] - b[3]) / 2) < 1.6 * s; };
    for (let i = 1; i + 1 < cs.length; i++) {
      const [c, b] = cs[i], [a, pb] = cs[i - 1], [z, qb] = cs[i + 1];
      let want = null;
      if (TO_KATA[c] && isKata(a) && isKata(z)) want = TO_KATA[c];
      else if (TO_KAN[c] && isKan(a) && isKan(z)) want = TO_KAN[c];
      if (want && near(pb, b) && near(b, qb)) out.push({ c, want, box: b, ctx: [a, z] });
    }
    return out;
  }

  // ---- 全体に関わる修正(全体指示・以下同様)を赤字原稿から読み取るための小道具 ----
  const isWord = s => [...s].length >= 2 && !s.includes('□') && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]/u.test(s);
  const known = s => [...s].filter(c => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]/u.test(c)).length;   // □以外の、語になる字の数
  // 修正後の文字の並びで、枠に入る文字(text)の前後n字。枠に中心が入る文字がなければ、近くにある同じ文字列を探す
  function ctxOf(cs, b, text, n = 8) {
    if (!b) return null;
    let i0 = -1, i1 = -1;
    cs.forEach(([, r], i) => { const cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2; if (cx >= b[0] - 3 && cx <= b[2] + 3 && cy >= b[1] - 3 && cy <= b[3] + 3) { if (i0 < 0) i0 = i; i1 = i; } });
    if (i0 < 0 && text) {
      const bx = (b[0] + b[2]) / 2, by = (b[1] + b[3]) / 2; let best = 60;
      for (const [s, e] of findAll(cs, text)) { const u = union(cs.slice(s, e).map(c => c[1])), d = Math.hypot((u[0] + u[2]) / 2 - bx, (u[1] + u[3]) / 2 - by); if (d < best) { best = d; i0 = s; i1 = e - 1; } }
    }
    if (i0 < 0) return null;
    return [cs.slice(Math.max(0, i0 - n), i0).map(c => c[0]).join(''), cs.slice(i1 + 1, i1 + 1 + n).map(c => c[0]).join('')];
  }
  // どの箇所にも共通する前後の文字(同じ変更が何か所にもあるとき、語の形にそろえる)
  function commonCtx(cx) {
    if (!cx.length || cx.some(c => !c)) return ['', ''];
    let [L, R] = cx[0];
    for (const [l, r] of cx) {
      let k = 0; while (k < L.length && k < l.length && L[L.length - 1 - k] === l[l.length - 1 - k]) k++;
      L = L.slice(L.length - k);
      k = 0; while (k < R.length && k < r.length && R[k] === r[k]) k++;
      R = R.slice(0, k);
    }
    const stop = /[\s、。，．,.・：:；;！!？?（）()「」『』【】［］\[\]]/;   // 句読点・かっこの外までは広げない
    while (L && stop.test(L[0])) L = L.slice(1);
    for (let k = L.length - 1; k >= 0; k--) if (stop.test(L[k])) { L = L.slice(k + 1); break; }
    for (let k = 0; k < R.length; k++) if (stop.test(R[k])) { R = R.slice(0, k); break; }
    return [L, R];
  }
  // □(推定できなかった字)を含む語の型: □は1〜3字の、句読点・空白以外の字
  const patternOf = s => new RegExp([...s].map(c => c === '□' ? '[^\\s、。，．,.]{1,3}' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(''), 'u');
  // 推定できなかった字(□)はどの字とも合うとみなして、同じ並びか
  const fits = (a, b) => { const x = [...a], y = [...b]; return x.length === y.length && x.every((c, k) => c === '□' || y[k] === '□' || c === y[k]); };
  const mergeKnown = (a, b) => { const y = [...b]; return [...a].map((c, k) => (c === '□' ? y[k] : c)).join(''); };
  // 「A」→「B」の変わった部分だけ(前後の同じ文字を除く)
  function splitCore(frm, to) {
    const a = [...frm], b = [...to]; let s = 0, e = 0;
    while (s < a.length && s < b.length && a[s] === b[s]) s++;
    while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
    return { b: a.slice(s, a.length - e).join(''), a: b.slice(s, b.length - e).join(''), head: a.slice(0, s).join(''), tail: a.slice(a.length - e).join('') };
  }
  const coreOf = (frm, to) => { const c = splitCore(frm, to); return [c.b, c.a]; };

  // ---- レイアウトが違うページ(内容で照合する): 原稿の文字データを、成果物の文字データと並べ替えに強いやり方で対応づける ----
  async function contentPage(src, p, pr, nq, step) {
    const { doc, i } = src.page(p);
    step('文字データを読み取り', 0.1); await PC.tick();
    const A = await PC.pageText(doc, i), annots = await PC.annotations(doc, i, 72), imgs = await PC.imageBoxes(doc, i);
    step('文字を照合', 0.3); await PC.tick();
    // 成果物の文字データがほとんどない(文字がアウトライン化・画像化されている)ページは、文字では比べない(すべて「ない」と出てしまうため)
    const noText = nq.B.chars.length < Math.max(10, 0.2 * A.chars.length);
    const blocks = noText ? [] : PC.collatePage(A, nq.B, pr, nq.used, nq.notes);
    step('表示用の画像を作成', 0.8); await PC.tick();
    const left = await PC.renderPage(doc, i, PC.DPI, true), k = PC.S;
    return {
      kind: 'content', q: pr.q, pr, A, annots, imgs, blocks, nq, extra: [], noText,
      ch: [], im: [], an: [], notes: annots.map(n => ({ ...n, box: n.box.map(v => v * k) })), restBoxes: [], ot: [], nt: [], pairs: [], nc: [],
      oc: A.chars.map(c => [c.c, c.box.map(v => v * k)]), w: left.w,
      thumbs: { left: await toThumb(left), right: nq.thumb },
    };
  }
  // 対応する成果物のページがない原稿のページ(または、レイアウトが違う紙の原稿): 原稿の画像だけ
  async function nonePage(src, p) {
    const it = src.page(p), img = it.doc ? await PC.renderPage(it.doc, it.i, PC.DPI, true) : (await src.image(p)).img;
    return { kind: 'none', q: -1, ch: [], im: [], an: [], notes: [], restBoxes: [], ot: [], nt: [], pairs: [], oc: [], nc: [], extra: [], w: img.w, thumbs: { left: await toThumb(img), right: null } };
  }
  // 内容で照合したページの残り: 成果物の字のうち、どの原稿にも対応しなかったもの(原稿にない文字・原稿が画像の部分)と、成果物の書き込み
  //   成果物の字は、その位置を範囲に含む原稿のページ(なければいちばん近い範囲)に割り当てる
  function leftovers(P, NQ) {
    const k = PC.S;
    const dist = (pt, b) => Math.hypot(Math.max(b[0] - pt[0], 0, pt[0] - b[2]), Math.max(b[1] - pt[1], 0, pt[1] - b[3]));
    for (const [q, nq] of NQ) {
      const ds = P.filter(d => d.kind === 'content' && d.q === q);
      if (!ds.length) continue;
      const { B, used, notes } = nq;
      const owner = pt => {   // 範囲の中なら範囲の中心がいちばん近いもの、どの範囲にも入らなければ範囲がいちばん近いもの
        let best = null, bd = Infinity;
        for (const d of ds) { const R = d.pr.region, out = dist(pt, R), c = PC.center(R), key = out > 0 ? 1e6 + out : Math.hypot(pt[0] - c[0], pt[1] - c[1]); if (key < bd) { bd = key; best = d; } }
        return best;
      };
      // 字のまとまり(item)ごとに、使われなかった字をまとめる。近いまとまりどうしはつなげる
      const groups = [];
      B.items.forEach((it, idx) => {
        const js = []; B.chars.forEach((c, j) => { if (c.it === idx && !used[j]) js.push(j); });
        const isNote = notes.has(idx);
        if (!js.length || (!isNote && !js.some(j => /[\p{L}\p{N}]/u.test(B.chars[j].c)))) return;
        const box = PC.union(js.map(j => B.chars[j].box)), g = groups[groups.length - 1];
        const close = g && g.note === isNote && PC.gap(box, g.box) < 1.2 * Math.max(it.size, g.size);
        if (close) { g.js.push(...js); g.box = PC.union([g.box, box]); g.size = Math.max(g.size, it.size); }
        else groups.push({ js, box, note: isNote, size: it.size });
      });
      for (const d of ds) d.nc = [];
      B.chars.forEach(c => owner(PC.center(B.items[c.it].box)).nc.push([c.c, c.box.map(v => v * k)]));
      const far = 0.08 * Math.hypot(B.w, B.h);   // どの原稿の範囲からもこれより離れた所は「原稿が見つからない部分」
      for (const g of groups) {
        const d = owner(PC.center(g.box)), text = g.js.map(j => B.chars[j].c).join(''), T = d.pr.Tv || d.pr.T, Ti = PC.invT(T);
        const back = PC.mapBox(Ti, g.box), R = d.pr.region, M = 0.04 * Math.hypot(R[2] - R[0], R[3] - R[1]);
        if (g.note) { d.extra.push({ cat: 'W', nbox: g.box, box: back, show: text }); continue; }
        if (dist(PC.center(g.box), R) > far) {   // 原稿のない部分は1件にまとめる(成果物のその部分の原稿を渡していないとき)
          const prev = d.extra.find(e => e.cat === 'I' && e.noSrc);
          if (prev) { prev.nboxes.push(g.box); prev.texts.push(text); prev.nbox = PC.union([prev.nbox, g.box]); prev.box = PC.mapBox(Ti, prev.nbox); }
          else d.extra.push({ cat: 'I', noSrc: true, nbox: g.box, nboxes: [g.box], box: back, texts: [text] });
          continue;
        }
        const img = d.imgs.findIndex(b => { const c = PC.center(back); return c[0] >= b[0] - M && c[0] <= b[2] + M && c[1] >= b[1] - M && c[1] <= b[3] + M; });
        const prev = img >= 0 && d.extra.find(e => e.cat === 'I' && !e.noSrc && e.img === img);
        if (prev) { prev.nboxes.push(g.box); prev.texts.push(text); prev.nbox = PC.union([prev.nbox, g.box]); continue; }
        if (img >= 0) d.extra.push({ cat: 'I', img, nbox: g.box, nboxes: [g.box], box: d.imgs[img], texts: [text] });
        else d.extra.push({ cat: 'N', nbox: g.box, box: back, show: text });
      }
    }
  }

  // ---- 内容で照合したページの項目 ----
  // 違いのまとまり(hunk)の表示: 前後の文脈つきの並び(segs)と、原稿・成果物での位置
  function hunkView(ops, h, cs, B) {
    const segs = [], ab = [], bb = [];
    const push = (t, c) => { const g = segs[segs.length - 1]; if (g && g[0] === t) g[1] += c; else segs.push([t, c]); };
    const ctxA = (from, dir) => { let s = ''; for (let q = from, n = 0; q >= 0 && q < ops.length && n < 6; q += dir, n++) { const o = ops[q]; if (o[0] !== '=' && o[0] !== '~') break; s = dir < 0 ? cs[o[1]].c + s : s + cs[o[1]].c; } return s; };
    const pre = ctxA(h.s - 1, -1), post = ctxA(h.e, 1);
    if (pre) push('=', pre);
    for (let q = h.s; q < h.e; q++) {
      const o = ops[q];
      if (o[0] === '=') push('=', cs[o[1]].c);
      else if (o[0] === '-') { push('-', cs[o[1]].c); ab.push(cs[o[1]].box); }
      else if (o[0] === '+') { push('+', B[o[1]].c); bb.push(B[o[1]].box); }
      else { push('-', cs[o[1]].c); push('+', B[o[2]].c); ab.push(cs[o[1]].box); bb.push(B[o[2]].box); }
    }
    if (post) push('=', post);
    // 挿入・削除だけのときは、隣の字の境目に細い枠
    const near = (side, dir) => { for (let q = dir < 0 ? h.s - 1 : h.e; q >= 0 && q < ops.length; q += dir) { const o = ops[q]; if (o[0] === '|') return null; const b = side === 'A' ? (o[0] === '+' ? null : cs[o[1]].box) : (o[0] === '-' ? null : B[o[0] === '+' ? o[1] : o[2]].box); if (b) return b; } return null; };
    const caretOf = side => { const p = near(side, -1), n = near(side, 1); if (p) return [p[2] - 1, p[1], p[2] + 1, p[3]]; if (n) return [n[0] - 1, n[1], n[0] + 1, n[3]]; return null; };
    return { segs, box: ab.length ? union(ab) : caretOf('A'), nbox: bb.length ? union(bb) : caretOf('B') };
  }
  const instrCheck = t => /後送/.test(t) ? '後送（素材はあとから届く）' : /\.(png|jpe?g|psd|ai|pdf|tiff?|eps|gif)\b|ファイル名/i.test(t) ? '使う画像・素材の指定' : '指示どおりか確認';
  function contentFindings(d, p, add) {
    const k = PC.S, px = b => b && b.map(v => v * k), A = d.A.chars, B = d.nq.B.chars, T = d.pr.T;
    const toNew = b => { const m = PC.mapBox(T, b), R = d.pr.region; return [Math.max(R[0], Math.min(m[0], R[2] - 20)), Math.max(R[1], Math.min(m[1], R[3] - 20)), Math.min(R[2], Math.max(m[2], R[0] + 20)), Math.min(R[3], Math.max(m[3], R[1] + 20))]; };
    for (const b of d.blocks) {
      const cs = A.slice(b.s, b.e), box = PC.union(cs.map(c => c.box));
      if (b.instr) {
        const hit = b.ops.filter(o => o.length === 3).map(o => B[o[2]]), found = b.found >= 0.8 && hit.length;
        const f = add(p + 1, 'K', px(box), b.text, '原稿の書き込み', b.text, found ? '指示の文字が成果物にある（自動確認OK）' : instrCheck(b.text), px(found ? PC.union(hit.map(c => c.box)) : toNew(box)));
        if (!found) f.approx = true;
        continue;
      }
      const vs = [];
      for (const h of PC.hunksOf(b.ops)) {
        const r = hunkView(b.ops, h, cs, B);
        if (h.variant) { vs.push(r); continue; }
        const f = add(p + 1, 'T', px(r.box || box), '', '', '', '', px(r.nbox || toNew(r.box || box)));
        Object.assign(f, { segs: r.segs, same: false, pboxes: r.box ? [px(r.box)] : [], pnboxes: r.nbox ? [px(r.nbox)] : [] });
        if (!r.nbox) f.approx = true;
      }
      if (vs.length) {   // 書き方だけの違いは、まとまりごとに1件
        const segs = []; vs.forEach((r, i) => { if (i) segs.push(['=', '…']); segs.push(...r.segs); });
        const f = add(p + 1, 'V', px(union(vs.map(r => r.box))), '', '', '', '', px(union(vs.map(r => r.nbox))));
        Object.assign(f, { segs, same: false, pboxes: vs.map(r => px(r.box)), pnboxes: vs.map(r => px(r.nbox)) });
      }
    }
    for (const n of d.annots) {   // コメント(注釈): 書かれた指示を、成果物の対応する位置と並べて示す
      if (!n.text.trim()) continue;
      const f = add(p + 1, 'K', px(n.box), n.text, 'コメント', n.text, instrCheck(n.text), px(toNew(n.box)));
      f.approx = true;
    }
    for (const e of d.extra) {
      if (e.cat === 'I') {
        const f = add(p + 1, 'I', px(e.box), e.texts.join(' ／ '), '', '', '', px(e.nbox));
        Object.assign(f, { pnboxes: e.nboxes.map(px), texts: e.texts });
        if (e.noSrc) Object.assign(f, { noSrc: true, onNew: true });
        continue;
      }
      const f = add(p + 1, e.cat, px(e.box), e.show, '', '', '', px(e.nbox));
      f.onNew = true;
      if (e.cat === 'N') Object.assign(f, { segs: [['+', e.show]], same: false, pnboxes: [px(e.nbox)] });
    }
  }

  // opts: { marks: PC.markSource(...), newDoc, progress(msg, frac) }
  PC.analyze = async opts => {
    const { marks: src, newDoc } = opts, prog = opts.progress || (() => {});
    const cb = new PC.Codebook(), P = [], npages = src.numPages, warn = [];
    // 1) 原稿の各ページが、成果物のどのページのどの範囲に当たるか
    const W0 = 0.15;
    const pairs = await PC.pairPages(src, newDoc, (s, f) => prog(s, W0 * f));
    // 成果物のページの描画・文字データ・書き込みは、内容で照合するページのために1回だけ作る
    const NQ = new Map();
    const newPage = async q => {
      if (NQ.has(q)) return NQ.get(q);
      const img = await PC.renderPage(newDoc, q, PC.DPI, false), B = await PC.pageText(newDoc, q);
      const v = { B, notes: PC.designerNotes(B, img, PC.S), used: new Uint8Array(B.chars.length), thumb: await toThumb(img) };
      NQ.set(q, v);
      return v;
    };
    // 2) ページごとに照合: 同じレイアウトなら字形を重ねて比べ、レイアウトが違えば文字データの内容で比べる
    for (let p = 0; p < npages; p++) {
      const step = (s, f) => prog(`${p + 1} / ${npages} ページ：${s}`, W0 + (1 - W0) * 0.97 * (p + f) / npages);
      step('描画', 0.01); await PC.tick();
      const pr = pairs[p], it = src.page(p);
      if (pr.q < 0) { P.push(await nonePage(src, p)); continue; }
      if (!pr.same && !it.doc) {
        warn.push(`${p + 1}ページ目は、成果物とレイアウトが違う紙の原稿のため、自動では比べられませんでした`);
        P.push(await nonePage(src, p)); continue;
      }
      if (!pr.same) {
        const d = await contentPage(src, p, pr, await newPage(pr.q), step);
        if (d.noText) warn.push(`${p + 1}ページ目に当たる成果物のページには文字データがほとんどないため（文字のアウトライン化など）、文字では比べられませんでした`);
        P.push(d); continue;
      }
      const kind = await src.kind(p);
      let nw = await PC.renderPage(newDoc, pr.q, PC.DPI, false), nc = await PC.textChars(newDoc, pr.q);
      if (pr.crop) {   // 原稿のページが成果物のページの一部(見開きの片側など)に当たる: その部分だけを切り出して比べる
        const [x0, y0, x1, y1] = pr.crop.map(v => Math.round(v * PC.S));
        nw = PC.crop(nw, x0, y0, x1, y1);
        nc = nc.filter(([, b]) => (b[0] + b[2]) / 2 >= x0 && (b[0] + b[2]) / 2 < x1 && (b[1] + b[3]) / 2 >= y0 && (b[1] + b[3]) / 2 < y1).map(([c, b]) => [c, [b[0] - x0, b[1] - y0, b[2] - x0, b[3] - y0]]);
      }
      const d = kind === 'annot' ? await annotPage(src, p, nw, nc, cb, step) : await scanPage(src, p, nw, nc, step);
      if (d.kind === 'scan' && d.matched < 40) warn.push(`${p + 1}ページ目は、原稿と成果物の位置がうまく合いません（ページの向きを確かめてください）`);
      step('表示用の画像を作成', 0.96); await PC.tick();
      d.q = pr.q; d.crop = pr.crop; d.extra = [];
      d.thumbs = { left: await toThumb(d.left), right: await toThumb(d.right) }; d.left = d.right = null;
      P.push(d);
    }
    leftovers(P, NQ);
    const none = P.map((d, p) => (d.kind === 'none' ? p + 1 : 0)).filter(Boolean);
    if (none.length) warn.push(`原稿の${spans(none)}ページ目は、対応する成果物のページが見つかりませんでした（照合していません）`);
    const usedQ = new Set(P.map(d => d.q).filter(q => q >= 0)), lost = [];
    for (let q = 0; q < newDoc.numPages; q++) if (!usedQ.has(q)) lost.push(q + 1);
    if (lost.length) warn.push(`成果物の${spans(lost)}ページ目は、対応する原稿のページが見つかりませんでした`);

    if (window.__pcDebug) PC._last = P;   // 自動テストでの調査用
    prog('照合', 0.97); await PC.tick();
    // 照合: 変更 × 赤字の指示箇所
    const meets = (set, a, b) => { for (let k = a; k < b; k++) if (set.has(k)) return true; return false; };
    for (const d of P) {
      for (const a of d.an) a.hit = [];
      for (const c of [...d.ch, ...d.im]) {
        c.status = null;
        if (c.hw) continue;   // 赤以外の書き込みは、修正の対象ではない
        for (const a of d.an) {
          if (KEEP.test(a.note || '') && a.kind === 'tokens' && c.kind === 'text' && meets(a.toks, c.oi[0], Math.max(c.oi[1], c.oi[0] + 1))) { a.hit.push(c); continue; }
          let m = false;
          if (c.kind === 'text' && a.kind === 'tokens') { const [lo, hi] = c.oi; m = meets(a.toks, lo - (c.tag === 'layout' ? 1 : 0), Math.max(hi, lo + 1)); }
          else if (c.kind === 'text' && a.kind === 'insert') { const [lo, hi] = a.span || [a.at - 1, a.at + 1]; m = (lo <= c.oi[0] && c.oi[0] <= hi) || (lo <= c.oi[1] && c.oi[1] <= hi); }
          else if (c.kind !== 'text' && a.kind === 'image') m = ov(c.obox, a.box, 5);
          if (m && a.printedLike) { a.hit.push(c); continue; }
          if (m) { c.status = c.kind === 'text' ? 'A' : 'A_IMG'; c.anchor = a; a.hit.push(c); }
        }
      }
    }

    // ---- 全体に関わる修正(全体指示・以下同様): 手で登録しなくても、赤字原稿から読み取る ----
    //  1) 注釈のコメント「全体…「A」→「B」」  2) 同じ変更が2か所以上(全体指示と推定)  3) 赤字どおり変わった語(以下同様の候補)
    const rules = [], textCh = [];
    P.forEach((d, p) => d.ch.forEach(c => { if (c.kind === 'text' && c.tag !== 'layout' && c.before && !c.hw) textCh.push([p, c]); }));
    for (const d of P) for (const n of d.notes) {
      const m = n.text.match(/「(.+?)」\s*(?:→|を)\s*「(.+?)」/);
      if (m && n.text.includes('全体')) { rules.push({ frm: m[1], to: m[2], core: coreOf(m[1], m[2]), how: '全体指示', check: '未統一' }); n.rule = true; }
    }
    const groups = [];
    for (const [p, c] of textCh) {
      const [b, a] = coreOf(c.before, c.after), g = groups.find(g => g.after === a && fits(g.before, b));
      if (g) { g.xs.push([p, c]); g.before = mergeKnown(g.before, b); } else groups.push({ before: b, after: a, xs: [[p, c]] });
    }
    for (const g of groups) {
      if (g.xs.length < 2 || rules.some(r => r.core[1] === g.after && fits(r.core[0], g.before))) continue;
      if (g.before.includes('□') ? known(g.before) < 1 : !isWord(g.before)) continue;
      // 変わった部分の前後に、どの箇所にも共通する文字があれば含めて語にする(「い合わ→合」→「お問い合わせ→お問合せ」)
      const cx = g.xs.map(([p, c]) => {
        const x = ctxOf(P[p].nc, c.nbox, c.after), { head, tail } = splitCore(c.before, c.after);
        return x ? [x[0] + head, tail + x[1]] : null;
      });
      const [L, R] = commonCtx(cx);
      if (window.__pcDebug) (PC._ctx = PC._ctx || []).push({ g: g.before + '→' + g.after, cx, L, R });
      // 表示は前後を含めた語、探すのは変わった部分(前後の字が違う箇所の直し忘れも見つけるため)。
      // 推定できなかった字(□)があるときは、前後の字も含めて、□を1〜3字のどの字とも合うとみなして探す
      const wild = g.before.includes('□'), pat = L + g.before + R;
      if (wild && known(pat) < 3) continue;
      rules.push({ frm: pat, to: L + g.after + R, core: [g.before, g.after], search: wild ? patternOf(pat) : g.before, how: `同じ変更が${g.xs.length}か所`, check: '未統一' });
    }
    P.forEach((d, p) => {
      for (const a of d.an) for (const c of a.hit) {
        if (c.kind !== 'text' || !c.before || c.tag === 'layout') continue;
        const after = (a.note || '').includes('以下同様');
        if (!after && !(c.after && isWord(c.before))) continue;
        const [b, ca] = coreOf(c.before, c.after);
        if (rules.some(r => r.core[1] === ca && fits(r.core[0], b))) continue;
        rules.push({ frm: c.before, to: c.after, core: [b, ca], how: after ? '以下同様' : '同じ語の他の箇所（以下同様の候補）', check: '変更なし（展開漏れの候補）', after, src: [p, c.nbox] });
      }
    });
    const leaks = [], seen = new Set();
    for (const r of rules) {
      // 赤字のない同じ変更は「全体・以下同様で説明できる変更」
      for (const [p, c] of textCh) {
        if (c.status !== null) continue;
        const [b, a] = coreOf(c.before, c.after);
        if (a !== r.core[1] || !fits(b, r.core[0])) continue;
        if ([...r.to].length > [...r.core[1]].length && c.nbox && !around(P[p].nc, c.nbox, [...r.to].length + 3).includes(r.to)) continue;
        c.status = 'C1'; c.why = r.how;
      }
      // 修正後に「A」が残っている箇所は、直し忘れの候補
      P.forEach((d, q) => {
        for (const [i, e] of findAll(d.nc, r.search || r.frm)) {
          const nb = union(d.nc.slice(i, e).map(c => c[1])).map(Math.trunc), key = q + ':' + nb.join(','), found = d.nc.slice(i, e).map(c => c[0]).join('');
          if (seen.has(key)) continue;
          seen.add(key);
          let check = r.check;
          if (r.after && r.src && (q < r.src[0] || (q === r.src[0] && r.src[1] && (nb[1] < r.src[1][1] || (nb[1] === r.src[1][1] && nb[0] < r.src[1][0]))))) check += '（指示より前なので対象外の可能性）';
          leaks.push({ page: q + 1, frm: r.frm.includes('□') ? found : r.frm, to: r.to, nbox: nb, how: r.how, check });
        }
      });
    }

    // 文字データでの裏取り(注釈PDFのページ): 見た目で「同じ」と対応づいた字形どうしで、文字データが違うもの
    const lookalike = [];
    P.forEach((d, p) => {
      if (d.kind !== 'annot') return;
      // 文字データを字形に割り当てる: 字形の枠に中心が入る文字、なければ同じ行の中で字形の幅(縦組みは高さ)に入る文字
      const owner = (cs, T, L) => {
        const res = new Map();
        for (const [c, b] of cs) {
          const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
          let k = T.findIndex(t => t.box[0] - 2 <= cx && cx <= t.box[2] + 2 && t.box[1] - 2 <= cy && cy <= t.box[3] + 2);
          if (k < 0) k = T.findIndex(t => { const l = L[t.line]; return l.vert ? (t.box[1] - 2 <= cy && cy <= t.box[3] + 2 && l.box[0] <= cx && cx <= l.box[2]) : (t.box[0] - 2 <= cx && cx <= t.box[2] + 2 && l.box[1] <= cy && cy <= l.box[3]); });
          if (k >= 0) res.set(k, (res.get(k) || '') + c);
        }
        return res;
      };
      const oo = owner(d.oc, d.ot, d.ol), no = owner(d.nc, d.nt, d.nl);
      for (const [k, m] of d.pairs) if (oo.has(k) && no.has(m) && oo.get(k) !== no.get(m) && !d.ch.some(c => ov(d.ot[k].box, c.obox, 2))) lookalike.push({ page: p + 1, show: `${oo.get(k)}→${no.get(m)}`, box: d.ot[k].box, nbox: d.nt[m].box });
    });

    // 修正前の枠 ⇄ 修正後の枠(見た目で対応づいた字形の組から求める)
    const pm = d => d.pmap || (d.pmap = new Map(d.pairs)), rpm = d => d.rmap || (d.rmap = new Map(d.pairs.map(([a, b]) => [b, a])));
    const mapBox = (d, box) => {
      const nb = []; d.ot.forEach((t, k) => { if (ov(t.box, box) && pm(d).has(k)) nb.push(d.nt[pm(d).get(k)].box); });
      return nb.length ? union(nb) : null;
    };
    const backBox = (d, box) => {
      const ob = []; d.nt.forEach((t, k) => { if (ov(t.box, box) && rpm(d).has(k)) ob.push(d.ot[rpm(d).get(k)].box); });
      return ob.length ? union(ob) : null;
    };
    // 原稿での位置が分からない項目の、切り抜きの中心(内容で照合したページは、対応の変換を逆にたどったおよその位置)
    const approx = (d, nb) => d.kind === 'content' ? PC.mapBox(PC.invT(d.pr.T), nb.map(v => v / PC.S)).map(v => v * PC.S) : nb;
    const tokBox = (d, k) => pm(d).has(k) ? d.nt[pm(d).get(k)].box : null;
    // 結果の一覧
    const F = [];
    const add = (page, cat, box, show = '', how = '', note = '', check = '', nbox = null) => { const f = { id: F.length, page, cat, label: PC.CAT[cat], box: box.map(Math.trunc), nbox: nbox ? nbox.map(Math.trunc) : null, show, how, note, check }; F.push(f); return f; };
    P.forEach((d, p) => {
      if (d.kind === 'content') contentFindings(d, p, add);
      for (const c of [...d.ch, ...d.im]) {
        const st = c.hw ? 'H' : c.status || (c.kind === 'text' ? (c.look === 'color' ? 'C3' : 'C2') : 'C3'), a = c.anchor || {};
        let chk = '';
        if (a.note && c.kind === 'text' && c.tag !== 'layout') {   // 指示文(注釈のコメント)が、修正後の該当箇所の前後にあるか
          // 「目指し（以下同様）」のような添え書きは外す(指示文全体がかっこ書きなら外さない)
          const strip = a.note.replace(/[（(][^）)]*(以下同様|全体|ママ|イキ|トル|同様)[^）)]*[）)]/g, '').replace(/\s/g, '');
          const want = strip || a.note.replace(/\s/g, '');
          if (/太字|細字|書体|ゴシック|明朝|イタリック|斜体|色|サイズ|大きく|小さく|字下げ|改行|追い込み|写真|差し?替/.test(want)) chk = '書式・組みの指示（人が確認）';
          else if (/^(トル|トルツメ|トルママ|削除)$/.test(want)) chk = c.tag === 'delete' || !c.after ? '削除を確認（自動確認OK）' : '削除されていない可能性（要確認）';
          else { const ctx = c.nbox ? around(d.nc, c.nbox, [...want].length + 3) : ''; chk = want && ctx.includes(want) ? '指示文が修正後にある（自動確認OK）' : '指示文が修正後に見当たらない（要確認）'; }
        }
        add(p + 1, st, c.obox, c.show + (c.look === 'color' ? '（色のみ）' : ''), a.how || c.why || '', a.note || '', chk, c.nbox);
        const f = F[F.length - 1];
        if (c.anchor) Object.defineProperty(f, 'anchorRef', { value: c.anchor, enumerable: false });
        if (c.diff) Object.assign(f, { segs: c.diff.segs, same: c.diff.same, pboxes: c.diff.ob, pnboxes: c.diff.nb });
        if (c.tag === 'layout') f.kind = 'layout';
        if (c.kind !== 'text') f.kind = 'image';
        if (c.look === 'color') f.color = true;
        if (d.kind === 'scan') f.scan = true;
      }
      const done = new Set(d.an.filter(a => a.hit.length).map(a => a.stroke)), f0 = F.length;
      const along = (b, v) => v ? [b[1], b[3]] : [b[0], b[2]];   // 行の向きに沿った範囲
      for (const a of d.an) {
        const keep = KEEP.test(a.note || '');
        if (keep && a.hit.length) { add(p + 1, 'C2', a.box, 'ママ／イキの指示なのに変更あり', a.how, a.note); continue; }
        if (keep) { add(p + 1, 'M', a.box, textIn(d.oc, a.box), a.how, a.note, '', mapBox(d, a.box)); continue; }
        if (a.hit.length) continue;
        // 指示どおり変わった赤字のすぐ隣(行の折り返しで続く取り消し線など)は、続きの赤字として軽く扱う
        const adj = a.kind === 'tokens' && d.an.some(b => b.hit.length && b.kind === 'tokens' && [...a.toks].some(k => b.toks.has(k - 1) || b.toks.has(k + 1)));
        const cat = (done.has(a.stroke) && a.stroke >= 0) || adj ? 'B2' : 'B';
        // 同じ一続きの赤字、または同じ行で途切れて続く細い線は、1件にまとめる
        const prev = F.find((f, i) => i >= f0 && f.cat === cat && a.kind === 'tokens' && (
          (f.stroke === a.stroke && a.stroke >= 0 && !done.has(a.stroke) && f.box[1] < a.box[3] && a.box[1] < f.box[3]) ||
          (f.thin && a.thin && f.li === a.li && (([f1, f2], [a1, a2]) => Math.max(a1 - f2, f1 - a2))(along(f.box, a.vert), along(a.box, a.vert)) <= 20)));
        if (prev) { prev.box = union([prev.box, a.box]).map(Math.trunc); prev.show = textIn(d.oc, prev.box); prev.nbox = mapBox(d, prev.box); continue; }
        // 挿入位置は「前の字｜後ろの字」で示す。修正後の該当箇所も添える
        let show, nb;
        if (a.kind === 'insert') {
          const at = Math.min(a.at, d.ot.length), pre = at > 0 ? tokText(d.oc, d.ot[at - 1].box) : '', post = at < d.ot.length ? tokText(d.oc, d.ot[at].box) : '';
          show = `${pre}｜${post}（挿入位置）`; nb = union([tokBox(d, at - 1), tokBox(d, at)].filter(Boolean));
        } else { show = textIn(d.oc, a.box); nb = mapBox(d, a.box); }
        add(p + 1, cat, a.box, show, a.how, a.note || '', '', nb);
        Object.defineProperty(F[F.length - 1], 'anchorRef', { value: a, enumerable: false });
        if (a.kind === 'insert') F[F.length - 1].ins = show.replace('（挿入位置）', '').split('｜');
        Object.assign(F[F.length - 1], { stroke: a.stroke, thin: !!a.thin, li: a.li, vert: a.vert, span: a.span, lh: a.h });
      }
      // まとめたあとで行のほぼ全長(かつ字2つ分より長く)にわたる細い線は、引き出し線の可能性として示す
      for (const f of F.slice(f0)) if (f.thin && f.span) { const [s, e] = along(f.box, f.vert); if (e - s >= 0.9 * f.span && e - s > 2 * f.lh) f.how += '（細い線：引き出し線の可能性）'; }
      for (const r of d.restBoxes) {
        const b = r.box;
        if (r.stamp) continue;   // 印鑑は指示ではない
        if (d.notes.some(n => n.rule && ov(n.box, b))) { add(p + 1, 'G', b); continue; }
        const a = d.an.find(a => ov(b, a.box, 30));
        if (!a) { add(p + 1, 'F', b); continue; }
        add(p + 1, 'F2', b);
        // 指示箇所の項目に、何に直すかの書き込みを添える
        const nb = noteBoxOf(r, a.box, d.w);
        if (nb) for (const f of F) if (f.page === p + 1 && f.anchorRef === a && !f.noteBox) f.noteBox = nb;
      }
    });
    for (const e of leaks) {
      const d = P[e.page - 1], ob = backBox(d, e.nbox);
      add(e.page, 'D', ob || approx(d, e.nbox), `${e.frm}→${e.to}`, e.how, '', e.check, e.nbox);
      Object.assign(F[F.length - 1], { frm: e.frm, to: e.to, onNew: !ob });
    }
    for (const l of lookalike) { const [x, y] = l.show.split('→'); add(l.page, 'E', l.box, l.show, '', '', '', l.nbox); F[F.length - 1].segs = [['-', x], ['+', y]]; }
    // 見た目が似た別の字: 修正後の文字データだけで調べる(紙の赤字原稿でも分かるように)。すでに出ている箇所は除く
    P.forEach((d, p) => {
      for (const l of lookalikeChars(d.nc)) {
        if (F.some(f => f.page === p + 1 && f.nbox && ov(f.nbox, l.box, 2) && (f.cat === 'E' || f.cat === 'C2' || f.cat === 'A'))) continue;
        const ob = backBox(d, l.box);
        add(p + 1, 'E', ob || approx(d, l.box), `${l.c}→${l.want}`, '', '', '', l.box);
        Object.assign(F[F.length - 1], { lint: { c: l.c, want: l.want, ctx: l.ctx }, onNew: !ob });
      }
    });
    prog('完了', 1);
    // 全体の直し(推定を含む)の一覧。□(推定できなかった字)を含む語は、修正後に残っていた形で示す
    const shown = r => { if (!r.frm.includes('□')) return r.frm; const e = leaks.find(l => l.to === r.to && !l.frm.includes('□')); return e ? e.frm : r.frm.replace(/□+/g, '…'); };
    const pages = P.map(d => ({ ...d.thumbs, kind: d.kind, q: d.q, crop: d.crop || null, region: d.kind === 'content' ? d.pr.region.map(v => v * PC.S) : null }));
    return { findings: F, pages, rules: rules.filter(r => r.check === '未統一').map(r => ({ frm: shown(r), to: r.to, how: r.how })), warn };
  };
})();
