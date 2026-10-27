// 原稿のデータファイル(Excel・Word・PowerPoint・テキスト・CSV)を読み、照合に使える「ページ」にする
//   ページごとに、文字データ(PDFの文字データと同じ形。位置は pt)、まとまり(段落・表の行)、コメント、表示用の画像を作る
//   Officeのファイル(.xlsx・.docx・.pptx)は、ZIPにXMLを入れたもの。ブラウザの展開機能で読む
'use strict';
(function () {
  // ---- ZIP ----
  //   deflate-raw に対応していないブラウザでは、ZIPの目録にあるCRCと大きさを使ってgzipの形に包んで展開する
  async function inflate(data, crc, usize) {
    let ds;
    try { ds = new DecompressionStream('deflate-raw'); }
    catch (e) {
      const g = new Uint8Array(18 + data.length), v = new DataView(g.buffer);
      g.set([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 255]); g.set(data, 10);
      v.setUint32(10 + data.length, crc, true); v.setUint32(14 + data.length, usize >>> 0, true);
      data = g; ds = new DecompressionStream('gzip');
    }
    return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer());
  }
  PC.unzip = buf => {
    const u = new Uint8Array(buf), v = new DataView(u.buffer, u.byteOffset, u.byteLength), files = new Map();
    let e = -1;
    for (let i = u.length - 22; i >= Math.max(0, u.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('ZIPとして読めません');
    let p = v.getUint32(e + 16, true);
    for (let k = v.getUint16(e + 10, true); k > 0 && v.getUint32(p, true) === 0x02014b50; k--) {
      const nl = v.getUint16(p + 28, true), name = new TextDecoder().decode(u.subarray(p + 46, p + 46 + nl));
      files.set(name, { method: v.getUint16(p + 10, true), crc: v.getUint32(p + 16, true), csize: v.getUint32(p + 20, true), usize: v.getUint32(p + 24, true), at: v.getUint32(p + 42, true) });
      p += 46 + nl + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
    }
    const read = async name => {
      const f = files.get(name.replace(/^\//, ''));
      if (!f) return null;
      const s = f.at + 30 + v.getUint16(f.at + 26, true) + v.getUint16(f.at + 28, true), data = u.subarray(s, s + f.csize);
      if (f.method === 0) return data;
      if (f.method !== 8) throw new Error('対応していない圧縮方式です');
      return inflate(data, f.crc, f.usize);
    };
    return { has: n => files.has(n.replace(/^\//, '')), read, text: async n => { const b = await read(n); return b ? new TextDecoder().decode(b) : null; } };
  };

  // ---- XML(名前空間の接頭辞はファイルによって違うことがあるため、要素は名前の後ろの部分で探す) ----
  const parse = s => new DOMParser().parseFromString(s, 'application/xml');
  const kids = (el, n) => (el ? [...el.children].filter(c => c.localName === n) : []);
  const kid = (el, n) => kids(el, n)[0] || null;
  const all = (el, n) => (el ? [...el.getElementsByTagNameNS('*', n)] : []);
  const at = (el, n) => { if (!el) return null; for (const a of el.attributes) if (a.localName === n) return a.value; return null; };
  const rid = el => { if (!el) return null; for (const a of el.attributes) if (a.localName === 'id' && /relationships/.test(a.namespaceURI || '')) return a.value; return null; };
  // 関連づけ(.rels): id → { target(ZIPの中の場所), type }
  async function rels(z, path) {
    const dir = path.replace(/[^/]*$/, ''), out = new Map(), s = await z.text(`${dir}_rels/${path.slice(dir.length)}.rels`);
    if (!s) return out;
    for (const r of all(parse(s), 'Relationship')) {
      if (at(r, 'TargetMode') === 'External') continue;
      let t = at(r, 'Target') || '';
      if (t.startsWith('/')) t = t.slice(1);
      else { const segs = (dir + t).split('/'), st = []; for (const g of segs) { if (g === '..') st.pop(); else if (g !== '.') st.push(g); } t = st.join('/'); }
      out.set(at(r, 'Id'), { target: t, type: at(r, 'Type') || '' });
    }
    return out;
  }

  // ---- 文字の置き方と表示用の画像 ----
  const FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Yu Gothic", Meiryo, "Noto Sans JP", IPAGothic, sans-serif';
  let mctx = null;
  const wcache = new Map();
  const adv = (ch, size) => {
    const key = ch + '\u0001' + size;
    if (!wcache.has(key)) { if (!mctx) mctx = document.createElement('canvas').getContext('2d'); mctx.font = `${size}px ${FONT}`; wcache.set(key, mctx.measureText(ch).width); }
    return wcache.get(key);
  };
  // 原稿の1ページ(データファイルから作るもの)。文字データ(items・chars)は PC.pageText と同じ形
  class VPage {
    constructor(label, w) { this.label = label; this.w = w; this.h = 0; this.items = []; this.chars = []; this.blocks = []; this.lines = []; this.titles = []; this.notes = []; }
    // 文字列を (x, y) から幅 width で折り返して置く。返り値: 置いた範囲の下端
    put(s, x, y, width, size) {
      const lh = size * 1.5;
      let cx = x, cy = y, cur = null;
      for (const ch of String(s)) {
        if (ch === '\n') { cx = x; cy += lh; cur = null; continue; }
        const a = ch === '\t' ? size : adv(ch, size);
        if (cx + a > x + width + 0.01 && cx > x) { cx = x; cy += lh; cur = null; }
        const box = [cx, cy, cx + a, cy + size * 1.2];
        if (ch.trim()) {
          if (!cur) { cur = { s: '', box: box.slice(), vert: false, size }; this.items.push(cur); }
          cur.s += ch; cur.box = PC.union([cur.box, box]);
          this.chars.push({ c: ch, k: PC.fold(ch), box, it: this.items.length - 1, brk: false });
        } else if (cur) cur.s += ' ';
        cx += a;
      }
      return cy + lh;
    }
    // 文字データにしない見出し(シート名など)と罫線
    title(s, x, y, size) { this.titles.push({ s, x, y, size }); }
    line(x0, y0, x1, y1) { this.lines.push([x0, y0, x1, y1]); }
    text() { return { w: this.w, h: this.h, items: this.items, chars: this.chars }; }
    render(dpi) {
      const k = dpi / 72, c = document.createElement('canvas');
      c.width = Math.max(1, Math.ceil(this.w * k)); c.height = Math.max(1, Math.ceil(this.h * k));
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.strokeStyle = '#b9bec8'; ctx.lineWidth = Math.max(1, 0.6 * k);
      for (const [x0, y0, x1, y1] of this.lines) { ctx.beginPath(); ctx.moveTo(x0 * k, y0 * k); ctx.lineTo(x1 * k, y1 * k); ctx.stroke(); }
      ctx.fillStyle = '#6b7280';
      for (const t of this.titles) { ctx.font = `bold ${t.size * k}px ${FONT}`; ctx.fillText(t.s, t.x * k, (t.y + t.size) * k); }
      ctx.fillStyle = '#111';
      for (const ch of this.chars) { const it = this.items[ch.it]; ctx.font = `${it.size * k}px ${FONT}`; ctx.fillText(ch.c, ch.box[0] * k, (ch.box[1] + it.size * 0.95) * k); }
      return { w: c.width, h: c.height, d: ctx.getImageData(0, 0, c.width, c.height).data };
    }
  }

  // 表(行の並び)をページに置く。rows: [{ cells: [文字列…], notes: [コメント…], rn: 行番号 }]。行ごとに1つのまとまり(kind 'row')
  //   1ページに入りきらない表は、行の区切りで次のページへ。左に行番号、上に列の記号(opt.cols)を灰色で添える(照合には使わない)
  function tablePages(label, rows, opt = {}) {
    const size = opt.size || 9, pad = 4, M = 30, maxH = opt.maxH || 800, ncol = Math.max(1, ...rows.map(r => r.cells.length));
    const colW = [];
    for (let c = 0; c < ncol; c++) {
      let w = 24;
      for (const r of rows) { const s = r.cells[c] || ''; for (const ln of s.split('\n')) w = Math.max(w, [...ln].reduce((t, ch) => t + adv(ch, size), 0) + 2 * pad); }
      colW.push(Math.min(w, opt.maxCol || 220));
    }
    const W = 2 * M + colW.reduce((a, b) => a + b, 0), pages = [];
    // 表の見出しの行(初めの3行のうち、2つ以上のセルに字がある最初の行と、その上の表題の行)。成果物では、表が続くページごとにくり返されることがある
    const hi = rows.slice(0, 3).findIndex(r => r.cells.filter(c => c && c.trim()).length >= 2), heads = new Set(rows.slice(0, hi + 1));
    let pg = null, y = 0;
    const start = () => {
      pg = new VPage(`${label}${pages.length ? `（${pages.length + 1}）` : ''}`, W); pg.title(label, M, 6, 9); y = M; pages.push(pg);
      if (opt.cols) { let x = M; colW.forEach((w, c) => { if (opt.cols[c]) pg.title(opt.cols[c], x + w / 2 - 3, 19, 7); x += w; }); }
    };
    const placeRow = r => { let x = M, bottom = y; r.cells.forEach((s, c) => { if (s) bottom = Math.max(bottom, pg.put(s, x + pad, y + pad, colW[c] - 2 * pad, size)); x += colW[c]; }); return Math.max(bottom, y + size * 1.5) + pad; };
    for (const r of rows) {
      if (!pg) start();
      let s0 = pg.chars.length, i0 = pg.items.length, bottom = placeRow(r);
      if (bottom > maxH && y > M + 1) {   // 次のページへ(置いた字を取り消して置き直す)
        pg.chars.length = s0; pg.items.length = i0; pg.h = y + M;
        start(); s0 = pg.chars.length; bottom = placeRow(r);
      }
      let gx = M; for (const w of [0, ...colW]) { gx += w; pg.line(gx, y, gx, bottom); }
      pg.line(M, y, W - M, y); pg.line(M, bottom, W - M, bottom);
      if (r.rn) pg.title(String(r.rn), 4, y + pad, 7);
      if (pg.chars.length > s0) pg.blocks.push([s0, pg.chars.length, 'row', heads.has(r) ? 'head' : '', r.rn ? `${r.rn}行目` : '']);
      for (const n of r.notes || []) pg.notes.push({ type: 'Comment', box: [M, y, W - M, bottom], text: n, quads: [] });
      y = bottom;
    }
    if (pg) pg.h = y + M;
    return pages;
  }
  PC.tablePages = tablePages;
  // 段落と表の並び(Word・テキスト)を、A4の幅のページに流し込む。flow: [{ kind: 'para', text } | { kind: 'row', cells, widths? }]
  function flowPages(label, flow, opt = {}) {
    const W = 595, H = 842, M = 40, size = opt.size || 10.5, width = W - 2 * M, pages = [];
    let pg = null, y = 0;
    const start = () => { if (pg) pg.h = Math.max(H, y + M); pg = new VPage(`${label}${pages.length ? `（${pages.length + 1}）` : ''}`, W); pg.title(label, M, 14, 9); y = M; pages.push(pg); };
    for (const b of flow) {
      if (!pg) start();
      if (b.kind === 'para') {
        if (!b.text.trim()) { y += size * 0.8; continue; }
        const need = Math.ceil([...b.text].reduce((t, ch) => t + adv(ch, size), 0) / width) * size * 1.5;
        if (y + Math.min(need, H / 2) > H - M && y > M + 1) start();
        const s0 = pg.chars.length;
        y = pg.put(b.text, M, y, width, size) + size * 0.4;
        if (pg.chars.length > s0) pg.blocks.push([s0, pg.chars.length, 'para']);
        const pb = pg.chars.length > s0 ? PC.union(pg.chars.slice(s0).map(c => c.box)) : [M, y - size * 2, W - M, y];
        for (const n of b.notes || []) pg.notes.push({ type: 'Comment', box: pb, text: n, quads: [pb] });   // コメントの付いた段落(書式の指示の確認に使う)
      } else {
        const ws = b.widths && b.widths.length === b.cells.length ? b.widths : b.cells.map(() => 1), tot = ws.reduce((a, c) => a + c, 0) || 1, cw = ws.map(v => (v / tot) * width), pad = 3;
        if (y + size * 3 > H - M && y > M + 1) start();
        let x = M, bottom = y, s0 = pg.chars.length;
        b.cells.forEach((s, c) => { if (s) bottom = Math.max(bottom, pg.put(s, x + pad, y + pad, cw[c] - 2 * pad, size)); x += cw[c]; });
        bottom = Math.max(bottom, y + size * 1.5) + pad;
        let gx = M; for (const w of [0, ...cw]) { gx += w; pg.line(gx, y, gx, bottom); } pg.line(M, y, W - M, y); pg.line(M, bottom, W - M, bottom);
        if (pg.chars.length > s0) pg.blocks.push([s0, pg.chars.length, 'row']);
        for (const n of b.notes || []) pg.notes.push({ type: 'Comment', box: [M, y, W - M, bottom], text: n, quads: [] });
        y = bottom + 2;
      }
    }
    if (pg) pg.h = Math.max(H, y + M);
    return pages;
  }

  // ---- Excel の表示形式: セルに見えている文字にする ----
  const BUILTIN = {
    0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 5: '"¥"#,##0;"¥"\\-#,##0', 6: '"¥"#,##0;[Red]"¥"\\-#,##0', 7: '"¥"#,##0.00;"¥"\\-#,##0.00', 8: '"¥"#,##0.00;[Red]"¥"\\-#,##0.00',
    9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??', 14: 'yyyy/m/d', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'yyyy/m/d h:mm',
    27: '[$-411]ge.m.d', 28: '[$-411]ggge"年"m"月"d"日"', 29: '[$-411]ggge"年"m"月"d"日"', 30: 'm/d/yy', 31: 'yyyy"年"m"月"d"日"', 32: 'h"時"mm"分"', 33: 'h"時"mm"分"ss"秒"', 34: 'yyyy"年"m"月"', 35: 'm"月"d"日"', 36: '[$-411]ge.m.d',
    37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 48: '##0.0E+0', 49: '@',
    50: '[$-411]ge.m.d', 51: '[$-411]ggge"年"m"月"d"日"', 52: 'yyyy"年"m"月"', 53: 'm"月"d"日"', 54: '[$-411]ggge"年"m"月"d"日"', 55: 'yyyy"年"m"月"', 56: 'm"月"d"日"', 57: '[$-411]ge.m.d', 58: '[$-411]ggge"年"m"月"d"日"',
  };
  // 書式を部分(正;負;ゼロ;文字列)に分ける
  function sections(code) {
    const out = []; let cur = '', q = false, br = false;
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (ch === '\\' && !q) { cur += ch + (code[i + 1] || ''); i++; continue; }
      if (ch === '"') q = !q; else if (!q && ch === '[') br = true; else if (!q && ch === ']') br = false;
      else if (!q && !br && ch === ';') { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  }
  // 書式の部分を字句に分ける: { lit } 文字そのまま / { at } 文字列の置き場所 / { n } 数字の置き場所など / { d } 日付・時刻
  function tokens(sec) {
    const out = [];
    for (let i = 0; i < sec.length; i++) {
      const ch = sec[i], rest = sec.slice(i);
      if (ch === '"') { const j = sec.indexOf('"', i + 1); out.push({ lit: sec.slice(i + 1, j < 0 ? sec.length : j) }); i = j < 0 ? sec.length : j; continue; }
      if (ch === '\\') { out.push({ lit: sec[i + 1] || '' }); i++; continue; }
      if (ch === '_') { out.push({ lit: ' ' }); i++; continue; }
      if (ch === '*') { i++; continue; }
      if (ch === '[') {
        const j = sec.indexOf(']', i), body = sec.slice(i + 1, j < 0 ? sec.length : j); i = j < 0 ? sec.length : j;
        const cur = body.match(/^\$([^-]*)/); if (cur) { if (cur[1]) out.push({ lit: cur[1] }); continue; }
        if (/^(h+|m+|s+)$/i.test(body)) out.push({ d: '[' + body.toLowerCase() + ']' });
        continue;   // 色・条件
      }
      if (ch === '@') { out.push({ at: true }); continue; }
      if ('0#?.,%'.includes(ch)) { out.push({ n: ch }); continue; }
      if (/^[Ee][+-]/.test(rest) && out.some(t => t.n)) { out.push({ n: 'E' + rest[1] }); i++; continue; }
      if (/^(AM\/PM|A\/P)/i.test(rest)) { const m = rest.match(/^(AM\/PM|A\/P)/i)[0]; out.push({ d: m.toUpperCase() }); i += m.length - 1; continue; }
      if (/^aaaa/.test(rest)) { out.push({ d: 'aaaa' }); i += 3; continue; }
      if (/^aaa/.test(rest)) { out.push({ d: 'aaa' }); i += 2; continue; }
      if (/[ymdhsge]/i.test(ch)) { const t = rest.match(/^([yYmMdDhHsSgGeE])\1*/)[0]; out.push({ d: t.toLowerCase() }); i += t.length - 1; continue; }
      out.push({ lit: ch });
    }
    return out;
  }
  const ERA = [[Date.UTC(2019, 4, 1), '令和', '令', 'R', 2018], [Date.UTC(1989, 0, 8), '平成', '平', 'H', 1988], [Date.UTC(1926, 11, 25), '昭和', '昭', 'S', 1925], [Date.UTC(1912, 6, 30), '大正', '大', 'T', 1911], [-Infinity, '明治', '明', 'M', 1867]];
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'], WEEK_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], WEEK_EN_L = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], MON_L = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function fmtDate(v, toks, date1904) {
    let days = Math.floor(v); const frac = v - days;
    if (date1904) days += 1462;
    const t = (days < 61 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30)) + days * 86400000 + Math.round(frac * 86400) * 1000, dt = new Date(t);
    const Y = dt.getUTCFullYear(), Mo = dt.getUTCMonth(), D = dt.getUTCDate(), wd = dt.getUTCDay();
    let H = dt.getUTCHours(); const Mi = dt.getUTCMinutes(), S = dt.getUTCSeconds(), ampm = toks.some(x => x.d === 'AM/PM' || x.d === 'A/P');
    const era = ERA.find(e => t >= e[0]), p2 = n => String(n).padStart(2, '0');
    let out = '';
    toks.forEach((x, i) => {
      if (x.lit !== undefined) { out += x.lit; return; }
      if (x.n === '.' || x.n === ',') { out += x.n; return; }   // 日付の区切りの「.」「,」
      if (!x.d) return;
      const d = x.d, prev = toks.slice(0, i).reverse().find(y => y.d), next = toks.slice(i + 1).find(y => y.d);
      const minute = d[0] === 'm' && d.length <= 2 && ((prev && prev.d[0] === 'h') || (prev && prev.d === '[h]') || (next && next.d[0] === 's'));
      if (d === '[h]') out += Math.floor(v * 24);
      else if (d === '[m]' || d === '[mm]') out += Math.floor(v * 1440);
      else if (d[0] === 'y') out += d.length <= 2 ? p2(Y % 100) : Y;
      else if (minute) out += d.length === 2 ? p2(Mi) : Mi;
      else if (d[0] === 'm') out += d.length === 1 ? Mo + 1 : d.length === 2 ? p2(Mo + 1) : d.length === 3 ? MON[Mo] : MON_L[Mo];
      else if (d[0] === 'd') out += d.length === 1 ? D : d.length === 2 ? p2(D) : d.length === 3 ? WEEK_EN[wd] : WEEK_EN_L[wd];
      else if (d === 'aaa') out += WEEK[wd];
      else if (d === 'aaaa') out += WEEK[wd] + '曜日';
      else if (d[0] === 'h') { let h = H; if (ampm) h = h % 12 || 12; out += d.length >= 2 ? p2(h) : h; }
      else if (d[0] === 's') out += d.length >= 2 ? p2(S) : S;
      else if (d === 'AM/PM') out += H < 12 ? 'AM' : 'PM';
      else if (d === 'A/P') out += H < 12 ? 'A' : 'P';
      else if (d[0] === 'g') out += d.length >= 3 ? era[1] : d.length === 2 ? era[2] : era[3];
      else if (d[0] === 'e') out += d.length >= 2 ? p2(Y - era[4]) : Y - era[4];
    });
    return out;
  }
  function fmtNumber(v, toks) {
    const nIdx = toks.map((t, i) => (t.n && t.n !== '%' ? i : -1)).filter(i => i >= 0);
    if (!nIdx.length) return toks.map(t => t.lit !== undefined ? t.lit : t.n === '%' ? '%' : '').join('');
    const first = nIdx[0], last = nIdx[nIdx.length - 1];
    let pct = toks.filter(t => t.n === '%').length, x = v * Math.pow(100, pct);
    let pat = toks.slice(first, last + 1).map(t => t.n || '').join('');
    const pre = toks.slice(0, first).map(t => t.lit !== undefined ? t.lit : t.n === '%' ? '%' : '').join('');
    const post = toks.slice(last + 1).map(t => t.lit !== undefined ? t.lit : t.n === '%' ? '%' : '').join('');
    const mid = toks.slice(first, last + 1).filter(t => t.lit !== undefined).map(t => t.lit).join('');
    const ex = pat.match(/E([+-])([0#]+)$/);
    if (ex) {   // 指数表示
      const mant = pat.slice(0, ex.index), dec = (mant.split('.')[1] || '').length, e = x === 0 ? 0 : Math.floor(Math.log10(Math.abs(x)));
      const m = (x / Math.pow(10, e)).toFixed(dec), es = String(Math.abs(e)).padStart(ex[2].length, '0');
      return pre + m + 'E' + (e < 0 ? '-' : ex[1] === '+' ? '+' : '') + es + mid + post;
    }
    let [ip, fp = ''] = pat.split('.');
    while (ip.endsWith(',')) { ip = ip.slice(0, -1); x /= 1000; }
    const grouping = ip.includes(','), dec = (fp.match(/[0#?]/g) || []).length, mult = Math.pow(10, dec);
    const r = Math.round(Math.abs(x) * mult + 1e-9) / mult, [is, fs = ''] = r.toFixed(dec).split('.');
    const minInt = (ip.match(/0/g) || []).length;
    let ints = is.replace(/^0+/, '');
    if (ints.length < minInt) ints = ints.padStart(minInt, '0');
    if (grouping) ints = ints.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    let fr = fs;
    for (let k = fp.replace(/[^0#?]/g, '').length - 1; k >= 0 && fr.length; k--) {
      const ph = fp.replace(/[^0#?]/g, '')[k];
      if (fr[fr.length - 1] !== '0' || ph === '0') break;
      fr = ph === '?' ? fr.slice(0, -1) + ' ' : fr.slice(0, -1);
    }
    return pre + ints + (fp ? '.' + fr : '') + mid + post;
  }
  // 標準(General): 整数はそのまま、小数は有効数字10桁まで、とても大きい・小さい数は指数表示
  const general = v => {
    if (!isFinite(v)) return String(v);
    if (Number.isInteger(v) && Math.abs(v) < 1e11) return String(v);
    if (Math.abs(v) >= 1e11 || (v !== 0 && Math.abs(v) < 1e-9)) { const [m, e] = v.toExponential(5).split('e'); return m.replace(/\.?0+$/, '') + 'E' + (e[0] === '-' ? '-' : '+') + e.replace(/^[+-]/, '').padStart(2, '0'); }
    return String(+v.toPrecision(10));
  };
  // v: セルの値(数値)、code: 表示形式。文字列のセルは text に渡す
  PC.excelFormat = (v, code, date1904 = false, text = null) => {
    if (code === undefined || code === null) code = 'General';
    const secs = sections(code);
    if (text !== null) {   // 文字列: 4つ目の部分、または @ を含む部分があれば当てはめる
      const sec = secs.length >= 4 ? secs[3] : secs.find(s => s.includes('@'));
      if (!sec) return text;
      return tokens(sec).map(t => t.at ? text : t.lit !== undefined ? t.lit : '').join('');
    }
    if (/^general$/i.test(secs[0].trim()) || secs[0].trim() === '') return v < 0 && secs.length > 1 ? general(-v) : general(v);
    let sec = secs[0], x = v, neg = false;
    if (v < 0 && secs.length >= 2 && secs[1] !== '') { sec = secs[1]; x = -v; }
    else if (v === 0 && secs.length >= 3) sec = secs[2];
    else if (v < 0) { neg = true; x = -v; }
    const toks = tokens(sec);
    if (/^general$/i.test(sec.trim()) || /[?#0]\s*\/\s*[?#0]/.test(sec.replace(/"[^"]*"/g, ''))) return (neg ? '-' : '') + general(x);   // 分数の表示形式は標準で表す
    const s = toks.some(t => t.d) && !toks.some(t => t.n && t.n !== '.') ? fmtDate(x, toks, date1904) : fmtNumber(x, toks);
    return (neg && !toks.some(t => t.d) && /[1-9]/.test(s) ? '-' : '') + s;
  };

  // ---- Excel(.xlsx): 表示されているシートごとに、表示されている行・列のセルを表示形式どおりの文字にする ----
  const colNum = s => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
  const colName = n => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
  const refRC = ref => { const m = /^([A-Z]+)(\d+)$/.exec(ref || ''); return m ? [+m[2], colNum(m[1])] : null; };
  const unesc = s => s.replace(/_x([0-9A-Fa-f]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16))).replace(/\r\n?/g, '\n');
  const siText = si => [...si.children].map(c => c.localName === 't' ? c.textContent : c.localName === 'r' ? (kid(c, 't') || { textContent: '' }).textContent : '').join('');   // ふりがな(rPh)は除く
  async function readXlsx(z, name) {
    const wbPath = 'xl/workbook.xml', wb = parse(await z.text(wbPath)), wr = await rels(z, wbPath);
    const pr = all(wb, 'workbookPr')[0], date1904 = /^(1|true)$/i.test(at(pr, 'date1904') || '');
    const find = t => [...wr.values()].find(r => r.type.endsWith('/' + t));
    const sst = [];
    const ss = find('sharedStrings');
    if (ss) for (const si of all(parse(await z.text(ss.target)), 'si')) sst.push(unesc(siText(si)));
    const fmts = [];
    const st = find('styles');
    if (st) {
      const sx = parse(await z.text(st.target)), custom = new Map(all(sx, 'numFmt').map(n => [+at(n, 'numFmtId'), at(n, 'formatCode')]));
      for (const xf of kids(all(sx, 'cellXfs')[0], 'xf')) { const id = +(at(xf, 'numFmtId') || 0); fmts.push(custom.has(id) ? custom.get(id) : BUILTIN[id] ?? 'General'); }
    }
    const pages = [];
    for (const sh of all(wb, 'sheet')) {
      if ((at(sh, 'state') || 'visible') !== 'visible') continue;
      const r = wr.get(rid(sh)); if (!r) continue;
      const doc = parse(await z.text(r.target)), sname = at(sh, 'name') || '';
      const hidCol = new Set();
      for (const c of all(doc, 'col')) if (/^(1|true)$/i.test(at(c, 'hidden') || '')) for (let k = +at(c, 'min'); k <= +at(c, 'max'); k++) hidCol.add(k);
      const notes = new Map(), srels = await rels(z, r.target), cm = [...srels.values()].find(x => x.type.endsWith('/comments'));
      if (cm) for (const c of all(parse(await z.text(cm.target)), 'comment')) { const t = all(c, 't').map(x => x.textContent).join('').trim(); if (t) notes.set(at(c, 'ref'), t); }
      const rows = new Map();
      for (const row of all(doc, 'row')) {
        if (/^(1|true)$/i.test(at(row, 'hidden') || '')) continue;
        for (const c of kids(row, 'c')) {
          const rc = refRC(at(c, 'r')); if (!rc || hidCol.has(rc[1])) continue;
          const t = at(c, 't') || 'n', v = kid(c, 'v'), vt = v ? v.textContent : '', f = fmts[+(at(c, 's') || 0)] || 'General';
          let s = '';
          if (t === 's') s = PC.excelFormat(0, f, date1904, sst[+vt] ?? '');
          else if (t === 'inlineStr') s = PC.excelFormat(0, f, date1904, unesc(kid(c, 'is') ? siText(kid(c, 'is')) : ''));
          else if (t === 'str' || t === 'e') s = unesc(vt);
          else if (t === 'b') s = vt === '1' ? 'TRUE' : 'FALSE';
          else if (t === 'd') { const ms = Date.parse(vt); if (!isNaN(ms)) s = PC.excelFormat(ms / 86400000 + 25569, f, false); }
          else if (vt !== '') s = PC.excelFormat(+vt, f, date1904);
          const note = notes.get(at(c, 'r'));
          if (!s.trim() && !note) continue;
          if (!rows.has(rc[0])) rows.set(rc[0], new Map());
          rows.get(rc[0]).set(rc[1], { s, note });
        }
      }
      if (!rows.size) continue;
      const cols = [...new Set([...rows.values()].flatMap(m => [...m.keys()]))].sort((a, b) => a - b);
      const list = [...rows.keys()].sort((a, b) => a - b).map(k => { const m = rows.get(k); return { rn: k, cells: cols.map(c => (m.get(c) || {}).s || ''), notes: cols.map(c => (m.get(c) || {}).note).filter(Boolean) }; });
      const sheet = { name: `${name}　シート「${sname}」`, cols: cols.map(colName), rows: list.map(r => ({ rn: r.rn, cells: r.cells })) };   // 商品ごと(行ごと)の照合に使う表
      for (const pg of tablePages(sheet.name, list, { cols: sheet.cols })) { pg.sheet = sheet; pages.push(pg); }
    }
    return pages;
  }

  // ---- Word(.docx): 本文の段落と表(変更履歴は反映後の文。コメントは指示として添える) ----
  async function readDocx(z, name) {
    const path = 'word/document.xml', doc = parse(await z.text(path)), dr = await rels(z, path);
    const comments = new Map(), cm = [...dr.values()].find(x => x.type.endsWith('/comments'));
    if (cm) for (const c of all(parse(await z.text(cm.target)), 'comment')) comments.set(at(c, 'id'), all(c, 'p').map(p => all(p, 't').map(t => t.textContent).join('')).join('\n').trim());
    const SKIP = new Set(['del', 'moveFrom', 'instrText', 'delText', 'rPr', 'pPr', 'Fallback', 'commentReference']);
    // 段落の文字(描かれる順)と、段落にかかるコメント
    const para = p => {
      let s = ''; const ids = [];
      const walk = el => {
        for (const c of el.children) {
          const n = c.localName;
          if (SKIP.has(n)) continue;
          if (n === 't') s += c.textContent;
          else if (n === 'tab') s += '\t';
          else if (n === 'br' || n === 'cr') s += '\n';
          else if (n === 'noBreakHyphen') s += '-';
          else if (n === 'commentRangeStart') ids.push(at(c, 'id'));
          else walk(c);
        }
      };
      walk(p);
      for (const r of all(p, 'commentReference')) if (!ids.includes(at(r, 'id'))) ids.push(at(r, 'id'));
      return { text: s, notes: ids.map(i => comments.get(i)).filter(Boolean) };
    };
    const flow = [];
    const body = all(doc, 'body')[0];
    const walk = el => {
      for (const c of el.children) {
        const n = c.localName;
        if (n === 'p') flow.push({ kind: 'para', ...para(c) });
        else if (n === 'tbl') {
          const ws = kids(kid(c, 'tblGrid'), 'gridCol').map(g => +(at(g, 'w') || 0));
          for (const tr of kids(c, 'tr')) {
            const cells = kids(tr, 'tc').map(tc => kids(tc, 'p').map(p => para(p)));
            flow.push({ kind: 'row', cells: cells.map(ps => ps.map(x => x.text).join('\n')), notes: cells.flatMap(ps => ps.flatMap(x => x.notes)), widths: ws.length === cells.length ? ws : null });
          }
        } else if (n === 'sdt') walk(kid(c, 'sdtContent') || c);
        else if (n === 'customXml' || n === 'ins' || n === 'moveTo' || n === 'smartTag') walk(c);
      }
    };
    if (body) walk(body);
    return flowPages(name, flow);
  }

  // ---- PowerPoint(.pptx): スライドごとに、テキストと表を置かれた位置に(位置の分からないものは左上から順に) ----
  async function readPptx(z, name) {
    const path = 'ppt/presentation.xml', pres = parse(await z.text(path)), pr = await rels(z, path), EMU = 12700;
    const sz = all(pres, 'sldSz')[0], SW = sz ? +at(sz, 'cx') / EMU : 960, SH = sz ? +at(sz, 'cy') / EMU : 540, pages = [];
    let no = 0;
    for (const sid of all(pres, 'sldId')) {
      const r = pr.get(rid(sid)); if (!r) continue;
      no++;
      const sl = parse(await z.text(r.target));
      if (at(all(sl, 'sld')[0], 'show') === '0') continue;   // 非表示のスライド
      const pg = new VPage(`${name}　スライド${no}`, SW); pg.h = SH; pg.title(`スライド${no}`, 6, 4, 8);
      let free = 20;   // 位置の分からない図形を置く位置
      const paras = txBody => kids(txBody, 'p').map(p => {
        let s = '', size = 0;
        for (const c of p.children) {
          if (c.localName === 'r' || c.localName === 'fld') { s += (kid(c, 't') || { textContent: '' }).textContent; const rp = kid(c, 'rPr'); if (!size && rp && at(rp, 'sz')) size = +at(rp, 'sz') / 100; }
          else if (c.localName === 'br') s += '\n';
        }
        return { s, size };
      });
      const place = (xf, off) => {
        const o = kid(xf, 'off'), e = kid(xf, 'ext');
        if (!o || !e) return null;
        return [off.x + (+at(o, 'x') - off.cx) * off.sx / EMU, off.y + (+at(o, 'y') - off.cy) * off.sy / EMU, +at(e, 'cx') * off.sx / EMU, +at(e, 'cy') * off.sy / EMU];
      };
      const walk = (tree, off) => {
        for (const c of tree.children) {
          const n = c.localName;
          if (n === 'sp') {
            const tb = kid(c, 'txBody'); if (!tb) continue;
            let b = place(kid(kid(c, 'spPr'), 'xfrm'), off);
            if (!b) { b = [20, free, SW - 40, 40]; }
            let y = b[1];
            for (const p of paras(tb)) {
              if (!p.s.trim()) { y += 8; continue; }
              const s0 = pg.chars.length, size = Math.min(40, p.size || 18);
              y = pg.put(p.s, b[0] + 4, y + 2, Math.max(40, b[2] - 8), size);
              if (pg.chars.length > s0) pg.blocks.push([s0, pg.chars.length, 'para']);
            }
            if (b[1] === free) free = y + 6;
            pg.h = Math.max(pg.h, y + 10);
          } else if (n === 'graphicFrame') {
            const tbl = all(c, 'tbl')[0]; if (!tbl) continue;
            let b = place(kid(c, 'xfrm'), off) || [20, free, SW - 40, 40];
            const ws = kids(kid(tbl, 'tblGrid'), 'gridCol').map(g => +at(g, 'w') * off.sx / EMU);
            let y = b[1];
            for (const tr of kids(tbl, 'tr')) {
              const cells = kids(tr, 'tc').map(tc => paras(kid(tc, 'txBody') || tc).map(p => p.s).join('\n'));
              let x = b[0], bottom = y + 14, s0 = pg.chars.length;
              cells.forEach((s, k) => { const w = ws[k] || b[2] / cells.length; if (s) bottom = Math.max(bottom, pg.put(s, x + 3, y + 3, w - 6, 12)); pg.line(x, y, x, bottom); x += w; });
              pg.line(b[0], y, x, y); pg.line(b[0], bottom, x, bottom); pg.line(x, y, x, bottom);
              if (pg.chars.length > s0) pg.blocks.push([s0, pg.chars.length, 'row']);
              y = bottom;
            }
            pg.h = Math.max(pg.h, y + 10);
          } else if (n === 'grpSp') {
            const gx = kid(kid(c, 'grpSpPr'), 'xfrm'), o = kid(gx, 'off'), e = kid(gx, 'ext'), co = kid(gx, 'chOff'), ce = kid(gx, 'chExt');
            if (o && e && co && ce) {
              const sx = (+at(e, 'cx') / Math.max(1, +at(ce, 'cx'))) * off.sx, sy = (+at(e, 'cy') / Math.max(1, +at(ce, 'cy'))) * off.sy;
              walk(c, { x: off.x + (+at(o, 'x') - off.cx) * off.sx / EMU, y: off.y + (+at(o, 'y') - off.cy) * off.sy / EMU, cx: +at(co, 'x'), cy: +at(co, 'y'), sx, sy });
            } else walk(c, off);
          }
        }
      };
      const tree = all(sl, 'spTree')[0];
      if (tree) walk(tree, { x: 0, y: 0, cx: 0, cy: 0, sx: 1, sy: 1 });
      if (pg.chars.length) pages.push(pg);
    }
    return pages;
  }

  // ---- テキスト・CSV: 文字コードは UTF-8(BOMなしも)・UTF-16・Shift_JIS を見分ける ----
  PC.decodeText = buf => {
    const u = new Uint8Array(buf);
    if (u[0] === 0xef && u[1] === 0xbb && u[2] === 0xbf) return new TextDecoder('utf-8').decode(u.subarray(3));
    if (u[0] === 0xff && u[1] === 0xfe) return new TextDecoder('utf-16le').decode(u.subarray(2));
    if (u[0] === 0xfe && u[1] === 0xff) return new TextDecoder('utf-16be').decode(u.subarray(2));
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u); } catch (e) { return new TextDecoder('shift_jis').decode(u); }
  };
  const csvRows = (s, sep) => {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
      if (ch === '"' && !cell) q = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cell); row.ln = rows.length + 1; rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); row.ln = rows.length + 1; rows.push(row); }
    return rows.filter(r => r.some(c => c.trim()));
  };

  // ---- 入口 ----
  const KINDS = { xlsx: 'Excel', xlsm: 'Excel', docx: 'Word', docm: 'Word', pptx: 'PowerPoint', pptm: 'PowerPoint', txt: 'テキスト', csv: 'CSV', tsv: 'CSV' };
  const OLD = { xls: '.xlsx', doc: '.docx', ppt: '.pptx' };
  PC.dataKind = f => { const m = /\.([a-z0-9]+)$/i.exec(f.name || ''); return m && KINDS[m[1].toLowerCase()] ? m[1].toLowerCase() : null; };
  PC.dataLabel = f => KINDS[PC.dataKind(f)] || '';
  PC.oldOffice = f => { const m = /\.([a-z0-9]+)$/i.exec(f.name || ''); return m && OLD[m[1].toLowerCase()] ? OLD[m[1].toLowerCase()] : null; };
  // データファイルを読み、原稿のページの並びにする。ページ: { label, text: 文字データ, blocks, notes(コメント), render(dpi) }
  PC.readDataFile = async f => {
    const ext = PC.dataKind(f);
    let pages;
    try {
      if (ext === 'txt') {
        const lines = PC.decodeText(f.buf).replace(/\r\n?/g, '\n').split('\n');
        pages = flowPages(f.name, lines.map(s => ({ kind: 'para', text: s })));
      } else if (ext === 'csv' || ext === 'tsv') {
        const s = PC.decodeText(f.buf), head = s.split('\n')[0], sep = ext === 'tsv' || (head.includes('\t') && !head.includes(',')) ? '\t' : ',';
        const rs = csvRows(s, sep);
        const list = rs.map((r, k) => ({ cells: r, rn: r.ln || k + 1 })), cols = Array.from({ length: Math.max(...rs.map(r => r.length)) }, (_, c) => colName(c + 1));
        const sheet = { name: f.name, cols, rows: list.map(r => ({ rn: r.rn, cells: r.cells })) };
        pages = tablePages(f.name, list, { cols });
        for (const pg of pages) pg.sheet = sheet;
      } else {
        const z = PC.unzip(f.buf);
        pages = ext.startsWith('xls') ? await readXlsx(z, f.name) : ext.startsWith('doc') ? await readDocx(z, f.name) : await readPptx(z, f.name);
      }
    } catch (e) { throw new Error(`「${f.name}」を${KINDS[ext]}のファイルとして読めません（${e && e.message ? e.message : e}）`); }
    // Excel・CSV の数字は、成果物では桁区切りのカンマを付け外しすることが多いため、カンマの有無は違いとしない(loose)
    const loose = /^(xls|csv|tsv)/.test(ext);
    return pages.filter(p => p.chars.length).map(p => ({ label: p.label, text: p.text(), blocks: p.blocks, notes: p.notes, loose, sheet: p.sheet || null, render: dpi => p.render(dpi) }));
  };
})();
