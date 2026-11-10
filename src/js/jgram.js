// 文法と話し言葉(口語的な表現)のチェック(成果物だけで見る)。jcheck.js が語に分けたページ(pg.T。まとまりごとの語の並び)を使う
//   style(文体の混在): 同じまとまり(段落)の中で、「です・ます」で終わる文と「だ・である」で終わる文が混ざっているもの。
//     「。」で終わる文だけを見る(見出し・体言止め・「！」で終わる宣伝の文は見ない)。少ないほうの文を出す(同じ数なら、文書全体で少ないほう)
//   gram(文法): 二重否定(「〜ないことはない」「〜なくはない」)、1つの述語にかかる「を」の重なり(「データを処理を行う」)、
//     1つの文の逆接の「が」の重なり、同じ接続詞で始まる文の続き(「また、…。また、…。」)、「の」の3つ以上の続き(「当社の製品の保証の内容」)
//   colloq(話し言葉): い抜き言葉(「〜てる」「〜てます」)、縮約形(「〜ちゃう」「〜とく」「〜なきゃ」「〜じゃ」「〜って」)、
//     話し言葉の語(「すごく」「ちゃんと」「やっぱり」「いろんな」「こっち」「〜けど」「〜とか」「〜みたい」など)、文の頭の「なので」「でも」「だから」、
//     つなぎの言葉(「えーと」)。かぎかっこ(「」『』)の中は、話した言葉を写したもの(お客さまの声など)とみなして見ない
//   どれも確認だけ(level: 'check')。話し言葉には、書き言葉の候補を添える
'use strict';
(function () {
  const END = /^[。！？!?]$/;
  // 文に分ける: [始めの語の番号, 終わりの語の番号(含まない)]。句点(「。」「！」「？」)で区切る
  const sentences = T => { const out = []; let a = 0; T.forEach((t, k) => { if (END.test(t.surface_form)) { out.push([a, k + 1]); a = k + 1; } }); if (a < T.length) out.push([a, T.length]); return out; };
  const isAux = t => t.pos === '助動詞' || (t.pos === '動詞' && t.pos_detail_1 === '非自立') || (t.pos === '動詞' && t.pos_detail_1 === '接尾');
  // 文末の文体: { st: 'keitai'(です・ます) | 'joutai'(だ・である・用言の終わり), k: 述語の始めの語 } または null(体言止め・助詞で終わる文・「。」で終わらない文)
  function styleOf(T, a, b) {
    let k = b - 1;
    if (k < a || T[k].surface_form !== '。') return null;
    k--;
    while (k >= a && (T[k].pos === '記号' || (T[k].pos === '助詞' && T[k].pos_detail_1 === '終助詞'))) k--;   // 」・終助詞(ね・よ・か)
    if (k < a) return null;
    let j = k;
    while (j >= a && isAux(T[j])) { if (/^(です|ます)$/.test(T[j].basic_form)) return { st: 'keitai', k: Math.max(a, j - 1), e: k }; j--; }
    if (T[k].pos === '動詞' && /^(くださる|下さる)$/.test(T[k].basic_form)) return { st: 'keitai', k, e: k };
    for (let x = j + 1; x <= k; x++) if (/^(だ|である)$/.test(T[x].basic_form)) return { st: 'joutai', k: Math.max(a, j), e: k };
    const c = T[j];
    //   用言で終わる文(「使える。」「よい。」「使えない。」「楽しかった。」)。言いさしの文(「もっと楽しく。」「ぜひお試しを。」)は見ない
    if (c && (c.pos === '動詞' || c.pos === '形容詞') && (j < k || c.conjugated_form === '基本形')) return { st: 'joutai', k: j, e: k };
    return null;
  }
  // かぎかっこの中の語か(まとまりの中で数える)
  const quoted = T => { const q = new Uint8Array(T.length); let d = 0; T.forEach((t, k) => { for (const ch of t.surface_form) { if (/[「『]/.test(ch)) d++; else if (/[」』]/.test(ch)) d = Math.max(0, d - 1); } q[k] = d > 0 || /[「『]/.test(t.surface_form) ? 1 : 0; }); return q; };
  const KOSO = { こっち: 'こちら', そっち: 'そちら', あっち: 'あちら', どっち: 'どちら' };
  const WORDS = { ちゃんと: 'きちんと', やっぱり: 'やはり', やっぱ: 'やはり', あんまり: 'あまり', いっぱい: 'たくさん', いろんな: 'いろいろな', ちょっと: '少し', めっちゃ: 'とても', めちゃくちゃ: 'とても', めちゃめちゃ: 'とても', ほんと: '本当' };
  const HEAD = { なので: 'そのため', でも: 'しかし', だから: 'そのため', だけど: 'しかし', じゃあ: 'では', それじゃ: 'それでは', けど: 'しかし' };
  const FILLER = /^(えー|えーと|ええと|えっと|えと|あのー|あのう|うーん|んー)$/;   // 辞書がつなぎの言葉(フィラー)とする語のうち、これだけを見る(文の頭の「と」なども、つなぎの言葉とされることがあるため)

  PC.jgram = pages => {
    const out = [], span = (pg, a, b, kind, want, msg) => out.push({ pg, i: a.i, n: b.i + b.n - a.i, kind, level: 'check', want, msg });
    // 文体: 文書全体で多いほう(同じ数のまとまりで、どちらを出すか決めるのに使う)
    const all = { keitai: 0, joutai: 0 }, per = [];
    //   段落: まとまりの中で、文が行の終わりで終わり、次の文が行の始めから始まる所で分ける(箇条書き・1行ずつの説明を1つの段落にしないように)
    for (const pg of pages) for (const T of pg.T || []) {
      let seg = 0;
      const ss = sentences(T).map(([a, b], k, S) => { if (k > 0 && pg.ls && T[a] && pg.ls.has(T[a].i)) seg++; return { a, b, seg, s: styleOf(T, a, b) }; }).filter(x => x.s);
      for (const x of ss) all[x.s.st]++;
      for (const g of new Set(ss.map(x => x.seg))) per.push({ pg, T, ss: ss.filter(x => x.seg === g) });
    }
    for (const { pg, T, ss } of per) {
      const n = { keitai: ss.filter(x => x.s.st === 'keitai').length, joutai: ss.filter(x => x.s.st === 'joutai').length };
      if (!n.keitai || !n.joutai) continue;
      const odd = n.keitai < n.joutai ? 'keitai' : n.joutai < n.keitai ? 'joutai' : all.keitai < all.joutai ? 'keitai' : 'joutai';
      const main = odd === 'keitai' ? '「だ・である」' : '「です・ます」', mine = odd === 'keitai' ? '「です・ます」' : '「だ・である」';
      for (const x of ss) if (x.s.st === odd) span(pg, T[x.s.k], T[x.s.e], 'style', '', `同じ段落のほかの文は${main}で終わっています。この文は${mine}です（文体をそろえるか確認してください）`);
    }
    for (const pg of pages) for (const T of pg.T || []) {
      const Q = quoted(T), S = sentences(T);
      // ---- 文法 ----
      for (const [a, b] of S) {
        const ts = T.slice(a, b), at = k => T[a + k];
        // 二重否定: 単独の「ない」「なく」(助動詞・形容詞)のあとに「こと・わけ・もの(で)」「は・も」「ない・ありません」
        for (let k = 0; k < ts.length; k++) {
          const t = ts[k];
          if (!((t.pos === '助動詞' || t.pos === '形容詞') && t.basic_form === 'ない' && /^な(い|く)$/.test(t.surface_form))) continue;
          let m = k + 1;
          if (t.surface_form === 'ない') { if (ts[m] && /^(こと|わけ|もの)$/.test(ts[m].surface_form)) m++; if (ts[m] && ts[m].surface_form === 'で') m++; }
          if (!(ts[m] && /^(は|も)$/.test(ts[m].surface_form))) continue;
          const z = ts[m + 1];
          if (!z || m === k + 1 && t.surface_form === 'ない' && !(ts[m] && ts[m].surface_form === 'で')) continue;   // 「ないは」「ないも」だけのものは見ない
          const neg = (z.basic_form === 'ない' && (z.pos === '助動詞' || z.pos === '形容詞')) || (z.basic_form === 'ある' && ts[m + 2] && ts[m + 2].basic_form === 'ます' && ts[m + 3] && ts[m + 3].basic_form === 'ん');
          if (neg) { const e = z.basic_form === 'ない' ? z : ts[m + 3]; span(pg, t, e, 'gram', '', '二重否定です（「〜ないことはない」→「〜こともある」「〜できる」など、言い切れないか確認してください）'); }
        }
        // 1つの述語にかかる「を」の重なり: 2つの「を」の間に用言・読点がなく、2つ目の「を」のあとの最初の用言が、文(節)の最後の述語
        const wo = ts.map((t, k) => (t.pos === '助詞' && t.pos_detail_1 === '格助詞' && t.surface_form === 'を' ? k : -1)).filter(k => k >= 0);
        for (let p = 1; p < wo.length; p++) {
          const k1 = wo[p - 1], k2 = wo[p], mid = ts.slice(k1 + 1, k2);
          if (!mid.length) continue;   // 「をを」(助詞の重なりとして別に出す)
          if (mid.some(t => /動詞|形容詞|助動詞/.test(t.pos) || t.surface_form === '、' || t.surface_form === '，' || (t.pos === '助詞' && /^(が|は|も|と|て|ば)$/.test(t.surface_form)))) continue;
          const v = ts.findIndex((t, k) => k > k2 && t.pos === '動詞' && t.pos_detail_1 === '自立');
          if (v < 0) continue;
          if (ts.slice(v + 1).some(t => (t.pos === '動詞' && t.pos_detail_1 === '自立') || t.pos === '形容詞' || t.surface_form === '、')) continue;   // あとにほかの述語がある(「〜を通じて〜する」など)
          span(pg, ts[k1], ts[k2], 'gram', '', '1つの述語に「を」が2つかかっています（「〜の〜を」「〜を〜する」などに直せないか確認してください）');
        }
        // 逆接の「が」の重なり
        const ga = ts.filter(t => t.pos === '助詞' && t.pos_detail_1 === '接続助詞' && t.surface_form === 'が');
        if (ga.length >= 2) span(pg, ga[1], ga[1], 'gram', '', '1つの文に、逆接の「が」が2つ以上あります（文を分けられないか確認してください）');
        // 「の」の3つ以上の続き(名詞の「の」でつながる並び)
        let run = 0, from = -1;
        for (let k = 0; k < ts.length; k++) {
          const t = ts[k];
          if (t.pos === '助詞' && t.pos_detail_1 === '連体化' && t.surface_form === 'の' && k > 0 && ts[k - 1].pos === '名詞' && ts[k + 1] && /名詞|接頭詞/.test(ts[k + 1].pos)) {
            if (run === 0) { from = k - 1; while (from > 0 && /名詞|接頭詞/.test(ts[from - 1].pos)) from--; }
            run++;
            if (run === 3) { let e = k + 1; while (ts[e + 1] && ts[e + 1].pos === '名詞') e++; span(pg, ts[from], ts[e], 'gram', '', '「の」が3つ以上続いています（言い換えて読みやすくできないか確認してください）'); }
          } else if (!(t.pos === '名詞' || t.pos === '接頭詞')) run = 0;
        }
      }
      // 同じ接続詞で始まる文の続き(同じまとまりの中)
      for (let p = 1; p < S.length; p++) {
        const x = T[S[p - 1][0]], y = T[S[p][0]];
        if (x && y && x.pos === '接続詞' && y.pos === '接続詞' && x.surface_form === y.surface_form) span(pg, y, y, 'gram', '', `「${y.surface_form}」で始まる文が続いています（接続詞を変えるか、なくせないか確認してください）`);
      }
      // ---- 話し言葉 ----
      const head = new Set(S.map(([a]) => a));
      T.forEach((t, k) => {
        if (Q[k]) return;
        const n = T[k + 1] || {}, s = t.surface_form, p = T[k - 1] || {};
        const say = (want, extra) => span(pg, t, t, 'colloq', want, `話し言葉の言い方です${want ? `（書き言葉では「${want}」）` : extra ? `（${extra}）` : ''}`);
        // い抜き言葉
        if (t.pos === '動詞' && t.pos_detail_1 === '非自立' && /^(てる|でる)$/.test(t.basic_form)) return say(s.replace(/^(て|で)/, '$1い'));
        if (t.pos === '助詞' && t.pos_detail_1 === '接続助詞' && /^(て|で)$/.test(s) && n.pos === '助動詞' && /^(ます|た|ない)$/.test(n.basic_form) && p.pos === '動詞')
          return span(pg, t, n, 'colloq', s + 'い' + n.surface_form, `い抜き言葉です（書き言葉では「${s}い${n.surface_form}」）`);
        // 縮約形
        if (t.pos === '動詞' && t.pos_detail_1 === '非自立' && /^(ちゃう|じゃう)$/.test(t.basic_form)) return say(s.replace(/^ちゃ/, 'てしま').replace(/^じゃ/, 'でしま'));
        if (t.pos === '動詞' && t.pos_detail_1 === '非自立' && /^(とく|どく)$/.test(t.basic_form)) return say(s.replace(/^と/, 'てお').replace(/^ど/, 'でお'));
        if (t.pos === '助動詞' && /^(なきゃ|なけりゃ)$/.test(s)) return say('なければ');
        if (s === 'ちゃ' && t.pos === '助詞') return say('ては');
        if (s === 'じゃ' && (t.pos === '助詞' || t.pos === '助動詞')) return say('では');
        if (t.pos === '助詞' && /^っ(て|ていう|てば)$/.test(s)) return say(s === 'っていう' ? 'という' : 'と');
        if (t.pos === '助動詞' && s === 'っす') return say('です');
        if (t.pos === '助動詞' && s === 'でしょ' && !(n.surface_form || '').startsWith('う')) return say('でしょう');
        // 話し言葉の語
        if (t.pos === '形容詞' && /^(すごい|凄い)$/.test(t.basic_form)) return say('', '書き言葉では「とても」「非常に」「大変」など');
        if (t.pos === '形容詞' && /^(やばい|ヤバい)$/.test(t.basic_form)) return say('', 'くだけた言い方です');
        if (/^(マジ|まじ)$/.test(s) && t.pos === '名詞') return say('', 'くだけた言い方です');
        if (KOSO[s] && t.pos === '名詞') return say(KOSO[s]);
        if (WORDS[s] && (t.pos === '副詞' || t.pos === '連体詞' || t.pos === '名詞')) return say(WORDS[s]);
        if (t.pos === '接頭詞' && s === '超' && (n.pos === '形容詞' || n.pos_detail_1 === '形容動詞語幹')) return say('とても');
        if (t.pos === '名詞' && t.pos_detail_1 === '非自立' && s === 'みたい') return say(p.pos === '名詞' ? 'のよう' : 'よう');
        if (t.pos === '助詞' && /^(けど|けれど)$/.test(s)) return say('が');
        if (t.pos === '助詞' && s === 'とか') return say('や');
        if (t.pos === '助詞' && /^(なんか|なんて)$/.test(s)) return say('など');
        if (head.has(k) && t.pos === '接続詞' && HEAD[s]) return say(HEAD[s]);
        if ((t.pos === 'フィラー' || t.pos === '感動詞') && FILLER.test(s)) return say('', 'つなぎの言葉です');
        if (t.pos === 'フィラー' && s === 'え' && n.surface_form === 'えと') return span(pg, t, n, 'colloq', '', '話し言葉の言い方です（つなぎの言葉です）');
        if (t.pos === '感動詞' && s === 'えっ' && n.surface_form === 'と') return span(pg, t, n, 'colloq', '', '話し言葉の言い方です（つなぎの言葉です）');
      });
    }
    return out;
  };
})();
