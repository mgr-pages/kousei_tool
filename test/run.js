// 自動テスト: ビルドしたHTMLをfile://で開き、画面と同じ処理で照合して結果をJSONに書き出す
//   node test/run.js 赤字原稿 修正後.pdf 出力.json
//   ファイルが複数あるときは , でつなぐ(画面と同じく、名前の順に並べて追加される)
//   環境変数 DEBUG=1 で、ページごとの字形の数・差分の数なども 出力.json と同じ場所に書き出す
'use strict';
const { chromium } = require('playwright'), path = require('path'), fs = require('fs');
(async () => {
  const [marks, newPdf, out] = process.argv.slice(2);
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const logs = [];
  p.on('console', m => { if (m.type() === 'error') logs.push(m.text()); });
  p.on('pageerror', e => logs.push('pageerror: ' + e.message));
  await p.goto('file://' + path.resolve(__dirname, '../dist/朱書き照合ツール.html'));
  await p.waitForFunction(() => window.PC && PC.libsReady, null, { timeout: 120000 });
  const many = s => s.split(',').map(x => path.resolve(x));
  await p.setInputFiles('#fMarks', many(marks)); await p.setInputFiles('#fNew', many(newPdf));
  const t0 = Date.now();
  const res = await p.evaluate(async debug => {
    window.__pcDebug = debug;
    const r = await window.__pc.run();   // 画面で選んだファイル(リストの順)で照合する
    const dbg = debug ? PC._last.map(d => ({ kind: d.kind, ot: d.ot.length, nt: d.nt.length, ch: d.ch.length, an: d.an.length, matched: d.matched, sg: d.sp && d.sp.sg, gm: d.sp && d.sp.gm,
      changes: d.ch.map(c => ({ oi: c.oi, nj: c.nj, obox: c.obox, nbox: c.nbox, before: c.before, after: c.after, status: c.status })), removed: d.removed })) : null;
    return { findings: r.findings, seconds: r.seconds, warn: r.warn, rules: r.rules, dbg: dbg && { pages: dbg, ctx: PC._ctx } };
  }, !!process.env.DEBUG);
  fs.writeFileSync(out, JSON.stringify(res.findings, null, 1));
  if (res.dbg) fs.writeFileSync(out.replace(/\.json$/, '') + '.debug.json', JSON.stringify({ rules: res.rules, ctx: res.dbg.ctx, pages: res.dbg.pages }, null, 1));
  if (process.env.SHOT) { await p.screenshot({ path: process.env.SHOT, fullPage: false }); }
  console.log(`${res.findings.length}件 ${res.seconds.toFixed(1)}秒 (全体 ${((Date.now() - t0) / 1000).toFixed(1)}秒)`, res.warn.join(' '), res.rules.length ? '全体の直し: ' + res.rules.map(r => `${r.frm}→${r.to}(${r.how})`).join(' ') : '', logs.length ? '\nconsole: ' + logs.slice(0, 5).join('\n') : '');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
