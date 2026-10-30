// 成果物だけを読んで、問題がありそうな所を挙げる(原稿とは照らし合わせない。決まったルールと辞書だけで判定する)
//   直す必要がありそう: ページの端の切れ端・日付の誤り(曜日・存在しない日付)・かっこの閉じ忘れ・同じ字や助動詞の重なり・助詞の続き方
//     ・よくある誤用と誤字(決まった言い方)・送りがなの誤り・電話番号と郵便番号の形
//   確認だけ: 表記ゆれ(一覧・辞書の読み・カタカナ語・全角半角・金額の桁区切り・句読点)・ら抜き言葉・さ入れ言葉・「〜たり」が1つだけ
//     ・二重敬語など・重複表現・語の重なり・カタカナ語の1字違い・半角カナ
//   辞書を使うもの(形態素解析: kuromoji.js と IPADIC)は、辞書が読めないときは行わない(ら抜き言葉だけは決まった動詞の一覧で見る)
//   英語は echeck.js
'use strict';
(function () {
  const WD = ['日', '月', '火', '水', '木', '金', '土'];

  // ページの文字を、まとまり(段落・行のつながり)ごとの文字列にする。at: 文字列の位置 → 文字の番号、ls: 行の始めの位置
  //   (飾りのために重ねて描いた文字は、文字データを読むとき(PC.pageText)に除いてある)
  //   skip: 読まないまとまり(ページの端の切れ端・仕上がりの外の文字)の番号
  function textOf(B, skip) {
    let s = ''; const at = [], ls = new Set();
    for (const [a, e] of PC.blocksOf(B.chars, B.items)) {
      let n0 = s.length, p = null;
      for (let i = a; i < e; i++) {
        if (skip.has(B.chars[i].it) || B.chars[i].ocr) continue;   // OCR で読んだ字(読み違いがあり得る)は、成果物だけのチェックでは読まない
        const c = B.chars[i].c;
        if (s.length === n0 || (p.it !== B.chars[i].it && B.chars[i].box[1] > p.box[3] - 0.3 * (p.box[3] - p.box[1]))) ls.add(s.length);
        p = B.chars[i];
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

  // ---- ページの端の切れ端 ----
  //   ページの外枠をまたぐ文字(ページの端で切れている)、仕上がりの外(断裁で落ちる所)にある文字、仕上がり線をまたぐ文字(断裁で切れる)を挙げる
  //   仕上がりの外の文字のうち、印刷用の情報(ファイル名・日時など。決まった形の文字か、ほかのページの同じ高さに同じ形の文字があるもの)は除く
  //   切れ端と仕上がりの外の文字は、ほかのチェック(かっこの対応など)では読まない
  const inside = (b, r, m) => b[0] >= r[0] - m && b[1] >= r[1] - m && b[2] <= r[2] + m && b[3] <= r[3] + m;
  const apart = (b, r) => b[2] <= r[0] || b[0] >= r[2] || b[3] <= r[1] || b[1] >= r[3];
  const SLUG = /\.(indd|idml|ai|eps|psd|pdf|qxd|qxp)\b|\d{4}\s*[\/.\-年]\s*\d{1,2}\s*[\/.\-月]\s*\d{1,2}|\d{1,2}:\d{2}/i;
  const EDGE = { cut: 'ページの端で文字が切れています（データの切れ端が残っていないか確認してください）', out: '仕上がりの外に文字があります（断裁で落ちます。データの切れ端が残っていないか確認してください）', trim: '仕上がり線にかかって、文字が断裁で切れます' };
  function edges(pages) {
    const cls = pages.map(({ B }) => B.items.map(it => {
      if (it.ocr) return null;   // OCR で読んで足した字(文字データのない所)は見ない
      const b = it.box, m = 0.25 * Math.max(1, Math.min(b[2] - b[0], b[3] - b[1])), pg = [0, 0, B.w, B.h];
      if (apart(b, pg)) return 'away';   // ページの外(見えない)
      if (!inside(b, pg, m)) return 'cut';
      if (!B.trim) return null;
      if (apart(b, B.trim)) return 'out';
      return inside(b, B.trim, m) ? null : 'trim';
    }));
    const key = it => it.s.replace(/\s/g, '').replace(/\d+/g, '9'), cy = b => (b[1] + b[3]) / 2;
    //   決まった形の印刷用の情報と同じ行に並ぶ字(「ファイル名.indd   3   日付   時刻」のページ番号など)も、印刷用の情報とする
    const fixed = pages.map(({ B }, n) => B.items.map((it, k) => cls[n][k] === 'out' && SLUG.test(it.s)));
    const sameLine = (a, b) => { const h = Math.max(a[3] - a[1], b[3] - b[1], 1); return Math.abs(cy(a) - cy(b)) < 0.5 * h && PC.gap(a, b) < 8 * h; };
    const slug = (n, k) => {
      const it = pages[n].B.items[k];
      if (fixed[n][k] || pages[n].B.items.some((o, j) => fixed[n][j] && sameLine(o.box, it.box))) return true;
      return pages.some(({ B }, m) => m !== n && B.items.some((o, j) => cls[m][j] === 'out' && key(o) === key(it) && Math.abs(cy(o.box) - cy(it.box)) < 3));
    };
    const found = [], skip = pages.map(() => new Set());
    pages.forEach(({ q, B }, n) => {
      const hits = [];
      cls[n].forEach((c, k) => {
        if (!c) return;
        if (c !== 'trim') skip[n].add(k);
        if (c === 'away' || (c === 'out' && slug(n, k))) return;
        hits.push({ c, k, box: B.items[k].box });
      });
      // 近くの同じ種類のものは1つにまとめる(「〈フ」と、その下の「YR」など)
      const used = new Set();
      for (const h of hits) {
        if (used.has(h)) continue;
        const g = [h]; used.add(h);
        for (let grew = true; grew;) {
          grew = false;
          for (const x of hits) {
            if (used.has(x) || x.c !== h.c) continue;
            if (g.some(y => { const s = Math.max(4, y.box[3] - y.box[1]); return x.box[0] < y.box[2] + 1.5 * s && x.box[2] > y.box[0] - 1.5 * s && x.box[1] < y.box[3] + 1.5 * s && x.box[3] > y.box[1] - 1.5 * s; })) { g.push(x); used.add(x); grew = true; }
          }
        }
        g.sort((a, b) => a.k - b.k);
        const show = g.map((x, j) => (j && Math.abs(cy(x.box) - cy(g[j - 1].box)) > 0.5 * (x.box[3] - x.box[1]) ? ' ' : '') + B.items[x.k].s.trim()).join('');
        found.push({ q, box: PC.union(g.map(x => x.box)), kind: 'edge', sub: h.c, level: 'need', show, want: '', msg: EDGE[h.c], ctx: ['', ''] });
      }
    });
    return { found, skip };
  }

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
    const out = [], s = pg.s, B = pg.B, at = pg.at;
    const miss = x => out.push({ pg, i: x, n: 1, kind: 'paren', level: 'need', want: '', msg: `「${s[x]}」に対応する閉じかっこがありません` });
    const boxAt = x => (at[x] >= 0 ? B.chars[at[x]].box : null);
    const sameLine = (a, b) => Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 0.5 * Math.min(a[3] - a[1], b[3] - b[1]);
    //   前のまとまりの開きかっこが、すぐ近くにある(「（※」と「1）」が別のまとまりになった注記の番号など。図の中の回転した注記もあるため、向きは問わない)
    const nextTo = (x, i) => { const a = boxAt(x), b = boxAt(i); return !!a && !!b && PC.gap(a, b) < 4 * Math.max(a[2] - a[0], a[3] - a[1]); };
    let b0 = 0, carry = [];
    for (let e = s.indexOf('\u0000'); e >= 0; b0 = e + 1, e = s.indexOf('\u0000', b0)) {
      const st = carry.slice();
      for (let i = b0; i < e; i++) {
        const c = s[i];
        if (OPEN.includes(c)) { st.push(i); continue; }
        if (!CLOSE.includes(c)) continue;
        // 番号の閉じかっこ: 行の始め・空白・句読点のあとの1〜2字の英数字に続く「)」(「（1）」のように開きかっこがすぐ前にあるものは除く)
        let k = i; while (k > b0 && i - k < 2 && NUM.test(s[k - 1])) k--;
        //   同じ行に閉じていない「（」があれば、番号ではなくそちらの閉じかっことする(「（■■・JH）」など)
        let ls0 = b0; for (let q = i; q > b0; q--) if (pg.ls.has(q)) { ls0 = q; break; }
        if (/[)）]/.test(c) && k < i && (k === b0 || pg.ls.has(k) || /[\s、。・　]/.test(s[k - 1])) && !st.some(x => KIND(s[x]) === 0 && (x >= ls0 || (x < b0 && nextTo(x, i))))) continue;
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
    // 読む順番の都合で離れた所に来たかっこ
    //   1) まとまりの終わりの閉じていないかっこと、別のまとまりの始めの開いていないかっこ(間の字が合わせて40字まで、近い所)は対とする
    //      (縦書きの「（」と「ページ）」の間に横組みの数字のまとまりがある、段組みの注記で次の段の始めに閉じかっこがある、など)
    const blockOf = i => { const a = s.lastIndexOf('\u0000', i - 1) + 1, e = s.indexOf('\u0000', i); return [a, e < 0 ? s.length : e]; };
    const PAREN = new RegExp(`[${(OPEN + CLOSE).replace(/[\]\[]/g, '\\$&')}]`);
    const tail = o => { const [, e] = blockOf(o.i), t = s.slice(o.i + 1, e); return PAREN.test(t) ? -1 : t.length; };
    const head = o => { const [a] = blockOf(o.i), t = s.slice(a, o.i); return PAREN.test(t) ? -1 : t.length; };
    const isOpen = o => OPEN.includes(s[o.i]), paired = new Set();
    for (const o of out) {
      if (!isOpen(o) || paired.has(o)) continue;
      const tl = tail(o), ob = boxAt(o.i); if (tl < 0 || !ob) continue;
      const h = ob[3] - ob[1];
      let best = null, bd = Infinity;
      for (const c of out) {
        if (isOpen(c) || paired.has(c) || KIND(s[c.i]) !== KIND(s[o.i]) || blockOf(c.i)[0] === blockOf(o.i)[0]) continue;
        const hd = head(c), cb = boxAt(c.i); if (hd < 0 || !cb || tl + hd > 40) continue;
        const d = Math.hypot((cb[0] + cb[2]) / 2 - (ob[0] + ob[2]) / 2, (cb[1] + cb[3]) / 2 - (ob[1] + ob[3]) / 2);
        if (d < 40 * h && d < bd) { bd = d; best = c; }
      }
      if (best) { paired.add(o); paired.add(best); }
    }
    //   2) 同じ行の右(閉じかっこなら左)に対のかっこがあれば、閉じ忘れとしない
    return out.filter(o => {
      if (paired.has(o)) return false;
      const c = s[o.i], ci = at[o.i]; if (ci < 0) return true;
      const open = OPEN.includes(c), box = B.chars[ci].box, h = box[3] - box[1];
      return !B.chars.some(x => (open ? CLOSE : OPEN).includes(x.c) && KIND(x.c) === KIND(c) && sameLine(x.box, box) && (open ? x.box[0] > box[0] : x.box[0] < box[0]) && Math.abs(x.box[0] - box[0]) < 60 * h);
    });
  }

  // ---- よくある誤用・誤字(決まった言い方)。[正規表現, 直す候補, 説明] ----
  //   ほかの読み方・使い方がまずない言い方だけを挙げる(直す必要がありそう)
  const M = (words, want, msg) => [new RegExp(words, 'gu'), want, msg || `「${want}」の誤りです`];
  const MISUSE = [
    M('的を得', '的を射', '「的を射る」が本来の言い方です'), M('汚名挽回', '汚名返上', '「汚名返上」または「名誉挽回」です'), M('名誉返上', '名誉挽回', '「名誉挽回」または「汚名返上」です'),
    M('取り付く暇|取りつく暇', '取り付く島', '「取り付く島もない」です'), M('一同に会', '一堂に会', '「一堂に会する」です'), M('采配を振るう', '采配を振る', '「采配を振る」が本来の言い方です'),
    M('押しも押されぬ', '押しも押されもせぬ', '「押しも押されもせぬ」です'), M('熱にうなされ', '熱に浮かされ', '「熱に浮かされる」です'), M('怒り心頭に達', '怒り心頭に発', '「怒り心頭に発する」です'),
    M('足元をすくわれ', '足をすくわれ'), M('明るみになっ', '明るみに出'), M('明るみになる', '明るみに出る'), M('明るみになり', '明るみに出'), M('念頭に入れ(?=て|た)', '念頭に置い'), M('念頭に入れる', '念頭に置く'), M('念頭に入れ(?=ま|な|ず|よう)', '念頭に置き'), M('上や下への', '上を下への'), M('二の舞を踏む', '二の舞を演じる', '「二の舞を演じる」（または「二の足を踏む」）です'), M('二の舞を踏ん(?=で|だ)', '二の舞を演じ', '「二の舞を演じる」（または「二の足を踏む」）です'), M('二の舞を踏み', '二の舞を演じ', '「二の舞を演じる」（または「二の足を踏む」）です'),
    M('愛想を振りま', '愛嬌を振りま'), M('口先三寸', '舌先三寸'), M('雪辱を晴ら', '雪辱を果た', '「雪辱を果たす」（または「屈辱を晴らす」）です'), M('白羽の矢が当たる', '白羽の矢が立つ'), M('白羽の矢が当たっ', '白羽の矢が立っ'), M('白羽の矢が当たり', '白羽の矢が立ち'), M('白羽の矢が当たら', '白羽の矢が立た'), M('寸暇を惜しまず', '寸暇を惜しんで'),
    M('物議をかもし出|物議を醸し出', '物議を醸'), M('舌の先の乾かぬ', '舌の根の乾かぬ'), M('腹を据えかね|腹をすえかね', '腹に据えかね'),
    M('絶対絶命', '絶体絶命'), M('危機一発', '危機一髪'), M('五里夢中', '五里霧中'), M('意味慎重', '意味深長'), M('自我自賛', '自画自賛'), M('興味深々|興味深深', '興味津々'),
    M('心機一点', '心機一転'), M('異句同音', '異口同音'), M('無我無中', '無我夢中'), M('短刀直入', '単刀直入'), M('責任転化', '責任転嫁'), M('厚顔無知', '厚顔無恥'),
    M('言語同断', '言語道断'), M('一身同体', '一心同体'), M('前代未問', '前代未聞'), M('公私混合', '公私混同'), M('天真爛慢', '天真爛漫'), M('縦横無人', '縦横無尽'),
    M('不和雷同', '付和雷同'), M('晴天白日', '青天白日'), M('首尾一環', '首尾一貫'), M('温古知新', '温故知新'), M('単純明解', '単純明快'), M('優柔不段', '優柔不断'),
    M('臨期応変', '臨機応変'), M('二者選一', '二者択一'), M('適材適処', '適材適所'), M('意気統合', '意気投合'), M('弱肉強植', '弱肉強食'), M('一朝一石', '一朝一夕'),
    M('大器晩生', '大器晩成'), M('千載一隅', '千載一遇'), M('喜怒愛楽', '喜怒哀楽'), M('一喜一優', '一喜一憂'), M('呉越同船', '呉越同舟'), M('和気合々|和気合い合い', '和気あいあい'),
    M('完壁', '完璧'), M('専問', '専門'), M('価値感', '価値観'), M('先入感', '先入観'), M('既成服', '既製服'), M('除々に', '徐々に'), M('異和感', '違和感'), M('一諸に', '一緒に'),
    M('撤底', '徹底'), M('講議', '講義'), M('感無料', '感無量'), M('気嫌', '機嫌'), M('余断を許さ', '予断を許さ'),
    M('一貫として', '一環として', '「（全体の）一環として」の誤りです'), M('品質保障', '品質保証'), M('保障書', '保証書'), M('保障期間', '保証期間'),
    M('社会保証', '社会保障'), M('左右対照', '左右対称'), M('線対照', '線対称'), M('点対照', '点対称'), M('対照年齢', '対象年齢'),
    M('対象的(?=な|に|で|だ)', '対照的'), M('確率(?=する|します|した|して|され|させ|しよう)', '確立'), M('始めまして', 'はじめまして', '「初めまして（はじめまして）」の誤りです'), M('(?<!を)始めての', '初めての'),
    M('内臓(?=(?:型|式)?(?:バッテリー|メモリ|電池|カメラ|マイク|スピーカー|ヒーター|タイマー|アンテナ|機能))', '内蔵'), M('ご多聞に漏れ', 'ご多分に漏れ'),
    M('シュミレーション', 'シミュレーション'), M('コミニュケーション', 'コミュニケーション'), M('アボガド', 'アボカド'),
    M('(?<=と|そう|こう|どう|ああ)ゆう(?=[ことのもんよ方人物]|風|感じ|わけ)', 'いう', '「いう」の誤りです（「という」「そういう」など）'), M('こんにちわ', 'こんにちは'), M('こんばんわ', 'こんばんは'),
    M('(?<=[\\p{Script=Han}いきしちにひみりぎじびぴえけせてねへめれげぜでべぺ])ずら(?=い|く|かっ|さ)', 'づら', '「〜づらい」の誤りです'),
  ];
  // 送りがなの誤り(許容の書き方ではないもの)。[正規表現, 正しい書き方]
  const OKURI = [[/短かい/g, '短い'], [/明かる(?=[いくさかけ])/g, '明る'], [/新らし(?=[いくさかけ])/g, '新し'], [/必らず/g, '必ず'], [/危い/g, '危ない'], [/少い/g, '少ない'],
    [/美くし(?=[いくさかけ])/g, '美し'], [/珍らし(?=[いくさかけ])/g, '珍し'], [/著るし(?=[いくさかけ])/g, '著し'], [/確め(?=[るたてまなよれ])/g, '確かめ']];

  // ---- 同じ字の重なり・よくある誤用・誤字・送りがな・二重敬語・重複表現・半角カナ(決まった言い方の一覧) ----
  //   [正規表現, 種類, 直す候補(なければ ''), 説明, 直す必要がありそうか]
  //   助詞の重なり(「をを」など)は、辞書があれば語に分けて見る(「までです」「木でできた」「高いものの」を重なりとしないように)。この一覧のものは辞書がないときだけ
  const PDUP = [/をを|がが|にに|でで|へへ|のの(?!し)/g, 'dup', '', '助詞が重なっています', true];
  const RULES = [
    [/([。、，．])\1/g, 'dup', '', '句読点が重なっています', true],
    [/、。|。、/g, 'dup', '', '句読点が重なっています', true],
    ...MISUSE.map(([re, want, msg]) => [re, 'misuse', want, msg, true]),
    ...OKURI.map(([re, want]) => [re, 'okuri', want, `送りがなの誤りです（「${want}」${want === '危ない' ? '・「危うい」' : ''}）`, true]),
    [/おっしゃられ|ご覧になられ|お召し上がりになられ|拝見させていただ|拝読させていただ|お伺いさせていただ|お[\p{Script=Han}ぁ-ゖ]{1,6}になられ|ご[\p{Script=Han}]{1,4}になられ/gu, 'keigo', '', '二重敬語の可能性があります', false],
    [/申され(?:る|た|ま|て)|参られ(?:る|た|ま|て)/g, 'keigo', '', '謙譲語に「れる・られる」を付けた言い方です（「おっしゃる」「いらっしゃる」など）', false],
    [/ご(?:利用|使用|購入|予約|参加|応募|確認|注文|返品|入金|相談|案内)(?:でき|出来)|お(?:求め|買い求め|使い|申し込み|申込み|問い合わせ|問合せ|取り寄せ|受け取り)(?:でき|出来)/g, 'keigo', '', '「ご〜できる」「お〜できる」は謙譲の形です（「ご〜いただけます」「ご〜になれます」）', false],
    [/頭痛が痛|一番最初|一番最後|まず最初に|後で後悔|あとで後悔|必ず必要|違和感を感じ|被害を被|過半数を超え|返事を返|今現在|日本に来日|製造メーカー|まだ未定|いまだ未定|未だ未定|いまだに未|あらかじめ予(?:約|定)|予め予(?:約|定)|炎天下の下|元旦の朝|後ろへバック|後ろにバック|馬から落馬|古来から|思いがけないハプニング|募金を募|伝言を伝|挙式を挙げ|第[\d０-９一二三四五六七八九十]+回目|[約およそ]+[\d０-９,，.]+[^\s。、]{0,6}(?:程度|ほど|前後|くらい|ぐらい)/g, 'redund', '', '同じ意味の言葉が重なっています', false],
    [/[ｦ-ﾟ]+/g, 'hankana', '', '半角カナです', false],
  ];
  // 辞書が読めないときだけ使う、ら抜き言葉の一覧(辞書があれば、すべての一段動詞で見る)
  const RANUKI = /(?:見|来|寝|着|出|起き|食べ|考え|決め|投げ|受け|変え|答え|教え|覚え|借り|信じ|感じ|閉じ|伸び|生き|落ち|降り|居)れ(?:る|ます|ません|ない|た|て)/g;
  function rules(pg, tk) {
    const out = [];
    for (const [re, kind, want, msg, need] of tk ? RULES : [PDUP, ...RULES]) for (const m of pg.s.matchAll(re)) {
      if (m[0].includes('\u0000')) continue;
      const w = want || (kind === 'dup' && m[0].length === 2 && m[0][0] === m[0][1] ? m[0][0] : '');   // 「をを」→「を」、「。。」→「。」
      out.push({ pg, i: m.index, n: m[0].length, kind, level: need ? 'need' : 'check', want: w, msg });
    }
    // 同じ語(漢字2字以上・カタカナ3字以上)がすぐ続けてくり返す
    //   くり返して使う言い方(「一点一点」「一人一人」、「シャカシャカ」のような短い音の言葉)は除く
    for (const m of pg.s.matchAll(/(\p{Script=Han}{2,}|\p{Script=Katakana}{3,})\1/gu)) if (!redup(m[1]) && new Set(pg.at.slice(m.index, m.index + m[0].length).map(j => pg.B.chars[j].it)).size === 1) out.push({ pg, i: m.index, n: m[0].length, kind: 'dup', level: 'check', want: m[1], msg: `「${m[1]}」が2回続いています` });
    return out;
  }
  const REDUP = /^(?:一[\p{Script=Han}つ]|ひとつ|ひとり|[\p{Script=Katakana}ー]*[ァィゥェォャュョッヮー][\p{Script=Katakana}ー]*)$/u;
  const redup = w => REDUP.test(w) && (/^(?:一|ひと)/.test(w) || [...w].length <= 3);

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

  // ---- 辞書(形態素解析)を使うチェック ----
  //   辞書は HTML に埋め込んだもの(id="ipadic-ファイル名"。gzip を base64 にしたもの)。kuromoji.js が XMLHttpRequest で読みに来るのを、この入れ物で渡す
  PC.DictXHR = class {
    open(method, url) { this.name = String(url).split('/').pop(); }
    send() {
      setTimeout(() => {
        const el = document.getElementById('ipadic-' + this.name);
        if (!el) { this.status = 404; this.statusText = `辞書（${this.name}）が見つかりません`; this.onload(); return; }
        this.status = 200; this.response = PC.b64bytes(el.textContent).buffer; this.onload();
      }, 0);
    }
  };
  let tkP = null;
  PC.tokenizer = () => tkP || (tkP = new Promise(res => {
    if (!window.kuromoji) return res(null);
    try { kuromoji.builder({ dicPath: 'ipadic/' }).build((err, tk) => res(err ? null : tk)); } catch (e) { res(null); }
  }));
  // ページの文字列を、まとまりごとに語に分ける(語の位置 i は文字列の位置)
  //   位置は語の字数を足して求める(kuromoji の word_position は、「℃、」のように2字以上の語で区切った文のあとでずれる。
  //   語をつなげると元の文字列に戻る)
  function tokensOf(pg, tk) {
    const out = []; let b0 = 0;
    for (let e = pg.s.indexOf('\u0000'); e >= 0; b0 = e + 1, e = pg.s.indexOf('\u0000', b0)) {
      const T = tk.tokenize(pg.s.slice(b0, e));
      let i = b0;
      T.forEach(t => { t.i = i; t.n = t.surface_form.length; i += t.n; });
      out.push(T);
    }
    return out;
  }
  const JA = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆]+$/u;
  const E2U = { え: 'う', け: 'く', せ: 'す', て: 'つ', ね: 'ぬ', へ: 'ふ', め: 'む', れ: 'る', げ: 'ぐ', べ: 'ぶ' };
  function morph(pages, tk) {
    const out = [], isVerb5 = new Map();
    // 可能動詞(「行ける」← 五段の「行く」)か: れ足す言葉の見分けに使う
    const potential = w => {
      if (!isVerb5.has(w)) {
        const m = w.match(/^(.*)([えけせてねへめれげべ])る$/), v = m ? m[1] + E2U[m[2]] : null, t = v ? tk.tokenize(v) : [];
        isVerb5.set(w, t.length === 1 && t[0].pos === '動詞' && /五段/.test(t[0].conjugated_type) && t[0].basic_form === v);
      }
      return isVerb5.get(w);
    };
    const span = (pg, a, b, kind, level, want, msg) => out.push({ pg, i: a.i, n: b.i + b.n - a.i, kind, level, want, msg });
    for (const pg of pages) for (const T of (pg.T = tokensOf(pg, tk))) T.forEach((t, k) => {
      const n = T[k + 1] || {};
      // ら抜き言葉(一段・カ変の動詞＋「れる」)。可能動詞＋「れる」は、れ足す言葉
      if (t.pos === '動詞' && t.pos_detail_1 === '自立' && /一段|カ変/.test(t.conjugated_type) && t.conjugated_form === '未然形' && n.pos === '動詞' && n.pos_detail_1 === '接尾' && n.basic_form === 'れる')
        if (potential(t.basic_form)) span(pg, t, n, 'ranuki', 'check', t.surface_form + n.surface_form.slice(1), '「れ足す言葉」の可能性があります（「行けれる」→「行ける」など）');
        else span(pg, t, n, 'ranuki', 'check', t.surface_form + 'ら' + n.surface_form, 'ら抜き言葉の可能性があります（「〜られる」）');
      if (t.pos === '動詞' && /^(見れる|来れる)$/.test(t.basic_form)) span(pg, t, t, 'ranuki', 'check', t.surface_form.replace(/^(見|来)れ/, '$1られ'), 'ら抜き言葉の可能性があります（「〜られる」）');
      // さ入れ言葉(五段の動詞＋「させる」)
      if (t.pos === '動詞' && /五段/.test(t.conjugated_type) && t.conjugated_form === '未然形' && n.pos === '動詞' && n.pos_detail_1 === '接尾' && n.basic_form === 'させる')
        span(pg, t, n, 'saire', 'check', t.surface_form + n.surface_form.slice(1), 'さ入れ言葉の可能性があります（「〜せる」）');
      // 助詞の続き方(「をが」「がを」「にを」など、格助詞の「が」「を」がほかの格助詞と続くもの。同じ助詞の重なり「をを」は決まった言い方の一覧で見る)
      const cs = x => x.pos === '助詞' && x.pos_detail_1 === '格助詞';
      if (cs(t) && cs(n) && t.surface_form !== n.surface_form && ((/^[がを]$/.test(t.surface_form) && /^[がをにへで]$/.test(n.surface_form)) || (/^[にへで]$/.test(t.surface_form) && /^[がを]$/.test(n.surface_form))))
        span(pg, t, n, 'particle', 'need', '', '助詞の続き方がおかしい可能性があります');
      // 助詞の重なり(「をを」「がが」など、同じ助詞が続くもの)
      if (t.pos === '助詞' && n.pos === '助詞' && t.surface_form === n.surface_form && /^[をがにでへのとも]$/.test(t.surface_form)) span(pg, t, n, 'dup', 'need', t.surface_form, '助詞が重なっています');
      // 助動詞の重なり(「ありますます」)
      if (t.pos === '助動詞' && n.pos === '助動詞' && t.surface_form === n.surface_form && /^(ます|です|まし|でし)$/.test(t.surface_form)) span(pg, t, n, 'dup', 'need', t.surface_form, '同じ言葉が重なっています');
      // 語の並びの重なり(「ご利用ご利用」など。かなを含むもの。漢字だけ・カタカナだけのものは決まった言い方の一覧で見る)。同じ文字列のまとまりの中だけ
      for (let L = 1; L <= 3 && k + 2 * L <= T.length; L++) {
        const A = T.slice(k, k + L), B2 = T.slice(k + L, k + 2 * L);
        if (A.some((x, j) => x.surface_form !== B2[j].surface_form)) continue;
        const w = A.map(x => x.surface_form).join('');
        if (!JA.test(w) || !/\p{Script=Hiragana}/u.test(w) || !A.some(x => /名詞|動詞|形容詞/.test(x.pos) && x.surface_form.length >= 2) || redup(w)) continue;
        if (new Set(pg.at.slice(t.i, t.i + 2 * w.length).map(j => pg.B.chars[j].it)).size !== 1) continue;
        span(pg, t, B2[L - 1], 'dup', 'check', w, `「${w}」が2回続いています`); break;
      }
      // 「使い安い」→「使いやすい」(動詞の連用形＋「安い」。「高い安い」のような形容詞の並びは除く)
      if (t.pos === '形容詞' && t.basic_form === '安い' && k > 0) {
        const p = T[k - 1], stem = p.pos === '動詞' && p.conjugated_form === '連用形' ? true : p.pos === '名詞' && /^\p{Script=Han}+[いきしちにひみりぎじびえけせてねめれげべ]$/u.test(p.surface_form) && (tk.tokenize(p.surface_form + 'ます')[0] || {}).pos === '動詞';
        if (stem && t.surface_form.startsWith('安')) out.push({ pg, i: t.i, n: 1, kind: 'misuse', level: 'need', want: 'やす', msg: '「〜やすい」の誤りです（「使いやすい」など）' });
      }
      // 「〜たり」が文の中に1つだけ(「〜たりする」は除く)
      if (t.pos === '助詞' && t.pos_detail_1 === '並立助詞' && /^(たり|だり)$/.test(t.surface_form)) {
        let a = k, b = k; while (a > 0 && !/[。！？!?]/.test(T[a - 1].surface_form)) a--; while (b < T.length - 1 && !/[。！？!?]/.test(T[b + 1].surface_form)) b++;
        let m = k + 1; while (T[m] && T[m].pos === '助詞') m++;
        if (T.slice(a, b + 1).filter(x => x.pos === '助詞' && x.pos_detail_1 === '並立助詞' && /^(たり|だり)$/.test(x.surface_form)).length === 1 && !(T[m] && T[m].basic_form === 'する'))
          span(pg, t, t, 'tari', 'check', '', '「〜たり」は「〜たり、〜たり（する）」と並べるのが一般的です');
      }
    });
    return out;
  }
  // 表記ゆれ(辞書の読み): 読みと品詞が同じ語で、送りがなだけが違う・漢字とかなが違う書き方が混ざっているもの
  //   読みが同じでも漢字が違う語(「機会」と「機械」)は数えない。送りがなを省いた書き方のあとに漢字が続くもの(複合語「取扱説明書」)、
  //   「て・で」のあとの動詞(補助動詞「〜ていく」「〜てみる」)と「〜について」「〜によって」「〜にとって」などの動詞は、かなで書くのがふつうなので数えない。一覧(YURE)で見る組は除く
  // base(基本形)を surf(活用した形)にしたのと同じ変え方で、to(別の書き方の基本形)を変える(「分かる」→「分かり」なら「わかる」→「わかり」)
  function conjAs(base, surf, to) {
    let p = 0; while (p < base.length && p < surf.length && base[p] === surf[p]) p++;
    const tb = base.slice(p), ts = surf.slice(p);
    if (!tb) return to + ts;
    return to.endsWith(tb) ? to.slice(0, to.length - tb.length) + ts : '';   // そろえられないときは候補を出さない
  }
  // 異字同訓: 読みが同じで、意味によって漢字を使い分ける語(文化審議会国語分科会「「異字同訓」の漢字の使い分け例（報告）」
  //   (平成26年)の収録項目133の読みと漢字。形容動詞の語幹「あたたか」「やわらか」を加えた)。読み(カタカナ) → 漢字
  //   かなで書いた語は、どの漢字の語に当たるか決められない(「時間がかかる」は「係る」ではない)。漢字の書き方と組にするときは、
  //   候補を出さず、意味で漢字を使い分ける語であることを添える
  const IJI = new Map('あう:会合遭 かえす:返帰 かえる:返帰変換替代 あからむ:赤明 かえりみる:顧省 あがる:上揚挙 あげる:上揚挙 あく:明空開 あける:明空開 かわる:変換替代 あし:足脚 かおり:香薫 かおる:香薫 あたい:値価 かかる:掛懸架係賭 かける:掛懸架係賭 かく:書描 あたたかい:温暖 あたたかだ:温暖 あたたか:温暖 あたたまる:温暖 あたためる:温暖 かげ:陰影 あつい:熱暑 かた:形型 あてる:当充宛 かたい:堅固硬 あと:後跡痕 かま:釜窯 かわ:皮革 あぶら:油脂 かわく:乾渇 あやしい:怪妖 あやまる:誤謝 きく:聞聴利効 あらい:荒粗 あらわす:表現著 あらわれる:表現著 きる:切斬 ある:有在 きわまる:窮極究 きわめる:窮極究 あわせる:合併 こう:請乞 いく:行逝 ゆく:行逝 こえる:越超 こす:越超 いたむ:痛傷悼 いためる:痛傷悼 こたえる:答応 いる:入要 こむ:混込 うける:受請 うた:歌唄 うたう:歌謡 うつ:打討撃 さがす:探捜 うつす:写映 うつる:写映 さく:裂割 うまれる:生産 うむ:生産 うれい:憂愁 うれえる:憂愁 さげる:下提 おかす:犯侵冒 さす:差指刺挿 おくる:送贈 さます:覚冷 さめる:覚冷 おくれる:遅後 さわる:触障 しずまる:静鎮沈 しずめる:静鎮沈 おこす:起興 おこる:起興 しぼる:絞搾 おさえる:押抑 しまる:締絞閉 しめる:締絞閉 おさまる:収納治修 おさめる:収納治修 すすめる:進勧薦 おす:押推 する:刷擦 おそれ:恐畏虞 おそれる:恐畏虞 すわる:座据 おどる:踊躍 おもて:表面 せめる:攻責 おりる:降下卸 おろす:降下卸 そう:沿添 そなえる:備供 はな:花華 はなす:離放 はなれる:離放 たえる:耐堪 はやい:早速 はやまる:早速 はやめる:早速 たずねる:尋訪 はる:張貼 たたかう:戦闘 ひく:引弾 たつ:断絶裁立建 たてる:立建 ふえる:増殖 ふやす:増殖 ふく:吹噴 とうとぶ:尊貴 ふける:更老 たま:玉球弾 ふね:船舟 ふるう:振震奮 つかう:使遣 ほか:外他 つく:付着就 つける:付着就 つぐ:次継接 つくる:作造創 つつしむ:慎謹 つとまる:勤務努 つとめる:勤務努 まざる:交混 まじる:交混 まぜる:交混 とかす:解溶 とく:解溶 とける:解溶 まち:町街 ととのう:整調 ととのえる:整調 まるい:丸円 とぶ:飛跳 まわり:回周 とまる:止留泊 とめる:止留泊 みる:見診 とらえる:捕捉 もと:下元本基 とる:取採執捕撮 や:屋家 ない:無亡 やさしい:優易 なおす:直治 なおる:直治 やぶれる:破敗 なか:中仲 やわらかい:柔軟 やわらかだ:柔軟 やわらか:柔軟 ながい:長永 よ:世代 ならう:習倣 よい:良善 におい:匂臭 におう:匂臭 よむ:読詠 のせる:乗載 のる:乗載 のぞむ:望臨 のばす:伸延 のびる:伸延 のべる:伸延 のぼる:上登昇 わかれる:分別 わく:沸湧 わざ:技業 わずらう:煩患 はえ:映栄 はえる:映栄 はかる:図計測量謀諮 はじまる:初始 はじめ:初始 はじめて:初始 はじめる:初始'.split(' ').map(x => { const [r, k] = x.split(':'); return [[...r].map(c => String.fromCharCode(c.charCodeAt(0) + 0x60)).join(''), [...k]]; }));
  function yureDict(pages, tk) {
    const reads = new Map(), readOf = w => { if (!reads.has(w)) { const t = tk.tokenize(w); reads.set(w, t.length === 1 ? t[0].reading : null); } return reads.get(w); };
    const groups = new Map(), han = w => [...w].filter(c => /\p{Script=Han}/u.test(c)).join('');
    for (const pg of pages) for (const T of pg.T || []) T.forEach((t, k) => {
      if (!/^(名詞|動詞|形容詞|副詞|接続詞|連体詞)$/.test(t.pos) || /固有名詞|数|接尾|代名詞|接続詞的/.test(t.pos_detail_1) || t.word_type !== 'KNOWN' || t.basic_form === '*') return;
      if (!JA.test(t.surface_form) || !JA.test(t.basic_form)) return;
      if (/\p{Script=Han}$/u.test(t.surface_form) && /\p{Script=Han}/u.test(pg.s[t.i + t.n] || '')) return;
      const p = T[k - 1];
      if (t.pos === '動詞' && p && p.pos === '助詞' && p.pos_detail_1 === '接続助詞' && /^(て|で)$/.test(p.surface_form)) return;
      if (t.pos === '動詞' && p && p.surface_form === 'に' && /^(つく|よる|とる|わたる|かける)$/.test(t.basic_form)) return;   // 「〜について」「〜によって」「〜にとって」など(かなで書く言い方)
      const r = readOf(t.basic_form); if (!r) return;
      const key = r + '|' + t.pos + '|' + t.pos_detail_1;
      if (!groups.has(key)) groups.set(key, new Map());
      const g = groups.get(key); if (!g.has(t.basic_form)) g.set(t.basic_form, []); g.get(t.basic_form).push({ pg, i: t.i, n: t.n, w: t.surface_form, cf: t.conjugated_form });
    });
    const out = [];
    for (const [key, g] of groups) {
      if (g.size < 2) continue;
      //   組にするのは、片方の漢字がもう片方の漢字に順に含まれるもの(「拭き取る」と「ふき取る」「ふきとる」、「出来る」と「できる」)
      const sub = (a, b) => { let j = 0; for (const c of b) if (c === a[j]) j++; return j === a.length; };
      const ws = [...g.keys()], pair = (A, B) => sub(han(A), han(B)) || sub(han(B), han(A));
      const use = ws.filter(A => ws.some(B => B !== A && pair(A, B)));
      if (use.length < 2) continue;
      const surf = new Set(use.flatMap(w => g.get(w).map(x => x.w)));
      if (YURE.some(y => y.filter(w => surf.has(w)).length >= 2)) continue;   // 一覧で見る組
      const xs = use.map(w => ({ w, xs: g.get(w) })).sort((a, b) => a.xs.length - b.xs.length);
      // 候補は、表示する所(少ないほうの書き方の最初の所)と同じ活用形にした、多いほうの書き方(「分かり」→「わかり」。基本形の「わかる」ではない)
      const top = xs[xs.length - 1], x0 = xs[0].xs[0], same = top.xs.find(y => y.cf === x0.cf);
      const iji = IJI.get(key.split('|')[0]), kana = use.find(w => !han(w)), amb = iji && kana && use.some(w => han(w));
      const note = amb ? `（かなの「${kana}」は、意味によって漢字（${iji.join('・')}）を使い分ける語です。同じ語か確かめてください）` : '';
      out.push({ multi: xs.flatMap(x => x.xs), kind: 'yure', level: 'check', want: amb ? '' : same ? same.w : conjAs(xs[0].w, x0.w, top.w), msg: `書き方が混ざっています：${xs.slice().reverse().map(x => `「${x.w}」${x.xs.length}か所`).join('・')}${note}` });
    }
    return out;
  }

  // ---- 成果物全体で見る書き方の混ざり・カタカナ語の1字違い(辞書を使わない) ----
  const KANA_N = s => s.replace(/ヴァ/g, 'バ').replace(/ヴィ/g, 'ビ').replace(/ヴェ/g, 'ベ').replace(/ヴォ/g, 'ボ').replace(/ヴ/g, 'ブ').replace(/ウィ/g, 'ウイ').replace(/ウェ/g, 'ウエ').replace(/ウォ/g, 'ウオ');
  function lev(a, b) {
    const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }
  function mixes(pages) {
    const out = [], find = re => pages.flatMap(pg => [...pg.s.matchAll(re)].map(m => ({ pg, i: m.index, n: m[0].length, w: m[0] })));
    const minor = (a, b) => (a.length <= b.length ? [a, b] : [b, a]);
    // カタカナ語: ヴ・ウィなどの書き方の混ざり(「バイオリン」と「ヴァイオリン」)と、1字だけ違う語(誤字?)
    const kata = new Map(); for (const h of find(/\p{Script=Katakana}[\p{Script=Katakana}ー]{2,}/gu)) { if (!kata.has(h.w)) kata.set(h.w, []); kata.get(h.w).push(h); }
    const byN = new Map(); for (const w of kata.keys()) { const k = KANA_N(w); if (!byN.has(k)) byN.set(k, []); byN.get(k).push(w); }
    for (const ws of byN.values()) if (ws.length >= 2) {
      const xs = ws.map(w => ({ w, xs: kata.get(w) })).sort((a, b) => a.xs.length - b.xs.length);
      out.push({ multi: xs.flatMap(x => x.xs), kind: 'yure', level: 'check', want: xs[xs.length - 1].w, msg: `書き方が混ざっています：${xs.slice().reverse().map(x => `「${x.w}」${x.xs.length}か所`).join('・')}` });
    }
    for (const [w, xs] of kata) {
      if (xs.length > 1 || w.length < 5) continue;
      const best = [...kata].filter(([v, ys]) => ys.length >= 2 && v !== w && Math.abs(v.length - w.length) <= 1 && v.replace(/ー/g, '') !== w.replace(/ー/g, '') && KANA_N(v) !== KANA_N(w) && lev(w, v) === 1).sort((a, b) => b[1].length - a[1].length)[0];
      if (best) out.push({ multi: [...xs, ...best[1]], kind: 'typo', level: 'check', want: best[0], msg: `1字だけ違うカタカナ語があります：「${w}」1か所・「${best[0]}」${best[1].length}か所（誤字でないか確認）` });
    }
    // 金額の桁区切りのあるなし(「¥15,600」と「¥4820」。4桁以上の金額だけ)
    const yen = find(/[¥￥]\s*[\d０-９][\d０-９,，]*[\d０-９]|[\d０-９][\d０-９,，]*[\d０-９]\s*円/g).filter(h => h.w.replace(/[^\d０-９]/g, '').length >= 4);
    const [ya, yb] = minor(yen.filter(h => /[,，]/.test(h.w)), yen.filter(h => !/[,，]/.test(h.w)));
    if (ya.length && yb.length) out.push({ multi: [...ya, ...yb], kind: 'yure', level: 'check', want: '', msg: `金額の桁区切りの「,」のあるなしが混ざっています：あり${yen.filter(h => /[,，]/.test(h.w)).length}か所・なし${yen.filter(h => !/[,，]/.test(h.w)).length}か所` });
    // 句読点(「、。」と「，．」。日本語の文の中のものだけ)
    const ten = find(/(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])[，．]/gu), maru = find(/[、。]/g);
    const [pa, pb] = minor(ten, maru);
    const PUNCT = { '，': '、', '．': '。', '、': '，', '。': '．' };
    if (pa.length && pb.length) out.push({ multi: [...pa, ...pb], kind: 'yure', level: 'check', want: PUNCT[pa[0].w] || '', msg: `句読点の書き方が混ざっています：「、。」${maru.length}か所・「，．」${ten.length}か所` });
    return out;
  }

  // ---- 曜日のない日付で、存在しない日付(「2月30日」「4月31日」) ----
  function badDates(pages) {
    const out = [];
    for (const pg of pages) for (const m of nfkc(pg.s).matchAll(/(?:(\d{4})年\s*)?(?<!\d)(\d{1,2})月(\d{1,2})日(?!\s*[(（][日月火水木金土])/g)) {
      const y = m[1] ? +m[1] : 2024, mo = +m[2], d = +m[3];   // 年がなければ、うるう年として2月29日を認める
      if (mo < 1 || mo > 12) { out.push({ pg, i: m.index, n: m[0].length, kind: 'date', level: 'need', want: '', msg: `${mo}月という月はありません` }); continue; }
      const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      if (d < 1 || d > last) out.push({ pg, i: m.index, n: m[0].length, kind: 'date', level: 'need', want: '', msg: `${mo}月${d}日という日付はありません${m[1] ? `（${y}年）` : ''}` });
    }
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
    //   数字だけの語は見ない(カタログでは、文字データの全角・半角が見た目と合わないことが多い)。1語の中で混ざっているもの(文字データの癖)も見ない
    pages.forEach(pg => {
      for (const m of pg.s.matchAll(/[0-9A-Za-z０-９Ａ-Ｚａ-ｚ][0-9A-Za-z０-９Ａ-Ｚａ-ｚ,，.．]*/g)) {
        const k = nfkc(m[0]);
        if (!/[A-Za-z]{2,}/.test(k) || (/[0-9A-Za-z]/.test(m[0]) && /[０-９Ａ-Ｚａ-ｚ]/.test(m[0]))) continue;
        if (!words.has(k)) words.set(k, new Map());
        const v = words.get(k); if (!v.has(m[0])) v.set(m[0], []); v.get(m[0]).push({ pg, i: m.index, n: m[0].length });
      }
    });
    for (const [k, v] of words) if (v.size >= 2) out.push({ multi: [...v].sort((a, b) => (a[0] === k) - (b[0] === k)).flatMap(x => x[1]), kind: 'yure', level: 'check', want: k, msg: `全角と半角が混ざっています：${[...v].map(([w, xs]) => `「${w}」${xs.length}か所`).join('・')}` });
    return out;
  }

  // pages: [{ q: 成果物のページ番号, B: 文字データ(PC.pageText) }] → 項目 [{ q, box(pt), boxes, kind, level, show, want, msg, ctx }]
  //   tk: 形態素解析(PC.tokenizer()。読めなかったときは null で、辞書を使うチェックを行わない)
  PC.jcheck = (pages, tk) => {
    const E = edges(pages), P = pages.map(({ q, B }, n) => ({ q, B, ...textOf(B, E.skip[n]) }));
    const M2 = tk ? morph(P, tk) : P.flatMap(pg => [...pg.s.matchAll(RANUKI)].map(m => ({ pg, i: m.index, n: m[0].length, kind: 'ranuki', level: 'check', want: m[0].replace(/れ(る|ます|ません|ない|た|て)$/, 'られ$1'), msg: 'ら抜き言葉の可能性があります（「〜られる」）' })));
    let raw = [...dates(P), ...badDates(P), ...P.flatMap(parens), ...P.flatMap(pg => rules(pg, tk)), ...M2, ...P.flatMap(numbers), ...yure(P), ...(tk ? yureDict(P, tk) : []), ...mixes(P)];
    // 同じ所の同じ種類の項目は1つにする(決まった言い方の一覧と辞書の両方で見つかったもの)
    raw = raw.filter((r, k) => r.multi || !raw.some((o, j) => j < k && !o.multi && o.pg === r.pg && o.kind === r.kind && o.i < r.i + r.n && r.i < o.i + o.n));
    const out = [...E.found, ...(PC.echeck ? PC.echeck(P, E.skip) : [])];   // 英語(echeck.js)
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
    out.forEach(x => { if (x.want === x.show) x.want = ''; });   // 候補が表示する字と同じなら出さない
    return out.filter(x => x.box);
  };
})();
