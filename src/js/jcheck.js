// 成果物だけを読んで、日本語として問題がありそうな所を挙げる(原稿とは照らし合わせない。決まったルールだけで判定する)
//   日付と曜日の食い違い・かっこの閉じ忘れ・同じ字の重なり・よくある誤用・電話番号と郵便番号の形(直す必要がありそう)
//   表記ゆれ・ら抜き言葉・二重敬語・重複表現・半角カナ(確認だけ)
'use strict';
(function () {
  const WD = ['日', '月', '火', '水', '木', '金', '土'];

  // ページの文字を、まとまり(段落・行のつながり)ごとの文字列にする。at: 文字列の位置 → 文字の番号、ls: 行の始めの位置
  //   (飾りのために重ねて描いた文字は、文字データを読むとき(PC.pageText)に除いてある)
  function textOf(B) {
    let s = ''; const at = [], ls = new Set();
    for (const [a, e] of PC.blocksOf(B.chars, B.items)) {
      let n0 = s.length;
      for (let i = a; i < e; i++) {
        const c = B.chars[i].c, p = B.chars[i - 1];
        if (s.length === n0 || (p.it !== B.chars[i].it && B.chars[i].box[1] > p.box[3] - 0.3 * (p.box[3] - p.box[1]))) ls.add(s.length);
        for (let k = 0; k < c.length; k++) { s += c[k]; at.push(i); }
      }
      if (s.length === n0) continue;
      s += '\u0000'; at.push(-1);
    }
    return { s, at, ls };
  }
  const boxOf = (B, at, i, n) => PC.union(at.slice(i, i + n).filter(j => j >= 0).map(j => B.chars[j].box));
  const ctxOf = (s, i, n) => [s.slice(Math.max(0, i - 8), i).replace(/^.*\u0000/, ''), s.slice(i + n, i + n + 8).replace(/\u0000.*$/, '')];
  // 1字ずつ NFKC にする(全角の数字・かっこを半角にそろえる。字の数が変わる字はそのまま: 文字列の位置がずれないように)
  const nfkc = s => [...s].map(c => { const k = c.normalize('NFKC'); return k.length === 1 && c.length === 1 ? k : c; }).join('');

  // ---- 日付と曜日 ----
  //   年がない日付は、成果物にいちばん多く出てくる年(なければ今年と来年のどちらでも合わないとき)で調べる。「〜22日（月）」のように月がない日付は前の日付の月
  function dates(pages) {
    const years = new Map();
    for (const { s } of pages) for (const m of nfkc(s).matchAll(/(\d{4})年|令和(\d{1,2}|元)年/g)) { const y = m[1] ? +m[1] : 2018 + (m[2] === '元' ? 1 : +m[2]); if (y > 1900 && y < 2200) years.set(y, (years.get(y) || 0) + 1); }
    const yDoc = [...years].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    const now = new Date().getFullYear(), yGuess = yDoc ? [yDoc[0]] : [now, now + 1];
    const out = [];
    for (const pg of pages) {
      const t = nfkc(pg.s);
      let lastY = null, lastM = null;
      const W = '[(]([日月火水木金土])(?:曜日?)?(?:[・･/][祝休]日?)?[)]';
      const re = new RegExp(`(?:(\\d{4})年|令和(\\d{1,2}|元)年)?\\s*(?:(\\d{1,2})月)?(\\d{1,2})日\\s*${W}|(?:(\\d{4})[./])?(\\d{1,2})[./](\\d{1,2})\\s*${W}`, 'g');
      for (const m of t.matchAll(re)) {
        let y, mo, d, w;
        if (m[4]) { y = m[1] ? +m[1] : m[2] ? 2018 + (m[2] === '元' ? 1 : +m[2]) : null; mo = m[3] ? +m[3] : lastM; d = +m[4]; w = m[5]; }
        else { y = m[6] ? +m[6] : null; mo = +m[7]; d = +m[8]; w = m[9]; }
        if (!mo || mo > 12 || d < 1 || d > 31) continue;
        if (y) lastY = y;
        lastM = mo;
        const ys = y ? [y] : lastY ? [lastY] : yGuess;
        const ok = ys.some(yy => { const dt = new Date(Date.UTC(yy, mo - 1, d)); return dt.getUTCMonth() === mo - 1 && WD[dt.getUTCDay()] === w; });
        if (ok) continue;
        const yy = ys[0], dt = new Date(Date.UTC(yy, mo - 1, d));
        if (dt.getUTCMonth() !== mo - 1) { out.push({ pg, i: m.index, n: m[0].length, kind: 'date', level: 'need', want: '', msg: `${mo}月${d}日という日付はありません` }); continue; }
        const real = WD[dt.getUTCDay()], wi = m.index + m[0].lastIndexOf(w);
        out.push({ pg, i: wi, n: 1, kind: 'date', level: 'need', want: real, msg: `${y || lastY ? '' : '（年の書いていない日付は' + yy + '年として計算）'}${yy}年${mo}月${d}日は${real}曜日です` });
      }
    }
    return out;
  }

  // ---- かっこの対応 ----
  //   全角と半角のかっこは組にしてよい(書き方の混在は別に見る)。「1）」「a)」のような番号の閉じかっこは数えない
  const OPEN = '（(「『【〔［[｛{〈《', CLOSE = '）)」』】〕］]｝}〉》';
  const KIND = c => { const k = OPEN.indexOf(c) >= 0 ? OPEN.indexOf(c) : CLOSE.indexOf(c); return k <= 1 ? 0 : k === 7 || k === 6 ? 6 : k === 9 || k === 8 ? 8 : k; };
  const NUM = /[\dA-Za-z０-９Ａ-Ｚａ-ｚ①-⑳]/;
  //   まとまりは「見出し　中身」の空白でも分かれるため、閉じていないかっこは次のまとまりまで続けて探す
  function parens(pg) {
    const out = [], s = pg.s, miss = x => out.push({ pg, i: x, n: 1, kind: 'paren', level: 'need', want: '', msg: `「${s[x]}」に対応する閉じかっこがありません` });
    let b0 = 0, carry = [];
    for (let e = s.indexOf('\u0000'); e >= 0; b0 = e + 1, e = s.indexOf('\u0000', b0)) {
      const st = carry.slice();
      for (let i = b0; i < e; i++) {
        const c = s[i];
        if (OPEN.includes(c)) { st.push(i); continue; }
        if (!CLOSE.includes(c)) continue;
        // 番号の閉じかっこ: 行の始め・空白・句読点のあとの1〜2字の英数字に続く「)」(「（1）」のように開きかっこがすぐ前にあるものは除く)
        let k = i; while (k > b0 && i - k < 2 && NUM.test(s[k - 1])) k--;
        if (/[)）]/.test(c) && k < i && (k === b0 || pg.ls.has(k) || /[\s、。・　]/.test(s[k - 1])) && !(st.length && st[st.length - 1] === k - 1)) continue;
        const top = st.length ? st[st.length - 1] : -1;
        if (top >= 0 && KIND(s[top]) === KIND(c)) { st.pop(); continue; }
        const j = st.map(x => KIND(s[x])).lastIndexOf(KIND(c));
        if (j >= 0) { st.splice(j + 1).forEach(miss); st.pop(); continue; }
        out.push({ pg, i, n: 1, kind: 'paren', level: 'need', want: '', msg: `「${c}」に対応する開きかっこがありません` });
      }
      // 前のまとまりから続けて探したかっこで、このまとまりでも閉じなかったものは閉じ忘れ。このまとまりのかっこは次のまとまりへ
      const prev = new Set(carry);
      st.filter(x => prev.has(x)).forEach(miss);
      carry = st.filter(x => !prev.has(x));
    }
    carry.forEach(miss);
    return out;
  }

  // ---- 同じ字の重なり・よくある誤用・ら抜き言葉・二重敬語・重複表現・半角カナ(決まった言い方の一覧) ----
  //   [正規表現, 種類, 直す候補(なければ ''), 説明, 直す必要がありそうか]
  const RULES = [
    [/をを|がが|にに|でで|へへ|のの(?!し)/g, 'dup', '', '助詞が重なっています', true],
    [/([。、，．])\1/g, 'dup', '', '句読点が重なっています', true],
    [/、。|。、/g, 'dup', '', '句読点が重なっています', true],
    [/的を得/g, 'misuse', '的を射', '「的を射る」が本来の言い方です', true],
    [/汚名挽回/g, 'misuse', '汚名返上', '「汚名返上」または「名誉挽回」です', true],
    [/取り付く暇|取りつく暇/g, 'misuse', '取り付く島', '「取り付く島もない」です', true],
    [/一同に会/g, 'misuse', '一堂に会', '「一堂に会する」です', true],
    [/采配を振るう/g, 'misuse', '采配を振る', '「采配を振る」が本来の言い方です', true],
    [/押しも押されぬ/g, 'misuse', '押しも押されもせぬ', '「押しも押されもせぬ」です', true],
    [/熱にうなされ/g, 'misuse', '熱に浮かされ', '「熱に浮かされる」です', true],
    [/怒り心頭に達/g, 'misuse', '怒り心頭に発', '「怒り心頭に発する」です', true],
    [/(?:見|来|寝|着|出|起き|食べ|考え|決め|投げ|受け|変え|答え|教え|覚え|借り|信じ|感じ|閉じ|伸び|生き|落ち|降り|居)れ(?:る|ます|ません|ない|た|て)/g, 'ranuki', '', 'ら抜き言葉の可能性があります（「〜られる」）', false],
    [/おっしゃられ|お越しになられ|ご覧になられ|お召し上がりになられ|お見えになられ|お帰りになられ|おいでになられ|拝見させていただ/g, 'keigo', '', '二重敬語の可能性があります', false],
    [/頭痛が痛|一番最初|まず最初に|後で後悔|あとで後悔|必ず必要|違和感を感じ|被害を被|過半数を超え|返事を返|今現在|日本に来日|製造メーカー|約[\d０-９,，.]+[^\s。、]{0,6}(?:程度|ほど|前後)/g, 'redund', '', '同じ意味の言葉が重なっています', false],
    [/[ｦ-ﾟ]+/g, 'hankana', '', '半角カナです', false],
  ];
  function rules(pg) {
    const out = [];
    for (const [re, kind, want, msg, need] of RULES) for (const m of pg.s.matchAll(re)) {
      if (m[0].includes('\u0000')) continue;
      out.push({ pg, i: m.index, n: m[0].length, kind, level: need ? 'need' : 'check', want, msg });
    }
    // 同じ語(漢字2字以上・カタカナ3字以上)がすぐ続けてくり返す
    for (const m of pg.s.matchAll(/(\p{Script=Han}{2,}|\p{Script=Katakana}{3,})\1/gu)) out.push({ pg, i: m.index, n: m[0].length, kind: 'dup', level: 'check', want: m[1], msg: `「${m[1]}」が2回続いています` });
    return out;
  }

  // ---- 電話番号・郵便番号の形 ----
  function numbers(pg) {
    const out = [], t = nfkc(pg.s);
    for (const m of t.matchAll(/(?<![\d-])0[1-9]\d{0,3}-\d{1,4}-\d{1,4}(?![\d-])/g)) {   // 00 で始まる番号(国際電話)・架空の 000 は見ない
      const n = m[0].replace(/-/g, '').length, mobile = /^0[5789]0/.test(m[0].replace(/-/g, '')), free = /^0120|^0800/.test(m[0].replace(/-/g, ''));
      if (n < 9 || n > 12) continue;   // 「01-02-03」のような短い番号(品番・日付など)は電話番号とみなさない
      const ok = free ? (m[0].startsWith('0120') ? n === 10 : n === 11) : mobile ? n === 11 : n === 10;
      if (!ok) out.push({ pg, i: m.index, n: m[0].length, kind: 'phone', level: 'need', want: '', msg: `電話番号の桁数が合いません（${n}桁）` });
    }
    for (const m of t.matchAll(/〒\s*(\d+)-?(\d*)/g)) if (!((m[1].length === 3 && m[2].length === 4) || (m[1].length === 7 && !m[2]))) out.push({ pg, i: m.index, n: m[0].length, kind: 'zip', level: 'need', want: '', msg: '郵便番号の形が合いません（3桁-4桁）' });
    return out;
  }

  // ---- 表記ゆれ(成果物全体で、同じ語の書き方が混ざっているもの) ----
  //   送りがなを省いた書き方(「申込」など)は、うしろに漢字が続くとき(「申込書」「取扱店」など、複合語の決まった書き方)は数えない
  const YURE = [
    ['問い合わせ', '問合せ', '問い合せ', '問合わせ'], ['申し込み', '申込み', '申込'], ['受け付け', '受付け'], ['取り扱い', '取扱い', '取扱'],
    ['売り切れ', '売切れ', '売切'], ['引き換え', '引換え', '引換'], ['振り込み', '振込み', '振込'],
    ['ください', '下さい'], ['いたします', '致します'], ['できる', '出来る'], ['および', '及び'], ['または', '又は'], ['ならびに', '並びに'], ['すべて', '全て'],
  ];
  function yure(pages) {
    const out = [];
    const hits = w => pages.flatMap(pg => [...pg.s.matchAll(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (/\p{Script=Han}$/u.test(w) ? '(?!\\p{Script=Han})' : ''), 'gu'))].map(m => ({ pg, i: m.index, n: w.length })));
    for (const g of YURE) {
      const found = g.map(w => ({ w, xs: hits(w) })).filter(x => x.xs.length);
      if (found.length < 2) continue;
      // 長い書き方に含まれる短い書き方は数えない(「申し込み」の中の「申込」はない、「問い合わせ」の中の「問合せ」はない、など)
      const xs = found.map(x => ({ ...x, xs: x.xs.filter(h => !found.some(y => y.w.length > x.w.length && y.w.includes(x.w) && y.xs.some(z => z.pg === h.pg && z.i <= h.i && h.i < z.i + z.n))) })).filter(x => x.xs.length);
      if (xs.length < 2) continue;
      const minor = xs.slice().sort((a, b) => a.xs.length - b.xs.length);
      out.push({ multi: minor.flatMap(x => x.xs), kind: 'yure', level: 'check', want: minor[minor.length - 1].w, msg: `書き方が混ざっています：${xs.map(x => `「${x.w}」${x.xs.length}か所`).join('・')}` });
    }
    // カタカナ語の長音のあるなし(「サーバ」と「サーバー」)
    const kata = new Map();
    pages.forEach(pg => { for (const m of pg.s.matchAll(/\p{Script=Katakana}[\p{Script=Katakana}ー]{2,}/gu)) { const k = m[0]; if (!kata.has(k)) kata.set(k, []); kata.get(k).push({ pg, i: m.index, n: k.length }); } });
    for (const [k, xs] of kata) if (k.endsWith('ー') && kata.has(k.slice(0, -1)) && !/ー{2}/.test(k)) {
      const ys = kata.get(k.slice(0, -1)).filter(h => h.pg.s[h.i + h.n] !== 'ー');
      if (ys.length) out.push({ multi: [...ys, ...xs], kind: 'yure', level: 'check', want: k, msg: `書き方が混ざっています：「${k.slice(0, -1)}」${ys.length}か所・「${k}」${xs.length}か所` });
    }
    // 全角と半角の数字・英字(同じ書き方の語が、全角と半角で混ざっているもの)
    const words = new Map();
    pages.forEach(pg => { for (const m of pg.s.matchAll(/[0-9A-Za-z０-９Ａ-Ｚａ-ｚ][0-9A-Za-z０-９Ａ-Ｚａ-ｚ,，.．]*/g)) { const k = nfkc(m[0]); if (!/[A-Za-z]{2,}|\d{2,}/.test(k)) continue; if (!words.has(k)) words.set(k, new Map()); const v = words.get(k); if (!v.has(m[0])) v.set(m[0], []); v.get(m[0]).push({ pg, i: m.index, n: m[0].length }); } });
    for (const [k, v] of words) if (v.size >= 2) out.push({ multi: [...v.values()].flat(), kind: 'yure', level: 'check', want: k, msg: `全角と半角が混ざっています：${[...v].map(([w, xs]) => `「${w}」${xs.length}か所`).join('・')}` });
    return out;
  }

  // pages: [{ q: 成果物のページ番号, B: 文字データ(PC.pageText) }] → 項目 [{ q, box(pt), boxes, kind, level, show, want, msg, ctx }]
  PC.jcheck = pages => {
    const P = pages.map(({ q, B }) => ({ q, B, ...textOf(B) }));
    const raw = [...dates(P), ...P.flatMap(parens), ...P.flatMap(rules), ...P.flatMap(numbers), ...yure(P)];
    const out = [];
    for (const r of raw) {
      if (r.multi) {   // 表記ゆれ: 少ないほうの書き方の最初の所を代表にし、すべての位置を添える
        const x = r.multi[0], byQ = new Map();
        for (const h of r.multi) { if (!byQ.has(h.pg.q)) byQ.set(h.pg.q, []); byQ.get(h.pg.q).push(boxOf(h.pg.B, h.pg.at, h.i, h.n)); }
        out.push({ q: x.pg.q, box: boxOf(x.pg.B, x.pg.at, x.i, x.n), boxes: byQ, kind: r.kind, level: r.level, show: x.pg.s.substr(x.i, x.n), want: r.want, msg: r.msg, ctx: ctxOf(x.pg.s, x.i, x.n), count: r.multi.length });
        continue;
      }
      const { pg, i, n } = r;
      out.push({ q: pg.q, box: boxOf(pg.B, pg.at, i, n), kind: r.kind, level: r.level, show: pg.s.substr(i, n), want: r.want, msg: r.msg, ctx: ctxOf(pg.s, i, n) });
    }
    return out.filter(x => x.box);
  };
})();
