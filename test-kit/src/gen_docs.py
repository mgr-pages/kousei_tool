# content.py から初校(old)・修正後(new)のHTMLを作る。PDF化は print.js(Chromium)で行う
import re, io, base64, sys, numpy as np
from PIL import Image, ImageDraw, ImageFilter
from content import *

MARK = re.compile(r'\[\[([^|\]]+)\|([^|\]]*)\|([^\]]*)\]\]')
def mk(s, v):
    def rep(m):
        gid, old, new = m.groups(); t = old if v == 'old' else new
        pre = ''
        if t.startswith('</p><p>'): pre, t = '</p><p>', t[len('</p><p>'):]
        return f'{pre}<span data-gt="{gid}">{t}</span>'
    return MARK.sub(rep, s)

def png(im):
    b = io.BytesIO(); im.save(b, 'PNG'); return 'data:image/png;base64,' + base64.b64encode(b.getvalue()).decode()

def photo(seed, alt):
    """店舗写真の代わりの画像(グラデーション+図形)。altは差し替え後"""
    rng = np.random.default_rng(seed); w, h = 700, 500
    y, x = np.mgrid[0:h, 0:w]
    base = np.stack([150+70*x/w, 170+50*y/h, 200-60*x/w], -1) if not alt else np.stack([200-50*y/h, 160+60*x/w, 140+40*y/h], -1)
    im = Image.fromarray(np.clip(base + rng.normal(0, 4, base.shape), 0, 255).astype(np.uint8)); d = ImageDraw.Draw(im)
    if not alt:
        d.rectangle([80, 260, 300, 480], fill=(240, 235, 220)); d.polygon([(60, 270), (190, 160), (320, 270)], fill=(170, 80, 60))
        d.ellipse([430, 90, 600, 260], fill=(250, 210, 70)); d.rectangle([380, 330, 640, 480], fill=(90, 120, 90))
    else:
        d.rectangle([60, 220, 640, 480], fill=(235, 230, 240)); d.rectangle([100, 280, 260, 480], fill=(120, 90, 160))
        d.ellipse([400, 60, 560, 220], fill=(255, 160, 120)); d.rectangle([320, 300, 600, 420], fill=(60, 140, 180))
    return png(im.filter(ImageFilter.GaussianBlur(1.2)))

def product(col, kind, alt=False):
    """商品写真の代わりの画像"""
    w, h = 520, 340; im = Image.new('RGB', (w, h), (245, 244, 240)); d = ImageDraw.Draw(im)
    c = tuple(int(v) for v in col)
    if alt:  # 差し替え後: 形と色が違う
        d.rounded_rectangle([150, 50, 370, 300], 40, fill=(150, 200, 170)); d.ellipse([215, 100, 305, 190], fill=(250, 250, 250))
    elif kind == 0: d.rounded_rectangle([180, 60, 340, 300], 50, fill=c); d.ellipse([230, 90, 290, 150], fill=(255, 255, 255))
    elif kind == 1: d.rectangle([240, 40, 270, 260], fill=c); d.rounded_rectangle([180, 250, 330, 300], 15, fill=c)
    elif kind == 2: d.polygon([(190, 300), (210, 110), (310, 110), (330, 300)], fill=(200, 200, 195)); d.rectangle([300, 140, 360, 170], fill=(120, 120, 120))
    elif kind == 3: d.line([(200, 300), (260, 120), (360, 90)], fill=(90, 90, 90), width=14); d.polygon([(330, 70), (400, 80), (370, 140)], fill=c)
    elif kind == 4: d.rounded_rectangle([170, 60, 350, 300], 30, fill=c); [d.line([(200, y), (320, y)], fill=(170, 190, 200), width=6) for y in range(100, 260, 25)]
    else: d.rounded_rectangle([130, 110, 390, 290], 20, fill=c); d.rectangle([160, 140, 330, 260], fill=(60, 50, 50))
    return png(im)

def chart(v):
    vals = [40, 55, 48, 70, 62] if v == 'old' else [40, 55, 48, 70, 80]
    bars = ''.join(f'<rect x="{30+i*30}" y="{140-h*1.4}" width="18" height="{h*1.4}" fill="#3a74b8"/>'
                   f'<text x="{39+i*30}" y="154" font-size="9" text-anchor="middle">{m}月</text>' for i, (h, m) in enumerate(zip(vals, [7, 8, 9, 10, 11])))
    return (f'<svg data-gt="U2" viewBox="0 0 200 160" style="position:absolute;top:150mm;left:100mm;width:70mm;height:56mm">'
            f'<text x="10" y="14" font-size="11" font-weight="700">来場者数の推移</text>'
            f'<line x1="22" y1="140" x2="190" y2="140" stroke="#333" stroke-width="1.2"/><line x1="22" y1="30" x2="22" y2="140" stroke="#333" stroke-width="1.2"/>{bars}</svg>')

def logo(v):
    top = 250 if v == 'old' else 244
    return (f'<svg data-gt="U3" viewBox="0 0 100 100" style="position:absolute;top:{top}mm;left:160mm;width:22mm;height:22mm">'
            '<rect x="4" y="4" width="92" height="92" rx="14" fill="#1f3c88"/><path d="M50 18 L82 76 L18 76 Z" fill="#fff"/><circle cx="50" cy="58" r="9" fill="#1f3c88"/></svg>')

