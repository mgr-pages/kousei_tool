// 画面: ファイルの選択 → 照合 → 一覧と画像で確認 → 確認結果の記録と出力
'use strict';
(function () {
  const $ = id => document.getElementById(id), esc = PC.esc;
  const COLOR = { A: 'A', A_IMG: 'A', M: 'M', B: 'B', B2: 'B2', C1: 'C1', C2: 'C', C3: 'C', D: 'D', E: 'E', F: 'F', F2: 'F', G: 'F', H: 'F', T: 'T', N: 'T', V: 'V', I: 'I', K: 'K', W: 'W', J: 'J' };
  const isLeak = f => f.cat === 'D' && (f.check.includes('漏れ') || f.check === '未統一');
  const isLight = f => f.cat === 'B2' || (f.how || '').includes('引き出し線の可能性');
  // 確認が必要なものほど上に出す。need: 直す必要がありそうなもの
  const GROUPS = [
    // 指示どおりかを自動で判定できたもの: 指示どおりでない可能性(NG)は先頭に、指示どおり(OK)は一覧から外して「参考」へ
    { key: 'NG', label: '指示どおりになっていない', test: f => f.auto === 'ng', c: 'B', need: true },
    { key: 'OK', label: '自動で確認済み（指示どおり）', test: f => f.auto === 'ok', c: 'A', minor: true, auto: true },
    { key: 'OLD', label: '前回のまま（原稿のない部分）', test: f => f.oldSame, c: 'I', minor: true },
    { key: 'B', label: '直っていない', test: f => f.cat === 'B', c: 'B', need: true },
    { key: 'C', label: '指示にない変更', test: f => f.cat === 'C2' || f.cat === 'C3', c: 'C', need: true },
    { key: 'T', label: '原稿と違う', test: f => f.cat === 'T' || f.cat === 'N', c: 'T', need: true },
    { key: 'D', label: '直し忘れ（全体・以下同様）', test: isLeak, c: 'D', need: true },
    { key: 'E', label: '文字だけ違う', test: f => f.cat === 'E', c: 'E', need: true },
    { key: 'J', label: '成果物だけで見つけた誤り（端の切れ端・かっこ・日付など）', test: f => f.cat === 'J' && f.level === 'need', c: 'J', need: true },
    { key: 'A', label: '赤字どおり変わった（中身を確認）', test: f => f.cat === 'A' || f.cat === 'A_IMG', c: 'A' },
    { key: 'K', label: '指示・書き込みの確認（人が判断）', test: f => f.cat === 'K' || f.cat === 'W', c: 'K' },
    { key: 'F', label: '読み取れない赤字', test: f => f.cat === 'F', c: 'F' },
    { key: 'C1', label: '全体・以下同様どおり', test: f => f.cat === 'C1', c: 'C1' },
    { key: 'V', label: '全角・半角などの違い', test: f => f.cat === 'V', c: 'V' },
    { key: 'I', label: '原稿が画像の部分（目で確認）', test: f => f.cat === 'I', c: 'I' },
    { key: 'J2', label: '成果物だけで見つけた確認事項（表記ゆれなど）', test: f => f.cat === 'J', c: 'J' },
    { key: 'minor', label: '参考', test: () => true, c: 'F', minor: true },
  ];
  const groupOf = f => GROUPS.find(g => g.test(f));
  // 項目の色: 分類(結果の概要のカード)の色にそろえる(参考の項目は、もとの種類の色)
  const colorOf = f => { const g = groupOf(f); return g.minor && !g.auto ? COLOR[f.cat] : g.c; };
  // 一言の結論と、何をすればよいか
  const JT = { edge: 'ページの端の文字', date: '日付の誤り', paren: 'かっこの閉じ忘れ', dup: '言葉の重なり', misuse: '誤用・誤字', okuri: '送りがなの誤り', particle: '助詞の続き方', phone: '電話番号の桁数', zip: '郵便番号の形', yure: '表記ゆれ', typo: '誤字？', ranuki: 'ら抜き言葉？', saire: 'さ入れ言葉？', tari: '「〜たり」', keigo: '敬語？', redund: '重複表現？', hankana: '半角カナ' };
  function verdictOf(f) {
    if (f.rec) {   // 表(商品マスタなど)の商品ごとの照合
      const r = f.rec;
      if (r.kind === 'ok') return ['原稿の表と一致', `${r.n}件の商品の${r.fields.join('・')}が一致しています（自動で確認済み）`];
      if (r.kind === 'key') return [`${r.field}が違う？`, `原稿の「${r.want}」がそのままは見当たらず、1字違いの「${r.got}」があります`];
      if (r.kind === 'field') return [`${r.field}が違う`, r.got ? `品番「${r.key}」の${r.field}が原稿の表と違います` : `品番「${r.key}」の近くに、原稿の表の${r.field}「${r.want}」が見当たりません`];
      if (r.kind === 'missing') return ['成果物に見当たらない', `原稿の表の${r.field}${r.n > 1 ? `（${r.n}件）` : ''}が成果物に見当たりません。載せない商品なら OK にしてください`];
    }
    if (f.oldSame) return ['前回のまま', '原稿のない部分ですが、旧版と同じです'];
    if (f.fromOld) return ['指示にない変更（旧版から）', f.fromOld === 'del' ? '旧版にあった文字がなくなっています（原稿のない部分）。意図した削除か確認' : (f.segs || []).some(g => g[0] === '-') ? '旧版から変わっています（原稿のない部分）。意図した変更か確認' : '旧版にない文字があります（原稿のない部分）。意図した変更か確認'];
    if (f.cat === 'J') return [JT[f.j.kind] || '成果物の確認', f.j.msg];
    if (f.auto === 'ok') return f.byInstr ? ['指示どおりの違い', `原稿の指示「${f.byInstr.replace(/\s+/g, ' ')}」のとおりに変わっています（自動で確認済み）`] : ['指示どおり', (f.check || '').includes('削除') ? '指示どおり消えています（自動で確認済み）' : '指示の文字が成果物にあります（自動で確認済み）'];
    if (f.auto === 'ng') return ['指示どおりになっていない？', (f.check || '').includes('削除') ? '消す指示の文字が、成果物に残っている可能性があります' : '指示の文字が、成果物の該当箇所に見当たりません'];
    if (f.cat === 'B' || f.cat === 'B2') return isLight(f) ? ['直っていない？', (f.how || '').includes('引き出し線') ? '細い線なので、引き出し線かもしれません' : '前の赤字の続き（行の折り返しなど）の可能性。念のため確認'] : ['直っていない', '赤字が修正後に反映されていません'];
    if (f.cat === 'C2') return f.kind === 'layout' ? ['指示にない変更', '赤字がないのに、改行・段落が変わっています'] : ['指示にない変更', '赤字がないのに変わっています。意図した変更か確認'];
    if (f.cat === 'C3') return ['指示にない変更', '赤字がないのに、画像・色・位置が変わっています'];
    if (f.cat === 'E') return f.lint ? ['似た別の字？', `「${f.lint.c}」になっています。「${f.lint.want}」では？`] : ['文字だけ違う', '見た目は同じですが、文字データが違います（検索・テキストに影響）'];
    if (f.cat === 'A' || f.cat === 'A_IMG') return ['赤字どおり変わった', f.cat === 'A_IMG' ? '画像・図版の中身を確認' : '指示どおりの中身か確認'];
    if (f.cat === 'F') return ['読み取れない赤字', 'どの文字への指示か読み取れませんでした。赤字を読んで確認'];
    if (f.cat === 'T') { const del = (f.segs || []).some(x => x[0] === '-'), ins = (f.segs || []).some(x => x[0] === '+'); return ['原稿と違う', del && ins ? '原稿の文字と違います' : del ? '原稿の文字が成果物にありません' : '原稿にない字が入っています']; }
    if (f.cat === 'N') return ['原稿にない文字', '原稿にない文字が成果物にあります。意図した追加か確認'];
    if (f.cat === 'V') return ['全角・半角など', '書き方（全角・半角・記号の形）だけが原稿と違います'];
    if (f.cat === 'I') return f.noSrc ? ['原稿なし', '成果物のこの部分に当たる原稿が見つかりません。原稿を確かめてください'] : ['原稿が画像', '原稿のこの部分は画像のため、文字では比べていません。目で確認'];
    if (f.cat === 'K') { const c = f.check || ''; return ['原稿の指示（人が確認）', /後送/.test(c) ? '後送の指示。素材が届いたら確認' : /素材/.test(c) ? '使う画像・素材の指定。目で確認' : '文字では判定できない指示（書式・配置・画像など）。目で確認']; }
    if (f.cat === 'W') return ['成果物の書き込み', 'アタリ・確認事項が残っています'];
    if (f.cat === 'C1') return ['全体・以下同様どおり', (f.how || '').startsWith('同じ変更') ? `赤字のない箇所ですが、同じ変更がほかにもあります（${f.how}）` : '全体指示・以下同様として変わっています'];
    if (f.cat === 'M') return ['ママ・イキ', '変更しない指示どおり、変わっていません'];
    if (f.cat === 'G') return ['全体指示の注記', ''];
    if (f.cat === 'F2') return ['引き出し線・注記', ''];
    if (f.cat === 'H') return ['赤以外の書き込み', ''];
    if (f.cat === 'D') {
      if (f.check === '未統一') return ['直し忘れ', (f.how || '').startsWith('同じ変更') ? `ほかでは「${f.to}」に直っています（${f.how}）` : '全体指示が反映されていません'];
      if (f.check.includes('漏れ')) return f.how === '同じ語の他の箇所（以下同様の候補）' ? ['同じ語が他にもある', '以下同様の指示なら、ここも直す'] : ['直し忘れ', '以下同様がここに反映されていません'];
      return ['要確認', '全体・以下同様の語が、別の形に変わっています'];
    }
    return [f.label || f.cat, ''];
  }

  // ---- 違う字だけを色で示す(同じ部分は前後の数字だけ残して省く) ----
  const CUT = 6, LONG = 40, MAXG = 4;
  const clipHead = s => { const a = [...s]; return a.length > CUT ? '…' + a.slice(-CUT).join('') : s; };
  const clipTail = s => { const a = [...s]; return a.length > CUT ? a.slice(0, CUT).join('') + '…' : s; };
  const clipMid = s => { const a = [...s]; return a.length > CUT * 2 + 1 ? a.slice(0, CUT).join('') + '…' + a.slice(-CUT).join('') : s; };
  const longCut = s => { const a = [...s]; return a.length > LONG ? `${a.slice(0, 16).join('')}…（${a.length}字）…${a.slice(-16).join('')}` : s; };
  // segs → [{t:'=', s} | {t:'x', del, ins}]
  function groupsOf(segs) {
    const G = [];
    for (const [t, s0] of segs) {
      const s = geta(s0);
      const g = G[G.length - 1];
      if (t === '=') { if (g && g.t === '=') g.s += s; else G.push({ t: '=', s }); }
      else { const h = g && g.t === 'x' ? g : (G.push({ t: 'x', del: '', ins: '' }), G[G.length - 1]); if (t === '-') h.del += s; else h.ins += s; }
    }
    return G;
  }
  function diffRows(segs, from = '原稿') {
    const G = groupsOf(segs), nx = G.filter(g => g.t === 'x').length;
    let o = '', n = '', shown = 0;
    for (let i = 0; i < G.length; i++) {
      const g = G[i];
      if (g.t === '=') { const t = esc(i === 0 ? clipHead(g.s) : i === G.length - 1 || shown === MAXG ? clipTail(g.s) : clipMid(g.s)); o += t; n += t; continue; }
      if (shown === MAXG) { const more = `<span class="more">…ほか${nx - MAXG}か所</span>`; o += more; n += more; break; }
      o += g.del ? `<del>${esc(longCut(g.del))}</del>` : '<span class="mk" title="ここに入った">∧</span>';
      n += g.ins ? `<ins>${esc(longCut(g.ins))}</ins>` : '<span class="gap" title="ここにあった字が消えた"></span>';
      shown++;
    }
    return `<div class="rows"><span class="lb">${from}</span><span class="tx">${o}</span><span class="lb">成果物</span><span class="tx">${n}</span></div>`;
  }
  // 項目の中身: 何が違うか(どの種類でも、なるべく短く)
  function whatHtml(f) {
    const q = s => `「${esc(clipMid(s || ''))}」`;
    if (f.cat === 'J') { const [a, z] = f.j.ctx.map(esc); return `<div class="rows"><span class="lb">成果物</span><span class="tx">${a}<mark>${esc(f.show)}</mark>${z}</span>${f.j.want ? `<span class="lb">候補</span><span class="tx">${a}<ins>${esc(f.j.want)}</ins>${z}</span>` : ''}</div>`; }
    if (f.lint) { const [a, z] = f.lint.ctx.map(esc); return `<div class="rows"><span class="lb">成果物</span><span class="tx">${a}<mark>${esc(f.lint.c)}</mark>${z}</span><span class="lb">候補</span><span class="tx">${a}<ins>${esc(f.lint.want)}</ins>${z}</span></div>`; }
    if (f.segs && !f.same) return diffRows(f.segs, f.fromOld ? '旧版' : '原稿');
    if (f.same) return `<div class="what">文字は同じで、${f.color ? '色' : '見た目（書体・太さ・位置・色など）'}だけが違います</div>`;
    if (f.cat === 'B' || f.cat === 'B2') return f.ins ? `<div class="what">${q(geta(f.ins[0]))}と${q(geta(f.ins[1]))}の間に入れる赤字 → 修正後も何も入っていません</div>` : `<div class="what">${f.show ? '赤字の箇所 ' + q(geta(f.show)) : 'この位置の赤字'} → 修正後も変わっていません</div>`;
    if (f.cat === 'D') {   // 指示(全体指示・以下同様)と、修正後の状態を分けて示す
      const now = f.check === '未統一' || f.check.includes('漏れ') ? `<span class="tx ng">${q(f.frm)}のまま</span>` : f.check.startsWith('展開済み') ? `<span class="tx okc">${q(f.to)}に直っている</span>` : '<span class="tx">別の形に変わっている（切り抜きで確認）</span>';
      return `<div class="rows"><span class="lb">${(f.how || '').startsWith('同じ変更') ? 'ほかの箇所' : '指示'}</span><span class="tx"><del>${esc(f.frm)}</del> → <ins>${esc(f.to || '')}</ins>${f.how ? `<span class="more">（${esc(f.how === '同じ語の他の箇所（以下同様の候補）' ? '別の箇所の赤字' : f.how)}）</span>` : ''}</span><span class="lb">ここ</span>${now}</div>`;
    }
    if (f.cat === 'M') return `<div class="what">${q(f.show)}</div>`;
    if (f.cat === 'K') return '';   // 指示文は下の行に出す
    if (f.cat === 'W') return `<div class="what">${q(f.show)}</div>`;
    if (f.cat === 'I') return `<div class="what">成果物の文字：${esc(longCut(f.show))}</div>`;
    if (f.kind === 'layout' || f.kind === 'image') return `<div class="what">${esc(f.show.replace(/[（）]/g, ''))}</div>`;
    if (f.cat === 'C2' || f.cat === 'A' || f.cat === 'C1') return '<div class="what">見た目が変わっています（文字データがないため、切り抜きで確認）</div>';
    return f.show ? `<div class="what">${esc(clipMid(geta(f.show)))}</div>` : '';
  }
  // CSV用の短い文: 「旧→新」をか所ごとに
  function diffText(f) {
    if (f.lint) return `${f.lint.ctx[0]}${f.lint.c}${f.lint.ctx[1]}（「${f.lint.want}」では？）`;
    if (f.cat === 'J') return `${f.j.ctx[0]}【${f.show}】${f.j.ctx[1]}：${f.j.msg}${f.j.want ? `（候補「${f.j.want}」）` : ''}`;
    if (f.segs && !f.same) return groupsOf(f.segs).filter(g => g.t === 'x').map(g => `${g.del || '（挿入）'}→${g.ins || '（削除）'}`).join('／');
    if (f.same) return '見た目だけの違い';
    if (f.cat === 'D') return `${f.frm}→${f.to}`;
    if (f.ins) return `${f.ins[0]}｜${f.ins[1]}の間に挿入`;
    return geta(f.show || '');
  }
  const markOf = f => {   // 指示文(注釈のコメント)と、自動確認の結果
    if (!f.note) return '';
    const c = f.check || '', cls = c.includes('OK') ? 'okc' : c.includes('見当たらない') || c.includes('されていない') ? 'ng' : '';
    const res = c.includes('OK') ? '✔ 成果物にある' : c.includes('見当たらない') ? '✖ 成果物に見当たらない' : c.includes('されていない') ? '✖ 削除されていない' : c ? c.replace(/（.*）/, '') : '';
    return `<div class="${f.cat === 'K' ? 'what' : 'meta'}">指示：「${esc(f.note)}」${res ? ` <span class="${cls}">${esc(res)}</span>` : ''}</div>`;
  };

  const geta = s => String(s ?? '').replace(/□/g, '〓');   // スキャンで読めなかった字は「〓」(ゲタ)で示す
  const S = { res: null, imgs: [], sel: null, page: 0, off: new Set(), verdict: {}, key: '', lists: { marks: [], nw: [], old: [] }, loading: new Set() };

  // ---- 入力: 各欄に複数のファイル。選んだときに中身を読み込んでおき(あとで元のファイルが変わっても照合できるように)、ページ数を数える ----
  const KIND = { marks: { input: 'fMarks', list: 'lMarks', tot: 'tMarks' }, nw: { input: 'fNew', list: 'lNew', tot: 'tNew' }, old: { input: 'fOld', list: 'lOld', tot: 'tOld' } };
  const accepts = (kind, f) => PC.isPdf(f) || (kind === 'marks' && (/^image\//.test(f.type) || PC.dataKind(f) || PC.oldOffice(f)));
  const OLD_NAME = { '.xlsx': 'Excel ブック', '.docx': 'Word 文書', '.pptx': 'PowerPoint プレゼンテーション' };
  const byName = (a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true });
  const READ_ERR = '読み込めません。パソコン内（デスクトップなど）にコピーしてから、選び直してください。';
  async function load(e) {
    const old = PC.oldOffice(e);   // 古い形式(.xls・.doc・.ppt)は読めない: 新しい形式で保存し直してもらう
    if (old) { e.err = `古い形式のファイルは読めません。「名前を付けて保存」で「${OLD_NAME[old]}（${old}）」かPDFにしてから選んでください。`; return; }
    try { e.buf = await e.file.arrayBuffer(); } catch (err) { e.err = READ_ERR + '（' + (err && err.name || err) + '）'; return; }
    await countPages(e);
  }
  async function countPages(e) {
    if (!e.buf || e.pages != null || e.err) return;
    if (PC.dataKind(e)) {   // データファイル: 読み取って、照合に使うページの数を数える(読めないファイルはここで分かる)
      try { e.pages = (await PC.readDataFile(e)).length; if (!e.pages) e.err = '文字が見つかりません（空のファイル、または文字のない内容です）。'; }
      catch (err) { e.err = (err && err.message || String(err)) + '。ファイルが壊れていないか、パスワードが付いていないか確かめてください。'; }
      return;
    }
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
    const k = KIND[kind], L = S.lists[kind];
    $(k.list).innerHTML = L.map((e, i) => `<li class="${e.err ? 'err' : ''}"><span class="nm">${esc(e.name)}</span><span class="pc">${e.err ? '読めません' : e.pages == null ? '読み込み中…' : PC.dataKind(e) ? `${PC.dataLabel(e)}・${e.pages}ページ` : e.pages + (PC.isPdf(e) ? 'ページ' : '枚')}</span>` +
      `<span class="ops"><button data-op="up" data-i="${i}" title="上へ" ${i === 0 ? 'disabled' : ''}>↑</button> <button data-op="down" data-i="${i}" title="下へ" ${i === L.length - 1 ? 'disabled' : ''}>↓</button> <button data-op="del" data-i="${i}" title="外す">×</button></span>` +
      (e.err ? `<div class="em">${esc(e.err)}</div>` : '') + '</li>').join('');
    $(k.list).querySelectorAll('button').forEach(b => b.onclick = () => { const i = +b.dataset.i; b.dataset.op === 'up' ? move(kind, i, -1) : b.dataset.op === 'down' ? move(kind, i, 1) : removeAt(kind, i); });
    $(k.tot).innerHTML = L.length > 1 ? `<span>合計 ${total(kind)}ページ（${L.length}ファイル）</span><button>すべて外す</button>` : '';
    const btn = $(k.tot).querySelector('button'); if (btn) btn.onclick = () => clearList(kind);
  }
  // 照合に渡すもの(選んだときに読み込んだ中身)
  const files = () => { const pick = kind => S.lists[kind].map(e => ({ name: e.name, size: e.size, type: e.type, buf: e.buf })); return { marks: pick('marks'), nw: pick('nw'), old: pick('old') }; };
  const refresh = () => {
    const all = [...S.lists.marks, ...S.lists.nw, ...S.lists.old];
    Object.keys(KIND).forEach(renderFiles);
    const bad = all.some(e => e.err), busy = all.some(e => e.pages == null && !e.err);
    const ready = PC.libsReady && S.lists.marks.length && S.lists.nw.length && !bad && !busy;
    $('run').disabled = !ready;
    if (S.running) return;
    let msg = !PC.libsReady ? '準備中…' : S.doneMsg;
    if (!msg) {
      if (bad) msg = '読めないファイルがあります。リストから外すか、選び直してください';
      else if (busy) msg = 'ファイルを読み込んでいます…';
      else if (!ready) msg = '原稿と成果物を選んでください';
      else msg = `原稿 ${total('marks')}ページ・成果物 ${total('nw')}ページ${S.lists.old.length ? `・旧版 ${total('old')}ページ` : ''}を照合します（対応するページは自動で探します）`;
      if (S.addMsg) msg += '　' + S.addMsg;
    }
    $('pmsg').textContent = msg;
  };
  Object.keys(KIND).forEach(kind => {
    const inp = $(KIND[kind].input);
    inp.addEventListener('change', () => { add(kind, inp.files); inp.value = ''; });   // 同じファイルを外したあとでも選び直せるように空にする
    const box = document.querySelector(`.step[data-kind="${kind}"]`);
    box.addEventListener('dragover', ev => { ev.preventDefault(); box.classList.add('over'); });
    box.addEventListener('dragleave', () => box.classList.remove('over'));
    box.addEventListener('drop', ev => { ev.preventDefault(); box.classList.remove('over'); add(kind, ev.dataTransfer.files); });
  });

  // ---- 照合の実行 ----
  const progress = (msg, frac) => { $('pmsg').textContent = msg; $('pbar').style.width = Math.round(frac * 100) + '%'; };
  async function run(f) {
    S.running = true; $('run').disabled = true; $('err').textContent = ''; progress('ファイルを開いています', 0);
    const t0 = performance.now();
    try {
      const marks = await PC.markSource(f.marks), newDoc = await PC.openPdfs(f.nw), oldDoc = f.old && f.old.length ? await PC.openPdfs(f.old) : null;
      const res = await PC.analyze({ marks, newDoc, oldDoc, progress });
      res.seconds = (performance.now() - t0) / 1000; res.markParts = marks.parts; res.newParts = newDoc.parts; res.oldParts = oldDoc ? oldDoc.parts : null;
      S.key = 'pc:' + [...f.marks, ...f.nw, ...(f.old || [])].map(x => x.name + ':' + x.size).join('|');
      try { S.verdict = JSON.parse(localStorage.getItem(S.key) || '{}'); } catch (e) { S.verdict = {}; }
      await show(res);
      S.doneMsg = `完了（${res.seconds.toFixed(1)}秒）`; progress(S.doneMsg, 1);
      return res;
    } catch (e) {
      console.error(e); $('err').textContent = '照合できませんでした：' + (e && e.message ? e.message : e); progress('エラー', 0);
      throw e;
    } finally { S.running = false; refresh(); }
  }
  $('run').onclick = () => run(files()).catch(() => {});

  // ---- 結果の表示 ----
  async function show(res) {
    S.res = res; S.sel = null; S.page = 0;
    S.imgs = res.pages.map(p => ({ L: null, R: null, Lurl: p.left ? p.left.url : null, Rurl: p.right ? p.right.url : null, lw: p.left ? p.left.w : 0, lh: p.left ? p.left.h : 0, rw: p.right ? p.right.w : 0, rh: p.right ? p.right.h : 0, region: p.region }));
    S.cache = new Map();
    await ensure(0);
    $('results').classList.remove('hidden');
    const F = res.findings, ruleNote = res.rules.length ? '／全体の直し：' + res.rules.map(r => `「${r.frm}」→「${r.to}」`).join('、') : '';
    $('sumNote').textContent = `${res.pages.length}ページ・${res.seconds.toFixed(1)}秒${ruleNote}` + (res.warn.length ? '／' + res.warn.join(' ') : '');
    $('mapNote').textContent = 'ページの対応：' + mapSummary();
    const card = g => {
      const n = F.filter(f => groupOf(f) === g).length, light = F.filter(f => groupOf(f) === g && isLight(f)).length;
      return `<div class="sum ${S.off.has(g.key) ? 'off' : ''} ${n ? '' : 'zero'}" data-g="${g.key}" style="--c: var(--c-${g.c})"><div class="n">${n}</div><div class="l">${esc(g.label)}${light ? `<br>（うち念のため ${light}）` : ''}</div></div>`;
    };
    const need = GROUPS.filter(g => g.need), look = GROUPS.filter(g => !g.need && !g.minor), nNeed = F.filter(f => groupOf(f).need).length;
    // 件数のある種類だけをカードにする(どの種類もなければ「ありません」)
    const cards = gs => { const xs = gs.filter(g => F.some(f => groupOf(f) === g)); return xs.length ? xs.map(card).join('') : '<div class="hint">ありません</div>'; };
    const nAuto = F.filter(f => groupOf(f).auto).length;
    $('summary').innerHTML = `<div class="sumgrp need"><div class="sumhd">直す必要がありそう <b>${nNeed}件</b></div><div class="sumcards">${cards(need)}</div></div>` +
      `<div class="sumgrp"><div class="sumhd">確認だけ <b>${F.filter(f => look.includes(groupOf(f))).length}件</b></div><div class="sumcards">${cards(look)}</div>` +
      (nAuto ? `<div class="hint" style="margin-top:6px">ほかに、指示どおりと自動で確認できたもの ${nAuto}件（一覧には出していません。「参考も表示」で見られます）</div>` : '') + '</div>';
    $('summary').querySelectorAll('.sum').forEach(el => el.onclick = () => { const k = el.dataset.g; S.off.has(k) ? S.off.delete(k) : S.off.add(k); el.classList.toggle('off'); renderList(); drawPage(); });
    $('tabs').innerHTML = res.pages.map((_, i) => `<button class="btn small ${i === 0 ? 'on' : ''}" data-p="${i}" title="${esc(pageLabel(i + 1))}">${i + 1}</button>`).join('') + '<span class="hint">ページ</span>';
    $('tabs').querySelectorAll('button').forEach(b => b.onclick = () => { S.page = +b.dataset.p; drawPage(); });
    $('legend').innerHTML = GROUPS.filter(g => !g.minor && F.some(f => groupOf(f) === g)).map(g => `<span style="--c: var(--c-${g.c})"><i></i>${esc(g.label.replace(/（.*/, ''))}</span>`).join('');
    renderList(); drawPage();
  }

  // ページの画像は、表示するときに読み込む(大きなページが多いときに、一度に展開してメモリが足りなくならないように)
  const loadImg = url => { if (!url) return Promise.resolve(null); if (!S.cache.has(url)) { const im = new Image(); im.src = url; S.cache.set(url, im.decode().then(() => im)); } return S.cache.get(url); };
  async function ensure(i) { const im = S.imgs[i]; if (im.Lurl && !im.L) im.L = await loadImg(im.Lurl); if (im.Rurl && !im.R) im.R = await loadImg(im.Rurl); }
  const ready = i => { const im = S.imgs[i]; return (!im.Lurl || im.L) && (!im.Rurl || im.R); };

  // ページの表示名: 原稿の何ページ目が、成果物のどのページ(のどちら側)に当たるか。ファイルが複数ならファイル名も示す
  const nm = (parts, x) => (parts || []).length > 1 ? `${x.name} の` : '';
  const newPlace = p => {   // 結果の p ページ目(原稿のページ)が当たる成果物の場所(「2ページ目・右側」)。なければ null
    const pg = S.res.pages[p - 1], im = S.imgs[p - 1], n = pg.q >= 0 ? PC.pageOf(S.res.newParts, pg.q) : null;
    if (!n) return null;
    const r = pg.region || (pg.crop && pg.crop.map(v => v * PC.S)), c = r && im && im.rw ? (r[0] + r[2]) / 2 / im.rw : 0.5, wide = r && im && im.rw && im.rw > im.rh && r[2] - r[0] < 0.7 * im.rw;   // 左右は、横長のページ(見開き)のときだけ
    return nm(S.res.newParts, n) + n.page + 'ページ目' + (wide ? (c < 0.4 ? '・左側' : c > 0.6 ? '・右側' : '') : '');
  };
  //   結果のページは原稿のページごと(データファイルのページは、載っている成果物のページごとに分かれることがある)
  const srcOf = p => { const pg = S.res.pages[p - 1]; return pg.kind === 'newonly' ? null : pg.src != null ? pg.src : p - 1; };   // 成果物だけのページは原稿なし
  const srcName = p => { const pg = S.res.pages[p - 1], o = PC.pageOf(S.res.markParts, srcOf(p)); return pg.label || (o ? nm(S.res.markParts, o) + o.page + 'ページ目' : ''); };
  const pageLabel = p => S.res.pages[p - 1].kind === 'newonly' ? `p.${p}（成果物 ${newPlace(p)} だけを確認）` : `p.${p}（原稿 ${srcName(p)} → 成果物 ${newPlace(p) || 'なし'}）`;
  // ページの対応の一覧(結果の概要に出す)。対応のない原稿のページが続くときはまとめる。同じデータファイルのページは1つにまとめる
  const mapSummary = () => {
    const out = [], P = S.res.pages;
    for (let p = 1; p <= P.length; p++) {
      const pg = P[p - 1], n = newPlace(p);
      if (pg.kind === 'newonly') continue;
      if (pg.label) {
        const prev = out[out.length - 1];
        if (prev && prev.label === pg.label) { if (n) prev.to.push(n); } else out.push({ label: pg.label, to: n ? [n] : [] });
        continue;
      }
      if (!n) { let e = p; while (e + 1 <= P.length && !P[e].label && !newPlace(e + 1)) e++; out.push(`原稿${srcOf(p) + 1}${e > p ? '〜' + (srcOf(e) + 1) : ''} → なし`); p = e; continue; }
      out.push(`原稿${srcOf(p) + 1} → 成果物 ${n}`);
    }
    return out.map(x => typeof x === 'string' ? x : `${x.label} → ${x.to.length ? '成果物 ' + x.to.join('・') : 'なし'}`).join('、');
  };;
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
      const v = S.verdict[f.id] || {}, [title, todo] = verdictOf(f);
      return `<div class="item ${S.sel === f.id ? 'sel' : ''} ${isLight(f) ? 'light' : ''}" data-id="${f.id}" style="--c: var(--c-${colorOf(f)})">
        <div class="hd"><span class="tag">${esc(title)}</span><span class="todo">${esc(todo)}</span><span class="pg">${esc(pageLabel(f.page))}${f.ref ? ' ' + esc(f.goneN && f.refs.length > 1 ? `${f.refs[0]}〜${f.refs[f.refs.length - 1]}` : f.refs ? f.refs.slice(0, 3).join('・') + (f.refs.length > 3 ? ' ほか' : '') : f.ref) : ''}</span></div>
        ${whatHtml(f)}${f.more ? `<div class="meta">同じ違いが全部で ${f.more} か所あります（ページの表示で枠を確認）</div>` : ''}${f.vsOld && !f.fromOld ? `<div class="meta">旧版：${f.vsOld === 'same' ? (f.cat === 'T' ? '同じ（前回のまま。直っていない可能性）' : '同じ') : (f.cat === 'T' ? '旧版からも変わっています' : '旧版から変わっています（原稿にない変更）')}</div>` : ''}${f.goneN ? `<div class="meta">成果物に見当たらない${f.refs && f.refs.length ? '行' : 'まとまり'}が ${f.goneN} 続いています${f.refs && f.refs.length ? `（${esc(f.refs[0])}〜${esc(f.refs[f.refs.length - 1])}）` : ''}。原稿のうち載せない部分なら OK にしてください</div>` : ''}${markOf(f)}
        <div class="crops">${f.old ? '<figure><canvas data-side="O" width="300" height="130"></canvas><figcaption>旧版</figcaption></figure>' : ''}${f.newOnly ? '' : '<figure><canvas data-side="L" width="300" height="130"></canvas><figcaption>原稿</figcaption></figure>'}<figure><canvas data-side="R" width="300" height="130"></canvas><figcaption>成果物${f.approx ? '（およその位置）' : ''}</figcaption></figure>${f.noteBox ? '<figure class="note"><canvas data-side="N" width="300" height="80"></canvas><figcaption>赤字の書き込み</figcaption></figure>' : ''}</div>
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

  // 枠: 違う字が分かっていればその位置だけ(最大4か所)、なければ変わった範囲
  const marks = (f, side) => {
    if (side === 'L') return f.onNew ? [] : (f.pboxes && f.pboxes.length && !f.same ? f.pboxes.slice(0, MAXG) : [f.box]);
    return f.pnboxes && f.pnboxes.length && !f.same ? f.pnboxes.slice(0, MAXG) : f.nbox ? [f.nbox] : [];
  };
  // 切り抜きの範囲: 違う字のまわりに、字の大きさに合わせた余白を付ける(小さい字は大きく写るように、狭めに切る)
  function cropBox(f, side) {
    const bs = marks(f, side), b = bs.length ? PC.union(bs) : (side === 'R' && f.nbox ? f.nbox : f.box);
    const hs = (bs.length ? bs : [b]).map(x => x[3] - x[1]).sort((p, q) => p - q), ch = Math.max(10, hs[hs.length >> 1]);
    const m = Math.min(60, Math.max(12, 1.5 * ch)), minW = Math.min(360, Math.max(160, 14 * ch));
    let [x0, y0, x1, y1] = [b[0] - m, b[1] - m, b[2] + m, b[3] + m];
    if (x1 - x0 < minW) { const c = (x0 + x1) / 2; x0 = c - minW / 2; x1 = c + minW / 2; }   // 小さい違いは少し広めに(前後の文脈が見えるように)
    return [x0, y0, x1, y1];
  }
  // 旧版の切り抜き(旧版から変わった所の項目)
  async function drawOld(c, f, col) {
    const pg = S.res.oldPages && S.res.oldPages[f.old.p];
    if (!pg || !f.old.box) return;
    const im = await loadImg(pg.url), b = f.old.box, m = 40;
    const [x0, y0, x1, y1] = [b[0] - m, b[1] - m, Math.max(b[2] + m, b[0] + 200), b[3] + m], w = x1 - x0, h = y1 - y0, ctx = c.getContext('2d');
    const W = c.width = 360, H = c.height = Math.max(60, Math.min(220, Math.round(W * h / w))), sc = Math.min(W / w, H / h), ox = (W - w * sc) / 2, oy = (H - h * sc) / 2, kk = im.naturalWidth / pg.w;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(im, x0 * kk, y0 * kk, w * kk, h * kk, ox, oy, w * sc, h * sc);
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([5, 3]); ctx.strokeRect(ox + (b[0] - x0 - 3) * sc, oy + (b[1] - y0 - 3) * sc, (b[2] - b[0] + 6) * sc, (b[3] - b[1] + 6) * sc); ctx.setLineDash([]);
  }
  function drawCrops(el) {
    const f0 = S.res.findings[+el.dataset.id];
    if (!ready(f0.page - 1)) { ensure(f0.page - 1).then(() => drawCrops(el)); return; }
    const f = f0, im = S.imgs[f.page - 1], col = getComputedStyle(document.documentElement).getPropertyValue('--c-' + colorOf(f)).trim();
    el.querySelectorAll('canvas').forEach(c => {
      if (c.dataset.side === 'O') { drawOld(c, f, col); return; }
      const side = c.dataset.side, [x0, y0, x1, y1] = side === 'N' ? [f.noteBox[0] - 15, f.noteBox[1] - 15, f.noteBox[2] + 15, f.noteBox[3] + 15] : cropBox(f, side), w = x1 - x0, h = y1 - y0, ctx = c.getContext('2d');
      const W = c.width = 360, H = c.height = Math.max(60, Math.min(220, Math.round(W * h / w)));
      const s = Math.min(W / w, H / h), ox = (W - w * s) / 2, oy = (H - h * s) / 2;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
      const src = side === 'R' ? im.R : im.L;
      if (!src) return;
      const kk = src.naturalWidth / (side === 'R' ? im.rw : im.lw);   // 表示用に縮めた画像の倍率
      ctx.drawImage(src, x0 * kk, y0 * kk, w * kk, h * kk, ox, oy, w * s, h * s);
      if (side === 'N') return;   // 書き込みには枠を付けない
      for (const b of marks(f, side)) {
        const r = [ox + (b[0] - x0 - 3) * s, oy + (b[1] - y0 - 3) * s, (b[2] - b[0] + 6) * s, (b[3] - b[1] + 6) * s];
        ctx.globalAlpha = 0.18; ctx.fillStyle = col; ctx.fillRect(...r); ctx.globalAlpha = 1;
        ctx.strokeStyle = col; ctx.lineWidth = 2; if (f.approx && side === 'R') ctx.setLineDash([5, 3]); ctx.strokeRect(...r); ctx.setLineDash([]);
      }
    });
  }

  function select(id, fromViewer) {
    S.sel = id; const f = S.res.findings[id];
    document.querySelectorAll('.item').forEach(el => el.classList.toggle('sel', +el.dataset.id === id));
    if (fromViewer) { const el = document.querySelector(`.item[data-id="${id}"]`); if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    S.page = f.page - 1; drawPage(true);
  }

  // ページ表示: 左に原稿、右に成果物(それぞれ半分の幅に合わせる)。判定の枠を重ね、内容で照合したページは対応する範囲を点線で示す
  let geo = null;
  function drawPage(scrollToSel) {
    if (!S.res) return;
    if (!ready(S.page)) { ensure(S.page).then(() => drawPage(scrollToSel)); return; }
    $('tabs').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.p === S.page));
    $('pinfo').textContent = pageLabel(S.page + 1);
    const im = S.imgs[S.page], gap = 16, cw = $('vscroll').clientWidth - 2, dpr = window.devicePixelRatio || 1, half = (cw - gap) / 2;
    const sR = im.R ? half / im.rw : 1, sL = im.L ? half / im.lw : sR, ox = half + gap, H = Math.max(im.L ? im.lh * sL : 60, im.R ? im.rh * sR : 0);
    const c = $('vcanvas'), ctx = c.getContext('2d');
    c.style.width = cw + 'px'; c.style.height = Math.round(H) + 'px'; c.width = Math.round(cw * dpr); c.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#e9ecf1'; ctx.fillRect(0, 0, cw, H);
    if (im.L) ctx.drawImage(im.L, 0, 0, im.lw * sL, im.lh * sL);
    else { ctx.fillStyle = '#5b6475'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('原稿なし（成果物だけを確認）', half / 2, 40); ctx.textAlign = 'start'; }
    if (im.R) ctx.drawImage(im.R, ox, 0, im.rw * sR, im.rh * sR);
    else { ctx.fillStyle = '#5b6475'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('対応する成果物のページなし', ox + half / 2, 40); ctx.textAlign = 'start'; }
    const css = getComputedStyle(document.documentElement), boxes = [];
    if (im.region) { ctx.setLineDash([6, 4]); ctx.strokeStyle = css.getPropertyValue('--accent'); ctx.lineWidth = 1.5; const r = im.region; ctx.strokeRect(ox + r[0] * sR, r[1] * sR, (r[2] - r[0]) * sR, (r[3] - r[1]) * sR); ctx.setLineDash([]); }
    for (const f of S.res.findings) {
      if (f.page !== S.page + 1 || !visible(f) || f.cat === 'F2') continue;
      const sel = f.id === S.sel; ctx.strokeStyle = css.getPropertyValue('--c-' + colorOf(f)); ctx.lineWidth = sel ? 3 : 1.5;
      if (im.L) for (const b of [...marks(f, 'L'), ...(f.moreBoxes || [])]) { const r = [b[0] * sL - 3, b[1] * sL - 3, (b[2] - b[0]) * sL + 6, (b[3] - b[1]) * sL + 6]; ctx.strokeRect(...r); boxes.push([f.id, r[0], r[1], r[0] + r[2], r[1] + r[3]]); }
      if (im.R) for (const n of [...marks(f, 'R'), ...(f.moreNboxes || [])]) { const r = [ox + n[0] * sR - 3, n[1] * sR - 3, (n[2] - n[0]) * sR + 6, (n[3] - n[1]) * sR + 6]; ctx.strokeRect(...r); boxes.push([f.id, r[0], r[1], r[0] + r[2], r[1] + r[3]]); }
    }
    geo = { boxes };
    if (scrollToSel && S.sel !== null) { const f = S.res.findings[S.sel]; $('vscroll').scrollTo({ top: Math.max(0, f.box[1] * sL - 150), behavior: 'smooth' }); }
  }
  $('vcanvas').addEventListener('click', ev => {
    if (!geo) return;
    const r = ev.target.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    const hit = geo.boxes.filter(b => x >= b[1] && x <= b[3] && y >= b[2] && y <= b[4]).sort((p, q) => (p[3] - p[1]) * (p[4] - p[2]) - (q[3] - q[1]) * (q[4] - q[2]))[0];
    if (hit) select(hit[0], true);
  });
  window.addEventListener('resize', () => drawPage());
  $('hideDone').onchange = () => { renderList(); drawPage(); };
  $('showMinor').onchange = () => { renderList(); drawPage(); };

  // ---- 出力 ----
  $('csv').onclick = () => {
    const V = { ok: 'OK', fix: '要修正', hold: '保留' }, q = s => '"' + String(s ?? '').replace(/"/g, '""') + '"';
    const rows = [['No.', 'ページ', '原稿のファイル', '原稿のページ', '成果物のファイル', '成果物のページ', '区分', '結論', 'すること', '違い（原稿→成果物）', '指示', '自動確認', '確認', 'メモ', '補足', '位置（原稿・200dpi）']];
    S.res.findings.filter(f => f.cat !== 'F2').sort(cmp).forEach((f, i) => {
      const v = S.verdict[f.id] || {}, pg = S.res.pages[f.page - 1], nq = pg.q, o = (srcOf(f.page) != null && PC.pageOf(S.res.markParts, srcOf(f.page))) || {}, n = (nq >= 0 && PC.pageOf(S.res.newParts, nq)) || {}, [title, todo] = verdictOf(f);
      rows.push([i + 1, f.page, o.name, [(pg.label && pg.label.replace(o.name, '').trim()) || o.page, f.refs ? f.refs.join('・') : f.ref].filter(Boolean).join(' '), n.name, n.page, groupOf(f).need ? '直す必要がありそう' : groupOf(f).auto ? '自動で確認済み' : groupOf(f).minor ? '参考' : '確認だけ', title, todo, diffText(f) + (f.more ? `（同じ違い 全${f.more}か所）` : '') + (f.goneN ? `（ほか${f.goneN - 1}つ続けて成果物にない）` : ''), f.note, f.check, V[v.v] || '', v.memo || '', [f.how, f.oldSame || f.vsOld === 'same' ? '旧版と同じ' : f.vsOld === 'changed' && !f.fromOld ? '旧版から変わった' : ''].filter(Boolean).join('／'), f.box.join(' ')]);
    });
    const blob = new Blob(['﻿' + rows.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '照合結果.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('print').onclick = async () => { for (let i = 0; i < S.imgs.length; i++) await ensure(i); document.querySelectorAll('.item').forEach(drawCrops); window.print(); };

  // ---- 起動 ----
  PC.ready = async () => {
    PC.libsReady = true;
    // 部品の準備より先に選ばれていたファイルのページ数を数える
    await Promise.all([...S.lists.marks, ...S.lists.nw, ...S.lists.old].map(countPages)); refresh();
  };
  refresh();
  // 自動テスト用の入口(画面操作と同じ処理を呼ぶ。f を省くと画面で選んだファイルを使う)
  const settled = async () => { while (S.loading.size) await Promise.all([...S.loading]); };
  window.__pc = { run: async f => { await settled(); return run(f || files()); }, settled, files, add, get state() { return S; } };
})();
