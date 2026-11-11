// 「位置を先に合わせる」比べ方の試作を、本体と同じ文字の読み取り(ブラウザの中の pdf.js・PC.pageText)で動かす
//   test/realcheck/posfirst.py は PyMuPDF の字の位置(字ごとに正確)を使う。本体は pdf.js の文字データ(まとまりの幅を字に割り振った位置)を
//   使うので、同じ考え方が本体の読み取りでも働くかを確かめる
//   node test/realcheck/posfirst_browser.js 結果のフォルダ...   (base.pdf と new.pdf を比べ、各フォルダに posfirst.json を書く)
//   採点: python3 -I test/realcheck/posfirst.py --truth --browser 結果のフォルダ...
'use strict';
const { chromium } = require('playwright'), path = require('path'), fs = require('fs');
(async () => {
  const dirs = process.argv.slice(2);
  const b = await chromium.launch(), p = await b.newPage();
  await p.goto('file://' + path.resolve(__dirname, '../../dist/校正ツール.html'));
  await p.waitForFunction(() => window.PC && PC.libsReady, null, { timeout: 120000 });
  for (const d of dirs) {
    const A = fs.readFileSync(path.join(d, 'base.pdf')).toString('base64'), B = fs.readFileSync(path.join(d, 'new.pdf')).toString('base64');
    const res = await p.evaluate(async ([a, b]) => {
      const buf = s => Uint8Array.from(atob(s), c => c.charCodeAt(0)).buffer;
      const da = await PC.openPdf(buf(a)), db = await PC.openPdf(buf(b)), out = [];
      // 2つの字の並びの違い(最長共通部分列)。返り値: [種類('=' 同じ・'-' 旧だけ・'+' 新だけ), 旧の番号, 新の番号]
      const lcs = (x, y) => {
        const n = x.length, m = y.length, t = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
        for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = x[i] === y[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
        const ops = []; let i = 0, j = 0;
        while (i < n && j < m) { if (x[i] === y[j]) { ops.push(['=', i++, j++]); } else if (t[i + 1][j] >= t[i][j + 1]) ops.push(['-', i++, -1]); else ops.push(['+', -1, j++]); }
        while (i < n) ops.push(['-', i++, -1]); while (j < m) ops.push(['+', -1, j++]);
        return ops;
      };
      for (let pno = 0; pno < Math.min(da.numPages, db.numPages); pno++) {
        const Ta = await PC.pageText(da, pno), Tb = await PC.pageText(db, pno);
        const A = Ta.chars.map(c => ({ c: c.c, b: c.box, s: Ta.items[c.it].size })), B = Tb.chars.map(c => ({ c: c.c, b: c.box, s: Tb.items[c.it].size }));
        const G = 3, key = (c, x, y) => c + '|' + Math.floor(x / G) + '|' + Math.floor(y / G), idx = new Map();
        B.forEach((q, j) => { const k = key(q.c, (q.b[0] + q.b[2]) / 2, (q.b[1] + q.b[3]) / 2); if (!idx.has(k)) idx.set(k, []); idx.get(k).push(j); });
        const used = new Uint8Array(B.length), restA = [];
        A.forEach((q, i) => {   // 1) 同じ位置の同じ字
          const cx = (q.b[0] + q.b[2]) / 2, cy = (q.b[1] + q.b[3]) / 2, tol = Math.max(0.6, 0.12 * q.s); let hit = -1;
          for (let gx = -1; gx <= 1 && hit < 0; gx++) for (let gy = -1; gy <= 1 && hit < 0; gy++)
            for (const j of idx.get(key(q.c, cx + gx * G, cy + gy * G)) || []) { const r = B[j].b; if (!used[j] && Math.abs((r[0] + r[2]) / 2 - cx) <= tol && Math.abs((r[1] + r[3]) / 2 - cy) <= tol) { hit = j; break; } }
          if (hit < 0) restA.push(i); else used[hit] = 1;
        });
        const items = [...restA.map(i => ({ o: 1, ...A[i] })), ...B.map((q, j) => (used[j] ? null : { o: 0, ...q })).filter(Boolean)];
        // 2) 残った字を、近いものどうし(同じ行・列で続く字、重なる字)でまとまりにする
        const par = items.map((_, k) => k), find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
        const near = (p, q) => {
          const s = Math.max(p.s, q.s), ox = Math.min(p.b[2], q.b[2]) - Math.max(p.b[0], q.b[0]), oy = Math.min(p.b[3], q.b[3]) - Math.max(p.b[1], q.b[1]);
          const h = Math.min(p.b[3] - p.b[1], q.b[3] - q.b[1]), w = Math.min(p.b[2] - p.b[0], q.b[2] - q.b[0]);
          return (oy >= 0.5 * h && ox >= -1.2 * s) || (ox >= 0.5 * w && oy >= -0.6 * s);
        };
        const cell = new Map();
        items.forEach((q, k) => { const ck = Math.floor(q.b[0] / 40) + '|' + Math.floor(q.b[1] / 40); if (!cell.has(ck)) cell.set(ck, []); cell.get(ck).push(k); });
        items.forEach((q, k) => {
          for (let gx = Math.floor((q.b[0] - 60) / 40); gx <= Math.floor((q.b[2] + 60) / 40); gx++) for (let gy = Math.floor((q.b[1] - 30) / 40); gy <= Math.floor((q.b[3] + 30) / 40); gy++)
            for (const m of cell.get(gx + '|' + gy) || []) if (m > k && near(q, items[m])) par[find(m)] = find(k);
        });
        const groups = new Map();
        items.forEach((q, k) => { const r = find(k); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(q); });
        const regions = [];
        for (const g of groups.values()) {   // 3) まとまりの中で、旧と新の字の並びを比べる
          const ord = (p, q) => (Math.round(p.b[1] / Math.max(2, 0.6 * p.s)) - Math.round(q.b[1] / Math.max(2, 0.6 * q.s))) || (p.b[0] - q.b[0]);
          const O = g.filter(q => q.o).sort(ord), N = g.filter(q => !q.o).sort(ord), obox = [], nbox = []; let moved = 0;
          for (const [t, i, j] of lcs(O.map(q => q.c), N.map(q => q.c))) { if (t === '=') moved++; else if (t === '-') obox.push(O[i].b); else nbox.push(N[j].b); }
          regions.push({ old: O.length, neu: N.length, obox, nbox, moved });
        }
        out.push({ nA: A.length, nB: B.length, same: A.length - restA.length, regions });
      }
      return out;
    }, [A, B]);
    fs.writeFileSync(path.join(d, 'posfirst.json'), JSON.stringify(res));
    console.log(path.basename(d), res.map(r => `${r.same}/${r.nA}`).join(' '));
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
