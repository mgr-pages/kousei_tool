// HTMLをChromiumでPDF化し、初校側の正解位置(data-gt要素の矩形)をJSONに書き出す
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 794, height: 1123 } });
  await p.emulateMedia({ media: 'print' });
  for (const v of ['old', 'new']) {
    await p.goto('file://' + path.resolve(v + '.html')); await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(500);
    await p.pdf({ path: `${v}.pdf`, preferCSSPageSize: true, printBackground: true });
    const rects = await p.evaluate(() => [...document.querySelectorAll('[data-gt]')].map(e => {
      const pg = e.closest('.page'), pr = pg.getBoundingClientRect(), rs = [...e.getClientRects()].map(r => [r.left - pr.left, r.top - pr.top, r.right - pr.left, r.bottom - pr.top]);
      return { id: e.dataset.gt, page: +pg.id.slice(1), rects: rs };
    }));
    fs.writeFileSync(`${v}_rects.json`, JSON.stringify(rects));
  }
  await b.close(); console.log('ok');
})();
