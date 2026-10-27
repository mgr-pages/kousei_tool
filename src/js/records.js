// 商品マスタのような表(1行が1商品で、成果物には一部の列だけが載るもの)を、行(商品)ごとに成果物と照合する
//   1) かぎの列: 値が行ごとに違い、成果物にそのまま載っている値が最も多い列(品番など)
//   2) 商品ごとに、かぎの値を成果物で探す。見つからなければ、同じ形(英字・数字・記号の並び)で1字違いのものを探す
//   3) 成果物に載る列: かぎの近く(同じ行・下の数行)に値が載っている商品が多い列(価格・入数など)。数値は「15600」と「15,600」、「150.0」と「150」を同じとみなす
//   4) 載る列の値が近くにない商品は、ほかの商品で値があった位置にある値を、成果物の値として示す
'use strict';
(function () {
  const norm = s => [...String(s).replace(/\s/g, '')].map(PC.fold).join('').replace(/(?<=\d)[,，](?=\d)/g, '');
  const isNum = s => /^-?\d+(\.\d+)?$/.test(s);
  // 値の書き方の候補(数値は「150.0」→「150」も)
  const variants = s => { const b = norm(s); if (!b) return []; const out = [b]; if (isNum(b) && String(+b) !== b) out.push(String(+b)); return out; };
  const shape = s => s.replace(/[A-Za-z]+/g, 'A').replace(/\d+/g, '9');
  const CODE = /^(?=.*\d)[A-Za-z0-9][A-Za-z0-9\-_.\/#]{3,}$/;   // 品番のような値
  const isW = c => /[0-9A-Za-z]/.test(c || '');
  // ページの文字の並び(桁区切りの「,」を除く)。at: 並びの位置 → 字の番号
  const pageKey = B => { let s = ''; const at = []; B.chars.forEach((c, j) => { if ((c.k === ',' || c.k === '，') && /\d/.test((B.chars[j - 1] || {}).k || '') && /\d/.test((B.chars[j + 1] || {}).k || '')) return; s += c.k; at.push(j); }); return { s, at }; };
  // 並びの中の値の位置(英数字の値は、前後に英数字が続かないもの。数値は小数の途中でないもの)
  function findAll(P, v) {
    const out = [];
    if (!v) return out;
    const w0 = isW(v[0]), w1 = isW(v[v.length - 1]);
    for (let i = P.s.indexOf(v); i >= 0; i = P.s.indexOf(v, i + 1)) {
      if ((w0 && isW(P.s[i - 1])) || (w1 && isW(P.s[i + v.length]))) continue;
      if (/\d/.test(v[0]) && P.s[i - 1] === '.' && /\d/.test(P.s[i - 2] || '')) continue;
      if (/\d/.test(v[v.length - 1]) && P.s[i + v.length] === '.' && /\d/.test(P.s[i + v.length + 1] || '')) continue;
      out.push(i);
    }
    return out;
  }
  const boxAt = (P, i, n) => PC.union(P.at.slice(i, i + n).map(j => P.B.chars[j].box));
  // 編集距離(かぎの1字違いを探す)
  function dist(a, b) {
    const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }
  // かぎの近く: 同じ行(左右はどこまででも。表の行の端の列も)、または下に字の高さの4倍までで左右が重なる所
  //   どの商品の値かは、いちばん近いかぎで決める(左右・上下に商品が並ぶページで、隣の商品の値と取り違えないように)
  const near = (a, b) => {
    const h = Math.max(1, a[3] - a[1]), ov = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
    if (ov > 0.4 * Math.min(h, b[3] - b[1])) return true;
    return b[1] >= a[1] - 1.5 * h && b[1] <= a[3] + 4 * h && b[0] < a[2] + 12 * h && b[2] > a[0] - 12 * h;
  };
  const gapOf = (a, b) => Math.hypot(Math.max(0, b[0] - a[2], a[0] - b[2]), 3 * Math.max(0, b[1] - a[3], a[1] - b[3]));   // 上下の離れを重く見る
  const rel = (a, b) => [(b[0] - a[0]) / Math.max(1, a[3] - a[1]), (b[1] - a[1]) / Math.max(1, a[3] - a[1])];   // かぎから見た位置(字の高さを単位に)

  // sheet: { name, cols, rows: [{ rn, cells }] }、pages: [{ q, B }] → null(この照合に向かない表) または 結果
  PC.matchRecords = (sheet, pages) => {
    const PG = pages.map(({ q, B }) => ({ q, B, ...pageKey(B) })), rows = sheet.rows, nc = sheet.cols.length;
    // 1) かぎの列: 品番のような値(英数字と記号だけで、数字を含む4字以上)が行ごとに違い、成果物にそのまま載っている値が最も多い列
    //   (品番の形は1つとは限らない。成果物に載らない形の商品が多くても、載っている形の商品で決まるように、形は分けずに数える)
    let best = null;
    for (let c = 0; c < nc; c++) {
      const vals = rows.map(r => norm(r.cells[c] || '')), idx = vals.map((v, i) => i).filter(i => CODE.test(vals[i]));
      if (idx.length < 2 || new Set(idx.map(i => vals[i])).size < 0.9 * idx.length) continue;
      // 商品の行: 品番のような値の最初の行から最後の行まで(途中の形の違う値の行も、商品の行として調べる)
      const recs = []; for (let i = idx[0]; i <= idx[idx.length - 1]; i++) if (vals[i]) recs.push(i);
      const hit = idx.filter(i => PG.some(p => findAll(p, vals[i]).length)).length;
      if (hit >= 2 && (!best || hit > best.hit)) best = { c, recs, hit, vals };
    }
    if (!best) return null;
    const kc = best.c;
    // 見出しの行: 商品の行のすぐ上で、かぎの列に字がある行
    let hr = null; for (let i = best.recs[0] - 1; i >= 0; i--) if ((rows[i].cells[kc] || '').trim()) { hr = rows[i]; break; }
    const label = c => (hr && String(hr.cells[c] || '').replace(/\s+/g, '').replace(/[（(]必須[)）]|[（(]※[^)）]*[)）]|\*.*$/g, '')) || sheet.cols[c] + '列';
    // 2) かぎを探す
    const R = best.recs.map(i => ({ i, row: rows[i], key: best.vals[i], anchors: [] }));
    for (const r of R) for (const p of PG) for (const i of findAll(p, r.key)) r.anchors.push({ p, i, n: r.key.length, box: boxAt(p, i, r.key.length) });
    // 見つからない品番は、同じ形(英字・数字・記号の並び)で1字違いのものを探す(形ごとに、成果物の中の同じ形の字の並びを集めておく)
    const keys = new Set(R.map(r => r.key)), esc = ch => ch.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&'), byShape = new Map();
    const candsOf = sk => {
      if (byShape.has(sk)) return byShape.get(sk);
      const re = new RegExp([...sk].map(ch => (ch === 'A' ? '[A-Za-z]+' : ch === '9' ? '\\d+' : esc(ch))).join(''), 'g'), out = [];
      for (const p of PG) for (const m of p.s.matchAll(re)) if (!isW(p.s[m.index - 1]) && !isW(p.s[m.index + m[0].length]) && !keys.has(m[0])) out.push({ p, i: m.index, n: m[0].length, t: m[0], box: boxAt(p, m.index, m[0].length) });
      byShape.set(sk, out); return out;
    };
    const pagesOf = new Map(); for (const r of R) for (const a of r.anchors) pagesOf.set(a.p.q, (pagesOf.get(a.p.q) || 0) + 1);
    const claimed = new Set();
    for (const r of R) {
      if (r.anchors.length) continue;
      const lim = r.key.length >= 10 ? 2 : 1;
      if (!CODE.test(r.key)) continue;
      const cs = candsOf(shape(r.key)).filter(c => !claimed.has(c) && dist(c.t, r.key) <= lim).sort((a, b) => dist(a.t, r.key) - dist(b.t, r.key) || (pagesOf.get(b.p.q) || 0) - (pagesOf.get(a.p.q) || 0));
      if (cs.length) { r.fuzzy = cs[0]; claimed.add(cs[0]); r.anchors.push(cs[0]); }
    }
    // 3) 成果物に載る列: かぎがそのまま見つかった商品のうち、6割以上で近くに値がある列
    // ページごとのかぎの位置。値の枠 b が、かぎ a の商品のものか(近くにあり、ほかの商品のかぎのほうが近くない)
    const anchorsOn = new Map(); for (const r of R) for (const a of r.anchors) { if (!anchorsOn.has(a.p.q)) anchorsOn.set(a.p.q, []); anchorsOn.get(a.p.q).push(a); }
    const mine = (a, b) => near(a.box, b) && !anchorsOn.get(a.p.q).some(o => o !== a && o.box !== a.box && gapOf(o.box, b) < gapOf(a.box, b));
    const nearHits = (r, v) => { const out = []; for (const a of r.anchors) for (const i of findAll(a.p, v)) { const b = boxAt(a.p, i, v.length); if (mine(a, b)) out.push({ a, i, n: v.length, box: b }); } return out; };
    const exact = R.filter(r => r.anchors.length && !r.fuzzy), fields = [];
    for (let c = 0; c < nc; c++) {
      if (c === kc || !exact.length) continue;
      const ok = exact.filter(r => variants(r.row.cells[c] || '').some(v => nearHits(r, v).length));
      if (ok.length < Math.max(2, 0.6 * exact.filter(r => norm(r.row.cells[c] || '')).length)) continue;
      // 値のある位置(かぎから見た位置の中央値)。値が見つからない商品で、成果物の値を拾うのに使う
      const rs = ok.map(r => { const v = variants(r.row.cells[c]).find(v => nearHits(r, v).length), h = nearHits(r, v)[0]; return rel(h.a.box, h.box); });
      const med = k => rs.map(x => x[k]).sort((a, b) => a - b)[rs.length >> 1];
      fields.push({ c, label: label(c), num: ok.every(r => isNum(norm(r.row.cells[c]))), pos: [med(0), med(1)] });
    }
    // 商品の行で多く埋まっている列のうち、成果物に載らない列の数(商品マスタの一部の列だけを載せた表かどうかの目安)
    const filled = []; for (let c = 0; c < nc; c++) if (c !== kc && exact.filter(r => norm(r.row.cells[c] || '')).length >= 0.5 * exact.length) filled.push(c);
    const hidden = filled.filter(c => !fields.some(f => f.c === c)).length;
    // 4) 商品ごとの結果
    for (const r of R) {
      r.diffs = [];
      if (!r.anchors.length) continue;
      for (const f of fields) {
        const want = norm(r.row.cells[f.c] || '');
        if (!want || variants(want).some(v => nearHits(r, v).length)) continue;
        // ほかの商品で値があった位置に近い値(数値の列は数値)を、成果物の値とする
        let got = null, bd = Infinity;
        for (const a of r.anchors) for (const m of a.p.s.matchAll(f.num ? /\d+(?:\.\d+)?/g : /[^\s\u0000]{1,20}/g)) {
          const b = boxAt(a.p, m.index, m[0].length); if (!mine(a, b)) continue;
          const [x, y] = rel(a.box, b), dd = Math.hypot(x - f.pos[0], 2 * (y - f.pos[1]));
          if (dd < bd && dd < 6) { bd = dd; got = { t: m[0], box: b, p: a.p }; }
        }
        r.diffs.push({ f, want: String(r.row.cells[f.c]).trim(), got });
      }
    }
    return { sheet, key: { c: kc, label: label(kc) }, fields, records: R, exact: exact.length, filled: filled.length, hidden };
  };
})();
