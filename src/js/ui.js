// 画面: ファイルの選択 → 照合 → 一覧と画像で確認 → 確認結果の記録と出力
'use strict';
(function () {
  const $ = id => document.getElementById(id), esc = PC.esc;
  const COLOR = { A: 'A', A_IMG: 'A', M: 'M', B: 'B', B2: 'B2', C1: 'C1', C2: 'C', C3: 'C', D: 'D', E: 'E', F: 'F', F2: 'F', G: 'F' };
  const TAG = { A: '赤字どおり変更', A_IMG: '赤字どおり変更（画像）', B: '修正漏れの疑い', B2: '続きの赤字（軽）', C1: '全体指示・以下同様', C2: '指示外の変更',
    C3: '指示外の変更（画像・色・位置）', E: '文字データだけの差し替え', F: '人が読む赤字', F2: '引き出し線・注記', G: '全体指示の注記', M: 'ママ・イキ' };
  const isLeak = f => f.cat === 'D' && (f.check.includes('漏れ') || f.check === '未統一');
  // 確認が必要なものほど上に出す
  const GROUPS = [
    { key: 'B', label: '修正漏れの疑い', test: f => f.cat === 'B' || f.cat === 'B2', c: 'B', major: true },
    { key: 'C', label: '指示外の変更', test: f => f.cat === 'C2' || f.cat === 'C3', c: 'C', major: true },
    { key: 'D', label: '全体指示・以下同様の展開漏れ', test: isLeak, c: 'D', major: true },
    { key: 'E', label: '文字データだけの差し替え', test: f => f.cat === 'E', c: 'E', major: true },
    { key: 'A', label: '赤字どおり変更あり（中身を確認）', test: f => f.cat === 'A' || f.cat === 'A_IMG', c: 'A' },
    { key: 'F', label: '指示箇所に結びつかない赤字', test: f => f.cat === 'F', c: 'F' },
    { key: 'C1', label: '全体指示・以下同様で説明できる変更', test: f => f.cat === 'C1', c: 'C1' },
    { key: 'minor', label: '参考（軽い指摘・展開済み・ママ等）', test: () => true, c: 'F', minor: true },
  ];
  const groupOf = f => GROUPS.find(g => g.test(f));
  const tagOf = f => f.cat === 'D' ? (f.check === '未統一' ? '修正後に残っている' : f.check.includes('漏れ') ? (f.how === '同じ語の他の箇所（以下同様の候補）' ? '同じ語が他に（以下同様？）' : '展開漏れの候補') : '展開' + (f.check ? '：' + f.check : '')) : TAG[f.cat];

  const S = { res: null, imgs: [], sel: null, page: 0, off: new Set(), verdict: {}, key: '' };

  // ---- 入力 ----
  const files = () => ({ old: $('fOld').files[0], nw: $('fNew').files[0], marks: [...$('fMarks').files], mode: document.querySelector('input[name=mode]:checked').value });
  const refresh = () => {
    const f = files();
    $('nOld').textContent = f.old ? f.old.name : ''; $('nNew').textContent = f.nw ? f.nw.name : '';
    $('nMarks').textContent = f.marks.map(x => x.name).join('、');
    $('fMarks').disabled = f.mode === 'none';
    $('fMarks').multiple = f.mode === 'scan';
    $('modeHint').textContent = { scan: 'カラー・300dpiで、初校と同じページ順にスキャンしたPDF（または画像。複数ならファイル名の順）', digital: 'Acrobatなどで初校PDFに注釈（取り消し線・挿入・手書き・コメント）を入れたPDF', none: '朱書きなしで、初校と修正後の違いだけを一覧にします' }[f.mode];
    const ready = PC.libsReady && f.old && f.nw && (f.mode === 'none' || f.marks.length);
    $('run').disabled = !ready;
    if (!S.running) $('pmsg').textContent = !PC.libsReady ? '部品を読み込んでいます…' : S.doneMsg || (ready ? '準備ができました' : '初校PDF・修正後PDF・朱書きを選んでください');
  };
  ['fOld', 'fNew', 'fMarks'].forEach(id => $(id).addEventListener('change', () => { S.doneMsg = ''; $('pbar').style.width = '0'; refresh(); }));
  document.querySelectorAll('input[name=mode]').forEach(r => r.addEventListener('change', () => { $('fMarks').value = ''; refresh(); }));
  const addRule = (frm = '', to = '') => {
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = `<input placeholder="変更前（例：お問い合わせ）" value="${esc(frm)}"><span>→</span><input placeholder="変更後（例：お問合せ）" value="${esc(to)}"><button class="btn small" title="削除">×</button>`;
    row.querySelector('button').onclick = () => row.remove();
    $('rules').appendChild(row);
  };
  $('addRule').onclick = () => addRule();
  const rules = () => [...$('rules').querySelectorAll('.row')].map(r => { const [a, b] = r.querySelectorAll('input'); return { frm: a.value.trim(), to: b.value.trim() }; }).filter(r => r.frm);

  // ---- 照合の実行 ----
  const progress = (msg, frac) => { $('pmsg').textContent = msg; $('pbar').style.width = Math.round(frac * 100) + '%'; };
  async function run(f, ruleList) {
    S.running = true; $('run').disabled = true; $('err').textContent = ''; progress('ファイルを開いています', 0);
    const t0 = performance.now();
    try {
      const oldDoc = await PC.openPdf(await f.old.arrayBuffer()), newDoc = await PC.openPdf(await f.nw.arrayBuffer());
      let scans = null, annDoc = null;
      if (f.mode === 'scan') scans = await PC.scanSource(f.marks);
      if (f.mode === 'digital') annDoc = await PC.openPdf(await f.marks[0].arrayBuffer());
      const warn = [];
      if (oldDoc.numPages !== newDoc.numPages) warn.push(`ページ数が違います（初校 ${oldDoc.numPages}／修正後 ${newDoc.numPages}）。同じページ番号どうしを比べます。`);
      if (scans && scans.count !== oldDoc.numPages) warn.push(`スキャンの枚数（${scans.count}）が初校のページ数（${oldDoc.numPages}）と違います。`);
      const res = await PC.analyze({ oldDoc, newDoc, mode: f.mode, scans, annDoc, rules: ruleList, progress });
      res.seconds = (performance.now() - t0) / 1000; res.warn = warn;
      S.key = 'pc:' + [f.old, f.nw, ...f.marks].map(x => x.name + ':' + x.size).join('|');
      try { S.verdict = JSON.parse(localStorage.getItem(S.key) || '{}'); } catch (e) { S.verdict = {}; }
      await show(res);
      S.doneMsg = `完了（${res.seconds.toFixed(1)}秒）。下の一覧で確認してください`; progress(S.doneMsg, 1);
      return res;
    } catch (e) {
      console.error(e); $('err').textContent = '照合できませんでした：' + (e && e.message ? e.message : e); progress('エラー', 0);
      throw e;
    } finally { S.running = false; refresh(); }
  }
  $('run').onclick = () => run(files(), rules()).catch(() => {});

  // ---- 結果の表示 ----
  async function show(res) {
    S.res = res; S.sel = null; S.page = 0;
    S.imgs = await Promise.all(res.pages.map(async p => { const L = new Image(), R = new Image(); L.src = p.left.url; R.src = p.right.url; await Promise.all([L.decode(), R.decode()]); return { L, R, w: p.left.w, h: p.left.h }; }));
    $('results').classList.remove('hidden');
    const F = res.findings, ruleNote = res.rules.length ? `／全体指示 ${res.rules.length}件を適用` : '';
    $('sumNote').textContent = `${res.pages.length}ページ・${res.seconds.toFixed(1)}秒${ruleNote}` + (res.warn.length ? '／' + res.warn.join(' ') : '');
    $('summary').innerHTML = GROUPS.filter(g => !g.minor).map(g => {
      const n = F.filter(f => groupOf(f) === g).length, light = F.filter(f => groupOf(f) === g && (f.cat === 'B2' || (f.how || '').includes('引き出し線の可能性'))).length;
      return `<div class="sum ${S.off.has(g.key) ? 'off' : ''}" data-g="${g.key}" style="--c: var(--c-${g.c})"><div class="n">${n}</div><div class="l">${esc(g.label)}${light ? `<br>（うち軽い指摘 ${light}）` : ''}</div></div>`;
    }).join('');
    $('summary').querySelectorAll('.sum').forEach(el => el.onclick = () => { const k = el.dataset.g; S.off.has(k) ? S.off.delete(k) : S.off.add(k); el.classList.toggle('off'); renderList(); drawPage(); });
    $('tabs').innerHTML = res.pages.map((_, i) => `<button class="btn small ${i === 0 ? 'on' : ''}" data-p="${i}">${i + 1}</button>`).join('') + '<span class="hint">ページ</span>';
    $('tabs').querySelectorAll('button').forEach(b => b.onclick = () => { S.page = +b.dataset.p; drawPage(); });
    $('legend').innerHTML = [['B', '修正漏れの疑い'], ['C', '指示外の変更'], ['D', '展開漏れ'], ['E', '文字データだけ'], ['A', '赤字どおり'], ['C1', '全体指示で説明'], ['F', '人が読む赤字']].map(([c, l]) => `<span style="--c: var(--c-${c})"><i></i>${l}</span>`).join('');
    renderList(); drawPage();
  }

  const visible = f => {
    const g = groupOf(f);
    if (g.minor && !$('showMinor').checked) return false;
    if (S.off.has(g.key)) return false;
    if ($('hideDone').checked && (S.verdict[f.id] || {}).v === 'ok') return false;
    return true;
  };
  const order = f => { const gi = GROUPS.indexOf(groupOf(f)); return [gi, f.check.includes('見当たらない') || f.cat === 'B' ? 0 : 1, (f.how || '').includes('引き出し線の可能性') ? 1 : 0, f.page, f.box[1], f.box[0]]; };
  const cmp = (a, b) => { const x = order(a), y = order(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
  let observer = null;
  function renderList() {
    const F = S.res.findings.filter(visible).sort(cmp), list = $('list');
    if (observer) observer.disconnect();
    if (!F.length) { list.innerHTML = '<div class="empty">表示する項目はありません</div>'; return; }
    list.innerHTML = F.map(f => {
      const v = S.verdict[f.id] || {}, chk = f.check ? `<span class="${f.check.includes('OK') ? 'okc' : f.check.includes('見当たらない') || f.check.includes('漏れ') || f.check === '未統一' ? 'ng' : ''}">${esc(f.check)}</span>` : '';
      const meta = [f.how && '読み取り：' + esc(f.how), f.note && '指示文：「' + esc(f.note) + '」', chk].filter(Boolean).join('　');
      return `<div class="item ${S.sel === f.id ? 'sel' : ''}" data-id="${f.id}" style="--c: var(--c-${COLOR[f.cat]})">
        <div class="hd"><span class="tag">${esc(tagOf(f))}</span><span class="pg">p.${f.page}</span><span class="show">${esc(f.show || '')}</span></div>
        ${meta ? `<div class="meta">${meta}</div>` : ''}
        <div class="crops"><figure><canvas data-side="L" width="300" height="130"></canvas><figcaption>初校＋朱書き</figcaption></figure><figure><canvas data-side="R" width="300" height="130"></canvas><figcaption>修正後</figcaption></figure></div>
        <div class="judge"><button class="btn small ${v.v === 'ok' ? 'on' : ''}" data-v="ok">OK</button><button class="btn small ${v.v === 'fix' ? 'on' : ''}" data-v="fix">要修正</button><button class="btn small ${v.v === 'hold' ? 'on' : ''}" data-v="hold">保留</button><input placeholder="メモ" value="${esc(v.memo || '')}"></div>
      </div>`;
    }).join('');
    // 切り抜きは画面に入ったものから描く
    observer = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { drawCrops(e.target); observer.unobserve(e.target); } }), { rootMargin: '400px' });
    list.querySelectorAll('.item').forEach(el => {
      observer.observe(el);
      const id = +el.dataset.id;
      el.onclick = ev => { if (ev.target.closest('.judge')) return; select(id, false); };
      el.querySelectorAll('.judge button').forEach(b => b.onclick = () => { const v = S.verdict[id] || {}; v.v = v.v === b.dataset.v ? '' : b.dataset.v; S.verdict[id] = v; save(); el.querySelectorAll('.judge button').forEach(x => x.classList.toggle('on', x.dataset.v === v.v)); });
      el.querySelector('.judge input').oninput = e => { const v = S.verdict[id] || {}; v.memo = e.target.value; S.verdict[id] = v; save(); };
    });
  }
  const save = () => { try { localStorage.setItem(S.key, JSON.stringify(S.verdict)); } catch (e) { /* 保存できない環境でも動作は続ける */ } };

  function cropBox(f, side) {
    const b = side === 'R' && f.nbox ? f.nbox : f.box, m = 70;
    return [b[0] - m, b[1] - m, b[2] + m, b[3] + m];
  }
  function drawCrops(el) {
    const f = S.res.findings[+el.dataset.id], im = S.imgs[f.page - 1];
    el.querySelectorAll('canvas').forEach(c => {
      const side = c.dataset.side, [x0, y0, x1, y1] = cropBox(f, side), w = x1 - x0, h = y1 - y0, ctx = c.getContext('2d');
      const W = c.width = 360, H = c.height = Math.max(60, Math.min(220, Math.round(W * h / w)));
      const s = Math.min(W / w, H / h), ox = (W - w * s) / 2, oy = (H - h * s) / 2;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
      ctx.drawImage(side === 'L' ? im.L : im.R, x0, y0, w, h, ox, oy, w * s, h * s);
      const b = side === 'R' ? f.nbox : f.box;
      if (b) { ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--c-' + COLOR[f.cat]); ctx.lineWidth = 2; ctx.strokeRect(ox + (b[0] - x0 - 5) * s, oy + (b[1] - y0 - 5) * s, (b[2] - b[0] + 10) * s, (b[3] - b[1] + 10) * s); }
    });
  }

  function select(id, fromViewer) {
    S.sel = id; const f = S.res.findings[id];
    document.querySelectorAll('.item').forEach(el => el.classList.toggle('sel', +el.dataset.id === id));
    if (fromViewer) { const el = document.querySelector(`.item[data-id="${id}"]`); if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    S.page = f.page - 1; drawPage(true);
  }

  // ページ表示: 左に初校＋朱書き、右に修正後。判定の枠を重ねる
  let geo = null;
  function drawPage(scrollToSel) {
    if (!S.res) return;
    $('tabs').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.p === S.page));
    const im = S.imgs[S.page], gap = 30, cw = $('vscroll').clientWidth - 2, dpr = window.devicePixelRatio || 1;
    const s = cw / (im.w * 2 + gap), c = $('vcanvas'), ctx = c.getContext('2d');
    c.style.width = cw + 'px'; c.style.height = Math.round(im.h * s) + 'px'; c.width = Math.round(cw * dpr); c.height = Math.round(im.h * s * dpr);
    ctx.setTransform(s * dpr, 0, 0, s * dpr, 0, 0);
    ctx.fillStyle = '#e9ecf1'; ctx.fillRect(0, 0, im.w * 2 + gap, im.h);
    ctx.drawImage(im.L, 0, 0); ctx.drawImage(im.R, im.w + gap, 0);
    const css = getComputedStyle(document.documentElement), boxes = [];
    for (const f of S.res.findings) {
      if (f.page !== S.page + 1 || !visible(f) || f.cat === 'F2') continue;
      const sel = f.id === S.sel; ctx.strokeStyle = css.getPropertyValue('--c-' + COLOR[f.cat]); ctx.lineWidth = sel ? 10 : 4;
      const b = f.box; ctx.strokeRect(b[0] - 6, b[1] - 6, b[2] - b[0] + 12, b[3] - b[1] + 12); boxes.push([f.id, b[0] - 6, b[1] - 6, b[2] + 6, b[3] + 6]);
      if (f.nbox) { const n = f.nbox; ctx.strokeRect(im.w + gap + n[0] - 6, n[1] - 6, n[2] - n[0] + 12, n[3] - n[1] + 12); boxes.push([f.id, im.w + gap + n[0] - 6, n[1] - 6, im.w + gap + n[2] + 6, n[3] + 6]); }
    }
    geo = { s, boxes };
    if (scrollToSel && S.sel !== null) { const f = S.res.findings[S.sel]; $('vscroll').scrollTo({ top: Math.max(0, f.box[1] * s - 150), behavior: 'smooth' }); }
  }
  $('vcanvas').addEventListener('click', ev => {
    if (!geo) return;
    const r = ev.target.getBoundingClientRect(), x = (ev.clientX - r.left) / geo.s, y = (ev.clientY - r.top) / geo.s;
    const hit = geo.boxes.filter(b => x >= b[1] && x <= b[3] && y >= b[2] && y <= b[4]).sort((p, q) => (p[3] - p[1]) * (p[4] - p[2]) - (q[3] - q[1]) * (q[4] - q[2]))[0];
    if (hit) select(hit[0], true);
  });
  window.addEventListener('resize', () => drawPage());
  $('hideDone').onchange = () => { renderList(); drawPage(); };
  $('showMinor').onchange = () => { renderList(); drawPage(); };

  // ---- 出力 ----
  $('csv').onclick = () => {
    const V = { ok: 'OK', fix: '要修正', hold: '保留' }, q = s => '"' + String(s ?? '').replace(/"/g, '""') + '"';
    const rows = [['No.', 'ページ', '区分', '種類', '内容', '読み取り', '指示文', '自動確認', '確認', 'メモ', '位置（初校・200dpi）']];
    S.res.findings.filter(f => f.cat !== 'F2').sort(cmp).forEach((f, i) => { const v = S.verdict[f.id] || {}; rows.push([i + 1, f.page, groupOf(f).label, tagOf(f), f.show, f.how, f.note, f.check, V[v.v] || '', v.memo || '', f.box.join(' ')]); });
    const blob = new Blob(['﻿' + rows.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '照合結果.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('print').onclick = () => { document.querySelectorAll('.item').forEach(drawCrops); window.print(); };

  // ---- 起動 ----
  PC.ready = async () => {
    PC.libsReady = true; $('libstate').textContent = 'オフラインで動作：ファイルは外部に送信されません'; refresh();
  };
  // 自動テスト用の入口(画面操作と同じ処理を呼ぶ)
  window.__pc = { run: (f, ruleList) => run(f, ruleList || []), get state() { return S; } };
})();
