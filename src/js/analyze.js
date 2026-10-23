// 照合の本体: 初校 × 朱書き(紙スキャン/デジタル注釈) × 修正後 → 要確認箇所の一覧
'use strict';
(function () {
  const { ov, union } = PC;
  PC.CAT = {
    A: '赤字あり・変更あり（内容を人が確認）', A_IMG: '赤字あり・画像の変更あり（人が確認）',
    B: '赤字あり・変更なし（修正漏れの疑い）', B2: '続きの赤字（軽）',
    C1: '全体指示・以下同様で説明できる変更', C2: '指示外の変更（文字・組み）', C3: '指示外の変更（画像・図版・色・位置）',
    D: '全体指示・以下同様の展開', E: '見た目では差が出ない文字データの変更',
    F: '指示箇所に結びつかない赤字（人が読む）', F2: '引き出し線・注記（指示箇所に付随）', G: '全体指示として読み取った注記',
    M: 'ママ・イキ（変更しない指示）どおり変更なし',
  };
  const KEEP = /ママ|イキ/;

  // 枠に中心が入る文字をつなげる(PyMuPDFのget_textboxに相当)
  const textIn = (cs, b) => b ? cs.filter(([, r]) => { const cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2; return cx >= b[0] && cx <= b[2] && cy >= b[1] && cy <= b[3]; }).map(c => c[0]).join('') : '';
  // 修正後の文字データを読み順に並べ、枠に重なる文字の前後pad字までをつなげる(行の折り返しをまたぐ語も確認できる)
  function around(cs, b, pad) {
    const idx = [];
    cs.forEach(([, r], i) => { const cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2; if (cx >= b[0] - 12 && cx <= b[2] + 12 && cy >= b[1] - 12 && cy <= b[3] + 12) idx.push(i); });
    if (!idx.length) return '';
    return cs.slice(Math.max(0, Math.min(...idx) - pad), Math.min(cs.length, Math.max(...idx) + pad + 1)).map(c => c[0]).join('').replace(/\s/g, '');
  }
  // 字形(トークン)に対応する文字: 中心が字形に入る文字 → 字形の中心を含む文字 → 近くの文字
  function tokText(cs, box) {
    const [x0, y0, x1, y1] = box, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const inside = cs.filter(([, b]) => x0 - 2 <= (b[0] + b[2]) / 2 && (b[0] + b[2]) / 2 <= x1 + 2 && y0 - 2 <= (b[1] + b[3]) / 2 && (b[1] + b[3]) / 2 <= y1 + 2);
    if (inside.length) return inside.map(c => c[0]).join('');
    const cont = cs.filter(([, b]) => b[0] - 1 <= cx && cx <= b[2] + 1 && b[1] - 1 <= cy && cy <= b[3] + 1);
    if (cont.length) return cont.reduce((p, q) => ((q[1][2] - q[1][0]) * (q[1][3] - q[1][1]) < (p[1][2] - p[1][0]) * (p[1][3] - p[1][1]) ? q : p))[0];
    let best = null, bd = Infinity;
    for (const c of cs) { const d = ((c[1][0] + c[1][2]) / 2 - cx) ** 2 + ((c[1][1] + c[1][3]) / 2 - cy) ** 2; if (d < bd) { bd = d; best = c; } }
    return best && Math.abs((best[1][0] + best[1][2]) / 2 - cx) < 40 && Math.abs((best[1][1] + best[1][3]) / 2 - cy) < 40 ? best[0] : '';
  }

  // 文字の並び(コードポイント単位)の中から、文字列sの出現位置をすべて探す
  function findAll(cs, s) {
    const target = [...s], n = target.length, out = [];
    if (!n) return out;
    for (let i = 0; i + n <= cs.length; i++) { let ok = true; for (let k = 0; k < n && ok; k++) ok = cs[i + k][0] === target[k]; if (ok) out.push([i, i + n]); }
    return out;
  }

  // 初校と修正後で字形の並びがまったく同じブロック(位置が近いもの同士を組にする)
  function sameBlocks(ot, ol, nt, nl, oids, nids) {
    const perBlock = (T, L, ids) => {
      const d = new Map();
      T.forEach((t, k) => { const key = L[t.line].blk.join(','); if (!d.has(key)) d.set(key, { box: L[t.line].blk, ks: [] }); d.get(key).ks.push(k); });
      for (const v of d.values()) v.seq = v.ks.map(k => ids[k]).join(',');
      return d;
    };
    const ob = perBlock(ot, ol, oids), nb = perBlock(nt, nl, nids), so = new Set(), sn = new Set(), uo = new Set(), un = new Set();
    const c = b => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], cand = [];
    for (const [bk, b] of ob) for (const [nk, n] of nb) if (b.seq === n.seq) cand.push([Math.hypot(c(b.box)[0] - c(n.box)[0], c(b.box)[1] - c(n.box)[1]), bk, nk]);
    cand.sort((p, q) => p[0] - q[0] || (p[1] < q[1] ? -1 : p[1] > q[1] ? 1 : 0) || (p[2] < q[2] ? -1 : p[2] > q[2] ? 1 : 0));
    for (const [, bk, nk] of cand) {
      if (uo.has(bk) || un.has(nk)) continue;
      uo.add(bk); un.add(nk); ob.get(bk).ks.forEach(k => so.add(k)); nb.get(nk).ks.forEach(k => sn.add(k));
    }
    return [so, sn];
  }

  // 文字は同じだが、段落の始まり(改行・追い込み・字下げ)が変わった箇所
  function layoutChanges(ot, ol, nt, nl, pairs) {
    const out = [], fo = new Map(), fn = new Map();
    ol.forEach(l => { if (l.toks.length) fo.set(l.toks[0], l); }); nl.forEach(l => { if (l.toks.length) fn.set(l.toks[0], l); });
    for (const [k, m] of pairs) {
      const po = fo.has(k) && fo.get(k).para, pn = fn.has(m) && fn.get(m).para;
      if (po !== pn) out.push({ kind: 'text', tag: 'layout', oi: [k, k + 1], nj: [m, m + 1], obox: ot[k].box, nbox: nt[m].box, show: pn ? '（改行・段落の追加）' : '（追い込み・段落の解除）', before: '', after: '', nline: '' });
    }
    return out;
  }

  // 表示用の画像(初校＋赤字を薄く／修正後を薄く)をJPEGにして手放す
  async function toThumb(img) {
    const c = PC.toCanvas(img);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    return { url: URL.createObjectURL(blob), w: img.w, h: img.h };
  }

  // opts: { oldDoc, newDoc, mode: 'scan'|'digital'|'none', scans(PC.scanSource), annDoc, rules, progress(msg, frac) }
  PC.analyze = async opts => {
    const { oldDoc, newDoc, mode } = opts, prog = opts.progress || (() => {});
    const rules = (opts.rules || []).map(r => ({ ...r })), cb = new PC.Codebook(), P = [], npages = oldDoc.numPages;
    for (let p = 0; p < npages; p++) {
      const step = (s, f) => prog(`${p + 1} / ${npages} ページ：${s}`, (p + f) / npages);
      step('描画', 0.02); await PC.tick();
      const old = await PC.renderPage(oldDoc, p, PC.DPI, false);
      const nw = p < newDoc.numPages ? await PC.renderPage(newDoc, p, PC.DPI, false) : { w: old.w, h: old.h, d: new Uint8ClampedArray(old.d.length).fill(255) };
      const oc = await PC.textChars(oldDoc, p), nc = p < newDoc.numPages ? await PC.textChars(newDoc, p) : [];
      step('文字のまとまりを解析', 0.1); await PC.tick();
      const oink = PC.textInk(old), nink = PC.textInk(nw);
      const ob = PC.blocks(old, oink), nb = PC.blocks(nw, nink);
      const { toks: ot, lines: ol } = PC.tokens(old, oink, ob), { toks: nt, lines: nl } = PC.tokens(nw, nink, nb);
      step('字形を照合', 0.25); await PC.tick();
      const oids = [], nids = [];
      for (let k = 0; k < ot.length; k++) { oids.push(cb.id(old, ot[k], ol[ot[k].line])); if (k % 80 === 79) await PC.tick(); }
      for (let k = 0; k < nt.length; k++) { nids.push(cb.id(nw, nt[k], nl[nt[k].line])); if (k % 80 === 79) await PC.tick(); }
      step('変更箇所を検出', 0.55); await PC.tick();
      const sk = sameBlocks(ot, ol, nt, nl, oids, nids), lookPairs = [], ch = PC.textChanges(cb, ot, nt, oids, nids, old, nw, ol, nl, sk, lookPairs);
      const oi_ = [], ni_ = []; for (let k = 0; k < oids.length; k++) if (!sk[0].has(k)) oi_.push(k); for (let k = 0; k < nids.length; k++) if (!sk[1].has(k)) ni_.push(k);
      const pairs = PC.pairs(oi_.map(k => oids[k]), ni_.map(k => nids[k])).map(([a, b]) => [oi_[a], ni_[b]]);
      if (sk[0].size === sk[1].size) { const a = [...sk[0]].sort((x, y) => x - y), b = [...sk[1]].sort((x, y) => x - y); a.forEach((k, i) => pairs.push([k, b[i]])); }
      const ePairs = [...pairs, ...lookPairs];   // 文字データでの裏取りは、見た目が同じとした組すべてで行う
      const merged = [];   // 同じ行で1字以内に隣接する差分は1件にまとめる
      for (const c of ch) {
        const q = merged[merged.length - 1];
        if (q && c.oi[0] - q.oi[1] <= 1 && c.nj[0] - q.nj[1] <= 1 && q.oi[1] > 0 && c.oi[0] < ot.length && ot[c.oi[0]].line === ot[q.oi[1] - 1].line) {
          q.oi = [q.oi[0], c.oi[1]]; q.nj = [q.nj[0], c.nj[1]]; q.tag = 'replace';
          q.obox = union([q.obox, c.obox].filter(Boolean)); q.nbox = union([q.nbox, c.nbox].filter(Boolean));
        } else merged.push(c);
      }
      const tt = (cs, T, a, b) => { let s = ''; for (let k = Math.max(0, a); k < Math.min(T.length, b); k++) s += tokText(cs, T[k].box); return s; };
      for (const c of merged) {
        if (!c.obox) { const k = Math.max(0, c.oi[0] - 1), b = ot[k].box; c.obox = ol[ot[k].line].vert ? [b[0], b[3] - 3, b[2], b[3] + 3] : [b[2] - 3, b[1], b[2] + 3, b[3]]; }
        if (!c.nbox && (c.pj !== null || c.nj[0] < nt.length)) {
          if (c.pj !== null) { const b = nt[c.pj].box; c.nbox = nl[nt[c.pj].line].vert ? [b[0], b[3] - 3, b[2], b[3] + 3] : [b[2] - 3, b[1], b[2] + 3, b[3]]; }
          else { const b = nt[c.nj[0]].box; c.nbox = nl[nt[c.nj[0]].line].vert ? [b[0], b[1] - 3, b[2], b[1] + 3] : [b[0] - 3, b[1], b[0] + 3, b[3]]; }
        }
        c.kind = 'text';
        c.before = tt(oc, ot, c.oi[0], c.oi[1]); c.after = tt(nc, nt, c.nj[0], c.nj[1]);
        c.show = `${tt(oc, ot, c.oi[0] - 1, c.oi[1] + 1)}→${tt(nc, nt, c.nj[0] - 1, c.nj[1] + 1)}`;
        c.nline = nl.filter(l => l.toks.length && c.nbox && ov(l.box, c.nbox)).map(l => tt(nc, nt, l.toks[0], l.toks[l.toks.length - 1] + 1)).join('');
      }
      merged.push(...layoutChanges(ot, ol, nt, nl, pairs));
      const im = PC.imageChanges(old, nw, ob, nb);
      for (const c of im) c.show = { changed: '画像・図版の変化', moved: '画像・図版の移動', removed: '画像・図版の削除' }[c.kind];

      step('赤字を読み取り', 0.7); await PC.tick();
      let rm, shown, notes = [];
      const scan = mode === 'scan' ? await opts.scans.get(p) : null;
      if (scan) ({ rm, shown } = PC.fromScan(scan, old));
      else if (mode === 'digital' && p < opts.annDoc.numPages) {
        notes = await PC.annotations(opts.annDoc, p);
        const withA = await PC.renderPage(opts.annDoc, p, PC.DPI, true), without = await PC.renderPage(opts.annDoc, p, PC.DPI, false);
        ({ rm, shown } = PC.fromAnnots(withA, without, notes));
      } else { rm = new Uint8Array(old.w * old.h); shown = old; }
      const { an, used } = PC.anchors(rm, old.w, old.h, ol.filter(l => l.toks.length), ot, ob.filter(b => b.kind === 'image'));
      for (const n of notes) {   // デジタルの挿入注釈は位置情報から直接読む
        if (n.type !== 'Caret') continue;
        const [x0, y0, x1] = n.box;
        for (const l of ol) {
          const lb = l.box, h = lb[3] - lb[1];
          if (!l.vert && lb[1] - 0.3 * h <= y0 && y0 <= lb[3] + 0.6 * h && lb[0] <= x0 && x0 <= lb[2]) {
            const ks = l.toks.filter(k => (x0 - h / 2 <= ot[k].box[2] && ot[k].box[2] <= x1 + h / 2) || (x0 - h / 2 <= ot[k].box[0] && ot[k].box[0] <= x1 + h / 2));
            if (ks.length) { an.push({ kind: 'insert', at: Math.min(...ks) + 1, span: [Math.min(...ks), Math.max(...ks) + 1], how: '挿入(注釈)', box: n.box.map(Math.trunc), stroke: -1, note: n.text }); break; }
          }
        }
      }
      // 取り消し線・下線・マーカーの注釈: 引いた範囲に重なる字形を指示箇所にする
      const MK = { StrikeOut: '取消線(注釈)', Underline: '下線(注釈)', Squiggly: '波線(注釈)', Highlight: 'マーカー(注釈)' };
      for (const n of notes) {
        if (!PC.MARKUP.has(n.type) || !n.quads.length) continue;
        const area = b => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]), inter = (p, q) => area([Math.max(p[0], q[0]), Math.max(p[1], q[1]), Math.min(p[2], q[2]), Math.min(p[3], q[3])]);
        const toks = new Set(); ot.forEach((t, k) => { if (n.quads.some(q => inter(t.box, q) >= 0.4 * area(t.box))) toks.add(k); });
        const box = union(n.quads).map(Math.trunc);
        if (toks.size) an.push({ kind: 'tokens', toks, how: MK[n.type], box, stroke: -1, note: n.text });
        else if (ob.some(b => b.kind === 'image' && ov(b.box, box))) an.push({ kind: 'image', how: MK[n.type], box, stroke: -1, note: n.text });
      }
      for (const a of an) if (a.note === undefined) a.note = (notes.find(n => n.type !== 'Caret' && ov(n.box, a.box, 8)) || {}).text || (notes.find(n => n.type === 'Caret' && ov(n.box, a.box, 2)) || {}).text || '';
      // 指示に使われなかった赤字のまとまり(注記・印鑑など)
      const rest = new Uint8Array(rm.length); for (let k = 0; k < rm.length; k++) rest[k] = rm[k] && !used[k] ? 1 : 0;
      const rc = PC.cc(PC.morph(rest, old.w, old.h, 'dilate', 25, 25), old.w, old.h), restBoxes = [];
      for (let j = 1; j < rc.n; j++) {
        const s = rc.st[j], b = [s.x0, s.y0, s.x1 + 1, s.y1 + 1]; let cnt = 0;
        for (let y = b[1]; y < b[3]; y++) for (let x = b[0]; x < b[2]; x++) if (rest[y * old.w + x]) cnt++;
        if (cnt >= 60) restBoxes.push(b);
      }
      step('表示用の画像を作成', 0.9); await PC.tick();
      const blend = img => { const d = new Uint8ClampedArray(img.d.length); for (let k = 0; k < d.length; k++) d[k] = (k & 3) === 3 ? 255 : Math.round(img.d[k] * 0.55 + 255 * 0.45); return { w: img.w, h: img.h, d }; };
      const thumbs = { left: await toThumb(blend(shown)), right: await toThumb(blend(nw)) };
      P.push({ ot, ol, nt, nl, ch: merged, im, an, notes, pairs: ePairs, oc, nc, restBoxes, thumbs });
    }

    if (window.__pcDebug) PC._last = P;   // 自動テストでの調査用
    prog('照合', 0.97); await PC.tick();
    // 照合: 変更 × 赤字の指示箇所
    const meets = (set, a, b) => { for (let k = a; k < b; k++) if (set.has(k)) return true; return false; };
    for (const d of P) {
      for (const a of d.an) a.hit = [];
      for (const c of [...d.ch, ...d.im]) {
        c.status = null;
        for (const a of d.an) {
          if (KEEP.test(a.note || '') && a.kind === 'tokens' && c.kind === 'text' && meets(a.toks, c.oi[0], Math.max(c.oi[1], c.oi[0] + 1))) { a.hit.push(c); continue; }
          let m = false;
          if (c.kind === 'text' && a.kind === 'tokens') { const [lo, hi] = c.oi; m = meets(a.toks, lo - (c.tag === 'layout' ? 1 : 0), Math.max(hi, lo + 1)); }
          else if (c.kind === 'text' && a.kind === 'insert') { const [lo, hi] = a.span || [a.at - 1, a.at + 1]; m = (lo <= c.oi[0] && c.oi[0] <= hi) || (lo <= c.oi[1] && c.oi[1] <= hi); }
          else if (c.kind !== 'text' && a.kind === 'image') m = ov(c.obox, a.box, 5);
          if (m) { c.status = c.kind === 'text' ? 'A' : 'A_IMG'; c.anchor = a; a.hit.push(c); }
        }
      }
    }

    // 以下同様・全体指示の展開
    const occCache = new Map();
    const occurrences = s => {
      if (!occCache.has(s)) {
        const res = [];
        P.forEach((d, q) => { for (const [i, e] of findAll(d.oc, s)) res.push([q, union(d.oc.slice(i, e).map(c => c[1]))]); });
        occCache.set(s, res);
      }
      return occCache.get(s);
    };
    const expansions = [];
    const expand = (src, frm, to, scope, origin) => {
      for (const [q, r] of occurrences(frm)) {
        if (src && q === src[0] && ov(r, src[1], 2)) continue;
        const hitc = P[q].ch.find(c => c.tag !== 'layout' && ov(c.obox, r, 2));
        let st = hitc && hitc.nline.includes(to) ? '展開済み' : (hitc ? '別の変更あり' : '変更なし（展開漏れの候補）');
        if (hitc && st === '展開済み' && hitc.status === null) { hitc.status = 'C1'; hitc.why = origin; }
        if (scope === 'after' && src && (q < src[0] || (q === src[0] && (r[1] < src[1][1] || (r[1] === src[1][1] && r[0] < src[1][0]))))) st += '（指示より前なので対象外の可能性）';
        expansions.push({ page: q + 1, frm, to, status: st, origin, box: r.map(Math.trunc) });
      }
    };
    P.forEach((d, p) => {
      for (const a of d.an) for (const c of a.hit) {
        if (c.kind !== 'text' || !c.before || c.tag === 'layout') continue;
        const scope = (a.note || '').includes('以下同様') ? 'after' : 'candidate';
        if (scope === 'candidate' && !(c.after && [...c.before].length >= 2 && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]/u.test(c.before))) continue;
        expand([p, c.obox], c.before, c.after, scope, scope === 'after' ? '以下同様' : '同じ語の他の箇所（以下同様の候補）');
      }
    });
    for (const d of P) for (const n of d.notes) {
      const m = n.text.match(/「(.+?)」\s*(?:→|を)\s*「(.+?)」/);
      if (m && n.text.includes('全体')) { rules.push({ frm: m[1], to: m[2], src: '注釈' }); n.rule = true; }
    }
    for (const r of rules) if (r.frm) expand(null, r.frm, r.to, 'all', '全体指示');
    const remain = [];
    for (const r of rules) {
      if (!r.frm) continue;
      P.forEach((d, q) => { for (const [i, e] of findAll(d.nc, r.frm)) remain.push({ page: q + 1, frm: r.frm, box: union(d.nc.slice(i, e).map(c => c[1])).map(Math.trunc) }); });
    }

    // 文字データでの裏取り: 見た目で「同じ」と対応づいた字形どうしで、文字データが違うもの
    const lookalike = [];
    P.forEach((d, p) => {
      // 文字データを字形に割り当てる: 字形の枠に中心が入る文字、なければ同じ行の中で字形の幅(縦組みは高さ)に入る文字
      const owner = (cs, T, L) => {
        const res = new Map();
        for (const [c, b] of cs) {
          const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
          let k = T.findIndex(t => t.box[0] - 2 <= cx && cx <= t.box[2] + 2 && t.box[1] - 2 <= cy && cy <= t.box[3] + 2);
          if (k < 0) k = T.findIndex(t => { const l = L[t.line]; return l.vert ? (t.box[1] - 2 <= cy && cy <= t.box[3] + 2 && l.box[0] <= cx && cx <= l.box[2]) : (t.box[0] - 2 <= cx && cx <= t.box[2] + 2 && l.box[1] <= cy && cy <= l.box[3]); });
          if (k >= 0) res.set(k, (res.get(k) || '') + c);
        }
        return res;
      };
      const oo = owner(d.oc, d.ot, d.ol), no = owner(d.nc, d.nt, d.nl);
      for (const [k, m] of d.pairs) if (oo.has(k) && no.has(m) && oo.get(k) !== no.get(m) && !d.ch.some(c => ov(d.ot[k].box, c.obox, 2))) lookalike.push({ page: p + 1, show: `${oo.get(k)}→${no.get(m)}`, box: d.ot[k].box });
    });

    // 初校の枠に対応する修正後の枠(見た目で対応づいた字形の組から求める)
    const mapBox = (d, box) => {
      if (!d.pmap) d.pmap = new Map(d.pairs);
      const ks = []; d.ot.forEach((t, k) => { if (ov(t.box, box)) ks.push(k); });
      const nb = ks.filter(k => d.pmap.has(k)).map(k => d.nt[d.pmap.get(k)].box);
      return nb.length ? union(nb) : null;
    };
    const tokBox = (d, k) => (d.pmap || (d.pmap = new Map(d.pairs))).has(k) ? d.nt[d.pmap.get(k)].box : null;
    // 結果の一覧
    const F = [];
    const add = (page, cat, box, show = '', how = '', note = '', check = '', nbox = null) => F.push({ id: F.length, page, cat, label: PC.CAT[cat], box: box.map(Math.trunc), nbox: nbox ? nbox.map(Math.trunc) : null, show, how, note, check });
    P.forEach((d, p) => {
      for (const c of [...d.ch, ...d.im]) {
        const st = c.status || (c.kind === 'text' ? (c.look === 'color' ? 'C3' : 'C2') : 'C3'), a = c.anchor || {};
        let chk = '';
        if (a.note && c.kind === 'text' && c.tag !== 'layout') {   // 指示文(注釈のコメント)が、修正後の該当箇所の前後にあるか
          // 「目指し（以下同様）」のような添え書きは外す(指示文全体がかっこ書きなら外さない)
          const strip = a.note.replace(/[（(][^）)]*(以下同様|全体|ママ|イキ|トル|同様)[^）)]*[）)]/g, '').replace(/\s/g, '');
          const want = strip || a.note.replace(/\s/g, '');
          if (/太字|細字|書体|ゴシック|明朝|イタリック|斜体|色|サイズ|大きく|小さく|字下げ|改行|追い込み|写真|差し?替/.test(want)) chk = '書式・組みの指示（人が確認）';
          else if (/^(トル|トルツメ|トルママ|削除)$/.test(want)) chk = c.tag === 'delete' || !c.after ? '削除を確認（自動確認OK）' : '削除されていない可能性（要確認）';
          else { const ctx = c.nbox ? around(d.nc, c.nbox, [...want].length + 3) : ''; chk = want && ctx.includes(want) ? '指示文が修正後にある（自動確認OK）' : '指示文が修正後に見当たらない（要確認）'; }
        }
        add(p + 1, st, c.obox, c.show + (c.look === 'color' ? '（色のみ）' : ''), a.how || c.why || '', a.note || '', chk, c.nbox);
      }
      const done = new Set(d.an.filter(a => a.hit.length).map(a => a.stroke)), f0 = F.length;
      const along = (b, v) => v ? [b[1], b[3]] : [b[0], b[2]];   // 行の向きに沿った範囲
      for (const a of d.an) {
        const keep = KEEP.test(a.note || '');
        if (keep && a.hit.length) { add(p + 1, 'C2', a.box, 'ママ／イキの指示なのに変更あり', a.how, a.note); continue; }
        if (keep) { add(p + 1, 'M', a.box, textIn(d.oc, a.box), a.how, a.note, '', mapBox(d, a.box)); continue; }
        if (a.hit.length) continue;
        // 指示どおり変わった赤字のすぐ隣(行の折り返しで続く取り消し線など)は、続きの赤字として軽く扱う
        const adj = a.kind === 'tokens' && d.an.some(b => b.hit.length && b.kind === 'tokens' && [...a.toks].some(k => b.toks.has(k - 1) || b.toks.has(k + 1)));
        const cat = (done.has(a.stroke) && a.stroke >= 0) || adj ? 'B2' : 'B';
        // 同じ一続きの赤字、または同じ行で途切れて続く細い線は、1件にまとめる
        const prev = F.find((f, i) => i >= f0 && f.cat === cat && a.kind === 'tokens' && (
          (f.stroke === a.stroke && a.stroke >= 0 && !done.has(a.stroke) && f.box[1] < a.box[3] && a.box[1] < f.box[3]) ||
          (f.thin && a.thin && f.li === a.li && (([f1, f2], [a1, a2]) => Math.max(a1 - f2, f1 - a2))(along(f.box, a.vert), along(a.box, a.vert)) <= 20)));
        if (prev) { prev.box = union([prev.box, a.box]).map(Math.trunc); prev.show = textIn(d.oc, prev.box); prev.nbox = mapBox(d, prev.box); continue; }
        // 挿入位置は「前の字｜後ろの字」で示す。修正後の該当箇所も添える
        let show, nb;
        if (a.kind === 'insert') {
          const at = Math.min(a.at, d.ot.length), pre = at > 0 ? tokText(d.oc, d.ot[at - 1].box) : '', post = at < d.ot.length ? tokText(d.oc, d.ot[at].box) : '';
          show = `${pre}｜${post}（挿入位置）`; nb = union([tokBox(d, at - 1), tokBox(d, at)].filter(Boolean));
        } else { show = textIn(d.oc, a.box); nb = mapBox(d, a.box); }
        add(p + 1, cat, a.box, show, a.how, a.note || '', '', nb);
        Object.assign(F[F.length - 1], { stroke: a.stroke, thin: !!a.thin, li: a.li, vert: a.vert, span: a.span, lh: a.h });
      }
      // まとめたあとで行のほぼ全長(かつ字2つ分より長く)にわたる細い線は、引き出し線の可能性として示す
      for (const f of F.slice(f0)) if (f.thin && f.span) { const [s, e] = along(f.box, f.vert); if (e - s >= 0.9 * f.span && e - s > 2 * f.lh) f.how += '（細い線：引き出し線の可能性）'; }
      for (const b of d.restBoxes) {
        if (d.notes.some(n => n.rule && ov(n.box, b))) { add(p + 1, 'G', b); continue; }
        add(p + 1, d.an.some(a => ov(b, a.box, 30)) ? 'F2' : 'F', b);
      }
    });
    for (const e of expansions) add(e.page, 'D', e.box, `${e.frm}→${e.to}`, e.origin, '', e.status, mapBox(P[e.page - 1], e.box));
    for (const r of remain) add(r.page, 'D', r.box, `${r.frm}（修正後に残っている）`, '全体指示', '', '未統一');
    for (const l of lookalike) add(l.page, 'E', l.box, l.show, '', '', '', mapBox(P[l.page - 1], l.box));
    prog('完了', 1);
    return { findings: F, pages: P.map(d => d.thumbs), rules };
  };
})();
