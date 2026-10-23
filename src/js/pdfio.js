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

  PC.openPdf = async buf => pdfjsLib.getDocument({
    data: new Uint8Array(buf), CMapReaderFactory: EmbeddedCMap, StandardFontDataFactory: EmbeddedStdFont,
    cMapUrl: 'embedded/', cMapPacked: true, standardFontDataUrl: 'embedded/', useSystemFonts: false, isEvalSupported: false,
  }).promise;

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

  // スキャン: ページ順に1枚ずつ取り出せる形にする(全ページを一度に展開するとメモリが足りなくなるため)
  // PDFは各ページを300dpiで描画、画像はそのまま。複数ファイルはファイル名の順に並べる
  PC.scanSource = async files => {
    const items = [];
    for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }))) {
      if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
        const doc = await PC.openPdf(await f.arrayBuffer());
        for (let i = 0; i < doc.numPages; i++) items.push({ doc, i });
      } else items.push({ file: f });
    }
    return {
      count: items.length,
      get: async p => {
        const it = items[p]; if (!it) return null;
        if (it.doc) return PC.renderPage(it.doc, it.i, 300, false);
        const bmp = await createImageBitmap(it.file), c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0); bmp.close();
        return { w: c.width, h: c.height, d: ctx.getImageData(0, 0, c.width, c.height).data };
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
