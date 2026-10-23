// 任意のHTMLをA4のPDFにする: node htmltopdf.js 入力.html 出力.pdf
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://' + path.resolve(process.argv[2])); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300);
  await p.pdf({ path: process.argv[3], format: 'A4', printBackground: true, preferCSSPageSize: true });
  await b.close();
})();
