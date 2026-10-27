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
    T: '原稿と違う文字', V: '書き方だけの違い（全角・半角など）', N: '原稿にない文字', I: '原稿が画像の部分（文字では比べられない）', J: '成果物だけで見つけた所（原稿とは比べない）',
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


  // 字の見た目(レイアウトの指示の確認に使う): 枠の中のインク(暗い・色のある画素)の、インクを囲む範囲での割合(太さ)・高さ・平均の色
  function styleOf(img, box) {
    if (!box) return null;
    const x0 = Math.max(0, Math.floor(box[0])), y0 = Math.max(0, Math.floor(box[1])), x1 = Math.min(img.w, Math.ceil(box[2])), y1 = Math.min(img.h, Math.ceil(box[3]));
    let n = 0, r = 0, g = 0, b = 0, ix0 = Infinity, iy0 = Infinity, ix1 = -1, iy1 = -1;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const k = (y * img.w + x) * 4, R = img.d[k], G = img.d[k + 1], Bv = img.d[k + 2], mx = Math.max(R, G, Bv), mn = Math.min(R, G, Bv), lum = 0.3 * R + 0.59 * G + 0.11 * Bv;
      if (!(lum < 150 || (mx - mn > 80 && lum < 215))) continue;
      n++; r += R; g += G; b += Bv; if (x < ix0) ix0 = x; if (x > ix1) ix1 = x; if (y < iy0) iy0 = y; if (y > iy1) iy1 = y;
    }
    if (n < 8) return null;
    return { ink: n / ((ix1 - ix0 + 1) * (iy1 - iy0 + 1)), h: iy1 - iy0 + 1, color: [r / n, g / n, b / n] };
  }
  // 書式の指示(太字・大きさ・色)が、修正前→修正後の見た目の変化で確かめられるか。返り値: 確認の文 または null(判定できない指示)
  const COLORS = { 赤: [345, 25], 朱: [0, 30], 青: [190, 250], 緑: [80, 165], オレンジ: [20, 45], 黄: [45, 70], 紫: [255, 320], ピンク: [300, 350] };
  const hueOf = ([R, G, B]) => { const mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn; if (!d) return { h: 0, s: 0 }; let h = mx === R ? ((G - B) / d) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4; h *= 60; if (h < 0) h += 360; return { h, s: d / mx }; };
  function styleCheck(note, o, n) {
    const t = note.replace(/\s/g, ''), OK = '書式の指示どおり（自動確認OK）', NG = '書式の指示どおりになっていない可能性（要確認）';
    if (!o || !n) return null;
    if (/太字|太く|ボールド/.test(t)) return n.ink >= o.ink * 1.12 ? OK : NG;
    if (/細字|細く/.test(t)) return n.ink <= o.ink * 0.9 ? OK : NG;
    if (/大きく|拡大|大きめ/.test(t)) return n.h >= o.h * 1.08 ? OK : NG;
    if (/小さく|縮小|小さめ/.test(t)) return n.h <= o.h * 0.93 ? OK : NG;
    const named = Object.keys(COLORS).find(c => t.includes(c));
    if (named && /色|字|に/.test(t)) { const { h, s } = hueOf(n.color), [a, b] = COLORS[named]; return s > 0.3 && (a <= b ? h >= a && h <= b : h >= a || h <= b) ? OK : NG; }
    if (/黒/.test(t) && /色|字|に/.test(t)) { const { s } = hueOf(n.color); return s < 0.25 && Math.max(...n.color) < 120 ? OK : NG; }
    if (/色/.test(t) && /変|かえ|カエ/.test(t)) return Math.hypot(...o.color.map((v, k) => v - n.color[k])) > 40 ? OK : NG;
    return null;
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
    for (const c of merged) if (c.obox && c.nbox) c.sty = { o: styleOf(old, c.obox), n: styleOf(nw, c.nbox) };   // 書式の指示の確認用
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
  //   sub: データファイルのページのとき、このページ(成果物)で照合するまとまり・コメントと、原稿の描画
  async function contentPage(src, p, pr, nq, step, sub) {
    const it = src.page(p), k = PC.S;
    step('文字データを読み取り', 0.1); await PC.tick();
    let A, annots, imgs, left;
    if (it.virt) { A = { ...it.virt.text, blocks: sub.blocks, loose: it.virt.loose, order: new Map(it.virt.blocks.map((b, k) => [b[0], k])) }; annots = sub.notes; imgs = []; left = sub.left; }
    else {
      const { doc, i } = it;
      A = await PC.pageText(doc, i); annots = await PC.annotations(doc, i, 72); imgs = await PC.imageBoxes(doc, i);
      left = await PC.renderPage(doc, i, PC.DPI, true);
      PC.snapChars(A, left, k);   // 字の枠を、描画した字の形に合わせる(違う字を示す枠がずれないように)
    }
    step('文字を照合', 0.3); await PC.tick();
    // 成果物の文字データがほとんどない(文字がアウトライン化・画像化されている)ページは、文字では比べない(すべて「ない」と出てしまうため)
    const nA = A.blocks ? A.blocks.reduce((t, [s, e]) => t + e - s, 0) : A.chars.length, noText = nq.B.chars.length < Math.max(10, 0.2 * nA);
    //   データファイルは、PDFの原稿とは別に成果物の字に印を付ける(ラフとExcelの表のように、同じ所の原稿が2つあってもよいように)
    const blocks = noText ? [] : PC.collatePage(A, nq.B, pr, pr.free ? nq.usedFree : nq.used, nq.notes);
    if (pr.free) {   // 成果物での範囲: 対応づいた字を囲む範囲
      const js = blocks.flatMap(b => (b.instr ? [] : b.ops.filter(o => o.length === 3).map(o => o[2])));
      if (js.length) { const u = PC.union(js.map(j => nq.B.chars[j].box)), m = 0.02 * Math.hypot(nq.B.w, nq.B.h); pr.region = [Math.max(0, u[0] - m), Math.max(0, u[1] - m), Math.min(nq.B.w, u[2] + m), Math.min(nq.B.h, u[3] + m)]; }
    }
    step('表示用の画像を作成', 0.8); await PC.tick();
    return {
      kind: 'content', q: pr.q, pr, A, annots, imgs, blocks, nq, extra: [], noText,
      ch: [], im: [], an: [], notes: annots.map(n => ({ ...n, box: n.box.map(v => v * k) })), restBoxes: [], ot: [], nt: [], pairs: [], nc: [],
      oc: (A.blocks || [[0, A.chars.length]]).flatMap(([s, e]) => A.chars.slice(s, e)).map(c => [c.c, c.box.map(v => v * k)]), w: left.w,
      thumbs: { left: sub ? sub.thumb : await toThumb(left), right: nq.thumb },
    };
  }
  // 位置の対応(変換)がない、データファイルのページ: 対応づいた字の組のうち、いちばん近いもので位置を移す
  const pairsOf = d => d.fm || (d.fm = d.blocks.flatMap(b => (b.instr ? [] : b.ops.filter(o => o.length === 3).map(o => [d.A.chars[b.s + o[1]].box, d.nq.B.chars[o[2]].box]))));
  const nearestPair = (d, box, side) => {
    const c = PC.center(box); let best = null, bd = Infinity;
    for (const x of pairsOf(d)) { const q = PC.center(x[side]), dd = Math.hypot(q[0] - c[0], 3 * (q[1] - c[1])); if (dd < bd) { bd = dd; best = x; } }   // 同じ行を優先
    return best;
  };
  // 成果物の位置 → 原稿でのおよその位置 / 原稿の位置 → 成果物でのおよその位置(pt)
  const backOf = (d, box) => { if (!d.pr.free) return PC.mapBox(PC.invT(d.pr.Tv || d.pr.T), box); const x = nearestPair(d, box, 1); return x ? x[0] : [0, 0, 20, 20]; };
  const fwdOf = (d, box) => { if (!d.pr.free) return PC.mapBox(d.pr.T, box); const x = nearestPair(d, box, 0); return x ? x[1] : d.pr.region; };
  // 対応する成果物のページがない原稿のページ(または、レイアウトが違う紙の原稿): 原稿の画像だけ
  async function nonePage(src, p) {
    const it = src.page(p), img = it.virt ? it.virt.render(PC.DPI) : it.doc ? await PC.renderPage(it.doc, it.i, PC.DPI, true) : (await src.image(p)).img;
    return { kind: 'none', q: -1, ch: [], im: [], an: [], notes: [], restBoxes: [], ot: [], nt: [], pairs: [], oc: [], nc: [], extra: [], w: img.w, thumbs: { left: await toThumb(img), right: null } };
  }
  // 内容で照合したページの残り: 成果物の字のうち、どの原稿にも対応しなかったもの(原稿にない文字・原稿が画像の部分)と、成果物の書き込み
  //   成果物の字は、その位置を範囲に含む原稿のページ(なければいちばん近い範囲)に割り当てる
  //   OLD(旧版があるとき): 成果物の字が旧版と同じか。原稿のない部分で旧版と同じものは「前回のまま」として分ける
  function leftovers(P, NQ, OLD) {
    const k = PC.S;
    const dist = (pt, b) => Math.hypot(Math.max(b[0] - pt[0], 0, pt[0] - b[2]), Math.max(b[1] - pt[1], 0, pt[1] - b[3]));
    for (const [q, nq] of NQ) {
      const ds = P.filter(d => d.kind === 'content' && d.q === q);
      if (!ds.length) continue;
      const { B, used, usedFree, notes } = nq;
      const owner = pt => {   // 範囲の中なら範囲の中心がいちばん近いもの、どの範囲にも入らなければ範囲がいちばん近いもの
        let best = null, bd = Infinity;
        for (const d of ds) { const R = d.pr.region, out = dist(pt, R), c = PC.center(R), key = out > 0 ? 1e6 + out : Math.hypot(pt[0] - c[0], pt[1] - c[1]); if (key < bd) { bd = key; best = d; } }
        return best;
      };
      // 字のまとまり(item)ごとに、使われなかった字をまとめる。近いまとまりどうしはつなげる
      const groups = [];
      B.items.forEach((it, idx) => {
        const js = []; B.chars.forEach((c, j) => { if (c.it === idx && !used[j] && !usedFree[j]) js.push(j); });
        const isNote = notes.has(idx);
        if (!js.length || (!isNote && !js.some(j => /[\p{L}\p{N}]/u.test(B.chars[j].c)))) return;
        const box = PC.union(js.map(j => B.chars[j].box)), g = groups[groups.length - 1];
        // 同じ行なら全角の空白をはさむくらいまで(2.5字)、別の行なら行の間くらいまで(1.2字)離れていても1件にまとめる
        const size = g ? Math.max(it.size, g.size) : it.size, sameLine = g && Math.min(box[3], g.box[3]) - Math.max(box[1], g.box[1]) > 0.5 * Math.min(box[3] - box[1], g.box[3] - g.box[1]);
        const close = g && g.note === isNote && PC.gap(box, g.box) < (sameLine ? 2.5 : 1.2) * size;
        if (close) { g.js.push(...js); g.box = PC.union([g.box, box]); g.size = Math.max(g.size, it.size); }
        else groups.push({ js, box, note: isNote, size: it.size });
      });
      // データファイルの範囲では、同じ行に並ぶまとまり(表の1行のセルなど)は、間に対応づいた字がなければ1件にまとめる
      const taken = j => used[j] || usedFree[j];
      for (let k = groups.length - 1; k > 0; k--) {
        const a = groups[k - 1], b = groups[k];
        if (a.note || b.note) continue;
        const da = owner(PC.center(a.box)), db = owner(PC.center(b.box));
        if (da !== db || !da.pr.free) continue;
        const lo = Math.max(a.box[1], b.box[1]), hi = Math.min(a.box[3], b.box[3]);
        if (hi - lo <= 0.5 * Math.min(a.box[3] - a.box[1], b.box[3] - b.box[1])) continue;
        const x0 = Math.min(a.box[2], b.box[2]), x1 = Math.max(a.box[0], b.box[0]);
        if (B.chars.some((c, j) => { const [cx, cy] = PC.center(c.box); return taken(j) && cy >= lo && cy <= hi && cx > x0 && cx < x1; })) continue;
        a.js.push(...b.js); a.box = PC.union([a.box, b.box]); a.size = Math.max(a.size, b.size); groups.splice(k, 1);
      }
      for (const d of ds) d.nc = [];
      B.chars.forEach(c => owner(PC.center(B.items[c.it].box)).nc.push([c.c, c.box.map(v => v * k)]));
      const far = 0.08 * Math.hypot(B.w, B.h);   // どの原稿の範囲からもこれより離れた所は「原稿が見つからない部分」
      const os = OLD && OLD.get(q);
      for (const g of groups) {
        const d = owner(PC.center(g.box)), text = g.js.map(j => B.chars[j].c).join(''), old = os ? (g.js.every(j => os.st[j] === 1) ? 'same' : 'changed') : null;
        const back = backOf(d, g.box), R = d.pr.region, M = 0.04 * Math.hypot(R[2] - R[0], R[3] - R[1]);
        if (g.note) { d.extra.push({ cat: 'W', nbox: g.box, box: back, show: text }); continue; }
        if (old === 'same' && dist(PC.center(g.box), R) > far) {   // 原稿のない部分で、旧版と同じ(前回のまま)ものは1件にまとめる
          const prev = d.extra.find(e => e.old === 'same');
          if (prev) { prev.nboxes.push(g.box); prev.texts.push(text); prev.nbox = PC.union([prev.nbox, g.box]); prev.box = backOf(d, prev.nbox); }
          else d.extra.push({ cat: 'I', noSrc: true, old, nbox: g.box, nboxes: [g.box], box: back, texts: [text] });
          continue;
        }
        if (dist(PC.center(g.box), R) > far) {   // 原稿のない部分は1件にまとめる(成果物のその部分の原稿を渡していないとき)
          const prev = d.extra.find(e => e.cat === 'I' && e.noSrc && !e.old && e.vsOld === old);
          if (prev) { prev.nboxes.push(g.box); prev.texts.push(text); prev.jss.push(g.js); prev.nbox = PC.union([prev.nbox, g.box]); prev.box = backOf(d, prev.nbox); }
          else d.extra.push({ cat: 'I', noSrc: true, nbox: g.box, nboxes: [g.box], box: back, texts: [text], jss: [g.js], vsOld: old, os });
          continue;
        }
        const img = d.imgs.findIndex(b => { const c = PC.center(back); return c[0] >= b[0] - M && c[0] <= b[2] + M && c[1] >= b[1] - M && c[1] <= b[3] + M; });
        const prev = img >= 0 && d.extra.find(e => e.cat === 'I' && !e.noSrc && e.img === img);
        if (prev) { prev.nboxes.push(g.box); prev.texts.push(text); prev.nbox = PC.union([prev.nbox, g.box]); continue; }
        if (img >= 0) d.extra.push({ cat: 'I', img, nbox: g.box, nboxes: [g.box], box: d.imgs[img], texts: [text], vsOld: old });
        else d.extra.push({ cat: 'N', nbox: g.box, box: back, show: text, vsOld: old });
      }
    }
  }

  // ---- 商品マスタのような表(1行が1商品で、成果物には一部の列だけが載るもの)の、商品ごとの照合 ----
  //   行の文字の多くが成果物に載る表(価格表など)は、ほかのデータファイルと同じく文字の並びで照合する。ここでは、それで対応が見つからなかったシートだけを扱う
  const charSegs = (a, b) => { const A = [...a], B = [...b], segs = []; for (const [t, i1, i2, j1, j2] of PC.opcodes(A, B)) { if (t === 'equal') segs.push(['=', A.slice(i1, i2).join('')]); else { if (i2 > i1) segs.push(['-', A.slice(i1, i2).join('')]); if (j2 > j1) segs.push(['+', B.slice(j1, j2).join('')]); } } return segs; };
  async function recordPages(P, src, JP, newDoc, NQ) {
    const sheets = new Map();
    P.forEach(d => { if (d.src == null) return; const it = src.page(d.src); if (!it.virt || !it.virt.sheet) return; const sh = it.virt.sheet; if (!sheets.has(sh)) sheets.set(sh, { all: [], used: false, src: d.src }); const x = sheets.get(sh); x.all.push(d); if (d.kind !== 'none') x.used = true; });
    for (const [sh, x] of sheets) {
      const res = PC.matchRecords(sh, JP);
      if (!res) continue;
      // 文章として照合できたシートは、成果物に載らない列が多い表(商品マスタの一部の列だけを載せたもの)のときだけ、商品ごとの照合に切り替える
      //   (載らない列の字が、商品ごとに「成果物にない」と出てしまうため。全部の列を載せた表は、字ごとに比べられる文章の照合のまま)
      if (x.used && !(res.hidden >= 2 && res.fields.length <= 0.6 * res.filled && res.exact >= 3)) continue;
      // 照合に使った列(かぎと成果物に載る列)だけの表を、原稿の表示にする
      const cols = [res.key.c, ...res.fields.map(f => f.c)];
      const list = [{ cells: [res.key.label, ...res.fields.map(f => f.label)], rn: '' }, ...res.records.map(r => ({ cells: cols.map(c => String(r.row.cells[c] ?? '')), rn: r.row.rn }))];
      const vps = PC.tablePages(`${sh.name}（照合した列）`, list, { cols: cols.map(c => sh.cols[c]) });
      const where = new Map();   // 商品 → [表示の表のページ, 行の枠(pt)]
      let k = 0; vps.forEach((vp, vi) => vp.blocks.forEach(([s0, e0]) => { if (k > 0) where.set(res.records[k - 1], [vi, PC.union(vp.chars.slice(s0, e0).map(c => c.box))]); k++; }));
      const thumbs = []; for (const vp of vps) thumbs.push(await toThumb(vp.render(PC.DPI)));
      const qOf = r => (r.anchors[0] ? r.anchors[0].p.q : null), qs = res.records.map(qOf).filter(q => q != null);
      const main = qs.sort((a, b) => qs.filter(q => q === b).length - qs.filter(q => q === a).length)[0];
      const entries = new Map();
      for (const r of res.records) {
        const [vi, box] = where.get(r) || [0, null], q = qOf(r) ?? main, key = vi + ':' + q;
        if (!entries.has(key)) {
          const right = NQ.has(q) ? NQ.get(q).thumb : await toThumb(await PC.renderPage(newDoc, q, PC.DPI, false));
          // 原稿のある範囲(旧版との比べ合わせで使う): このページで見つかった品番のまわり
          const bs = res.records.flatMap(r => r.anchors.filter(a => a.p.q === q).map(a => a.box)), u = bs.length ? PC.union(bs) : null, B = JP[q].B, m = 0.1 * Math.hypot(B.w, B.h);
          entries.set(key, { kind: 'records', q, src: x.src, label: sh.name, res, recs: [], cov: u && [u[0] - m, u[1] - m, u[2] + m, u[3] + m], ch: [], im: [], an: [], notes: [], restBoxes: [], ot: [], nt: [], pairs: [], oc: [], nc: [], extra: [], thumbs: { left: thumbs[vi], right } });
        }
        entries.get(key).recs.push({ r, box });
      }
      const at = P.indexOf(x.all[0]);
      for (const d of x.all) P.splice(P.indexOf(d), 1);
      P.splice(at, 0, ...entries.values());
    }
  }
  // 商品ごとの照合の項目
  function recordFindings(d, p, add) {
    const k = PC.S, px = b => b && b.map(v => v * k), res = d.res, ok = [], gone = [];
    for (const { r, box } of d.recs) {
      const ref = `${r.row.rn}行目`;
      if (!r.anchors.length) { gone.push({ r, box }); continue; }
      if (r.fuzzy) {   // かぎがそのままは見つからず、1字違いがある
        const f = add(p + 1, 'T', px(box), r.fuzzy.t, res.key.label, '', '', px(r.fuzzy.box));
        Object.assign(f, { segs: charSegs(r.key, r.fuzzy.t), same: false, pboxes: [px(box)], pnboxes: [px(r.fuzzy.box)], ref, rec: { kind: 'key', field: res.key.label, want: r.key, got: r.fuzzy.t } });
      }
      for (const x of r.diffs) {
        const nb = x.got ? x.got.box : r.anchors[0].box;
        const f = add(p + 1, 'T', px(box), x.got ? x.got.t : '', x.f.label, '', '', px(nb));
        Object.assign(f, { segs: x.got ? charSegs(norm(x.want), x.got.t) : [['-', x.want]], same: false, pboxes: [px(box)], pnboxes: [px(nb)], ref, rec: { kind: 'field', field: x.f.label, want: x.want, got: x.got && x.got.t, key: r.key } });
        if (!x.got) f.approx = true;
      }
      if (!r.fuzzy && !r.diffs.length) ok.push({ r, box });
    }
    if (ok.length) {   // かぎも載る列もすべて一致した商品(まとめて1件。一覧には出さない)
      const f = add(p + 1, 'T', px(PC.union(ok.map(x => x.box).filter(Boolean))), '', '', '', '', px(PC.union(ok.flatMap(x => x.r.anchors.map(a => a.box)))));
      Object.assign(f, { auto: 'ok', refs: ok.map(x => `${x.r.row.rn}行目`), moreBoxes: ok.map(x => px(x.box)), moreNboxes: ok.flatMap(x => x.r.anchors.map(a => px(a.box))), rec: { kind: 'ok', n: ok.length, fields: [res.key.label, ...res.fields.map(f => f.label)] } });
    }
    // 成果物に見当たらない商品: 表の並びで続くものは1件にまとめる
    for (let i = 0; i < gone.length;) {
      let e = i; while (e + 1 < gone.length && res.records.indexOf(gone[e + 1].r) === res.records.indexOf(gone[e].r) + 1) e++;
      const run = gone.slice(i, e + 1), bx = run.map(x => px(x.box)).filter(Boolean);
      const f = add(p + 1, 'T', bx.length ? PC.union(bx) : [0, 0, 10, 10], '', res.key.label, '', '', null);
      Object.assign(f, { segs: [['-', run.map(x => x.r.key).join('・')]], same: false, pboxes: bx, refs: run.map(x => `${x.r.row.rn}行目`), ref: `${run[0].r.row.rn}行目`, goneN: run.length > 1 ? run.length : 0, rec: { kind: 'missing', field: res.key.label, n: run.length } });
      i = e + 1;
    }
  }
  const norm = s => [...String(s).replace(/\s/g, '')].map(PC.fold).join('').replace(/(?<=\d)[,，](?=\d)/g, '');

  // ---- 旧版(前回の成果物)との比べ合わせ ----
  //   旧版の各ページが成果物のどのページ・範囲に当たるかを求め、字の並びで対応づける
  //   返り値: 成果物のページ → { B, st: 字ごとに 0=旧版にない・1=旧版と同じ・2=旧版の別の字から変わった, gone: 旧版から消えた字の続き, maps }
  async function oldDiff(oldDoc, newDoc, NQ, prog) {
    const src = { numPages: oldDoc.numPages, page: p => ({ doc: oldDoc, i: p }), label: () => null, image: async p => ({ img: await PC.renderPage(oldDoc, p, 300, false), dpi: 300 }) };
    const pairs = await PC.pairPages(src, newDoc, (s, f) => prog('旧版：' + s, 0.94 + 0.03 * f)), out = new Map();
    for (let p = 0; p < pairs.length; p++) {
      const pr = pairs[p];
      if (pr.q < 0) continue;
      if (!out.has(pr.q)) { const B = NQ.has(pr.q) ? NQ.get(pr.q).B : await PC.pageText(newDoc, pr.q); out.set(pr.q, { B, st: new Uint8Array(B.chars.length), oc: [], used: new Uint8Array(B.chars.length), gone: [], maps: [] }); }
      const o = out.get(pr.q), A = await PC.pageText(oldDoc, p);
      if (!A.chars.length) continue;
      const blocks = PC.collatePage(A, o.B, { ...pr, noInstr: true, strict: true }, o.used, new Set());
      for (const b of blocks) {
        let run = [];
        for (const op of [...b.ops, ['|']]) {
          if (op.length === 3) { o.st[op[2]] = op[0] === '=' || op[0] === '~' ? 1 : 2; if (op[0] === 'x') o.oc[op[2]] = A.chars[b.s + op[1]].c; }   // oc: 置き換わる前の旧版の字
          if (op[0] === '-') { run.push(b.s + op[1]); continue; }
          if (run.length) o.gone.push({ p, cs: run.map(i => A.chars[i]), T: pr.T, near: op.length === 3 ? o.B.chars[op[2]].box : null });
          run = [];
        }
      }
      o.maps.push({ p, T: pr.T });
      await PC.tick();
    }
    return { pairs, byQ: out };
  }
  // 旧版から変わった所のうち、どの原稿も当たらない部分のもの(指示にない変更)を、結果のページに付ける
  //   成果物に字がある変化(旧版にない字)は、原稿のあるページでは「原稿にない文字」として出ているので、ここでは
  //   旧版から消えた字と、原稿がまったく当たらないページの旧版にない字を出す
  async function oldChanges(P, OLD, newDoc) {
    const k = PC.S, px = b => b.map(v => v * k);
    for (const [q, o] of OLD.byQ) {
      const ds = P.filter(d => d.q === q && d.kind !== 'none' && d.kind !== 'newonly');
      const covered = b => { const [x, y] = PC.center(b); return ds.some(d => { const R = d.kind === 'content' ? d.pr.region : d.kind === 'records' ? d.cov : d.crop || [0, 0, 1e9, 1e9]; return R && x >= R[0] && x <= R[2] && y >= R[1] && y <= R[3]; }); };
      const items = [];
      for (const g of o.gone) {
        const ob = PC.union(g.cs.map(c => c.box)), text = g.cs.map(c => c.c).join('');
        if (!/[\p{L}\p{N}]/u.test(text)) continue;
        const nb = g.near ? [g.near[0] - 1, g.near[1], g.near[0] + 1, g.near[3]] : PC.mapBox(g.T, ob);
        if (covered(nb)) continue;
        items.push({ kind: 'del', text, segs: [['-', text]], nbox: nb, old: { p: g.p, box: px(ob) } });
      }
      if (!ds.some(d => d.kind === 'content')) {   // 原稿がまったく当たらないページ(または同じレイアウトの原稿の外): 旧版にない字の続き
        let run = [];
        const flush = () => {
          if (run.length && run.some(j => /[\p{L}\p{N}]/u.test(o.B.chars[j].c))) {
            const nb = PC.union(run.map(j => o.B.chars[j].box)), m = o.maps[0];
            // 前後の同じ字(同じまとまりの6字まで)を添え、置き換わった字は旧版の字→成果物の字で示す
            const C = o.B.chars, it = C[run[0]].it, segs = [];
            const pre = []; for (let j = run[0] - 1; j >= 0 && pre.length < 6 && C[j].it === it && o.st[j] === 1; j--) pre.unshift(C[j].c);
            const post = []; for (let j = run[run.length - 1] + 1; j < C.length && post.length < 6 && C[j].it === it && o.st[j] === 1; j++) post.push(C[j].c);
            if (pre.length) segs.push(['=', pre.join('')]);
            for (const j of run) { const g = segs[segs.length - 1]; if (o.st[j] === 2 && o.oc[j]) { if (g && g[0] === '-') g[1] += o.oc[j]; else segs.push(['-', o.oc[j]]); } const h = segs[segs.length - 1]; if (h && h[0] === '+') h[1] += C[j].c; else segs.push(['+', C[j].c]); }
            if (post.length) segs.push(['=', post.join('')]);
            if (!covered(nb)) items.push({ kind: 'add', text: run.map(j => C[j].c).join(''), segs, nbox: nb, old: m ? { p: m.p, box: px(PC.mapBox(PC.invT(m.T), nb)) } : null });
          }
          run = [];
        };
        o.B.chars.forEach((c, j) => { if (o.st[j] !== 1) { if (run.length && o.B.chars[run[run.length - 1]].it !== c.it && PC.gap(o.B.chars[run[run.length - 1]].box, c.box) > 2 * (c.box[3] - c.box[1])) flush(); run.push(j); } else flush(); });
        flush();
      }
      for (const x of items) {
        let d = ds.find(d => !d.crop) || ds.find(d => d.crop && PC.center(x.nbox)[0] >= d.crop[0] && PC.center(x.nbox)[0] <= d.crop[2]) || P.find(e => e.kind === 'newonly' && e.q === q);
        if (!d) {
          const img = await PC.renderPage(newDoc, q, PC.DPI, false);
          d = { kind: 'newonly', q, src: null, label: null, ch: [], im: [], an: [], notes: [], restBoxes: [], ot: [], nt: [], pairs: [], oc: [], nc: [], extra: [], thumbs: { left: null, right: await toThumb(img) } };
          P.push(d);
        }
        const o0 = d.crop ? [d.crop[0], d.crop[1]] : [0, 0];
        (d.olds || (d.olds = [])).push({ ...x, nbox: [(x.nbox[0] - o0[0]) * k, (x.nbox[1] - o0[1]) * k, (x.nbox[2] - o0[0]) * k, (x.nbox[3] - o0[1]) * k] });
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
  // 違いが、数字のすぐ前後の通貨の記号だけ(「¥1,280」→「1,280円」)
  function unitOnly(ops, h, cs, B) {
    const chOf = o => (o[0] === '-' ? cs[o[1]].c : o[0] === '+' ? B[o[1]].c : null), digit = o => o && (o[0] === '=' || o[0] === '~') && /\d/.test(cs[o[1]].k);
    let unit = false;
    for (let q = h.s; q < h.e; q++) {
      const o = ops[q];
      if (o[0] === '=' || o[0] === '~') continue;
      if (o[0] === 'x' ? !(PC.UNIT.test(cs[o[1]].c) && PC.UNIT.test(B[o[2]].c)) : !PC.UNIT.test(chOf(o))) return false;
      unit = true;
    }
    return unit && (digit(ops[h.s - 1]) || digit(ops[h.e]));
  }
  // 自動確認の結果の文 → 'ok'(指示どおり)・'ng'(指示どおりでない可能性)・null(人が確認)
  const autoOf = chk => (/自動確認OK/.test(chk) ? 'ok' : /見当たらない|されていない|なっていない/.test(chk) ? 'ng' : null);
  // 内容で照合したページの指示(書き込み・コメント)の自動確認: 指示の文から、成果物にあるはずの文字・なくなるはずの文字を取り出し、
  // 原稿のページが当たる成果物の範囲で調べる。返り値: { auto, check } または null(文字では判定できない指示)
  //   quads: 取り消し線などが引かれた範囲(あれば、「トル」だけの指示はその下の字が消えたかを見る)
  function autoInstr(d, text, box, quads) {
    const st = new Map();
    for (const b of d.blocks) if (!b.instr) for (const o of b.ops) { if (o.length === 3) st.set(b.s + o[1], 'm'); else if (o[0] === '-') st.set(b.s + o[1], 'd'); }
    if (/^(トル|トルツメ|削除|取る)$/.test(String(text).replace(/\s/g, '')) && quads && quads.length) {
      const under = d.A.chars.map((c, i) => i).filter(i => { const [x, y] = PC.center(d.A.chars[i].box); return quads.some(q => x >= q[0] && x <= q[2] && y >= q[1] - 2 && y <= q[3] + 2); });
      if (!under.length) return null;
      const drop = under.map(i => d.A.chars[i].c).join('');
      return under.every(i => st.get(i) === 'd') ? { auto: 'ok', check: '削除を確認（自動確認OK）', drop } : { auto: 'ng', check: '削除されていない可能性（要確認）', drop };
    }
    if (!/[「『"“]/.test(text)) { const r = layoutInstr(d, text, quads, st); if (r !== undefined) return r; }
    const tgt = PC.instrTarget(text);
    if (!tgt) return null;
    const fk = s => [...String(s).replace(/\s/g, '')].map(PC.fold).join('').replace(d.A.loose ? /(?<=\d)[,，](?=\d)/g : /(?!)/g, '');
    const R = d.pr.region, M = 0.05 * Math.hypot(R[2] - R[0], R[3] - R[1]);
    const inR = c => { const [x, y] = PC.center(c.box); return x >= R[0] - M && x <= R[2] + M && y >= R[1] - M && y <= R[3] + M; };
    const area = fk(d.nq.B.chars.filter(inR).map(c => c.c).join(''));
    if (tgt.want) {
      const w = fk(tgt.want);
      if ([...w].length < 2) return null;   // 1字だけでは、たまたまある字と見分けられない
      return area.includes(w) ? { auto: 'ok', check: '指示の文字が成果物にある（自動確認OK）' } : { auto: 'ng', check: '指示の文字が成果物に見当たらない（要確認）' };
    }
    // なくなるはずの文字: 指示の近くの原稿の字にあれば、その字が成果物に対応づいたまま(残っている)かを見る。なければ成果物の範囲にないことを確かめる
    const x = fk(tgt.drop), A = d.A.chars;
    const near = A.map((c, i) => i).filter(i => PC.gap(A[i].box, box) < 30);
    const ks = near.map(i => A[i].k).join(''), occ = [];
    for (let k = ks.indexOf(x); k >= 0 && x; k = ks.indexOf(x, k + 1)) occ.push(near.slice(k, k + [...x].length));
    const gone = occ.length ? occ.some(is => is.every(i => st.get(i) === 'd')) : !area.includes(x);
    return gone ? { auto: 'ok', check: '削除を確認（自動確認OK）' } : { auto: 'ng', check: '削除されていない可能性（要確認）' };
  }
  // 書式の指示(太字・大きさ・色)を、指示の付いた原稿の字(取り消し線・マーカーなどの範囲)に対応する成果物の字で確かめる
  //   大きさ: ページの字の大きさの中央値に対する比が、原稿より1割以上大きい(小さい)か。太字: 書体の名前、なければ線の太さ(ページの字より25%以上)
  //   返り値: undefined(書式の指示ではない) / null(書式の指示だが判定できない) / { auto, check }
  const BOLD = /bold|heavy|black|demi|semibold|extrabold|ultra|W[6-9]\b|-(?:B|H|E|U|DB|EB)\b|-Bo/i;
  function layoutInstr(d, text, quads, st) {
    const t = String(text).replace(/\s/g, ''), named = Object.keys(COLORS).find(c => t.includes(c));
    const kind = /太字|太く|ボールド/.test(t) ? 'bold' : /細字|細く/.test(t) ? 'thin' : /大きく|拡大|大きめ/.test(t) ? 'big' : /小さく|縮小|小さめ/.test(t) ? 'small' : named && /色|字|に/.test(t) ? 'color' : null;
    if (!kind) return undefined;
    if (!quads || !quads.length) return null;
    const A = d.A, B = d.nq.B, map = new Map();
    for (const b of d.blocks) if (!b.instr) for (const o of b.ops) if (o.length === 3) map.set(b.s + o[1], o[2]);
    const ai = A.chars.map((c, i) => i).filter(i => { const [x, y] = PC.center(A.chars[i].box); return quads.some(q => x >= q[0] && x <= q[2] && y >= q[1] - 2 && y <= q[3] + 2); });
    const bj = ai.map(i => map.get(i)).filter(j => j != null);
    if (!ai.length || bj.length < 0.5 * ai.length) return null;   // 指示の付いた字が、成果物のどの字か分からない
    const med = xs => { const v = xs.filter(x => x > 0).sort((a, b) => a - b); return v.length ? v[v.length >> 1] : 0; };
    let ok;
    if (kind === 'big' || kind === 'small') {
      const sA = i => A.items[A.chars[i].it].size, sB = j => B.items[B.chars[j].it].size;
      const rA = med(ai.map(sA)) / med(A.chars.map((_, i) => sA(i))), rB = med(bj.map(sB)) / med(B.chars.map((_, j) => sB(j)));
      if (!rA || !rB) return null;
      ok = kind === 'big' ? rB >= rA * 1.1 : rB <= rA * 0.9;
    } else if (kind === 'bold' || kind === 'thin') {
      const fonts = bj.map(j => B.items[B.chars[j].it].font || ''), byName = fonts.filter(f => BOLD.test(f)).length >= 0.5 * fonts.length;
      const ink = med(bj.map(j => (B.chars[j].sty || {}).ink || 0)), page = med(B.chars.map(c => (c.sty || {}).ink || 0));
      if (!page || !ink) return null;
      const bold = byName || ink >= page * 1.25;
      ok = kind === 'bold' ? bold : !bold && ink <= page * 0.95;
    } else {
      const cs = bj.map(j => B.chars[j].sty).filter(Boolean);
      if (!cs.length) return null;
      const col = [0, 1, 2].map(k => cs.reduce((t, c) => t + c.color[k], 0) / cs.length), { h, s } = hueOf(col), [a, b] = COLORS[named];
      ok = s > 0.3 && (a <= b ? h >= a && h <= b : h >= a || h <= b);
    }
    return ok ? { auto: 'ok', check: '書式の指示どおり（自動確認OK）' } : { auto: 'ng', check: '書式の指示どおりになっていない可能性（要確認）' };
  }
  const instrCheck = t => /後送/.test(t) ? '後送（素材はあとから届く）' : /\.(png|jpe?g|psd|ai|pdf|tiff?|eps|gif)\b|ファイル名/i.test(t) ? '使う画像・素材の指定' : '指示どおりか確認';
  function contentFindings(d, p, add0) {
    const mine = [], add = (...a) => { const f = add0(...a); mine.push(f); return f; };   // このページで出した項目(指示との結びつけに使う)
    const k = PC.S, px = b => b && b.map(v => v * k), A = d.A.chars, B = d.nq.B.chars;
    const toNew = b => { const m = fwdOf(d, b), R = d.pr.region; return [Math.max(R[0], Math.min(m[0], R[2] - 20)), Math.max(R[1], Math.min(m[1], R[3] - 20)), Math.min(R[2], Math.max(m[2], R[0] + 20)), Math.min(R[3], Math.max(m[3], R[1] + 20))]; };
    const refOf = new Map((d.A.blocks || []).map(b => [b[0], b[4] || '']));   // データファイルの表の行番号(「3行目」)
    // 取り消し線などに「トル」と付いた原稿の文は、成果物になくても書き込み(指示)とせず、消す指示の付いた文として扱う
    //   (成果物にない文は、位置の手がかりがなく欄外の書き込みと見分けにくいため)
    const delQ = d.annots.filter(n => /^(トル|トルツメ|削除|取る)$/.test(n.text.replace(/\s/g, '')) && n.quads && n.quads.length).flatMap(n => n.quads);
    const underDel = c => { const [x, y] = PC.center(c.box); return delQ.some(q => x >= q[0] && x <= q[2] && y >= q[1] - 2 && y <= q[3] + 2); };
    for (const b of d.blocks) {
      if (!b.instr || b.found >= 0.8) continue;
      const cs = A.slice(b.s, b.e);
      if (cs.filter(underDel).length >= 0.8 * cs.length) { b.instr = false; b.ops = cs.map((_, i) => ['-', i]); }
    }
    const pend = [];   // 違い(T)・書き方の違い(V)。同じ違いのくり返しは、あとで1件にまとめる
    for (const b of d.blocks) {
      const cs = A.slice(b.s, b.e), box = PC.union(cs.map(c => c.box));
      if (b.instr) {
        const hit = b.ops.filter(o => o.length === 3).map(o => B[o[2]]), found = b.found >= 0.8 && hit.length;
        const a = found ? { auto: 'ok', check: '指示の文字が成果物にある（自動確認OK）' } : autoInstr(d, b.text, box);
        const f = add(p + 1, 'K', px(box), b.text, '原稿の書き込み', b.text, a ? a.check : instrCheck(b.text), px(found ? PC.union(hit.map(c => c.box)) : toNew(box)));
        if (a) f.auto = a.auto;
        if (!found) f.approx = true;
        if (refOf.get(b.s)) f.ref = refOf.get(b.s);
        continue;
      }
      const vs = [];
      for (const h of PC.hunksOf(b.ops)) {
        const r = hunkView(b.ops, h, cs, B);
        // 旧版があるとき: 違う字の所が旧版と同じ(前回のまま=直っていない)か、旧版からも変わったか
        const hj = b.ops.slice(h.s, h.e).map(o => (o.length === 3 ? o[2] : o[0] === '+' ? o[1] : -1)).filter(j => j >= 0);
        r.vsOld = d.oldSt && hj.length ? (hj.every(j => d.oldSt[j] === 1) ? 'same' : 'changed') : null;
        if (h.variant || (d.pr.free && unitOnly(b.ops, h, cs, B))) { vs.push(r); continue; }
        pend.push({ cat: 'T', box: px(r.box || box), nbox: px(r.nbox || toNew(r.box || box)), segs: r.segs, pboxes: r.box ? [px(r.box)] : [], pnboxes: r.nbox ? [px(r.nbox)] : [], approx: !r.nbox, ref: refOf.get(b.s), gone: d.A.order && b.ops.length > 0 && b.ops.every(o => o[0] === '-') ? d.A.order.get(b.s) : -1, vsOld: r.vsOld });
      }
      if (vs.length) {   // 書き方だけの違いは、まとまりごとに1件
        const segs = []; vs.forEach((r, i) => { if (i) segs.push(['=', '…']); segs.push(...r.segs); });
        pend.push({ cat: 'V', box: px(union(vs.map(r => r.box))), nbox: px(union(vs.map(r => r.nbox))), segs, pboxes: vs.map(r => px(r.box)), pnboxes: vs.map(r => px(r.nbox)), ref: refOf.get(b.s) });
      }
    }
    // データファイルの原稿で、同じ違い(「¥」→「円」、「(」→「（」など)が3か所以上くり返すときは1件にまとめる(位置はすべて示す)
    //   数字の違い(値の違い)はまとめない(1か所ずつ確かめるもの)
    const keyOf = x => x.segs.filter(g => g[0] !== '=').map(g => g[0] + g[1]).join('|');
    const byKey = new Map();
    // データファイルの原稿で、成果物に見当たらないまとまり(表の行・段落)が、原稿の並びで3つ以上続くときは1件にまとめる
    //   (支給された表のうち、一部の行だけを載せたときなど。行番号の範囲と、すべての位置を示す)
    if (d.pr.free) {
      const gone = pend.filter(x => x.gone >= 0).sort((x, y) => x.gone - y.gone);
      for (let k = 0; k < gone.length;) {
        let e = k; while (e + 1 < gone.length && gone[e + 1].gone === gone[e].gone + 1) e++;
        if (e - k >= 2) {
          const run = gone.slice(k, e + 1), [x, ...rest] = run;
          for (const y of rest) pend.splice(pend.indexOf(y), 1);
          Object.assign(x, { goneN: run.length, refs: run.map(y => y.ref).filter(Boolean), moreBoxes: rest.map(y => y.box), moreNboxes: [] });
        }
        k = e + 1;
      }
    }
    for (const x of pend) {
      if (x.goneN) { byKey.set(Symbol(), [x]); continue; }
      const k = keyOf(x);
      if (!d.pr.free || (x.cat === 'T' && /\p{N}/u.test(k))) { byKey.set(Symbol(), [x]); continue; }
      if (!byKey.has(x.cat + k)) byKey.set(x.cat + k, []);
      byKey.get(x.cat + k).push(x);
    }
    for (const xs of byKey.values()) {
      const g = xs.length >= 3 ? [xs] : xs.map(x => [x]);
      for (const [x, ...rest] of g) {
        const f = add(p + 1, x.cat, x.box, '', '', '', '', x.nbox);
        Object.assign(f, { segs: x.segs, same: false, pboxes: x.pboxes, pnboxes: x.pnboxes });
        if (x.approx) f.approx = true;
        if (x.ref) f.ref = x.ref;
        if (x.vsOld && !rest.length) f.vsOld = x.vsOld;
        if (x.goneN) Object.assign(f, { goneN: x.goneN, refs: x.refs, moreBoxes: x.moreBoxes, moreNboxes: [] });
        if (rest.length) Object.assign(f, { more: rest.length + 1, moreBoxes: rest.flatMap(y => y.pboxes.length ? y.pboxes : [y.box]), moreNboxes: rest.flatMap(y => y.pnboxes.length ? y.pnboxes : [y.nbox]), refs: [x, ...rest].map(y => y.ref).filter(Boolean) });
      }
    }
    for (const n of d.annots) {   // コメント(注釈): 書かれた指示を、成果物の対応する位置と並べて示す
      if (!n.text.trim()) continue;
      const a = autoInstr(d, n.text, n.box, n.quads);
      const f = add(p + 1, 'K', px(n.box), n.text, 'コメント', n.text, a ? a.check : instrCheck(n.text), px(toNew(n.box)));
      if (a) { f.auto = a.auto; if (a.drop) f.dropText = a.drop; }
      f.approx = true;
      const rb = (d.A.blocks || []).find(b => b[4] && ov(PC.union(d.A.chars.slice(b[0], b[1]).map(c => c.box)), n.box));
      if (rb) f.ref = rb[4];
    }
    for (const e of d.extra) {
      if (e.cat === 'I') {
        const f = add(p + 1, 'I', px(e.box), e.texts.join(' ／ '), '', '', '', px(e.nbox));
        Object.assign(f, { pnboxes: e.nboxes.map(px), texts: e.texts });
        if (e.noSrc) Object.assign(f, { noSrc: true, onNew: true });
        // 原稿のない部分で旧版から変わったものは、指示にない変更
        if (e.noSrc && e.vsOld === 'changed') {
          // 旧版から変わった字だけに色を付ける(置き換わった字は旧版の字→成果物の字、旧版にない字は足した字)
          const segs = [], B = d.nq.B.chars, push = (t, c) => { const g = segs[segs.length - 1]; if (g && g[0] === t) g[1] += c; else segs.push([t, c]); };
          e.jss.forEach((js, n) => { if (n) push('=', ' ／ '); for (const j of js) { const st = e.os.st[j]; if (st === 1) push('=', B[j].c); else { if (st === 2 && e.os.oc[j]) push('-', e.os.oc[j]); push('+', B[j].c); } } });
          const m = e.os.maps[0];
          Object.assign(f, { cat: 'C2', label: PC.CAT.C2, how: '旧版から変わった所（原稿のない部分）', fromOld: 'add', newOnly: true, segs, same: false, old: m ? { p: m.p, box: px(PC.mapBox(PC.invT(m.T), e.nbox)) } : null });
        }
        if (e.old === 'same') f.oldSame = true;
        if (e.vsOld) f.vsOld = e.vsOld;
        continue;
      }
      const f = add(p + 1, e.cat, px(e.box), e.show, '', '', '', px(e.nbox));
      f.onNew = true;
      if (e.cat === 'N') Object.assign(f, { segs: [['+', e.show]], same: false, pnboxes: [px(e.nbox)] });
      if (e.vsOld) f.vsOld = e.vsOld;
    }
    // 自動で指示どおりと確かめた指示の近くにある「原稿と違う」で、違いが指示の文字そのもの(「A」→「B」のA・B)のものは、指示どおりの違いとする
    const fk = s => [...String(s || '').replace(/\s/g, '')].map(PC.fold).join('');
    const far = 0.15 * k * Math.hypot(d.A.w || 0, d.A.h || 0);
    for (const kf of mine.filter(f => f.cat === 'K' && f.auto === 'ok')) {
      const tgt = PC.instrTarget(kf.note) || (kf.dropText ? { drop: kf.dropText } : null);
      if (!tgt) continue;
      const W = tgt.want ? fk(tgt.want) : '', X = tgt.drop ? fk(tgt.drop) : '';
      for (const f of mine) {
        if ((f.cat !== 'T' && f.cat !== 'N') || f.auto || f.more || f.goneN) continue;
        const del = fk((f.segs || []).filter(g => g[0] === '-').map(g => g[1]).join('')), ins = fk((f.segs || []).filter(g => g[0] === '+').map(g => g[1]).join(''));
        if (!(del || ins) || (del && del !== X) || (ins && ins !== W) || PC.gap(kf.box, f.box) > far) continue;
        f.auto = 'ok'; f.byInstr = kf.note;
      }
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
      PC.snapChars(B, img, PC.S);
      for (const c of B.chars) c.sty = styleOf(img, c.box.map(x => x * PC.S));   // 字の見た目(書式の指示の確認用)
      const v = { B, notes: PC.designerNotes(B, img, PC.S), used: new Uint8Array(B.chars.length), usedFree: new Uint8Array(B.chars.length), thumb: await toThumb(img) };
      NQ.set(q, v);
      return v;
    };
    // 2) ページごとに照合: 同じレイアウトなら字形を重ねて比べ、レイアウトが違えば文字データの内容で比べる
    for (let p = 0; p < npages; p++) {
      const step = (s, f) => prog(`${p + 1} / ${npages} ページ：${s}`, W0 + (1 - W0) * 0.97 * (p + f) / npages);
      step('描画', 0.01); await PC.tick();
      const pr = pairs[p], it = src.page(p), label = src.label(p);
      const put = d => { d.src = p; d.label = label; P.push(d); return d; };
      if (pr.q < 0) { put(await nonePage(src, p)); continue; }
      if (it.virt) {   // データファイルのページ: まとまり(段落・表の行)ごとに、載っている成果物のページを決めて照合する
        const nqs = []; for (const c of pr.qs) nqs.push(await newPage(c.q));
        const blocks = it.virt.blocks, { who, also } = PC.splitFree(it.virt.text, blocks, nqs.map(x => ({ B: x.B })));
        const left = it.virt.render(PC.DPI), thumb = await toThumb(left);
        //   表の見出しの行が、表の続くページにもそのまま載っていれば、そのページでも照合する(「原稿にない文字」としないように)
        const subs = pr.qs.map((c, ci) => ({ c, nq: nqs[ci], blocks: blocks.filter((_, b) => who[b] === ci), notes: [] })).filter(x => x.blocks.length);
        for (const x of subs) { const ci = pr.qs.indexOf(x.c); x.blocks = blocks.filter((_, b) => who[b] === ci || also[b].includes(ci)); }
        const boxOf = bs => PC.union(bs.map(([s, e]) => PC.union(it.virt.text.chars.slice(s, e).map(c => c.box))));
        for (const n of it.virt.notes) {   // コメントは、重なるまとまりのあるページへ
          const x = subs.find(x => x.blocks.some(b => ov(boxOf([b]), n.box))) || subs[0];
          x.notes.push(n);
        }
        for (const x of subs) {
          const d = put(await contentPage(src, p, { ...pr, q: x.c.q, region: x.c.region }, x.nq, step, { blocks: x.blocks, notes: x.notes, left, thumb }));
          if (d.noText) warn.push(`${label} に当たる成果物の${x.c.q + 1}ページ目には文字データがほとんどないため（文字のアウトライン化など）、文字では比べられませんでした`);
        }
        continue;
      }
      if (!pr.same && !it.doc) {
        warn.push(`${p + 1}ページ目は、成果物とレイアウトが違う紙の原稿のため、自動では比べられませんでした`);
        put(await nonePage(src, p)); continue;
      }
      if (!pr.same) {
        const d = await contentPage(src, p, pr, await newPage(pr.q), step);
        if (d.noText) warn.push(`${p + 1}ページ目に当たる成果物のページには文字データがほとんどないため（文字のアウトライン化など）、文字では比べられませんでした`);
        put(d); continue;
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
      put(d);
    }
    // 成果物の全ページの文字データ(商品ごとの照合・成果物だけで見るチェックに使う)
    const JP = [];
    for (let q = 0; q < newDoc.numPages; q++) JP.push({ q, B: NQ.has(q) ? NQ.get(q).B : await PC.pageText(newDoc, q) });
    prog('表の商品ごとの照合', 0.93); await PC.tick();
    await recordPages(P, src, JP, newDoc, NQ);
    // 旧版(任意)があれば、成果物の字が旧版から変わったかを求める(原稿のない部分の変化・前回のままの見分けに使う)
    const OLD = opts.oldDoc ? await oldDiff(opts.oldDoc, newDoc, NQ, prog) : null;
    if (OLD) for (const d of P) if (d.kind === 'content' && OLD.byQ.has(d.q)) d.oldSt = OLD.byQ.get(d.q).st;
    leftovers(P, NQ, OLD && OLD.byQ);
    if (OLD) await oldChanges(P, OLD, newDoc);
    const none = P.map(d => (d.kind === 'none' && !d.label ? d.src + 1 : 0)).filter(Boolean), noneV = P.filter(d => d.kind === 'none' && d.label).map(d => d.label);
    if (none.length) warn.push(`原稿の${spans(none)}ページ目は、対応する成果物のページが見つかりませんでした（照合していません）`);
    if (noneV.length) warn.push(`${noneV.join('、')}は、成果物に載っている所が見つかりませんでした（照合していません）`);
    const usedQ = new Set(P.map(d => d.q).filter(q => q >= 0)), lost = [];
    for (let q = 0; q < newDoc.numPages; q++) if (!usedQ.has(q)) lost.push(q + 1);
    if (lost.length) warn.push(`成果物の${spans(lost)}ページ目は、対応する原稿のページが見つかりませんでした`);
    // 3) 成果物だけを読んで、問題がありそうな所(ページの端の切れ端・かっこ・日付・表記ゆれなど。原稿とは照らし合わせない)。項目は、その成果物のページを表示している結果のページに付ける
    //   (見開きの片側だけを照合したページは、その側にある項目だけ。どこにも表示していない成果物のページは「成果物だけ」のページを足す)
    prog('辞書を読み込み、成果物だけで文字・表記を確認', 0.985); await PC.tick();
    const TK = await PC.tokenizer();
    if (!TK) warn.push('辞書を読み込めなかったため、成果物だけのチェックの一部（表記ゆれの一部・助詞の続き方など）を行っていません');
    for (const x of PC.jcheck(JP, TK)) {
      const c = PC.center(x.box), ds = P.filter(d => d.q === x.q && d.kind !== 'none');
      let d = ds.find(d => d.crop && c[0] >= d.crop[0] && c[0] <= d.crop[2] && c[1] >= d.crop[1] && c[1] <= d.crop[3]) || ds.find(d => !d.crop);
      if (!d) {
        d = P.find(e => e.kind === 'newonly' && e.q === x.q);
        if (!d) {
          const img = await PC.renderPage(newDoc, x.q, PC.DPI, false);
          d = { kind: 'newonly', q: x.q, src: null, label: null, ch: [], im: [], an: [], notes: [], restBoxes: [], ot: [], nt: [], pairs: [], oc: [], nc: [], extra: [], thumbs: { left: null, right: NQ.has(x.q) ? NQ.get(x.q).thumb : await toThumb(img) } };
          P.push(d);
        }
      }
      const o = d.crop ? [d.crop[0], d.crop[1]] : [0, 0], px = b => [(b[0] - o[0]) * PC.S, (b[1] - o[1]) * PC.S, (b[2] - o[0]) * PC.S, (b[3] - o[1]) * PC.S];
      (d.jf || (d.jf = [])).push({ ...x, nbox: px(x.box), more: x.boxes ? (x.boxes.get(x.q) || []).slice(1).filter(b => !d.crop || (PC.center(b)[0] >= d.crop[0] && PC.center(b)[0] <= d.crop[2])).map(px) : [] });
    }

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
        if (c.kind !== 'text' || !c.before || c.tag === 'layout' || c.before === c.after) continue;   // 字が同じ(見た目だけの変化)ものは直しの語にしない
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
    const approx = (d, nb) => d.kind !== 'content' ? nb : (d.pr.free ? backOf(d, nb.map(v => v / PC.S)) : PC.mapBox(PC.invT(d.pr.T), nb.map(v => v / PC.S))).map(v => v * PC.S);
    const tokBox = (d, k) => pm(d).has(k) ? d.nt[pm(d).get(k)].box : null;
    // 結果の一覧
    const F = [];
    const add = (page, cat, box, show = '', how = '', note = '', check = '', nbox = null) => { const f = { id: F.length, page, cat, label: PC.CAT[cat], box: box.map(Math.trunc), nbox: nbox ? nbox.map(Math.trunc) : null, show, how, note, check }; F.push(f); return f; };
    P.forEach((d, p) => {
      if (d.kind === 'content') contentFindings(d, p, add);
      if (d.kind === 'records') recordFindings(d, p, add);
      for (const x of d.olds || []) {   // 旧版から変わった所(原稿のない部分): 指示にない変更
        const f = add(p + 1, 'C2', x.nbox, x.text, '旧版から変わった所（原稿のない部分）', '', '', x.nbox);
        Object.assign(f, { onNew: true, newOnly: true, fromOld: x.kind, segs: x.segs, same: false, pnboxes: [x.nbox], old: x.old });
      }
      for (const x of d.jf || []) {   // 成果物だけで見た問題
        const f = add(p + 1, 'J', x.nbox, x.show, '', '', '', x.nbox);
        Object.assign(f, { onNew: true, newOnly: true, level: x.level, j: { kind: x.kind, sub: x.sub, want: x.want, msg: x.msg, ctx: x.ctx, count: x.count || 0 }, moreNboxes: x.more, pnboxes: [x.nbox] });
      }
      for (const c of [...d.ch, ...d.im]) {
        const st = c.hw ? 'H' : c.status || (c.kind === 'text' ? (c.look === 'color' ? 'C3' : 'C2') : 'C3'), a = c.anchor || {};
        let chk = '', wantUsed = '';
        if (a.note && c.kind === 'text' && c.tag === 'layout') {   // 改行・追い込みの指示: 段落の始まりが指示どおりに変わったか
          const t = a.note.replace(/\s/g, '');
          if (/改行|改段|段落/.test(t)) chk = (c.show || '').includes('追加') ? '改行を確認（自動確認OK）' : '改行の指示どおりになっていない可能性（要確認）';
          else if (/追い込|追込|改行トル|改行なし/.test(t)) chk = (c.show || '').includes('解除') ? '追い込みを確認（自動確認OK）' : '追い込みの指示どおりになっていない可能性（要確認）';
        }
        if (a.note && c.kind === 'text' && c.tag !== 'layout') {   // 指示文(注釈のコメント)が、修正後の該当箇所の前後にあるか
          // 「目指し（以下同様）」のような添え書きは外す(指示文全体がかっこ書きなら外さない)
          const strip = a.note.replace(/[（(][^）)]*(以下同様|全体|ママ|イキ|トル|同様)[^）)]*[）)]/g, '').replace(/\s/g, '');
          const want = strip || a.note.replace(/\s/g, '');
          // 「A」→「B」・「B」に修正・「A」トル のような指示は、何に直すか(B)・何を消すか(A)を取り出して調べる
          const tgt = PC.instrTarget(want), ctxOf = w => (c.nbox ? around(d.nc, c.nbox, [...w].length + 3) : '');
          if (tgt && tgt.want) { wantUsed = tgt.want; chk = ctxOf(tgt.want).includes(tgt.want) ? '指示文が修正後にある（自動確認OK）' : '指示文が修正後に見当たらない（要確認）'; }
          else if (tgt && tgt.drop) chk = c.tag === 'delete' || !c.after || !ctxOf(tgt.drop).includes(tgt.drop) ? '削除を確認（自動確認OK）' : '削除されていない可能性（要確認）';
          else if (/太字|細字|書体|ゴシック|明朝|イタリック|斜体|色|サイズ|大きく|小さく|字下げ|改行|追い込み|写真|差し?替/.test(want) || /^(赤|青|緑|黒|白|朱|紫|ピンク|オレンジ|黄)(色|字)?(に|で)?(する|して)?$/.test(want)) {
            // 同じ指示に結びついた変化(行の折り返しなどで分かれる)のどれかで指示どおりの見た目になっていれば、指示どおりとする
            const sc = d.kind === 'annot' && c.sty ? styleCheck(want, c.sty.o, c.sty.n) : null;
            const any = sc && (a.hit || []).some(h => h.sty && /OK/.test(styleCheck(want, h.sty.o, h.sty.n) || ''));
            chk = sc ? (any ? '書式の指示どおり（自動確認OK）' : sc) : '書式・組みの指示（人が確認）';
          }
          else if (/^(トル|トルツメ|トルママ|削除)$/.test(want)) chk = c.tag === 'delete' || !c.after ? '削除を確認（自動確認OK）' : '削除されていない可能性（要確認）';
          else { wantUsed = want; const ctx = ctxOf(want); chk = want && ctx.includes(want) ? '指示文が修正後にある（自動確認OK）' : '指示文が修正後に見当たらない（要確認）'; }
        }
        add(p + 1, st, c.obox, c.show + (c.look === 'color' ? '（色のみ）' : ''), a.how || c.why || '', a.note || '', chk, c.nbox);
        const f = F[F.length - 1];
        // 指示どおりかを自動で判定できたもの(1字だけの指示は、変わった字がその字そのものでなければ、たまたまある字と見分けられないので人が確認)
        if (st === 'A' && chk) { const v = autoOf(chk); if (v && !(v === 'ok' && wantUsed && [...wantUsed].length < 2 && (c.after || '').replace(/\s/g, '') !== wantUsed)) f.auto = v; }
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
    const pages = P.map(d => ({ ...d.thumbs, kind: d.kind, q: d.q, src: d.src, label: d.label, crop: d.crop || null, region: d.kind === 'content' ? d.pr.region.map(v => v * PC.S) : null }));
    // 旧版のページの表示用の画像(旧版から変わった所の項目で使うものだけ)
    const oldPages = [];
    if (opts.oldDoc) for (const p of new Set(F.filter(f => f.old).map(f => f.old.p))) oldPages[p] = await toThumb(await PC.renderPage(opts.oldDoc, p, PC.DPI, false));
    return { findings: F, pages, oldPages, rules: rules.filter(r => r.check === '未統一').map(r => ({ frm: shown(r), to: r.to, how: r.how })), warn };
  };
})();
