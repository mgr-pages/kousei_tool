// 成果物だけを読んで、英語の問題がありそうな所を挙げる(原稿とは照らし合わせない。決まったルールと辞書だけで判定する)
//   直す必要がありそう: 同じ語の重なり(「the the」)・日付と曜日の食い違い・存在しない日付(「February 30」)
//   確認だけ: 辞書にない語(つづりの誤り?)・冠詞の a と an
//   辞書は SCOWL 由来の英語の辞書(Hunspell の en_US を、組み立てのときに活用形まで広げた語の一覧。id="en-words")
'use strict';
(function () {
  let WORDS = null;
  const words = () => WORDS || (WORDS = new Set(((document.getElementById('en-words') || {}).textContent || '').split('\n').filter(Boolean)));

  // 英語を読むための文字列。文字データからは空白を除いてあるため、元の空白(sp)・字の間のすきま・行の変わり目から語の切れ目を戻す
  //   行末のハイフンで切れた語(「collec-」「tion」)はつなぐ。at: 文字列の位置 → 文字の番号(戻した空白は -1)
  function englishText(B, skip) {
    let s = ''; const at = [];
    for (const [a, e] of PC.blocksOf(B.chars, B.items)) {
      let p = null;
      for (let i = a; i < e; i++) {
        const c = B.chars[i];
        if (skip.has(c.it)) continue;
        if (p) {
          // 同じ文字列のまとまりの中は元の空白だけで切る(字の枠は描画に合わせて縮めてあり、字の間のすきまは語の切れ目にならない)。
          //   まとまりの間は、行が変わるか、字の大きさの2割より広いすきまで切る
          const h = Math.max(1, Math.min(p.box[3] - p.box[1], c.box[3] - c.box[1])), size = (B.items[c.it] || {}).size || h;
          const same = Math.min(p.box[3], c.box[3]) - Math.max(p.box[1], c.box[1]) > 0.3 * h;
          if (p.it !== c.it && !same && p.c === '-' && /[A-Za-z]/.test(s[s.length - 2] || '') && /[a-z]/.test(c.c)) { s = s.slice(0, -1); at.pop(); }
          else if (c.sp || (p.it !== c.it && (!same || c.box[0] - p.box[2] > 0.2 * size))) { s += ' '; at.push(-1); }
        }
        for (const ch of c.c) { s += ch; at.push(i); }
        p = c;
      }
      s += '\n'; at.push(-1);
    }
    // URL・メールアドレスは読まない(同じ長さの空白にする)
    const masked = s.replace(/(?:https?:\/\/|www\.)\S+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\b[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|jp|co|info|biz|io)\b\S*/gi, m => ' '.repeat(m.length));
    return { s: masked, at };
  }

  const isCap = w => /^[A-Z][a-z]+$/.test(w), isAll = w => /^[A-Z]+$/.test(w);
  // ローマ字の日本語(「Kousei」「Shinjuku」など。辞書にない大文字で始まる語は、固有名詞として読まない)
  const ROMAJI = /^(?:(?:ky|gy|sh|ch|ts|ny|hy|by|py|my|ry|[kgsztdnhbpmyrwfj])?[aiueo]|n|[kgstdhbpmrjc](?=[kgstdhbpmrjc]))+$/;
  function known(w) {
    const W = words(), lw = w.toLowerCase();
    if (W.has(w)) return true;
    if ((isCap(w) || isAll(w)) && W.has(lw)) return true;
    if (isAll(w) && W.has(lw[0].toUpperCase() + lw.slice(1))) return true;
    return false;
  }
  // 1字違いで辞書にある語(候補)。同じ字が並ぶ所での1字の抜け・余り、字の抜け・余り、入れ替わり、置き換わりの順に。頭の字が同じものを先に
  function suggest(w) {
    const lw = w.toLowerCase(), W = words(), ab = 'abcdefghijklmnopqrstuvwxyz', out = new Map();
    const add = (c, score) => { if (c !== lw && W.has(c) && (!out.has(c) || out.get(c) > score)) out.set(c, score + (c[0] === lw[0] ? 0 : 0.5)); };
    for (let i = 0; i <= lw.length; i++) for (const ch of ab) add(lw.slice(0, i) + ch + lw.slice(i), ch === lw[i - 1] || ch === lw[i] ? 0 : 1);
    for (let i = 0; i < lw.length; i++) add(lw.slice(0, i) + lw.slice(i + 1), lw[i] === lw[i - 1] || lw[i] === lw[i + 1] ? 0 : 1);
    for (let i = 0; i + 1 < lw.length; i++) add(lw.slice(0, i) + lw[i + 1] + lw[i] + lw.slice(i + 2), 2);
    for (let i = 0; i < lw.length; i++) for (const ch of ab) add(lw.slice(0, i) + ch + lw.slice(i + 1), 3);
    const best = [...out].sort((a, b) => a[1] - b[1])[0];
    if (!best) return '';
    return isCap(w) ? best[0][0].toUpperCase() + best[0].slice(1) : isAll(w) ? best[0].toUpperCase() : best[0];
  }

  const WDS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], JWD = ['日', '月', '火', '水', '木', '金', '土'];
  const MONS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const WD = '(Sunday|Sun|Monday|Mon|Tuesday|Tues|Tue|Wednesday|Wed|Thursday|Thurs|Thur|Thu|Friday|Fri|Saturday|Sat)\\.?';
  const MO = '(January|Jan|February|Feb|March|Mar|April|Apr|May|June|Jun|July|Jul|August|Aug|September|Sept|Sep|October|Oct|November|Nov|December|Dec)\\.?';
  const DAY = '(\\d{1,2})(?:st|nd|rd|th)?', YEAR = '(?:,?\\s+(\\d{4}))?';
  const wdOf = w => WDS.findIndex(x => x.toLowerCase().startsWith(w.toLowerCase().slice(0, 3))), moOf = m => MONS.findIndex(x => x.toLowerCase().startsWith(m.toLowerCase().slice(0, 3)));
  //   書いた形にそろえた曜日(「Mon」→「Tue」、「Monday」→「Tuesday」)
  const styleWd = (w, k) => { const f = WDS[k]; return w.length <= 4 ? (w.length === 4 && /^Tu|^Th/.test(f) ? f.slice(0, 4) : f.slice(0, 3)) : f; };

  const FUNC = new Set(['the', 'a', 'an', 'to', 'of', 'in', 'on', 'at', 'for', 'and', 'or', 'is', 'are', 'was', 'were', 'be', 'with', 'by', 'from', 'as', 'it', 'this', 'we', 'you', 'your', 'our', 'will', 'can']);
  const REPEAT_OK = new Set(['had', 'that', 'bye', 'very', 'so', 'no', 'ha', 'la', 'ta', 'knock', 'chop', 'aye', 'tut', 'boo', 'pom', 'wow', 'yeah', 'go', 'run', 'hey', 'oh', 'ho', 'hip', 'yum']);
  // 冠詞の a・an: 母音の音で始まるか(分からないときは null)
  function vowelSound(w) {
    const l = w.toLowerCase();
    if (/^(hour|honest|honou?r|heir)/.test(l)) return true;
    if (/^(uni|use|usu|uti|ure|uro|ura|uri|ubi|uk|eu|ewe|one|once)/.test(l)) return false;
    if (/^u/.test(l)) return null;
    return /^[aeio]/.test(l);
  }

  // P: [{ q, B }]、skip: ページごとの読まないまとまり(ページの端の切れ端など)の番号 → 項目 [{ q, box, kind, level, show, want, msg, ctx }]
  PC.echeck = (P, skip) => {
    if (!words().size) return [];
    const out = [], views = P.map(({ B }, n) => englishText(B, skip[n]));
    const push = (n, i, len, kind, level, want, msg) => {
      const { s, at } = views[n], js = at.slice(i, i + len).filter(j => j >= 0);
      if (!js.length) return;
      out.push({ q: P[n].q, box: PC.union(js.map(j => P[n].B.chars[j].box)), kind, level, show: s.substr(i, len), want, msg, ctx: [s.slice(Math.max(0, i - 12), i).replace(/^.*\n/s, ''), s.slice(i + len, i + len + 12).replace(/\n.*$/s, '')] });
    };
    // 成果物全体での語の数(何度も出てくる辞書にない語は、商品名・固有名詞として読まない)
    const cnt = new Map();
    views.forEach(v => { for (const m of v.s.matchAll(/[A-Za-z]+/g)) cnt.set(m[0].toLowerCase(), (cnt.get(m[0].toLowerCase()) || 0) + 1); });
    // 年(年の書いていない英語の日付は、成果物にいちばん多く出てくる年で計算する)
    const years = new Map(); views.forEach(v => { for (const m of v.s.matchAll(/(?<!\d)(19|20)\d{2}(?!\d)/g)) years.set(+m[0], (years.get(+m[0]) || 0) + 1); });
    const yDoc = [...years].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0], now = new Date().getFullYear();

    views.forEach(({ s }, n) => {
      // 辞書にない語(つづりの誤り?)。ハイフンでつないだ語は分けて調べる。2字以下・大文字だけの5字以下(略語)・途中に大文字がある語(商品名)・数字に続く語(品番)、
      //   成果物に3回以上出てくる語・カタカナの読みや®・™が付いた語(名前)、大文字で始まるローマ字の語(日本の固有名詞)は見ない
      for (const m of s.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)*(?:-[A-Za-z]+(?:['’][A-Za-z]+)*)*/g)) {
        const prev = s[m.index - 1] || '', next = s[m.index + m[0].length] || '';
        if (/[0-9_#@&]/.test(prev) || /[0-9_@]/.test(next) || (prev === '-' && /\d/.test(s[m.index - 2] || '')) || (next === '-' && /\d/.test(s[m.index + m[0].length + 1] || ''))) continue;
        // 名前の印: すぐあとにカタカナの読みのかっこ(「Lumora（ルモラ）」)、または ®・™ が付いている
        if (/^\s*(?:[（(][\p{Script=Katakana}ー・\s]+[）)]|[®™])/u.test(s.slice(m.index + m[0].length, m.index + m[0].length + 30))) continue;
        let off = 0;
        for (const part of m[0].split('-')) {
          const w = part.replace(/['’]s$/, '').replace(/’/g, "'");
          const at0 = m.index + off; off += part.length + 1;
          if (w.replace(/'/g, '').length < 3 || /[a-z][A-Z]/.test(w) || (isAll(w) && w.length <= 5) || known(w)) continue;
          if (/'/.test(w) && known(w.split("'")[0])) continue;
          if ((isCap(w) || isAll(w)) && ROMAJI.test(w.toLowerCase())) continue;
          if ((cnt.get(w.toLowerCase().replace(/'.*$/, '')) || 0) >= 3) continue;
          const want = suggest(w);
          push(n, at0, w.length, 'spell', 'check', want, `辞書にない英単語です（つづりの誤りでないか確認。固有名詞・商品名なら問題ありません）${want ? `。候補：「${want}」` : ''}`);
        }
      }
      // 同じ語の重なり(「the the」)。よく使う短い語は直す必要がありそう、それ以外は確認だけ(「had had」「that that」など正しいものは除く)
      for (const m of s.matchAll(/(?<![A-Za-z])([A-Za-z]+)[ \t]+\1(?![A-Za-z])/gi)) {
        const w = m[1].toLowerCase();
        if (REPEAT_OK.has(w) || w.length < 1 || /^[A-Z]$/.test(m[1])) continue;
        push(n, m.index, m[0].length, 'dup', FUNC.has(w) ? 'need' : 'check', m[1], `「${m[1]}」が2回続いています`);
      }
      // 冠詞の a と an(文の始めの「A」「An」と、小文字の「a」「an」だけを見る。略語・数字に続くものは見ない)
      for (const m of s.matchAll(/(?<![A-Za-z'’-])(a|an|A|An)[ \t]+([A-Za-z][A-Za-z'’-]*)/g)) {
        if (/^[A]/.test(m[1]) && !/(^|[.!?:]\s*|\n)$/.test(s.slice(0, m.index))) continue;
        const w = m[2], next = s[m.index + m[0].length] || '';
        if (isAll(w) || /\d/.test(next) || w.length < 2) continue;
        const v = vowelSound(w); if (v === null) continue;
        const an = m[1].toLowerCase() === 'an';
        if (an !== v) push(n, m.index, m[0].length, 'article', 'check', (an ? 'a' : 'an') + ' ' + w, `「${w}」の前の冠詞は「${an ? 'a' : 'an'}」ではないか確認してください`);
      }
      // 日付と曜日(「Monday, October 26, 2027」「Oct. 26 (Mon)」「Monday 26 October」)・存在しない日付
      const RES = [[new RegExp(`\\b${WD},?\\s+${MO}\\s+${DAY}${YEAR}\\b`, 'gi'), m => ({ w: m[1], mo: m[2], d: m[3], y: m[4], wi: m[0].indexOf(m[1]) })],
        [new RegExp(`\\b${MO}\\s+${DAY}${YEAR}\\s*[,(（]?\\s*${WD}\\s*[)）]?`, 'gi'), m => ({ w: m[4], mo: m[1], d: m[2], y: m[3], wi: m[0].lastIndexOf(m[4]) })],
        [new RegExp(`\\b${WD},?\\s+${DAY}\\s+${MO}${YEAR}\\b`, 'gi'), m => ({ w: m[1], d: m[2], mo: m[3], y: m[4], wi: m[0].indexOf(m[1]) })]];
      const seen = [], inSeen = i => seen.some(([a, b]) => a <= i && i < b);
      for (const [re, get] of RES) for (const m of s.matchAll(re)) {
        if (inSeen(m.index)) continue; seen.push([m.index, m.index + m[0].length]);
        const g = get(m), mo = moOf(g.mo), d = +g.d, wd = wdOf(g.w);
        if (mo < 0 || wd < 0) continue;
        const ys = g.y ? [+g.y] : yDoc ? [yDoc[0]] : [now, now + 1];
        const dt = y => new Date(Date.UTC(y, mo, d));
        if (dt(ys[0]).getUTCMonth() !== mo) { push(n, m.index, m[0].length, 'date', 'need', '', `${MONS[mo]} ${d}（${mo + 1}月${d}日）という日付はありません`); continue; }
        if (ys.some(y => dt(y).getUTCDay() === wd)) continue;
        const y = ys[0], real = dt(y).getUTCDay();
        push(n, m.index + g.wi, g.w.length, 'date', 'need', styleWd(g.w, real), `${g.y ? '' : `（年の書いていない日付は${y}年として計算）`}${y}年${mo + 1}月${d}日は${JWD[real]}曜日（${WDS[real]}）です`);
      }
      // 曜日のない存在しない日付(「February 30」「30 February」)
      for (const m of s.matchAll(new RegExp(`\\b${MO}\\s+${DAY}\\b(?!\\s*[,(（]?\\s*${WD})|\\b${DAY}\\s+${MO}`, 'gi'))) {
        const mo = moOf(m[1] || m[4]), d = +(m[2] || m[3]);
        if (mo < 0 || !d || inSeen(m.index)) continue;
        // 年がないので、うるう年として2月29日を認める
        if (new Date(Date.UTC(2024, mo, d)).getUTCMonth() !== mo) push(n, m.index, m[0].length, 'date', 'need', '', `${MONS[mo]} ${d}（${mo + 1}月${d}日）という日付はありません`);
      }
    });
    return out;
  };
})();
