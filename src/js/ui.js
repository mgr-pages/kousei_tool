// 画面: ファイルの選択 → 照合 → 一覧と画像で確認 → 確認結果の記録と出力
'use strict';
(function () {
  const $ = id => document.getElementById(id), esc = PC.esc;
  const isLeak = f => f.cat === 'D' && (f.check.includes('漏れ') || f.check === '未統一');
  const isLight = f => f.cat === 'B2' || (f.how || '').includes('引き出し線の可能性');
  // 確認が必要なものほど上に出す。need: 直す必要がありそうなもの
  const GROUPS = [
    // 指示どおりかを自動で判定できたもの: 指示どおりでない可能性(NG)は先頭に、指示どおり(OK)は一覧から外して「参考」へ
    { key: 'NG', label: '指示どおりになっていない', test: f => f.auto === 'ng', need: true },
    { key: 'OK', label: '自動で確認済み（指示どおり）', test: f => f.auto === 'ok', minor: true, auto: true },
    { key: 'OLD', label: '前回のまま（原稿のない部分）', test: f => f.oldSame, minor: true },
    // 原稿がなく旧版と比べたとき: 前回の成果物から変わった所(指示がないので、意図した変更かを確かめるもの)
    { key: 'P', label: '前回から変わった所', test: f => !!f.fromOld && S.runMode === 'old' && f.cat !== 'V' },
    { key: 'B', label: '直っていない', test: f => f.cat === 'B', need: true },
    // 文字データのない所(アウトライン・画像の文字)を OCR で読んだ字がかかわる違い(読み違いのこともあるので分けて示す)
    { key: 'CO', label: '旧版と違う？（OCRで読んだ字）', test: f => f.cat === 'C2' && f.ocr, need: true },
    { key: 'C', label: '指示にない変更', test: f => f.cat === 'C2' || f.cat === 'C3', need: true },
    { key: 'TO', label: '原稿と違う？（OCRで読んだ字）', test: f => (f.cat === 'T' || f.cat === 'N') && f.ocr, need: true },
    { key: 'T', label: '原稿と違う', test: f => f.cat === 'T' || f.cat === 'N', need: true },
    { key: 'D', label: '直し忘れ（全体・以下同様）', test: isLeak, need: true },
    { key: 'E', label: '文字だけ違う', test: f => f.cat === 'E', need: true },
    { key: 'J', label: '成果物だけで見つけた誤り（端の切れ端・かっこ・日付など）', test: f => f.cat === 'J' && f.level === 'need', need: true },
    { key: 'A', label: '赤字どおり変わった（中身を確認）', test: f => f.cat === 'A' || f.cat === 'A_IMG' },
    { key: 'K', label: '指示・書き込みの確認（人が判断）', test: f => f.cat === 'K' || f.cat === 'W' },
    { key: 'F', label: '読み取れない赤字', test: f => f.cat === 'F' },
    { key: 'C1', label: '全体・以下同様どおり', test: f => f.cat === 'C1' },
    { key: 'V', label: '全角・半角などの違い', test: f => f.cat === 'V' },
    { key: 'I', label: '原稿が画像の部分（目で確認）', test: f => f.cat === 'I' },
    { key: 'J2', label: '成果物だけで見つけた確認事項（表記ゆれなど）', test: f => f.cat === 'J' },
    { key: 'minor', label: '参考', test: () => true, minor: true },
  ];
  const groupOf = f => GROUPS.find(g => g.test(f));
  // ---- 詳細設定: チェックする項目(校正の観点ごと。既定はすべて選ぶ) ----
  //   外した項目は、結果の概要・一覧・ページの枠・CSVに出さない(照合はすべて行い、表示だけを絞る。照合のあとでも切り替えられる)
  //   項目は、上から順に最初に当てはまったものとする(表の商品ごとの照合・旧版から変わった所は、文字の違いより先に見る)
  const jk = (...ks) => f => f.cat === 'J' && ks.includes(f.j.kind);
  const OPTS = [
    ['範囲', [
      ['slug', '仕上がり（トンボ）の外の文字（ページ情報など）', f => !!f.outTrim],
    ]],
    ['原稿と照合する', [
      ['instr', '赤字が直っているか（直っていない・ママ／イキ）', f => ['B', 'B2', 'M'].includes(f.cat)],
      ['changed', '赤字どおり変わった所（中身・自動での確認）', f => f.cat === 'A' || f.cat === 'A_IMG'],
      ['extra', '指示にない変更（赤字のない所の変化）', f => f.cat === 'C2' || f.cat === 'C3'],
      ['rule', '全体指示・以下同様の直し忘れ', f => f.cat === 'D' || f.cat === 'C1'],
      ['text', '原稿（ラフ・データ）と違う文字', f => f.cat === 'T' || f.cat === 'N'],
      ['rec', '表（商品マスタ）と商品ごとの照合', f => !!f.rec],
      ['merge', '差し込み印刷（名刺など）の行ごとの照合', f => !!f.merge || (f.cat === 'J' && f.j.kind === 'tmpl')],
      ['width', '全角・半角などの書き方の違い', f => f.cat === 'V'],
      ['look', '見た目が同じで文字データが違う字', f => f.cat === 'E'],
      ['note', '原稿の指示・コメント、成果物の書き込み（アタリなど）', f => f.cat === 'K' || f.cat === 'W'],
      ['unread', '読み取れない赤字・注記', f => ['F', 'F2', 'G', 'H'].includes(f.cat)],
      ['image', '原稿が画像の部分・原稿のない部分', f => f.cat === 'I'],
      ['ocr', '文字データのない所（OCRで読んだ字）の違い', f => !!f.ocr],
    ]],
    ['旧版と比べる', [
      ['old', '旧版から変わった所・前回のまま（原稿のない部分）', f => !!f.fromOld || !!f.oldSame],
    ]],
    ['成果物だけでチェックする', [
      ['edge', 'ページの端・断裁で切れる文字', jk('edge')],
      ['date', '日付と曜日・存在しない日付', jk('date')],
      ['paren', 'かっこの閉じ忘れ', jk('paren')],
      ['dup', '言葉・助詞・句読点の重なり', jk('dup')],
      ['misuse', '誤用・誤字（決まった言い方）', jk('misuse')],
      ['okuri', '送りがなの誤り', jk('okuri')],
      ['particle', '助詞の続き方', jk('particle')],
      ['phone', '電話番号・郵便番号の形', jk('phone', 'zip')],
      ['tax', '税込・税抜の計算', jk('tax')],
      ['price', '同じ品番の価格の食い違い', jk('price')],
      ['noteref', '注記番号（※1）と注記の対応・番号の抜け', jk('noteref', 'listno')],
      ['yure', '表記ゆれ', jk('yure')],
      ['typo', 'カタカナ語の1字違い', jk('typo')],
      ['ranuki', 'ら抜き言葉・れ足す言葉', jk('ranuki')],
      ['saire', 'さ入れ言葉', jk('saire')],
      ['tari', '「〜たり」の並べ方', jk('tari')],
      ['keigo', '敬語', jk('keigo')],
      ['redund', '重複表現', jk('redund')],
      ['style', '文体の混在（です・ます と だ・である）', jk('style')],
      ['gram', '文法（二重否定・「を」や逆接の「が」の重なり・同じ接続詞の続き・「の」の続き）', jk('gram')],
      ['colloq', '話し言葉（い抜き言葉・「〜ちゃう」・「すごく」「〜けど」など）', jk('colloq')],
      ['hankana', '半角カナ', jk('hankana')],
      ['spell', '英語のつづり', jk('spell')],
      ['article', '英語の冠詞（a・an）', jk('article')],
    ]],
  ];
  //   仕上がりの外の項目は、どの種類でも「範囲」の設定で外せるよう、いちばん先に見る
  const OPT_ALL = OPTS.flatMap(([, xs]) => xs), FIRST = ['slug', 'ocr', 'rec', 'merge', 'old'], OPT_ORDER = [...FIRST, ...OPT_ALL.map(o => o[0]).filter(k => !FIRST.includes(k))].map(k => OPT_ALL.find(o => o[0] === k));
  const OPT_KEY = 'pc:opts';
  const optOff = (() => { try { const v = JSON.parse(localStorage.getItem(OPT_KEY) || '[]'); return new Set(Array.isArray(v) ? v : []); } catch (e) { return new Set(); } })();
  const optOf = f => OPT_ORDER.find(o => o[2](f));
  const enabled = f => { const o = optOf(f); return !o || !optOff.has(o[0]); };
  // 項目の色は3つだけ: 直す必要がありそう(赤)・確認だけ(青緑)・参考(灰)。種類は札の文字で見分ける
  const LV = { need: '直す必要がありそう', look: '確認だけ', ref: '参考' };
  const colorOf = f => { const g = groupOf(f); return g.need ? 'need' : g.minor ? 'ref' : 'look'; };
  const short = s => s.replace(/（.*/, '');
  // 一言の結論と、何をすればよいか
  const JT = { edge: 'ページの端の文字', date: '日付の誤り', paren: 'かっこの閉じ忘れ', dup: '言葉の重なり', misuse: '誤用・誤字', okuri: '送りがなの誤り', particle: '助詞の続き方', phone: '電話番号の桁数', zip: '郵便番号の形', yure: '表記ゆれ', typo: '誤字？', spell: 'つづり？', article: '冠詞（a・an）？', ranuki: 'ら抜き言葉？', saire: 'さ入れ言葉？', tari: '「〜たり」', keigo: '敬語？', redund: '重複表現？', hankana: '半角カナ', tax: '税込・税抜の計算', price: '価格の食い違い？', tmpl: 'ほかのページと違う？', noteref: '注記の番号', listno: '番号の抜け？', style: '文体の混在？', gram: '文法？', colloq: '話し言葉？' };
  // ---- 入れたファイルの組み合わせ(成果物は必ず入れる)ごとのチェックの仕方 ----
  //   new: 成果物だけ → 成果物の文字・表記のチェック
  //   marks: 原稿＋成果物 → 原稿との照合＋成果物のチェック
  //   old: 旧版＋成果物 → 前回の成果物から変わった所(文字データのない所は OCR で読む)＋成果物のチェック
  //   all: 3つすべて → 原稿との照合＋原稿のない部分の前回からの変化＋成果物のチェック
  const MODES = {
    new: { run: '成果物だけチェック', note: '原稿なし：成果物だけでチェックしました' },
    marks: { run: '原稿と照合', note: '' },
    old: { run: '前回と比べる', note: '原稿なし：前回の成果物（旧版）から変わった所と、成果物の文字・表記をチェックしました' },
    all: { run: '原稿と照合・前回と比べる', note: '' },
  };
  const modeOf = () => (S.lists.marks.length ? (S.lists.old.length ? 'all' : 'marks') : S.lists.old.length ? 'old' : 'new');
  function verdictOf(f) {
    if (f.merge) {   // 差し込み印刷(名刺など)の行ごとの照合
      const r = f.merge;
      if (r.kind === 'ok') return ['原稿の表と一致', `原稿の表の${r.rn}行目の${r.fields.join('・')}が、このページにあります（自動で確認済み）`];
      if (r.kind === 'field') return [`${r.field}が違う`, `原稿の表の${r.rn}行目の${r.field}「${r.want}」と違います`];
      if (r.kind === 'missing') return [`${r.field}が見当たらない`, `原稿の表の${r.rn}行目の${r.field}「${r.want}」が、この行のページ（表・裏）に見当たりません`];
      if (r.kind === 'common') return ['共通の値が違う', `原稿の表の${r.cell}の値「${r.want}」（会社名・住所・事業所の電話番号など、どのページにも載る値）と違います`];
      if (r.kind === 'commonMissing') return ['共通の値が見当たらない', `原稿の表の${r.cell}の値「${r.want}」（会社名・住所・事業所の電話番号など）が、同じ作りのほかのページで載っている所に見当たりません`];
    }
    if (f.rec) {   // 表(商品マスタなど)の商品ごとの照合
      const r = f.rec;
      if (r.kind === 'ok') return ['原稿の表と一致', `${r.n}件の商品の${r.fields.join('・')}が一致しています（自動で確認済み）`];
      if (r.kind === 'key') return [`${r.field}が違う？`, `原稿の「${r.want}」がそのままは見当たらず、1字違いの「${r.got}」があります`];
      if (r.kind === 'field') return [`${r.field}が違う`, r.got ? `品番「${r.key}」の${r.field}が原稿の表と違います` : `品番「${r.key}」の近くに、原稿の表の${r.field}「${r.want}」が見当たりません`];
      if (r.kind === 'missing') return ['成果物に見当たらない', `原稿の表の${r.field}${r.n > 1 ? `（${r.n}件）` : ''}が成果物に見当たりません。載せない商品なら OK にしてください`];
    }
    if (f.oldSame) return ['前回のまま', '原稿のない部分ですが、旧版と同じです'];
    if (f.ocr) return [f.fromOld ? (S.runMode === 'old' ? '前回から変わった？（OCR）' : '旧版と違う？（OCR）') : '原稿と違う？（OCR）', '文字データのない所（アウトライン化・画像の文字）をOCRで読んで比べました。読み違いのこともあるので、切り抜きで確かめてください'];
    if (f.fromOld && f.cat === 'V') return ['書き方だけ変わった', `${S.runMode === 'old' ? '前回の成果物' : '旧版'}から、全角・半角などの書き方だけが変わっています。意図した変更か確認`];
    if (f.fromOld && S.runMode === 'old') return ['前回から変わった', f.fromOld === 'del' ? '前回の成果物にあった文字がなくなっています。意図した削除か確認' : (f.segs || []).some(g => g[0] === '-') ? '前回の成果物から変わっています。意図した変更か確認' : '前回の成果物にない文字があります。意図した追加か確認'];
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
    const G = groupsOf(PC.numberSegs(segs)), nx = G.filter(g => g.t === 'x').length;
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
    if (f.s3) {   // 紙の赤字原稿＋旧版: 赤字ごと・赤字のない所の見た目の変化
      if (f.s3.look) return '<div class="what">赤字のない所で、見た目（図版・色・大きさ・位置など）が旧版から変わっています。切り抜きで確認</div>';
      const at = f.show ? `赤字の箇所 ${q(f.show)}` : '赤字';
      if (f.s3.still) return `<div class="what">${at} → 近くは旧版から変わっていません。直す指示なら直っていません（見本・参考として書いた赤字なら問題ありません）${f.s3.far ? '。少し離れた所は変わっているので、赤字の指す先も確認' : ''}</div>`;
      const n = [f.s3.nt ? `文字 ${f.s3.nt}か所` : '', f.s3.nr ? `見た目 ${f.s3.nr}か所` : ''].filter(Boolean).join('・');
      return `<div class="what">${at} → 近くが旧版から変わっています${n ? `（${n}）` : ''}。赤字どおりか、切り抜きで確認</div>`;
    }
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
    if (f.segs && !f.same) return groupsOf(PC.numberSegs(f.segs)).filter(g => g.t === 'x').map(g => `${g.del || '（挿入）'}→${g.ins || '（削除）'}`).join('／');
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
  const S = { res: null, imgs: [], sel: null, page: 0, only: null, zoom: 1, vc: { L: null, R: null }, verdict: {}, key: '', lists: { marks: [], nw: [], old: [] }, loading: new Set() };

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
    try {
      const d = await PC.openPdf(e.buf.slice(0)); e.pages = d.numPages;
      //   処理時間の目安に使う: 1ページ目の大きさ(A4 を 1)。原稿は、照合と同じ見分け方で1ページ目の種類を決める
      //   (注釈と文字データがある → 注釈を入れたPDF、ページを覆う画像がない → スキャンでないPDF、それ以外 → 紙のスキャン)
      try {
        const pg = await d.getPage(1), vp = pg.getViewport({ scale: 1 }); e.area = Math.max(0.2, (vp.width * vp.height) / (595 * 842));
        if (e.list === 'marks') {
          const an = (await PC.annotations(d, 0)).length, tx = an ? (await PC.textChars(d, 0)).length : 0;
          e.mk = an && tx ? 'annot' : (await PC.isDigitalPage(d, 0)) ? 'digital' : 'scan';
        }
      } catch (err) { /* 目安に使うだけなので、読めなくてもよい */ }
      d.destroy();
    }
    catch (err) { e.err = 'PDFとして開けません（' + (err && err.message || err) + '）。パスワード付き・壊れたPDFは使えません。'; }
  }
  function add(kind, files) {
    const L = S.lists[kind], skipped = [];
    const fresh = [...files].filter(f => accepts(kind, f) || (skipped.push(f.name), false)).sort(byName);
    for (const f of fresh) {
      const e = { file: f, name: f.name, size: f.size, type: f.type, mtime: f.lastModified, buf: null, pages: null, err: null, list: kind };
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
  // 処理時間の目安(秒): 検証環境で1件ずつ測った時間(A4 1ページあたり。紙のスキャン 約13秒(旧版もあるとき 約10秒)、
  //   スキャンでないPDF 約8秒、注釈を入れたPDF 約4秒、データ原稿・成果物 約0.5秒、旧版 約1.5秒)に合わせた見積もり。
  //   パソコンの速さで変わるため、処理中は進み具合から見直す(progress)
  const estimateSec = () => {
    const A = e => e.area || 1, old = S.lists.old.length > 0;
    let t = 2;
    for (const e of S.lists.nw) t += 0.5 * (e.pages || 0) * A(e);
    for (const e of S.lists.old) t += 1.5 * (e.pages || 0) * A(e);
    for (const e of S.lists.marks) {
      const n = e.pages || 0, scan = old ? 10 : 13;
      if (PC.dataKind(e)) t += 0.5 * n + 1;
      else if (!PC.isPdf(e)) t += scan * n;   // 画像(紙のスキャン)
      else t += (e.mk === 'annot' ? 4 : e.mk === 'digital' ? 8 : scan) * A(e) * n;
    }
    return t;
  };
  const roughly = sec => (sec < 50 ? '1分以内' : `約${Math.max(1, Math.round(sec / 60))}分`);
  //   入れたファイルの組み合わせ(照合した時と比べて、変わったかを見る)
  const sigOf = () => Object.keys(KIND).map(k => S.lists[k].map(e => `${e.name}:${e.size}:${e.mtime}`).join('|')).join('/');
  // 新しい校正: 入れたファイルと結果を空にして、最初の状態に戻す(詳細設定・確認の記録(このブラウザに残るもの)はそのまま)
  function resetAll() {
    if (S.running) return;
    for (const k of Object.keys(KIND)) S.lists[k] = [];
    S.res = null; S.sel = null; S.doneMsg = ''; S.addMsg = ''; S.runSig = '';
    $('err').textContent = ''; $('pbar').style.width = '0';
    $('results').classList.add('hidden');
    refresh();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function renderFiles(kind) {
    const k = KIND[kind], L = S.lists[kind];
    document.querySelector(`.step[data-kind="${kind}"]`).classList.toggle('has', L.length > 0);
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
    const ready = PC.libsReady && S.lists.nw.length && !bad && !busy;   // 原稿はなくてもよい(成果物だけをチェックする)
    $('run').disabled = !ready || !!S.running;
    //   新しい校正: 入れたファイルか結果があるときだけ出す(照合中は代わりに「中止」)。照合のあとでファイルを変えたら、前回の結果だと分かるように薄くする
    $('reset').hidden = !!S.running || !(all.length || S.res); $('stop').hidden = !S.running;
    $('results').classList.toggle('stale', !!S.res && !S.running && sigOf() !== S.runSig);
    $('run').textContent = MODES[modeOf()].run;   // ボタンの名前は、入れたファイルの組み合わせで変わる
    if (S.running) return;
    let msg = !PC.libsReady ? '準備中…' : S.doneMsg;
    if (!msg) {
      if (bad) msg = '読めないファイルがあります。リストから外すか、選び直してください';
      else if (busy) msg = 'ファイルを読み込んでいます…';
      else if (!ready) msg = '成果物（PDF）を選んでください。原稿・旧版は、あれば入れてください';
      else msg = { new: `成果物 ${total('nw')}ページをチェックします`, marks: `原稿 ${total('marks')}ページと成果物 ${total('nw')}ページを照合します（対応するページは自動で探します）`, old: `成果物 ${total('nw')}ページを、旧版 ${total('old')}ページと比べます（対応するページは自動で探します）`, all: `原稿 ${total('marks')}ページ・成果物 ${total('nw')}ページ・旧版 ${total('old')}ページで照合します（対応するページは自動で探します）` }[modeOf()];
      if (ready) msg += `（目安：${roughly(estimateSec())}）`;
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
  const ETA = { t0: 0, prior: 0, eta: null, at: 0, msg: '', frac: 0, timer: null };
  const etaText = () => { if (ETA.eta == null || ETA.frac >= 1) return ''; const r = ETA.eta - (performance.now() - ETA.at) / 1000; return r < 20 ? '（まもなく終わります）' : `（あと${roughly(r)}）`; };
  const progress = (msg, frac) => {
    if (S.running && ETA.t0 && frac > 0 && frac < 1) {
      const el = (performance.now() - ETA.t0) / 1000;
      if (el > 2 && frac > 0.02) {
        const ext = el * (1 - frac) / frac, pri = Math.max(0, ETA.prior - el), w = Math.min(1, frac / 0.5), est = w * ext + (1 - w) * pri;
        const cur = ETA.eta == null ? null : ETA.eta - (performance.now() - ETA.at) / 1000;
        ETA.eta = cur == null ? est : 0.6 * cur + 0.4 * est; ETA.at = performance.now();
      }
    }
    ETA.msg = msg; ETA.frac = frac;
    $('pmsg').textContent = msg + (S.running ? etaText() : ''); $('pbar').style.width = Math.round(frac * 100) + '%';
  };
  const ABORT = new Error('中止しました');
  async function run(f) {
    S.running = true; S.abort = false; $('run').disabled = true; $('reset').hidden = true; $('stop').hidden = false; $('stop').disabled = false;
    $('err').textContent = ''; progress('ファイルを開いています', 0);
    const runSig = sigOf();   // 照合したファイルの組み合わせ(照合の途中でファイルを変えても、照合したほうを覚える)
    Object.assign(ETA, { t0: performance.now(), prior: estimateSec(), eta: null, at: 0, frac: 0 });
    ETA.eta = ETA.prior; ETA.at = ETA.t0;
    clearInterval(ETA.timer); ETA.timer = setInterval(() => { if (S.running) $('pmsg').textContent = ETA.msg + etaText(); }, 1000);
    const mode = f.marks && f.marks.length ? (f.old && f.old.length ? 'all' : 'marks') : f.old && f.old.length ? 'old' : 'new';
    const t0 = performance.now();
    try {
      const marks = await PC.markSource(f.marks), newDoc = await PC.openPdfs(f.nw), oldDoc = f.old && f.old.length ? await PC.openPdfs(f.old) : null;
      const res = await PC.analyze({ marks, newDoc, oldDoc, progress: (m, x) => { if (S.abort) throw ABORT; progress(m, x); } });
      res.seconds = (performance.now() - t0) / 1000; res.markParts = marks.parts; res.newParts = newDoc.parts; res.oldParts = oldDoc ? oldDoc.parts : null; res.mode = mode;
      S.key = 'pc:' + [...f.marks, ...f.nw, ...(f.old || [])].map(x => x.name + ':' + x.size).join('|');
      try { S.verdict = JSON.parse(localStorage.getItem(S.key) || '{}'); } catch (e) { S.verdict = {}; }
      await show(res);
      S.doneMsg = `完了（${res.seconds.toFixed(1)}秒）`; progress(S.doneMsg, 1); S.runSig = runSig;
      return res;
    } catch (e) {
      if (e === ABORT) { S.doneMsg = '中止しました（入れたファイルはそのままです。もう一度押すと、最初から照合します）'; $('pbar').style.width = '0'; return null; }
      console.error(e); $('err').textContent = '処理できませんでした：' + (e && e.message ? e.message : e); progress('エラー', 0);
      throw e;
    } finally { S.running = false; S.abort = false; clearInterval(ETA.timer); ETA.t0 = 0; refresh(); }
  }
  $('stop').onclick = () => { if (!S.running) return; S.abort = true; $('stop').disabled = true; ETA.eta = null; ETA.msg = '中止しています…'; $('pmsg').textContent = ETA.msg; };
  $('run').onclick = () => run(files()).catch(() => {});
  $('reset').onclick = resetAll; $('reset2').onclick = resetAll;

  // ---- 結果の表示 ----
  async function show(res) {
    S.res = res; S.sel = null; S.page = 0; S.runMode = res.mode || 'marks';
    S.only = null; S.zoom = 1; S.vc = { L: null, R: null }; S.warned = false;   // 新しい結果は、絞り込み・拡大なしで出す
    S.imgs = res.pages.map(p => ({ L: null, R: null, Lurl: p.left ? p.left.url : null, Rurl: p.right ? p.right.url : null, lw: p.left ? p.left.w : 0, lh: p.left ? p.left.h : 0, rw: p.right ? p.right.w : 0, rh: p.right ? p.right.h : 0, region: p.region }));
    S.cache = new Map();
    if (S.imgs.length) await ensure(0);   // 成果物だけのチェックで項目がないときは、表示するページがない
    $('results').classList.remove('hidden');
    $('tabs').innerHTML = res.pages.map((_, i) => `<button class="btn small ${i === 0 ? 'on' : ''}" data-p="${i}" title="${esc(pageLabel(i + 1))}">${i + 1}</button>`).join('') + '<span class="hint">ページ</span>';
    $('tabs').querySelectorAll('button').forEach(b => b.onclick = () => { S.page = +b.dataset.p; S.vc = { L: null, R: null }; drawPage(); });
    renderAll();
  }
  const renderAll = () => { renderSummary(); renderList(); drawPage(); };
  // 結果の概要(詳細設定で外した項目は数えない)
  function renderSummary() {
    const res = S.res, F = res.findings.filter(enabled), ruleNote = res.rules.length ? '／全体の直し：' + res.rules.map(r => `「${r.frm}」→「${r.to}」`).join('、') : '';
    const nOff = res.findings.length - F.length;
    //   ページ数: 結果のページ(原稿のページごと)。成果物だけのチェックで項目がないときは、チェックした成果物のページ数
    const nNew = (res.newParts || []).reduce((n, x) => n + x.pages, 0);
    $('sumNote').textContent = `${res.pages.length ? res.pages.length + 'ページ' : `成果物 ${nNew}ページ`}・${res.seconds.toFixed(1)}秒`;
    const notes = [ruleNote.replace(/^／/, ''), ...res.warn, optOff.size ? `詳細設定で外した項目に当たる${nOff}件は出していません` : ''].filter(Boolean);
    $('notes').innerHTML = notes.map(t => `<li>${esc(t)}</li>`).join('');
    $('mapNote').textContent = res.markParts && res.markParts.length ? 'ページの対応：' + mapSummary() : MODES[S.runMode].note || MODES.new.note;
    //   2つのまとまり(直す必要がありそう・確認だけ)と、件数のある種類の札。見出しや札を押すと、それだけを一覧とページに出す(もう一度押すと全部に戻る)
    const need = GROUPS.filter(g => g.need), look = GROUPS.filter(g => !g.need && !g.minor), nOf = g => F.filter(f => groupOf(f) === g).length;
    const nNeed = F.filter(f => groupOf(f).need).length, nLook = F.filter(f => look.includes(groupOf(f))).length, nAuto = F.filter(f => groupOf(f).auto).length;
    const chips = gs => gs.filter(nOf).map(g => { const light = F.filter(f => groupOf(f) === g && isLight(f)).length; return `<button class="fchip ${S.only === g.key ? 'on' : ''}" data-f="${g.key}" title="${esc(g.label)}">${esc(short(g.label))}<b>${nOf(g)}</b>${light ? `<small>うち念のため${light}</small>` : ''}</button>`; }).join('');
    const head = (k, n) => `<button class="sumhd ${S.only === k ? 'on' : ''}" data-f="${k}" ${n ? '' : 'disabled'}>${LV[k]}<b>${n}件</b></button>`;
    $('summary').classList.toggle('filtering', !!S.only);
    $('summary').innerHTML = (nNeed ? `<div class="sumgrp need" style="--c: var(--c-need)">${head('need', nNeed)}<div class="fchips">${chips(need)}</div></div>`
      : '<div class="sumgrp clear"><div class="sumhd" style="cursor:default">直す必要がありそう<b>0件</b></div><div class="clearmsg"><i>✓</i>直す必要がありそうな所は見つかりませんでした</div></div>') +
      `<div class="sumgrp look" style="--c: var(--c-look)">${head('look', nLook)}<div class="fchips">${nLook ? chips(look) : '<span class="hint">ありません</span>'}</div>` +
      (nAuto ? `<div class="hint sumtip">ほかに、指示どおりと自動で確認できたもの ${nAuto}件（一覧には出していません。「参考も表示」で見られます）</div>` : '') + '</div>' +
      (nNeed + nLook ? '<div class="hint sumtip all">見出しや種類を押すと、それだけを表示します（もう一度押すと全部に戻ります）</div>' : '');
    $('summary').querySelectorAll('[data-f]').forEach(el => el.onclick = () => setOnly(S.only === el.dataset.f ? null : el.dataset.f));
  }
  //   絞り込み: need・look(まとまり)か、種類の key。null は全部
  function setOnly(k) { S.only = k; renderSummary(); renderList(); drawPage(); }
  const onlyLabel = k => LV[k] || short((GROUPS.find(g => g.key === k) || { label: '' }).label);

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
    if (!enabled(f)) return false;
    const g = groupOf(f);
    if (g.minor && !$('showMinor').checked) return false;
    if (S.only && !(S.only === 'need' ? g.need : S.only === 'look' ? !g.need && !g.minor : g.key === S.only)) return false;
    if ($('hideDone').checked && (S.verdict[f.id] || {}).v === 'ok') return false;
    return true;
  };
  const order = f => { const gi = GROUPS.indexOf(groupOf(f)); return [gi, f.check.includes('見当たらない') || f.cat === 'B' ? 0 : 1, (f.how || '').includes('引き出し線の可能性') ? 1 : 0, f.page, f.box[1], f.box[0]]; };
  const cmp = (a, b) => { const x = order(a), y = order(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
  let observer = null;
  function renderList() {
    const F = S.res.findings.filter(visible).sort(cmp), list = $('list');
    if (observer) observer.disconnect();
    //   絞り込み中は、そのことを一覧の上に示す(見落とさないように)。ページの枠の色の説明は、出ている色だけ
    $('fnote').hidden = !S.only;
    if (S.only) { $('fnote').innerHTML = `「${esc(onlyLabel(S.only))}」だけを表示しています <button class="btn small" id="fAll">全部を表示</button>`; $('fAll').onclick = () => setOnly(null); }
    $('legend').innerHTML = Object.keys(LV).filter(l => F.some(f => f.cat !== 'F2' && colorOf(f) === l)).map(l => `<span style="--c: var(--c-${l})"><i></i>${LV[l]}</span>`).join('');
    renderProgress();
    if (!F.length) { list.innerHTML = '<div class="empty">表示する項目はありません</div>'; return; }
    list.innerHTML = F.map(f => {
      const v = S.verdict[f.id] || {}, [title, todo] = verdictOf(f);
      return `<div class="item ${S.sel === f.id ? 'sel' : ''} ${isLight(f) ? 'light' : ''}" data-id="${f.id}" style="--c: var(--c-${colorOf(f)})">
        <div class="hd"><span class="tag">${esc(title)}</span><span class="todo">${esc(todo)}</span><span class="pg">${esc(pageLabel(f.page))}${f.ref ? ' ' + esc(f.goneN && f.refs.length > 1 ? `${f.refs[0]}〜${f.refs[f.refs.length - 1]}` : f.refs ? f.refs.slice(0, 3).join('・') + (f.refs.length > 3 ? ' ほか' : '') : f.ref) : ''}</span></div>
        ${whatHtml(f)}${f.more ? `<div class="meta">同じ違いが全部で ${f.more} か所あります（ページの表示で枠を確認）</div>` : ''}${f.vsOld && !f.fromOld ? `<div class="meta">旧版：${f.vsOld === 'same' ? (f.cat === 'T' ? '同じ（前回のまま。直っていない可能性）' : '同じ') : (f.cat === 'T' ? '旧版からも変わっています' : '旧版から変わっています（原稿にない変更）')}</div>` : ''}${f.goneN ? `<div class="meta">成果物に見当たらない${f.refs && f.refs.length ? '行' : 'まとまり'}が ${f.goneN} 続いています${f.refs && f.refs.length ? `（${esc(f.refs[0])}〜${esc(f.refs[f.refs.length - 1])}）` : ''}。原稿のうち載せない部分なら OK にしてください</div>` : ''}${markOf(f)}
        <div class="crops">${f.old ? '<figure><canvas data-side="O" width="300" height="130"></canvas><figcaption>旧版</figcaption></figure>' : ''}${f.newOnly ? '' : '<figure><canvas data-side="L" width="300" height="130"></canvas><figcaption>原稿</figcaption></figure>'}<figure><canvas data-side="R" width="300" height="130"></canvas><figcaption>成果物${f.approx ? '（およその位置）' : ''}</figcaption></figure>${f.noteBox ? '<figure class="note"><canvas data-side="N" width="300" height="80"></canvas><figcaption>赤字の書き込み</figcaption></figure>' : ''}</div>
        <div class="judge"><button class="btn small ${v.v === 'ok' ? 'on' : ''}" data-v="ok">OK</button><button class="btn small ${v.v === 'fix' ? 'on' : ''}" data-v="fix">要修正</button><button class="btn small ${v.v === 'hold' ? 'on' : ''}" data-v="hold">保留</button><input placeholder="メモ" value="${esc(v.memo || '')}"><span class="kh">キー：1 OK・2 要修正・3 保留／↑↓ 前後の項目</span></div>
      </div>`;
    }).join('');
    // 切り抜きは画面に入ったものから描く
    observer = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { drawCrops(e.target); observer.unobserve(e.target); } }), { rootMargin: '400px' });
    list.querySelectorAll('.item').forEach(el => {
      observer.observe(el);
      const id = +el.dataset.id;
      el.onclick = ev => { if (ev.target.closest('.judge')) return; select(id, false); };
      el.querySelectorAll('.judge button').forEach(b => b.onclick = () => judge(id, b.dataset.v));
      el.querySelector('.judge input').oninput = e => { const v = S.verdict[id] || {}; v.memo = e.target.value; S.verdict[id] = v; save(); };
    });
  }
  // 判定を付ける(同じものをもう一度押すと外す)。付けた判定を返す
  function judge(id, val) {
    const v = S.verdict[id] || {}; v.v = v.v === val ? '' : val; S.verdict[id] = v; save();
    const el = document.querySelector(`.item[data-id="${id}"]`);
    if (el) el.querySelectorAll('.judge button').forEach(x => x.classList.toggle('on', x.dataset.v === v.v));
    // 「確認済み（OK）を隠す」がオンなら、OKにした項目をすぐ一覧から外す(ほかの項目の位置はそのまま)
    if (el && v.v === 'ok' && $('hideDone').checked) { if (observer) observer.unobserve(el); el.remove(); if (S.sel === id) S.sel = null; if (!$('list').querySelector('.item')) $('list').innerHTML = '<div class="empty">表示する項目はありません</div>'; drawPage(); }
    renderProgress();
    return v.v;
  }
  // 確認の進み具合: 一覧に出す項目(参考を除く)のうち、OK・要修正・保留を付けたもの
  function renderProgress() {
    if (!S.res) return;
    const T = S.res.findings.filter(f => enabled(f) && !groupOf(f).minor), V = T.map(f => (S.verdict[f.id] || {}).v || ''), n = T.length, done = V.filter(Boolean).length;
    const fix = V.filter(v => v === 'fix').length, hold = V.filter(v => v === 'hold').length;
    $('jprog').innerHTML = n ? `確認 ${done} / ${n}件<span class="bar"><i style="width:${Math.round(100 * done / n)}%"></i></span>${fix || hold ? `<span class="sub">要修正 ${fix}・保留 ${hold}</span>` : ''}` : '';
    $('nextU').hidden = !n;
  }
  // 一覧の中を移る: 前・次の項目、まだ判定を付けていない次の項目
  const shown = () => [...$('list').querySelectorAll('.item')];
  function stepItem(d) {
    const L = shown(); if (!L.length) return;
    const i = L.findIndex(el => +el.dataset.id === S.sel), j = i < 0 ? (d > 0 ? 0 : L.length - 1) : Math.min(L.length - 1, Math.max(0, i + d));
    select(+L[j].dataset.id, true);
  }
  function nextUnchecked() {
    const L = shown(); if (!L.length) return;
    const i = L.findIndex(el => +el.dataset.id === S.sel);
    for (let k = 1; k <= L.length; k++) { const id = +L[(i + k + L.length) % L.length].dataset.id; if (!(S.verdict[id] || {}).v) { select(id, true); return; } }
    $('jprog').insertAdjacentHTML('beforeend', '<span class="sub">（表示中の項目は、すべて確認しました）</span>');
  }
  $('nextU').onclick = nextUnchecked;
  //   キー操作(一覧の項目を選んでいるとき): ↑↓ 前・次の項目、1 OK・2 要修正・3 保留(付けたら次の項目へ)。文字を入れる欄では使わない
  document.addEventListener('keydown', ev => {
    if (!S.res || S.sel == null || $('results').classList.contains('hidden') || ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing) return;
    if (ev.target && ev.target.closest && ev.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); stepItem(ev.key === 'ArrowDown' ? 1 : -1); return; }
    const val = { 1: 'ok', 2: 'fix', 3: 'hold' }[ev.key];
    if (!val) return;
    ev.preventDefault();
    const cur = S.sel, L = shown(), i = L.findIndex(el => +el.dataset.id === cur), next = i >= 0 && L[i + 1] ? +L[i + 1].dataset.id : null;
    if (judge(cur, val) && next != null) select(next, true);
  });
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

  function select(id, fromViewer, keepView) {
    S.sel = id; const f = S.res.findings[id];
    document.querySelectorAll('.item').forEach(el => el.classList.toggle('sel', +el.dataset.id === id));
    if (fromViewer) { const el = document.querySelector(`.item[data-id="${id}"]`); if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    if (S.page !== f.page - 1) S.vc = { L: null, R: null };
    S.page = f.page - 1;
    if (S.zoom > 1 && !keepView) centerOn(f);
    drawPage(true);
  }
  //   拡大したときの中心(ページの画素): 項目の枠の真ん中。片側に枠がなければ、もう片側と同じ所
  const mid = bs => { const b = PC.union(bs); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; };
  function centerOn(f) { const L = marks(f, 'L'), R = marks(f, 'R'), cl = L.length ? mid(L) : null, cr = R.length ? mid(R) : null; S.vc = { L: cl || cr, R: cr || cl }; }

  // ページ表示: 左に原稿、右に成果物(それぞれ半分の幅に合わせる)。判定の枠を重ね、内容で照合したページは対応する範囲を点線で示す
  //   拡大(＋・－、Ctrl＋ホイール): 原稿と成果物の同じ所を並べて大きく出す。ドラッグ・ホイールで動かすと両方が一緒に動き、項目を選ぶとその所へ寄る
  const ZL = [1, 1.5, 2, 3, 4, 6];
  let geo = null;
  const viewMaxH = () => { const v = parseFloat(getComputedStyle($('vscroll')).maxHeight); return isFinite(v) && v > 100 ? v : Math.max(300, window.innerHeight - 130); };
  function drawPage(scrollToSel) {
    if (!S.res) return;
    if (!S.imgs.length) { $('pinfo').textContent = '表示するページはありません'; const c = $('vcanvas'); c.width = c.height = 0; c.style.height = '0px'; geo = null; return; }
    if (!ready(S.page)) { ensure(S.page).then(() => drawPage(scrollToSel)); return; }
    $('tabs').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.p === S.page));
    $('pinfo').textContent = pageLabel(S.page + 1);
    //   原稿の画像がないページ(成果物だけ・旧版との比べ合わせ)は、成果物を幅いっぱいに出す
    const im = S.imgs[S.page], one = !im.L && !!im.R, gap = 16, cw = $('vscroll').clientWidth - 2, dpr = window.devicePixelRatio || 1, half = one ? cw : (cw - gap) / 2;
    $('vcap').classList.toggle('one', one); $('vcap').innerHTML = one ? '<div>成果物</div>' : '<div>原稿</div><div>成果物</div>';
    const sR0 = im.R ? half / im.rw : 1, sL0 = im.L ? half / im.lw : sR0, ox = one ? 0 : half + gap, Z = S.zoom;
    const fitH = Math.max(im.L ? im.lh * sL0 : 60, im.R ? im.rh * sR0 : 0), H = Z > 1 ? Math.min(viewMaxH(), fitH * Z) : fitH;
    //   片側の見える範囲: ページの画素で (x0, y0) から、倍率 s。拡大していないときはページ全体
    const view = (k, w, h, s0, x) => {
      const s = s0 * Z, vw = half / s, vh = H / s; let x0 = 0, y0 = 0;
      if (Z > 1) {
        const c = S.vc[k] || [w / 2, vh / 2];
        x0 = w <= vw ? (w - vw) / 2 : Math.min(Math.max(0, c[0] - vw / 2), w - vw);
        y0 = h <= vh ? (h - vh) / 2 : Math.min(Math.max(0, c[1] - vh / 2), h - vh);
        S.vc[k] = [x0 + vw / 2, y0 + vh / 2];   // 端で止まった所を中心として覚える(ドラッグで戻すときに遅れないように)
      }
      return { k, s, x0, y0, ox: x, w: half };
    };
    const VL = im.L ? view('L', im.lw, im.lh, sL0, 0) : null, VR = im.R ? view('R', im.rw, im.rh, sR0, ox) : null;
    const c = $('vcanvas'), ctx = c.getContext('2d');
    c.classList.toggle('zoomed', Z > 1);
    c.style.width = cw + 'px'; c.style.height = Math.round(H) + 'px'; c.width = Math.round(cw * dpr); c.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#eef1f6'; ctx.fillRect(0, 0, cw, H);
    const clip = (V, fn) => { ctx.save(); ctx.beginPath(); ctx.rect(V.ox, 0, V.w, H); ctx.clip(); fn(); ctx.restore(); };
    const rectOf = (V, b) => [V.ox + (b[0] - V.x0) * V.s - 3, (b[1] - V.y0) * V.s - 3, (b[2] - b[0]) * V.s + 6, (b[3] - b[1]) * V.s + 6];
    const label = (t, x) => { ctx.fillStyle = '#5b6475'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(t, x, 40); ctx.textAlign = 'start'; };
    if (VL) clip(VL, () => ctx.drawImage(im.L, VL.ox - VL.x0 * VL.s, -VL.y0 * VL.s, im.lw * VL.s, im.lh * VL.s));
    else if (!one) label('原稿なし（成果物だけを確認）', half / 2);
    if (VR) clip(VR, () => ctx.drawImage(im.R, VR.ox - VR.x0 * VR.s, -VR.y0 * VR.s, im.rw * VR.s, im.rh * VR.s));
    else label('対応する成果物のページなし', ox + half / 2);
    const css = getComputedStyle(document.documentElement), boxes = [];
    if (im.region && VR) clip(VR, () => { ctx.setLineDash([6, 4]); ctx.strokeStyle = css.getPropertyValue('--accent'); ctx.lineWidth = 1.5; const r = rectOf(VR, im.region); ctx.strokeRect(r[0] + 3, r[1] + 3, r[2] - 6, r[3] - 6); ctx.setLineDash([]); });
    //   枠を描き、押せる範囲(見えている部分だけ)を覚える
    const put = (V, id, b) => { const r = rectOf(V, b); ctx.strokeRect(...r); const x0 = Math.max(r[0], V.ox), x1 = Math.min(r[0] + r[2], V.ox + V.w), y0 = Math.max(r[1], 0), y1 = Math.min(r[1] + r[3], H); if (x1 > x0 && y1 > y0) boxes.push([id, x0, y0, x1, y1]); };
    for (const f of S.res.findings) {
      if (f.page !== S.page + 1 || !visible(f) || f.cat === 'F2') continue;
      const sel = f.id === S.sel; ctx.strokeStyle = css.getPropertyValue('--c-' + colorOf(f)); ctx.lineWidth = sel ? 3 : 1.5;
      if (VL) clip(VL, () => { for (const b of [...marks(f, 'L'), ...(f.moreBoxes || [])]) put(VL, f.id, b); });
      if (VR) clip(VR, () => { for (const n of [...marks(f, 'R'), ...(f.moreNboxes || [])]) put(VR, f.id, n); });
    }
    geo = { boxes, VL, VR, H };
    if (Z > 1) $('vscroll').scrollTop = 0;
    else if (scrollToSel && S.sel !== null) { const f = S.res.findings[S.sel]; $('vscroll').scrollTo({ top: Math.max(0, f.box[1] * sL0 - 150), behavior: 'smooth' }); }
    $('zLbl').textContent = Z > 1 ? Math.round(Z * 100) + '%' : '全体'; $('zOut').disabled = Z <= 1; $('zIn').disabled = Z >= ZL[ZL.length - 1];
  }
  //   拡大・縮小。at: Ctrl＋ホイールのときのポインタの位置(その下の所を動かさない)
  function setZoom(z, at) {
    if (!S.res || !S.imgs.length || !geo) return;
    z = Math.min(ZL[ZL.length - 1], Math.max(1, z));
    if (z === S.zoom) return;
    if (S.zoom === 1) {   // 拡大を始めるとき: 選んだ項目がこのページにあればそこ、なければ今見えている所を中心にする
      const f = S.sel != null ? S.res.findings[S.sel] : null;
      if (f && f.page === S.page + 1 && !at) centerOn(f);
      else { const st = $('vscroll').scrollTop, vh = Math.min($('vscroll').clientHeight || geo.H, geo.H); for (const V of [geo.VL, geo.VR]) if (V) S.vc[V.k] = [V.x0 + V.w / V.s / 2, (st + vh / 2) / V.s]; }
    }
    if (at) for (const V of [geo.VL, geo.VR]) {
      if (!V || !S.vc[V.k]) continue;
      const px = V.x0 + (at.x - at.ox) / V.s, py = V.y0 + at.y / V.s, c = S.vc[V.k];
      S.vc[V.k] = [px + (c[0] - px) * S.zoom / z, py + (c[1] - py) * S.zoom / z];
    }
    S.zoom = z; drawPage();
  }
  const zstep = d => { const i = ZL.indexOf(S.zoom); return ZL[Math.min(ZL.length - 1, Math.max(0, (i < 0 ? 0 : i) + d))]; };
  $('zIn').onclick = () => setZoom(zstep(1));
  $('zOut').onclick = () => setZoom(zstep(-1));
  const cv = $('vcanvas'); let pan = null;
  cv.addEventListener('click', ev => {
    if (!geo) return;
    if (S.dragged) { S.dragged = false; return; }   // 動かしたあとは、枠を押したことにしない
    const r = ev.target.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    const hit = geo.boxes.filter(b => x >= b[1] && x <= b[3] && y >= b[2] && y <= b[4]).sort((p, q) => (p[3] - p[1]) * (p[4] - p[2]) - (q[3] - q[1]) * (q[4] - q[2]))[0];
    if (hit) select(hit[0], true, true);
  });
  //   拡大中のドラッグ: 原稿と成果物を一緒に動かす
  cv.addEventListener('pointerdown', ev => {
    if (S.zoom <= 1 || !geo || ev.button !== 0) return;
    pan = { x: ev.clientX, y: ev.clientY, vc: { L: S.vc.L && [...S.vc.L], R: S.vc.R && [...S.vc.R] }, moved: false };
    cv.setPointerCapture(ev.pointerId);
  });
  cv.addEventListener('pointermove', ev => {
    if (!pan) return;
    const dx = ev.clientX - pan.x, dy = ev.clientY - pan.y;
    if (!pan.moved && Math.hypot(dx, dy) < 4) return;
    pan.moved = true; cv.classList.add('panning');
    for (const V of [geo.VL, geo.VR]) if (V && pan.vc[V.k]) S.vc[V.k] = [pan.vc[V.k][0] - dx / V.s, pan.vc[V.k][1] - dy / V.s];
    if (!S.raf) S.raf = requestAnimationFrame(() => { S.raf = 0; drawPage(); });
  });
  const endPan = () => { if (!pan) return; S.dragged = pan.moved; cv.classList.remove('panning'); pan = null; };
  cv.addEventListener('pointerup', endPan); cv.addEventListener('pointercancel', endPan);
  //   ホイール: Ctrl を押しながらで拡大・縮小、拡大中は動かす(拡大していないときは、ふつうにスクロール)
  cv.addEventListener('wheel', ev => {
    if (!geo || !S.imgs.length) return;
    const k = ev.deltaMode === 1 ? 16 : 1;
    if (ev.ctrlKey) {
      ev.preventDefault();
      const now = performance.now(); if (now - (S.zt || 0) < 180) return; S.zt = now;   // タッチパッドで一度に何段も変わらないように
      const r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
      const V = [geo.VL, geo.VR].find(V => V && x >= V.ox && x <= V.ox + V.w) || geo.VR || geo.VL;
      setZoom(zstep(ev.deltaY < 0 ? 1 : -1), { x, y, ox: V.ox });
      return;
    }
    if (S.zoom <= 1) return;
    ev.preventDefault();
    const dx = (ev.shiftKey ? ev.deltaY : ev.deltaX) * k, dy = (ev.shiftKey ? 0 : ev.deltaY) * k;
    for (const V of [geo.VL, geo.VR]) if (V && S.vc[V.k]) S.vc[V.k] = [S.vc[V.k][0] + dx / V.s, S.vc[V.k][1] + dy / V.s];
    drawPage();
  }, { passive: false });
  window.addEventListener('resize', () => drawPage());
  $('hideDone').onchange = () => { renderList(); drawPage(); };
  $('showMinor').onchange = () => { renderList(); drawPage(); };

  // ---- 出力 ----
  const okToExport = what => {
    if (S.warned) return true;
    const n = S.res.findings.filter(f => enabled(f) && !groupOf(f).minor && !(S.verdict[f.id] || {}).v).length;
    if (!n) return true;
    const ok = confirm(`まだ OK・要修正・保留を付けていない項目が ${n}件あります。\nこのまま${what}しますか？`);
    if (ok) S.warned = true;
    return ok;
  };
  $('csv').onclick = () => {
    if (!okToExport('CSVで保存')) return;
    const V = { ok: 'OK', fix: '要修正', hold: '保留' }, q = s => '"' + String(s ?? '').replace(/"/g, '""') + '"';
    const rows = [['No.', 'ページ', '原稿のファイル', '原稿のページ', '成果物のファイル', '成果物のページ', '区分', '結論', 'すること', '違い（原稿→成果物）', '指示', '自動確認', '確認', 'メモ', '補足', '位置（原稿・200dpi）']];
    S.res.findings.filter(f => f.cat !== 'F2' && enabled(f)).sort(cmp).forEach((f, i) => {
      const v = S.verdict[f.id] || {}, pg = S.res.pages[f.page - 1], nq = pg.q, o = (srcOf(f.page) != null && PC.pageOf(S.res.markParts, srcOf(f.page))) || {}, n = (nq >= 0 && PC.pageOf(S.res.newParts, nq)) || {}, [title, todo] = verdictOf(f);
      rows.push([i + 1, f.page, o.name, [(pg.label && pg.label.replace(o.name, '').trim()) || o.page, f.refs ? f.refs.join('・') : f.ref].filter(Boolean).join(' '), n.name, n.page, groupOf(f).need ? '直す必要がありそう' : groupOf(f).auto ? '自動で確認済み' : groupOf(f).minor ? '参考' : '確認だけ', title, todo, diffText(f) + (f.more ? `（同じ違い 全${f.more}か所）` : '') + (f.goneN ? `（ほか${f.goneN - 1}つ続けて成果物にない）` : ''), f.note, f.check, V[v.v] || '', v.memo || '', [f.how, f.oldSame || f.vsOld === 'same' ? '旧版と同じ' : f.vsOld === 'changed' && !f.fromOld ? '旧版から変わった' : ''].filter(Boolean).join('／'), f.box.join(' ')]);
    });
    const blob = new Blob(['﻿' + rows.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '校正結果.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('print').onclick = async () => { if (!okToExport('印刷')) return; if (S.only) setOnly(null); for (let i = 0; i < S.imgs.length; i++) await ensure(i); document.querySelectorAll('.item').forEach(drawCrops); window.print(); };

  // ---- 詳細設定の画面 ----
  function renderOpts() {
    $('optList').innerHTML = OPTS.map(([sec, xs]) => `<div class="sec"><b>${esc(sec)}</b><div class="grid">${xs.map(([k, label]) => `<label><input type="checkbox" data-k="${k}" ${optOff.has(k) ? '' : 'checked'}>${esc(label)}</label>`).join('')}</div></div>`).join('');
    $('optList').querySelectorAll('input').forEach(el => el.onchange = () => { el.checked ? optOff.delete(el.dataset.k) : optOff.add(el.dataset.k); optChanged(); });
    $('optNote').textContent = optOff.size ? `${optOff.size}項目を外しています` : '';
  }
  function optChanged() {
    try { localStorage.setItem(OPT_KEY, JSON.stringify([...optOff])); } catch (e) { /* 保存できない環境でも、この画面の間は使える */ }
    renderOpts();
    if (S.res) renderAll();
  }
  $('optAll').onclick = () => { optOff.clear(); optChanged(); };
  $('optNone').onclick = () => { OPT_ALL.forEach(o => optOff.add(o[0])); optChanged(); };
  renderOpts();

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
