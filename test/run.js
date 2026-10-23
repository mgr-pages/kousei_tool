// 自動テスト: ビルドしたHTMLをfile://で開き、画面と同じ処理で照合して結果をJSONに書き出す
//   node test/run.js 初校.pdf 修正後.pdf モード(scan|digital|none) 朱書きファイル|- 出力.json [全体指示JSON]
//   ファイルが複数あるときは , でつなぐ(画面と同じく、名前の順に並べて追加される)
'use strict';
const { chromium } = require('playwright'), path = require('path'), fs = require('fs');
(async () => {
  const [oldPdf, newPdf, mode, marks, out, rulesJson] = process.argv.slice(2);
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const logs = [];
  p.on('console', m => { if (m.type() === 'error') logs.push(m.text()); });
  p.on('pageerror', e => logs.push('pageerror: ' + e.message));
  await p.goto('file://' + path.resolve(__dirname, '../dist/朱書き照合ツール.html'));
  await p.waitForFunction(() => window.PC && PC.libsReady, null, { timeout: 120000 });
  const many = s => s.split(',').map(x => path.resolve(x));
  await p.setInputFiles('#fOld', many(oldPdf)); await p.setInputFiles('#fNew', many(newPdf));
  await p.check(`input[name=mode][value=${mode}]`, { force: true });
  if (marks && marks !== '-') await p.setInputFiles('#fMarks', many(marks));
  const rules = rulesJson ? JSON.parse(fs.readFileSync(rulesJson, 'utf8')) : [];
  const t0 = Date.now();
  const res = await p.evaluate(async rules => {
    const r = await window.__pc.run(null, rules);   // 画面で選んだファイル(リストの順)で照合する
    return { findings: r.findings, seconds: r.seconds, warn: r.warn };
  }, rules);
  fs.writeFileSync(out, JSON.stringify(res.findings, null, 1));
  if (process.env.SHOT) { await p.screenshot({ path: process.env.SHOT, fullPage: false }); }
  console.log(`${res.findings.length}件 ${res.seconds.toFixed(1)}秒 (全体 ${((Date.now() - t0) / 1000).toFixed(1)}秒)`, res.warn.join(' '), logs.length ? '\nconsole: ' + logs.slice(0, 5).join('\n') : '');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
