// PDFの読み込み・描画・文字データ・注釈の取得(pdf.jsを使う)
'use strict';
(function () {
  // 埋め込んだCMap・標準フォントを返す(file://で開いても外部を読みに行かないため)
  class EmbeddedCMap {
    constructor() {}
    async fetch({ name }) {
      const b64 = PC.ASSETS.cmaps[name];
      if (!b64) throw new Error('CMapが見つかりません: ' + name);
      return { cMapData: PC.b64bytes(b64), isCompressed: true };
    }
  }
  class EmbeddedStdFont {
    constructor() {}
    async fetch({ filename }) {
      const b64 = PC.ASSETS.fonts[filename];
      if (!b64) throw new Error('標準フォントが見つかりません: ' + filename);
      return PC.b64bytes(b64);
    }
  }
  PC.b64bytes = b64 => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };

  // 仕上がりの範囲(TrimBox)・裁ち落としの範囲(BleedBox)。pdf.jsでは読めないため、PDFの中身からページのオブジェクトごとに探す
  //   → Map(オブジェクトの番号 → { TrimBox, BleedBox })。ページの辞書が圧縮したオブジェクト(ObjStm)の中にあるPDFは、それもほどいて探す
  const latin1 = u => { let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return s; };
  const bytesOf = t => Uint8Array.from(t, c => c.charCodeAt(0));
  function findBytes(u, pat, from) {
    for (let i = u.indexOf(pat[0], from); i >= 0; i = u.indexOf(pat[0], i + 1)) {
      let k = 1; while (k < pat.length && u[i + k] === pat[k]) k++;
      if (k === pat.length) return i;
    }
    return -1;
  }
  function readBoxes(t, num, out) {
    for (const m of t.matchAll(/\/(TrimBox|BleedBox)\s*\[\s*([-+\d.\s]+)\]/g)) {
      const v = m[2].trim().split(/\s+/).map(Number);
      if (v.length === 4 && v.every(Number.isFinite)) { const o = out.get(num) || {}; o[m[1]] = v; out.set(num, o); }
    }
  }
  async function pageBoxes(u) {
    const out = new Map(), heads = new Map();
    // 1) 圧縮していないオブジェクト: 「/TrimBox」「/BleedBox」を含むオブジェクトの番号(直前の「N 0 obj」)
    for (const name of ['/TrimBox', '/BleedBox']) {
      const pat = bytesOf(name);
      for (let i = findBytes(u, pat, 0); i >= 0; i = findBytes(u, pat, i + pat.length)) {
        const w0 = Math.max(0, i - 4096), w = latin1(u.subarray(w0, i)); let h = null;
        for (const x of w.matchAll(/(\d+)\s+\d+\s+obj\b/g)) h = x;
        if (h && w.indexOf('endobj', h.index) < 0) heads.set(w0 + h.index, +h[1]);
      }
    }
    for (const [p, num] of heads) { const e = findBytes(u, bytesOf('endobj'), p); readBoxes(latin1(u.subarray(p, e < 0 ? Math.min(u.length, p + 4096) : e)), num, out); }
    if (out.size || typeof DecompressionStream === 'undefined') return out;
    // 2) 圧縮したオブジェクト(ObjStm、FlateDecodeのもの)
    const pat = bytesOf('/ObjStm');
    for (let i = findBytes(u, pat, 0); i >= 0; i = findBytes(u, pat, i + pat.length)) {
      const w0 = Math.max(0, i - 2048), w = latin1(u.subarray(w0, Math.min(u.length, i + 2048)));
      const d0 = w.lastIndexOf('obj', i - w0), s0 = w.indexOf('stream', i - w0);
      if (d0 < 0 || s0 < 0) continue;
      const dict = w.slice(d0, s0), N = +(dict.match(/\/N\s+(\d+)/) || [])[1], F = +(dict.match(/\/First\s+(\d+)/) || [])[1];
      if (!/FlateDecode/.test(dict) || !N || !F) continue;
      let a = w0 + s0 + 6; if (u[a] === 13) a++; if (u[a] === 10) a++;
      // 長さ: 辞書に数で書いてあればそれ、参照(「12 0 R」)なら endstream の手前の改行まで
      const L = dict.match(/\/Length\s+(\d+)\b(?!\s+\d+\s+R)/);
      let e = L ? a + +L[1] : findBytes(u, bytesOf('endstream'), a); if (e < 0 || e > u.length) continue;
      if (!L) { if (u[e - 1] === 10) e--; if (u[e - 1] === 13) e--; }
      let t;
      try { t = latin1(new Uint8Array(await new Response(new Blob([u.subarray(a, e)]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer())); }
      catch (err) { continue; }   // ほどけないものは飛ばす(ページの外枠だけで見る)
      if (!/TrimBox|BleedBox/.test(t)) continue;
      const hd = t.slice(0, F).trim().split(/\s+/).map(Number);
      for (let k = 0; k + 1 < hd.length; k += 2) readBoxes(t.slice(F + hd[k + 1], k + 3 < hd.length ? F + hd[k + 3] : t.length), hd[k], out);
    }
    return out;
  }

  PC.openPdf = async buf => {
    let boxes = null;
    try { boxes = await pageBoxes(new Uint8Array(buf)); } catch (e) { boxes = null; }   // 読めなくても、ページの外枠だけで見る
    const doc = await pdfjsLib.getDocument({
      data: new Uint8Array(buf), CMapReaderFactory: EmbeddedCMap, StandardFontDataFactory: EmbeddedStdFont,
      cMapUrl: 'embedded/', cMapPacked: true, standardFontDataUrl: 'embedded/', useSystemFonts: false, isEvalSupported: false,
    }).promise;
    // ページに、そのページの仕上がりの範囲などを添える(page.pcBoxes。PDFの座標)
    const get = doc.getPage.bind(doc);
    doc.getPage = async k => { const p = await get(k); if (p.pcBoxes === undefined) p.pcBoxes = (boxes && p.ref && boxes.get(p.ref.num)) || null; return p; };
    return doc;
  };

  // 複数のPDFを、並べた順にページをつなげて1冊として扱う(ほかの処理は numPages と getPage(n) だけを使うので、そのまま動く)
  PC.joinPdfs = (docs, names) => {
    const parts = []; let n = 0;
    docs.forEach((d, i) => { parts.push({ name: names[i], start: n, pages: d.numPages }); n += d.numPages; });
    return {
      numPages: n, parts,
      getPage: k => { const i = parts.findIndex(q => k - 1 < q.start + q.pages); return docs[i].getPage(k - parts[i].start); },
      destroy: () => Promise.all(docs.map(d => d.destroy())),
    };
  };
  // files: 選んだときに読み込んでおいた中身 { name, type, buf }。pdf.jsは渡したデータを手放させるため、毎回写しを渡す
  PC.openPdfs = async files => {
    const docs = [];
    for (const f of files) {
      try { docs.push(await PC.openPdf(f.buf.slice(0))); }
      catch (e) { throw new Error(`「${f.name}」を開けません（${e && e.message ? e.message : e}）`); }
    }
    return PC.joinPdfs(docs, files.map(f => f.name));
  };
  // 通しのページ番号(0始まり)が、どのファイルの何ページ目か
  PC.pageOf = (parts, pno) => { const q = (parts || []).find(x => pno < x.start + x.pages); return q ? { name: q.name, page: pno - q.start + 1 } : null; };

  // ページを指定の解像度で描画して画像にする(annots: 注釈も描くか)
  PC.renderPage = async (doc, pno, dpi, annots) => {
    const page = await doc.getPage(pno + 1), vp = page.getViewport({ scale: dpi / 72 });
    const w = Math.ceil(vp.width - 1e-3), h = Math.ceil(vp.height - 1e-3);
    const cv_ = document.createElement('canvas'); cv_.width = w; cv_.height = h;
    const ctx = cv_.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    await page.render({
      canvasContext: ctx, viewport: vp, background: 'rgb(255,255,255)',
      annotationMode: annots ? pdfjsLib.AnnotationMode.ENABLE : pdfjsLib.AnnotationMode.DISABLE,
    }).promise;
    const id = ctx.getImageData(0, 0, w, h);
    return { w, h, d: id.data };
  };

  // 文字データ: 1字ずつ [文字, 枠(200dpiの画素)]。pdf.jsは文字のまとまり単位で位置を返すため、まとまりの幅を字数で割る
  PC.textChars = async (doc, pno, dpi = PC.DPI) => {
    const page = await doc.getPage(pno + 1), vp = page.getViewport({ scale: dpi / 72 }), tc = await page.getTextContent();
    const out = [];
    for (const it of tc.items) {
      if (!it.str) continue;
      const chs = [...it.str], n = chs.length, [a, b, c, d, e, f] = it.transform;
      const st = tc.styles[it.fontName] || {}, size = Math.hypot(c, d) || Math.hypot(a, b) || 1;
      const asc = st.ascent ? Math.min(st.ascent, 1) : 0.88, desc = st.descent ? Math.min(-st.descent, 0.3) : 0.12;
      for (let i = 0; i < n; i++) {
        if (!chs[i].trim()) continue;
        let r;
        if (st.vertical) {   // 縦書きフォント: 上から下へ字が並ぶ
          const adv = (it.height || size * n) / n;
          r = [e, f - (i + 1) * adv, e + (it.width || size), f - i * adv];
        } else {
          const adv = it.width / n;
          r = [e + i * adv, f - desc * size, e + (i + 1) * adv, f + asc * size];
        }
        const p = vp.convertToViewportRectangle(r);
        out.push([chs[i], [Math.min(p[0], p[2]), Math.min(p[1], p[3]), Math.max(p[0], p[2]), Math.max(p[1], p[3])]]);
      }
    }
    return out;
  };

  // 注釈: 種類・位置(200dpiの画素)・コメント文字列
  PC.annotations = async (doc, pno, dpi = PC.DPI) => {
    const page = await doc.getPage(pno + 1), vp = page.getViewport({ scale: dpi / 72 });
    const anns = await page.getAnnotations({ intent: 'display' });
    return anns.filter(a => a.subtype !== 'Popup' && a.subtype !== 'Link' && a.subtype !== 'Widget').map(a => {
      const px = r => { const q = vp.convertToViewportRectangle(r); return [Math.min(q[0], q[2]), Math.min(q[1], q[3]), Math.max(q[0], q[2]), Math.max(q[1], q[3])]; };
      // 取り消し線・下線・マーカーは、どの文字の上に引いたかの範囲(QuadPoints)も取り出す
      const quads = [];
      if (a.quadPoints) for (let i = 0; i + 7 < a.quadPoints.length; i += 8) { const q = a.quadPoints; quads.push(px([Math.min(q[i], q[i + 4]), Math.min(q[i + 1], q[i + 5]), Math.max(q[i + 2], q[i + 6]), Math.max(q[i + 1], q[i + 5])])); }
      return { type: a.subtype, box: px(a.rect), quads, text: (a.contentsObj && a.contentsObj.str) || a.contents || '' };
    });
  };

  // 原稿: PDF(注釈を入れたPDF・スキャンしたPDF・ラフ)、画像、データファイル(Excel・Word・PowerPoint・テキスト・CSV)を、
  // 並べた順に1ページずつ取り出せる形にする(全ページを一度に展開するとメモリが足りなくなるため)
  //   データファイルは、シート・スライドなどごとのページ(文字データと表示用の画像を作れるもの)にする
  PC.isPdf = f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
  PC.markSource = async files => {
    const items = [], parts = [];
    for (const f of files) {
      const start = items.length;
      if (PC.isPdf(f)) {
        let doc;
        try { doc = await PC.openPdf(f.buf.slice(0)); } catch (e) { throw new Error(`「${f.name}」を開けません（${e && e.message ? e.message : e}）`); }
        for (let i = 0; i < doc.numPages; i++) items.push({ doc, i });
      } else if (PC.dataKind(f)) {
        for (const virt of await PC.readDataFile(f)) items.push({ virt, name: f.name });
      } else items.push({ file: new Blob([f.buf], { type: f.type }), name: f.name });
      parts.push({ name: f.name, start, pages: items.length - start });
    }
    return {
      numPages: items.length, parts,
      // 注釈(取り消し線・コメントなど)があり、文字データもあるページは「注釈を入れたPDF」。それ以外はスキャンとして扱う
      kind: async p => {
        const it = items[p];
        if (it.virt) return 'virtual';
        if (!it.doc) return 'scan';
        if (!(await PC.annotations(it.doc, it.i)).length) return 'scan';
        return (await PC.textChars(it.doc, it.i)).length ? 'annot' : 'scan';
      },
      page: p => items[p],
      label: p => (items[p].virt ? items[p].virt.label : null),   // データファイルのページの名前(シート名・スライド番号など)
      // スキャンとして読む画像。PDFは注釈も含めて300dpiで描画、画像はそのまま(大きすぎるものは縮める)
      image: async p => {
        const it = items[p];
        if (it.virt) return { img: it.virt.render(300), dpi: 300 };
        if (it.doc) return { img: await PC.renderPage(it.doc, it.i, 300, true), dpi: 300 };
        let bmp;
        try { bmp = await createImageBitmap(it.file); } catch (e) { throw new Error(`「${it.name}」を画像として開けません`); }
        const k = Math.min(1, 3600 / bmp.width), c = document.createElement('canvas');
        c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
        const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
        return { img: { w: c.width, h: c.height, d: ctx.getImageData(0, 0, c.width, c.height).data }, dpi: 0 };
      },
    };
  };

  // 画像をcanvasに(表示・切り抜き用)
  PC.toCanvas = img => {
    const c = document.createElement('canvas'); c.width = img.w; c.height = img.h;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.d), img.w, img.h), 0, 0);
    return c;
  };
})();
