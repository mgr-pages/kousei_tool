// make_html.py で作った old.html・new.html を Chromium で PDF にし、直した所の位置(成果物での枠。200dpi の画素)を truth.json に書く
//   node test/inject/render.js 出力フォルダ(v{種} の親)
//   位置は new.html の <span data-e="番号"> の枠(消しただけの所は幅0の枠)。回転した字は回転したあとの枠
'use strict';
const { chromium } = require('playwright'), fs = require('fs'), path = require('path');
const K = 0.75 * 200 / 72;   // CSS の px → pt(0.75) → 200dpi の画素
(async () => {
  const root = path.resolve(process.argv[2]);
  const b = await chromium.launch(), p = await b.newPage();
  for (const v of fs.readdirSync(root).filter(d => /^v\d+$/.test(d)).sort()) {
    const dir = path.join(root, v);
    for (const name of ['old', 'new']) {
      await p.goto('file://' + path.join(dir, name + '.html'));
      await p.evaluate(() => document.fonts.ready);
      await p.pdf({ path: path.join(dir, name + '.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true });
    }
    // new.html を開いたままなので、直した所の枠を読む
    const boxes = await p.evaluate(() => {
      const pgs = [...document.querySelectorAll('.pg')], out = {};
      for (const s of document.querySelectorAll('span[data-e]')) {
        const pg = s.closest('.pg'), r0 = pg.getBoundingClientRect(), rs = [...s.getClientRects()];
        if (!rs.length) continue;
        const x0 = Math.min(...rs.map(r => r.left)), y0 = Math.min(...rs.map(r => r.top)), x1 = Math.max(...rs.map(r => r.right)), y1 = Math.max(...rs.map(r => r.bottom));
        out[s.dataset.e] = { page: pgs.indexOf(pg), box: [x0 - r0.left, y0 - r0.top, x1 - r0.left, y1 - r0.top] };
      }
      return out;
    });
    const E = JSON.parse(fs.readFileSync(path.join(dir, 'edits.json'), 'utf8'));
    for (const e of E.edits) {
      const x = boxes[e.id];
      if (!x) { e.box = null; continue; }
      const sz = e.size / 0.75, [a, bq, c, d] = x.box;   // 幅か高さが0の枠(消した所)は、字の大きさだけ広げる
      const bb = [a, bq, c, d];
      if (c - a < 1) { bb[0] -= sz / 2; bb[2] += sz / 2; }
      if (d - bq < 1) { bb[1] -= sz / 2; bb[3] += sz / 2; }
      e.page = x.page; e.box = bb.map(t => Math.round(t * K));
    }
    fs.writeFileSync(path.join(dir, 'truth.json'), JSON.stringify(E, null, 1));
    console.log(v, E.edits.filter(e => e.box).length, '件');
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
