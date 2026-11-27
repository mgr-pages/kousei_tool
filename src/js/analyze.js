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
    U: '文字として確かめていない所（文字が図形で、文字データがない）',
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
  //   OCR で読んだ字(3つ目が 'ocr')は位置が正確でないため、字の中心が字形の中にあるときだけ使う(近くの字を当てて、別の字と示さないように)
  function tokText(cs, box) {
    const [x0, y0, x1, y1] = box, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const inside = cs.filter(([, b]) => x0 - 2 <= (b[0] + b[2]) / 2 && (b[0] + b[2]) / 2 <= x1 + 2 && y0 - 2 <= (b[1] + b[3]) / 2 && (b[1] + b[3]) / 2 <= y1 + 2);
    if (inside.length) return inside.map(c => c[0]).join('');
    cs = cs.filter(c => c[2] !== 'ocr');
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
    //   本当の追い込み・改行は、字がすぐ隣に続く所で起きる: 追い込みは成果物で、改行は原稿で、その字が前の字のすぐ後ろ(字1つ分まで)に続いているものだけを出す
    //   (表のセルの文字の幅が変わって、セルの間が詰まって1行・離れて別の行とみなされただけのものを出さないように)
    const tight = (ts, a, b) => a >= 0 && b < ts.length && PC.gap(ts[a].box, ts[b].box) <= Math.max(ts[b].box[3] - ts[b].box[1], ts[b].box[2] - ts[b].box[0]);
    for (const [k, m] of pairs) {
      const po = fo.has(k) && fo.get(k).para, pn = fn.has(m) && fn.get(m).para;
      if (po && !pn && !tight(nt, m - 1, m)) continue;
      if (!po && pn && !tight(ot, k - 1, k)) continue;
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
  //   大きなページ(A3・見開きなど)は、面積が 2400×2400 画素までになるよう縮める(w, h は元の大きさ。表示のときに縮めた分を戻す)。
  //   長い辺で決めると、縦に長いページ(ランディングページなど)の幅がとても粗くなり、印刷で字が読めないため(長い辺は 6000画素まで)
  //   (メモリを抑える: もとの大きさの写し・canvas を作らずに縮め(createImageBitmap)、縮めた画像の上に白を 45% 重ねて薄める(もとの画像を 55% に薄める計算と同じ)。
  //    使った置き場はすぐ手放す)
  async function toThumb(img) {
    const k = Math.min(1, Math.sqrt(2400 * 2400 / (img.w * img.h)), 6000 / Math.max(img.w, img.h));
    const W = Math.max(1, Math.round(img.w * k)), H = Math.max(1, Math.round(img.h * k));
    const bmp = await createImageBitmap(new ImageData(img.d instanceof Uint8ClampedArray ? img.d : new Uint8ClampedArray(img.d), img.w, img.h), k < 1 ? { resizeWidth: W, resizeHeight: H, resizeQuality: 'high' } : {});
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.drawImage(bmp, 0, 0); bmp.close();
    ctx.globalAlpha = 0.45; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    c.width = c.height = 0;
    return { url: URL.createObjectURL(blob), w: img.w, h: img.h };
  }
  //   パタパタ表示(旧版と成果物を同じ所に重ねて交互に出す)の位置合わせ: 旧版のページの画素 → 結果のページの成果物の画像の画素。
  //   T: 旧版の pt → 成果物の pt、o0: 結果のページが成果物のページの一部(見開きの片側など)なら、その左上(pt)。形は T と同じ [a, b, tx, ty, ay]
  const pxM = (T, o0 = [0, 0]) => (T ? [T[0], T[1], PC.S * (T[2] - o0[0]), PC.S * (T[3] - o0[1]), T.length > 4 ? T[4] : T[0]] : null);

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
  // ---- 原稿のPDFのページが、成果物と同じデータから書き出したものか(紙のスキャンでないか)を、描画を比べて測る ----
  //   注釈を消した原稿のページと成果物のページを、同じ解像度(50dpi)でそのまま描いて重ね、インクのある画素(どちらかが白でない)の
  //   半分以上が同じ色(差 8 以内)なら、同じデータから書き出したもの。紙のスキャンは、位置・にじみ・紙の色がそろわないので、ほとんど
  //   一致しない(テストの紙のスキャン9ページで 0.3〜3%。同じデータから書き出したPDFは 82〜100%)。ページの大きさが違えば測らない(false)
  //   (これまでは「文字データがあるか」「ページを覆う画像があるか」で決めていたため、ページ全体が1枚の画像のPDFは、成果物と
  //   描画がまったく同じでも紙のスキャンとして扱い、描き方の違い(300dpi で描いて縮めたもの と 200dpi の描画)を違いとしていた)
  async function sameSource(doc, i, newDoc, q) {
    const D = 50, A = await PC.renderPage(doc, i, D, false), B = await PC.renderPage(newDoc, q, D, false);
    if (A.w !== B.w || A.h !== B.h) return false;
    const a = A.d, b = B.d;
    let ink = 0, same = 0;
    for (let j = 0; j < a.length; j += 4) {
      if (a[j] >= 245 && a[j + 1] >= 245 && a[j + 2] >= 245 && b[j] >= 245 && b[j + 1] >= 245 && b[j + 2] >= 245) continue;
      ink++;
      if (Math.abs(a[j] - b[j]) <= 8 && Math.abs(a[j + 1] - b[j + 1]) <= 8 && Math.abs(a[j + 2] - b[j + 2]) <= 8) same++;
    }
    return ink > 0 && same >= 0.5 * ink;
  }
  async function annotPage(src, p, nw, nc, cb, step, nref = null) {
    const { doc, i } = src.page(p);
    const old = await PC.renderPage(doc, i, PC.DPI, false), oc = await PC.textCharsSnapped(doc, i, old);
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
    mergeNumbers(merged, ot, oc, nt, nc);
    describe(merged, ot, ol, nt, nl, oc, nc);
    //   文字データでも比べる(原稿も成果物もPDF): 字形のまとまり方が変わっただけの所を違いとしないように、また違う字を正しく示すように
    let tx = null;
    if (nref) {
      step('文字データを比べています', 0.6); await PC.tick();
      const At = await PC.pageText(doc, i), Bt = await PC.pageText(nref.doc, nref.q);
      if (At.chars.length && Bt.chars.length) { const c0 = nref.crop ? [nref.crop[0], nref.crop[1]] : [0, 0]; tx = textDiffCore(At, Bt, [1, 0, c0[0], c0[1], 1], c0, ot, nt, merged, nref.crop, { annot: true }) || null; }
    }
    merged.push(...layoutChanges(ot, ol, nt, nl, pairs));
    const im = PC.imageChanges(old, nw, ob, nb); im.forEach(imageShow);
    //   注釈を消した原稿の描画と成果物の描画がまったく同じ所の、字形・図版の変化は出さない(同じ大きさのときだけ)
    const pd = PC.pixelDiff(old, nw);
    dropUnchanged(pd, merged, im);
    explainImages(pd, old, nw, merged, im, [...pairs.map(([k, l]) => [ot[k] && ot[k].box, nt[l] && nt[l].box]), ...(tx ? tx.moved : [])]);   // 画像の変化は、字の変化・字の移動で説明できない描画の違いだけ
    step('赤字を読み取り', 0.7); await PC.tick();
    const notes0 = await PC.annotations(doc, i), withA = await PC.renderPage(doc, i, PC.DPI, true);
    const { rm, shown } = PC.fromAnnots(withA, old, notes0);
    //   返信(In Reply To)は、返信先のコメントにつなげる(やり取りを1つの指示として読む)
    const byId = new Map(notes0.filter(n => n.id).map(n => [n.id, n]));
    for (const n of notes0) if (n.irt && byId.has(n.irt)) { let r = byId.get(n.irt); for (let k = 0; k < 20 && r.irt && byId.has(r.irt); k++) r = byId.get(r.irt); (r.replies = r.replies || []).push(n.text); n.isReply = true; }
    const notes = notes0.filter(n => !n.isReply).map(n => n.replies ? { ...n, text: [n.text, ...n.replies.map(t => '（返信）' + t)].join('\n'), thread: true } : n);
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
      const box = union(n.quads).map(Math.trunc), quads = n.quads.map(q => q.map(Math.trunc));
      //   マーカーの下の字(文字データ。字形のまとまりが大きいデザインでも正しく分かるように)
      const under = oc.filter(([, b]) => { const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2; return n.quads.some(q => cx >= q[0] && cx <= q[2] && cy >= q[1] && cy <= q[3]); }).map(c => c[0]).join('');
      const base = { how: MK[n.type], box, quads, under, stroke: -1, note: n.text, thread: !!n.thread };
      if (toks.size) an.push({ kind: 'tokens', toks, ...base });
      else if (ob.some(b => b.kind === 'image' && ov(b.box, box))) an.push({ kind: 'image', ...base });
      //   どの字形・画像にも当たらない(字形のまとまりが大きいときの一部だけ・字のない所に引いたものなど)ものも捨てず、位置で照合する
      else an.push({ kind: 'area', ...base });
    }
    //   テキストボックスの注釈(全体指示でないもの): 打ち込んだ文字を、同じ行の近く(横に 120画素＝約15mm 以内)の、まだコメントのない指示に添える
    //   (取り消し線の横に直す文字を打ち込んだもの)。なければ、その枠を指示の所とする(描画は赤字の印として読んでいない: PC.typedNote)
    for (const n of notes) {
      if (!PC.typedNote(n)) continue;
      const vo = a => Math.min(a.box[3], n.box[3]) - Math.max(a.box[1], n.box[1]), gx = a => Math.max(0, a.box[0] - n.box[2], n.box[0] - a.box[2]);
      const near = an.filter(a => a.note === undefined && vo(a) >= 0.5 * Math.min(a.box[3] - a.box[1], n.box[3] - n.box[1]) && gx(a) <= 120).sort((x, y) => gx(x) - gx(y))[0];
      if (near) near.note = n.text;
      else an.push({ kind: 'area', how: 'テキスト(注釈)', box: n.box.map(Math.trunc), quads: [n.box.map(Math.trunc)], under: '', stroke: -1, note: n.text });
    }
    //   付箋(テキストの注釈)のコメントも指示として読む(返信はつなげてある)。同じ所にほかの指示があれば、そちらに任せる
    for (const n of notes) {
      if (n.type !== 'Text' || !String(n.text || '').trim() || an.some(a => ov(a.box, n.box, 4))) continue;
      an.push({ kind: 'area', how: '付箋(注釈)', box: n.box.map(Math.trunc), quads: [n.box.map(Math.trunc)], under: '', stroke: -1, note: n.text, thread: !!n.thread });
    }
    for (const a of an) if (a.note === undefined) a.note = (notes.find(n => n.type !== 'Caret' && ov(n.box, a.box, 8)) || {}).text || (notes.find(n => n.type === 'Caret' && ov(n.box, a.box, 2)) || {}).text || '';
    //   マーカーの注釈を描いたときの色の付いた縁など(注釈そのものの描画)から読んだ赤の印は、マーカーの注釈が受け持つので外す(同じ指示を二重に数えないように)
    const marks = notes.filter(n => PC.MARKUP.has(n.type) && n.quads && n.quads.length);
    for (let k = an.length - 1; k >= 0; k--) { const a = an[k]; if (a.stroke >= 0 && marks.some(n => n.text === a.note && a.box[0] >= n.box[0] - 12 && a.box[1] >= n.box[1] - 12 && a.box[2] <= n.box[2] + 12 && a.box[3] <= n.box[3] + 12)) an.splice(k, 1); }
    //   文字のない字形の変化(図・模様など)で、原稿側の位置(読み順で決めた入る位置)が成果物側と大きく離れるものは、同じレイアウトなので成果物側と同じ所とする
    for (const c of merged) if (c.kind === 'text' && c.tag !== 'layout' && !c.before && !c.after && c.obox && c.nbox && PC.gap(c.obox, c.nbox) > 30 * PC.S) c.obox = c.nbox.slice();
    for (const c of merged) if (c.obox && c.nbox) c.sty = { o: styleOf(old, c.obox), n: styleOf(nw, c.nbox) };   // 書式の指示の確認用
    //   指示の所(まわり 3pt)の描画が、原稿と成果物でまったく同じ指示に印を付ける(still。その所は変わっていない)。あとで、文字データの裏づけのない変化
    //   (ページ全体が1つの図とみなされた変化・大きな字形のまとまりの変化など、違う画素がほかの所にあるもの)を、その指示の「直った」に数えない。
    //   指示の範囲の中がまったく同じ(stillIn)なら、画像・図版の変化は、その指示の「直った」に数えない(となりの字が動いただけの所など)
    if (pd) for (const a of an) { const qs = a.quads && a.quads.length ? a.quads : [a.box]; a.still = !qs.some(q => pd.has(q, 3 * PC.S + 2)); a.stillIn = !qs.some(q => pd.has(q, 1)); }
    //   base: 注釈を消した原稿の描画(パタパタ表示で成果物と交互に出す。赤字の印がちらつかないように)
    return { kind: 'annot', ot, ol, nt, nl, ch: merged, im, an, notes, pairs: [...pairs, ...lookPairs], oc, nc, tx, restBoxes: restBoxesOf(rm, used, old.w, old.h), left: shown, right: nw, base: old, w: old.w };
  }

  // 数字のまとまり(桁区切り・小数点・時刻・日付の区切り)の中の違いを1件にまとめる(字形で比べるページ)
  //   同じ行で、間の字が数字と区切りだけ(6字まで)、両方の違いに数字があるもの(「4,730」→「5,060」を「4→5」「730→060」の2件にしない)
  function mergeNumbers(ch, ot, oc, nt, nc) {
    const lab = (cs, T, a, b) => { let s = ''; for (let k = Math.max(0, a); k < Math.min(T.length, b); k++) s += tokText(cs, T[k].box); return s; };
    const num = s => [...s].every(c => PC.NUMC.test(c)), dig = s => PC.DIGC.test(s);
    const out = [];
    for (const c of ch.slice().sort((p, q) => p.oi[0] - q.oi[0] || p.nj[0] - q.nj[0])) {
      const q = out[out.length - 1];
      if (q && c.oi[0] >= q.oi[1] && c.nj[0] >= q.nj[1] && c.oi[0] - q.oi[1] <= 6 && c.nj[0] - q.nj[1] <= 6 && q.oi[1] > 0 && ot[c.oi[0]] && ot[q.oi[1] - 1] && ot[c.oi[0]].line === ot[q.oi[1] - 1].line) {
        const mo = lab(oc, ot, q.oi[1], c.oi[0]), mn = lab(nc, nt, q.nj[1], c.nj[0]);
        if (num(mo) && num(mn) && dig(lab(oc, ot, ...q.oi) + lab(nc, nt, ...q.nj)) && dig(lab(oc, ot, ...c.oi) + lab(nc, nt, ...c.nj))) {
          q.oi = [q.oi[0], c.oi[1]]; q.nj = [q.nj[0], c.nj[1]]; q.tag = 'replace'; q.pj = null;
          const ob = [q.obox, c.obox].filter(Boolean), nb = [q.nbox, c.nbox].filter(Boolean);
          q.obox = ob.length ? union(ob) : undefined; q.nbox = nb.length ? union(nb) : undefined;
          continue;
        }
      }
      out.push(c);
    }
    ch.splice(0, ch.length, ...out);
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
  // デジタルどうし(スキャンでないPDFの原稿と成果物)で、描画がまったく同じ所の変化を外す。
  //   exact: 原稿と成果物の描画の違い(PC.pixelDiff。使えないときは null)。ch: 字の変化、im: 画像・図版の変化(どちらも書き換える)
  //   原稿側の枠にも成果物側の枠にも(まわりを含めて)違う画素がない変化は、字形の切り分け・比べ方の揺れによるもの(同じ内容は同じ画素に描かれる)。
  //   文字データの比べ合わせから出た違い・文字データの違いにつながった変化(見た目が同じで文字データだけが違う字を含む)は、文字データが証拠なので残す
  //   (文字データの違いの枠は、消えた所の細い印など、変わった字の形そのものに重ならないことがある)
  function dropUnchanged(exact, ch, im) {
    if (!exact) return;
    const near = b => b && exact.has(b, Math.max(4, Math.min(16, 0.5 * (b[3] - b[1]))));   // まわり: 枠の高さの半分(4〜16画素)
    const still = c => !near(c.obox) && !near(c.nbox);
    for (let k = ch.length - 1; k >= 0; k--) if (!ch[k].fromText && !ch[k].txt && still(ch[k])) ch.splice(k, 1);
    for (let k = im.length - 1; k >= 0; k--) if (still(im[k])) im.splice(k, 1);
  }
  // 画像・図版の変化を、字の変化で説明できない描画の違いだけにする(全数の消し込み: 違う画素は、字の変化か画像の変化のどちらか一方で説明する)
  //   exact: 原稿と成果物の描画の違い(同じ大きさ・ずれなしのときだけ。なければ何もしない)。A・B: 原稿・成果物の描画、ch: 字の変化、im: 画像・図版の変化(書き換える)
  //   moved: 同じ形・同じ字と対応づいた字形・字の [原稿の枠, 成果物の枠](位置が動いた字は、前と後ろの両方の所の違いを説明する。同じ行の前で字を消すと、後ろの字が詰まる)
  //   字の変化の枠(まわり: 枠の高さの半分、4〜16画素)と、動いた字の枠(まわり: 枠の高さの3割、3〜10画素。文字データの字の枠は推定なので、描いた字の縁がはみ出す)の中の違いを除き、画像の変化の範囲に残った違い(色の差 40 超・3x3 で開いた所)だけを見る。
  //   残らなければ外し、残れば、その範囲に縮める(画像の所がページ全体の名刺などで、字を直しただけでページ全体が「画像が変わった」になり、
  //   直していない注釈にも結びついて「直っていない」を隠していたため)。位置が動いた画像・消えた画像は、残った違いがなければ外すだけ
  function explainImages(exact, A, B, ch, im, moved = []) {
    if (!exact || !im.length || A.w !== B.w || A.h !== B.h) return;
    const w = A.w, h = A.h, cover = new Uint8Array(w * h);
    const fill = (b, m) => { const x0 = Math.max(0, Math.floor(b[0] - m)), y0 = Math.max(0, Math.floor(b[1] - m)), x1 = Math.min(w, Math.ceil(b[2] + m)), y1 = Math.min(h, Math.ceil(b[3] + m)); for (let y = y0; y < y1; y++) cover.fill(1, y * w + x0, y * w + x1); };
    for (const c of ch) for (const b of [c.obox, c.nbox]) if (b) fill(b, Math.max(4, Math.min(16, 0.5 * (b[3] - b[1]))));
    for (const [o, n] of moved) if (o && n && (Math.abs(o[0] - n[0]) > 1 || Math.abs(o[1] - n[1]) > 1)) { const m = Math.max(3, Math.min(10, 0.3 * (n[3] - n[1]))); fill(o, m); fill(n, m); }
    for (let k = im.length - 1; k >= 0; k--) {
      const c = im[k], u0 = PC.union([c.obox, c.nbox].filter(Boolean));
      const u = [Math.max(0, Math.floor(u0[0])), Math.max(0, Math.floor(u0[1])), Math.min(w, Math.ceil(u0[2])), Math.min(h, Math.ceil(u0[3]))], uw = u[2] - u[0], uh = u[3] - u[1];
      if (uw <= 0 || uh <= 0) continue;
      const dm = new Uint8Array(uw * uh), a = A.d, b = B.d;
      for (let y = 0; y < uh; y++) for (let x = 0; x < uw; x++) {
        const j = (u[1] + y) * w + u[0] + x; if (cover[j]) continue;
        const g = 4 * j; if (Math.max(Math.abs(a[g] - b[g]), Math.abs(a[g + 1] - b[g + 1]), Math.abs(a[g + 2] - b[g + 2])) > 40) dm[y * uw + x] = 1;
      }
      const op = PC.morph(dm, uw, uh, 'open', 3, 3); let ax0 = 1e9, ay0 = 1e9, ax1 = -1, ay1 = -1;
      for (let y = 0; y < uh; y++) for (let x = 0; x < uw; x++) if (op[y * uw + x]) { if (x < ax0) ax0 = x; if (x > ax1) ax1 = x; if (y < ay0) ay0 = y; if (y > ay1) ay1 = y; }
      if (ax1 < 0) { im.splice(k, 1); continue; }
      if (c.kind === 'changed') c.obox = c.nbox = [u[0] + ax0, u[1] + ay0, u[0] + ax1, u[1] + ay1];   // 端の取り方は PC.imageChanges と同じ
    }
  }
  // 紙の赤字原稿(スキャン)のページ: スキャンを修正後に重ねて字形を比べる。修正前の文字は、修正後の文字から推定する
  // スキャンでないPDFの原稿(同じレイアウト): 字の形に加えて、原稿と成果物の文字データどうしも比べ、字の形の違いとして出ていない違いを足す
  //   (形がほぼ同じ字: 全角・半角のかっこ・英字、「ー」と「一」、小さい字の句読点など)。比べ方は旧版との比べ合わせと同じ(PC.collatePage・厳しめ)
  //   A, s: 原稿の描画 → 成果物の描画(nw)の重ね合わせ。nref: { doc, q, crop } 成果物のページ。ch(字の形の変化)を書き換える:
  //   字の形の変化1つと文字データの違い1つだけが重なるときは、違う字の表示と位置を文字データのものにする(行をまたいで字の順番が乱れた表示を正す)。
  //   それ以外の重なり方は、重なった字の形の変化を文字データの違いに置き換える。どの字の形の変化にも重ならない違いは、字の形では見えにくいものだけを足す。
  //   原稿に赤で書き込んだ字(ページの中身として書いた指示)は比べない
  async function textDiffChanges(src, p, A, s, sp, ch, nref) {
    const { doc, i } = src.page(p), At0 = await PC.pageText(doc, i), Bt = await PC.pageText(nref.doc, nref.q), K = PC.S;
    if (!At0.chars.length || !Bt.chars.length) return;
    const c0 = nref.crop ? [nref.crop[0], nref.crop[1]] : [0, 0];
    //   原稿の pt → 成果物の pt(重ね合わせの変換を pt に直したもの。T = [a, b, tx, ty, ay])
    const T = [A[0] * s, (A[3] - A[1]) * s / 2, A[2] / K + c0[0], A[5] / K + c0[1], A[4] * s];
    const px = b => [(b[0] - c0[0]) * K, (b[1] - c0[1]) * K, (b[2] - c0[0]) * K, (b[3] - c0[1]) * K];
    //   赤で書き込んだ字(注釈でなく、ページの中身として書いた指示)は比べない(成果物にない字として出さない・指示の照合を乱さない)。
    //   赤い字: 字の所に赤ペンの赤(成果物の同じ所に印刷されている赤を除いたもの)があり、黒い画素がほとんどなく、成果物の同じ所に赤い印刷がない字。
    //   字のまとまり(PDFの文字列)の7割以上が赤い字なら、そのまとまりの字をすべて外す(赤い取り消し線が通る黒い「,」などを外さないように)
    const W = sp.W, nred = PC.redMask(sp.N);
    const redChar = c => {
      const b = px(PC.mapBox(T, c.box)), x0 = Math.max(0, Math.floor(b[0])), y0 = Math.max(0, Math.floor(b[1])), x1 = Math.min(W.w, Math.ceil(b[2])), y1 = Math.min(W.h, Math.ceil(b[3]));
      let black = 0, red = 0, nr = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const q = y * W.w + x, j = 4 * q;
        if (Math.max(W.d[j], W.d[j + 1], W.d[j + 2]) < 110) black++;
        if (sp.core[q]) red++;
        if (nred[q]) nr++;
      }
      return red >= 4 && black <= 0.1 * red && nr < 0.05 * Math.max(1, (x1 - x0) * (y1 - y0));
    };
    const redIt = new Map();
    for (const c of At0.chars) { const v = redIt.get(c.it) || [0, 0]; v[0]++; if (redChar(c)) v[1]++; redIt.set(c.it, v); }
    const At = { ...At0, chars: At0.chars.filter(c => { const v = redIt.get(c.it); return v[1] < 0.7 * v[0]; }) };
    if (!At.chars.length) return;
    return textDiffCore(At, Bt, T, c0, sp.ot, sp.nt, ch, nref.crop, {});
  }
  //   文字データの違いを求め、字の形の変化(ch)とつなぐ。At・Bt: 原稿・成果物の文字データ(pt)、T: 原稿の pt → 成果物の pt、c0: 成果物の切り出しの左上(pt)、
  //   ot・nt: 原稿・成果物の字形。opt.annot: 注釈PDFのページ(原稿も成果物もPDF)。違いの原稿側の枠も文字データのものにし、
  //   文字データに違いのない所の字形の変化に印(textSame)を付ける(字形のまとまり方が変わっただけのもの。あとで、指示に当たらなければ参考にする)
  //   返り値: 原稿の字ごとの照合の結果(状態 'm' 対応あり・'d' 消えた)と、使った文字データ(指示の自動確認に使う)。使えないページは undefined
  function textDiffCore(At, Bt, T, c0, ot, nt, ch, crop, opt) {
    const K = PC.S, px = b => [(b[0] - c0[0]) * K, (b[1] - c0[1]) * K, (b[2] - c0[0]) * K, (b[3] - c0[1]) * K];
    const region = crop ? crop.slice() : [0, 0, Bt.w, Bt.h];
    const usedT = new Uint8Array(Bt.chars.length), blocks = PC.collatePage(At, Bt, { T, Tt: null, region, src: [0, 0, At.w, At.h], strict: true, noInstr: true, free: false }, usedT, new Set());
    //   同じレイアウトなので、字の並びで対応づけたあとに、同じ位置の同じ字で対応づけを直す(posFirst。同じ字の並びがページに2回ある所の取り違え)
    posFirst(At, Bt, blocks, T, usedT, new Uint8Array(Bt.chars.length), true);
    //   PDFの中の文字列の順番が原稿と成果物で違うと(書き直した文字列だけがページの最後に書かれたPDFなど)、同じ所にある同じ字を
    //   「消えた」「入った」とすることがある。同じレイアウトなので、消えたとした原稿の字は、写した位置に、どこにも当たっていない成果物の同じ字があれば同じとする
    const Bc = Bt.chars, usedB = new Uint8Array(Bc.length), freeB = new Map(), took = new Uint8Array(Bc.length);
    for (const b of blocks) for (const o of b.ops) if (o.length === 3) usedB[o[2]] = 1;
    for (let j = 0; j < Bc.length; j++) if (!usedB[j]) { if (!freeB.has(Bc[j].k)) freeB.set(Bc[j].k, []); freeB.get(Bc[j].k).push(j); }
    const inPlace = (a, b) => { const iw = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), ih = Math.min(a[3], b[3]) - Math.max(a[1], b[1]); return iw > 0 && ih > 0 && iw * ih >= 0.5 * Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1])); };
    for (const b of blocks) {
      const cs = At.chars.slice(b.s, b.e);
      b.ops = b.ops.map(o => {
        if (o[0] !== '-') return o;
        const c = cs[o[1]], mb = PC.mapBox(T, c.box), j = (freeB.get(c.k) || []).find(j => !took[j] && inPlace(mb, Bc[j].box));
        if (j === undefined) return o;
        took[j] = 1; return ['=', o[1], j];
      });
    }
    for (const b of blocks) b.ops = b.ops.filter(o => !(o[0] === '+' && took[o[1]]));
    if (window.__pcDebug) (PC._tx = PC._tx || []).push({ At, Bt, T, before: blocks.map(b => ({ s: b.s, e: b.e, ops: b.ops.slice() })) });   // 調べるとき(作業用)の記録
    //   文字データが合わないページ(文字化け・アウトライン化など)では使わない: 原稿の字の8割以上が成果物の字と同じであること
    //   (注釈PDFのページは6割以上。同じデザインのファイルから書き出した原稿と成果物なので文字データはそろいやすく、
    //    小さいページで行や文をまとめて消す指示があっても使えるように)
    let eq = 0; for (const b of blocks) for (const o of b.ops) if (o[0] === '=' || o[0] === '~') eq++;
    if (eq < (opt.annot ? 0.6 : 0.8) * At.chars.length) return;
    const ovl = (a, b, m) => a && b && a[0] - m < b[2] && b[0] - m < a[2] && a[1] - m < b[3] && b[1] - m < a[3];
    const tokRange = (ts, box) => {   // 枠に重なる字形の番号の範囲。重なる字形がなければ、いちばん近い字形の前(幅0)
      let lo = -1, hi = -1;
      ts.forEach((t, k) => { if (ovl(t.box, box, 1)) { if (lo < 0) lo = k; hi = k; } });
      if (lo >= 0) return [lo, hi + 1];
      let best = 0, bd = Infinity; ts.forEach((t, k) => { const d = PC.gap(t.box, box); if (d < bd) { bd = d; best = k; } });
      return [best, best];
    };
    //   成果物の字のうち、どの原稿の字にも当たらず、違いにも入っていない字(まとまりの端に入った字・まとまりごと置き換わった所の新しい字など):
    //   ①原稿の字に当たった成果物の字のすぐ隣(同じ行で続く字)にあるものは、その字の前・後ろに入った字とする
    //     (「12,800円」→「512,800円」の「5」。同じ数字の中のほかの違いと1つにまとまる)
    //   ②写した位置が「消えた」違いに重なるものは、置き換わった字として加える(「品名」→「快日」を「品名」が消えただけとしない。下の違いのまとまりで)
    //   ③どちらでもないものは、字の形の比べ方に任せる(見えない字・仕上がりの外の字などを出さないように)
    const inPlus = new Uint8Array(Bc.length);
    for (const b of blocks) for (const o of b.ops) if (o[0] === '+') inPlus[o[1]] = 1;
    const isFree = j => j >= 0 && j < Bc.length && !usedB[j] && !took[j] && !inPlus[j];
    const adj = (p, q) => { const s = Math.max(p.box[3] - p.box[1], q.box[3] - q.box[1], 1), oy = Math.min(p.box[3], q.box[3]) - Math.max(p.box[1], q.box[1]), ox = Math.min(p.box[2], q.box[2]) - Math.max(p.box[0], q.box[0]); return PC.gap(p.box, q.box) <= 1.2 * s && (oy >= 0.5 * s || ox >= 0.5 * s); };
    const bref = new Map();   // 成果物の字の番号 → [まとまり, ops の番号]
    blocks.forEach((b, bi) => b.ops.forEach((o, q) => { if (o.length === 3) bref.set(o[2], [bi, q]); else if (o[0] === '+') bref.set(o[1], [bi, q]); }));
    const ins = [];
    for (let j = 0; j < Bc.length; j++) {
      if (!isFree(j)) continue;
      let hi = j; while (isFree(hi + 1) && adj(Bc[hi], Bc[hi + 1])) hi++;
      const lo = j, L = bref.get(lo - 1), R = bref.get(hi + 1), js = [];
      j = hi;
      for (let q = lo; q <= hi; q++) js.push(q);
      if (L && adj(Bc[lo - 1], Bc[lo])) ins.push({ bi: L[0], at: L[1] + 1, js });
      else if (R && adj(Bc[hi], Bc[hi + 1])) ins.push({ bi: R[0], at: R[1], js });
    }
    ins.sort((x, y) => y.at - x.at).forEach(x => { blocks[x.bi].ops.splice(x.at, 0, ...x.js.map(j => ['+', j])); x.js.forEach(j => { inPlus[j] = 1; }); });
    const within = (b, ob) => { const iw = Math.min(b[2], ob[2]) - Math.max(b[0], ob[0]), ih = Math.min(b[3], ob[3]) - Math.max(b[1], ob[1]); return iw > 0 && ih > 0 && iw * ih >= 0.5 * (b[2] - b[0]) * (b[3] - b[1]); };
    //   消えただけの所の印: 前後の成果物の字の境目のうち、写した原稿の字の位置に近いほう(行の頭の字が消えたときに、前の行の終わりに印を付けない)
    const caretNear = (ops, hk, ob) => {
      const nb = dir => { for (let q = dir < 0 ? hk.s - 1 : hk.e; q >= 0 && q < ops.length; q += dir) { const o = ops[q]; if (o[0] === '|') return null; if (o[0] !== '-') return Bc[o[0] === '+' ? o[1] : o[2]].box; } return null; };
      const p = nb(-1), n = nb(1), cands = [p && px([p[2] - 1, p[1], p[2] + 1, p[3]]), n && px([n[0] - 1, n[1], n[0] + 1, n[3]])].filter(Boolean);
      return cands.length ? cands.reduce((a, b) => (PC.gap(a, ob) <= PC.gap(b, ob) ? a : b)) : null;
    };
    //   違いのまとまりは、内容で照合するページと同じ分け方(PC.hunksOf: 数字のまとまりの中の違いは1つ。前後の同じ字を添えて示す)。
    //   ただし、間の同じ字のところで行(縦組みは列)が変わるときは分ける(行の終わりと次の行の頭の違いを、2行にわたる1つの枠にしない)
    const brk = (a, b) => { const oy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]), ox = Math.min(a[2], b[2]) - Math.max(a[0], b[0]); return oy < 0.5 * Math.min(a[3] - a[1], b[3] - b[1]) && ox < 0.5 * Math.min(a[2] - a[0], b[2] - b[0]); };
    const lineSplit = (ops, hk, cs) => {
      const bOf = o => (o[0] === '-' ? null : Bc[o[0] === '+' ? o[1] : o[2]].box), aOf = o => (o[0] === '+' ? null : cs[o[1]].box);
      const cut = (o1, o2) => { const b1 = bOf(o1), b2 = bOf(o2); if (b1 && b2) return brk(b1, b2); const a1 = aOf(o1), a2 = aOf(o2); return !!(a1 && a2) && brk(a1, a2); };
      const parts = []; let st = hk.s;
      for (let q = hk.s + 1; q < hk.e - 1; q++) if (ops[q][0] === '=' && (cut(ops[q - 1], ops[q]) || cut(ops[q], ops[q + 1]))) { parts.push([st, q]); st = q + 1; }
      parts.push([st, hk.e]);
      return parts.map(([s, e]) => { while (s < e && ops[s][0] === '=') s++; while (e > s && ops[e - 1][0] === '=') e--; return { s, e, variant: ops.slice(s, e).every(o => o[0] === '~' || o[0] === '=') }; }).filter(x => x.e > x.s);
    };
    const out = [];
    for (const b of blocks) {
      const ops = b.ops, cs = At.chars.slice(b.s, b.e);
      for (const hk of PC.hunksOf(ops, cs, Bc).flatMap(h => lineSplit(ops, h, cs))) {
        const r = hunkView(ops, hk, cs, Bc), run = ops.slice(hk.s, hk.e).filter(o => o[0] !== '=');
        let before = run.filter(o => o[0] !== '+').map(o => cs[o[1]].c).join(''), after = run.filter(o => o[0] !== '-').map(o => Bc[o.length === 3 ? o[2] : o[1]].c).join(''), segs = r.segs;
        if (!before && !after) continue;
        const obox = r.box ? px(PC.mapBox(T, r.box)) : null;
        let nbox = r.nbox ? px(r.nbox) : obox;
        if (before && !after && obox) {
          const fr = []; for (let j = 0; j < Bc.length; j++) if (isFree(j) && within(px(Bc[j].box), obox)) fr.push(j);
          if (fr.length) {
            let lo = Math.min(...fr), hi = Math.max(...fr);
            while (isFree(lo - 1) && adj(Bc[lo - 1], Bc[lo])) lo--;
            while (isFree(hi + 1) && adj(Bc[hi], Bc[hi + 1])) hi++;
            const js = []; for (let j = lo; j <= hi; j++) if (isFree(j)) js.push(j);
            js.forEach(j => { took[j] = 1; });
            after = js.map(j => Bc[j].c).join(''); nbox = px(PC.union(js.map(j => Bc[j].box)));
            const k = segs.map(g => g[0]).lastIndexOf('-'); segs = [...segs.slice(0, k + 1), ['+', after], ...segs.slice(k + 1)];
          } else nbox = caretNear(ops, hk, obox) || nbox;
        }
        const ob = obox || nbox;
        if (!ob) continue;
        out.push({ kind: 'text', tag: before && after ? 'replace' : before ? 'delete' : 'insert', oi: tokRange(ot, ob), nj: tokRange(nt, nbox), obox: ob, nbox, before, after, show: after || before,
          variant: hk.variant, why: '文字データの比べ合わせ', diff: { segs, same: false, ob: [ob], nb: [nbox] }, h: Math.max(4, Math.min(ob[3] - ob[1], ob[2] - ob[0])),
          sub: run.every(o => o[0] === 'x' || o[0] === '~') });
      }
    }
    //   注釈PDFのページ: どの原稿の字にもつながらない成果物の字の並び(まるごと入った行など)も、入った字の候補にする。
    //   見えない字・仕上がりの外の字を出さないように、字形の変化と重なるもの(下の linked)だけを使う
    if (opt.annot) {
      for (let j = 0; j < Bc.length; j++) {
        if (!isFree(j)) continue;
        let hi = j; while (isFree(hi + 1) && adj(Bc[hi], Bc[hi + 1])) hi++;
        const js = []; for (let q = j; q <= hi; q++) js.push(q);
        j = hi;
        const after = js.map(q => Bc[q].c).join(''), nb = px(PC.union(js.map(q => Bc[q].box)));
        if (!after.trim()) continue;
        out.push({ kind: 'text', tag: 'insert', oi: tokRange(ot, nb), nj: tokRange(nt, nb), obox: nb, nbox: nb, before: '', after, show: after, why: '文字データの比べ合わせ', diff: { segs: [['+', after]], same: false, ob: [nb], nb: [nb] }, h: Math.max(4, Math.min(nb[3] - nb[1], nb[2] - nb[0])), sub: false, freeRun: true });
      }
    }
    //   違いが多すぎるページ(文字データの並びが原稿と成果物で大きく違うもの)は、字の形の比べ方に任せる
    if (out.length > 40) return;
    //   原稿の字ごとの照合の結果(注釈PDFのページの指示の自動確認用)
    const stat = new Map();
    for (const b of blocks) for (const o of b.ops) { if (o.length === 3) stat.set(b.s + o[1], 'm'); else if (o[0] === '-') stat.set(b.s + o[1], 'd'); }
    //   字の形の変化と文字データの違いを、位置の重なりでつなぐ。字の形の変化1つと違い1つだけがつながるときは、その変化の表示を違いのものにする。
    //   それ以外(1つの変化に違いが2つ以上、1つの違いに変化が2つ以上)は、つながった変化を違いに置き換える。
    //   見た目だけの変化(字の形が同じで色などが違う)は、そのまま残す
    const G = ch.filter(c => c.kind === 'text' && c.tag !== 'layout' && !c.hw && !c.look);
    const hitsOf = new Map(G.map(c => [c, out.filter(r => ovl(c.nbox, r.nbox, 0.5 * r.h) || ovl(c.obox, r.obox, 0.5 * r.h))]));
    const used = new Set(), drop = new Set();
    for (const c of G) {
      const hits = hitsOf.get(c);
      if (!hits.length) continue;
      if (hits.length === 1 && G.filter(x => hitsOf.get(x).includes(hits[0])).length === 1) {
        const r = hits[0]; used.add(r);
        Object.assign(c, { before: r.before, after: r.after, show: r.show, nbox: r.nbox, diff: r.diff, why: c.why || r.why, txt: true });   // txt: 文字データの違いにつながった変化
        //   注釈PDFのページ: 字形の変化が文字データの違いを大きく含むとき(字形のまとまりが表ごと・枠ごとになったもの)だけ、原稿側の枠も文字データのものにする
        //   (表の中で文字データの並びが違い、別の行の字に対応づいたときに、正しい字形の枠を動かさないように)
        const area_ = b => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]), within_ = (b, o) => b[0] >= o[0] - 2 && b[1] >= o[1] - 2 && b[2] <= o[2] + 2 && b[3] <= o[3] + 2;
        if (opt.annot) { c.fromText = true; if (c.obox && r.obox && within_(r.obox, c.obox) && area_(c.obox) > 3 * Math.max(1, area_(r.obox))) Object.assign(c, { obox: r.obox, oi: r.oi, nj: r.nj, tag: r.tag }); }
        if (r.variant) c.variant = true;
        continue;
      }
      drop.add(c);
    }
    for (let k = ch.length - 1; k >= 0; k--) if (drop.has(ch[k])) ch.splice(k, 1);
    //   どの字の形の変化にも重ならない違いは、字の形では見えにくいものだけを足す: 違う字が2字まで、同じ数の字の置き換え(全角・半角・形の似た字)、
    //   字形が見つからない所(色地の上の字など)。長い文が消えた・入ったのなら字の形の変化として必ず見えるため、それに重ならない長い違いは、
    //   文字データの並べ方の誤り(似た文の取り違え・1字ずつの縦組みの列の送りなど)とみなす
    const linked = new Set([...hitsOf.values()].flat());
    const blind = r => !nt.some(t => ovl(t.box, r.nbox, 0)) && !ot.some(t => ovl(t.box, r.obox, 0));
    const subtle = r => Math.max([...r.before].length, [...r.after].length) <= 2 || r.sub || blind(r);
    //   注釈PDFのページで、字形の変化につながらない小さな違いは、見た目が同じで文字データが違う字(「ー」と「一」など)とする
    for (const r of out) if (!used.has(r) && (linked.has(r) || (subtle(r) && !r.freeRun))) {
      //   字形の変化につながらない、同じ字数の置き換え(字形のある所)は、見た目が同じで文字データが違う字(「ー」と「一」など)とする
      if (opt.annot && !linked.has(r) && r.before && r.after && [...r.before].length === [...r.after].length && !blind(r)) r.lookAlike = true;
      delete r.h; delete r.sub; r.fromText = true; ch.push(r);
    }
    //   注釈PDFのページ: 文字データの違いにつながらない字形の変化のうち、その所に文字データがある(原稿か成果物に字がある)ものは、
    //   字形のまとまり方・位置が変わっただけとみなして印を付ける(字のない所の変化=図・線などは、そのまま)
    if (opt.annot) {
      const eqOld = new Set(), eqNew = new Set();
      for (const b of blocks) for (const o of b.ops) if (o[0] === '=') { eqOld.add(b.s + o[1]); eqNew.add(o[2]); }
      const oPx = At.chars.map(c => px(PC.mapBox(T, c.box))), nPx = Bt.chars.map(c => px(c.box));
      const inside = (bs, b) => (b ? bs.map((x, i) => i).filter(i => { const x = bs[i], cx = (x[0] + x[2]) / 2, cy = (x[1] + x[3]) / 2; return cx >= b[0] && cx <= b[2] && cy >= b[1] && cy <= b[3]; }) : []);
      for (const c of ch) {
        if (c.kind !== 'text' || c.tag === 'layout' || c.hw || c.look || c.fromText || hitsOf.get(c)?.length) continue;
        const oi = inside(oPx, c.obox), nj = inside(nPx, c.nbox);
        if ((oi.length || nj.length) && oi.every(i => eqOld.has(i)) && nj.every(j => eqNew.has(j))) c.textSame = true;
      }
    }
    //   moved: 文字データで同じ字と対応づいた字のうち、位置が動いた字の [原稿の枠, 成果物の枠](成果物の描画の画素。画像の変化の説明に使う: explainImages)
    const moved = [];
    for (const b of blocks) for (const o of b.ops) {
      if (o[0] !== '=' && o[0] !== '~') continue;
      const ob = px(PC.mapBox(T, At.chars[b.s + o[1]].box)), nb = px(Bc[o[2]].box);
      if (Math.abs(ob[0] - nb[0]) > 1 || Math.abs(ob[1] - nb[1]) > 1) moved.push([ob, nb]);
    }
    return { stat, At, Bt, T, c0, moved };
  }
  async function scanPage(src, p, nw, nc, step, nref = null, same = false) {
    step('スキャンを読み込み', 0.02); await PC.tick();
    const { img, dpi, digital } = await src.image(p, same);
    step('位置を合わせています', 0.05); await PC.tick();
    let { W, matched, A, s } = PC.registerScan(img, nw, dpi);
    //   スキャンでないPDFの原稿が、成果物と同じ大きさで、ずれなく重なるとき: 原稿の描画をそのまま使い(重ね直しの補間をしない)、
    //   原稿と成果物の描画の違い(PC.pixelDiff)を確かな証拠として使う。描画がまったく同じ所には、変化も赤字の書き込みもない
    //   (同じPDFどうし・変わっていない所で、字形の切り分けや赤の取り出しの揺れを項目にしないため)
    let exact = null;
    if (digital && img.w === nw.w && img.h === nw.h) {
      const still = Math.abs(A[0] - 1) < 2e-3 && Math.abs(A[4] - 1) < 2e-3 && Math.abs(A[1]) < 2e-3 && Math.abs(A[3]) < 2e-3 && Math.abs(A[2]) < 1 && Math.abs(A[5]) < 1;
      const pd = PC.pixelDiff(img, nw);
      if (pd && (still || pd.count <= 0.02 * img.w * img.h)) { exact = pd; W = img; A = [1, 0, 0, 0, 1, 0]; }
    }
    const sp = await new PC.ScanPage(W, nw, { digital: !!digital, exact }).init((s, f) => step(s, 0.08 + 0.77 * f));
    //   スキャンでないPDFの原稿: 原稿の文字データの字(位置は重ね合わせと同じに移す)。字の位置は、全角・半角の幅を考えて割り振り、
    //   描画した字の形に合わせる(PC.textCharsSnapped。原稿は PC.DPI で描いてある)
    let own = null;
    if (digital) {
      const { doc, i } = src.page(p), mp = (x, y) => [A[0] * x * s + A[1] * y * s + A[2], A[3] * x * s + A[4] * y * s + A[5]];
      own = (await PC.textCharsSnapped(doc, i, img)).map(([c, b]) => { const p0 = mp(b[0], b[1]), p1 = mp(b[2], b[3]); return [c, [Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1]), Math.max(p0[0], p1[0]), Math.max(p0[1], p1[1])]]; });
      sp.textBoxes = own.map(([, b]) => b);   // 文字データの字がある所は、赤以外の書き込みとみなさない(成果物から消えた文などを見落とさないように)
    }
    const pairs = sp.pairs(), ch = sp.changes();
    // 原稿の字: スキャンは修正後の字から推定する。スキャンでないPDFは原稿の文字データを使い、文字データのない字形(アウトラインなど)だけを推定で補う
    let oc = synthChars(sp, nc);
    if (digital) {
      //   どの字形にも当たらない字(半角の字の位置の割り振りがずれたもの)は、同じ行のいちばん近い字形の中に置く(字を落とさない)
      const inTok = (o, t) => { const x = (o[0] + o[2]) / 2, y = (o[1] + o[3]) / 2; return x >= t[0] - 2 && x <= t[2] + 2 && y >= t[1] - 2 && y <= t[3] + 2; };
      for (const ch of own) {
        if (sp.ot.some(t => inTok(ch[1], t.box))) continue;
        const o = ch[1], y = (o[1] + o[3]) / 2, x = (o[0] + o[2]) / 2, h = o[3] - o[1];
        let best = null, bd = Infinity;
        for (const t of sp.ot) { const b = t.box; if (y < b[1] || y > b[3]) continue; const d = Math.max(b[0] - x, 0, x - b[2]); if (d < bd) { bd = d; best = b; } }
        if (best && bd < 1.5 * h) { const cx = Math.min(Math.max(x, best[0] + 1), best[2] - 1), cy = (best[1] + best[3]) / 2; ch[1] = [cx - 0.5, cy - 0.5, cx + 0.5, cy + 0.5]; }
      }
      //   推定の字は、その字形に原稿の文字データの字が重なるとき(字の中心が字形の中、または字形の中心が字の枠の中)は使わない
      const covered = b => { const x = (b[0] + b[2]) / 2, y = (b[1] + b[3]) / 2; return own.some(([, o]) => { const cx = (o[0] + o[2]) / 2, cy = (o[1] + o[3]) / 2; return (cx >= b[0] - 2 && cx <= b[2] + 2 && cy >= b[1] - 2 && cy <= b[3] + 2) || (x >= o[0] && x <= o[2] && y >= o[1] && y <= o[3]); }); };
      oc = [...own, ...oc.filter(([, b]) => !covered(b))];
    }
    mergeNumbers(ch, sp.ot, oc, sp.nt, nc);
    describe(ch, sp.ot, sp.ol, sp.nt, sp.nl, oc, nc);
    let tmov = [];
    if (digital && nref) { step('文字データを比べています', 0.85); const tx = await textDiffChanges(src, p, A, s, sp, ch, nref); if (tx) tmov = tx.moved; }
    if (window.__pcDebug && typeof window.__pcDebug === 'object') window.__pcDebug.scan = { ot: sp.ot.map(t => t.box), nt: sp.nt.map(t => t.box), oc, nc, ch: ch.map(c => ({ oi: c.oi, nj: c.nj, show: c.show })) };
    ch.push(...layoutChanges(sp.ot, sp.ol, sp.nt, sp.nl, pairs));
    step('写真・図版を比べています', 0.86); await PC.tick();
    const im = sp.imageChanges(); im.forEach(imageShow);
    dropUnchanged(exact, ch, im);
    explainImages(exact, W, nw, ch, im, [...pairs.map(([k, l]) => [sp.ot[k] && sp.ot[k].box, sp.nt[l] && sp.nt[l].box]), ...tmov]);   // 画像の変化は、字の変化・字の移動で説明できない描画の違いだけ
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

  // ---- 紙の赤字原稿(旧版を刷ったもの)＋旧版＋成果物 ----
  //   変化は旧版と成果物の PDF どうしで求め(スキャンの揺れが入らない)、スキャンは赤字の位置を取るためだけに使う。
  //   1) スキャンを旧版(同じ範囲)に重ね、旧版に印刷されていない赤(赤ペン)を取り出す。3mm 以内でつながる赤を1つの赤字(指示)にまとめる
  //   2) 旧版と成果物を同じ解像度で描いて画素で比べた変化(文字・図版・色・大きさ・位置)と、文字データで比べた文字の変化(旧→新)
  //   3) 赤字の線から 8mm 以内(囲んだ赤字はその内側も)を「赤字の近く」とし、変化を「赤字の近く」と「赤字のない所」に分ける。
  //      大きな変化のうち赤字から離れた部分も、赤字のない所の変化として出す。近くに変化のない赤字は「直っていない」。
  //      表と裏などを何枚かに分けて刷った原稿は、同じ成果物のページの赤字をまとめて使い、重なる所の変化は1枚にだけ出す(scan3Resolve)
  //   旧版と成果物のページの大きさ・位置がそろっていない(作り直したレイアウト)ときは使わない(null)
  const MM = mm => Math.round(mm * PC.DPI / 25.4);
  async function scan3Page(src, p, pr, op, oldDoc, newDoc, nw, step) {
    let ow = await PC.renderPage(oldDoc, op.p, PC.DPI, false);
    if (pr.crop) { const [x0, y0, x1, y1] = pr.crop.map(v => Math.round(v * PC.S)); ow = PC.crop(ow, x0, y0, x1, y1); }
    if (ow.w !== nw.w || ow.h !== nw.h) return null;
    step('スキャンを読み込み', 0.02); await PC.tick();
    const { img, dpi } = await src.image(p);
    step('旧版に位置を合わせています', 0.08); await PC.tick();
    const { W, matched } = PC.registerScan(img, ow, dpi);
    step('赤字を取り出しています', 0.3); await PC.tick();
    const w = ow.w, h = ow.h, n = w * h, cs = PC.cleanScan(W, ow);
    //   暗い地(紺・黒の帯など)の上の赤ペンは暗い赤になり、色だけでは赤と分からない。旧版のその所より赤みがはっきり増えた所も赤ペンとする
    //   (赤み = R − (G+B)/2。旧版が暗い所だけで見る。にじみ・位置のわずかなずれは、開く処理と大きさで除く)
    const dark = new Uint8Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const oR = ow.d[j], oG = ow.d[j + 1], oB = ow.d[j + 2], sR = W.d[j], sG = W.d[j + 1], sB = W.d[j + 2];
      if (0.3 * oR + 0.59 * oG + 0.11 * oB > 110) continue;
      if (sR - (sG + sB) / 2 - (oR - (oG + oB) / 2) > 45 && sR - oR > 30 && sR - Math.max(sG, sB) > 15) dark[i] = 255;
    }
    const dk = PC.morph(dark, w, h, 'open', 3, 3), pen0 = new Uint8Array(n); for (let i = 0; i < n; i++) pen0[i] = cs.pen[i] || dk[i] ? 255 : 0;
    const rm = PC.morph(pen0, w, h, 'open', 2, 2);
    //   つながりは薄い赤(にじみ・かすれ)も含めて見る(引き出し線が途切れて、書き込みと指す先が別の赤字にならないように)
    const link = new Uint8Array(n); for (let i = 0; i < n; i++) link[i] = rm[i] || cs.core[i] ? 1 : 0;
    const gc = PC.cc(PC.morph(PC.morph(link, w, h, 'open', 2, 2), w, h, 'dilate', 2 * MM(3) + 1, 2 * MM(3) + 1), w, h), ink = new Float64Array(gc.n), pts = Array.from({ length: gc.n }, () => []);
    for (let i = 0; i < n; i++) if (rm[i]) { const c = gc.lab[i]; ink[c]++; if (ink[c] % 3 === 1) pts[c].push(i); }
    const groups = [];
    for (let c = 1; c < gc.n; c++) {
      if (ink[c] < 80) continue;
      const xs = pts[c].map(i => i % w), ys = pts[c].map(i => Math.floor(i / w));
      groups.push({ c, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs) + 1, Math.max(...ys) + 1], xs, ys, hits: [] });
    }
    //   囲んだ赤字の内側: 赤字の枠の中で、線(1.5mm のすき間はつなぐ)を越えずに枠の外へ出られない所
    const red = new Uint8Array(n), gs = new Set(groups.map(g => g.c)); for (let i = 0; i < n; i++) if (rm[i] && gs.has(gc.lab[i])) red[i] = 1;
    const closed = PC.morph(red, w, h, 'dilate', 2 * MM(0.75) + 1, 2 * MM(0.75) + 1), inside = new Uint8Array(n);
    for (const g of groups) {
      const [x0, y0, x1, y1] = g.box, bw = x1 - x0 + 2, bh = y1 - y0 + 2, seen = new Uint8Array(bw * bh), q = [];
      if (bw * bh > 0.6 * n || bw < MM(5) || bh < MM(5)) continue;
      const at = (x, y) => (x < x0 || y < y0 || x >= x1 || y >= y1 ? 0 : closed[y * w + x]);
      for (let x = 0; x < bw; x++) for (const y of [0, bh - 1]) { seen[y * bw + x] = 1; q.push(y * bw + x); }
      for (let y = 0; y < bh; y++) for (const x of [0, bw - 1]) if (!seen[y * bw + x]) { seen[y * bw + x] = 1; q.push(y * bw + x); }
      while (q.length) {
        const k = q.pop(), x = k % bw, y = (k - x) / bw;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= bw || Y >= bh) continue;
          const kk = Y * bw + X; if (seen[kk] || at(x0 - 1 + X, y0 - 1 + Y)) continue;
          seen[kk] = 1; q.push(kk);
        }
      }
      let cnt = 0; for (let y = 1; y < bh - 1; y++) for (let x = 1; x < bw - 1; x++) if (!seen[y * bw + x] && !at(x0 - 1 + x, y0 - 1 + y)) { inside[(y0 - 1 + y) * w + x0 - 1 + x] = 1; cnt++; }
      g.inside = cnt > MM(3) * MM(3);
    }
    // 2) 旧版と成果物の画素の変化(字の縁の1画素のずれは除く)
    step('旧版と成果物を比べています', 0.6); await PC.tick();
    const dm = new Uint8Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) if (Math.max(Math.abs(ow.d[j] - nw.d[j]), Math.abs(ow.d[j + 1] - nw.d[j + 1]), Math.abs(ow.d[j + 2] - nw.d[j + 2])) > 48) dm[i] = 1;
    const diff = PC.morph(dm, w, h, 'open', 3, 3);
    //    文字の変化(文字データ): 旧版の字 → 成果物の字(同じ位置。ページの大きさ・位置がそろっていることを確かめてある)
    const A = await PC.pageText(oldDoc, op.p), B = await PC.pageText(newDoc, pr.q), k = PC.S, off = pr.crop ? [Math.round(pr.crop[0] * k), Math.round(pr.crop[1] * k)] : [0, 0];
    const px = b => [b[0] * k - off[0], b[1] * k - off[1], b[2] * k - off[0], b[3] * k - off[1]], inC = b => { const [x, y] = PC.center(px(b)); return x >= 0 && y >= 0 && x < w && y < h; };
    const texts = [];
    if (A.chars.length && B.chars.length) {
      const used = new Uint8Array(B.chars.length), blocks = PC.collatePage(A, B, { ...op.pr, noInstr: true, strict: true }, used, new Set());
      for (const bl of blocks) {
        let cur = null;
        const flush = () => { if (cur && (cur.before || cur.after) && cur.boxes.length) texts.push({ before: cur.before, after: cur.after, box: PC.union(cur.boxes), hits: [] }); cur = null; };
        for (const o of [...bl.ops, ['|']]) {
          if (o[0] === '|' || o[0] === '=' || o[0] === '~') { flush(); continue; }
          const a = o[0] === '-' || o.length === 3 ? A.chars[bl.s + o[1]] : null, c = o[0] === '+' ? B.chars[o[1]] : o.length === 3 ? B.chars[o[2]] : null;
          if (!(a ? inC(a.box) : c && inC(c.box))) { flush(); continue; }
          if (!cur) cur = { before: '', after: '', boxes: [] };
          if (a) { cur.before += a.c; cur.boxes.push(px(a.box)); }
          if (c) { cur.after += c.c; cur.boxes.push(px(c.box)); }
        }
        flush();
      }
    }
    //   赤字の下の旧版の字(項目の見出しに使う)
    for (const g of groups) g.under = A.chars.filter(c => { const [x, y] = PC.center(px(c.box)); return x >= g.box[0] && x <= g.box[2] && y >= g.box[1] && y <= g.box[3]; }).map(c => c.c).join('').replace(/\s+/g, '').slice(0, 40);
    step('表示用の画像を作成', 0.95); await PC.tick();
    return { kind: 'scan3', groups, texts, red, inside, diff, w, h, off, matched, regs: [], ch: [], im: [], an: [], notes: [], restBoxes: [], ot: [], nt: [], pairs: [], oc: [], nc: [], left: W, right: nw, oldPage: op.p };
  }
  // 同じ成果物のページに当たる紙の赤字原稿(何枚かに分けて刷ったもの)の赤字と変化を、ページ全体でまとめて突き合わせる
  //   変化のまとまり(4mm 以内はまとめる。2mm² 未満は描画のわずかな違いとして除く)ごとに、画素の3割以上が赤字の近くなら「赤字の近くの変化」、
  //   そうでなければ「赤字のない所の変化」(大きな写真が少し動いたなど、赤字の近くにかかるだけのものも、赤字のない所の変化として出す)。
  //   赤字の近く: 赤字の線から 8mm 以内、囲んだ赤字の内側、四方のうち三方以上を同じ赤字の線に囲まれた所(開いた囲み・かっこ)
  //   赤字ごとの「変わったか」は、そのまとまりの分け方によらず、赤字から 8mm 以内(囲んだ赤字は内側も)の変化の画素で決める。
  //   8mm 以内が変わっていなくても 25mm 以内が変わっていれば、指す先が離れている可能性として添える
  function scan3Resolve(P) {
    const R = MM(8), R2 = MM(25), MIN = MM(1.4) * MM(1.4), byQ = new Map();
    for (const d of P) if (d.kind === 'scan3') { if (!byQ.has(d.q)) byQ.set(d.q, []); byQ.get(d.q).push(d); }
    for (const ds of byQ.values()) {
      const PW = Math.max(...ds.map(d => d.off[0] + d.w)), PH = Math.max(...ds.map(d => d.off[1] + d.h)), N = PW * PH;
      const red = new Uint8Array(N), inside = new Uint8Array(N), diff = new Uint8Array(N);
      for (const d of ds) for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) { const i = y * d.w + x, I = (y + d.off[1]) * PW + x + d.off[0]; if (d.red[i]) red[I] = 1; if (d.inside[i]) inside[I] = 1; if (d.diff[i]) diff[I] = 1; }
      const G = ds.flatMap(d => d.groups.map(g => ({ g, xs: g.xs.map(x => x + d.off[0]), ys: g.ys.map(y => y + d.off[1]), box: [g.box[0] + d.off[0], g.box[1] + d.off[1], g.box[2] + d.off[0], g.box[3] + d.off[1]] })));
      //   四方のうち三方以上を、同じ赤字の線に囲まれているか(線から 2mm の帯で見る)
      const band = MM(2), surrounded = (x, y) => G.some(o => {
        if (x < o.box[0] || x > o.box[2] || y < o.box[1] || y > o.box[3]) return false;
        let l = 0, r = 0, u = 0, dn = 0;
        for (let i = 0; i < o.xs.length; i++) { const X = o.xs[i], Y = o.ys[i]; if (Math.abs(Y - y) <= band) { if (X < x) l = 1; else if (X > x) r = 1; } if (Math.abs(X - x) <= band) { if (Y < y) u = 1; else if (Y > y) dn = 1; } }
        return l + r + u + dn >= 3;
      });
      const near = PC.morph(red, PW, PH, 'dilate', 2 * R + 1, 2 * R + 1); for (let i = 0; i < N; i++) if (inside[i]) near[i] = 1;
      const nearAt = b => { const [x, y] = PC.center(b).map(Math.round); if (surrounded(x, y)) return true; for (let yy = Math.max(0, Math.floor(b[1])); yy < Math.min(PH, Math.ceil(b[3])); yy++) for (let xx = Math.max(0, Math.floor(b[0])); xx < Math.min(PW, Math.ceil(b[2])); xx++) if (near[yy * PW + xx]) return true; return false; };
      //   変化のまとまり
      const dc = PC.cc(PC.morph(diff, PW, PH, 'dilate', 2 * MM(4) + 1, 2 * MM(4) + 1), PW, PH), acc = Array.from({ length: dc.n }, () => [Infinity, Infinity, -1, -1, 0, 0]);
      for (let i = 0; i < N; i++) if (diff[i]) { const a = acc[dc.lab[i]], x = i % PW, y = (i - x) / PW; if (x < a[0]) a[0] = x; if (y < a[1]) a[1] = y; if (x >= a[2]) a[2] = x + 1; if (y >= a[3]) a[3] = y + 1; a[4]++; if (near[i]) a[5]++; }
      const parts = [];
      for (let c = 1; c < dc.n; c++) { const a = acc[c]; if (a[4] < MIN) continue; const box = a.slice(0, 4); parts.push({ box, area: a[4], near: a[5] >= 0.3 * a[4] || surrounded(...PC.center(box).map(Math.round)), hits: [] }); }
      //   文字の変化(重なる所の同じ変化は1つに。1枚の端で切れた一部の字は、ほかの1枚の長いほうに含める)
      const all = ds.flatMap(d => d.texts.map(t => ({ ...t, box: [t.box[0] + d.off[0], t.box[1] + d.off[1], t.box[2] + d.off[0], t.box[3] + d.off[1]] })));
      const texts = all.filter((t, i) => !all.some((u, j) => j !== i && PC.ov(u.box, t.box, 4) && u.before.includes(t.before) && u.after.includes(t.after) && (u.before.length + u.after.length > t.before.length + t.after.length || j < i)));
      for (const t of texts) { t.near = nearAt(t.box); t.hits = []; }
      //   すき間が 3mm 以内で続く文字の変化(帯の文をまとめて消したものなど)は、どれかが赤字の近くなら、まとめて赤字の近くとする
      for (let again = true; again;) { again = false; for (const t of texts) if (!t.near && texts.some(u => u.near && PC.gap(u.box, t.box) <= MM(3))) { t.near = true; again = true; } }
      //   赤字ごとに、8mm 以内(囲んだ・三方を囲んだ赤字は内側も)の変化
      for (const o of G) {
        const zone = [o.box[0] - R2, o.box[1] - R2, o.box[2] + R2, o.box[3] + R2].map(Math.round), zw = zone[2] - zone[0], zh = zone[3] - zone[1];
        const m = new Uint8Array(zw * zh); for (let i = 0; i < o.xs.length; i++) { const X = o.xs[i] - zone[0], Y = o.ys[i] - zone[1]; if (X >= 0 && Y >= 0 && X < zw && Y < zh) m[Y * zw + X] = 1; }
        const m8 = PC.morph(m, zw, zh, 'dilate', 2 * R + 1, 2 * R + 1), m25 = PC.morph(m, zw, zh, 'dilate', 2 * R2 + 1, 2 * R2 + 1);
        let c8 = 0, c25 = 0;
        for (let Y = 0; Y < zh; Y++) { const y = Y + zone[1]; if (y < 0 || y >= PH) continue; for (let X = 0; X < zw; X++) { const x = X + zone[0]; if (x < 0 || x >= PW || !diff[y * PW + x]) continue; const k = Y * zw + X; if (m8[k] || (o.g.inside && inside[y * PW + x])) c8++; else if (m25[k]) c25++; } }
        o.g.changed = c8 >= MIN; o.g.farChanged = !o.g.changed && c25 >= MIN;
        o.g.hits = [...parts, ...texts].filter(x => (x.near || 'after' in x) && x.box[0] < o.box[2] + R && o.box[0] - R < x.box[2] && x.box[1] < o.box[3] + R && o.box[1] - R < x.box[3]);
        if (o.g.changed) for (const x of o.g.hits) x.hits.push(o.g);
      }
      //   どの1枚に出すか: 変化の中心が、その1枚の範囲のいちばん内側にあるもの
      const home = b => { const [cx, cy] = PC.center(b); let best = ds[0], bv = -Infinity; for (const d of ds) { const v = Math.min(cx - d.off[0], d.off[0] + d.w - cx, cy - d.off[1], d.off[1] + d.h - cy); if (v > bv) { bv = v; best = d; } } return best; };
      const loc = (d, b) => [b[0] - d.off[0], b[1] - d.off[1], b[2] - d.off[0], b[3] - d.off[1]];
      for (const d of ds) { d.regs = []; d.ptexts = []; }
      for (const x of parts) { const d = home(x.box); d.regs.push({ ...x, box: loc(d, x.box) }); }
      for (const t of texts) { const d = home(t.box); d.ptexts.push({ ...t, box: loc(d, t.box) }); }
      for (const d of ds) { d.red = d.inside = d.diff = null; }
    }
  }
  // 紙の赤字原稿＋旧版の照合の項目(s3: 画面の文の作り分けに使う)
  function scan3Findings(d, p, add) {
    const bx = b => b.map(Math.round), short = t => (t.length > 40 ? t.slice(0, 40) + '…' : t), loc = b => [b[0] - d.off[0], b[1] - d.off[1], b[2] - d.off[0], b[3] - d.off[1]];
    const textOf = t => (t.before && t.after ? `「${short(t.before)}」→「${short(t.after)}」` : t.before ? `「${short(t.before)}」が消えた` : `「${short(t.after)}」が入った`);
    for (const g of d.groups) {
      //   近くが変わっていない赤字: 手書きの中身は読まないため、直す指示か、見本・参考として書いた赤字(ほかの赤字が記号などで指すもの)かは
      //   決められない。「直っていない」と言い切らず、人が判断する指示として出す(件数は結果の上にも出す)
      if (!g.changed) { const f = add(p + 1, 'K', bx(g.box), g.under, '赤字（紙）', '', '', bx(g.box)); f.s3 = { still: true, far: g.farChanged }; continue; }
      const nt = g.hits.filter(x => 'after' in x).length, nr = g.hits.length - nt;
      const f = add(p + 1, 'A', bx(g.box), g.under, '赤字（紙）', '', '', g.hits.length ? bx(PC.union(g.hits.map(x => loc(x.box)))) : bx(g.box));
      f.s3 = { nt, nr };
    }
    for (const t of d.ptexts) {
      const f = add(p + 1, t.near ? 'A' : 'C2', bx(t.box), textOf(t), t.near ? '赤字の近くの文字の変化' : '赤字のない所の文字の変化', '', '', bx(t.box));
      Object.assign(f, { segs: charSegs(t.before, t.after), same: false, pboxes: [bx(t.box)], pnboxes: [bx(t.box)], fromOld: true });
    }
    for (const r of d.regs) {
      if (r.near || d.ptexts.some(t => PC.ov(t.box, r.box) && t.near === r.near)) continue;   // 赤字の近くの見た目の変化は赤字の項目に含める。文字の変化として出したものも除く
      const f = add(p + 1, 'C3', bx(r.box), '', '', '', '', bx(r.box));
      Object.assign(f, { kind: 'image', s3: { look: true } });
    }
  }

  // 見た目が似た別の字(修正後の文字データだけで調べる): カタカナの間の漢字・記号、漢字の間のカタカナ
  const TO_KATA = { '一': 'ー', '−': 'ー', '‐': 'ー', '－': 'ー', '―': 'ー', '─': 'ー', '口': 'ロ', '力': 'カ', '工': 'エ', '二': 'ニ', '八': 'ハ', '卜': 'ト', '夕': 'タ', '才': 'オ' };
  const TO_KAN = { 'ー': '一', 'ロ': '口', 'カ': '力', 'エ': '工', 'ニ': '二', 'ハ': '八', 'ト': '卜', 'タ': '夕', 'オ': '才' };
  const isKata = c => /^[ァ-ヺー]$/.test(c), isKan = c => /^\p{Script=Han}$/u.test(c);
  function lookalikeChars(cs) {
    const out = [], near = (a, b) => { const s = Math.max(a[2] - a[0], a[3] - a[1], b[2] - b[0], b[3] - b[1]); return Math.hypot((a[0] + a[2] - b[0] - b[2]) / 2, (a[1] + a[3] - b[1] - b[3]) / 2) < 1.6 * s; };
    //   長音の代わりの「一」・ダッシュは、カタカナの語の終わり(後ろがかな・記号・行の終わり)でも見る(「ヒータ一は」)。
    //   後ろが漢字・数字のときは本当の漢数字のことがある(「ランキング一位」)ので見ない
    const END = new Set(['一', '−', '‐', '－', '―', '─']);
    for (let i = 1; i < cs.length; i++) {
      const [c, b] = cs[i], [a, pb] = cs[i - 1], nx = cs[i + 1], z = nx && near(b, nx[1]) ? nx[0] : null;
      if (!near(pb, b)) continue;
      let want = null;
      if (TO_KATA[c] && isKata(a) && ((z != null && isKata(z)) || (END.has(c) && (z == null || !(isKan(z) || /[0-9０-９]/.test(z)))))) want = TO_KATA[c];
      else if (TO_KAN[c] && isKan(a) && z != null && isKan(z)) want = TO_KAN[c];
      if (want) out.push({ c, want, box: b, ctx: [a, z || ''] });
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

  // OCR で字を足した成果物のページは、字ごとの印(使った字)の入れ物を、足した字の分まで広げる
  const grow = (u, n) => { if (u.length >= n) return u; const v = new Uint8Array(n); v.set(u); return v; };
  const growUsed = nq => { nq.used = grow(nq.used, nq.B.chars.length); nq.usedFree = grow(nq.usedFree, nq.B.chars.length); };
  // 原稿(または旧版)の字が見当たらない所: [{ box(成果物での見込みの位置 pt。T がなければ null), text }]
  const missAreas = (A, blocks, T) => {
    const out = [];
    for (const b of blocks) {
      if (b.instr) continue;
      let run = [];
      for (const o of [...b.ops, ['|']]) { if (o[0] === '-') run.push(A.chars[b.s + o[1]]); else if (run.length) { out.push({ box: T ? PC.mapBox(T, PC.union(run.map(c => c.box))) : null, text: run.map(c => c.c).join('') }); run = []; } }
    }
    return out;
  };

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
    const snap = (pr.free ? nq.usedFree : nq.used).slice();
    let blocks = noText ? [] : PC.collatePage(A, nq.B, pr, pr.free ? nq.usedFree : nq.used, nq.notes);
    // 原稿の字が成果物に見当たらない所の近くに、文字データのない文字らしい所(アウトライン化・画像の文字)があれば、そこだけ OCR で
    //   読んだ字を足して照合し直す(位置の手がかりのない原稿は、ページの候補のうちインクの多いものから)
    if (!noText && PC.ocrAvailable && PC.ocrAvailable()) {
      const added = await PC.ocrAugment(nq.doc, nq.q, nq.B, null, missAreas(A, blocks, pr.free ? null : pr.Tt || pr.T), s => step(s, 0.5));
      if (added) {
        growUsed(nq);
        const u = grow(snap, nq.B.chars.length); if (pr.free) nq.usedFree = u; else nq.used = u;
        blocks = PC.collatePage(A, nq.B, pr, u, nq.notes);
      }
    }
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
      //   仕上がり(トンボ)の外の字と内側の字は、別の件にする(ページ情報などを、外の項目として隠せるように)
      const tr = PC.trimOf(B), side = b => !!tr && PC.outside(tr, b);
      const groups = [];
      B.items.forEach((it, idx) => {
        const js = []; B.chars.forEach((c, j) => { if (c.it === idx && !used[j] && !usedFree[j] && !c.ocr) js.push(j); });   // OCR の字は、原稿に当たらなければ出さない(図や飾りの読み違いのことがある)
        const isNote = notes.has(idx);
        if (!js.length || (!isNote && !js.some(j => /[\p{L}\p{N}]/u.test(B.chars[j].c)))) return;
        const box = PC.union(js.map(j => B.chars[j].box)), g = groups[groups.length - 1];
        // 同じ行なら全角の空白をはさむくらいまで(2.5字)、別の行なら行の間くらいまで(1.2字)離れていても1件にまとめる
        const size = g ? Math.max(it.size, g.size) : it.size, sameLine = g && Math.min(box[3], g.box[3]) - Math.max(box[1], g.box[1]) > 0.5 * Math.min(box[3] - box[1], g.box[3] - g.box[1]);
        const close = g && g.note === isNote && g.out === side(box) && PC.gap(box, g.box) < (sameLine ? 2.5 : 1.2) * size;
        if (close) { g.js.push(...js); g.box = PC.union([g.box, box]); g.size = Math.max(g.size, it.size); }
        else groups.push({ js, box, note: isNote, size: it.size, out: side(box) });
      });
      // データファイルの範囲では、同じ行に並ぶまとまり(表の1行のセルなど)は、間に対応づいた字がなければ1件にまとめる
      const taken = j => used[j] || usedFree[j];
      for (let k = groups.length - 1; k > 0; k--) {
        const a = groups[k - 1], b = groups[k];
        if (a.note || b.note || a.out !== b.out) continue;
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
      // 原稿のない部分の数字のまとまりの中(と直後)で消えた旧版の数字・区切り(「14:23」→「9:11」の消えた字)は、その数字の件に入れる
      //   (旧版から消えた字だけの件を別に出さない)。返り値: 成果物の字の番号 → その前で消えた字。入れたものは旧版の比べ合わせ(oldChanges)で出さない
      const goneIn = js => {
        const m = new Map(), set = new Set(js);
        for (const x of os.gone) {
          if (x.taken || x.at < 0 || !x.cs.every(c => PC.NUMC.test(c.c))) continue;
          if (set.has(x.at) ? !PC.NUMC.test(B.chars[x.at].c) : !(set.has(x.at - 1) && PC.DIGC.test(B.chars[x.at - 1].c))) continue;
          x.taken = true; m.set(x.at, (m.get(x.at) || '') + x.cs.map(c => c.c).join(''));
        }
        return m;
      };
      for (const g of groups) {
        const d = owner(PC.center(g.box)), text = g.js.map(j => B.chars[j].c).join('');
        const back = backOf(d, g.box), R = d.pr.region, M = 0.04 * Math.hypot(R[2] - R[0], R[3] - R[1]), isFar = dist(PC.center(g.box), R) > far;
        const gin = os && isFar && !g.note ? goneIn(g.js) : new Map(), old = os ? (!gin.size && g.js.every(j => os.st[j] === 1) ? 'same' : 'changed') : null;
        if (g.note) { d.extra.push({ cat: 'W', nbox: g.box, box: back, show: text }); continue; }
        if (old === 'same' && isFar) {   // 原稿のない部分で、旧版と同じ(前回のまま)ものは1件にまとめる
          const prev = d.extra.find(e => e.old === 'same' && e.out === g.out);
          if (prev) { prev.nboxes.push(g.box); prev.texts.push(text); prev.nbox = PC.union([prev.nbox, g.box]); prev.box = backOf(d, prev.nbox); }
          else d.extra.push({ cat: 'I', noSrc: true, old, nbox: g.box, nboxes: [g.box], box: back, texts: [text], out: g.out });
          continue;
        }
        if (isFar) {   // 原稿のない部分は1件にまとめる(成果物のその部分の原稿を渡していないとき)
          const prev = d.extra.find(e => e.cat === 'I' && e.noSrc && !e.old && e.vsOld === old && e.out === g.out);
          if (prev) { prev.nboxes.push(g.box); prev.texts.push(text); prev.jss.push(g.js); prev.nbox = PC.union([prev.nbox, g.box]); prev.box = backOf(d, prev.nbox); for (const [j, t] of gin) prev.gin.set(j, t); }
          else d.extra.push({ cat: 'I', noSrc: true, nbox: g.box, nboxes: [g.box], box: back, texts: [text], jss: [g.js], vsOld: old, os, out: g.out, gin });
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

  // ---- 差し込み印刷(名刺・宛名ラベルなど。データファイルの表の1行が、成果物の1ページ(表と裏の2ページのことも)に載るもの)の、行ごとの照合 ----
  //   成果物のページが1行ずつの差し込みと分かったときだけ(merge.js)、その表のシートの照合を、行ごとの照合に置き換える。
  //   同じ人などの行がほかの表にもあり、差し込んだ表の行のほうがよく合う表と、差し込んだページに当てたほかのデータファイルの照合も外す
  async function mergePages(P, src, JP, newDoc, NQ, warn) {
    const sheets = new Map();
    for (let p = 0; p < src.numPages; p++) { const it = src.page(p); if (!it.virt || !it.virt.sheet || sheets.has(it.virt.sheet)) continue; sheets.set(it.virt.sheet, { src: p, label: src.label(p).replace(/（\d+）$/, '') }); }
    if (!sheets.size) return;
    const res = PC.matchMerge([...sheets.keys()], JP);
    if (!res) return;
    const k = PC.S, px = b => b.map(v => v * k), used = new Set(res.groups.map(g => g.t.sheet)), lost = new Set(res.lost.map(t => t.sheet)), mq = new Set(res.groups.flatMap(g => g.pages.map(P => P.q)));
    const drop = d => { if (d.src == null) return false; const it = src.page(d.src); return !!(it.virt && it.virt.sheet) && (used.has(it.virt.sheet) || lost.has(it.virt.sheet) || (d.q >= 0 && mq.has(d.q))); };
    const at = P.findIndex(drop), entries = [];
    for (const g of res.groups) {
      const info = sheets.get(g.t.sheet);
      //   原稿の表示: その行の、見出し(項目)と値の2列の表
      const vp = PC.tablePages(`${info.label}（${g.r.rn}行目）`, [{ cells: ['項目', '原稿の値'], rn: '' }, ...g.r.fields.map(f => ({ cells: [f.label, f.value], rn: '' }))], {})[0];
      const fbox = new Map(); vp.blocks.forEach(([s0, e0], bi) => { if (bi > 0) fbox.set(g.r.fields[bi - 1], PC.union(vp.chars.slice(s0, e0).map(c => c.box))); });
      const left = await toThumb(vp.render(PC.DPI)), pgs = g.pages.slice().sort((a, b) => a.q - b.q);
      for (const Pg of pgs) {
        const right = NQ.has(Pg.q) ? NQ.get(Pg.q).thumb : await toThumb(await PC.renderPage(newDoc, Pg.q, PC.DPI, false));
        const d = { kind: 'merge', q: Pg.q, src: info.src, label: `${info.label}（${g.r.rn}行目）`, mg: { g, fbox, Pg, res: res.res.filter(x => x.g === g), cmiss: res.cmiss.filter(x => x.P === Pg) }, ch: [], im: [], an: [], notes: [], restBoxes: [], ot: [], nt: [], pairs: [], oc: [], nc: [], extra: [], thumbs: { left, right } };
        //   同じ作りのほかのページと違う所(成果物だけで見た項目として出す)
        //   gone: ほかのページにある、元の表にない字だけの行が、このページにない。extra: ほかのページでは元の表の値だけの位置に、元の表にない字がある
        const tmsg = x => (x.gone ? `同じ作りのほかのページ（${x.n}ページ）にある「${x.want}」の行が、このページにありません。消えていないか確認してください`
          : x.extra ? `同じ作りのほかのページ（${x.n}ページ）では、この位置の字はすべて差し込みの元の表の値です。「${x.show}」は元の表にない字なので、増えた字でないか確認してください`
          : `同じ作りのほかのページ（${x.n}ページ）では「${x.want}」です。差し込みの元の表にない字なので、ページごとに違う理由がないか確認してください`);
        d.jf = res.tmpl.filter(x => x.P === Pg).map(x => ({ q: Pg.q, kind: 'tmpl', level: 'check', show: x.show, want: x.extra ? '' : x.want, msg: tmsg(x), ctx: ['', ''], nbox: px(x.box || PC.mergeBox(Pg.B, x.js)), more: [] }));
        entries.push(d);
      }
    }
    const gone = [...new Set(P.filter(drop).map(d => d.label).filter(Boolean))];
    for (let i = P.length - 1; i >= 0; i--) if (drop(P[i])) P.splice(i, 1);
    P.splice(at < 0 ? P.length : at, 0, ...entries);
    //   外した照合のページについての注意(文字データがないなど)も外す
    for (let i = warn.length - 1; i >= 0; i--) if (gone.some(l => warn[i].startsWith(l + ' '))) warn.splice(i, 1);
    const names = ts => [...ts].map(t => sheets.get(t).label).join('・');
    warn.push(`${names(used)}の表の1行が成果物の1ページ${res.groups.some(g => g.pages.length >= 2) ? '（表・裏）' : ''}に載る差し込み印刷として、行ごとに照合しました（${res.groups.length}行・成果物${mq.size}ページ）`);
    if (lost.size) warn.push(`${names(lost)}にも成果物と同じ値の行がありますが、${names(used)}の行のほうがよく合うため、照合に使っていません`);
    if (res.multi) warn.push(`成果物の${res.multi}ページは、1ページに2件以上の行が載っているようです。差し込み印刷の照合は1ページ1件（表・裏）のものだけに対応しているため、2件目以降の行は照合していません（「成果物に見当たらない行」として知らせることがあります）`);
    for (const m of res.missing) warn.push(`${sheets.get(m.t.sheet).label}の${m.rows.length}行（${m.rows.slice(0, 8).map(r => r.rn).join('・')}${m.rows.length > 8 ? 'ほか' : ''}行目）は、成果物に見当たりませんでした（作らないものなら問題ありません）`);
  }
  // 差し込み印刷の行ごとの照合の項目: 値が違う・見当たらない値。すべて一致したページは、まとめて1件(一覧には出さない)
  function mergeFindings(d, p, add) {
    const k = PC.S, px = b => b && b.map(v => v * k), { g, fbox, Pg, res, cmiss } = d.mg, ref = `${g.r.rn}行目`, ok = [], okBox = [];
    let bad = 0;
    const shown = t => t.replace(/\u00ad/g, '-');   // 見えないハイフン(ソフトハイフン)は「-」として示す
    for (const m of cmiss) {   // 共通の値(会社名・住所・事業所の電話番号など)の違い・見当たらないもの
      const nb = m.got ? PC.mergeBox(Pg.B, m.got.js) : m.box, f = add(p + 1, 'T', [0, 0, 10, 10], m.got ? shown(m.got.t) : '', '共通の値', '', '', px(nb));
      Object.assign(f, { segs: m.got ? charSegs(m.a.raw.replace(/\s+/g, ''), shown(m.got.t).replace(/\s+/g, '')) : [['-', m.a.raw]], same: false, pboxes: [], pnboxes: nb ? [px(nb)] : [], ref: m.a.cell, merge: { kind: m.got ? 'common' : 'commonMissing', field: '共通の値', want: m.a.raw, got: m.got && shown(m.got.t), cell: m.a.cell } });
      if (!m.got) f.approx = true;
      bad++;
    }
    for (const x of res) {
      const hs = x.per.get(Pg) || [];
      if (hs.length) { ok.push(x.f); okBox.push(...hs.map(h => PC.mergeBox(Pg.B, [...new Set(Pg.at.slice(h.i, h.i + h.n))]))); }
      for (const m of x.miss) {
        if (m.P !== Pg) continue;
        //   表示: 空白を除き、成果物が大文字だけなら原稿の値も大文字にそろえて比べる(ローマ字の名前)
        let want = x.a.raw.replace(/\s+/g, '');
        if (m.got && !/[a-z]/.test(m.got.t) && /[A-Z]/.test(m.got.t)) want = want.toUpperCase();
        const lb = fbox.get(x.f), nb = m.got ? PC.mergeBox(Pg.B, m.got.js) : m.area || null;
        const got = m.got && shown(m.got.t), f = add(p + 1, 'T', px(lb) || [0, 0, 10, 10], got || '', x.f.label, '', '', px(nb));
        Object.assign(f, { segs: m.got ? charSegs(want, got.replace(/\s+/g, '')) : [['-', x.a.raw]], same: false, pboxes: lb ? [px(lb)] : [], pnboxes: nb ? [px(nb)] : [], ref, merge: { kind: m.got ? 'field' : 'missing', field: x.f.label, want: x.a.raw, got, rn: g.r.rn } });
        if (!m.got) f.approx = true;
        bad++;
      }
    }
    if (ok.length && !bad) {   // このページの値がすべて一致(まとめて1件。一覧には出さない)
      const ls = [...new Set(ok)], f = add(p + 1, 'T', px(PC.union(ls.map(x => fbox.get(x)).filter(Boolean))), '', '', '', '', px(PC.union(okBox)));
      Object.assign(f, { auto: 'ok', ref, merge: { kind: 'ok', fields: ls.map(x => x.label), rn: g.r.rn } });
    }
  }

  // ---- 商品マスタのような表(1行が1商品で、成果物には一部の列だけが載るもの)の、商品ごとの照合 ----
  //   行の文字の多くが成果物に載る表(価格表など)は、ほかのデータファイルと同じく文字の並びで照合する。ここでは、それで対応が見つからなかったシートだけを扱う
  const charSegs = (a, b) => { const A = [...a], B = [...b], segs = []; for (const [t, i1, i2, j1, j2] of PC.opcodes(A, B)) { if (t === 'equal') segs.push(['=', A.slice(i1, i2).join('')]); else { if (i2 > i1) segs.push(['-', A.slice(i1, i2).join('')]); if (j2 > j1) segs.push(['+', B.slice(j1, j2).join('')]); } } return segs; };
  async function recordPages(P, src, JP, newDoc, NQ) {
    const sheets = new Map();
    const merged = new Set(P.filter(d => d.kind === 'merge').map(d => src.page(d.src).virt.sheet));   // 差し込み印刷として照合したシートは扱わない
    P.forEach(d => { if (d.src == null) return; const it = src.page(d.src); if (!it.virt || !it.virt.sheet || merged.has(it.virt.sheet)) return; const sh = it.virt.sheet; if (!sheets.has(sh)) sheets.set(sh, { all: [], used: false, src: d.src }); const x = sheets.get(sh); x.all.push(d); if (d.kind !== 'none') x.used = true; });
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

  // ---- 位置を先に(旧版と成果物が同じレイアウトのとき): 字の並びで対応づけた結果(blocks の ops)を、同じ位置の同じ字で直す ----
  //   字の並びだけでは、同じ字の並びがページに2回あるとき、どちらが消えた(入った)かを取り違えることがある。
  //   ・「消えた」とした旧版の字 i と同じ字が、成果物の同じ位置(写した位置から字の大きさの半分以内)にあれば、i とその字 j を対応づける。
  //     j が別の旧版の字 i2(j と同じ位置にない字)に対応づいていたら、i2 を「消えた」にする(i2 も同じ位置の字を探す)。j が「入った」なら、それを取り消す
  //   ・「入った」とした成果物の字 j と同じ字が、旧版の同じ位置にあり、その旧版の字が別の位置の成果物の字 j2 に対応づいていたら、入れ替える(j2 を「入った」にする)
  //   T: 旧版のページ → 成果物のページ(pt)。used: 成果物の字のうち対応づいたもの、snap: 前の旧版のページで使った字(動かさない)
  //   mono: 組み直した字が、同じまとまり(blocks)の中で前後に対応づいている字どうしの間に収まるとき(字の並びの順が入れ替わらないとき)だけ直す。
  //   原稿と成果物の文字データの比べ合わせで使う(段落の途中を消す・足すと後ろの文が詰まり、日本語は字の格子にそろうので、近くの同じ字が
  //   たまたま元の位置に来ることがある。それを組むと並びの順が入れ替わるので組まない。表の各列に同じ文が並ぶ所で、隣の列の同じ文と組んだ
  //   取り違えは、ます目の前後の対応の間に収まるので直す)
  function posFirst(A, B, blocks, T, used, snap, mono = false) {
    const G = 12, cen = b => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], sz = b => Math.max(1, Math.min(b[2] - b[0], b[3] - b[1]) || Math.max(b[2] - b[0], b[3] - b[1]));
    const index = (n, at) => { const g = new Map(); for (let k = 0; k < n; k++) { const [x, y] = at(k), key = Math.floor(x / G) + '|' + Math.floor(y / G); if (!g.has(key)) g.set(key, []); g.get(key).push(k); } return g; };
    const pA = A.chars.map(c => { const [x, y] = cen(c.box); return PC.applyT(T, x, y); }), pB = B.chars.map(c => cen(c.box));
    const gB = index(B.chars.length, k => pB[k]), gA = index(A.chars.length, k => pA[k]);
    const look = (g, [x, y]) => { const out = []; for (let gx = Math.floor(x / G) - 1; gx <= Math.floor(x / G) + 1; gx++) for (let gy = Math.floor(y / G) - 1; gy <= Math.floor(y / G) + 1; gy++) for (const k of g.get(gx + '|' + gy) || []) out.push(k); return out; };
    const near = (i, j) => { const s = 0.5 * sz(B.chars[j].box); return Math.abs(pA[i][0] - pB[j][0]) <= s && Math.abs(pA[i][1] - pB[j][1]) <= s; };
    //   mapA: 旧版(原稿)の字 → 対応づいた成果物の字(なければ -1)。blk: 字 → まとまりの番号
    const mapA = new Int32Array(A.chars.length).fill(-1), blk = new Int32Array(A.chars.length).fill(-1);
    blocks.forEach((b, bi) => { for (let i = b.s; i < b.e; i++) blk[i] = bi; b.ops.forEach(o => { if (o.length === 3) mapA[b.s + o[1]] = o[2]; }); });
    const inOrder = (i, j) => {   // 同じまとまりの中で、前後に対応づいている字の、対応先の間に j が収まるか
      const bi = blk[i]; if (bi < 0) return false;
      const b = blocks[bi]; let p = i - 1, n = i + 1;
      while (p >= b.s && mapA[p] < 0) p--;
      while (n < b.e && mapA[n] < 0) n++;
      return (p < b.s || mapA[p] < j) && (n >= b.e || mapA[n] > j);
    };
    const same = (i, j) => A.chars[i].c === B.chars[j].c && near(i, j) && (!mono || inOrder(i, j));
    //   ops の場所: 旧版の字 i → [まとまり, 番号]、成果物の字 j → [まとまり, 番号]
    const atI = new Map(), atJ = new Map();
    blocks.forEach((b, bi) => b.ops.forEach((o, k) => { if (o[0] === '|') return; if (o[0] === '-') atI.set(b.s + o[1], [bi, k]); else if (o[0] === '+') atJ.set(o[1], [bi, k]); else { atI.set(b.s + o[1], [bi, k]); atJ.set(o[2], [bi, k]); } }));
    const touched = new Set(), opAt = x => blocks[x[0]].ops[x[1]], setOp = (x, o) => { blocks[x[0]].ops[x[1]] = o; touched.add(x[0]); };
    const qi = [...atI.keys()].filter(i => opAt(atI.get(i))[0] === '-'), qj = [...atJ.keys()].filter(j => opAt(atJ.get(j))[0] === '+');
    //   mono のとき、まず、同じ位置に同じ字が3字以上続けて並ぶ所(旧版・原稿の続く字が、成果物の続く字とそれぞれ同じ位置で同じ字)は、
    //   その並びどうしを組む(表の各列に同じ文が並ぶ所で、句ごと隣の列・別の段の同じ文と組んだ取り違え。前後の対応も一緒にずれているので、
    //   1字ずつの直し方では並びの順の条件で直らない。3字以上が同じ位置にそろうのは、たまたまではない)。押し出された字は、下で組み直す
    let forced = false;
    if (mono) {
      const j0 = new Int32Array(A.chars.length).fill(-1);
      for (const i of atI.keys()) { const j = look(gB, pA[i]).find(j => A.chars[i].c === B.chars[j].c && near(i, j) && !snap[j]); if (j !== undefined) j0[i] = j; }
      //   組み直すのは、その並びのうち、いまはそろって同じ動き(字の大きさの半分以内)でずれた所に組まれている字が3字以上続く所だけ
      //   (段落の途中を消して後ろの文が詰まり、「。」と次の文の頭の字がたまたま消した文の頭と同じ位置に来た所は、組まれ方がそろって
      //   ずれていない(消えた・同じ位置)ので組み直さない)
      const force = [], moved = t => { const x = atI.get(t), o = x && opAt(x); return o && o.length === 3 && o[2] !== j0[t] && !near(t, o[2]) ? o[2] : -1; };
      for (let i = 0; i < A.chars.length;) {
        if (j0[i] < 0) { i++; continue; }
        let e = i + 1; while (e < A.chars.length && j0[e] === j0[e - 1] + 1 && blk[e] === blk[i]) e++;
        for (let s = i; s < e;) {
          const js = moved(s); if (js < 0) { s++; continue; }
          const D = [pB[js][0] - pA[s][0], pB[js][1] - pA[s][1]], tol = 0.5 * sz(B.chars[js].box);
          let t = s + 1;
          for (; t < e; t++) { const jt = moved(t); if (jt < 0 || Math.abs(pB[jt][0] - pA[t][0] - D[0]) > tol || Math.abs(pB[jt][1] - pA[t][1] - D[1]) > tol) break; }
          if (t - s >= 3) for (let u = s; u < t; u++) force.push(u);
          s = t;
        }
        i = e;
      }
      forced = force.length > 0;
      for (const i of force) {
        const xi = atI.get(i), o = opAt(xi), j = j0[i], xj = atJ.get(j);
        if (xj) { const p = opAt(xj); if (p[0] === '+') setOp(xj, ['drop']); else if (p.length === 3) { const i2 = blocks[xj[0]].s + p[1]; setOp(xj, ['-', p[1]]); atI.set(i2, xj); mapA[i2] = -1; qi.push(i2); } }
        if (o.length === 3) {   // 前に組んでいた成果物の字は、どれにも組まれていない字にする(下で、同じ位置の同じ字を探す)
          const b = blocks[xi[0]]; b.ops.push(['+', o[2]]); atJ.set(o[2], [xi[0], b.ops.length - 1]); used[o[2]] = 0; qj.push(o[2]);
        }
        setOp(xi, ['=', o[1], j]); atJ.set(j, xi); used[j] = 1; mapA[i] = j;
      }
    }
    let guard = 0;
    while ((qi.length || qj.length) && guard++ < 20000) {
      if (qi.length) {   // 消えたとした旧版の字
        const i = qi.shift(), xi = atI.get(i); if (!xi || opAt(xi)[0] !== '-') continue;
        const j = look(gB, pA[i]).find(j => same(i, j) && !snap[j]); if (j === undefined) continue;
        const xj = atJ.get(j);
        if (xj) {
          const o = opAt(xj);
          if (o[0] === '+') setOp(xj, ['drop']);
          else { const i2 = blocks[xj[0]].s + o[1]; if (i2 === i || near(i2, j)) continue; setOp(xj, ['-', o[1]]); atI.set(i2, xj); mapA[i2] = -1; qi.push(i2); }
        } else if (used[j]) continue;
        setOp(xi, ['=', opAt(xi)[1], j]); atJ.set(j, xi); used[j] = 1; mapA[i] = j;
        continue;
      }
      const j = qj.shift(), xj = atJ.get(j); if (!xj || opAt(xj)[0] !== '+' || snap[j]) continue;   // 入ったとした成果物の字
      const i = look(gA, pB[j]).find(i => same(i, j)); if (i === undefined) continue;
      const xi = atI.get(i); if (!xi) continue;
      const o = opAt(xi); if (o[0] === '-') { qi.push(i); continue; }
      const j2 = o[2]; if (j2 === j || near(i, j2) || snap[j2]) continue;
      setOp(xi, ['=', o[1], j]); setOp(xj, ['+', j2]); atJ.set(j, xi); atJ.set(j2, xj); mapA[i] = j; qj.push(j2);
    }
    for (const b of blocks) if (b.ops.some(o => o[0] === 'drop')) b.ops = b.ops.filter(o => o[0] !== 'drop');
    //   mono で並びを組み直したまとまりは、ops を字の順に並べ直す(組み直した字の op は、もとの op の場所に入るので、並びの順が乱れる。
    //   消えた字の文などを、字の順に示すため): 旧版・原稿の字のある op はその字の番号の順、成果物の字だけの op('+')は、その字より前で
    //   いちばん近い、組まれた成果物の字の、組んだ旧版の字のすぐ後ろ。区間の切れ目('|')は、続く op の前
    if (mono && forced) for (const bi of touched) {
      const b = blocks[bi], oldOfJ = new Map();
      b.ops.forEach(o => { if (o.length === 3) oldOfJ.set(o[2], o[1]); });
      const key = b.ops.map(o => {
        if (o[0] === '|') return null;
        if (o[0] !== '+') return [o[1], -1];
        for (let j = o[1] - 1; j >= Math.max(0, o[1] - 400); j--) if (oldOfJ.has(j)) return [oldOfJ.get(j) + 0.5, o[1]];
        return [-0.5, o[1]];
      });
      for (let k = key.length - 1, next = [Infinity, 0]; k >= 0; k--) { if (key[k]) next = key[k]; else key[k] = [next[0] - 1e-6, next[1]]; }
      b.ops = b.ops.map((o, k) => [key[k], k, o]).sort((x, y) => x[0][0] - y[0][0] || x[0][1] - y[0][1] || x[1] - y[1]).map(x => x[2]);
    }
  }

  // ---- 旧版(前回の成果物)との比べ合わせ ----
  //   旧版の各ページが成果物のどのページ・範囲に当たるかを求め、字の並びで対応づける(同じレイアウトなら、同じ位置の同じ字で直す: posFirst)
  //   返り値: 成果物のページ → { B, st: 字ごとに 0=旧版にない・1=旧版と同じ・2=旧版の別の字から変わった, gone: 旧版から消えた字の続き, maps }
  //   step(知らせ, 進み 0〜1): ページの対応を調べる所と、旧版のページごとの比べ合わせに、見込みの時間(PC.COST)で割り振る
  async function oldDiff(oldDoc, newDoc, NQ, step, JP) {
    const src = { numPages: oldDoc.numPages, page: p => ({ doc: oldDoc, i: p }), label: () => null, image: async p => ({ img: await PC.renderPage(oldDoc, p, 300, false), dpi: 300 }) };
    const C = PC.COST, n = oldDoc.numPages, wp = C.pairNew * newDoc.numPages + C.pairOld * n, a = wp / (wp + C.oldCmp * n);
    const pairs = await PC.pairPages(src, newDoc, (s, f) => step('旧版との対応：' + s, a * f), '旧版'), out = new Map();
    for (let p = 0; p < pairs.length; p++) {
      if (p) for (const d of [oldDoc, newDoc]) { try { await d.cleanup(true); } catch (e) { /* 描いている途中なら次の機会に */ } }   // 前のページで展開した画像などを手放す(メモリを抑える)
      const pr = pairs[p], at = a + (1 - a) * p / n, prog = s => step(s, at);
      prog(`旧版 ${p + 1}/${n} ページを成果物と比べています`);
      if (pr.q < 0) continue;
      if (!out.has(pr.q)) { const B = NQ.has(pr.q) ? NQ.get(pr.q).B : JP && JP[pr.q] ? JP[pr.q].B : await PC.pageText(newDoc, pr.q); out.set(pr.q, { B, st: new Uint8Array(B.chars.length), oc: [], used: new Uint8Array(B.chars.length), gone: [], maps: [], moved: [], movedP: [] }); }
      const o = out.get(pr.q), A = await PC.pageText(oldDoc, p);
      //   旧版のページに文字データがない(全面が画像など)ときは、字で位置を合わせられないので、画像のずらし方で合わせ、見た目で比べる(oldLooks)
      //   (これまでは何も比べずに飛ばしていたため、画像が違っても0件になった)。成果物のページにだけ文字データがないときは、下の字の比べ合わせ
      //   (成果物のその辺りを OCR で読む)を通し、字で位置を合わせられなければ、そこで画像のずらし方で合わせる
      if (!A.chars.length) {
        pr.Tr = pr.same ? await imageShift(oldDoc, p, newDoc, pr.q, pr.T) : null;
        o.maps.push({ p, T: pr.T, Tr: pr.Tr || null, img: true, noText: true });
        continue;
      }
      const snap = o.used.slice(), opt = { ...pr, noInstr: true, strict: true };
      let blocks = PC.collatePage(A, o.B, opt, o.used, new Set());
      // 片方にだけ文字データがある所(どちらかで文字をアウトライン化・画像化した所)は、もう片方のその辺りを OCR で読んで比べ直す
      //   旧版の字が成果物に見当たらない所 → 成果物のその辺り。成果物の字(この旧版のページの範囲)が旧版に当たらない所 → 旧版のその辺り
      if (PC.ocrAvailable && PC.ocrAvailable() && pr.T) {
        const toNew = missAreas(A, blocks, pr.T), hit = new Set(blocks.flatMap(b => b.ops.filter(x => x.length === 3).map(x => x[2]))), R = pr.region, inv = PC.invT(pr.T);
        //   成果物の字のうち、この旧版のページの範囲にあって旧版に当たらない字の続き(まとまりごと)
        const inR = c => { const [x, y] = PC.center(c.box); return R && x >= R[0] && x <= R[2] && y >= R[1] && y <= R[3]; }, toOld = [];
        let run = [];
        const flush = () => { if (run.length) toOld.push({ box: PC.mapBox(inv, PC.union(run.map(c => c.box))), text: run.map(c => c.c).join('') }); run = []; };
        o.B.chars.forEach((c, j) => { if (!c.ocr && !hit.has(j) && !snap[j] && inR(c)) { if (run.length && run[run.length - 1].it !== c.it) flush(); run.push(c); } else flush(); });
        flush();
        const addN = toNew.length ? await PC.ocrAugment(newDoc, pr.q, o.B, null, toNew, s => prog(`成果物 ${pr.q + 1}ページ目：${s}`)) : 0;
        const addO = toOld.length ? await PC.ocrAugment(oldDoc, p, A, null, toOld, s => prog(`旧版 ${p + 1}ページ目：${s}`)) : 0;
        if (addN || addO) {
          if (NQ.has(pr.q)) growUsed(NQ.get(pr.q));
          o.used = grow(snap, o.B.chars.length); o.st = grow(o.st, o.B.chars.length);
          blocks = PC.collatePage(A, o.B, opt, o.used, new Set());
        }
      }
      if (pr.same && pr.T) posFirst(A, o.B, blocks, pr.T, o.used, snap);   // 同じレイアウト: 同じ位置の同じ字を、並びより先に対応づける
      const eq = [];   // 同じ字と対応づいた組(旧版の字の枠, 成果物の字の枠)
      for (const b of blocks) {
        let run = [];
        for (const op of [...b.ops, ['|']]) {
          //   st 3: 書き方だけ違う字(全角・半角など。旧版から変わった所として、分けて出す)。oc: 置き換わる前の旧版の字
          if (op.length === 3) { o.st[op[2]] = op[0] === '=' ? 1 : op[0] === '~' ? 3 : 2; if (op[0] !== '=') o.oc[op[2]] = A.chars[b.s + op[1]].c; }
          if (op[0] === '=') eq.push([A.chars[b.s + op[1]].box, o.B.chars[op[2]].box]);
          if (op[0] === '-') { run.push(b.s + op[1]); continue; }
          //   at: 消えた字の直後の成果物の字(旧版にない字が続くときはその字。数字のまとまりの中で消えた字を、同じ件に入れるため)
          if (run.length) o.gone.push({ p, cs: run.map(i => A.chars[i]), T: pr.T, vert: !!(A.items[A.chars[run[0]].it] || {}).vert, near: op.length === 3 ? o.B.chars[op[2]].box : null, at: op.length === 3 ? op[2] : op[0] === '+' ? op[1] : -1 });
          run = [];
        }
      }
      // 区間の終わりで消えた数字(続く成果物の字がなく at がない。「29」→「30」の「29」)は、写した位置に重なる成果物の旧版にない数字を at にする
      //   (数字のまとまりの中の違いとして、同じ件に入れるため)
      if (pr.T) for (const g of o.gone) {
        if (g.p !== p || g.at >= 0 || !g.cs.every(c => PC.NUMC.test(c.c))) continue;
        const mb = PC.mapBox(pr.T, PC.union(g.cs.map(c => c.box))), h = Math.max(1, Math.min(mb[3] - mb[1], mb[2] - mb[0]));
        let bd = Infinity;
        o.B.chars.forEach((c, j) => {
          if (o.st[j] === 1 || !PC.DIGC.test(c.c)) return;
          const oy = Math.min(c.box[3], mb[3]) - Math.max(c.box[1], mb[1]), ox = Math.min(c.box[2], mb[2]) - Math.max(c.box[0], mb[0]);
          if (oy < 0.5 * Math.min(mb[3] - mb[1], c.box[3] - c.box[1]) && ox < 0.5 * Math.min(mb[2] - mb[0], c.box[2] - c.box[0])) return;   // 同じ行(縦組みは同じ列)の字だけ
          const d = PC.gap(c.box, mb);
          if (d <= h && d < bd) { bd = d; g.at = j; }
        });
      }
      //   位置合わせを、同じ字と対応づいた組で求め直す(Tr。見た目の比べ合わせ・パタパタ表示に使う)。同じ字で位置が動いた組は、
      //   見た目の違いを字の移動として説明するのに使う(o.moved: 旧版の位置を写した枠と成果物の枠)
      if (pr.same) pr.Tr = refineT(eq);
      //   字が少なくて字で位置を合わせられないページ(同じ字の組が10組未満)は、画像のずらし方で合わせる
      let img = false;
      if (pr.same && !pr.Tr && eq.length < 10) { pr.Tr = await imageShift(oldDoc, p, newDoc, pr.q, pr.T); img = !!pr.Tr; }
      const Tm = pr.Tr || pr.T;
      if (Tm) for (const [ob, nb] of eq) { const mb = PC.mapBox(Tm, ob); if (mb.some((v, t) => Math.abs(v - nb[t]) > 0.3)) { o.moved.push(mb, nb); o.movedP.push(p); } }   // movedP: その字の旧版のページ
      o.maps.push({ p, T: pr.T, Tr: pr.Tr || null, img });
      await PC.tick();
    }
    for (const o of out.values()) slideNew(o.B.chars, o.st);
    return { pairs, byQ: out };
  }
  // 文字データのないページの位置合わせ: 旧版と成果物を 50dpi で描いた灰色の画像を、ページの対応づけの変換(T)の平行移動のまわり
  //   ±9画素(約±13pt)でずらし、重なる所の差の平均がいちばん小さいずらし方を求める(2画素おきに見る)。大きさ・向きが変わったページは null
  //   (細かいずれは、見た目の比べ合わせの前に 200dpi で詰める: fineShift)。返り値は平行移動の変換 [1, 0, tx, ty, 1](pt)
  async function imageShift(oldDoc, p, newDoc, q, T) {
    if (!T || Math.abs(PC.scaleOf(T) - 1) > 0.01 || Math.abs(T[1]) > 0.01 || Math.abs(PC.aspectOf(T) - 1) > 0.01) return null;
    const D = 50, r = D / 72, A = await PC.renderPage(oldDoc, p, D, false), B = await PC.renderPage(newDoc, q, D, false);
    const gray = im => { const g = new Uint8Array(im.w * im.h); for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (im.d[j] * 77 + im.d[j + 1] * 150 + im.d[j + 2] * 29) >> 8; return g; };
    const ga = gray(A), gb = gray(B), cx = Math.round(T[2] * r), cy = Math.round(T[3] * r), R = 9;
    let best = null, bc = Infinity;
    for (let dy = cy - R; dy <= cy + R; dy++) for (let dx = cx - R; dx <= cx + R; dx++) {
      let c = 0, n = 0;   // 成果物の (x, y) と旧版の (x - dx, y - dy)
      for (let y = Math.max(0, dy); y < Math.min(B.h, A.h + dy); y += 2) for (let x = Math.max(0, dx); x < Math.min(B.w, A.w + dx); x += 2) { c += Math.abs(gb[y * B.w + x] - ga[(y - dy) * A.w + x - dx]); n++; }
      if (n >= 0.125 * B.w * B.h && c / n < bc) { bc = c / n; best = [dx, dy]; }
    }
    return best ? [1, 0, best[0] / r, best[1] / r, 1] : null;
  }
  //   200dpi で、画像のずらし方を ±4画素詰める(差の平均がいちばん小さい所。4画素おきに見る)
  function fineShift(OI, NW, Tr) {
    const k = PC.S, cx = Math.round(Tr[2] * k), cy = Math.round(Tr[3] * k), A = OI.d, B = NW.d;
    let best = [cx, cy], bc = Infinity;
    for (let dy = cy - 4; dy <= cy + 4; dy++) for (let dx = cx - 4; dx <= cx + 4; dx++) {
      let c = 0, n = 0;
      for (let y = Math.max(0, dy); y < Math.min(NW.h, OI.h + dy); y += 4) for (let x = Math.max(0, dx); x < Math.min(NW.w, OI.w + dx); x += 4) { const i = 4 * (y * NW.w + x), j = 4 * ((y - dy) * OI.w + x - dx); c += Math.abs(B[i] - A[j]) + Math.abs(B[i + 1] - A[j + 1]) + Math.abs(B[i + 2] - A[j + 2]); n++; }
      if (n && c / n < bc) { bc = c / n; best = [dx, dy]; }
    }
    return [1, 0, best[0] / k, best[1] / k, 1];
  }
  // 位置合わせを、同じ字と対応づいた組(旧版の枠, 成果物の枠。pt)で求め直す。ページの対応づけの変換(pr.T)は、ページの手がかり全体に
  //   合わせたおおよそのもので、文章の送りで動いた字にも引っぱられる(配置が同じなのに、横に3%縮む・本文の分だけ上下にずれる、など)。
  //   ・動いていない組(旧版と同じ位置に 0.3pt 以内でそろう組)が、組の5%以上(5組以上)あれば、位置はそのまま(見出し・枠の文字など、
  //     動いていない字がある。文章の送りで本文の多くが動いても、ページの配置は変わっていない)
  //   ・なければ、組の動き(成果物の中心 − 旧版の中心)のうち、いちばん多い動きに 0.3pt 以内でそろう組が、組の3割以上(10組以上)あれば、
  //     その平行移動(ページ全体がずれた版。塗り足しの違いなど)
  //   どちらも、そろう組の動きの平均を返す。なければ null(大きさが変わったページなど。確かな位置合わせがないとする)
  function refineT(eq) {
    if (eq.length < 10) return null;
    const D = eq.map(([a, b]) => [(b[0] + b[2] - a[0] - a[2]) / 2, (b[1] + b[3] - a[1] - a[3]) / 2]), bins = new Map(), key = (x, y) => x + ',' + y;
    const mean = S => [1, 0, S.reduce((s, d) => s + d[0], 0) / S.length, S.reduce((s, d) => s + d[1], 0) / S.length, 1];
    const still = D.filter(([dx, dy]) => Math.abs(dx) <= 0.3 && Math.abs(dy) <= 0.3);
    if (still.length >= Math.max(5, 0.05 * D.length)) return mean(still);
    for (const [dx, dy] of D) { const k = key(Math.round(dx / 0.25), Math.round(dy / 0.25)); bins.set(k, (bins.get(k) || 0) + 1); }
    let best = null, bv = 0;
    for (const k of bins.keys()) {
      const [kx, ky] = k.split(',').map(Number); let v = 0;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) v += bins.get(key(kx + a, ky + b)) || 0;
      if (v > bv) { bv = v; best = [kx * 0.25, ky * 0.25]; }
    }
    const inl = D.filter(([dx, dy]) => Math.abs(dx - best[0]) <= 0.3 && Math.abs(dy - best[1]) <= 0.3);
    return inl.length >= Math.max(10, 0.3 * D.length) ? mean(inl) : null;
  }
  // 旧版にない字の続き(st が 0)を、前後の同じ字(st が 1)の上で滑らせ、かっこ・空白・字の種類・まとまりの切れ目にそろえる
  //   (「[QX-12AB]」→「[QX-12AB][QX-12AB2]」で、旧版にない字を「][QX-12AB2」でなく「[QX-12AB2]」とする。
  //   旧版の字の並びが別の所へ飛んで対応づくと、照合の中で(PC.shiftEdits)は滑らせられないため、ここでそろえる)
  //   続きは、同じまとまりの字か、すき間が字の高さの2倍までの字(同じ行に並んだ別のまとまり)
  function slideNew(C, st) {
    const N = C.length;
    const near = j => j > 0 && j < N && (C[j - 1].it === C[j].it || PC.gap(C[j - 1].box, C[j].box) <= 2 * Math.max(C[j].box[3] - C[j].box[1], C[j - 1].box[3] - C[j - 1].box[1]));
    //   切れ目のよさ: 離れた字の間(別の行・別の所)はいちばんよい。隣り合う字は、字の種類で比べる(かっこ1字ずつが別のまとまりのこともある)
    const cut = j => (j <= 0 || j >= N || !near(j) ? 4 : Math.max(C[j].sp ? 3 : 0, PC.cutScore(C[j - 1].c, C[j].c)));
    for (let s = 0; s < N; s++) {
      if (st[s] !== 0 || (s > 0 && st[s - 1] === 0 && near(s))) continue;
      let e = s + 1; while (e < N && st[e] === 0 && near(e)) e++;
      const score = t => cut(s + t) + cut(e + t);
      let best = 0, bv = score(0);
      for (let t = 1; e + t - 1 < N && st[e + t - 1] === 1 && near(e + t - 1) && C[e + t - 1].c === C[s + t - 1].c; t++) if (score(t) > bv) { bv = score(t); best = t; }
      for (let t = -1; s + t >= 0 && st[s + t] === 1 && near(s + t + 1) && C[s + t].c === C[e + t].c; t--) if (score(t) > bv) { bv = score(t); best = t; }
      if (best) { for (let j = s; j < e; j++) st[j] = 1; for (let j = s + best; j < e + best; j++) st[j] = 0; }
      s = Math.max(s, e + best - 1);
    }
  }
  // 数字のまとまり(桁区切り・小数点・時刻・日付の区切りを含む): 字の番号の範囲 [a, b) の一覧。区切りは数字にはさまれたものだけ
  //   続きは、同じまとまりの字か、すき間が字の高さの1.5倍までの字
  function numberSpans(C) {
    const out = [], N = C.length, near = (i, j) => C[i].it === C[j].it || PC.gap(C[i].box, C[j].box) <= 1.5 * Math.max(1, C[j].box[3] - C[j].box[1]);
    for (let i = 0; i < N; i++) {
      if (!PC.DIGC.test(C[i].c)) continue;
      let e = i + 1;
      while (e < N && near(e - 1, e) && (PC.DIGC.test(C[e].c) || (PC.NUMC.test(C[e].c) && e + 1 < N && PC.DIGC.test(C[e + 1].c) && near(e, e + 1)))) e++;
      out.push([i, e]); i = e - 1;
    }
    return out;
  }
  // ---- 文字データのない文字(図形として描かれた文字・ロゴ)の所: 文字としては確かめていない所の一覧(PC.vectorSpots) ----
  //   見た目で比べたページ(同じレイアウトの原稿・紙の赤字原稿)は、その所の見た目の違いを比べてあるので出さない。
  //   原稿と文字で比べたページ(データ・ラフの原稿)と、原稿の当たらない所で、文字データのない文字のある所を、ページごとに1件(d.unread)にする。
  //   原稿の当たらない所は、旧版のページと大きさ・位置がそろっていれば、その所の図形(輪郭と塗りの色)を旧版と成果物で突き合わせる:
  //   同じなら出さない(前回のまま)。違えば「旧版から見た目が変わった所」(d.shapes。文字データがないので、文字では比べられない変化)
  async function shapeSpots(P, newDoc, JP, OLD, step) {
    const VIS = new Set(['annot', 'scan', 'scan3']), k = PC.S, odoc = OLD && OLD.doc;
    const exactT = T => T && Math.abs(T[0] - 1) < 1e-3 && Math.abs(T[1]) < 1e-3 && Math.abs(T[2]) < 0.2 && Math.abs(T[3]) < 0.2 && Math.abs((T.length > 4 ? T[4] : T[0]) - 1) < 1e-3;
    //   旧版と成果物の同じ所の図形の部品(輪郭ごとの範囲と塗りの色。PC.vectorParts)を突き合わせる。返り値: 変わった所(pt)の一覧(同じなら空)
    //   範囲が 0.25pt 以内でそろい、塗りの色(RGB)が 8 以内でそろう部品どうしを同じとし、相手のない部品を近いもの(3pt 以内)どうしでまとめて、変わった所にする。
    //   (描いた画素で比べると、書き出し直しで図形がわずかにずれた所や、透明の重なりの描き方がわずかに違う所も違いになり、小さな字の変化と
    //    見分けられなかった(実データのカタログ)。図形そのものを比べれば、その揺れは入らない。図形の後ろの写真などの画像は比べない)
    const partsOf = new Map(), parts = async (doc, pg, key) => { if (!partsOf.has(key)) partsOf.set(key, await PC.vectorParts(doc, pg)); return partsOf.get(key); };
    const colOk = (a, c) => { if (a === c || (a[0] === 'p' && c[0] === 'p')) return true; const u = a.split(','), v = c.split(','); return u.length === 3 && v.length === 3 && u.every((x, i) => Math.abs(+x - +v[i]) <= 8); };
    const differs = async (p, q, b, T) => {
      //   どの辺も 0.3pt に満たない部品(グラデーションを細い帯で描いた所の、見えない切れ端など)は比べない(6pt の字の点でも 0.5pt ほどある)
      const A = [b[0] - 1, b[1] - 1, b[2] + 1, b[3] + 1], inA = r => { const x = (r[0] + r[2]) / 2, y = (r[1] + r[3]) / 2; return Math.max(r[2] - r[0], r[3] - r[1]) >= 0.3 && x >= A[0] && x <= A[2] && y >= A[1] && y <= A[3]; };
      const O = (await parts(odoc, p, 'o' + p)).map(r => { const m = PC.mapBox(T, r); m.col = r.col; return m; }).filter(inA), N = (await parts(newDoc, q, 'n' + q)).filter(inA);
      const used = new Uint8Array(O.length), lone = [], E = 0.25;
      for (const r of N) {
        let hit = -1;
        for (let i = 0; i < O.length; i++) { const o = O[i]; if (!used[i] && Math.abs(o[0] - r[0]) <= E && Math.abs(o[1] - r[1]) <= E && Math.abs(o[2] - r[2]) <= E && Math.abs(o[3] - r[3]) <= E && colOk(o.col, r.col)) { hit = i; break; } }
        if (hit >= 0) used[hit] = 1; else lone.push(r);
      }
      O.forEach((r, i) => { if (!used[i]) lone.push(r); });
      if (!lone.length) return [];
      const par = lone.map((_, k) => k), find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
      for (let i = 0; i < lone.length; i++) for (let j = i + 1; j < lone.length; j++) { const u = lone[i], v = lone[j]; if (Math.max(u[0], v[0]) - Math.min(u[2], v[2]) <= 3 && Math.max(u[1], v[1]) - Math.min(u[3], v[3]) <= 3) par[find(j)] = find(i); }
      const g = new Map(); lone.forEach((r, k) => { const x = find(k); if (!g.has(x)) g.set(x, []); g.get(x).push(r); });
      return [...g.values()].map(rs => { const u = PC.union(rs); return [u[0] - 1, u[1] - 1, u[2] + 1, u[3] + 1]; });
    };
    let total = 0, changed = 0;
    for (let q = 0; q < newDoc.numPages; q++) {
      if (P.some(d => d.q === q && VIS.has(d.kind) && !d.crop)) continue;   // ページ全体を見た目で比べてある(探さない)
      const B = JP[q] ? JP[q].B : await PC.pageText(newDoc, q), S = await PC.vectorSpots(newDoc, q, B);
      if (!S.length) continue;
      step(q / newDoc.numPages);
      const ds = P.filter(d => d.q === q && d.kind !== 'none'), op = OLD ? OLD.pairs.findIndex(x => x.q === q && x.same && exactT(x.T)) : -1;
      for (const sp of S) {
        const [x, y] = PC.center(sp.box), inR = R => !R || (x >= R[0] && x <= R[2] && y >= R[1] && y <= R[3]);
        const d0 = ds.find(d => d.kind !== 'newonly' && inR(d.kind === 'content' ? d.pr.region : d.kind === 'records' ? d.cov : d.crop));
        if (d0 && VIS.has(d0.kind)) continue;   // 見た目で比べてある
        const inSp = c => { const [cx, cy] = PC.center(c.box); return cx >= sp.box[0] && cx <= sp.box[2] && cy >= sp.box[1] && cy <= sp.box[3]; };
        if (B.chars.some(c => c.ocr && inSp(c))) continue;   // OCRで読んで比べてある
        let why = d0 ? 'src' : OLD ? 'old' : 'none', diff = null;
        if (!d0 && op >= 0) { diff = await differs(op, q, sp.box, OLD.pairs[op].T); if (!diff.length) continue; }   // 旧版と同じ図形(前回のまま)
        //   項目を付ける結果のページ: 原稿と文字で比べたページ、なければ成果物のそのページを表示しているページ、なければ「成果物だけ」のページを足す
        let d = d0 || ds.find(d => d.kind === 'newonly') || ds.find(d => !d.crop || inR(d.crop));
        if (!d) {
          d = { kind: 'newonly', q, src: null, label: null, ch: [], im: [], an: [], notes: [], restBoxes: [], ot: [], nt: [], pairs: [], oc: [], nc: [], extra: [], thumbs: { left: null, right: await toThumb(await PC.renderPage(newDoc, q, PC.DPI, false)) } };
          P.push(d); ds.push(d);
        }
        const o = d.crop ? [d.crop[0], d.crop[1]] : [0, 0], px = b => [(b[0] - o[0]) * k, (b[1] - o[1]) * k, (b[2] - o[0]) * k, (b[3] - o[1]) * k];
        if (diff) { for (const db of diff) { (d.shapes || (d.shapes = [])).push({ nbox: px(db), old: { p: op, box: db.map(v => v * k), M: pxM(OLD.pairs[op].T, o) } }); changed++; } continue; }
        (d.unread || (d.unread = { why, boxes: [] })).boxes.push(px(sp.box)); total++;
      }
    }
    return { total, changed };
  }

  // 旧版から変わった所のうち、どの原稿も当たらない部分のもの(指示にない変更)を、結果のページに付ける
  //   成果物に字がある変化(旧版にない字)は、原稿のあるページでは「原稿にない文字」として出ているので、ここでは
  //   旧版から消えた字と、原稿がまったく当たらないページの旧版にない字を出す
  async function oldChanges(P, OLD, newDoc) {
    const k = PC.S, px = b => b.map(v => v * k);
    for (const [q, o] of OLD.byQ) {
      const ds = P.filter(d => d.q === q && d.kind !== 'none' && d.kind !== 'newonly');
      const covered = b => { const [x, y] = PC.center(b); return ds.some(d => { const R = d.kind === 'content' ? d.pr.region : d.kind === 'records' ? d.cov : d.crop || [0, 0, 1e9, 1e9]; return R && x >= R[0] && x <= R[2] && y >= R[1] && y <= R[3]; }); };
      const items = [], dels = [], noContent = !ds.some(d => d.kind === 'content');
      // 数字のまとまりの中の違いは、まとまり全体を1件にする(「4,730」→「5,060」を「4→5」「730→060」の2件にしない)。
      //   数字のまとまりの中(と直後)で消えた旧版の数字・区切りも、同じ件に入れる(goneIn: 成果物の字の番号 → その前で消えた字)
      const C = o.B.chars, spans = noContent ? numberSpans(C) : [], spanOf = new Int32Array(C.length).fill(-1), goneIn = new Map();
      spans.forEach(([a, b], s) => { for (let j = a; j < b; j++) spanOf[j] = s; });
      const spanAt = j => (j >= 0 && j < C.length && spanOf[j] >= 0 ? spanOf[j] : j > 0 && spanOf[j - 1] >= 0 ? spanOf[j - 1] : -1);
      for (const g of o.gone) {
        if (g.taken) continue;   // 原稿のない部分の数字の件に入れたもの(leftovers)
        const ob = PC.union(g.cs.map(c => c.box)), text = g.cs.map(c => c.c).join('');   // 記号だけが消えたもの(「※」など)も出す
        if (noContent && g.at >= 0 && [...text].every(c => PC.NUMC.test(c)) && spanAt(g.at) >= 0) { goneIn.set(g.at, (goneIn.get(g.at) || '') + text); continue; }
        //   消えた字の位置(並びより位置を先に使う):
        //   ・旧版と成果物でページの大きさ・位置がそろっている(写し方がずれなし)なら、旧版でその字があった所(mb)
        //   ・そろっていなければ、成果物で続く字(near)の前。ただし near が、mb と同じ行(縦組みは同じ列)の近くにないとき
        //     (行の終わりで消えた字の続きが、次の行の頭の字に対応づいたときなど)は mb
        //   写し方は、同じ字の組で求め直した位置合わせ(Tr)があればそれ(ページの対応づけの変換は、文章の送りに引っぱられることがある)
        const T = (OLD.pairs[g.p] && OLD.pairs[g.p].Tr) || g.T, mb = T ? PC.mapBox(T, ob) : null, along = (a, b) => (g.vert ? [a[1], a[3], b[1], b[3], a[0], a[2], b[0], b[2]] : [a[0], a[2], b[0], b[2], a[1], a[3], b[1], b[3]]);
        const ident = T && Math.abs(T[0] - 1) < 0.01 && Math.abs(T[1]) < 0.01 && Math.abs(T[2]) < 3 && Math.abs(T[3]) < 3 && Math.abs((T.length > 4 ? T[4] : T[0]) - 1) < 0.01;
        const nearOk = n => { if (!mb) return true; if (ident) return false; const [a0, a1, b0, b1, c0, c1, d0, d1] = along(n, mb), h = Math.max(1, Math.min(c1 - c0, d1 - d0)); return Math.min(c1, d1) - Math.max(c0, d0) >= 0.5 * h && Math.max(a0 - b1, b0 - a1) <= 2 * Math.max(c1 - c0, d1 - d0); };
        const nb = g.near && nearOk(g.near) ? [g.near[0] - 1, g.near[1], g.near[0] + 1, g.near[3]] : mb || PC.mapBox(T, ob);
        if (covered(nb)) continue;
        const it = { kind: 'del', text, segs: [['-', text]], nbox: nb, old: { p: g.p, box: px(ob), T }, ocr: g.cs.some(c => c.ocr) };
        if (noContent && C.length) dels.push({ it, at: g.at }); else items.push(it);   // 原稿のないページは、あとで段落ごとにまとめる(at: 並びの位置)
      }
      if (noContent) {   // 原稿がまったく当たらないページ(または同じレイアウトの原稿の外): 旧版にない字の続き
        // 違いのある数字のまとまりは、まとまり全体を続きに入れる
        const hot = new Set();
        spans.forEach(([a, b], s) => { for (let j = a; j < b; j++) if (o.st[j] !== 1) hot.add(s); for (let j = a; j <= b; j++) if (goneIn.has(j)) hot.add(s); });
        const inRun = j => o.st[j] !== 1 || (spanOf[j] >= 0 && hot.has(spanOf[j]));
        let run = [];
        const push = (segs, t, s) => { const g = segs[segs.length - 1]; if (g && g[0] === t) g[1] += s; else segs.push([t, s]); };
        const spots = [];   // 違いの所(字の続き・消えた字)。あとで段落(まとまり)ごとにまとめる
        const flush = () => {
          if (run.length && run.some(j => o.st[j] !== 1) || run.some(j => goneIn.has(j)) || (run.length && goneIn.has(run[run.length - 1] + 1))) {   // 記号だけの変化(「、」→「。」など)も出す
            const nb = PC.union(run.map(j => C[j].box)), m = o.maps.find(x => !x.noText) || o.maps[0];   // 旧版の切り抜きは、文字データのある旧版のページから
            // 前後の同じ字(同じまとまりの6字まで)を添え、置き換わった字は旧版の字→成果物の字で示す
            const it = C[run[0]].it, core = [];
            const pre = []; for (let j = run[0] - 1; j >= 0 && pre.length < 6 && C[j].it === it && o.st[j] === 1; j--) pre.unshift(C[j].c);
            const last = run[run.length - 1], post = []; for (let j = last + 1; j < C.length && post.length < 6 && C[j].it === it && o.st[j] === 1; j++) post.push(C[j].c);
            for (const j of run) {
              if (j !== run[0] && (C[j].sp || C[j].it !== C[j - 1].it) && PC.DIGC.test(C[j].c) && PC.DIGC.test(C[j - 1].c)) push(core, '=', ' ');   // 空白・まとまりの切れ目をはさむ数字どうし(日付と時刻など)は、空白で分けて示す
              if (goneIn.has(j)) push(core, '-', goneIn.get(j));
              if (o.st[j] === 1) push(core, '=', C[j].c);
              else { if (o.st[j] >= 2 && o.oc[j]) push(core, '-', o.oc[j]); push(core, '+', C[j].c); }
            }
            if (goneIn.has(last + 1) && spanAt(last + 1) >= 0 && spanOf[last + 1] !== spanOf[last]) push(core, '-', goneIn.get(last + 1));
            const segs = [];
            for (const [t, x] of [...(pre.length ? [['=', pre.join('')]] : []), ...core, ...(post.length ? [['=', post.join('')]] : [])]) push(segs, t, x);
            const kind = segs.some(g => g[0] === '+') ? 'add' : 'del', variant = run.every(j => o.st[j] === 1 || o.st[j] === 3) && !run.some(j => goneIn.has(j)) && !goneIn.has(last + 1);   // 書き方だけの変化
            if (!covered(nb)) spots.push({ a: run[0], z: last, item: { kind, variant, text: run.map(j => C[j].c).join(''), segs, nbox: nb, old: m ? { p: m.p, box: px(PC.mapBox(PC.invT(m.Tr || m.T), nb)), T: m.Tr || m.T } : null, ocr: run.some(j => C[j].ocr) } });
          }
          run = [];
        };
        C.forEach((c, j) => { if (inRun(j)) { if (run.length && (C[run[run.length - 1]].it !== c.it && PC.gap(C[run[run.length - 1]].box, c.box) > 2 * (c.box[3] - c.box[1]) || run[run.length - 1] !== j - 1)) flush(); run.push(j); } else flush(); });
        flush();
        //   段落(まとまり。PC.blocksOf)ごとにまとめる: 同じ段落に違いの所が2つ以上あれば1件にし、その中に旧→新を所ごとに示す
        //   (書き直した段落が、字の続きごとに何件にも分かれると、確かめて直す手間が増え、見逃しやすくなるため)。1つだけの段落は、これまでと同じ1件
        const blk = new Int32Array(C.length).fill(-1), BL = PC.blocksOf(C, o.B.items);
        BL.forEach(([s0, e0], b) => { for (let j = s0; j < e0; j++) blk[j] = b; });
        //   消えた字の置き場所(成果物の字の番号。その字の前で消えた): 字の並びの比べ合わせで分かる位置(at)。ただし、その字が、印の位置にいちばん近い字と
        //   別の段落なら(段落の終わりで消えた字の続きが、次の段落の頭に当たったときなど)、近い字の前か後ろ。字の高さの3倍より離れていれば、まとめず1件のまま
        const delAt = new Map(), addDel = (j, t) => delAt.set(j, [...(delAt.get(j) || []), t]);
        for (const [j, t] of goneIn) addDel(j, t);
        for (const { it, at } of dels) {
          const [x, y] = PC.center(it.nbox); let n = -1, bd = Infinity;
          C.forEach((c, i) => { const [cx, cy] = PC.center(c.box), dd = Math.hypot(cx - x, cy - y); if (dd < bd) { bd = dd; n = i; } });
          const h = n >= 0 ? Math.max(1, Math.min(C[n].box[3] - C[n].box[1], C[n].box[2] - C[n].box[0])) : 1;
          if (n < 0 || bd > 3 * h) { items.push(it); continue; }
          let j = at;
          if (!(j >= 0 && j < C.length && blk[j] === blk[n])) { const cn = PC.center(C[n].box), vert = (o.B.items[C[n].it] || {}).vert; j = (vert ? y <= cn[1] : x <= cn[0]) ? n : n + 1; }
          addDel(j, it.text);
          spots.push({ a: j, z: j - 1, item: it, del: true, b: blk[Math.min(j, C.length - 1)] });
        }
        for (const sp of spots) if (!sp.del) sp.b = blk[sp.a];
        const groups = new Map();
        for (const sp of spots) (groups.get(sp.b) || groups.set(sp.b, []).get(sp.b)).push(sp);
        //   並びでとなりの段落どうしで、近いもの(行の間が字の大きさの1.5倍以内で、横組みは横に、縦組みは縦に3割以上重なる)は、同じ件にまとめる
        //   (見出しとその本文、続く項目などを書き直した所が、段落ごとに何件にも分かれないように)
        const bbox = b => PC.union(C.slice(BL[b][0], BL[b][1]).map(c => c.box)), csz = b => { const x = C[BL[b][0]].box; return Math.min(x[2] - x[0], x[3] - x[1]) || 1; };
        const vertB = b => !!(o.B.items[C[BL[b][0]].it] || {}).vert;
        const nearB = (a, c) => {
          if (vertB(a) !== vertB(c)) return false;
          const A = bbox(a), B = bbox(c), h = 1.5 * Math.max(csz(a), csz(c)), v = vertB(a);
          const gap = v ? Math.max(A[0], B[0]) - Math.min(A[2], B[2]) : Math.max(A[1], B[1]) - Math.min(A[3], B[3]);
          const ov = v ? Math.min(A[3], B[3]) - Math.max(A[1], B[1]) : Math.min(A[2], B[2]) - Math.max(A[0], B[0]), wd = v ? Math.min(A[3] - A[1], B[3] - B[1]) : Math.min(A[2] - A[0], B[2] - B[0]);
          return gap <= h && ov >= 0.3 * wd;
        };
        const runs = [];
        for (const b of [...groups.keys()].sort((x, y) => x - y)) {
          const last = runs[runs.length - 1];
          if (b >= 1 && last && last[last.length - 1] === b - 1 && nearB(b - 1, b)) last.push(b); else runs.push([b]);
        }
        for (const bs of runs) {
          const g = bs.flatMap(b => groups.get(b)), b = bs[0], bz = bs[bs.length - 1];
          if (g.length === 1) { items.push(g[0].item); continue; }
          //   旧→新は、段落の中の最初の違いから最後の違いまでを、字ごとに組み立てる(消えた字は並びの位置に。変わっていない字はそのまま。段落の境は全角の空白で示す)
          const a0 = Math.min(...g.map(sp => sp.a)), z0 = Math.max(...g.map(sp => sp.z)), segs = [];
          const pre = []; for (let j = a0 - 1; j >= 0 && pre.length < 6 && blk[j] === b && o.st[j] === 1; j--) pre.unshift(C[j].c);
          const post = []; for (let j = z0 + 1; j < C.length && post.length < 6 && blk[j] === bz && o.st[j] === 1 && !delAt.has(j); j++) post.push(C[j].c);
          if (pre.length) push(segs, '=', pre.join(''));
          for (let j = a0; j <= z0; j++) {
            if (j !== a0 && blk[j] !== blk[j - 1]) push(segs, '=', '　');
            if (j !== a0 && (C[j].sp || C[j].it !== C[j - 1].it) && PC.DIGC.test(C[j].c) && PC.DIGC.test(C[j - 1].c)) push(segs, '=', ' ');
            for (const t of delAt.get(j) || []) push(segs, '-', t);
            if (o.st[j] === 1) push(segs, '=', C[j].c);
            else { if (o.st[j] >= 2 && o.oc[j]) push(segs, '-', o.oc[j]); push(segs, '+', C[j].c); }
          }
          for (const t of delAt.get(z0 + 1) || []) push(segs, '-', t);
          if (post.length) push(segs, '=', post.join(''));
          const its = g.sort((p, q) => p.a - q.a).map(sp => sp.item), olds = its.map(x => x.old).filter(Boolean), p0 = olds.length ? olds[0].p : null;
          items.push({
            kind: segs.some(x => x[0] === '+') ? 'add' : 'del', variant: its.every(x => x.variant), text: its.map(x => x.text).join('…'),
            segs, nbox: PC.union(its.map(x => x.nbox)), pnb: its.map(x => x.nbox), spots: g.length,
            old: olds.length ? { p: p0, box: PC.union(olds.filter(x => x.p === p0).map(x => x.box)), T: olds[0].T } : null, ocr: its.some(x => x.ocr),
          });
        }
      }
      for (const x of items) {
        let d = ds.find(d => !d.crop) || ds.find(d => d.crop && PC.center(x.nbox)[0] >= d.crop[0] && PC.center(x.nbox)[0] <= d.crop[2]) || P.find(e => e.kind === 'newonly' && e.q === q);
        if (!d) {
          const img = await PC.renderPage(newDoc, q, PC.DPI, false);
          d = { kind: 'newonly', q, src: null, label: null, ch: [], im: [], an: [], notes: [], restBoxes: [], ot: [], nt: [], pairs: [], oc: [], nc: [], extra: [], thumbs: { left: null, right: await toThumb(img) } };
          P.push(d);
        }
        const o0 = d.crop ? [d.crop[0], d.crop[1]] : [0, 0];
        const rel = b => [(b[0] - o0[0]) * k, (b[1] - o0[1]) * k, (b[2] - o0[0]) * k, (b[3] - o0[1]) * k];
        (d.olds || (d.olds = [])).push({ ...x, nbox: rel(x.nbox), pnb: x.pnb ? x.pnb.map(rel) : null, old: x.old && { p: x.old.p, box: x.old.box, M: pxM(x.old.T, o0) } });
      }
    }
  }

  // ---- 旧版から見た目が変わった所(写真・図版・色・線など。文字以外の変化) ----
  //   旧版のページの描画を、照合で求めた位置合わせ(T: 旧版の pt → 成果物の pt)で成果物のページに重ね、色の違う画素のうち、
  //   文字の変化(旧版にない字・置き換わった字・消えた字)と字の移動(同じ字で位置が動いたもの)で説明できないものを、変わった所とする。
  //   ・違う画素: どれかの色の差が 40 を超え、相手の 3×3 画素のどの色の範囲(±40)にも入らない画素(1〜2画素のずれ・字や線のふちの
  //     ぼかしの違い・写真の圧縮のゆらぎは、違いにしない。細い線が消えた・足された所は、相手の側のまわりに同じ色がないので違いになる)
  //   ・説明: 変わった字・動いた字の枠のまわり(字の高さの 0.35 倍、3〜12画素)の違いは数えない。動いていない同じ字は説明に使わない
  //     (字の色・書体だけを変えた所を見逃さないように)。図形の文字で旧版から見た目が変わった所(shapeSpots)も、そこで出ているので数えない
  //   ・まとまり: 近い違い(4画素以内)をまとめ、違う画素が 20 以上のまとまりを1件にする(小さなちらつきは出さない)
  //   原稿を成果物に重ねて見た目で比べたページの範囲(注釈PDF・スキャン)は、原稿との比べ合わせで出ているので除く
  const LOOK_TOL = 40, LOOK_MIN = 20;
  //   成果物の書き込み(ピンクの帯に白抜きの字。PC.designerNotes)の帯の画素: 書き込みの字のまとまりの枠の中のピンクの画素から、
  //   つながったピンクの画素をたどる(帯は「成果物の書き込み」の項目で出ているので、見た目の違いには数えない。帯の下の写真などは数える)
  const isPink = (d, j) => { const r = d[j], g = d[j + 1], b = d[j + 2]; return r >= 170 && g <= 110 && b >= 50 && r - g >= 120; };
  function pinkBands(NW, B) {
    const k = PC.S, w = NW.w, h = NW.h, d = NW.d, out = new Uint8Array(w * h), st = [];
    for (const idx of PC.designerNotes(B, NW, k)) {
      const b = B.items[idx].box, x0 = Math.max(0, Math.floor(b[0] * k)), y0 = Math.max(0, Math.floor(b[1] * k)), x1 = Math.min(w, Math.ceil(b[2] * k)), y1 = Math.min(h, Math.ceil(b[3] * k));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * w + x; if (!out[i] && isPink(d, 4 * i)) { out[i] = 1; st.push(i); } }
    }
    while (st.length) {
      const i = st.pop(), x = i % w, y = (i - x) / w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const u = x + dx, v = y + dy; if (u < 0 || v < 0 || u >= w || v >= h) continue;
        const j = v * w + u; if (!out[j] && isPink(d, 4 * j)) { out[j] = 1; st.push(j); }
      }
    }
    return out;
  }
  function lookDiff(OI, NW, T, R, ex, skip) {
    const k = PC.S, w = NW.w, h = NW.h, inv = PC.invT(T), ow = OI.w, oh = OI.h, nd = NW.d, od = OI.d;
    const exact = Math.abs(T[0] - 1) < 1e-3 && Math.abs(T[1]) < 1e-3 && Math.abs(T[2]) < 0.2 && Math.abs(T[3]) < 0.2 && Math.abs((T.length > 4 ? T[4] : T[0]) - 1) < 1e-3;
    const x0 = R ? Math.max(0, Math.floor(R[0] * k)) : 0, y0 = R ? Math.max(0, Math.floor(R[1] * k)) : 0, x1 = R ? Math.min(w, Math.ceil(R[2] * k)) : w, y1 = R ? Math.min(h, Math.ceil(R[3] * k)) : h;
    //   旧版を成果物の画素へ写す(ずれなく重なるときはそのまま。それ以外は近い4画素から求める)。旧版の外は比べない(ok = 0)
    const O = new Uint8ClampedArray(w * h * 4), ok = new Uint8Array(w * h), a = inv[0], b = inv[1], d = T.length > 4 ? inv[4] : inv[0], tx = k * inv[2], ty = k * inv[3];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const X = a * x - b * y + tx, Y = b * x + d * y + ty, i = y * w + x;
      if (exact) {
        const u = Math.round(X), v = Math.round(Y); if (u < 0 || v < 0 || u >= ow || v >= oh) continue;
        const s = (v * ow + u) * 4; O[4 * i] = od[s]; O[4 * i + 1] = od[s + 1]; O[4 * i + 2] = od[s + 2]; ok[i] = 1; continue;
      }
      if (X < 0 || Y < 0 || X > ow - 1 || Y > oh - 1) continue;
      const u = Math.min(ow - 2, Math.floor(X)), v = Math.min(oh - 2, Math.floor(Y)), fx = X - u, fy = Y - v, s = (v * ow + u) * 4, s2 = s + ow * 4;
      for (let c = 0; c < 3; c++) O[4 * i + c] = (od[s + c] * (1 - fx) + od[s + 4 + c] * fx) * (1 - fy) + (od[s2 + c] * (1 - fx) + od[s2 + 4 + c] * fx) * fy;
      ok[i] = 1;
    }
    //   違う画素: 差が大きい画素だけ、相手の 5×5 の色の範囲を見る(2画素＝約0.25mm 以内のずれは違いにしない)
    const m = new Uint8Array(w * h), RN = 2, outside = (P, Q, x, y, i) => {
      for (let c = 0; c < 3; c++) {
        let lo = 255, hi = 0;
        for (let yy = Math.max(y0, y - RN); yy <= Math.min(y1 - 1, y + RN); yy++) for (let xx = Math.max(x0, x - RN); xx <= Math.min(x1 - 1, x + RN); xx++) { const j = yy * w + xx; if (!ok[j]) continue; const v = Q[4 * j + c]; if (v < lo) lo = v; if (v > hi) hi = v; }
        const v = P[4 * i + c]; if (v < lo - LOOK_TOL || v > hi + LOOK_TOL) return true;
      }
      return false;
    };
    //   平らか: (x, y) のまわり 5×5 の色の幅(どの色も)が FILL.flat 以下(旧版の側は、旧版の外の画素を見ない)
    const flatAt = (Q, x, y, oo) => {
      for (let c = 0; c < 3; c++) {
        let lo = 255, hi = 0;
        for (let yy = Math.max(y0, y - RN); yy <= Math.min(y1 - 1, y + RN); yy++) for (let xx = Math.max(x0, x - RN); xx <= Math.min(x1 - 1, x + RN); xx++) { const j = yy * w + xx; if (oo && !ok[j]) continue; const v = Q[4 * j + c]; if (v < lo) lo = v; if (v > hi) hi = v; }
        if (hi - lo > FILL.flat) return false;
      }
      return true;
    };
    let cnt = 0;
    const flat = new Uint8Array(w * h);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = y * w + x; if (!ok[i]) continue;
      const p = 4 * i; if (Math.abs(nd[p] - O[p]) <= LOOK_TOL && Math.abs(nd[p + 1] - O[p + 1]) <= LOOK_TOL && Math.abs(nd[p + 2] - O[p + 2]) <= LOOK_TOL) continue;
      if (outside(nd, O, x, y, i) || outside(O, nd, x, y, i)) { m[i] = 1; cnt++; if (flatAt(nd, x, y, false) && flatAt(O, x, y, true)) flat[i] = 1; }
    }
    if (!cnt) return [];
    //   文字の変化・字の移動で説明できる違いを除く
    for (const e of ex) {
      const hpx = Math.min(e[3] - e[1], e[2] - e[0]) * k, mg = Math.max(3, Math.min(12, 0.35 * hpx));
      const ex0 = Math.max(0, Math.floor(e[0] * k - mg)), ey0 = Math.max(0, Math.floor(e[1] * k - mg)), ex1 = Math.min(w, Math.ceil(e[2] * k + mg)), ey1 = Math.min(h, Math.ceil(e[3] * k + mg));
      for (let y = ey0; y < ey1; y++) m.fill(0, y * w + ex0, y * w + ex1);
    }
    //   成果物の書き込みの帯(とそのふち 2画素)も除く
    if (skip) { const sk = PC.morph(skip, w, h, 'dilate', 5, 5); for (let i = 0; i < w * h; i++) if (sk[i]) m[i] = 0; }
    //   違いを分ける(下の FILL の説明): 色が変わった所(m から除く)・長い細い線(m から除いて ln へ)・それ以外(m に残る)。
    //   分ける前の違い(m0)のまとまりも作る(移動の見分けは、これまでどおりのまとまりで行う。ページの 1/4 を超えるまとまりだけ、分けたものに置き換える)
    const m0 = m.slice(), fills = fillUnits(m, flat, nd, O, w, h, x0, y0, x1, y1, cnt);
    const lh = new Uint8Array(w * h), lv = new Uint8Array(w * h);   // 横の線・縦の線
    {
      const hl = PC.morph(m, w, h, 'open', FILL.line, 1), vl = PC.morph(m, w, h, 'open', 1, FILL.line), th = PC.morph(PC.morph(m, w, h, 'open', 7, 7), w, h, 'dilate', 3, 3);
      for (let i = 0; i < w * h; i++) if (m[i] && !th[i]) { if (hl[i]) { lh[i] = 1; m[i] = 0; } else if (vl[i]) { lv[i] = 1; m[i] = 0; } }
    }
    //   近い違いをまとめ、違う画素の数が少ないまとまりは出さない(長い細い線は、線どうしだけ 3×3 でつなぐ)
    const clusters = (M, dil) => {
      const g = PC.morph(M, w, h, 'dilate', dil, dil), cc = PC.cc(g, w, h), n = new Int32Array(cc.n), bx = Array.from({ length: cc.n }, () => [Infinity, Infinity, -1, -1]);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = y * w + x; if (!M[i]) continue;
        const l = cc.lab[i]; n[l]++; const q = bx[l]; if (x < q[0]) q[0] = x; if (y < q[1]) q[1] = y; if (x > q[2]) q[2] = x; if (y > q[3]) q[3] = y;
      }
      return { n, bx, N: cc.n, M };
    };
    //   重なる・8画素以内のまとまりは1件にする(写真・図の中の違いが、同じ色の所をはさんで分かれたもの)。
    //   ただし、細い線だけの大きなまとまり(ページのふちの枠線など。枠の中の違う画素が 2% 未満)は、それだけで1件にする
    //   (枠の範囲に、中のほかの違いを吸い込まないように)
    //   描き方の揺れを除く(実データの改訂版どうしで確かめた):
    //   ・粗く見て同じ所: 4×4画素の平均どうしで、どれかの色の差が 40 を超えるます目が3つ未満(写真の細かい網目・ぼかし・圧縮の揺れは、
    //     描き直しで画素ごとには変わるが、平均すると同じ。写真の差し替え・図の変更・移動は、平均しても違う)
    //   ・太さ3画素以下の線だけの違い(違う画素の数 ÷ 長い辺 ≦ 3。画像を細かく分けて並べた所のつなぎ目・帯の境目が、細い線として
    //     片方の版にだけ描かれる。ページのふちの枠線・折り線などの細い線だけの違いも、ここで出さない。パタパタで目で確かめる)
    //   (ます目は、違う画素を含むものだけを数える。まわりの説明済みの字の変化を数えないように)
    const coarse = (b, M) => {
      let c = 0;
      for (let y = b[1] - (b[1] % 4); y < b[3] && y + 4 <= h; y += 4) for (let x = b[0] - (b[0] % 4); x < b[2] && x + 4 <= w; x += 4) {
        const s = [0, 0, 0, 0, 0, 0]; let k2 = 0, hit = 0;
        for (let yy = y; yy < y + 4; yy++) for (let xx = x; xx < x + 4; xx++) { const i = yy * w + xx; if (!ok[i]) continue; k2++; hit |= M[i]; for (let t = 0; t < 3; t++) { s[t] += nd[4 * i + t]; s[3 + t] += O[4 * i + t]; } }
        if (hit && k2 === 16 && (Math.abs(s[0] - s[3]) > 640 || Math.abs(s[1] - s[4]) > 640 || Math.abs(s[2] - s[5]) > 640) && ++c >= 3) return true;
      }
      return false;
    };
    if (window.__pcDebug) { PC._looks = PC._looks || []; PC._fills = PC._fills || []; PC._fills.push(...fills.map(f => ({ b: f.b, n: f.n, fill: f.fill }))); }
    const cut = (list, M, dil, line) => {
      const out = [], { n, bx, N } = clusters(M, dil);
      for (let l = 1; l < N; l++) if (n[l] >= LOOK_MIN && Math.max(bx[l][2] - bx[l][0], bx[l][3] - bx[l][1]) >= 4) {
        const b = [bx[l][0], bx[l][1], bx[l][2] + 1, bx[l][3] + 1], a = (b[2] - b[0]) * (b[3] - b[1]);
        const thin = n[l] / (line === 'h' ? b[2] - b[0] : line === 'v' ? b[3] - b[1] : Math.max(b[2] - b[0], b[3] - b[1])) <= 3, co = !thin && coarse(b, M);
        if (window.__pcDebug) PC._looks.push({ b, n: n[l], thin, coarse: co, line: !!line, whole: list === 'whole' });
        if (thin || !co) continue;
        out.push({ b, n: n[l], sparse: a > 200 * 200 && n[l] < 0.02 * a });
      }
      return out;
    };
    //   分けたもの(fine)と、分ける前のまとまり(whole)
    const fine = [...cut('fine', m, 9), ...cut('fine', lh, 3, 'h'), ...cut('fine', lv, 3, 'v'), ...fills.map(f => ({ b: f.b.slice(), n: f.n, sparse: false, fill: f.fill }))];
    const cap = FILL.cap * w * h, area = b => (b[2] - b[0]) * (b[3] - b[1]), whole = cut('whole', m0, 9).filter(x => area(x.b) <= FILL.whole * w * h);
    //   分けたものを、それを含むいちばん小さい(ページの 1/4 以下の)まとまりに付ける。どれにも入らないもの(大きすぎるまとまりの中のもの)は、そのまま使う
    const wholes = whole.map(x => ({ ...x, sub: [] })), parts = wholes.slice();
    for (const f of fine) {
      let best = null;
      for (const x of wholes) if (f.b[0] >= x.b[0] - 2 && f.b[1] >= x.b[1] - 2 && f.b[2] <= x.b[2] + 2 && f.b[3] <= x.b[3] + 2 && (!best || area(x.b) < area(best.b))) best = x;
      if (best) best.sub.push(f); else parts.push(f);
    }
    //   分ける前のまとまりの色の変化(移動の見分けのあとで使う): 中の色が変わった所の一覧と、ほかの違い(写真・図・線)があるか
    for (const x of parts) if (x.sub) {
      const fs = x.sub.filter(f => f.fill).sort((p, q) => q.n - p.n), nf = fs.reduce((t, f) => t + f.n, 0);
      x.subFills = fs.map(f => ({ ...f.fill, a: area(f.b) })); x.subOther = x.sub.some(f => !f.fill) || nf < 0.9 * x.n;
    }
    //   まとめる前のまとまり(parts。移動の見分けに使う)と、まとめたもの
    const res = mergeParts(withFills(parts), cap); res.parts = parts;
    return res;
  }
  //   分ける前のまとまりに、中の色の変化を項目の情報として付ける(移動の見分けでは、分ける前のまとまりを色の面として扱わないように、あとで付ける)
  const withFills = xs => xs.map(x => (x.subFills ? { ...x, fills: x.subFills, other: x.subOther, fill: !x.subOther && x.subFills.length ? x.subFills[0] : null } : x));
  //   違いの分け方(人が見比べるときの見方): 地の色が変わった所や、ページのふちの細い線は、ページじゅうの違いを画素の上でつなぎ、
  //   ページ全体を囲む1つのまとまりになる(その中の写真・QRコード・囲みの作り替え・移動が、場所の分からない1件に埋もれる)。
  //   人は「ここは地の色が変わった」「ここは写真が変わった」と、まとまり(要素)ごとに見るので、画素も次のように分けてからまとめる:
  //   ・色が変わった所: 旧版・成果物とも、まわり 5×5 の色の幅が 24 以下(平らな面どうしで、色だけが違う)の違う画素を、となりどうしで
  //     色の変わり方(成果物 − 旧版)の差が 24 以内のものでたどる。800画素(約3.6mm角)以上のものを1か所とする(地・囲みの塗りの色の変更)
  //   ・そのふち・上の字: 色が変わった所から 6画素以内の違う画素のうち、その所の色の変わり方で説明できるもの(成果物 − 旧版 ≒ t ×(平均の
  //     変わり方)、0≦t≦1、どの色も差 40 以内。地の色だけが変わった所の、字のふち・地と囲みの境目)は、その所に入れる
  //   ・長い細い線: 縦・横に 60画素(約7.6mm)以上続く、太さ 6画素ほどまでの違い(ページのふちの線など)は、ほかの違いとつながないように
  //     線どうしだけでまとめる(細い線だけのまとまりは、これまでどおり出さない)
  //   ・それ以外(写真・図・字のふちなど): これまでどおり近いものをまとめる
  //   まとめる(1か所1件): 地の色のような大きな色の所(ページの 1/10 を超えるもの)は、変わり方の向きが近い(cos 0.9 以上)大きな色の所とだけ、
  //   24画素(約3mm)以内のものをまとめる(グラデーションの地は、場所ごとに変わり方の大きさが違う。地の色の中の写真などは別の項目にする)。
  //   それ以外は、色の所も写真・図・線の違いも区別せずに、24画素以内のものをまとめる(囲みの作り替えなどは、塗り・線・字の見た目が入り組んで
  //   変わるので、ばらばらの項目にせず1件にする)。ただし、まとめた枠がページの 1/10 を超えるならまとめない(離れた所を1件にしない)
  const FILL = { flat: 24, min: 800, tol: 24, reach: 6, line: 60, gap: 24, cos: 0.9, near: 24, cap: 0.1, whole: 0.25 };
  function fillUnits(m, flat, N, O, w, h, x0, y0, x1, y1, cnt) {
    let nF = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * w + x; if (m[i] && flat[i]) nF++; }
    if (!nF) return [];
    const lab = new Int32Array(w * h), U = [null], T = FILL.tol;
    let qu = new Int32Array(nF);
    const nbr = (i, f) => { const x = i % w, y = (i - x) / w; if (x > x0) f(i - 1); if (x + 1 < x1) f(i + 1); if (y > y0) f(i - w); if (y + 1 < y1) f(i + w); };
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const s = y * w + x; if (!m[s] || !flat[s] || lab[s]) continue;
      const id = U.length, u = { n: 0, nF: 0, b: [x, y, x, y], so: [0, 0, 0], sn: [0, 0, 0] }; U.push(u);
      let qh = 0, qt = 0; qu[qt++] = s; lab[s] = id;
      while (qh < qt) {
        const i = qu[qh++], p = 4 * i, xx = i % w, yy = (i - xx) / w;
        u.nF++; if (xx < u.b[0]) u.b[0] = xx; if (xx > u.b[2]) u.b[2] = xx; if (yy < u.b[1]) u.b[1] = yy; if (yy > u.b[3]) u.b[3] = yy;
        for (let c = 0; c < 3; c++) { u.so[c] += O[p + c]; u.sn[c] += N[p + c]; }
        const c0 = N[p] - O[p], c1 = N[p + 1] - O[p + 1], c2 = N[p + 2] - O[p + 2];
        nbr(i, j => {
          if (!m[j] || !flat[j] || lab[j]) return;
          const r = 4 * j;
          if (Math.abs(N[r] - O[r] - c0) <= T && Math.abs(N[r + 1] - O[r + 1] - c1) <= T && Math.abs(N[r + 2] - O[r + 2] - c2) <= T) { lab[j] = id; qu[qt++] = j; }
        });
      }
      u.n = u.nF;
    }
    //   小さい所(800画素未満。写真の中の平らな所など)は、色が変わった所にしない(それ以外の違いとしてまとめる)
    const big = U.map(u => !!u && u.nF >= FILL.min), cm = U.map(u => u && [0, 1, 2].map(c => (u.sn[c] - u.so[c]) / u.nF));
    //   ふち・上の字: 色が変わった所の画素から、違う画素をたどる(6画素まで)
    qu = new Int32Array(cnt); const qd = new Uint8Array(cnt);
    let qh = 0, qt = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * w + x; if (!lab[i]) continue; if (big[lab[i]]) { qu[qt] = i; qd[qt++] = 0; } else lab[i] = 0; }
    while (qh < qt) {
      const i = qu[qh], d = qd[qh++]; if (d >= FILL.reach) continue;
      const id = lab[i], c = cm[id], cc = c[0] * c[0] + c[1] * c[1] + c[2] * c[2], u = U[id];
      nbr(i, j => {
        if (!m[j] || lab[j] || qt >= cnt) return;
        const r = 4 * j, D0 = N[r] - O[r], D1 = N[r + 1] - O[r + 1], D2 = N[r + 2] - O[r + 2];
        const t = cc > 0 ? Math.min(1, Math.max(0, (D0 * c[0] + D1 * c[1] + D2 * c[2]) / cc)) : 0;
        if (Math.abs(D0 - t * c[0]) > LOOK_TOL || Math.abs(D1 - t * c[1]) > LOOK_TOL || Math.abs(D2 - t * c[2]) > LOOK_TOL) return;
        lab[j] = id; qu[qt] = j; qd[qt++] = d + 1; u.n++;
        const xx = j % w, yy = (j - xx) / w; if (xx < u.b[0]) u.b[0] = xx; if (xx > u.b[2]) u.b[2] = xx; if (yy < u.b[1]) u.b[1] = yy; if (yy > u.b[3]) u.b[3] = yy;
      });
    }
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * w + x; if (lab[i]) m[i] = 0; }
    const out = [];
    for (let id = 1; id < U.length; id++) if (big[id]) {
      const u = U[id], b = [u.b[0], u.b[1], u.b[2] + 1, u.b[3] + 1];
      if (u.n / Math.max(b[2] - b[0], b[3] - b[1]) <= 3) continue;   // 細い帯だけのもの
      out.push({ b, n: u.n, fill: { o: u.so.map(v => Math.round(v / u.nF)), n: u.sn.map(v => Math.round(v / u.nF)) } });
    }
    return out;
  }
  //   見た目の違いのまとまり({ b, sparse, fill })をまとめる(上の説明)。cap: それ以外どうしでまとめた枠の大きさの上限(画素の面積)
  //   返り値のまとまりには、まとめたもとの枠(members)を添える(項目の枠として、違う所ごとに描く)
  function mergeParts(xs, cap) {
    const out = xs.map(x => ({ ...x, b: x.b.slice(), members: x.members || [x.b.slice()] })), area = b => (b[2] - b[0]) * (b[3] - b[1]);
    const near = (p, q, g) => Math.max(p[0], q[0]) - Math.min(p[2], q[2]) <= g && Math.max(p[1], q[1]) - Math.min(p[3], q[3]) <= g;
    const chg = f => [0, 1, 2].map(c => f.n[c] - f.o[c]), len = v => Math.hypot(v[0], v[1], v[2]);
    const cos = (a, c) => (a[0] * c[0] + a[1] * c[1] + a[2] * c[2]) / Math.max(1e-9, len(a) * len(c));
    //   色の一覧(fills: 色が変わった所の旧版・成果物の色と大きさ)・中に写真・図などの違いがあるか(other)
    for (const x of out) { if (!x.fills) x.fills = x.fill ? [{ ...x.fill, a: area(x.b) }] : []; if (x.other == null) x.other = !x.fill; }
    const bigFill = x => x.fill && !x.other && area(x.b) > cap;
    for (let merged = true; merged;) {
      merged = false;
      for (let i = 0; i < out.length && !merged; i++) for (let j = i + 1; j < out.length; j++) {
        const p = out[i], q = out[j];
        if (p.sparse || q.sparse) continue;
        const u = PC.union([p.b, q.b]), bp = bigFill(p), bq = bigFill(q);
        if (bp || bq) {   // 大きな色の所(地の色): 同じ向きの大きな色の所とだけ
          if (!(bp && bq) || !near(p.b, q.b, FILL.gap) || cos(chg(p.fill), chg(q.fill)) < FILL.cos) continue;
        } else {
          if (!near(p.b, q.b, FILL.near)) continue;
          if (area(u) > cap && area(u) > Math.max(area(p.b), area(q.b))) continue;   // 大きくなりすぎる(離れた違いを、間の広い所ごと1件にする)
        }
        const fills = [...p.fills, ...q.fills].sort((x, y) => y.a - x.a), other = p.other || q.other;
        out[i] = { b: u, sparse: false, fill: other ? null : fills[0] || null, fills, other, members: [...p.members, ...q.members] };
        out.splice(j, 1); merged = true; break;
      }
    }
    return out;
  }
  //   見た目の違い(成果物の画素の枠)を、2つに分ける:
  //   ・字の見た目: 違いのほとんど(6割以上)が、旧版と同じで動いていない字の上にある(同じ字の色・太さ・書体だけが変わった)。
  //     同じ行(縦組みは同じ列)で字の高さの2倍以内に並ぶものは1件にまとめ、その字(text)を添える
  //   ・字以外の見た目(写真・図・色・線など): それ以外
  //   o: oldDiff の成果物のページ(B: 字、st: 字ごとの旧版との関係(1 = 旧版と同じ)、moved: 動いた字)
  function lookKinds(parts, o) {
    const k = PC.S, C = o.B.chars, same = C.map((c, j) => o.st[j] === 1);
    const px = b => [b[0] * k, b[1] * k, b[2] * k, b[3] * k], area = b => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
    const inter = (a, b) => area([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);
    const out = parts.map(({ b: box, fill, fills, other, members }) => {
      const js = [], g = [box[0] - 2, box[1] - 2, box[2] + 2, box[3] + 2];
      C.forEach((c, j) => { if (same[j] && inter(px(c.box), g) > 0) js.push(j); });
      //   違いの枠のうち、そうした字の枠(まわり2画素)に入る割合
      let cov = 0;
      if (js.length) { const m = new Uint8Array(Math.max(1, Math.ceil(box[2] - box[0])) * Math.max(1, Math.ceil(box[3] - box[1]))), W = Math.max(1, Math.ceil(box[2] - box[0]));
        for (const j of js) { const b = px(C[j].box); for (let y = Math.max(box[1], Math.floor(b[1] - 2)); y < Math.min(box[3], Math.ceil(b[3] + 2)); y++) for (let x = Math.max(box[0], Math.floor(b[0] - 2)); x < Math.min(box[2], Math.ceil(b[2] + 2)); x++) m[(y - box[1]) * W + (x - box[0])] = 1; }
        cov = m.reduce((s, v) => s + v, 0) / Math.max(1, area(box)); }
      return { box, js: cov >= 0.6 ? js : null, fill, fills, other, members: members || [box] };
    });
    //   字の見た目の違いを、同じ行・同じ列で近いものどうしまとめる
    const T = out.filter(x => x.js), N = out.filter(x => !x.js), hOf = x => { const hs = x.js.map(j => Math.min(C[j].box[3] - C[j].box[1], C[j].box[2] - C[j].box[0]) * k).sort((a, b) => a - b); return hs[hs.length >> 1] || 10; };
    for (let merged = true; merged;) {
      merged = false;
      for (let i = 0; i < T.length && !merged; i++) for (let j = i + 1; j < T.length; j++) {
        const a = T[i].box, b = T[j].box, h = 2 * Math.max(hOf(T[i]), hOf(T[j]));
        const ovY = Math.min(a[3], b[3]) - Math.max(a[1], b[1]), ovX = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), gapX = Math.max(a[0], b[0]) - Math.min(a[2], b[2]), gapY = Math.max(a[1], b[1]) - Math.min(a[3], b[3]);
        const row = ovY >= 0.5 * Math.min(a[3] - a[1], b[3] - b[1]) && gapX <= h, col = ovX >= 0.5 * Math.min(a[2] - a[0], b[2] - b[0]) && gapY <= h;
        if (row || col) { T[i] = { box: PC.union([a, b]), js: [...new Set([...T[i].js, ...T[j].js])], members: [...T[i].members, ...T[j].members] }; T.splice(j, 1); merged = true; break; }
      }
    }
    return [...T.map(x => ({ box: x.box, text: x.js.sort((a, b) => a - b).map(j => C[j].c).join(''), members: x.members })), ...N.map(x => ({ box: x.box, text: null, fill: x.fill || null, fills: x.fills || [], other: x.other !== false, members: x.members }))];
  }
  // ---- 移動の見分け(旧版から見た目が変わった所のうち、動かしただけの所) ----
  //   旧版をページ全体の1つの位置合わせで成果物に重ねると、ページの中で動かしたブロック・写真・アイコンなどは、元の所と移った先の両方が
  //   違いになり、違いのまとまりごとに項目が出る(動かしただけで何十件にもなる。動いたことも、中身が同じかも分からない)。
  //   そこで、違いのまとまりごとに両方の向きで確かめる:
  //   ・成果物の側: その所の成果物の中身が、旧版のどこにあるか(移ってきたか)。当たっている旧版のページのほか、成果物のどのページにも
  //     当たらなかった旧版のページも探す(別のページの中身を、このページに移したとき)
  //   ・旧版の側: その所の旧版の中身が、成果物のどこにあるか(移っていったか)
  //   中身のない所(地の色・なめらかなグラデーション。明るさの急な変わり目が 0.5% 未満)は探さずに「地」とする(どこにでも当たってしまうため)。
  //   動き方の候補: 位置の動いた同じ字の動き(3字以上で同じもの)と、すでに見つかった動き。どれでも説明できなければ、そのまとまりを
  //   50dpi で探し(大きいまとまりから。1つの旧版のページにつき 24 か所まで)、200dpi で ±4画素詰める。
  //   動かして重ねたときの違う画素が、そのまとまりの違う画素の2割以下になる動きを、そのまとまりの動きとする。
  //   両方の側が説明できた(動き・地。両方とも地は除く)まとまりを、同じ動き・近い(200画素＝約25mm 以内)ものどうしで1つの「移動した範囲」に
  //   まとめる。その範囲の中で、動かして重ねても違う所は、中身の違いとして見た目の違いの項目に出す(見逃さないように)
  const MOVE = { tex: 0.005, keep: 0.2, gap: 200, search: 24, side: 24, tol: 2, parts: 300, cands: 40, pages: 4, txt: 1 };
  //   画素の違い(lookDiff と同じ見方: 色の差が 40 を超え、相手のまわり 5×5 の色の範囲にも入らない画素)の数:
  //   成果物 N の (x, y) と旧版 O の (x - tx, y - ty) を、box(成果物の画素)の中で step おきに比べる。成果物の外・旧版の外は違いとする
  //   (ページの外へ移ったことにしないように)。mask(box の大きさ)を渡すと、違う画素に 1 を入れる。違う画素が stop を超えたら、そこで数えるのをやめる
  function shiftDiff(N, O, tx, ty, box, step = 1, mask = null, stop = Infinity) {
    const x0 = Math.round(box[0]), y0 = Math.round(box[1]), x1 = Math.round(box[2]), y1 = Math.round(box[3]);
    const nd = N.d, od = O.d, W = N.w, H = N.h, OW = O.w, OH = O.h, T = LOOK_TOL, bw = Math.max(0, x1 - x0);
    const outside = (I, IW, IH, u, v, c0, c1, c2) => {   // 色 (c0, c1, c2) が、画像 I の (u, v) のまわり 5×5 の色の範囲(±T)の外か
      let l0 = 255, h0 = 0, l1 = 255, h1 = 0, l2 = 255, h2 = 0;
      for (let yy = Math.max(0, v - 2); yy <= Math.min(IH - 1, v + 2); yy++) for (let xx = Math.max(0, u - 2); xx <= Math.min(IW - 1, u + 2); xx++) {
        const j = 4 * (yy * IW + xx), a = I[j], b = I[j + 1], c = I[j + 2];
        if (a < l0) l0 = a; if (a > h0) h0 = a; if (b < l1) l1 = b; if (b > h1) h1 = b; if (c < l2) l2 = c; if (c > h2) h2 = c;
      }
      return c0 < l0 - T || c0 > h0 + T || c1 < l1 - T || c1 > h1 + T || c2 < l2 - T || c2 > h2 + T;
    };
    let cnt = 0, tot = 0;
    for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) {
      tot++;
      const u = x - tx, v = y - ty;
      let diff = true;
      if (x >= 0 && y >= 0 && x < W && y < H && u >= 0 && v >= 0 && u < OW && v < OH) {
        const p = 4 * (y * W + x), q = 4 * (v * OW + u);
        diff = (Math.abs(nd[p] - od[q]) > T || Math.abs(nd[p + 1] - od[q + 1]) > T || Math.abs(nd[p + 2] - od[q + 2]) > T) &&
          (outside(od, OW, OH, u, v, nd[p], nd[p + 1], nd[p + 2]) || outside(nd, W, H, x, y, od[q], od[q + 1], od[q + 2]));
      }
      if (diff) { cnt++; if (mask) mask[(y - y0) * bw + (x - x0)] = 1; if (cnt > stop) return { cnt, tot }; }
    }
    return { cnt, tot };
  }
  //   動かして重ねても違う所(成果物の画素の枠): lookDiff と同じまとめ方(近い違いをまとめ、違う画素が 20 未満・細い線だけ・
  //   粗く見て同じものは出さない。8画素以内は1件)。ex(pt): 字の変化・字の移動の枠(そのまわりは数えない)。skip: 成果物の書き込みの帯
  function shiftResidual(N, O, tx, ty, box, ex, skip) {
    const k = PC.S, x0 = Math.max(0, Math.round(box[0])), y0 = Math.max(0, Math.round(box[1])), x1 = Math.min(N.w, Math.round(box[2])), y1 = Math.min(N.h, Math.round(box[3]));
    const bw = x1 - x0, bh = y1 - y0; if (bw <= 0 || bh <= 0) return [];
    const m = new Uint8Array(bw * bh);
    if (!shiftDiff(N, O, tx, ty, [x0, y0, x1, y1], 1, m).cnt) return [];
    for (const e of ex || []) {
      const hpx = Math.min(e[3] - e[1], e[2] - e[0]) * k, mg = Math.max(3, Math.min(12, 0.35 * hpx));
      const ex0 = Math.max(x0, Math.floor(e[0] * k - mg)), ey0 = Math.max(y0, Math.floor(e[1] * k - mg)), ex1 = Math.min(x1, Math.ceil(e[2] * k + mg)), ey1 = Math.min(y1, Math.ceil(e[3] * k + mg));
      for (let y = ey0; y < ey1; y++) m.fill(0, (y - y0) * bw + ex0 - x0, (y - y0) * bw + ex1 - x0);
    }
    if (skip) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (skip[y * N.w + x]) m[(y - y0) * bw + x - x0] = 0;
    const g = PC.morph(m, bw, bh, 'dilate', 9, 9), cc = PC.cc(g, bw, bh), n = new Int32Array(cc.n), bx = Array.from({ length: cc.n }, () => [Infinity, Infinity, -1, -1]);
    for (let i = 0; i < bw * bh; i++) {
      if (!m[i]) continue;
      const l = cc.lab[i], x = i % bw, y = (i - x) / bw, q = bx[l]; n[l]++;
      if (x < q[0]) q[0] = x; if (y < q[1]) q[1] = y; if (x > q[2]) q[2] = x; if (y > q[3]) q[3] = y;
    }
    //   粗く見て同じ所(4×4画素の平均どうしで、どれかの色の差が 40 を超えるます目が3つ未満)は出さない
    const nd = N.d, od = O.d;
    const coarse = b => {
      let c = 0;
      for (let y = b[1] - (b[1] % 4); y < b[3] && y + 4 <= bh; y += 4) for (let x = b[0] - (b[0] % 4); x < b[2] && x + 4 <= bw; x += 4) {
        const s = [0, 0, 0, 0, 0, 0]; let k2 = 0, hit = 0;
        for (let yy = y; yy < y + 4; yy++) for (let xx = x; xx < x + 4; xx++) {
          const X = xx + x0, Y = yy + y0, u = X - tx, v = Y - ty; if (u < 0 || v < 0 || u >= O.w || v >= O.h) continue;
          k2++; hit |= m[yy * bw + xx]; const i = 4 * (Y * N.w + X), j = 4 * (v * O.w + u);
          for (let t = 0; t < 3; t++) { s[t] += nd[i + t]; s[3 + t] += od[j + t]; }
        }
        if (hit && k2 === 16 && (Math.abs(s[0] - s[3]) > 640 || Math.abs(s[1] - s[4]) > 640 || Math.abs(s[2] - s[5]) > 640) && ++c >= 3) return true;
      }
      return false;
    };
    const out = [];
    for (let l = 1; l < cc.n; l++) if (n[l] >= LOOK_MIN && Math.max(bx[l][2] - bx[l][0], bx[l][3] - bx[l][1]) >= 4) {
      const b = [bx[l][0], bx[l][1], bx[l][2] + 1, bx[l][3] + 1], a = (b[2] - b[0]) * (b[3] - b[1]);
      if (n[l] / Math.max(b[2] - b[0], b[3] - b[1]) <= 3 || !coarse(b)) continue;
      out.push({ b: [b[0] + x0, b[1] + y0, b[2] + x0, b[3] + y0], sparse: a > 200 * 200 && n[l] < 0.02 * a });
    }
    return out;
  }
  //   見た目の違いのまとまり({ b, sparse })のうち、重なる・8画素以内のものを1件にする(lookDiff と同じ。細い線だけの大きなまとまりはまとめない)
  const mergeLook = xs => {
    const out = xs.map(x => ({ b: x.b.slice(), sparse: x.sparse }));
    for (let merged = true; merged;) {
      merged = false;
      for (let i = 0; i < out.length && !merged; i++) for (let j = i + 1; j < out.length; j++) {
        const p = out[i].b, q = out[j].b;
        if (out[i].sparse || out[j].sparse) continue;
        if (Math.max(p[0], q[0]) - Math.min(p[2], q[2]) <= 8 && Math.max(p[1], q[1]) - Math.min(p[3], q[3]) <= 8) { out[i] = { b: PC.union([p, q]), sparse: false }; out.splice(j, 1); merged = true; break; }
      }
    }
    return out.map(x => x.b);
  };
  //   中身の量: 明るさの急な変わり目(となりの画素どうしの差が 40 を超える所)の割合(2画素おきに見る)
  function texture(I, box) {
    const x0 = Math.max(1, Math.round(box[0])), y0 = Math.max(1, Math.round(box[1])), x1 = Math.min(I.w - 1, Math.round(box[2])), y1 = Math.min(I.h - 1, Math.round(box[3]));
    const d = I.d, W = I.w, g = i => (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    let n = 0, e = 0;
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { n++; const i = 4 * (y * W + x); if (Math.abs(g(i + 4) - g(i - 4)) > 40 || Math.abs(g(i + 4 * W) - g(i - 4 * W)) > 40) e++; }
    return n ? e / n : 0;
  }
  //   200dpi の画像を 50dpi の灰色に(4×4画素の平均)。探すのに使う
  function gray4(I) {
    const w = Math.floor(I.w / 4), h = Math.floor(I.h / 4), g = new Uint8Array(w * h), d = I.d, W = I.w;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0;
      for (let yy = 0; yy < 4; yy++) { let i = 4 * ((4 * y + yy) * W + 4 * x); for (let xx = 0; xx < 4; xx++, i += 4) s += (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8; }
      g[y * w + x] = s >> 4;
    }
    return { w, h, g };
  }
  //   50dpi の灰色の画像 S の中で、box(200dpi の画素)の所の G の切り抜きを探す。いちばんよい所に近い所(差の差が 0.002 以内)のうち、
  //   (ex, ey)(50dpi)にいちばん近い所(同じ形が並ぶ所で、遠くの別のものに当てないように)。返り値は 50dpi の左上
  function search4(S, G, box, ex, ey) {
    const x0 = Math.max(0, Math.floor(box[0] / 4)), y0 = Math.max(0, Math.floor(box[1] / 4)), x1 = Math.min(G.w, Math.ceil(box[2] / 4)), y1 = Math.min(G.h, Math.ceil(box[3] / 4));
    const tw = x1 - x0, th = y1 - y0;
    if (tw < 6 || th < 6 || tw >= S.w || th >= S.h) return null;
    const t = new Uint8Array(tw * th);
    for (let y = 0; y < th; y++) t.set(G.g.subarray((y + y0) * G.w + x0, (y + y0) * G.w + x1), y * tw);
    const src = PC.toMat(S.g, S.w, S.h), tpl = PC.toMat(t, tw, th), res = new cv.Mat();
    try {
      cv.matchTemplate(src, tpl, res, cv.TM_SQDIFF_NORMED);
      const R = res.data32F, rw = res.cols; let mn = Infinity;
      for (let i = 0; i < R.length; i++) if (R[i] < mn) mn = R[i];
      if (!(mn < 0.25)) return null;
      let best = -1, bd = Infinity;
      for (let i = 0; i < R.length; i++) if (R[i] <= mn + 0.002) { const x = i % rw, y = (i - x) / rw, dd = (x - ex) ** 2 + (y - ey) ** 2; if (dd < bd) { bd = dd; best = i; } }
      return [best % rw, Math.floor(best / rw)];
    } finally { src.delete(); tpl.delete(); res.delete(); }
  }
  //   動き t(成果物の画素 ＝ 旧版の画素 ＋ t)を、200dpi で ±4画素詰める(違う画素のいちばん少ない所)
  const refineShift = (N, O, t, box) => {
    let best = t, bc = Infinity;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const c = shiftDiff(N, O, t[0] + dx, t[1] + dy, box, 3, null, bc).cnt; if (c < bc) { bc = c; best = [t[0] + dx, t[1] + dy]; } }
    return best;
  };
  //   NW: 成果物のページ(200dpi)。pages: 比べる旧版のページ [{ p, img, g }](最初が、このページに当たっている旧版のページ)。t0: その位置合わせ(画素)。
  //   parts: 見た目の違いのまとまり(成果物の画素。lookDiff の parts)。textT: 位置の動いた同じ字の動き(画素)。ex・skip: shiftResidual と同じ
  //   返り値: moves: [{ p, t, box(成果物の画素), n(まとまりの数), rest(中身の違いの枠) }]、rest: 移動で説明できないまとまり
  async function explainMoves(NW, pages, t0, parts, textT, ex, skip) {
    const p0 = pages[0].p, OI = pages[0].img, GN = gray4(NW), imgOf = p => pages.find(x => x.p === p);
    const cands = [], addC = (p, t) => {
      if (p === p0 && Math.abs(t[0] - t0[0]) <= MOVE.tol && Math.abs(t[1] - t0[1]) <= MOVE.tol) return null;   // 動いていない
      return cands.find(c => c.p === p && Math.abs(c.t[0] - t[0]) <= MOVE.tol && Math.abs(c.t[1] - t[1]) <= MOVE.tol) || (cands.length < MOVE.cands ? (cands.push({ p, t }), cands[cands.length - 1]) : null);
    };
    for (const t of textT) addC(p0, t);
    const shift = (b, t) => [b[0] + t[0], b[1] + t[1], b[2] + t[0], b[3] + t[1]];
    const area = b => (b[2] - b[0]) * (b[3] - b[1]), info = [], rest = [];
    const stepOf = b => (area(b) < 20000 ? 1 : 2);   // 小さいまとまりは1画素ずつ、大きいものは2画素おきに数える
    //   (違う画素が lim を超えたら、そこで数えるのをやめる。説明できるかどうかだけを見るため)
    const fN = (c, b, lim = Infinity) => shiftDiff(NW, imgOf(c.p).img, c.t[0], c.t[1], b, stepOf(b), null, lim).cnt;   // 成果物の側: 成果物の b の中身を、旧版の b − t と比べる
    const fO = (c, ob, lim = Infinity) => (c.p !== p0 ? Infinity : shiftDiff(NW, OI, c.t[0], c.t[1], shift(ob, c.t), stepOf(ob), null, lim).cnt);   // 旧版の側: 旧版の ob の中身を、成果物の ob ＋ t と比べる
    //   1回目: まとまりごとに、いまの候補で説明できなければ探して、動き方の候補を集める(大きいまとまりから)
    let searches = 0;
    //   (まとまりが多いページは、大きいものから 300 まで。残りは見た目の違いのまま)
    const sorted = parts.slice().sort((a, c) => area(c.b) - area(a.b));
    for (const part of sorted.slice(MOVE.parts)) rest.push(part);
    for (const part of sorted.slice(0, MOVE.parts)) {
      const b = part.b, base = shiftDiff(NW, OI, t0[0], t0[1], b, stepOf(b)).cnt, lim = MOVE.keep * base;
      const ob = shift(b, [-t0[0], -t0[1]]), nbg = !!part.fill || texture(NW, b) < MOVE.tex, obg = !!part.fill || texture(OI, ob) < MOVE.tex;   // 色が変わった所は、両方とも中身の薄い所として扱う
      if (!base) { rest.push(part); continue; }
      info.push({ part, b, ob, lim, base, nbg, obg });
      if (nbg && obg) continue;   // 両方とも中身の薄い所(淡い花びら・色の面など): 探さない(2回目に、まわりの大きな動きで説明できるかだけを見る)
      const big = b[2] - b[0] >= MOVE.side && b[3] - b[1] >= MOVE.side;
      if (!big) continue;
      if (!nbg && !cands.some(c => fN(c, b, lim) <= lim) && searches < MOVE.search * pages.length) {
        for (const pg of pages) {
          searches++;
          const at = search4(pg.g, GN, b, (b[0] - (pg.p === p0 ? t0[0] : 0)) / 4, (b[1] - (pg.p === p0 ? t0[1] : 0)) / 4);
          if (at) addC(pg.p, refineShift(NW, pg.img, [Math.floor(b[0] / 4) * 4 - 4 * at[0], Math.floor(b[1] / 4) * 4 - 4 * at[1]], b));
          await PC.tick();
        }
      }
      if (!obg && !cands.some(c => fO(c, ob, lim) <= lim) && searches < MOVE.search * pages.length) {
        searches++;
        const at = search4(GN, pages[0].g, ob, (ob[0] + t0[0]) / 4, (ob[1] + t0[1]) / 4);
        if (at) { const t1 = [4 * at[0] - Math.floor(ob[0] / 4) * 4, 4 * at[1] - Math.floor(ob[1] / 4) * 4]; addC(p0, refineShift(NW, OI, t1, shift(ob, t1))); }
        await PC.tick();
      }
    }
    //   2回目: まとまりごとに、説明できる候補をすべて調べ、いちばん多くのまとまり(違う画素の多さ)を説明できる候補を選ぶ
    //   (同じ中身が旧版の2か所にあるときなどに、まとまりごとにばらばらの動きにならないように)
    //   たまたま重なっただけの動きを除く: その動きから縦・横に 6画素(約0.8mm)ずらすと、違う画素がはっきり(まとまりの違う画素の2%・20画素以上)
    //   増える動き(ぴったり重なる動き)だけを、動きのよりどころ(sharp)にする。まっすぐな縁(グラフの棒の上の縁など)・なめらかなグラデーションは、
    //   ずらしても重なるので、よりどころにならない。よりどころにならない説明は、同じ動きのよりどころが近く(200画素以内)にあるときだけ使う
    //   (横に長い帯などを、まわりと一緒に動いたものとして入れるため)
    const D6 = [[6, 0], [-6, 0], [0, 6], [0, -6]];
    const sharp = (f, c, b, v, base) => { const m = v + Math.max(20, 0.02 * base); return D6.every(([dx, dy]) => f({ p: c.p, t: [c.t[0] + dx, c.t[1] + dy] }, b, m) >= m); };
    for (const x of info) {
      const bb = x.nbg && x.obg;   // 両方とも中身が薄い所は、成果物の側だけを見る(ほかの動きの支えには数えない)
      x.ns = x.nbg && !bb ? [] : cands.map(c => ({ c, v: fN(c, x.b, x.lim) })).filter(e => e.v <= x.lim);
      x.os = x.obg ? [] : cands.map(c => ({ c, v: fO(c, x.ob, x.lim) })).filter(e => e.v <= x.lim);
      if (!bb) for (const e of x.ns) e.sharp = sharp(fN, e.c, x.b, e.v, x.base);
      for (const e of x.os) e.sharp = sharp(fO, e.c, x.ob, e.v, x.base);
    }
    //   動きごとの、よりどころのまとまり(成果物の側は移ってきた所、旧版の側は移っていった先。成果物の画素)と、その違う画素の数(支え)
    const sup = new Map(), anc = new Map();
    for (const x of info) {
      if (x.nbg && x.obg) continue;
      const seen = new Set();
      for (const e of x.ns) if (e.sharp) { seen.add(e.c); (anc.get(e.c) || anc.set(e.c, []).get(e.c)).push(x.b); }
      for (const e of x.os) if (e.sharp) { seen.add(e.c); (anc.get(e.c) || anc.set(e.c, []).get(e.c)).push(shift(x.ob, e.c.t)); }
      for (const c of seen) sup.set(c, (sup.get(c) || 0) + x.base);
    }
    const nearAnc = (c, b) => (anc.get(c) || []).some(a => Math.max(a[0], b[0]) - Math.min(a[2], b[2]) <= MOVE.gap && Math.max(a[1], b[1]) - Math.min(a[3], b[3]) <= MOVE.gap);
    for (const x of info) {
      x.ns = x.ns.filter(e => e.sharp || nearAnc(e.c, x.b));
      x.os = x.os.filter(e => e.sharp || nearAnc(e.c, shift(x.ob, e.c.t)));
    }
    //   両方とも中身が薄い所は、そのまとまりの10倍以上の違いを説明できている(まわりの大きな)動きで説明できるときだけ、その動きに入れる
    //   (色が変わった所(lookDiff の fill)は、その所の違う画素と同じ数以上。動かした囲み・帯のふちの、色の変わった帯を、動きに入れるため)
    for (const x of info) if (x.nbg && x.obg) x.ns = x.ns.filter(e => (sup.get(e.c) || 0) >= (x.part.fill ? 1 : 10) * x.base);
    const choose = es => es.reduce((a, e) => (!a || (sup.get(e.c) || 0) > (sup.get(a.c) || 0) || ((sup.get(e.c) || 0) === (sup.get(a.c) || 0) && e.v < a.v) ? e : a), null);
    //   成果物の側は移ってきた中身で説明できるが、旧版の側(その所に旧版であった中身)が成果物のどこにもないまとまりは、
    //   「旧版の中身が、移ってきた中身に置き換わった所」として、その動きごとに1件にまとめる(repl。旧版の中身がなくなったことは出す)
    if (window.__pcDebug) { PC._moves = PC._moves || []; PC._moves.push({ t0, cands: cands.map(c => ({ p: c.p, t: c.t, sup: sup.get(c) || 0 })), parts: info.map(x => ({ b: x.b, base: x.base, nbg: x.nbg, obg: x.obg, ns: x.ns.map(e => [cands.indexOf(e.c), e.v]), os: x.os.map(e => [cands.indexOf(e.c), e.v]) })), skipped: rest.map(r => r.b) }); }
    //   ほかのページから移ってきた範囲(その動きで成果物の側を説明したまとまりの範囲。近いものどうしまとめる): その中は、このページの旧版の
    //   中身が置き換わったとみなし、その動きで説明する(同じ絵が旧版の2か所にあるとき、旧版のこのページの絵が別の所へ動いたことにしないように)
    const crossR = new Map();
    for (const x of info) {
      const e = choose(x.ns); if (!e || e.c.p === p0) continue;
      const R = crossR.get(e.c) || []; crossR.set(e.c, R);
      const near = R.filter(r => Math.max(r[0], x.b[0]) - Math.min(r[2], x.b[2]) <= MOVE.gap && Math.max(r[1], x.b[1]) - Math.min(r[3], x.b[3]) <= MOVE.gap);
      for (const r of near) R.splice(R.indexOf(r), 1);
      R.push(PC.union([x.b, ...near]));
    }
    const crossAt = b => { const [cx, cy] = PC.center(b); for (const [c, R] of [...crossR].sort((a, e) => (sup.get(e[0]) || 0) - (sup.get(a[0]) || 0))) if (R.some(r => cx >= r[0] && cx <= r[2] && cy >= r[1] && cy <= r[3])) return c; return null; };
    let got = [];
    for (const x of info) {
      const nIn = choose(x.ns), oOut = choose(x.os), cc = crossAt(x.b);
      if (cc) {
        const e = x.ns.find(e => e.c === cc);
        if (e || x.nbg) { got.push({ c: cc, box: x.b, inn: !!e, repl: !x.obg, x }); continue; }
      }
      if (x.nbg && x.obg) { if (nIn) got.push({ c: nIn.c, box: x.b, inn: true, x }); else rest.push(x.part); continue; }
      if (nIn && !x.obg && !oOut) { got.push({ c: nIn.c, box: x.b, inn: true, repl: true, x }); continue; }
      if (!((x.nbg || nIn) && (x.obg || oOut))) { rest.push(x.part); continue; }
      if (nIn) got.push({ c: nIn.c, box: x.b, inn: true, x });
      if (oOut) got.push({ c: oOut.c, box: shift(x.ob, oOut.c.t), inn: false, x });   // 移っていった先(成果物の画素)
    }
    //   動いた所が小さすぎる動き(合わせて 24×24画素＝約3mm角 未満)は、たまたま重なっただけのことがあるので、移動としない
    //   (その動きで説明したまとまりは、見た目の違いのまま)
    const sz = new Map();
    for (const y of got) sz.set(y.c, (sz.get(y.c) || 0) + area(y.box));
    const drop = new Set(got.filter(y => sz.get(y.c) < MOVE.side * MOVE.side).map(y => y.x));
    for (const x of drop) rest.push(x.part);
    got = got.filter(y => !drop.has(y.x));
    //   同じ動きのまとまりを1件にする。離れた所(200画素＝約25mm より離れたもの)は、同じ件の別の枠にする(いちばん広い所を主な範囲に)
    const moves = [];
    for (const c of cands) {
      const xs = got.filter(x => x.c === c);
      if (!xs.length) continue;
      const cl = [];
      for (const x of xs) {
        const near = cl.filter(g => Math.max(g.box[0], x.box[0]) - Math.min(g.box[2], x.box[2]) <= MOVE.gap && Math.max(g.box[1], x.box[1]) - Math.min(g.box[3], x.box[3]) <= MOVE.gap);
        const g = { box: PC.union([x.box, ...near.map(g => g.box)]), ins: [...near.flatMap(g => g.ins), ...(x.inn ? [x.box] : [])] };
        for (const e of near) cl.splice(cl.indexOf(e), 1);
        cl.push(g);
      }
      for (let merged = true; merged;) {   // まとめた範囲どうしが近くなったら、さらにまとめる
        merged = false;
        for (let i = 0; i < cl.length && !merged; i++) for (let j = i + 1; j < cl.length; j++) {
          const a = cl[i].box, e = cl[j].box;
          if (Math.max(a[0], e[0]) - Math.min(a[2], e[2]) > MOVE.gap || Math.max(a[1], e[1]) - Math.min(a[3], e[3]) > MOVE.gap) continue;
          cl[i] = { box: PC.union([a, e]), ins: [...cl[i].ins, ...cl[j].ins] }; cl.splice(j, 1); merged = true; break;
        }
      }
      cl.sort((a, e) => area(e.box) - area(a.box));
      //   範囲の中で、動かして重ねても違う所(中身の違い)
      const O = imgOf(c.p).img, r = [];
      for (const g of cl) for (const b of g.ins) r.push(...shiftResidual(NW, O, c.t[0], c.t[1], b, ex, skip));
      //   置き換わった所: 近いものどうしをまとめた枠(大きい順)
      const rp = mergeLook(xs.filter(x => x.repl).map(x => ({ b: x.box, sparse: false }))), rc = [];
      for (const b of rp) { const g = rc.find(g => Math.max(g[0], b[0]) - Math.min(g[2], b[2]) <= MOVE.gap && Math.max(g[1], b[1]) - Math.min(g[3], b[3]) <= MOVE.gap); if (g) g.splice(0, 4, ...PC.union([g, b])); else rc.push(b.slice()); }
      rc.sort((a, e) => area(e) - area(a));
      moves.push({ p: c.p, t: c.t, box: cl[0].box, more: cl.slice(1).map(g => g.box), n: xs.length, rest: mergeLook(r), repl: rc });
    }
    return { moves, rest };
  }
  async function oldLooks(P, OLD, newDoc, oldDoc, step, relax = async () => {}) {
    const k = PC.S, VIS = new Set(['annot', 'scan', 'scan3']);
    let total = 0, done = 0;
    //   移動の見分けで探す旧版のほかのページ: 成果物のこのページに当たった旧版のページと、成果物のどのページにも当たらなかった旧版のページ
    //   (合わせて4ページまで。200dpi の描画と 50dpi の灰色は、ページごとに1回だけ作る)
    const spare = new Map();
    const spareImgs = async (q, p0) => {
      const ps = [];
      for (let p = 0; p < OLD.pairs.length && ps.length < MOVE.pages; p++) if (p !== p0 && (OLD.pairs[p].q < 0 || OLD.pairs[p].q === q)) ps.push(p);
      for (const p of ps) if (!spare.has(p)) { const img = await PC.renderPage(oldDoc, p, PC.DPI, false); spare.set(p, { p, img, g: gray4(img) }); }
      return ps.map(p => spare.get(p));
    };
    OLD.movedFrom = new Set();
    const pureT = T => Math.abs(T[0] - 1) < 1e-3 && Math.abs(T[1]) < 1e-3 && Math.abs((T.length > 4 ? T[4] : T[0]) - 1) < 1e-3;
    const mm = v => Math.round(v * 25.4 / 72 * 10) / 10;   // pt → mm(小数1けた)
    const oldName = p => { const n = oldDoc.parts && oldDoc.parts.length > 1 ? PC.pageOf(oldDoc.parts, p) : null; return n ? `旧版（${n.name}）の${n.page}ページ目` : `旧版の${p + 1}ページ目`; };
    const dirOf = v => [Math.abs(mm(v[0])) >= 0.3 ? `${v[0] > 0 ? '右' : '左'}へ ${Math.abs(mm(v[0]))}mm` : '', Math.abs(mm(v[1])) >= 0.3 ? `${v[1] > 0 ? '下' : '上'}へ ${Math.abs(mm(v[1]))}mm` : ''].filter(Boolean).join('・');
    for (const [q, o] of OLD.byQ) {
      if (done) await relax();   // 前のページで描いた画像などを手放す
      step(done++ / OLD.byQ.size);
      //   位置合わせを同じ字の組で確かめられたページ(Tr)だけ(おおよその変換で重ねると、ずれた所がみな違いになる)
      const maps = o.maps.filter(m => m.Tr && OLD.pairs[m.p] && OLD.pairs[m.p].same);
      if (!maps.length) continue;
      const ds = P.filter(d => d.q === q && d.kind !== 'none');
      //   原稿を見た目で比べた範囲(pt)。そこは原稿との比べ合わせで出ている
      const vis = ds.filter(d => VIS.has(d.kind)).map(d => d.crop || [0, 0, 1e9, 1e9]);
      //   説明に使う枠(pt): 旧版から変わった字(置き換わった・旧版にない・書き方の違い)、消えた字(旧版の位置を写したもの)、位置が動いた同じ字、
      //   図形の文字で旧版から見た目が変わった所(shapeSpots で出たもの)
      const ex = [...o.moved, ...o.B.chars.filter((c, j) => o.st[j] !== 1).map(c => c.box), ...o.gone.map(g => [(OLD.pairs[g.p] && OLD.pairs[g.p].Tr) || g.T, g]).filter(([T]) => T).map(([T, g]) => PC.mapBox(T, PC.union(g.cs.map(c => c.box))))];
      for (const d of ds) for (const x of d.shapes || []) { const o0 = d.crop ? [d.crop[0], d.crop[1]] : [0, 0]; ex.push([x.nbox[0] / k + o0[0], x.nbox[1] / k + o0[1], x.nbox[2] / k + o0[0], x.nbox[3] / k + o0[1]]); }
      const NW = await PC.renderPage(newDoc, q, PC.DPI, false), skip = pinkBands(NW, o.B), vmoves = [];   // vmoves: 見た目で見つけた移動(動き pt・範囲 pt)
      //   結果のページ(このページを表示しているもの。なければ「成果物だけ」のページを足す)
      const pageAt = async (cx, cy) => {
        let d = ds.find(d => d.kind !== 'newonly' && !d.crop) || ds.find(d => d.crop && cx >= d.crop[0] && cx <= d.crop[2]) || P.find(e => e.kind === 'newonly' && e.q === q);
        if (!d) {
          d = { kind: 'newonly', q, src: null, label: null, ch: [], im: [], an: [], notes: [], restBoxes: [], ot: [], nt: [], pairs: [], oc: [], nc: [], extra: [], thumbs: { left: null, right: await toThumb(NW) } };
          P.push(d); ds.push(d);
        }
        return d;
      };
      for (const mp of maps) {
        //   比べる範囲: 旧版のページを写した範囲(成果物の pt)
        const OI = await PC.renderPage(oldDoc, mp.p, PC.DPI, false);
        if (mp.img) { mp.Tr = fineShift(OI, NW, mp.Tr); OLD.pairs[mp.p].Tr = mp.Tr; }   // 画像のずらし方で合わせたページ: 200dpi で詰める
        const Rg = PC.mapBox(mp.Tr, [0, 0, OI.w / k, OI.h / k]);
        const lk = lookDiff(OI, NW, mp.Tr, Rg, ex, skip);
        //   移動の見分け: 見た目の違いのまとまりを、動かしただけの所(移動した範囲)と、そうでない所に分ける(位置合わせが平行移動のページだけ)
        let boxes = lk, moves = [];
        if (lk.length && lk.parts && pureT(mp.Tr)) {
          const t0 = [Math.round(mp.Tr[2] * k), Math.round(mp.Tr[3] * k)];
          //   位置の動いた同じ字の動き(3字以上で同じもの。多いものから12まで)を、動き方の候補にする
          const tv = new Map();
          for (let i = 0; i + 1 < o.moved.length; i += 2) {
            const a = PC.center(o.moved[i]), c = PC.center(o.moved[i + 1]), t = [t0[0] + Math.round((c[0] - a[0]) * k), t0[1] + Math.round((c[1] - a[1]) * k)];
            const key = Math.round(t[0] / 2) + ',' + Math.round(t[1] / 2), e = tv.get(key) || { t, n: 0 }; e.n++; tv.set(key, e);
          }
          const textT = [...tv.values()].filter(e => e.n >= 3).sort((a, c) => c.n - a.n).slice(0, 12).map(e => e.t);
          const r = await explainMoves(NW, [{ p: mp.p, img: OI, g: gray4(OI) }, ...(await spareImgs(q, mp.p))], t0, lk.parts, textT, ex, skip);
          if (r.moves.length) { moves = r.moves; boxes = mergeParts(withFills(r.rest), FILL.cap * NW.w * NW.h); }
          //   移動した範囲を、同じ動きで位置の動いた同じ字まで広げる(動かしたブロックの文字も、移動した範囲に入れる。字は文字の比べ合わせで同じと確かめてある)
          for (const m of moves) {
            if (m.p !== mp.p) continue;
            const bs = [m.box, ...m.more];
            for (let i = 0; i + 1 < o.moved.length; i += 2) {
              const a = PC.center(o.moved[i]), c = PC.center(o.moved[i + 1]), t = [t0[0] + Math.round((c[0] - a[0]) * k), t0[1] + Math.round((c[1] - a[1]) * k)];
              if (Math.abs(t[0] - m.t[0]) > MOVE.tol || Math.abs(t[1] - m.t[1]) > MOVE.tol) continue;
              const nb = o.moved[i + 1].map(v => v * k), j = bs.findIndex(e => Math.max(e[0], nb[0]) - Math.min(e[2], nb[2]) <= MOVE.gap && Math.max(e[1], nb[1]) - Math.min(e[3], nb[3]) <= MOVE.gap);
              if (j >= 0) bs[j] = PC.union([bs[j], nb]);
            }
            for (let merged = true; merged;) {   // 広げて近くなった枠どうしをまとめる
              merged = false;
              for (let i = 0; i < bs.length && !merged; i++) for (let j = i + 1; j < bs.length; j++) {
                const e = bs[i], f = bs[j];
                if (Math.max(e[0], f[0]) - Math.min(e[2], f[2]) <= MOVE.gap && Math.max(e[1], f[1]) - Math.min(e[3], f[3]) <= MOVE.gap) { bs[i] = PC.union([e, f]); bs.splice(j, 1); merged = true; break; }
              }
            }
            bs.sort((e, f) => (f[2] - f[0]) * (f[3] - f[1]) - (e[2] - e[0]) * (e[3] - e[1]));
            m.box = bs[0]; m.more = bs.slice(1);
          }
        }
        const rel = (b, o0) => [b[0] - o0[0] * k, b[1] - o0[1] * k, b[2] - o0[0] * k, b[3] - o0[1] * k];
        for (const { box: b, text, fill, fills, other, members } of lookKinds(boxes, o)) {
          const nbPt = b.map(v => v / k), [cx, cy] = PC.center(nbPt);
          if (vis.some(r => cx >= r[0] && cx <= r[2] && cy >= r[1] && cy <= r[3])) continue;
          const d = await pageAt(cx, cy), o0 = d.crop ? [d.crop[0], d.crop[1]] : [0, 0], nb = rel(b, o0);
          (d.looks || (d.looks = [])).push({ nbox: nb, pnb: members && members.length > 1 ? members.map(x => rel(x, o0)) : null, text, fill, fills: (fills || []).slice(0, 3).map(f => ({ o: f.o, n: f.n })), other, old: { p: mp.p, box: PC.mapBox(PC.invT(mp.Tr), nbPt).map(v => v * k), M: pxM(mp.Tr, o0) } });
          total++;
        }
        //   移動した範囲: 1か所1件(動き・移動元・中身が同じか)。範囲の中で、動かして重ねても違う所は、見た目の違いとして別に出す
        //   (旧版の切り抜き・パタパタ表示は、動かした旧版の所を重ねる)。字の変化の項目のうち、範囲の中で、動かして重ねると画素まで同じもの
        //   (並びが変わって「消えた字」「旧版にない字」に分かれた、動かしただけの字)は、移動の項目に含める
        for (const m of moves) {
          const [cx, cy] = PC.center(m.box.map(v => v / k));
          if (vis.some(r => cx >= r[0] && cx <= r[2] && cy >= r[1] && cy <= r[3])) continue;   // 原稿と見た目で比べた範囲(そこは原稿との比べ合わせで出ている)
          const d = await pageAt(cx, cy), o0 = d.crop ? [d.crop[0], d.crop[1]] : [0, 0];
          const O = m.p === mp.p ? OI : spare.get(m.p).img, M = [1, 0, m.t[0] - o0[0] * k, m.t[1] - o0[1] * k, 1];
          const inBox = (b, mg = 8) => { const [x, y] = PC.center(b); return [m.box, ...m.more].some(r => x >= r[0] - mg && x <= r[2] + mg && y >= r[1] - mg && y <= r[3] + mg); };
          const sameAt = b => { const bb = [b[0] - 2, b[1] - 2, b[2] + 2, b[3] + 2]; return shiftDiff(NW, O, m.t[0], m.t[1], bb, 1).cnt <= Math.max(3, 0.005 * (bb[2] - bb[0]) * (bb[3] - bb[1])); };
          let absorbed = 0, textIn = 0;
          for (const e of ds) {
            if (!e.olds) continue;
            const e0 = e.crop ? [e.crop[0], e.crop[1]] : [0, 0];
            e.olds = e.olds.filter(x => {
              if (x.kind === 'del') {
                if (!x.old || x.old.p !== m.p || !x.old.box) return true;
                const at = [x.old.box[0] + m.t[0], x.old.box[1] + m.t[1], x.old.box[2] + m.t[0], x.old.box[3] + m.t[1]];   // 動かしたあとの所
                if (inBox(at) && sameAt(at)) { absorbed++; return false; }
                if (inBox(at, 0)) textIn++;   // 動かした範囲の中で消えた字(中身の違い)
              } else {
                const nb = [x.nbox[0] + e0[0] * k, x.nbox[1] + e0[1] * k, x.nbox[2] + e0[0] * k, x.nbox[3] + e0[1] * k];
                if (inBox(nb) && sameAt(nb)) { absorbed++; return false; }
                if (inBox(nb, 0)) textIn++;
              }
              return true;
            });
          }
          const cross = m.p !== mp.p, v = [(m.t[0] - Math.round(mp.Tr[2] * k)) / k, (m.t[1] - Math.round(mp.Tr[3] * k)) / k];
          const dir = dirOf(v);
          const vm = { p: m.p, t: v, boxes: [m.box, ...m.more].map(b => b.map(x => x / k)), o0 };
          if (!cross) vmoves.push(vm);
          const diffN = m.rest.length + textIn;
          const show = (cross ? `${oldName(m.p)}から移ってきた所` : `${dir || 'わずかに'}移動`) + `（${m.more.length ? `${1 + m.more.length}か所。` : ''}${diffN ? `中身に違い ${diffN}か所：別の項目` : '中身は同じ'}）`;
          if (cross) OLD.movedFrom.add(m.p);
          (d.moves || (d.moves = [])).push(vm.item = { nbox: rel(m.box, o0), more: m.more.map(b => rel(b, o0)), show, same: !diffN, cross, n: m.n, absorbed, old: { p: m.p, box: [m.box[0] - m.t[0], m.box[1] - m.t[1], m.box[2] - m.t[0], m.box[3] - m.t[1]], M } });
          if (m.repl.length) {   // 旧版の中身が、移ってきた中身に置き換わった所(この動きで1件。旧版の切り抜きは、その所の旧版の中身)
            const r = m.repl[0], rPt = r.map(v => v / k);
            (d.looks || (d.looks = [])).push({ nbox: rel(r, o0), more: m.repl.slice(1).map(b => rel(b, o0)), text: null, replaced: cross ? oldName(m.p) : '旧版の同じページ', old: { p: mp.p, box: PC.mapBox(PC.invT(mp.Tr), rPt).map(v => v * k), M: pxM(mp.Tr, o0) } });
            total++;
          }
          for (const r of m.rest) {
            const [rx, ry] = PC.center(r.map(v => v / k));
            if (vis.some(z => rx >= z[0] && rx <= z[2] && ry >= z[1] && ry <= z[3])) continue;
            (d.looks || (d.looks = [])).push({ nbox: rel(r, o0), text: null, inMove: true, old: { p: m.p, box: [r[0] - m.t[0], r[1] - m.t[1], r[2] - m.t[0], r[3] - m.t[1]], M } });
            total++;
          }
          total++;
        }
        await PC.tick();
      }
      //   文字だけを動かした所: 字を直していないまとまり(PC.blocksOf)の中の、字の並び(文字データのひと続き)ごとに、すべての字が同じ旧版のページから
      //   同じだけ(0.5pt 以内)動いたもの(1pt 以上)。動いた同じ字は見た目の違いから除くので、字の枠だけを動かした所は、見た目の移動の
      //   見分けには出てこない(見逃していた)。字を直したまとまりの中の字の動き(追い込み・改行の変化)は、文字の違いの項目で出るので見ない。
      //   見た目の移動の範囲に同じ動き(1pt 以内)で入っているものは除く。同じ動きで近い(200画素以内)ものを1件にし、3字以上のものだけ出す
      //   (1〜2字だけの動きは、同じ字がたまたま別の所の字と対応づいたことが多い)
      const C = o.B.chars, at = new Map(C.map((c, j) => [c.box, j])), dv = new Map(), tms = [];
      for (let i = 0; i + 1 < o.moved.length; i += 2) {
        const j = at.get(o.moved[i + 1]); if (j == null) continue;
        const a = PC.center(o.moved[i]), c = PC.center(o.moved[i + 1]);
        dv.set(j, { t: [c[0] - a[0], c[1] - a[1]], p: o.movedP[i >> 1], ob: o.moved[i] });
      }
      //   文字の送り(直した段落から後ろへ続く送り)を除く: 段落ごとに、直したもの(edit)・動いたもの(move)・動かないもの(still)に分け、
      //   直した段落と、並び(文字データの順)でとなり合い、旧版か成果物で接している(字の大きさの2倍以内)動いた段落は、送られただけとみなす。
      //   送られただけの段落ととなり合い、接している動いた段落も同じ(段から段へ送られた所まで、たどる)。字の枠ごと動かした所は、まわりの段落を
      //   直していないので残る
      const BLK = PC.blocksOf(C, o.B.items), bnb = [], bob = [], bsz = [];
      const bst = BLK.map(([s0, e0], b) => {
        let edited = false, moved = false;
        for (let j = s0; j < e0; j++) { if (o.st[j] !== 1) edited = true; else if (dv.has(j)) moved = true; }
        const cs = C.slice(s0, e0); bnb[b] = PC.union(cs.map(c => c.box)); bob[b] = PC.union(cs.map((c, i) => (dv.get(s0 + i) || { ob: c.box }).ob));
        bsz[b] = Math.max(...cs.map(c => Math.min(c.box[2] - c.box[0], c.box[3] - c.box[1])));
        return edited ? 'edit' : moved ? 'move' : 'still';
      });
      const touch = (b, c) => { const d = 2 * Math.max(bsz[b], bsz[c]); return PC.gap(bnb[b], bnb[c]) <= d || PC.gap(bob[b], bob[c]) <= d; };
      const pushed = new Set();
      for (let grown = true; grown;) {
        grown = false;
        BLK.forEach((_, b) => {
          if (bst[b] !== 'move' || pushed.has(b)) return;
          if ([b - 1, b + 1].some(c => c >= 0 && c < BLK.length && (bst[c] === 'edit' || pushed.has(c)) && touch(b, c))) { pushed.add(b); grown = true; }
        });
      }
      if (dv.size) for (const [b, [s0, e0]] of BLK.entries()) {
        if (bst[b] !== 'move' || pushed.has(b)) continue;
        for (let a0 = s0; a0 < e0;) {
          let a1 = a0 + 1; while (a1 < e0 && C[a1].it === C[a0].it) a1++;
          let t = null, p = -1, ok = true;
          for (let j = a0; j < a1 && ok; j++) {
            const e = dv.get(j);
            if (!e) ok = false;
            else if (!t) { t = e.t; p = e.p; }
            else if (e.p !== p || Math.abs(e.t[0] - t[0]) > 0.5 || Math.abs(e.t[1] - t[1]) > 0.5) ok = false;
          }
          const run = [a0, a1]; a0 = a1;
          if (!ok || Math.hypot(t[0], t[1]) < MOVE.txt) continue;
          const cs = C.slice(run[0], run[1]), nb = PC.union(cs.map(c => c.box)), ob = PC.union(cs.map((c, i) => dv.get(run[0] + i).ob)), [cx, cy] = PC.center(nb);
          if (vmoves.some(v => v.p === p && Math.abs(v.t[0] - t[0]) <= 1 && Math.abs(v.t[1] - t[1]) <= 1 && v.boxes.some(r => cx >= r[0] - 3 && cx <= r[2] + 3 && cy >= r[1] - 3 && cy <= r[3] + 3))) continue;
          if (vis.some(r => cx >= r[0] && cx <= r[2] && cy >= r[1] && cy <= r[3])) continue;
          tms.push({ t, p, nb, ob, n: cs.length, sz: Math.max(...cs.map(c => Math.min(c.box[2] - c.box[0], c.box[3] - c.box[1]))) });
        }
      }
      //   (動きが少しずつ違うもの(図の中の注記を組み直した所など)も、3pt(約1mm)以内の違いで近いものは1件にする。動きは幅で示す)
      const gap = MOVE.gap / k, tg = [], nearG = (g, x) => g.p === x.p && g.nbs.some(b => x.nbs.some(c => Math.max(b[0], c[0]) - Math.min(b[2], c[2]) <= gap && Math.max(b[1], c[1]) - Math.min(b[3], c[3]) <= gap));
      for (const x of tms) {
        const g = tg.find(g => Math.abs(g.t[0] - x.t[0]) <= 0.5 && Math.abs(g.t[1] - x.t[1]) <= 0.5 && nearG(g, { p: x.p, nbs: [x.nb] }));
        if (g) { g.nbs.push(x.nb); g.obs.push(x.ob); g.n += x.n; g.sz = Math.max(g.sz, x.sz); } else tg.push({ t: x.t, ts: [x.t], p: x.p, nbs: [x.nb], obs: [x.ob], n: x.n, sz: x.sz });
      }
      for (let merged = true; merged;) {
        merged = false;
        for (let i = 0; i < tg.length && !merged; i++) for (let j = i + 1; j < tg.length; j++) {
          const g = tg[i], h = tg[j];
          if (!nearG(g, h) || !g.ts.every(a => h.ts.every(c => Math.abs(a[0] - c[0]) <= 3 && Math.abs(a[1] - c[1]) <= 3))) continue;
          const n = g.n + h.n;
          tg[i] = { t: [0, 1].map(e => (g.t[e] * g.n + h.t[e] * h.n) / n), ts: [...g.ts, ...h.ts], p: g.p, nbs: [...g.nbs, ...h.nbs], obs: [...g.obs, ...h.obs], n, sz: Math.max(g.sz, h.sz) };
          tg.splice(j, 1); merged = true; break;
        }
      }
      //   字を直した所(変わった字・消えた字)のすぐ近く(字の大きさの2倍以内)で動いたものは、直したことで後ろがずれた(追い込み・送り)とみなし、
      //   出さない(その所は文字の違いの項目が示している。字の枠ごと動かした所は、まわりの字を直していないことが多い)
      const E = [...C.filter((c, j) => o.st[j] !== 1).map(c => c.box), ...o.gone.map(g => { const T = (OLD.pairs[g.p] && OLD.pairs[g.p].Tr) || g.T; return T ? PC.mapBox(T, PC.union(g.cs.map(c => c.box))) : null; }).filter(Boolean)];
      for (const g of tg) {
        const mp = maps.find(m => m.p === g.p); if (!mp || g.n < 3) continue;
        if (g.nbs.some(b => E.some(e => PC.gap(b, e) <= 2 * g.sz))) continue;
        //   見た目の移動の近く(200画素以内)で、動きの違いが 3pt(約1mm)以内のものは、その移動の項目の範囲に入れる(同じ物を動かした所を2件にしない)
        const vm = vmoves.find(v => v.item && v.p === g.p && g.ts.every(a => Math.abs(a[0] - v.t[0]) <= 3 && Math.abs(a[1] - v.t[1]) <= 3) && nearG({ p: g.p, nbs: v.boxes }, g));
        if (vm) { vm.item.more.push(...g.nbs.map(b => [(b[0] - vm.o0[0]) * k, (b[1] - vm.o0[1]) * k, (b[2] - vm.o0[0]) * k, (b[3] - vm.o0[1]) * k])); vm.item.n += g.n; continue; }
        const nb = PC.union(g.nbs), ob = PC.union(g.obs), [cx, cy] = PC.center(nb);
        const d = await pageAt(cx, cy), o0 = d.crop ? [d.crop[0], d.crop[1]] : [0, 0], M0 = pxM(mp.Tr, o0), M = [M0[0], M0[1], M0[2] + k * g.t[0], M0[3] + k * g.t[1], M0[4]];
        const r = b => [(b[0] - o0[0]) * k, (b[1] - o0[1]) * k, (b[2] - o0[0]) * k, (b[3] - o0[1]) * k];
        const vary = g.ts.some(a => Math.abs(a[0] - g.t[0]) > 0.85 || Math.abs(a[1] - g.t[1]) > 0.85);   // 動きが 0.3mm より違うものがある
        (d.moves || (d.moves = [])).push({ nbox: r(nb), more: [], pnb: g.nbs.length > 1 ? g.nbs.map(r) : null, show: `${vary ? '約' : ''}${dirOf(g.t) || 'わずかに'}移動（文字の枠だけ。字は同じ${vary ? '。動きは場所によって少し違う' : ''}）`, same: true, cross: false, n: g.n, absorbed: 0, text: true,
          old: { p: g.p, box: PC.mapBox(PC.invT(mp.Tr), ob).map(v => v * k), M } });
        total++;
      }
    }
    return total;
  }

  // ---- 旧版と成果物の注釈(コメント・図形・テキストボックスなど。ページの中身とは別に、PDFに付く書き込み)の比べ合わせ ----
  //   見た目・文字の比べ合わせは注釈を描かず・読まずに行うので、注釈だけの違いはそこには出ない(そのため注釈だけ違うと0件になった)。
  //   注釈どうしを比べる: 種類とコメントの文字が同じで、旧版の位置を成果物に写すと近いもの(8pt または大きさの半分まで)は同じ注釈(出さない)。
  //   成果物にだけある注釈 → 成果物の書き込み(W)、旧版にだけある注釈 → 旧版の注釈(K。原稿があるときは原稿の指示と重なりうるので、知らせだけ)
  //   返り値: 成果物にだけある数(nw)・旧版にだけある数(old)・成果物に当たるページのない旧版のページの注釈の数(lost)、注釈を描いて表示するページ(showOld・showNew)
  const ANN = { Text: '付箋', FreeText: 'テキストボックス', Line: '線', Square: '四角', Circle: '円', Polygon: '多角形', PolyLine: '折れ線', Highlight: 'マーカー', Underline: '下線', Squiggly: '波線', StrikeOut: '取り消し線', Stamp: 'スタンプ', Caret: '挿入', Ink: '手書き', FileAttachment: '添付ファイル', Sound: '音声', Redact: '墨消し' };
  async function oldAnnots(P, OLD, newDoc, oldDoc, NQ, marks) {
    const k = PC.S, norm = s => (s || '').replace(/\s+/g, ''), r = { nw: 0, old: 0, lost: 0, showOld: new Set(), showNew: new Set() };
    const AO = [], AN = [];
    for (let p = 0; p < oldDoc.numPages; p++) AO.push(await PC.annotations(oldDoc, p));
    for (let q = 0; q < newDoc.numPages; q++) AN.push(await PC.annotations(newDoc, q));
    if (!AO.some(a => a.length) && !AN.some(a => a.length)) return r;
    //   旧版の注釈を、旧版のページが当たる成果物のページの、同じ注釈(写した位置にいちばん近いもの)に当てる
    const usedN = AN.map(a => new Uint8Array(a.length)), oldOnly = [];
    for (let p = 0; p < AO.length; p++) {
      const pr = OLD.pairs[p], T = pr && pr.q >= 0 ? pr.Tr || pr.T : null;
      for (const a of AO[p]) {
        if (!T) { r.lost++; continue; }
        const mb = PC.mapBox(T, a.box.map(v => v / k)).map(v => v * k), [mx, my] = PC.center(mb), tol = Math.max(8 * k, 0.5 * Math.max(mb[2] - mb[0], mb[3] - mb[1]));
        let best = -1, bd = Infinity;
        AN[pr.q].forEach((b, j) => {
          if (usedN[pr.q][j] || b.type !== a.type || norm(b.text) !== norm(a.text)) return;
          const [bx, by] = PC.center(b.box), dd = Math.hypot(bx - mx, by - my);
          if (dd <= tol && dd < bd) { bd = dd; best = j; }
        });
        if (best >= 0) usedN[pr.q][best] = 1; else oldOnly.push({ p, q: pr.q, a, mb, T });
      }
    }
    //   項目を付ける結果のページ(その成果物のページを表示しているページ。なければ「成果物だけ」のページを足す)
    const pageFor = async (q, c) => {
      const ds = P.filter(d => d.q === q && d.kind !== 'none');
      let d = ds.find(d => d.kind !== 'newonly' && !d.crop) || ds.find(d => d.crop && c[0] >= d.crop[0] && c[0] <= d.crop[2]) || P.find(e => e.kind === 'newonly' && e.q === q);
      if (!d) {
        d = { kind: 'newonly', q, src: null, label: null, ch: [], im: [], an: [], notes: [], restBoxes: [], ot: [], nt: [], pairs: [], oc: [], nc: [], extra: [], thumbs: { left: null, right: NQ.has(q) ? NQ.get(q).thumb : null } };
        P.push(d);
      }
      return d;
    };
    //   枠(200dpi の画素): 線の注釈など細いものも見えるように、縦・横とも12画素(約4pt)以上にする
    const fat = b => { const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, w = Math.max(12, b[2] - b[0]), h = Math.max(12, b[3] - b[1]); return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]; };
    const put = async (q, box, x) => {
      const d = await pageFor(q, PC.center(box).map(v => v / k)), o0 = d.crop ? [d.crop[0], d.crop[1]] : [0, 0];
      (d.anns || (d.anns = [])).push({ ...x, nbox: fat([box[0] - o0[0] * k, box[1] - o0[1] * k, box[2] - o0[0] * k, box[3] - o0[1] * k]), o0 });
    };
    for (let q = 0; q < AN.length; q++) for (let j = 0; j < AN[q].length; j++) {
      if (usedN[q][j]) continue;
      const b = AN[q][j];
      await put(q, b.box, { cat: 'W', type: b.type, reply: !!b.irt, text: b.text });
      r.nw++; r.showNew.add(q);
    }
    for (const x of oldOnly) {
      r.old++; r.showOld.add(x.p); r.showNew.add(x.q);
      if (marks) continue;   // 原稿があるときは、原稿の指示と同じ注釈のことがあるので、項目にせず知らせだけにする
      await put(x.q, x.mb, { cat: 'K', type: x.a.type, reply: !!x.a.irt, text: x.a.text, old: { p: x.p, box: fat(x.a.box), T: x.T } });
    }
    //   注釈を描いて表示する成果物のページに当たる旧版のページも、注釈を描いて表示する(パタパタ表示で、同じ注釈がちらつかないように)
    for (const q of r.showNew) for (const m of (OLD.byQ.get(q) || { maps: [] }).maps) r.showOld.add(m.p);
    return r;
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
    //   消えただけのとき、原稿で消えた字が後ろの字にすき間なく続き、前の字とは離れている(行・表のセルの境目)なら、後ろの字の前に付ける
    //   (行・セルの頭の字が消えたときに、前の行・セルの終わりに印を付けない)
    const headDel = () => {
      if (!ab.length || bb.length) return false;
      const aAt = q => { const o = ops[q]; return o && o[0] !== '+' && o[0] !== '|' ? cs[o[1]].box : null; };
      const ap = aAt(h.s - 1), an = aAt(h.e), a0 = ab[0], a1 = ab[ab.length - 1], sz = Math.max(1, Math.min(a0[3] - a0[1], a0[2] - a0[0]));
      return !!an && PC.gap(a1, an) < 0.3 * sz && (!ap || PC.gap(ap, a0) >= 0.5 * sz);
    };
    const caretOf = side => {
      const p = near(side, -1), n = near(side, 1);
      if (n && side === 'B' && headDel()) return [n[0] - 1, n[1], n[0] + 1, n[3]];
      if (p) return [p[2] - 1, p[1], p[2] + 1, p[3]]; if (n) return [n[0] - 1, n[1], n[0] + 1, n[3]]; return null;
    };
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
  // 注釈のコメントを行ごとに見分ける: text 成果物に載るはずの文字(「2,900」「週末」「※…ご覧ください。」など)、drop 消す字(「※トル」の「※」。空はマーカーの下の字)、
  //   ask 依頼・質問・やり方の説明、reply 返事・お礼・宛先、file 素材のファイル名・URL。返信は「（返信）」から始まる
  const ASK_END = /([？?]|でしょうか|ませんか|ますか|ください|下さい|願います|ほしい|欲しい)[。．.！!…]*$/, ASK_ANY = /でしょうか|いただけない|いただけます|頂けます|ご検討|可能ですか/;
  const REPLY = /ありがとう|大丈夫です|承知|了解|問題ありません|問題ないです|ＯＫです|OKです|そのままで|そのように|申し訳|よろしく/;
  const LAYW = /揃え|そろえ|調整|字間|行間|中央|大きく|小さく|ぼか|アキ|寄せ|詰め|改行|追い?込|太字|細字|差し?替|入れ替|移動|配置|位置/;
  function noteParts(note) {
    const r = { text: [], drop: [], ask: [], reply: [], file: [] };
    let inReply = false;
    for (const raw of String(note || '').split(/\n+/)) {
      const t = raw.replace(/\s+/g, '');
      if (!t || /^[-ー－—―─=＝_＿]{3,}$/.test(t)) continue;   // 区切りの線(「、」「・」だけの行は、その字を入れる指示として読む)
      if (t.startsWith('（返信）')) inReply = true;
      if (inReply || /^[@＠]/.test(t)) { r.reply.push(t); continue; }
      if (/^https?:\/\//i.test(t) || /\.(ai|eps|psd|png|jpe?g|tiff?|gif|svg|pdf|indd)$/i.test(t)) { r.file.push(t); continue; }
      const dm = t.match(/^(.{0,12}?)(トルツメ|トル|削除)$/);
      if (dm) { r.drop.push(dm[1]); continue; }
      if (/^[※＊*]/.test(t)) { r.text.push(t); continue; }
      const body = t.replace(/[（(][^）)]*(以下同様|全体|ママ|イキ|同様)[^）)]*[）)]/g, '');   // 「目指し（以下同様）」の添え書きは外す
      const core = t.replace(/[（(][^）)]*[）)][。．.]*$/, '');   // 文の終わりのかっこ書き(おわびなど)は外して見る
      if (REPLY.test(core)) r.reply.push(t);
      else if (ASK_END.test(core) || ASK_ANY.test(core) || ([...t].length <= 15 && LAYW.test(t))) r.ask.push(t);
      else if (body) r.text.push(body);
    }
    return r;
  }
  //   載るはずの文字は、変化の所(ctxOf)かマーカーの所の成果物の文字にあるか。消す字は、マーカーの所に残っていないか
  //   依頼・質問・素材の指定がまじるコメントは、文字があっても自動では決めない(人が判断)
  function noteCheck(d, c, a, ctxOf) {
    const P_ = noteParts(a.note), fk = s => [...String(s)].map(PC.fold).join('');
    const atMark = w => { const qs = a.quads && a.quads.length ? a.quads : a.box ? [a.box] : []; return qs.map(q => around(d.nc, q, [...w].length + 3)).join('\u0000'); };
    if (P_.drop.length) {
      const left = P_.drop.filter(x => (x ? fk(atMark(x)).includes(fk(x)) : !(c.tag === 'delete' || !c.after)));
      if (left.length) return { chk: '削除されていない可能性（要確認）' };
      return { chk: P_.text.length || P_.ask.length || P_.file.length ? '削除を確認。ほかの指示は人が確認' : '削除を確認（自動確認OK）' };
    }
    if (P_.text.length) {
      //   マーカーの下の字が、まるごと別の字に置き換わったとき(文字データの違いの「消えた字」＝マーカーの下の字)は、近くにその字があるかでなく、
      //   その所の字そのものと指示の字を比べる:
      //     置き換わったあとの字(文字データの違いの「入った字」)か、成果物のマーカーの位置にある字が、指示の字とちょうど同じ → 指示どおり(1字の指示でも確か)
      //     指示が1〜2字で、入った字に指示の字が含まれない → 指示どおりでない(近くにたまたま同じ字があっても、置き換わった字は違う)
      //   それ以外(入った字が文字データで対応づいていない・指示が長く、入った字が何個かの違いに分かれているかもしれない)は、下の探し方で決める
      const segs = (c.fromText || c.txt) && c.diff && c.diff.segs, cat = t => (segs || []).filter(g => g[0] === t).map(g => g[1]).join('').replace(/\s/g, '');
      if (window.__pcDebug) (PC._nc = PC._nc || []).push({ note: a.note, under: a.under, minus: cat('-'), plus: cat('+'), fromText: !!c.fromText, txt: !!c.txt, box: a.box });   // 調べるとき用
      if (segs && P_.text.length === 1 && !P_.ask.length && !P_.file.length && a.under && cat('-') && fk(cat('-')) === fk(String(a.under).replace(/\s/g, ''))) {
        const w = P_.text[0], plus = cat('+'), qs = a.quads && a.quads.length ? a.quads : a.box ? [a.box] : [];
        const inQ = d.nc.filter(([, b]) => { const x = (b[0] + b[2]) / 2, y = (b[1] + b[3]) / 2; return qs.some(q => x >= q[0] - 1 && x <= q[2] + 1 && y >= q[1] - 1 && y <= q[3] + 1); })
          .sort((p, q) => (p[1][0] - q[1][0]) || (p[1][1] - q[1][1])).map(x => x[0]).join('').replace(/\s/g, '');
        if (fk(plus) === fk(w) || fk(inQ) === fk(w)) return { chk: '指示文が修正後にある（自動確認OK）', want: w, sure: true };
        if ([...w].length <= 2 && plus && !fk(plus).includes(fk(w))) return { chk: '指示文が修正後に見当たらない（要確認）', want: w };
      }
      //   マーカーの所の字そのものを比べる(結びついた違いが、マーカーの所から1字ずれていたり、置き換えが「消えた」と「入った」に分かれていたりしても判定できるように)。
      //   1行のマーカー(横組み)で、マーカーの左右に字の高さ分だけ広げた所の、原稿の字と成果物の字が同じ字数で、マーカーの外の字がすべて同じ(字が詰まっていない)ときだけ:
      //     成果物のマーカーの中の字全体、またはその中の変わった字が、指示の字とちょうど同じ → 指示どおり(1字の指示でも確か)
      //     変わった字が指示と同じ字数で、指示の字と違う(指示が1〜2字) → 指示どおりでない
      if (P_.text.length === 1 && !P_.ask.length && !P_.file.length) {
        const w0 = fk(P_.text[0].replace(/\s/g, '')), qs = a.quads && a.quads.length ? a.quads : a.box ? [a.box] : [];
        if (qs.length === 1 && qs[0][2] - qs[0][0] >= 0.5 * (qs[0][3] - qs[0][1])) {
          const q = qs[0], m = q[3] - q[1], inR = (b, r) => { const x = (b[0] + b[2]) / 2, y = (b[1] + b[3]) / 2; return x >= r[0] - 1 && x <= r[2] + 1 && y >= r[1] - 1 && y <= r[3] + 1; };
          const pick = cs => cs.filter(([c, b]) => String(c).trim() && inR(b, [q[0] - m, q[1], q[2] + m, q[3]])).sort((p, r) => p[1][0] - r[1][0]).map(([c, b]) => ({ c: fk(c), inM: inR(b, q) }));
          const U = pick(d.oc), N = pick(d.nc);
          //   成果物のマーカーの中の字が、指示の字とちょうど同じで、原稿のマーカーの中の字と違う → 指示どおり(まわりの字のずれは問わない。欧文など字の幅が
          //   まちまちな所では、1字替えると後ろの字が少しずれるため)
          const mU = U.filter(x => x.inM).map(x => x.c).join(''), mN = N.filter(x => x.inM).map(x => x.c).join('');
          if (mN && mN === w0 && mN !== mU) return { chk: '指示文が修正後にある（自動確認OK）', want: P_.text[0], sure: true };
          if (U.length && U.length === N.length && U.every((u, k) => u.inM === N[k].inM && (u.inM || u.c === N[k].c))) {
            const inN = N.filter(x => x.inM).map(x => x.c).join(''), chg = N.filter((x, k) => x.inM && x.c !== U[k].c).map(x => x.c).join('');
            if (chg && (inN === w0 || chg === w0)) return { chk: '指示文が修正後にある（自動確認OK）', want: P_.text[0], sure: true };
            if (chg && [...chg].length === [...w0].length && [...w0].length <= 2) return { chk: '指示文が修正後に見当たらない（要確認）', want: P_.text[0] };
          }
        }
      }
      const has = w => (fk(ctxOf(w)) + '\u0000' + fk(atMark(w))).includes(fk(w)), miss = P_.text.filter(w => !has(w));   // 載るはずの文字は、行ごとにすべてあるか
      if (!P_.ask.length && !P_.file.length) return miss.length ? { chk: '指示文が修正後に見当たらない（要確認）', want: miss[0] } : { chk: '指示文が修正後にある（自動確認OK）', want: P_.text.join('') };
      return { chk: miss.length ? '指示の内容を確認（人が判断）' : '指示の文字は修正後にある。ほかの指示は人が確認' };
    }
    return { chk: '指示の内容を確認（人が判断）' };
  }
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
      const ink = med(bj.map(j => (B.chars[j].sty || {}).ink || 0)), page = med(B.chars.filter(c => !c.ocr).map(c => (c.sty || {}).ink || 0));
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
      //   グラフの値のもとの行で、成果物に表として見当たらないもの: グラフの項目名・値で確かめるので出さない
      if (b.chartsrc && b.ops.length && b.ops.every(o => o[0] === '-')) continue;
      const vs = [];
      for (const h of PC.hunksOf(b.ops, cs, B)) {
        const r = hunkView(b.ops, h, cs, B);
        // 旧版があるとき: 違う字の所が旧版と同じ(前回のまま=直っていない)か、旧版からも変わったか
        const hj = b.ops.slice(h.s, h.e).map(o => (o.length === 3 ? o[2] : o[0] === '+' ? o[1] : -1)).filter(j => j >= 0);
        r.vsOld = d.oldSt && hj.length ? (hj.every(j => d.oldSt[j] === 1) ? 'same' : 'changed') : null;
        if (h.variant || (d.pr.free && unitOnly(b.ops, h, cs, B))) { vs.push(r); continue; }
        //   OCR で読んだ字がかかわる違い(違う所か、そのすぐ前後の字が OCR の字)
        const near = [h.s - 1, h.e].map(k => b.ops[k]).filter(o => o && o.length === 3).map(o => o[2]);
        const ocr = [...hj, ...near].some(j => B[j] && B[j].ocr);
        pend.push({ cat: 'T', box: px(r.box || box), nbox: px(r.nbox || toNew(r.box || box)), segs: r.segs, pboxes: r.box ? [px(r.box)] : [], pnboxes: r.nbox ? [px(r.nbox)] : [], approx: !r.nbox, ref: refOf.get(b.s), gone: d.A.order && b.ops.length > 0 && b.ops.every(o => o[0] === '-') ? d.A.order.get(b.s) : -1, vsOld: r.vsOld, ocr });
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
          //   違いの表示には、まとめたまとまりの文を(10まで)「…」で区切って並べる(1つ目の文だけにしない)
          const segs = []; run.slice(0, 10).forEach((y, i) => { if (i) segs.push(['=', '…']); segs.push(...y.segs); });
          Object.assign(x, { segs, goneN: run.length, refs: run.map(y => y.ref).filter(Boolean), moreBoxes: rest.map(y => y.box), moreNboxes: [] });
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
        if (x.ocr || rest.some(y => y.ocr)) f.ocr = true;
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
          //   数字のまとまりの中で消えた旧版の字(gin)は、その位置に「旧版の字」として入れる
          const done = new Set(), gone = j => { if (e.gin.has(j) && !done.has(j)) { done.add(j); push('-', e.gin.get(j)); } };
          e.jss.forEach((js, n) => { if (n) push('=', ' ／ '); js.forEach((j, i) => { const pj = js[i - 1]; if (i && (B[j].sp || B[j].it !== B[pj].it) && PC.DIGC.test(B[j].c) && PC.DIGC.test(B[pj].c)) push('=', ' '); gone(j); const st = e.os.st[j]; if (st === 1) push('=', B[j].c); else { if (st >= 2 && e.os.oc[j]) push('-', e.os.oc[j]); push('+', B[j].c); } }); gone(js[js.length - 1] + 1); });
          const m = e.os.maps.find(x => !x.noText) || e.os.maps[0];
          //   書き方だけの変化(全角・半角など)だけなら「全角・半角などの違い」に分ける
          const varOnly = !e.gin.size && e.jss.every(js => js.every(j => e.os.st[j] === 1 || e.os.st[j] === 3)), cat = varOnly ? 'V' : 'C2';
          Object.assign(f, { cat, label: PC.CAT[cat], how: varOnly ? '旧版から書き方だけ変わった所（全角・半角など）' : '旧版から変わった所（原稿のない部分）', fromOld: 'add', newOnly: true, segs, same: false, old: m ? { p: m.p, box: px(PC.mapBox(PC.invT(m.T), e.nbox)) } : null });
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
  // ---- 同じ所を指す、旧版との比べ合わせの項目を1件にまとめる ----
  //   文字の違い・見た目の違い・移動・図形の文字の項目のうち、違う所ごとの枠どうしが重なるか 2pt 以内に接するものを、つながるかぎりまとめる
  //   (同じ所に2つ以上の項目があると、同じ所を何度も確かめることになり、手間が増え、見逃しもしやすくなる)。ただし、まとめた枠がその
  //   ページの 15% を超えるならまとめない(1件に入れすぎて、かえって確かめにくくならないように。大きな移動の範囲などは、そのまま1件)。
  //   まとめた項目は、中の項目(parts)を位置の順に持ち、違う所ごとの枠をすべて描く。一覧での種類は、文字の違いがあればその項目の種類。
  //   成果物だけで見るチェック・注釈の違いは、観点が違うのでまとめない
  const SAME = { kinds: new Set(['add', 'del', 'look', 'move', 'shape']), gap: 2, cap: 0.15 };
  function mergeSame(F, pages) {
    const M2 = SAME.gap * PC.S, area = b => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
    const boxesOf = f => [...(f.pnboxes && f.pnboxes.length ? f.pnboxes : [f.nbox]), ...(f.moreNboxes || [])].filter(Boolean);
    const touch = (a, b) => a.some(p => b.some(q => Math.min(p[2], q[2]) + M2 > Math.max(p[0], q[0]) && Math.min(p[3], q[3]) + M2 > Math.max(p[1], q[1])));
    const byPage = new Map(), drop = new Set();
    for (const f of F) if (SAME.kinds.has(f.fromOld) && f.nbox) (byPage.get(f.page) || byPage.set(f.page, []).get(f.page)).push(f);
    const rank = { add: 0, del: 0, look: 1, move: 2, shape: 3 }, pos = (a, b) => a.nbox[1] - b.nbox[1] || a.nbox[0] - b.nbox[0];
    for (const [pg, fs] of byPage) {
      const im = pages[pg - 1], A = im && im.right ? im.right.w * im.right.h : Infinity;   // そのページの面積(画素)
      const gs = fs.map(f => ({ fs: [f], bs: boxesOf(f) }));
      for (let merged = true; merged;) {
        merged = false;
        for (let i = 0; i < gs.length && !merged; i++) for (let j = i + 1; j < gs.length; j++) {
          if (!touch(gs[i].bs, gs[j].bs) || area(PC.union([...gs[i].bs, ...gs[j].bs])) > SAME.cap * A) continue;
          gs[i] = { fs: [...gs[i].fs, ...gs[j].fs], bs: [...gs[i].bs, ...gs[j].bs] }; gs.splice(j, 1); merged = true; break;
        }
      }
      for (const g of gs) {
        if (g.fs.length < 2) continue;
        const base = g.fs.slice().sort((a, b) => rank[a.fromOld] - rank[b.fromOld] || pos(a, b))[0];
        //   中の項目: 表示に使うものだけを写す(位置の順)
        base.parts = g.fs.slice().sort(pos).map(f => ({ cat: f.cat, fromOld: f.fromOld, show: f.show, how: f.how, segs: f.segs, same: f.same, para: f.para, ocr: f.ocr, fill: f.fill, fills: f.fills, lookText: f.lookText, inMove: f.inMove, replaced: f.replaced, moveSame: f.moveSame, moveText: f.moveText, shape: f.shape, nbox: f.nbox }));
        const seen = new Set();
        base.pnboxes = g.bs.filter(b => { const k = b.map(Math.round).join(','); if (seen.has(k)) return false; seen.add(k); return true; });
        base.moreNboxes = []; base.nbox = PC.union(g.bs).map(Math.trunc); base.box = base.nbox.slice();
        base.kinds = [...new Set(g.fs.map(f => f.fromOld === 'del' ? 'add' : f.fromOld))];
        if (g.fs.some(f => f.ocr)) base.ocr = true;
        //   旧版の切り抜き: 同じ旧版のページ・同じ位置合わせの項目の、旧版の所をまとめる(動かした所は位置合わせが違うので、まとめない)
        const sameM = o => o && base.old && o.p === base.old.p && JSON.stringify(o.M) === JSON.stringify(base.old.M);
        if (base.old && base.old.box) { const ob = g.fs.map(f => f.old).filter(o => sameM(o) && o.box).map(o => o.box); if (ob.length) base.old = { ...base.old, box: PC.union(ob) }; }
        for (const f of g.fs) if (f !== base) drop.add(f);
      }
    }
    if (!drop.size) return;
    const keep = F.filter(f => !drop.has(f));
    F.length = 0; keep.forEach((f, i) => { f.id = i; F.push(f); });
  }
  PC.analyze = async opts => {
    const { marks: src, newDoc } = opts, prog = opts.progress || (() => {});
    const cb = new PC.Codebook(), P = [], npages = src.numPages, warn = [];
    // 進み具合のバー: 段階ごとの見込みの時間(PC.COST)で割り振る(PC.progressPlan)。照合の方法(原稿・旧版・成果物だけ)で通る段階が違うので、
    //   通る段階だけを並べる。原稿のページの種類は、最初はファイルごとに1ページ目で決め、ページの対応が分かったら(対応のないページ・
    //   レイアウトの違うページ)残りを割り振り直す
    const C = PC.COST, nNew = newDoc.numPages, oldDoc = opts.oldDoc, nOld = oldDoc ? oldDoc.numPages : 0, G = PC.progressPlan(prog);
    const costKind = async p => {
      const it = src.page(p);
      if (it.virt) return 'data';
      if (!it.doc) return 'scan';
      if ((await src.kind(p)) === 'annot') return 'annot';
      return (await PC.isDigitalPage(it.doc, it.i)) ? 'digital' : 'scan';
    };
    const kinds = [];
    for (const part of src.parts || []) { const k = part.pages ? await costKind(part.start) : null; for (let j = 0; j < part.pages; j++) kinds.push(src.page(part.start + j).virt ? 'data' : k); }
    while (kinds.length < npages) kinds.push('scan');
    const pageCost = (p, pairs) => {
      const k = kinds[p], pr = pairs && pairs[p];
      if (pr && pr.q < 0) return C.page.none;
      if (pr && !pr.same && k !== 'data') return src.page(p).doc ? C.page.content : C.page.none;
      return C.page[k === 'scan' && oldDoc ? 'scan3' : k];
    };
    const needOldP = pairs => !!oldDoc && kinds.some((k, p) => (k === 'scan' || k === 'digital') && (!pairs || (pairs[p].q >= 0 && pairs[p].same)));
    const plan = pairs => G.plan([
      ['pair', !pairs && npages ? C.pairNew * nNew + kinds.reduce((t, k) => t + C.pairSrc[k], 0) + C.pairMatch * nNew * npages : 0],
      ['oldp', needOldP(pairs) ? C.pairNew * nNew + C.pairOld * nOld : 0],
      ...kinds.map((_, p) => ['page' + p, pageCost(p, pairs)]),
      ['old', oldDoc ? C.pairNew * nNew + (C.pairOld + C.oldCmp) * nOld : 0],
      ['shape', C.shape * nNew + 0.05],
      ['looks', oldDoc ? C.oldLook * nOld : 0],
      ['check', C.checkBase + C.check * nNew],
      ['final', C.final + (oldDoc ? C.oldThumb * nOld : 0)],
    ]);
    plan(null);
    //   メモリの上限の目安(PC.MEM)を超えそうな大きなページ(描いたときの画素数が多いもの)を知らせる
    {
      const big = [], k2 = (PC.DPI / 72) ** 2;
      const check = async (doc, n, name) => {
        if (!doc) return;
        const ps = [];
        for (let i = 0; i < n; i++) { const vp = (await doc.getPage(i + 1)).getViewport({ scale: 1 }); if (vp.width * vp.height * k2 > PC.MEM.px) ps.push(i + 1); }
        if (ps.length) big.push(`${name}の${spans(ps)}ページ目`);
      };
      await check(newDoc, nNew, '成果物'); await check(oldDoc, nOld, '旧版');
      for (const d of src.docs || []) await check(d, d.numPages, '原稿');
      if (big.length) warn.push(`${big.join('・')}は大きいため、照合中のメモリが上限の目安（${PC.MEM.mb}MB）を超えることがあります（A3見開きまでのページで、上限に収まることを確かめています）`);
    }
    // 1) 原稿の各ページが、成果物のどのページのどの範囲に当たるか
    const pairs = npages ? await PC.pairPages(src, newDoc, (s, f) => G.at('pair', s, f)) : [];   // 原稿がなければ、成果物だけをチェックする
    if (npages) plan(pairs);
    // 成果物のページの描画・文字データ・書き込みは、内容で照合するページのために1回だけ作る
    const NQ = new Map();
    const newPage = async q => {
      if (NQ.has(q)) return NQ.get(q);
      const img = await PC.renderPage(newDoc, q, PC.DPI, false), B = await PC.pageText(newDoc, q);
      PC.snapChars(B, img, PC.S);
      for (const c of B.chars) c.sty = styleOf(img, c.box.map(x => x * PC.S));   // 字の見た目(書式の指示の確認用)
      const v = { B, doc: newDoc, q, notes: PC.designerNotes(B, img, PC.S), used: new Uint8Array(B.chars.length), usedFree: new Uint8Array(B.chars.length), thumb: await toThumb(img) };
      NQ.set(q, v);
      return v;
    };
    //   紙の赤字原稿と旧版があるとき: 旧版の各ページが成果物のどのページに当たるか(赤字原稿が旧版を刷ったものなら、変化は旧版と成果物のPDFどうしで求める)
    let OLDP = null; const s3 = [];
    if (opts.oldDoc && npages) {
      const osrc = { numPages: opts.oldDoc.numPages, page: p => ({ doc: opts.oldDoc, i: p }), label: () => null, image: async p => ({ img: await PC.renderPage(opts.oldDoc, p, 300, false), dpi: 300 }) };
      for (let p = 0; p < npages; p++) if (!src.page(p).virt && pairs[p].q >= 0 && pairs[p].same && (await src.kind(p)) !== 'annot') { OLDP = await PC.pairPages(osrc, newDoc, (s, f) => G.at('oldp', '旧版との対応：' + s, f), '旧版'); break; }
    }
    //   成果物のページ q に、大きさ・位置がそろって当たる旧版のページ(なければ null)
    const sameOld = q => { if (!OLDP) return null; const i = OLDP.findIndex(x => x.q === q && x.same && x.T && Math.abs(x.T[0] - 1) < 0.01 && Math.abs(x.T[1]) < 0.01 && Math.abs(x.T[2]) < 3 && Math.abs(x.T[3]) < 3 && Math.abs((x.T.length > 4 ? x.T[4] : x.T[0]) - 1) < 0.01); return i >= 0 ? { p: i, pr: OLDP[i] } : null; };
    //   メモリを抑える: PDFの読み込み部品(pdf.js)が抱えている、描いたページの画像・字の形などを手放す(描き直すときは読み直す)。
    //   ページごと・段階ごとに行う(手放さないと、画像の多いページでは何百MBもたまる)
    const relax = async () => { for (const d of [newDoc, oldDoc, ...(src.docs || [])]) if (d && d.cleanup) { try { await d.cleanup(); } catch (e) { /* 描いている途中なら、次の機会に */ } } };
    // 2) ページごとに照合: 同じレイアウトなら字形を重ねて比べ、レイアウトが違えば文字データの内容で比べる
    for (let p = 0; p < npages; p++) {
      if (p) await relax();
      const step = (s, f) => G.at('page' + p, `${p + 1} / ${npages} ページ：${s}`, f);
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
      //   原稿の比べ方: 注釈と文字データのあるPDFは注釈PDF、それ以外はスキャンとして扱う(src.kind)。ただし、PDFのページが成果物と同じ
      //   データから書き出したもの(描画を重ねて測る: sameSource)なら、文字データ・ページを覆う画像がなくても紙のスキャンではないので、
      //   注釈があれば注釈PDFとして(注釈を指示として読み、注釈を消した描画を画素で成果物と比べる)、なければスキャンでないPDFとして比べる
      let kind = await src.kind(p), same = false;
      const it0 = src.page(p);
      if (kind === 'scan' && it0.doc && !pr.crop && ((await PC.annotations(it0.doc, it0.i)).length || !(await PC.isDigitalPage(it0.doc, it0.i)))) {
        same = await sameSource(it0.doc, it0.i, newDoc, pr.q);
        if (same && (await PC.annotations(it0.doc, it0.i)).length) kind = 'annot';
      }
      let nw = await PC.renderPage(newDoc, pr.q, PC.DPI, false), nc = await PC.textCharsSnapped(newDoc, pr.q, nw);
      if (pr.crop) {   // 原稿のページが成果物のページの一部(見開きの片側など)に当たる: その部分だけを切り出して比べる
        const [x0, y0, x1, y1] = pr.crop.map(v => Math.round(v * PC.S));
        nw = PC.crop(nw, x0, y0, x1, y1);
        nc = nc.filter(([, b]) => (b[0] + b[2]) / 2 >= x0 && (b[0] + b[2]) / 2 < x1 && (b[1] + b[3]) / 2 >= y0 && (b[1] + b[3]) / 2 < y1).map(([c, b]) => [c, [b[0] - x0, b[1] - y0, b[2] - x0, b[3] - y0]]);
      }
      //   紙の赤字原稿で、成果物のページに大きさ・位置のそろう旧版があれば、変化は旧版と成果物のPDFどうしで求める
      const op0 = kind !== 'annot' && !same ? sameOld(pr.q) : null, op = op0 && !(await src.image(p)).digital ? op0 : null;
      const d3 = op ? await scan3Page(src, p, pr, op, opts.oldDoc, newDoc, nw, step) : null;
      if (d3) {
        s3.push({ p: p + 1, n: d3.groups.length });
        d3.q = pr.q; d3.crop = pr.crop; d3.extra = [];
        d3.thumbs = { left: await toThumb(d3.left), right: await toThumb(d3.right) }; d3.left = d3.right = null;
        put(d3); continue;
      }
      const d = kind === 'annot' ? await annotPage(src, p, nw, nc, cb, step, { doc: newDoc, q: pr.q, crop: pr.crop }) : await scanPage(src, p, nw, nc, step, { doc: newDoc, q: pr.q, crop: pr.crop }, same);
      if (d.kind === 'scan' && d.matched < 40) warn.push(`${p + 1}ページ目は、原稿と成果物の位置がうまく合いません（ページの向きを確かめてください）`);
      step('表示用の画像を作成', 0.96); await PC.tick();
      d.q = pr.q; d.crop = pr.crop; d.extra = [];
      d.thumbs = { left: await toThumb(d.left), right: await toThumb(d.right), ...(d.base ? { base: await toThumb(d.base) } : {}) }; d.left = d.right = d.base = null;
      put(d);
    }
    await relax();
    scan3Resolve(P);   // 紙の赤字原稿＋旧版: 同じ成果物のページの赤字と変化を、ページ全体でまとめて突き合わせる
    if (s3.length) {
      warn.push(`紙の赤字原稿（${spans(s3.map(x => x.p))}ページ目）は旧版を刷ったものとして、変化を旧版と成果物のPDFどうしで求め、赤字の近くかどうかで分けました（取り出した赤字 ${s3.reduce((t, x) => t + x.n, 0)}か所）`);
      const still = P.filter(d => d.kind === 'scan3').reduce((t, d) => t + d.groups.filter(g => !g.changed).length, 0);
      if (still) warn.push(`近くが旧版から変わっていない赤字が ${still}か所あります（「指示・書き込みの確認」の中）。直す指示なら直っていません。見本・参考として書いた赤字なら問題ありません`);
    }
    // 成果物の全ページの文字データ(商品ごとの照合・成果物だけで見るチェックに使う)
    const JP = [];
    for (let q = 0; q < newDoc.numPages; q++) JP.push({ q, B: NQ.has(q) ? NQ.get(q).B : await PC.pageText(newDoc, q) });
    G.at('old', '表の商品ごとの照合'); await PC.tick();
    await mergePages(P, src, JP, newDoc, NQ, warn);
    await recordPages(P, src, JP, newDoc, NQ);
    // 旧版(任意)があれば、成果物の字が旧版から変わったかを求める(原稿のない部分の変化・前回のままの見分けに使う)
    const OLD = opts.oldDoc ? await oldDiff(opts.oldDoc, newDoc, NQ, (s, f) => G.at('old', s, f), JP) : null;
    if (OLD) await relax();
    if (OLD) for (const d of P) if (d.kind === 'content' && OLD.byQ.has(d.q)) d.oldSt = OLD.byQ.get(d.q).st;
    leftovers(P, NQ, OLD && OLD.byQ);
    if (OLD) await oldChanges(P, OLD, newDoc);
    //   文字データのない文字(図形の文字・ロゴ)の所: 文字としては確かめていない所・旧版から見た目が変わった所
    G.at('shape', '文字データのない文字の所を調べています'); await PC.tick();
    const SH = await shapeSpots(P, newDoc, JP, OLD ? { ...OLD, doc: opts.oldDoc } : null, f => G.at('shape', '文字データのない文字の所を調べています', f));
    if (SH.total) warn.push(`文字が図形になっていて文字データのない所が ${SH.total}か所あり、文字としては確かめていません（一覧の「文字として確かめていない所」。見た目で比べたページは除く）`);
    await relax();
    //   旧版から見た目が変わった所(写真・図版・色・線など。文字の変化・字の移動で説明できない描画の違い)
    if (OLD) { G.at('looks', '旧版から見た目が変わった所を調べています'); await PC.tick(); await oldLooks(P, OLD, newDoc, opts.oldDoc, f => G.at('looks', '旧版から見た目が変わった所を調べています', f), relax); }
    //   旧版と成果物の注釈(コメント・図形などの書き込み)の違い
    if (OLD) await relax();
    const AR = OLD ? await oldAnnots(P, OLD, newDoc, opts.oldDoc, NQ, npages > 0) : null;
    if (OLD) await relax();
    if (AR && AR.nw) warn.push(`成果物のPDFに、旧版にない注釈（コメント・図形などの書き込み）が ${AR.nw}件あります（一覧の「指示・書き込みの確認」の中）。校正の赤字なら、このPDFを「原稿」の欄に入れて、直した成果物と比べると、指示どおりに直っているかを確かめられます`);
    if (AR && AR.old) warn.push(npages ? `旧版のPDFにあった注釈（コメント・図形などの書き込み）${AR.old}件が、成果物にはありません（原稿の欄の指示と同じものなら問題ありません。別のものなら、旧版を原稿の欄にも入れて確かめてください）`
      : `旧版のPDFにあった注釈（コメント・図形などの書き込み）${AR.old}件が、成果物にはありません（一覧の「指示・書き込みの確認」の中）。旧版に書き込んだ赤字の指示なら、旧版を「原稿」の欄に入れると、指示どおりに直っているかを確かめられます`);
    if (AR && AR.lost) warn.push(`旧版の注釈 ${AR.lost}件は、そのページが成果物のどのページに当たるか分からないため、比べていません`);
    //   旧版と比べられなかったページ(黙って0件にしないように知らせる)
    if (OLD) {
      const unp = OLD.pairs.map((x, p) => (x.q < 0 && !(OLD.movedFrom && OLD.movedFrom.has(p)) ? p + 1 : 0)).filter(Boolean), mvp = OLD.movedFrom ? [...OLD.movedFrom].filter(p => OLD.pairs[p].q < 0).sort((x, y) => x - y).map(p => p + 1) : [];
      if (unp.length) warn.push(`旧版の${spans(unp)}ページ目は、成果物のどのページにも当たらなかったため、比べていません`);
      if (mvp.length) warn.push(`旧版の${spans(mvp)}ページ目は、ページとしては成果物に当たりませんでしたが、中身が成果物のページに移っていました（一覧の「移動した所」。移っていない部分は比べていません）`);
      const noLook = [...OLD.byQ.values()].flatMap(o => o.maps.filter(m => m.img && !m.Tr).map(m => m.p + 1)).sort((x, y) => x - y);
      if (noLook.length) warn.push(`旧版の${spans(noLook)}ページ目は、文字データがなく（ページ全体が画像など）、成果物と位置も合わせられなかったため、比べていません`);
      if (!npages) {
        const hit = new Set(OLD.pairs.map(x => x.q)), extra = [];
        for (let q = 0; q < newDoc.numPages; q++) if (!hit.has(q)) extra.push(q + 1);
        if (extra.length) warn.push(`成果物の${spans(extra)}ページ目は、旧版のどのページにも当たらなかったため、旧版と比べていません`);
      }
    }
    const none = P.map(d => (d.kind === 'none' && !d.label ? d.src + 1 : 0)).filter(Boolean), noneV = P.filter(d => d.kind === 'none' && d.label).map(d => d.label);
    if (none.length) warn.push(`原稿の${spans(none)}ページ目は、対応する成果物のページが見つかりませんでした（照合していません）`);
    if (noneV.length) warn.push(`${noneV.join('、')}は、成果物に載っている所が見つかりませんでした（照合していません）`);
    const usedQ = new Set(P.map(d => d.q).filter(q => q >= 0)), lost = [];
    for (let q = 0; q < newDoc.numPages; q++) if (!usedQ.has(q)) lost.push(q + 1);
    if (lost.length && npages) warn.push(`成果物の${spans(lost)}ページ目は、対応する原稿のページが見つかりませんでした`);
    // 3) 成果物だけを読んで、問題がありそうな所(ページの端の切れ端・かっこ・日付・表記ゆれなど。原稿とは照らし合わせない)。項目は、その成果物のページを表示している結果のページに付ける
    //   (見開きの片側だけを照合したページは、その側にある項目だけ。どこにも表示していない成果物のページは「成果物だけ」のページを足す)
    G.at('check', '辞書を読み込んでいます'); await PC.tick();
    const TK = await PC.tokenizer();
    //   (辞書は、使い終わったら手放す(約130MB)。照合のたびに読み込み直す(1秒ほど))
    G.at('check', '成果物だけで文字・表記を確認しています', C.checkBase / (C.checkBase + C.check * nNew)); await PC.tick();
    if (!TK) warn.push('辞書を読み込めなかったため、成果物だけのチェックの一部（表記ゆれの一部・助詞の続き方など）を行っていません');
    const pname = q => { const n = PC.pageOf(newDoc.parts, q); return n ? `${newDoc.parts.length > 1 ? n.name + ' ' : ''}${n.page}ページ` : `${q + 1}ページ`; };   // 成果物のページの名前(ファイルが複数なら名前も)
    const JF = PC.jcheck(JP, TK, pname).sort((a, b) => a.q - b.q);
    if (PC.tokenizerRelease) PC.tokenizerRelease();
    for (const x of JF) {   // 成果物のページの順に(「成果物だけ」のページもこの順に足す)
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
    G.at('final', '照合の結果を突き合わせています'); await PC.tick();
    // 照合: 変更 × 赤字の指示箇所
    const meets = (set, a, b) => { for (let k = a; k < b; k++) if (set.has(k)) return true; return false; };
    //   位置での結びつけ(注釈PDFのページ): マーカーの範囲が、変化の原稿側・成果物側の枠に重なる(3pt以内)。
    //   同じレイアウトなので、原稿の字のない所に引いたマーカー(「ここに注を入れる」など)も、成果物で入った字の位置で結べる
    const nearA = (a, c) => { const M = 3 * PC.S, del = c.kind === 'text' && c.before && !c.after; return (a.quads && a.quads.length ? a.quads : [a.box]).some(q => (c.obox && ov(q, c.obox, M)) || (!del && c.nbox && ov(q, c.nbox, M))); };
    const cen = b => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], dist = (a, c) => { const p = cen(a.box), q = cen((c.diff && c.diff.ob && c.diff.ob[0]) || c.obox || c.nbox); return Math.hypot(p[0] - q[0], p[1] - q[1]); };
    for (const d of P) {
      for (const a of d.an) a.hit = [];
      for (const c of [...d.ch, ...d.im]) {
        c.status = null; c.anchors = [];
        if (c.hw) continue;   // 赤以外の書き込みは、修正の対象ではない
        for (const a of d.an) {
          if (KEEP.test(a.note || '') && a.kind === 'tokens' && c.kind === 'text' && meets(a.toks, c.oi[0], Math.max(c.oi[1], c.oi[0] + 1))) { a.hit.push(c); continue; }
          let m = false;
          if (c.kind === 'text' && a.kind === 'tokens' && d.kind === 'annot' && c.fromText) m = nearA(a, c);
          else if (c.kind === 'text' && a.kind === 'tokens') {
            const [lo, hi] = c.oi; m = meets(a.toks, lo - (c.tag === 'layout' ? 1 : 0), Math.max(hi, lo + 1));
            //   文字データの違い・字の入っただけの変化は、位置でも結ぶ(マーカーのすぐ後ろに字を足す指示など)
            if (!m && d.kind === 'annot' && c.tag !== 'layout' && (c.fromText || c.oi[0] === c.oi[1])) m = nearA(a, c);
          }
          else if (c.kind === 'text' && a.kind === 'insert') { const [lo, hi] = a.span || [a.at - 1, a.at + 1]; m = (lo <= c.oi[0] && c.oi[0] <= hi) || (lo <= c.oi[1] && c.oi[1] <= hi); }
          else if (c.kind !== 'text' && a.kind === 'image') m = ov(c.obox, a.box, 5);
          else if (c.kind === 'text' && a.kind === 'image' && d.kind === 'annot' && (c.fromText || (!c.before && !c.after))) m = nearA(a, c);   // 画像の上のマーカー: 字の入れ替え・文字のない字形の変化
          else if (a.kind === 'area' && c.tag !== 'layout') m = nearA(a, c);
          //   指示の所の描画がまったく同じ(a.still)なら、その指示はその所では反映されていない。文字データの裏づけのない変化は結びつけない
          if (m && a.still && !c.fromText && !c.txt) m = false;
          if (m && a.stillIn && c.kind !== 'text') m = false;
          if (m && a.printedLike) { a.hit.push(c); continue; }
          if (m) { c.status = c.kind === 'text' ? 'A' : 'A_IMG'; c.anchor = a; c.anchors.push(a); a.hit.push(c); }
        }
        //   注釈PDFのページは、当たった指示ごとに1件にする(近い順)。紙のスキャンは、1つの赤字が丸囲み・引き出し線などに分かれるので、これまでどおり1件
        if (d.kind !== 'annot') c.anchors = c.anchor ? [c.anchor] : [];
        else if (c.anchors.length > 1) {
          c.anchors.sort((x, y) => dist(x, c) - dist(y, c));
          const seen = new Set(); c.anchors = c.anchors.filter(a => { const k = String(a.note || '').replace(/\s/g, ''); if (seen.has(k)) return false; seen.add(k); return true; });   // 同じ文の指示は1件
          c.anchor = c.anchors[0];
        }
      }
    }

    // ---- 全体に関わる修正(全体指示・以下同様): 手で登録しなくても、赤字原稿から読み取る ----
    //  1) 注釈のコメント「全体…「A」→「B」」  2) 同じ変更が2か所以上(全体指示と推定)  3) 赤字どおり変わった語(以下同様の候補)
    const rules = [], textCh = [];
    P.forEach((d, p) => d.ch.forEach(c => { if (c.kind === 'text' && c.tag !== 'layout' && c.before && !c.hw) textCh.push([p, c]); }));
    for (const d of P) for (const n of d.notes) {
      const m = PC.ruleMatch(n.text);
      if (m) { rules.push({ frm: m[1], to: m[2], core: coreOf(m[1], m[2]), how: '全体指示', check: '未統一' }); n.rule = true; }
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
        //   字を足しただけの指示(「市立図書館」→「市立第二図書館」の「第二」)からは、以下同様の候補を作らない(同じ語のほかの箇所を直し忘れとしないように)
        if (!after && !b) continue;
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
      //   「以下同様」「全体」と書いていない指示から推定した候補(guess)は、指示が確かでないので「直す必要がありそう」には入れず、
      //   その語ごと・ページごとに1件にまとめる(ほかの所は枠で示す。同じ語が多い紙面で、1か所ずつ何百件も出ていたため)
      const guess = !r.after && r.check === '変更なし（展開漏れの候補）' && r.how === '同じ語の他の箇所（以下同様の候補）';
      P.forEach((d, q) => {
        let g = null;
        for (const [i, e] of findAll(d.nc, r.search || r.frm)) {
          const nb = union(d.nc.slice(i, e).map(c => c[1])).map(Math.trunc), key = q + ':' + nb.join(','), found = d.nc.slice(i, e).map(c => c[0]).join('');
          if (seen.has(key)) continue;
          seen.add(key);
          if (guess) { if (g) { g.more.push(nb); continue; } g = { page: q + 1, frm: r.frm, to: r.to, nbox: nb, how: r.how, check: '変更なし（以下同様の指示なら直す所）', guess: true, more: [] }; leaks.push(g); continue; }
          let check = r.check;
          if (r.after && r.src && (q < r.src[0] || (q === r.src[0] && r.src[1] && (nb[1] < r.src[1][1] || (nb[1] === r.src[1][1] && nb[0] < r.src[1][0]))))) check += '（指示より前なので対象外の可能性）';
          leaks.push({ page: q + 1, frm: r.frm.includes('□') ? found : r.frm, to: r.to, nbox: nb, how: r.how, check });
        }
      });
    }

    // 文字データでの裏取り(注釈PDFのページ): 見た目で「同じ」と対応づいた字形どうしで、文字データが違うもの
    const lookalike = [];
    P.forEach((d, p) => {
      if (d.kind !== 'annot' || d.tx) return;
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
      if (d.kind === 'merge') mergeFindings(d, p, add);
      if (d.kind === 'scan3') scan3Findings(d, p, add);
      for (const x of d.olds || []) {   // 旧版から変わった所(原稿のない部分): 指示にない変更
        const f = add(p + 1, x.variant ? 'V' : 'C2', x.nbox, x.text, x.variant ? '旧版から書き方だけ変わった所（全角・半角など）' : '旧版から変わった所（原稿のない部分）', '', '', x.nbox);
        Object.assign(f, { onNew: true, newOnly: true, fromOld: x.kind, segs: x.segs, same: false, pnboxes: x.pnb || [x.nbox], old: x.old });
        if (x.spots > 1) f.para = x.spots;   // 同じ段落の違いの所をまとめた件(所の数)
        if (x.ocr) f.ocr = true;
      }
      if (d.unread) {   // 文字データのない文字(図形の文字・ロゴ)の所: 文字としては確かめていない所。ページごとに1件(大きい所から)
        const bs = d.unread.boxes.slice().sort((x, y) => (y[2] - y[0]) * (y[3] - y[1]) - (x[2] - x[0]) * (x[3] - x[1]));
        const f = add(p + 1, 'U', bs[0], '', '', '', '', bs[0]);
        Object.assign(f, { onNew: true, newOnly: true, why: d.unread.why, spotN: bs.length, moreNboxes: bs.slice(1), pnboxes: [bs[0]] });
      }
      for (const x of d.shapes || []) {   // 旧版から見た目が変わった所(文字データのない文字・ロゴ。文字では比べられない変化)
        const f = add(p + 1, 'C3', x.nbox, '', '旧版から見た目が変わった所（文字データのない文字・ロゴ）', '', '', x.nbox);
        Object.assign(f, { onNew: true, newOnly: true, fromOld: 'shape', shape: true, pnboxes: [x.nbox], old: x.old });
      }
      for (const x of d.moves || []) {   // 旧版から移動した所(動かした範囲1か所1件。動き・移動元と、中身が同じか)
        const f = add(p + 1, 'C3', x.nbox, x.show, x.cross ? '旧版のほかのページから移ってきた所' : '旧版から移動した所', '', '', x.nbox);
        Object.assign(f, { onNew: true, newOnly: true, fromOld: 'move', moveSame: x.same, pnboxes: x.pnb || [x.nbox], moreNboxes: x.more, old: x.old });
        if (x.text) f.moveText = true;
      }
      for (const x of d.looks || []) {   // 旧版から見た目が変わった所(字の見た目、または写真・図版・色・線など。文字の変化で説明できない描画の違い)
        const f = add(p + 1, 'C3', x.nbox, x.replaced ? `${x.replaced}から移ってきた中身` : x.text || '', x.text ? '旧版から字の見た目が変わった所（色・太さ・書体など）' : x.replaced ? '旧版の中身が、移ってきた中身に置き換わった所' : x.inMove ? '旧版から移動した範囲の中で、見た目が違う所' : x.fills && x.fills.length && !x.other ? '旧版から色が変わった所（地・塗り）' : '旧版から見た目が変わった所（文字以外）', '', '', x.nbox);
        Object.assign(f, { onNew: true, newOnly: true, fromOld: 'look', pnboxes: x.pnb || [x.nbox], old: x.old });
        if (!x.text && x.fills && x.fills.length) Object.assign(f, x.other ? { fills: x.fills } : { fill: x.fills[0], fills: x.fills });
        if (x.text) f.lookText = true;
        if (x.inMove) f.inMove = true;
        if (x.replaced) Object.assign(f, { replaced: true, moreNboxes: x.more || [] });
      }
      for (const x of d.anns || []) {   // 旧版と成果物の注釈の違い(成果物にだけある注釈 → W、旧版にだけある注釈 → K)。how に注釈の種類、show にコメントの文字
        const f = add(p + 1, x.cat, x.nbox, x.text || '', `注釈（${ANN[x.type] || x.type}${x.reply ? '・返信' : ''}）`, '', '', x.nbox);
        Object.assign(f, { onNew: true, newOnly: true, fromOld: 'annot', pnboxes: [x.nbox] });
        if (x.old) f.old = { p: x.old.p, box: x.old.box, M: pxM(x.old.T, x.o0) };
      }
      for (const x of d.jf || []) {   // 成果物だけで見た問題
        const f = add(p + 1, 'J', x.nbox, x.show, '', '', '', x.nbox);
        Object.assign(f, { onNew: true, newOnly: true, level: x.level, j: { kind: x.kind, sub: x.sub, want: x.want, msg: x.msg, ctx: x.ctx, count: x.count || 0 }, moreNboxes: x.more, pnboxes: [x.nbox] });
      }
      for (const c of [...d.ch, ...d.im]) for (const a0 of (c.anchors && c.anchors.length ? c.anchors : [c.anchor || null])) {
        const st = c.hw ? 'H' : c.status || (c.kind === 'text' ? (c.look === 'color' ? 'C3' : c.variant ? 'V' : c.lookAlike ? 'E' : 'C2') : 'C3'), a = a0 || {};
        let chk = '', wantUsed = '', sure = false;   // sure: 置き換わった字そのものが指示の字と同じと確かめた
        if (a.note && c.kind === 'text' && c.tag === 'layout') {   // 改行・追い込みの指示: 段落の始まりが指示どおりに変わったか
          const t = a.note.replace(/\s/g, '');
          if (/改行|改段|段落/.test(t)) chk = (c.show || '').includes('追加') ? '改行を確認（自動確認OK）' : '改行の指示どおりになっていない可能性（要確認）';
          else if (/追い込|追込|改行トル|改行なし/.test(t)) chk = (c.show || '').includes('解除') ? '追い込みを確認（自動確認OK）' : '追い込みの指示どおりになっていない可能性（要確認）';
        }
        if (a.note && c.kind === 'text' && c.tag !== 'layout' && a.thread) chk = 'コメントのやり取り（人が判断）';   // 返信のあるコメントは、やり取りの結果を人が読む
        else if (a.note && c.kind === 'text' && c.tag !== 'layout') {   // 指示文(注釈のコメント)が、修正後の該当箇所の前後にあるか
          // 「目指し（以下同様）」のような添え書きは外す(指示文全体がかっこ書きなら外さない)
          const strip = a.note.replace(/[（(][^）)]*(以下同様|全体|ママ|イキ|トル|同様)[^）)]*[）)]/g, '').replace(/\s/g, '');
          const want = strip || a.note.replace(/\s/g, '');
          // 「A」→「B」・「B」に修正・「A」トル のような指示は、何に直すか(B)・何を消すか(A)を取り出して調べる
          const tgt = PC.instrTarget(want), ctxOf = w => (c.nbox ? around(d.nc, c.nbox, [...w].length + 3) : '');
          //   素材の指定や質問がまじるコメントは、書式の指示として調べず、人が判断する(「もっと大きくできますか？」など)
          const P_ = d.kind === 'annot' && !tgt ? noteParts(a.note) : null;
          if (P_ && !P_.drop.length && (P_.file.length || P_.ask.some(t => /[？?]|でしょうか|ますか|可能/.test(t)))) chk = '指示の内容を確認（人が判断）';
          else if (tgt && tgt.want) { wantUsed = tgt.want; chk = ctxOf(tgt.want).includes(tgt.want) ? '指示文が修正後にある（自動確認OK）' : '指示文が修正後に見当たらない（要確認）'; }
          else if (tgt && tgt.drop) chk = c.tag === 'delete' || !c.after || !ctxOf(tgt.drop).includes(tgt.drop) ? '削除を確認（自動確認OK）' : '削除されていない可能性（要確認）';
          else if (/太字|細字|書体|ゴシック|明朝|イタリック|斜体|色|サイズ|大きく|小さく|字下げ|改行|追い込み|写真|差し?替/.test(want) || /^(赤|青|緑|黒|白|朱|紫|ピンク|オレンジ|黄)(色|字)?(に|で)?(する|して)?$/.test(want)) {
            // 同じ指示に結びついた変化(行の折り返しなどで分かれる)のどれかで指示どおりの見た目になっていれば、指示どおりとする
            const sc = d.kind === 'annot' && c.sty ? styleCheck(want, c.sty.o, c.sty.n) : null;
            const any = sc && (a.hit || []).some(h => h.sty && /OK/.test(styleCheck(want, h.sty.o, h.sty.n) || ''));
            chk = sc ? (any ? '書式の指示どおり（自動確認OK）' : sc) : '書式・組みの指示（人が確認）';
          }
          else if (/^(トル|トルツメ|トルママ|削除)$/.test(want)) chk = c.tag === 'delete' || !c.after ? '削除を確認（自動確認OK）' : '削除されていない可能性（要確認）';
          else { const r = noteCheck(d, c, a, ctxOf); chk = r.chk; wantUsed = r.want || ''; sure = !!r.sure; }
        }
        add(p + 1, st, c.obox, c.show + (c.look === 'color' ? '（色のみ）' : ''), a.how || c.why || '', a.note || '', chk, c.nbox);
        const f = F[F.length - 1];
        // 指示どおりかを自動で判定できたもの(1字だけの指示は、変わった字がその字そのものでなければ、たまたまある字と見分けられないので人が確認)
        if (st === 'A' && chk) { const v = autoOf(chk); if (v && !(v === 'ok' && !sure && wantUsed && [...wantUsed].length < 2 && (c.after || '').replace(/\s/g, '') !== wantUsed)) f.auto = v; }
        if (a0) Object.defineProperty(f, 'anchorRef', { value: a0, enumerable: false });
        if (c.textSame && !a0) f.textSame = true;   // 文字データに違いのない字形の変化(字形のまとまり方・位置が変わっただけ。参考)
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
        //   返信のあるコメント・返事やお礼・質問だけのコメントは、変化がなくても「直っていない」とせず、人が判断する項目にする
        if (a.note && (a.kind === 'area' || a.how === 'マーカー(注釈)' || a.how === '付箋(注釈)')) {
          const P_ = noteParts(a.note), talk = a.thread || (!P_.text.length && !P_.drop.length && !P_.file.length && (P_.reply.length + P_.ask.length > 0) && P_.ask.every(t => /[？?]|でしょうか|ますか|可能/.test(t)));
          if (talk) { add(p + 1, 'K', a.box, a.under || textIn(d.oc, a.box), a.how, a.note, a.thread ? 'コメントのやり取り（人が判断）' : '指示の内容を確認（人が判断）', mapBox(d, a.box) || a.box); Object.defineProperty(F[F.length - 1], 'anchorRef', { value: a, enumerable: false }); continue; }
        }
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
        } else { show = a.under || textIn(d.oc, a.box); nb = mapBox(d, a.box) || (a.kind === 'area' ? a.box : null); }
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
      if (e.guess) Object.assign(F[F.length - 1], { guess: true, spotN: 1 + e.more.length, moreNboxes: e.more });   // 推定の候補: このページの同じ語の所(ほかの所は枠)
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
    const fin = C.final / (C.final + (opts.oldDoc ? C.oldThumb * nOld : 0));
    G.at('final', '結果をまとめています', fin);
    // 全体の直し(推定を含む)の一覧。□(推定できなかった字)を含む語は、修正後に残っていた形で示す
    const shown = r => { if (!r.frm.includes('□')) return r.frm; const e = leaks.find(l => l.to === r.to && !l.frm.includes('□')); return e ? e.frm : r.frm.replace(/□+/g, '…'); };
    //   パタパタ表示の相手(flip): 成果物のページに同じレイアウトの旧版のページがあれば旧版(old: 旧版のページの番号、M: 位置合わせ)、
    //   なければ、原稿を成果物に重ねて比べたページ(注釈PDF・スキャン)の原稿(src。原稿と成果物の画像は同じ所がそろっている)
    const flipOf = d => {
      if (d.q < 0) return null;
      if (OLD) {
        const o0 = d.crop ? [d.crop[0], d.crop[1]] : [0, 0];
        const inCrop = x => { if (!d.crop || !x.region) return true; const [cx] = PC.center(x.region); return cx >= d.crop[0] && cx <= d.crop[2]; };
        const op = OLD.pairs.findIndex(x => x.q === d.q && x.same && x.T && inCrop(x));
        if (op >= 0) return { old: op, M: pxM(OLD.pairs[op].Tr || OLD.pairs[op].T, o0) };   // 求め直した位置合わせ(Tr)があればそれ
      }
      return ['annot', 'scan', 'scan3'].includes(d.kind) && d.thumbs && d.thumbs.left ? { src: true } : null;
    };
    //   注釈の違いを出したページは、成果物の画像を注釈を描いたものにする(注釈の項目の枠の所に、注釈が見えるように)
    if (AR && AR.showNew.size) {
      const full = new Map();
      for (const d of P) {
        if (d.q < 0 || !AR.showNew.has(d.q) || !d.thumbs) continue;
        if (!full.has(d.q)) full.set(d.q, await PC.renderPage(newDoc, d.q, PC.DPI, true));
        let img = full.get(d.q);
        if (d.crop) { const [x0, y0, x1, y1] = d.crop.map(v => Math.round(v * PC.S)); img = PC.crop(img, x0, y0, x1, y1); }
        d.thumbs = { ...d.thumbs, right: await toThumb(img) };
      }
    }
    const pages = P.map(d => ({ ...d.thumbs, kind: d.kind, q: d.q, src: d.src, label: d.label, crop: d.crop || null, region: d.kind === 'content' ? d.pr.region.map(v => v * PC.S) : null, flip: flipOf(d) }));
    mergeSame(F, pages);
    // 仕上がり(トンボ)の外にある項目に印を付ける(詳細設定で、ページ情報などを結果から外せるように)
    //   仕上がりは成果物のPDFに書かれた TrimBox(ページの外枠と同じなら外はない)。項目の成果物での位置の中心で見る
    //   違う字の枠(pnboxes)があれば、そのすべてが外のものだけ(内側の字を含む項目は、外の項目として隠さない)
    const trims = new Map();
    for (const f of F) {
      const pg = pages[f.page - 1];
      if (!pg || pg.q < 0 || !f.nbox) continue;
      if (!trims.has(pg.q)) trims.set(pg.q, PC.trimOf(JP[pg.q] ? JP[pg.q].B : await PC.pageText(newDoc, pg.q)));   // JP: 成果物の全ページの文字データ
      const t = trims.get(pg.q), o0 = pg.crop ? [pg.crop[0], pg.crop[1]] : [0, 0];
      if (!t) continue;
      const bs = f.pnboxes && f.pnboxes.length ? f.pnboxes : [f.nbox];
      if (bs.every(b => b && PC.outside(t, [b[0] / PC.S + o0[0], b[1] / PC.S + o0[1], b[2] / PC.S + o0[0], b[3] / PC.S + o0[1]]))) f.outTrim = true;
    }
    // 旧版のページの表示用の画像(旧版から変わった所の項目と、パタパタ表示で使うものだけ)
    const oldPages = [];
    if (opts.oldDoc) {
      const want = [...new Set([...F.filter(f => f.old).map(f => f.old.p), ...pages.filter(pg => pg.flip && pg.flip.old != null).map(pg => pg.flip.old)])];
      for (const [k, p] of want.entries()) {
        G.at('final', `旧版の表示用の画像を作成（${k + 1}/${want.length}）`, fin + (1 - fin) * k / Math.max(1, nOld));
        oldPages[p] = await toThumb(await PC.renderPage(opts.oldDoc, p, PC.DPI, !!(AR && AR.showOld.has(p))));
      }
    }
    return { findings: F, pages, oldPages, rules: rules.filter(r => r.check === '未統一').map(r => ({ frm: shown(r), to: r.to, how: r.how })), warn };
  };
})();
