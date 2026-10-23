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

  const S = { res: null, imgs: [], sel: null, page: 0, off: new Set(), verdict: {}, key: '', lists: { old: [], nw: [], marks: [] }, loading: new Set() };

  // ---- 入力: 各欄に複数のファイル。選んだときに中身を読み込んでおき(あとで元のファイルが変わっても照合できるように)、ページ数を数える ----
  const mode = () => document.querySelector('input[name=mode]:checked').value;
  const KIND = { old: { input: 'fOld', list: 'lOld', tot: 'tOld', label: '初校' }, nw: { input: 'fNew', list: 'lNew', tot: 'tNew', label: '修正後' }, marks: { input: 'fMarks', list: 'lMarks', tot: 'tMarks', label: '朱書き' } };
  const accepts = (kind, f) => PC.isPdf(f) || (kind === 'marks' && mode() === 'scan' && /^image\//.test(f.type));
  const byName = (a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true });
  const READ_ERR = '読み込めません。選んだあとでファイルが移動・上書き・削除された、ほかのアプリで開いて使用中、クラウド（OneDrive など）にしかない、などが考えられます。パソコン内（デスクトップなど）にコピーしてから、選び直してください。';
  async function load(e) {
    try { e.buf = await e.file.arrayBuffer(); } catch (err) { e.err = READ_ERR + '（' + (err && err.name || err) + '）'; return; }
    await countPages(e);
  }
  async function countPages(e) {
    if (!e.buf || e.pages != null || e.err) return;
    if (!PC.isPdf(e)) { e.pages = 1; return; }
    if (!PC.libsReady) return;   // 部品の準備ができたら数える
    try { const d = await PC.openPdf(e.buf.slice(0)); e.pages = d.numPages; d.destroy(); }
    catch (err) { e.err = 'PDFとして開けません（' + (err && err.message || err) + '）。パスワード付き・壊れたPDFは使えません。'; }
  }
  function add(kind, files) {
    const L = S.lists[kind], skipped = [];
    const fresh = [...files].filter(f => accepts(kind, f) || (skipped.push(f.name), false)).sort(byName);
    for (const f of fresh) {
      const e = { file: f, name: f.name, size: f.size, type: f.type, mtime: f.lastModified, buf: null, pages: null, err: null };
      const same = L.findIndex(x => x.name === f.name);
      if (same >= 0 && L[same].size === f.size && L[same].mtime === f.lastModified && !L[same].err) continue;   // 同じファイルを二度は入れない
      if (same >= 0) L[same] = e; else L.push(e);   // 同じ名前で中身が違えば、新しいほうに置き換える
      const job = load(e).finally(() => { S.loading.delete(job); refresh(); });
      S.loading.add(job);
    }
    S.addMsg = skipped.length ? `追加できない種類のファイルは外しました：${skipped.join('、')}` : '';
    S.doneMsg = ''; $('pbar').style.width = '0'; refresh();
  }
  const move = (kind, i, d) => { const L = S.lists[kind], j = i + d; if (j < 0 || j >= L.length) return; [L[i], L[j]] = [L[j], L[i]]; S.doneMsg = ''; refresh(); };
  const removeAt = (kind, i) => { S.lists[kind].splice(i, 1); S.doneMsg = ''; refresh(); };
  const clearList = kind => { S.lists[kind] = []; S.doneMsg = ''; refresh(); };
  const total = kind => S.lists[kind].reduce((n, e) => n + (e.pages || 0), 0);
  function renderFiles(kind) {
    const k = KIND[kind], L = S.lists[kind], unit = kind === 'marks' && mode() === 'scan' ? '枚' : 'ページ';
    $(k.list).innerHTML = L.map((e, i) => `<li class="${e.err ? 'err' : ''}"><span class="nm">${esc(e.name)}</span><span class="pc">${e.err ? '読めません' : e.pages == null ? '読み込み中…' : e.pages + unit}</span>` +
      `<span class="ops"><button data-op="up" data-i="${i}" title="上へ" ${i === 0 ? 'disabled' : ''}>↑</button> <button data-op="down" data-i="${i}" title="下へ" ${i === L.length - 1 ? 'disabled' : ''}>↓</button> <button data-op="del" data-i="${i}" title="外す">×</button></span>` +
      (e.err ? `<div class="em">${esc(e.err)}</div>` : '') + '</li>').join('');
    $(k.list).querySelectorAll('button').forEach(b => b.onclick = () => { const i = +b.dataset.i; b.dataset.op === 'up' ? move(kind, i, -1) : b.dataset.op === 'down' ? move(kind, i, 1) : removeAt(kind, i); });
    $(k.tot).innerHTML = L.length > 1 ? `<span>合計 ${total(kind)}${unit}（${L.length}ファイル）</span><button>すべて外す</button>` : '';
    const btn = $(k.tot).querySelector('button'); if (btn) btn.onclick = () => clearList(kind);
  }
  // 照合に渡すもの(選んだときに読み込んだ中身)
  const files = () => { const pick = kind => S.lists[kind].map(e => ({ name: e.name, size: e.size, type: e.type, buf: e.buf })); return { old: pick('old'), nw: pick('nw'), marks: pick('marks'), mode: mode() }; };
  const refresh = () => {
    const m = mode(), all = [...S.lists.old, ...S.lists.nw, ...S.lists.marks];
    ['old', 'nw', 'marks'].forEach(renderFiles);
    $('fMarks').disabled = m === 'none'; $('pMarks').classList.toggle('disabled', m === 'none');
    $('fMarks').accept = m === 'scan' ? '.pdf,application/pdf,image/*' : '.pdf,application/pdf';
    $('modeHint').textContent = { scan: 'カラー・300dpiで、初校と同じページ順にスキャンしたPDF（または画像）', digital: 'Acrobatなどで初校PDFに注釈（取り消し線・挿入・手書き・コメント）を入れたPDF', none: '朱書きなしで、初校と修正後の違いだけを一覧にします' }[m];
    const bad = all.some(e => e.err), busy = all.some(e => e.pages == null && !e.err);
    const ready = PC.libsReady && S.lists.old.length && S.lists.nw.length && (m === 'none' || S.lists.marks.length) && !bad && !busy;
    $('run').disabled = !ready;
    if (S.running) return;
    let msg = !PC.libsReady ? '部品を読み込んでいます…' : S.doneMsg;
    if (!msg) {
      if (bad) msg = '読めないファイルがあります。リストから外すか、選び直してください';
      else if (busy) msg = 'ファイルを読み込んでいます…';
      else if (!ready) msg = m === 'none' ? '初校PDF・修正後PDFを選んでください' : '初校PDF・修正後PDF・朱書きを選んでください';
      else {
        const o = total('old'), n = total('nw'), k = total('marks');
        msg = `準備ができました（初校 ${o}ページ／修正後 ${n}ページ` + (m === 'scan' ? `／スキャン ${k}枚` : m === 'digital' ? `／注釈PDF ${k}ページ` : '') + '）';
        if (o !== n || (m !== 'none' && k !== o)) msg += '　※ページ数がそろっていません。同じ通し番号のページどうしを比べます';
      }
      if (S.addMsg) msg += '　' + S.addMsg;
    }
    $('pmsg').textContent = msg;
  };
  Object.keys(KIND).forEach(kind => {
    const inp = $(KIND[kind].input);
    inp.addEventListener('change', () => { add(kind, inp.files); inp.value = ''; });   // 同じファイルを外したあとでも選び直せるように空にする
    const box = document.querySelector(`.step[data-kind="${kind}"]`);
    box.addEventListener('dragover', ev => { if (kind === 'marks' && mode() === 'none') return; ev.preventDefault(); box.classList.add('over'); });
    box.addEventListener('dragleave', () => box.classList.remove('over'));
    box.addEventListener('drop', ev => { ev.preventDefault(); box.classList.remove('over'); if (kind === 'marks' && mode() === 'none') return; add(kind, ev.dataTransfer.files); });
  });
  document.querySelectorAll('input[name=mode]').forEach(r => r.addEventListener('change', () => { S.lists.marks = []; S.addMsg = ''; S.doneMsg = ''; refresh(); }));
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
      const oldDoc = await PC.openPdfs(f.old), newDoc = await PC.openPdfs(f.nw);
      let scans = null, annDoc = null;
      if (f.mode === 'scan') scans = await PC.scanSource(f.marks);
      if (f.mode === 'digital') annDoc = await PC.openPdfs(f.marks);
      const warn = [];
      if (oldDoc.numPages !== newDoc.numPages) warn.push(`ページ数が違います（初校 ${oldDoc.numPages}／修正後 ${newDoc.numPages}）。同じページ番号どうしを比べます。`);
      if (scans && scans.count !== oldDoc.numPages) warn.push(`スキャンの枚数（${scans.count}）が初校のページ数（${oldDoc.numPages}）と違います。`);
      if (annDoc && annDoc.numPages !== oldDoc.numPages) warn.push(`注釈PDFのページ数（${annDoc.numPages}）が初校のページ数（${oldDoc.numPages}）と違います。`);
      const res = await PC.analyze({ oldDoc, newDoc, mode: f.mode, scans, annDoc, rules: ruleList, progress });
      res.seconds = (performance.now() - t0) / 1000; res.warn = warn; res.oldParts = oldDoc.parts; res.newParts = newDoc.parts;
      S.key = 'pc:' + [...f.old, ...f.nw, ...f.marks].map(x => x.name + ':' + x.size).join('|');
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
    $('tabs').innerHTML = res.pages.map((_, i) => `<button class="btn small ${i === 0 ? 'on' : ''}" data-p="${i}" title="${esc(pageLabel(i + 1))}">${i + 1}</button>`).join('') + '<span class="hint">ページ</span>';
    $('tabs').querySelectorAll('button').forEach(b => b.onclick = () => { S.page = +b.dataset.p; drawPage(); });
    $('legend').innerHTML = [['B', '修正漏れの疑い'], ['C', '指示外の変更'], ['D', '展開漏れ'], ['E', '文字データだけ'], ['A', '赤字どおり'], ['C1', '全体指示で説明'], ['F', '人が読む赤字']].map(([c, l]) => `<span style="--c: var(--c-${c})"><i></i>${l}</span>`).join('');
    renderList(); drawPage();
  }

  // ページの表示名。初校か修正後が複数のファイルに分かれていれば、どのファイルの何ページ目かも示す
  const multi = () => S.res && ((S.res.oldParts || []).length > 1 || (S.res.newParts || []).length > 1);
  const pageLabel = p => {
    if (!multi()) return `p.${p}`;
    const o = PC.pageOf(S.res.oldParts, p - 1), n = PC.pageOf(S.res.newParts, p - 1);
    return `p.${p}（初校 ${o ? o.name + ' の' + o.page + 'ページ目' : 'なし'}／修正後 ${n ? n.name + ' の' + n.page + 'ページ目' : 'なし'}）`;
  };
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
        <div class="hd"><span class="tag">${esc(tagOf(f))}</span><span class="pg">${esc(pageLabel(f.page))}</span><span class="show">${esc(f.show || '')}</span></div>
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
    $('pinfo').textContent = multi() ? pageLabel(S.page + 1) : '';
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
    const rows = [['No.', 'ページ', '初校のファイル', '初校のページ', '修正後のファイル', '修正後のページ', '区分', '種類', '内容', '読み取り', '指示文', '自動確認', '確認', 'メモ', '位置（初校・200dpi）']];
    S.res.findings.filter(f => f.cat !== 'F2').sort(cmp).forEach((f, i) => {
      const v = S.verdict[f.id] || {}, o = PC.pageOf(S.res.oldParts, f.page - 1) || {}, n = PC.pageOf(S.res.newParts, f.page - 1) || {};
      rows.push([i + 1, f.page, o.name, o.page, n.name, n.page, groupOf(f).label, tagOf(f), f.show, f.how, f.note, f.check, V[v.v] || '', v.memo || '', f.box.join(' ')]);
    });
    const blob = new Blob(['﻿' + rows.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '照合結果.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('print').onclick = () => { document.querySelectorAll('.item').forEach(drawCrops); window.print(); };

  // ---- 起動 ----
  PC.ready = async () => {
    PC.libsReady = true; $('libstate').textContent = 'オフラインで動作：ファイルは外部に送信されません';
    // 部品の準備より先に選ばれていたファイルのページ数を数える
    await Promise.all([...S.lists.old, ...S.lists.nw, ...S.lists.marks].map(countPages)); refresh();
  };
  refresh();
  // 自動テスト用の入口(画面操作と同じ処理を呼ぶ。f を省くと画面で選んだファイルを使う)
  const settled = async () => { while (S.loading.size) await Promise.all([...S.loading]); };
  window.__pc = { run: async (f, ruleList) => { await settled(); return run(f || files(), ruleList || []); }, settled, files, add, get state() { return S; } };
})();
