// 差し込み印刷(名刺・宛名ラベル・社員証など)の照合: データファイルの表の1行(1人分など)が、成果物の1ページ(表と裏の2ページのことも)に
//   差し込まれているものを、行ごとに照合する
//   1) 表: 見出しの行(短い言葉のセルが3つ以上の行)の下で、見出しのある列に3つ以上字がある行を1件とする。見出しより上の行・件でない行
//      (合計の行など)・見出しのない列のセルは、共通の情報(会社名・住所・電話番号など)とする
//   2) 値: セルを改行で分けた1行ずつ。字の並び(全角・半角、大文字・小文字、空白は区別しない)で探す。電話番号は数字で探し、国番号つきの
//      書き方(「+81-90-…」と「090-…」)も同じとみなす。ローマ字の名前は語の順番が違ってもよい。「/」「・」で分けた語がすべてあればよい
//   3) 成果物のページごとに、値が最も多く見つかる行を、そのページの行とする(同じ表のほかの行の値が2つ以上見つからないこと)。
//      そのような1行だけのページが2ページ以上で、文字のあるページの6割以上なら、差し込み印刷とみなす(カタログの表のページは1ページに多くの行がある)
//   4) 行ごとに、その行のページで、見出しのある列の値を探す。値が載るはずのページ(ほかの行で、同じ作りのページの半分以上にその列の値が
//      あるもの。表と裏の両方に載るメールなど)ごとに確かめ、見つからない値は、ほかの行で同じ列の値があった所(同じ作りのページの同じ行)の字を、
//      成果物の値として示す(その行の決まった字「E」「M」などは除く。なければ、ページの中のいちばん近い字の並び)。成果物に載らない列は見ない
//      縦組みで1字ずつ置いた値(氏名など)は、すぐ上・下に続く字も、同じ作りのほかのページと比べる(「山田太郎」の下に1字増えたもの)
//   5) 同じ作りのページ(字の大きさと行の位置がそろうページ)どうしで、行の値と共通の情報に当たらない字(英語の住所・「T」「F」などの書き込み)を
//      行の位置ごとに比べ、ほかのページの多くと少しだけ違う所を出す(まるごと違う文は、事業所ごとの住所の英語表記などとみなして出さない)。
//      ほかのページの多くでは行の値だけの位置(役職の行など)に、元の表にない字があれば、長さによらず出す(役職の頭に1字・1語増えたもの)
//   6) 同じ作りのページの多く(7割以上)にある行(会社名・住所・英語の会社名など)が、まるごとないページを出す
'use strict';
(function () {
  const low = c => (c === '\u00ad' ? '-' : PC.fold(c).toLowerCase());   // ソフトハイフン(電話番号の区切りに使われることがある)は「-」
  const nz = s => [...String(s)].filter(c => !/\s/.test(c)).map(low).join('');
  const isW = c => /[0-9a-z]/.test(c || '');
  const telVariants = d => { const v = new Set([d]); if (d.startsWith('0')) v.add('81' + d.slice(1)); if (d.startsWith('81')) v.add('0' + d.slice(2)); return [...v]; };
  const TEL_LINE = /^[^\d+＋０-９]{0,8}?[+＋]?[\d０-９][\d０-９\-－‐ー()（）\s]{5,}[\d０-９](?:\s*[(（][^)）]{0,6}[)）])?$/;
  const SEP = /^[\/／・･,，、]{1,2}$/;   // 「/」などで分けた値を、成果物で区切りを変えて組んだときの区切り
  // セルの値 → 照合に使う値(1行ずつ)
  function atomsOf(cell) {
    const out = [];
    String(cell ?? '').split(/\n/).forEach((line, li) => {
      const t = line.trim(), k = nz(t);
      if ([...k].length < 2) return;
      const d = k.replace(/\D/g, '');
      if (TEL_LINE.test(t) && d.length >= 8 && d.length <= 15) { out.push({ type: 'tel', raw: t, li, k, d, vs: telVariants(d) }); return; }
      const ws = t.split(/\s+/).filter(Boolean), words = /^[A-Za-z][A-Za-z.'\-\s]+$/.test(t) && ws.length >= 2 ? ws.map(nz).filter(w => w.length >= 2) : null;
      const parts = /[\/／・]/.test(t) ? t.split(/[\/／・]/).map(nz).filter(x => [...x].length >= 2) : null;
      out.push({ type: 'text', raw: t, li, k, words: words && words.length >= 2 ? words : null, parts: parts && parts.length >= 2 ? parts : null });
    });
    return out;
  }
  // 表の見出し・件の行・共通の情報
  function tableOf(sheet) {
    const rows = sheet.rows, nc = sheet.cols.length;
    const isHead = r => { const cs = r.cells.map(c => String(c ?? '').trim()).filter(Boolean); return cs.length >= 3 && cs.every(c => [...c].length <= 20 && !/[\d@]/.test(c) && !c.includes('\n')); };
    let h = -1; for (let i = 0; i < Math.min(5, rows.length); i++) if (isHead(rows[i])) { h = i; break; }
    const fieldCols = []; for (let c = 0; c < nc; c++) if (h < 0 || String(rows[h].cells[c] ?? '').trim()) fieldCols.push(c);
    const label = c => (h >= 0 ? String(rows[h].cells[c]).trim() : `${sheet.cols[c]}列`);
    const recs = [], common = [];
    rows.forEach((r, i) => {
      if (i === h) return;
      const filled = fieldCols.filter(c => String(r.cells[c] ?? '').trim());
      const isRec = i > h && filled.length >= 3;
      r.cells.forEach((v, c) => { if (String(v ?? '').trim() && (!isRec || !fieldCols.includes(c))) common.push(...atomsOf(v).map(a => ({ ...a, cell: `${sheet.cols[c]}${r.rn}`, sheet }))); });
      if (isRec) recs.push({ sheet, row: r, rn: r.rn, fields: filled.map(c => ({ c, label: label(c), value: String(r.cells[c]).trim(), atoms: atomsOf(r.cells[c]) })).filter(f => f.atoms.length) });
    });
    // 値の重み: 同じ表で同じ値を持つ行が少ないほど重い(役職の「主任」のような値で、行を取り違えないように)
    const cnt = new Map(), keyOf = a => (a.type === 'tel' ? 'tel:' + a.vs.slice().sort()[0] : a.k);
    for (const r of recs) for (const k of new Set(r.fields.flatMap(f => f.atoms.map(keyOf)))) cnt.set(k, (cnt.get(k) || 0) + 1);
    for (const r of recs) for (const f of r.fields) for (const a of f.atoms) a.w = 1 / (cnt.get(keyOf(a)) || 1);
    return { sheet, h, fieldCols, label, recs, common };
  }
  // 成果物のページの字の並び(仕上がりの外の字・OCR の字は除く)。at: 並びの位置 → 字の番号。tels: 電話番号らしい数字の並び
  //   bnd: 語の切れ目(行が変わる・空白・字の間があく所)。字の並びには空白がないため、英数字の値の前後が切れ目かどうかに使う
  //   soft: 語の切れ目のうち、同じ行の語と語の間(空白1つほど)のもの(英語の役職のうしろに増えた語を見るのに使う)
  function pageKey(q, B) {
    const tr = PC.trimOf(B), s = [], at = [], bnd = [], soft = [];
    let prev = null, gap = false, ns = null;
    B.chars.forEach((c, j) => {
      if (c.ocr || (tr && PC.outside(tr, c.box))) return;
      if (!c.c.trim()) { gap = true; prev = c; return; }   // 空白の字(全角の空白など)のあとは語の切れ目
      const b = c.box, h = Math.max(1, b[3] - b[1]);
      const cut = !prev || gap || c.sp || c.brk || Math.abs((b[1] + b[3]) - (prev.box[1] + prev.box[3])) / 2 > 0.5 * h || b[0] - prev.box[2] > 0.3 * h || prev.box[0] - b[2] > 0.3 * h;
      //   (字の枠は描いた字の形に合わせてあり、字によっては小さくつぶれるため、同じ行かどうかと語の間の幅は、文字列(item)の枠で見る)
      const ib = B.items[c.it] && B.items[c.it].box, nb = ns && B.items[ns.it] && B.items[ns.it].box, ih = ib ? Math.max(1, ib[3] - ib[1]) : h;
      const same = !!ns && (c.it === ns.it || (!!ib && !!nb && Math.abs((ib[1] + ib[3]) - (nb[1] + nb[3])) / 2 <= 0.3 * ih));
      const sft = cut && same && !c.brk && b[0] - ns.box[2] >= -0.1 * ih && b[0] - ns.box[2] <= 0.8 * ih;
      let first = true;   // 字の並びの位置は UTF-16 の単位で数える(indexOf の位置とそろえる。「𠮷」のような字があっても位置がずれない)
      for (const ch of low(c.c)) if (ch.trim()) for (let u = 0; u < ch.length; u++) { s.push(ch[u]); at.push(j); bnd.push(first && cut); soft.push(first && sft); first = false; }
      prev = c; gap = false; ns = c;
    });
    const str = s.join(''), tels = [], bi = new Set();
    for (let i = 0; i + 1 < str.length; i++) bi.add(str.slice(i, i + 2));   // 2字の並びの一覧(ページにない値を、字の並びを探す前に外す)
    for (const m of str.matchAll(/\+?\d[\d\-()]{5,}\d/g)) { const d = m[0].replace(/\D/g, ''); if (d.length >= 8 && d.length <= 15) tels.push({ d, i: m.index, n: m[0].length }); }
    bnd.push(true); soft.push(false);
    return { q, B, tr, s: str, at, bnd, soft, tels, bi, mark: new Uint8Array(B.chars.length), cmark: new Uint8Array(B.chars.length) };
  }
  // ページの中の値の位置
  const may = (P, k) => k.length < 2 || (P.bi.has(k.slice(0, 2)) && P.bi.has(k.slice(-2)));
  function findAtom(P, a) {
    if (a.type === 'tel') return P.tels.filter(t => a.vs.includes(t.d)).map(t => ({ i: t.i, n: t.n }));
    const hits = [], w0 = isW(a.k[0]), w1 = isW(a.k[a.k.length - 1]);
    if (may(P, a.k)) for (let i = P.s.indexOf(a.k); i >= 0; i = P.s.indexOf(a.k, i + 1)) {
      if ((w0 && isW(P.s[i - 1]) && !P.bnd[i]) || (w1 && isW(P.s[i + a.k.length]) && !P.bnd[i + a.k.length])) continue;
      hits.push({ i, n: a.k.length });
    }
    if (hits.length) return hits;
    for (const ws of [a.words, a.parts]) {   // 語の順番が違うローマ字の名前、「/」で分けて行を変えた役職など
      if (!ws || !ws.every(w => may(P, w))) continue;
      const hs = ws.map(w => P.s.indexOf(w));
      if (hs.every(h => h >= 0) && Math.max(...hs) - Math.min(...hs) <= 80) {
        const out = ws.map((w, k) => ({ i: hs[k], n: w.length })), srt = out.slice().sort((x, y) => x.i - y.i);
        //   語と語の間の区切り(「部長/工学博士」を「部長・工学博士」と組んだときの「・」、「Yamada, Taro」の「,」)も値の字とする
        for (let k = 1; k < srt.length; k++) { const e = srt[k - 1].i + srt[k - 1].n, g = P.s.slice(e, srt[k].i); if (SEP.test(g)) out.push({ i: e, n: g.length }); }
        return out;
      }
    }
    return hits;
  }
  const charsOf = (P, h) => [...new Set(P.at.slice(h.i, h.i + h.n))];
  const boxOfJs = (B, js) => PC.union(js.map(j => B.chars[j].box));
  // 字の行(仕上がりの内側)。1字ずつ置かれた縦組みの字は、1字ずつの行になる
  //   高さは文字列(item)の枠で見る(字の枠は描いた字の形に合わせて縮めてあり、「h」「a」「.」で高さが違うため)
  function linesOf(P) {
    const B = P.B, yb = j => B.items[B.chars[j].it].box, js = [...new Set(P.at)].sort((a, b) => { const p = yb(a), q = yb(b); return (p[1] + p[3]) - (q[1] + q[3]) || B.chars[a].box[0] - B.chars[b].box[0]; }), out = [];
    for (const j of js) {
      const ib = yb(j), b = [B.chars[j].box[0], ib[1], B.chars[j].box[2], ib[3]], h = Math.max(1, b[3] - b[1]), cy = (b[1] + b[3]) / 2;
      const ln = out.find(l => Math.abs(l.cy - cy) < 0.5 * Math.min(h, l.h) && b[0] - l.x1 < 3 * h && l.x0 - b[2] < 3 * h);
      if (ln) { ln.js.push(j); ln.x0 = Math.min(ln.x0, b[0]); ln.x1 = Math.max(ln.x1, b[2]); }
      else out.push({ js: [j], cy, h, x0: b[0], x1: b[2] });
    }
    return out;
  }
  // 2つの行が同じ作りの同じ所か(字の大きさと高さがそろい、左・右・中央のどれかがそろう: 右寄せのローマ字の名前など)
  const sameSlot = (a, b) => { const t = 0.8 * Math.max(a.h, b.h); return Math.abs(a.h - b.h) <= 0.15 * Math.max(a.h, b.h) && Math.abs(a.cy - b.cy) <= t && (Math.abs(a.x0 - b.x0) <= 1.5 * t || Math.abs(a.x1 - b.x1) <= 1.5 * t || Math.abs((a.x0 + a.x1) - (b.x0 + b.x1)) / 2 <= 1.5 * t); };
  // 編集距離
  function lev(a, b) {
    const m = a.length, n = b.length; let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
    return prev[n];
  }
  // 字の並びの中で、値にいちばん近い所(1字違いなど。違いは値の長さの4分の1まで)
  function nearest(P, k) {
    const L = k.length; if (L < 4) return null;
    let best = null;
    for (let n = L - 1; n <= L + 1; n++) for (let i = 0; i + n <= P.s.length; i++) {
      const d = lev(k, P.s.slice(i, i + n));
      if (d > Math.max(1, Math.floor(L / 4))) continue;
      if (!best || d < best.d) best = { i, n, d };
    }
    return best;
  }

  // 縦組みで1字ずつ置いた値(js: 値の字)の、すぐ上・下に同じ列で続く、印のない字(なければ空。縦組みでなければ null)
  function vcont(P, js) {
    const B = P.B, cx = b => (b[0] + b[2]) / 2, cy = b => (b[1] + b[3]) / 2, sz = b => Math.max(b[2] - b[0], b[3] - b[1]);
    const cs = [...new Set(js)].map(j => B.chars[j].box).sort((a, b) => cy(a) - cy(b));
    if (cs.length < 2) return null;
    const W = Math.max(...cs.map(sz)), x0 = cs.reduce((t, b) => t + cx(b), 0) / cs.length;
    if (cs.some(b => Math.abs(cx(b) - x0) > 0.3 * W)) return null;
    const steps = cs.slice(1).map((b, k) => cy(b) - cy(cs[k]));
    if (steps.some(d => d < 0.6 * W || d > 2.5 * W)) return null;   // 1字ずつ上から下へ並ぶ
    const step = steps.slice().sort((a, b) => a - b)[steps.length >> 1];
    const free = []; B.chars.forEach((c, j) => { const b = c.box; if (!P.mark[j] && !c.ocr && c.c.trim() && !(P.tr && PC.outside(P.tr, b)) && Math.abs(cx(b) - x0) <= 0.3 * W && sz(b) >= 0.25 * W && sz(b) <= 1.5 * W) free.push(j); });
    const walk = (y, dir) => { const out = []; for (let k = 0; k < 8; k++) { const t = y + dir * step, j = free.find(j => !out.includes(j) && Math.abs(cy(B.chars[j].box) - t) <= 0.35 * step); if (j == null) break; out.push(j); y = cy(B.chars[j].box); } return out; };
    return { up: walk(cy(cs[0]), -1).reverse(), down: walk(cy(cs[cs.length - 1]), 1) };
  }

  // sheets: データファイルのシート({ name, cols, rows })、pages: 成果物の全ページ [{ q, B }] → null(差し込み印刷ではない) または 結果
  PC.matchMerge = (sheets, pages) => {
    const T = sheets.map(tableOf).filter(t => t.recs.length >= 2);
    if (!T.length) return null;
    const PG = pages.map(({ q, B }) => pageKey(q, B)), text = PG.filter(P => P.s.length >= 10);
    if (text.length < 2) return null;
    // 3) ページごとの行
    const scoreOf = (P, r) => { let n = 0, w = 0; const got = []; for (const f of r.fields) for (const a of f.atoms) if (findAtom(P, a).length) { n++; w += a.w; got.push(a); } return { n, w, got }; };
    const best = new Map(), maxFail = text.length - Math.max(2, Math.ceil(0.6 * text.length));
    const akey = a => (a.type === 'tel' ? 'tel:' + a.vs.slice().sort()[0] : a.k);
    //   ほかの行の、その行だけの値(いちばん合う行で見つかった値でないもの)
    const ownOf = (c, top) => { const mine = new Set(top.got.map(akey)); return c.got.filter(a => !mine.has(akey(a))); };
    let fail = 0;
    for (const P of text) {
      const cands = [];
      for (const t of T) for (const r of t.recs) { const s = scoreOf(P, r); if (s.n >= 2) cands.push({ t, r, ...s }); }
      cands.sort((a, b) => b.w - a.w || b.n - a.n);
      //   同じ表のほかの行で値が見つかるもの(2行まで)。ほかの行の値がどれも、その行だけの値1つ(ほかの人の役職に置き換わった「部長」など)なら、弱い当たりとして数えない
      const top = cands[0], others = top ? cands.filter(c => c !== top && c.t === top.t && c.w >= 1) : [];
      if (top && top.w >= 1.5 && (others.length <= 1 || others.every(c => ownOf(c, top).length <= 1))) best.set(P.q, { cands, top });
      else if (++fail > maxFail) return null;   // 残りのページがすべて1行ずつでも、差し込み印刷の条件に届かない(カタログなど。早めにやめる)
    }
    if (best.size < 2 || best.size < 0.6 * text.length) return null;
    //   1ページに2件以上が並ぶらしいページ(面付け): ほかの行の、その行だけの値(いちばん合う行にない値)も多く見つかる(知らせるだけ。照合は1ページ1件として行う)
    const multiQ = new Set([...best].filter(([, { cands, top }]) => cands.some(c => { if (c === top || c.t !== top.t) return false; const own = ownOf(c, top); return own.length >= 3 && own.reduce((t, a) => t + a.w, 0) >= 1.5; })).map(([q]) => q)), multi = multiQ.size;
    //   いちばん多くのページの行がある表に、同じ人の行があれば、その表の行にそろえる(表と裏で別の表の行にならないように)
    const byT = new Map(); for (const { top } of best.values()) byT.set(top.t, (byT.get(top.t) || 0) + 1);
    const main = [...byT].sort((a, b) => b[1] - a[1])[0][0];
    for (const x of best.values()) if (x.top.t !== main) { const c = x.cands.find(c => c.t === main && c.n >= 2 && c.w >= 1.5); if (c) x.top = c; }
    // 行ごとのページ
    const groups = new Map();
    for (const [q, { top }] of best) { if (!groups.has(top.r)) groups.set(top.r, { t: top.t, r: top.r, pages: [] }); groups.get(top.r).pages.push(PG.find(P => P.q === q)); }
    const G = [...groups.values()];
    //   1ページに2件以上が並ぶらしいページは、ほかの行の字があるため、同じ作りのページどうしの比べ合わせ(5・6)と、値に続く字・共通の値の照合には使わない
    for (const g of G) for (const P of g.pages) P.multi = multiQ.has(P.q);
    // 共通の情報の値が見つかる所に印(同じ作りのページどうしで比べるとき、比べない字にする)
    const allCommon = [...new Set(T.flatMap(t => t.common))];
    for (const g of G) for (const P of g.pages) for (const a of allCommon) for (const h of findAtom(P, a)) for (const j of charsOf(P, h)) P.mark[j] = P.cmark[j] = 1;
    // 4) 行の値を探す(見つかった値の所に印)。値ごと・ページごとに、見つかった所
    const res = [];
    for (const g of G) for (const f of g.r.fields) for (const a of f.atoms) {
      const per = new Map(g.pages.map(P => [P, findAtom(P, a)])), hits = [...per].flatMap(([P, hs]) => hs.map(h => ({ P, ...h })));
      //   共通の情報(住所など)の字の中だけに見つかる値(勤務地の「大阪」など)は、その列の値として載っているとはみなさない
      const own = new Map([...per].map(([P, hs]) => [P, hs.filter(h => charsOf(P, h).some(j => !P.cmark[j]))]));
      for (const h of hits) for (const j of charsOf(h.P, h)) h.P.mark[j] = 1;
      res.push({ g, f, a, per, own, hits, miss: [] });
    }
    // 同じ作りのページ(字の大きさと行の位置がそろい、載っている列の組み合わせも近いもの)ごとに分け、行の位置(slot)をそろえる
    //   (名刺の表と裏は、電話番号・メールの行の位置が同じでも、日本語の役職・氏名と英語の役職・ローマ字で載る列が違う)
    const MP = G.flatMap(g => g.pages), L = new Map(MP.map(P => [P, linesOf(P)])), clusters = [];
    const colsOf = P => new Set(res.filter(x => (x.per.get(P) || []).length).map(x => x.f.c));
    const near = (A, Bs) => { const u = new Set([...A, ...Bs]), i = [...A].filter(c => Bs.has(c)).length; return u.size < 2 || i >= 0.5 * u.size; };
    for (const P of MP) {
      const ls = L.get(P), cs = colsOf(P);
      let cl = clusters.find(c => { const rs = L.get(c.rep), hit = ls.filter(l => rs.some(r => sameSlot(l, r))).length; return hit >= 0.5 * Math.max(ls.length, rs.length) && near(cs, colsOf(c.rep)); });
      if (!cl) { cl = { rep: P, slots: ls.map(l => ({ ...l })), pages: [] }; clusters.push(cl); }
      cl.pages.push(P); P.cl = cl;
      P.slotOf = new Map();
      for (const l of ls) {
        let s = cl.slots.findIndex(r => sameSlot(l, r));
        if (s < 0) { cl.slots.push({ ...l }); s = cl.slots.length - 1; }
        l.slot = s; for (const j of l.js) P.slotOf.set(j, l);
      }
    }
    const ord = (P, js) => js.slice().sort((a, b) => P.at.indexOf(a) - P.at.indexOf(b));
    const rest = (P, ln) => ord(P, ln.js.filter(j => !P.mark[j]));
    const txt = (P, js) => js.map(j => P.B.chars[j].c).join('');
    const ckey = (x, P) => x.f.c + ':' + x.a.li + ':' + clusters.indexOf(P.cl);
    //   行の位置ごとの決まった字(同じ作りのページの多くで、行の値・共通の情報に当たらない字が同じもの。「E」「M」などの書き込み)
    const fixedOf = new Map();
    for (const cl of clusters) for (let s = 0; s < cl.slots.length; s++) {
      const ks = cl.pages.map(P => { const ln = L.get(P).find(l => l.slot === s); return ln ? nz(txt(P, rest(P, ln))) : null; }).filter(k => k !== null);
      const cnt = new Map(); for (const k of ks) cnt.set(k, (cnt.get(k) || 0) + 1);
      const top = [...cnt].sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] >= 2 && top[1] >= 0.5 * ks.length) fixedOf.set(cl, (fixedOf.get(cl) || new Map()).set(s, top[0]));
    }
    //   行の字から、その位置の決まった字を除く(頭か終わり。4字以上の決まった字は、間に値をはさむもの(「このカードは…の所有物です」)も)
    const strip = (P, js, f) => {
      if (!f) return js;
      const t = nz(txt(P, js));
      if (t.startsWith(f)) return js.slice([...f].length);
      if (t.endsWith(f)) return js.slice(0, js.length - [...f].length);
      const F = [...f];
      if (F.length < 4) return js;
      const A = js.map(j => nz(P.B.chars[j].c)), ops = PC.opcodes(A, F), eq = ops.filter(o => o[0] === 'equal').reduce((n, o) => n + o[2] - o[1], 0);
      return eq >= 0.8 * F.length ? ops.filter(o => o[0] !== 'equal').flatMap(o => js.slice(o[1], o[2])) : js;
    };
    //   列(と改行の何行目か)ごとに、同じ作りのページで値があった行の位置と、値が載る行(人)。共通の情報の中だけに見つかる値は数えない
    const posOf = new Map(), seen = new Map();
    for (const x of res) for (const P of x.g.pages) {
      const key = ckey(x, P);
      if (!seen.has(key)) seen.set(key, { all: new Set(), hit: new Set() });
      const v = seen.get(key), hs = x.own.get(P); v.all.add(x.g);
      if (!hs.length) continue;
      v.hit.add(x.g);
      for (const h of hs) for (const l of new Set(charsOf(P, h).map(j => P.slotOf.get(j)).filter(Boolean))) { const k2 = key + ':' + l.slot; posOf.set(k2, (posOf.get(k2) || 0) + 1); }   // 値のすべての字の行(1字ずつの縦組みの氏名・2行のローマ字の氏名)
    }
    //   値が載るはずのページ: ほかの行(人)の同じ作りのページの半分以上で、この列の値が見つかる(表と裏の両方に載るメールなど)
    const expected = (x, P) => { const v = seen.get(ckey(x, P)); if (!v) return false; const all = [...v.all].filter(g => g !== x.g), hit = [...v.hit].filter(g => g !== x.g); return all.length >= 1 && hit.length >= 0.5 * all.length; };
    //   成果物に載る列: 値のある行のうち3割以上(1行だけの差し込みでは1行)で、値がそのまま見つかる列(共通の情報の中だけに見つかるものは数えない)
    const printed = new Set(), byCol = new Map(), colKey = x => x.g.t.sheet.name + ':' + x.f.c;
    for (const x of res) { const k = colKey(x); if (!byCol.has(k)) byCol.set(k, { rs: new Set(), hit: new Set() }); const v = byCol.get(k); v.rs.add(x.g); if ([...x.own.values()].some(hs => hs.length)) v.hit.add(x.g); }
    for (const [k, v] of byCol) if (v.hit.size >= Math.max(1, 0.3 * v.rs.size)) printed.add(k);
    // 見つからない値の、成果物の値: ほかの行で同じ列の値があった行の位置の字(印のない字から、その位置の決まった字を除く)、
    //   その字がなければ(ほかの値の字に置き換わったものなど)その位置の字(共通の情報の字と決まった字を除く)、なければいちばん近い字の並び
    const slotCand = (x, P) => {
      const pre = ckey(x, P) + ':', fx = fixedOf.get(P.cl) || new Map(), sl = [...posOf].filter(([k]) => k.startsWith(pre)), top = Math.max(0, ...sl.map(([, n]) => n)), all = [], whole = [];
      for (const [k, n] of sl) {
        if (n < 0.5 * top) continue;   // 値のあった行の位置のうち、多くの行(人)で使われたもの
        const s = +k.slice(pre.length), ln = L.get(P).find(l => l.slot === s);
        if (!ln) continue;
        const f = fx.get(s) || '';
        all.push(...strip(P, rest(P, ln), f));
        whole.push(...strip(P, ord(P, ln.js.filter(j => !P.cmark[j])), f));
      }
      const js = ord(P, [...new Set(all.length ? all : whole)]);
      return js.length ? { P, js, t: txt(P, js) } : null;
    };
    const nearCand = (x, P) => { const m = nearest(P, x.a.k); if (!m) return null; const js = charsOf(P, m); return { P, js, t: txt(P, js) }; };
    //   同じセルの、同じ電話番号の別の書き方(「090-…」と「+81-90-…」)は1つとみなす(1つの誤りを2件に出さない)
    const twin = (x, y) => y !== x && y.g === x.g && y.f === x.f && x.a.type === 'tel' && y.a.type === 'tel' && y.a.vs.some(v => x.a.vs.includes(v));
    for (const x of res) {
      if (!printed.has(colKey(x))) continue;
      let targets = x.g.pages.filter(P => !x.per.get(P).length && expected(x, P) && !res.some(y => twin(x, y) && (y.per.get(P).length || y.miss.some(m => m.P === P))));
      if (!targets.length && !x.hits.length) {   // どのページにも見つからない値: 同じ列(同じ何行目、なければほかの行)の値が載る作りのページ、なければ最初のページ
        const withPos = x.g.pages.filter(P => [...posOf.keys()].some(k => k.startsWith(ckey(x, P) + ':')));
        const withCol = x.g.pages.filter(P => [...posOf.keys()].some(k => { const [c, , ci] = k.split(':'); return +c === x.f.c && +ci === clusters.indexOf(P.cl); }));
        targets = [withPos[0] || withCol[0] || x.g.pages.slice().sort((a, b) => a.q - b.q)[0]];
      }
      for (const P of targets) {
        const got = slotCand(x, P) || nearCand(x, P);
        if (got) for (const j of got.js) P.mark[j] = 2;
        //   成果物の値が分からないときは、同じ列のほかの値(役職のほかの行など)の所を、おおよその場所として示す
        const near = got ? [] : res.filter(y => y !== x && y.g === x.g && y.f === x.f).flatMap(y => (y.own.get(P) || []).flatMap(h => charsOf(P, h)));
        x.miss.push({ P, got, area: near.length ? boxOfJs(P.B, near) : null });
      }
    }
    //   値のすぐ前・後ろに続く字(同じ語の中で続く、印のない字。見つからない値として出した字のあとで見る。縦組みで1字ずつ置いた値は、同じ列ですぐ上・下に続く字)を、
    //   同じ列の値・同じ作りのページどうしで比べ、多くの値(2つ以上・半分以上)と違う値を、値の違いとして出す
    //   (「品質管理部長誠」「山田太郎」の下に1字増えたもの。続く字の「様」がどの値にもあるものは出ない)
    //   (横組みは、同じ行で空白1つほどをはさんで続く語も含める: 英語の役職のうしろに増えた語)
    const hcont = (P, h) => {
      const up = [], down = [], go = i => !P.bnd[i] || P.soft[i];
      for (let i = h.i + h.n; i < P.s.length && go(i) && !P.mark[P.at[i]]; i++) if (down[down.length - 1] !== P.at[i]) down.push(P.at[i]);
      for (let i = h.i - 1; i >= 0 && go(i + 1) && !P.mark[P.at[i]]; i--) if (up[0] !== P.at[i]) up.unshift(P.at[i]);
      return { up, down };
    };
    //   続く字が、その行の位置の決まった字(メールの前の「E」など)なら、続く字としない(字の間のわずかな違いで、ページによって続く字に入ったり入らなかったりするため)
    const fixedAt = (P, j) => { const ln = P.slotOf.get(j); return ln ? (fixedOf.get(P.cl) || new Map()).get(ln.slot) || '' : ''; };
    const dropFixed = (P, js, up) => { if (!js.length) return js; const f = fixedAt(P, js[0]), t = nz(txt(P, js)); return f && (up ? f.endsWith(t) : f.startsWith(t)) ? [] : js; };
    const vk = new Map();
    for (const x of res) {
      if (x.a.type !== 'text') continue;
      for (const P of x.g.pages) for (const h of P.multi ? [] : x.own.get(P) || []) {
        const js = charsOf(P, h), v0 = vcont(P, js) || hcont(P, h), v = { up: dropFixed(P, v0.up, true), down: dropFixed(P, v0.down, false) };
        const key = x.f.c + ':' + clusters.indexOf(P.cl); if (!vk.has(key)) vk.set(key, []);
        vk.get(key).push({ x, P, js, v, t: txt(P, v.up) + '|' + txt(P, v.down) });
      }
    }
    for (const list of vk.values()) {
      const cnt = new Map(); for (const e of list) cnt.set(e.t, (cnt.get(e.t) || 0) + 1);
      const [maj, n] = [...cnt].sort((a, b) => b[1] - a[1])[0];
      if (n < 2 || n < 0.5 * list.length) continue;
      for (const e of list) {
        if (e.t === maj || (!e.v.up.length && !e.v.down.length) || e.x.miss.some(m => m.P === e.P)) continue;
        const js = [...e.v.up, ...ord(e.P, e.js), ...e.v.down];
        for (const j of [...e.v.up, ...e.v.down]) e.P.mark[j] = 2;
        e.x.miss.push({ P: e.P, got: { P: e.P, js, t: txt(e.P, js) } });
      }
    }
    // 共通の値(会社名・住所・事業所の電話番号など)の違い: ほかのページで共通の値があった行の位置に、印のない字(その行の決まった字を除く)が
    //   あれば、いちばん近い共通の値と比べ、小さな違い(字の4分の1まで)なら出す(別の共通の値にそのまま当たる字は、印が付いているので出ない)
    const cmiss = [], digits = t => t.replace(/\D/g, ''), keyA = a => (a.type === 'tel' ? 'tel:' + a.vs.slice().sort()[0] : a.k);
    //   ページごと・行の位置ごとに見つかる共通の値
    const atC = new Map();
    for (const cl of clusters) for (const P of cl.pages) {
      const m = new Map(); atC.set(P, m);
      for (const a of allCommon) for (const h of findAtom(P, a)) for (const l of new Set(charsOf(P, h).map(j => P.slotOf.get(j)).filter(Boolean))) { if (!m.has(l.slot)) m.set(l.slot, new Map()); m.get(l.slot).set(keyA(a), a); }
    }
    const cAt = (P, s) => atC.get(P).get(s) || new Map();
    for (const cl of clusters) {
      if (cl.pages.length < 2) continue;
      const used = new Map();   // 行の位置 → そこで見つかった共通の値の数
      for (const P of cl.pages) for (const [s, m] of atC.get(P)) used.set(s, (used.get(s) || 0) + m.size);
      const fx = fixedOf.get(cl) || new Map();
      for (const P of cl.pages) for (const [s, n] of used) {
        if (n < 2 || P.multi) continue;
        const ln = L.get(P).find(l => l.slot === s); if (!ln) continue;
        const js = strip(P, rest(P, ln), fx.get(s) || ''), t = txt(P, js), k = nz(t);
        if (k.length < 2) continue;
        let best = null;
        for (const a of allCommon) {
          const d = a.type === 'tel' ? Math.min(...a.vs.map(v => lev(digits(k), v))) : lev(k, a.k), L0 = a.type === 'tel' ? a.d.length : a.k.length;
          if (d <= Math.max(1, Math.floor(L0 / 4)) && (!best || d < best.d)) best = { a, d };
        }
        if (!best || best.d === 0) continue;
        for (const j of js) P.mark[j] = 2;
        cmiss.push({ P, a: best.a, got: { P, js, t } });
      }
    }
    //   共通の値が見当たらない: 同じ作りのページの多くで、ある行の位置に見つかる共通の値の数より、そのページで見つかる数が少なく、
    //   近い値(上の違い)もないとき、多くのページにある共通の値のうち、そのページにないものを出す(事業所の電話番号が消えたなど。
    //   別の事業所の人の名刺のように、別の共通の値が同じ数だけあるページは出ない)
    const modeOf = xs => (xs.length ? [...xs.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0] : 0);
    //   (ほかのページでは2か所に載る値(会社名の行と、会社名を含む決まった文)は、見つかる数がほかのページより少なければ、ないものとする)
    //   どの値がないかは、そのページにある共通の値と同じセル・となりのセルの値(1人だけの事業所の名刺で、その事業所のFAXのとなりの電話番号など)を先に選ぶ
    const cellRC = c => { const m = /^([A-Z]+)(\d+)$/.exec(c) || []; return [m[1] ? [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) : -9, +m[2] || -9]; };
    const adj = (a, b) => { if (a.sheet !== b.sheet) return false; const [c1, r1] = cellRC(a.cell), [c2, r2] = cellRC(b.cell); return Math.abs(c1 - c2) + Math.abs(r1 - r2) <= 1; };
    const lackOf = (P, cnt, ps, k) => {   // 多くのページにある共通の値のうち、そのページにないもの
      const here = allCommon.filter(a => findAtom(P, a).length), near = a => here.some(b => adj(a, b));
      const fewer = a => findAtom(P, a).length < modeOf(ps.filter(Q => Q !== P).map(Q => findAtom(Q, a).length));
      const told = a => cmiss.some(c => c.P === P && keyA(c.a) === keyA(a));
      const list = [...cnt.values()].filter(x => x.n >= 2 && x.n >= 0.5 * ps.length && fewer(x.a) && !told(x.a));
      if (!list.length) return [];
      const types = new Set(list.map(x => x.a.type)), seen = new Set(list.map(x => keyA(x.a)));
      const more = allCommon.filter(a => types.has(a.type) && near(a) && !seen.has(keyA(a)) && !findAtom(P, a).length && !told(a)).map(a => ({ a, n: 0 }));
      return [...more, ...list].sort((x, y) => near(y.a) - near(x.a) || y.n - x.n).slice(0, k);
    };
    for (const cl of clusters) {
      if (cl.pages.length < 3) continue;
      for (let s = 0; s < cl.slots.length; s++) {
        const ps = cl.pages.filter(P => L.get(P).some(l => l.slot === s)), cnt = new Map(), sizes = [];
        for (const P of ps) { const m = cAt(P, s); sizes.push(m.size); for (const [k, a] of m) cnt.set(k, { a, n: ((cnt.get(k) || {}).n || 0) + 1 }); }
        if (ps.length < 3) continue;
        const mode = modeOf(sizes);
        if (!mode) continue;
        for (const P of ps) {
          const m = cAt(P, s);
          if (P.multi || m.size >= mode || cmiss.some(c => c.P === P && c.got && c.got.js.some(j => (P.slotOf.get(j) || {}).slot === s))) continue;
          const ln = L.get(P).find(l => l.slot === s);
          for (const x of lackOf(P, cnt, ps, mode - m.size)) cmiss.push({ P, a: x.a, got: null, box: PC.mergeBox(P.B, ln.js) });
        }
      }
    }
    // 5) 同じ作りのページどうしで、印のない字(行の値・共通の情報でない字)を行の位置ごとに比べる
    const tmpl = [], overlapY = (a, b) => Math.min(a[3], b[3]) > Math.max(a[1], b[1]);
    //   決まった字どうしの違いを出すか: 小さい違い(字の4分の1まで)か、一方が他方の字を欠いただけ・足しただけのもの(行の大半が消えたものなど)
    //   (まるごと違う文は、事業所ごとの住所の英語表記など、ページごとに違ってよい決まった字とみなす)
    const close = (k, m) => {
      if (lev(k, m) <= Math.max(1, Math.floor(Math.max(k.length, m.length) / 4))) return true;
      const ops = PC.opcodes([...k], [...m]), kinds = new Set(ops.filter(o => o[0] !== 'equal').map(o => o[0]));
      return kinds.size === 1 && !kinds.has('replace') && Math.min([...k].length, [...m].length) >= 3;
    };
    const restOf = (P, s) => { const ln = L.get(P).find(l => l.slot === s); if (!ln) return null; const js = rest(P, ln), t = txt(P, js); return { P, ln, js, k: nz(t), t }; };
    const majOf = rows => { const cnt = new Map(); for (const r of rows) cnt.set(r.k, (cnt.get(r.k) || 0) + 1); const [k, n] = [...cnt].sort((a, b) => b[1] - a[1])[0] || ['', 0]; return { k, n, t: (rows.find(r => r.k === k) || {}).t || '' }; };
    for (const cl of clusters) {
      if (cl.pages.length < 2) continue;
      const R = cl.slots.map((_, s) => cl.pages.filter(P => !P.multi).map(P => restOf(P, s)).filter(Boolean)), M = R.map(majOf);
      //   ほかの位置の決まった字(行の位置がずれた「E」や英語の会社名など)
      const known = new Set(M.filter(m => m.k && m.n >= 2).map(m => m.k));
      for (let s = 0; s < cl.slots.length; s++) {
        const rows = R[s], { k: maj, n, t: want } = M[s];
        if (rows.length < 2 || n < 2 || n < 0.5 * rows.length) continue;
        for (const r of rows) {
          if (r.k === maj || !r.js.length) continue;
          if (allCommon.some(a => a.type === 'text' && (a.k === r.k || ([...r.k].length >= 2 && a.k.includes(r.k)) || r.k.includes(a.k)))) continue;   // 共通の情報のほかの値(別の事業所の住所など)
          if (maj) { if (!close(r.k, maj)) continue; }
          else if (known.has(r.k)) continue;   // 行の値だけの位置に、ほかの位置の決まった字が来たもの(行の位置のずれ)
          //   共通の値の違い・見当たらない値を出した行と同じ高さの行は出さない(電話番号が消えて「T」と「F」の行が分かれたものなど、1つの誤りを2件にしない)
          const rb = PC.mergeBox(r.P.B, r.js);
          if (cmiss.some(c => c.P === r.P && overlapY(rb, c.box || PC.mergeBox(c.P.B, c.got.js)))) continue;
          tmpl.push({ P: r.P, js: r.js, show: r.t, want, n, extra: !maj });
        }
      }
      // 6) 行ごと消えたもの: 同じ作りのページの多く(3ページ以上・7割以上)にある、共通の値の行か元の表にない字だけの行が、まるごとないページ
      //   (すぐ上か下の、同じ種類の行がそのページにもあるときだけ出す。事業所ごとに行の数が違う英語の住所などを出さないように)
      if (cl.pages.length < 3) continue;
      const info = cl.slots.map((sl, s) => {
        const pres = cl.pages.filter(P => L.get(P).some(l => l.slot === s));
        if (pres.length < Math.max(3, 0.7 * cl.pages.length)) return null;
        const mode = modeOf(pres.map(P => cAt(P, s).size));
        if (mode >= 1) return { s, kind: 'common', pres, mode, cy: sl.cy };
        const rows = R[s], m = M[s];
        if (!m.k || m.n < 2 || m.n < 0.5 * rows.length || rows.some(r => r.k === m.k && r.js.length !== r.ln.js.length)) return null;   // 元の表にない字だけの行
        return { s, kind: 'pure', pres, maj: m, cy: sl.cy };
      }).filter(Boolean);
      const agree = (P, o) => o.pres.includes(P) && (o.kind === 'common' ? cAt(P, o.s).size >= 1 : (restOf(P, o.s) || {}).k === o.maj.k);
      for (const o of info) for (const P of cl.pages) {
        if (o.pres.includes(P) || P.multi) continue;
        const sl = cl.slots[o.s], box = [sl.x0, sl.cy - sl.h / 2, sl.x1, sl.cy + sl.h / 2];
        //   その位置にほかの行(字の大きさが違うなどで、行の位置が合わなかったもの)があれば、その行の字と比べる
        const over = L.get(P).filter(l => overlapY([l.x0, l.cy - l.h / 2, l.x1, l.cy + l.h / 2], box) && Math.min(l.x1, box[2]) > Math.max(l.x0, box[0]));
        if (over.length) {
          const js = ord(P, over.flatMap(l => l.js.filter(j => !P.mark[j]))), t = txt(P, js), k = nz(t);
          if (!k || tmpl.some(x => x.P === P && x.js.some(j => js.includes(j)))) continue;
          if (o.kind === 'pure') { if (k !== o.maj.k && close(k, o.maj.k)) { tmpl.push({ P, js, show: t, want: o.maj.t, n: o.maj.n }); for (const j of js) P.mark[j] = 2; } continue; }
          let best = null;
          for (const a of allCommon) { const d = a.type === 'tel' ? Math.min(...a.vs.map(v => lev(digits(k), v))) : lev(k, a.k), L0 = a.type === 'tel' ? a.d.length : a.k.length; if (d <= Math.max(1, Math.floor(L0 / 4)) && (!best || d < best.d)) best = { a, d }; }
          if (best && best.d > 0) { cmiss.push({ P, a: best.a, got: { P, js, t } }); for (const j of js) P.mark[j] = 2; }
          continue;
        }
        const up = info.filter(u => u.cy < o.cy).sort((a, b) => b.cy - a.cy)[0], dn = info.filter(u => u.cy > o.cy).sort((a, b) => a.cy - b.cy)[0];
        if (!((up && agree(P, up)) || (dn && agree(P, dn)))) continue;
        if (o.kind === 'common') {
          const cnt = new Map(); for (const Q of o.pres) for (const [k, a] of cAt(Q, o.s)) cnt.set(k, { a, n: ((cnt.get(k) || {}).n || 0) + 1 });
          for (const x of lackOf(P, cnt, o.pres, o.mode)) cmiss.push({ P, a: x.a, got: null, box });
        } else tmpl.push({ P, js: [], box, show: '', want: o.maj.t, n: o.maj.n, gone: true });
      }
    }
    // 差し込んだ表で、成果物に見当たらない行
    const missing = [];
    for (const t of new Set(G.map(g => g.t))) {
      const got = new Set(G.filter(g => g.t === t).map(g => g.r)), rest = t.recs.filter(r => !got.has(r));
      if (rest.length && got.size >= 0.5 * t.recs.length) missing.push({ t, rows: rest });
    }
    return { tables: T, groups: G, res, printed, tmpl, cmiss, missing, multi, lost: T.filter(t => !G.some(g => g.t === t) && t.recs.some(r => [...best.values()].some(x => x.cands.some(c => c.r === r)))) };
  };
  PC.mergeBox = boxOfJs;
})();