CSS = '''
@import url("node_modules/@fontsource/noto-sans-jp/400.css"); @import url("node_modules/@fontsource/noto-sans-jp/700.css");
@import url("node_modules/@fontsource/noto-serif-jp/400.css"); @import url("node_modules/@fontsource/noto-serif-jp/700.css");
@page { size: A4; margin: 0 }
* { box-sizing: border-box } html, body { margin: 0; padding: 0 }
body { font-family: "Noto Sans JP"; color: #222; -webkit-print-color-adjust: exact; print-color-adjust: exact }
.page { position: relative; width: 210mm; height: 297mm; overflow: hidden; page-break-after: always; background: #fff }
.abs { position: absolute } p { margin: 0 }
.idbox { position: absolute; top: 9mm; right: 12mm; font-size: 8pt; color: #555; display: flex; align-items: center; gap: 2mm }
.idbox span { display: inline-block; width: 28mm; height: 8mm; border: 0.4mm solid #999 }
.label { position: absolute; bottom: 7mm; left: 20mm; font-size: 7pt; color: #888 }
.serif { font-family: "Noto Serif JP" }
.vert { writing-mode: vertical-rl }
'''

def page(n, inner):
    return (f'<div class="page" id="p{n}"><div class="idbox">記入者ID（黒で記入）<span></span></div>{inner}'
            f'<div class="label">校正テスト用ダミー原稿（内容はすべて架空です）　{n} / 4</div></div>')

def build(v):
    s = lambda x: mk(x, v)
    p1 = page(1, f'''
<div class="abs" style="top:20mm;left:20mm;font-size:22pt;font-weight:700">秋の新製品フェア 2026</div>
<div class="abs" style="top:22mm;left:122mm;background:#d7141a;color:#fff;font-weight:700;font-size:11pt;padding:1.2mm 3mm">期間限定</div>
<div class="abs" style="top:38mm;left:20mm;width:120mm;font-size:10.5pt;line-height:1.95"><p>{s(P1_LEAD)}</p></div>
<div class="abs" style="top:84mm;left:20mm;width:120mm;font-size:10.5pt;line-height:1.95"><p>{s(P1_BODY)}</p></div>
<div class="abs" style="top:110mm;left:20mm;width:120mm;font-size:10.5pt">{s(P1_DATE)}</div>
<div class="abs" style="top:120mm;left:20mm;width:78mm;border:0.5mm solid #444;padding:2mm 4mm">
  <div style="font-size:9pt">フェア特別価格</div><div style="font-size:22pt;font-weight:700">{s(P1_PRICE)}<span style="font-size:10pt">円（税込）</span></div></div>
<img data-gt="08" src="{photo(1, v == 'new')}" class="abs" style="top:152mm;left:20mm;width:70mm;height:50mm">
{chart(v)}{logo(v)}
<div class="abs" style="top:274mm;left:20mm;font-size:9pt">{s(P1_FOOT)}</div>''')
    p2b = s(P2_BODY)
    p2 = page(2, f'''
<div class="abs vert serif" style="top:24mm;right:22mm;height:120mm;font-size:20pt;font-weight:700">季節のたより</div>
<div class="abs vert serif" style="top:24mm;right:42mm;height:150mm;font-size:12pt;line-height:2.1;text-indent:1em"><p>{p2b}</p><p>{s(P2_BODY2)}</p></div>''')
    cards = ''
    for i, (name, code, price, col) in enumerate(P3_CARDS):
        r, c = divmod(i, 3); top, left = 34 + r*78, 20 + c*58
        img = product(col, i, alt=(i == 4 and v == 'new'))
        gid = ' data-gt="16"' if i == 4 else ''
        cards += (f'<div class="abs" style="top:{top}mm;left:{left}mm;width:52mm">'
                  f'<img{gid} src="{img}" style="display:block;width:52mm;height:34mm">'
                  f'<div style="font-size:9.5pt;font-weight:700;margin-top:2mm">{s(name)}</div>'
                  f'<div style="font-size:8pt;color:#555">品番：{s(code)}</div>'
                  f'<div style="color:#d7141a;font-weight:700;font-size:15pt">{s(price)}<span style="font-size:8pt">円（税込）</span></div></div>')
    rows = ''.join('<tr>' + ''.join(f'<{"th" if i == 0 else "td"} style="border:0.3mm solid #666;padding:1.2mm 2.5mm">{s(c)}</{"th" if i == 0 else "td"}>' for c in row) + '</tr>' for i, row in enumerate(P3_TABLE))
    p3 = page(3, f'''
<div class="abs" style="top:18mm;left:20mm;font-size:18pt;font-weight:700">商品ラインアップ</div>{cards}
<table class="abs" style="top:196mm;left:20mm;width:150mm;border-collapse:collapse;font-size:9pt">{rows}</table>
<div class="abs" style="top:236mm;left:20mm;width:165mm;font-size:8pt;line-height:1.8">{s(P3_NOTE1)}<br>{s(P3_NOTE2)}</div>''')
    paras = ''.join(f'<p style="margin-bottom:2.2mm"><span>{s(h)}</span>　{s(t)}</p>' for h, t in P4_PARAS)
    p4 = page(4, f'''
<div class="abs serif" style="top:18mm;left:20mm;font-size:16pt;font-weight:700">ご利用ガイド</div>
<div class="abs serif" style="top:34mm;left:20mm;width:150mm;height:150mm;column-count:2;column-gap:9mm;column-fill:auto;font-size:9.5pt;line-height:1.85;text-align:justify">{paras}</div>''')
    return f'<!doctype html><html lang="ja"><meta charset="utf-8"><style>{CSS}</style><body>{p1}{p2}{p3}{p4}</body></html>'

for v in ('old', 'new'): open(f'{v}.html', 'w').write(build(v))
print('ok')
