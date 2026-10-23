# 予行演習用: 赤字指示書の全項目を、模擬の朱書き(紙スキャン)とデジタル注釈で作る
#   python3 simulate.py ../src 出力フォルダ [乱数の種]
# 実際の校正者の筆跡の代わり。線は手ぶれ風に揺らし、スキャンは傾き・ノイズ・JPEG劣化を加える。
import sys, json, io, numpy as np, cv2, pymupdf
from PIL import Image, ImageDraw, ImageFont

src, out = sys.argv[1], sys.argv[2]; seed = int(sys.argv[3]) if len(sys.argv) > 3 else 1
rng = np.random.default_rng(seed); DPI = 200; K = DPI / 96          # CSS px → 200dpi px
R = {}
for r in json.load(open(f'{src}/old_rects.json')): R[r['id']] = [[v*K for v in q] for q in r['rects']]
INK = (205, 38, 48); PEN = (120, 120, 120)
FONT = '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'

def pen(d, pts, w=4, c=INK): d.line([(x+rng.normal(0, 1.1), y+rng.normal(0, 1.1)) for x, y in pts], fill=c, width=w, joint='curve')
def note(img, xy, text, c=INK, size=30, vert=False, ang=0):
    f = ImageFont.truetype(FONT, size)
    if vert:   # 縦書きの注記
        for i, ch in enumerate(text): ImageDraw.Draw(img).text((xy[0], xy[1] + i*(size+2)), ch, font=f, fill=c)
        return
    t = Image.new('RGBA', (900, size+16), (0, 0, 0, 0)); ImageDraw.Draw(t).text((4, 4), text, font=f, fill=c+(255,))
    t = t.rotate(ang + rng.normal(0, 1.5), expand=1, resample=Image.BICUBIC); img.paste(t, (int(xy[0]), int(xy[1])), t)
mid = lambda r: ((r[0]+r[2])/2, (r[1]+r[3])/2)

def paper(page_img, pno, d, img):
    """ページごとの朱書き。座標は200dpiの画素"""
    if pno == 1:
        MX = 1150
        a, b = R['01']; y = mid(a)[1]                                    # 01 行をまたぐ「めざし」: 2行とも取り消し、上の行間を通して右欄外へ
        pen(d, [(a[0]-2, y), (a[2]+3, y)]); yb = mid(b)[1]; pen(d, [(b[0]-2, yb), (b[2]+3, yb)])
        pen(d, [(a[2], y), (a[2]+18, a[1]-14), (MX, a[1]-14)], 3); note(img, (MX+6, a[1]-38), '目指し　以下同様')
        r = R['02'][0]; x = r[2]                                         # 02 挿入: くさび+引き出し線(上の行間を通る)
        pen(d, [(x-11, r[3]+12), (x, r[3]-4), (x+11, r[3]+12)]); pen(d, [(x+11, r[3]+12), (x+25, r[3]+16), (MX, r[3]+16)], 3); note(img, (MX+6, r[3]-8), '全国の店舗で')
        r = R['03'][0]; x = r[0]                                         # 03 挿入(ご): 引き出し線が下の2行を斜めに横切る(難しい例)
        pen(d, [(x-11, r[3]+12), (x, r[3]-4), (x+11, r[3]+12)]); pen(d, [(x, r[3]+12), (x+90, r[3]+150), (MX, r[3]+150)], 3); note(img, (MX+6, r[3]+128), 'ご')
        note(img, (MX+6, 700), '全体的に「お問い合わせ」→「お問合せ」', size=26)   # 04 全体指示(場所を指さない)
        r = R['05'][0]; y = mid(r)[1]                                    # 05 トル
        pen(d, [(r[0]-2, y), (r[2]+2, y)]); pen(d, [(r[0]+10, y), (r[0]-30, r[3]+28)], 3); note(img, (r[0]-110, r[3]+18), 'トル')
        r = R['06'][0]; y = mid(r)[1]                                    # 06 価格: 二重線+近くに赤字
        pen(d, [(r[0]-3, y-5), (r[2]+3, y-3)]); pen(d, [(r[0]-3, y+4), (r[2]+3, y+6)]); pen(d, [(r[2]+3, y), (840, y)], 3); note(img, (846, y-22), '11,800', size=34)
        r = R['07'][0]; cx, cy = mid(r)                                  # 07 曜日: 1字だけ斜線
        pen(d, [(cx+14, r[1]+2), (cx-14, r[3]-2)]); pen(d, [(cx+14, r[1]+2), (cx+40, r[1]-34)], 3); note(img, (cx+38, r[1]-68), '木')
        r = R['08'][0]; cx, cy = mid(r)                                  # 08 写真: 丸で囲み+「写真差し替え」
        d.ellipse([r[0]+40, r[1]+30, r[2]-40, r[3]-30], outline=INK, width=4); pen(d, [(r[2]-60, r[1]+60), (r[2]+60, r[1]-40)], 3)
        note(img, (r[2]+60, r[1]-70), '写真差し替え')
        r = R['P1'][0]                                                   # P1 鉛筆の疑問出し
        d.ellipse([r[0]-6, r[1]-6, r[2]+6, r[3]+6], outline=PEN, width=2); note(img, (MX+6, r[1]-10), '？数値の根拠を確認', c=PEN, size=24)
    if pno == 2:
        BOT = 1440
        def vstrike(r): x = mid(r)[0]; pen(d, [(x, r[1]-2), (x, r[3]+2)])
        r = R['09'][0]; vstrike(r); g = r[2]+18                          # 09 列の右のすき間を通して下の余白へ
        pen(d, [(mid(r)[0], mid(r)[1]), (g, mid(r)[1]+20), (g, BOT)], 3); note(img, (g-14, BOT+8), '始める', vert=True)
        r = R['10'][0]; cx, cy = mid(r)                                  # 10 春→夏: 引き出し線が左の2列を斜めに横切る
        pen(d, [(cx+14, r[1]+2), (cx-14, r[3]-2)]); pen(d, [(cx-14, r[3]-2), (cx-160, r[3]+260), (cx-160, BOT)], 3); note(img, (cx-175, BOT+8), '夏', vert=True)
        r = R['11'][0]; vstrike(r); g = r[0]-18                          # 11 店頭→各店舗(修正後で未反映)
        pen(d, [(mid(r)[0], mid(r)[1]), (g, mid(r)[1]+20), (g, BOT)], 3); note(img, (g-14, BOT+8), '各店舗', vert=True)
        r = R['12'][0]; x0, x1, y = r[0]-6, r[2]+6, r[1]-3               # 12 改行の記号(「今年は」の前で折り返す)
        pen(d, [(x1, y), (x0, y), (x0-25, y+30)]); pen(d, [(x0-25, y+30), (x0-25, BOT-80)], 3); note(img, (x0-40, BOT-70), '改行', vert=True)
        r = R['13'][0]                                                   # 13 ママ
        d.ellipse([r[0]-8, r[1]-8, r[2]+8, r[3]+8], outline=INK, width=4); pen(d, [(r[2]+8, mid(r)[1]), (r[2]+40, mid(r)[1]-30)], 3); note(img, (r[2]+30, mid(r)[1]-110), 'ママ', vert=True)
    if pno == 3:
        r = R['14'][0]; y = mid(r)[1]                                    # 14 赤い価格の上に赤字
        pen(d, [(r[0]-3, y-3), (r[2]+3, y+2)]); pen(d, [(r[2], y), (r[2]+12, r[1]-6), (r[2]+110, r[1]-6)], 3); note(img, (r[2]+112, r[1]-28), '18,800', size=26)
        r = R['15'][0]; y = mid(r)[1]                                    # 15 品番(修正後で未反映)
        pen(d, [(r[0]-2, y), (r[2]+2, y)]); pen(d, [(r[2], y), (r[2]+150, y)], 3); note(img, (r[2]+152, y-20), 'LD-56', size=26)
        r = R['16'][0]                                                   # 16 商品写真: ×印+差替
        pen(d, [(r[0]+20, r[1]+20), (r[2]-20, r[3]-20)]); pen(d, [(r[2]-20, r[1]+20), (r[0]+20, r[3]-20)]); note(img, (r[2]-120, r[1]-40), '差替')
        r = R['17'][0]; x = r[2]                                         # 17 商品名の後ろに挿入
        pen(d, [(x-11, r[1]-6), (x, r[1]+10), (x+11, r[1]-6)]); pen(d, [(x+11, r[1]-6), (x+40, r[1]-14), (x+70, r[1]-14)], 3); note(img, (x+72, r[1]-38), '（0.8L）', size=26)
        r = R['18'][0]; cx, cy = mid(r)                                  # 18 表の中: 斜線+近くに赤字
        pen(d, [(r[0]+4, r[3]), (r[2]-4, r[1])]); note(img, (r[2]+20, r[1]-6), '2年')
    if pno == 4:
        RM = 1360
        r = R['19'][0]; y = mid(r)[1]                                    # 19 取り消し+右段の行間を通して右欄外へ(段をまたぐ)
        pen(d, [(r[0]-2, y), (r[2]+2, y)]); gy = r[1]-10
        pen(d, [(r[2], y), (r[2]+12, gy), (RM, gy)], 3); note(img, (RM+6, gy-22), 'になれます')
        a, b = R['20']; ya, yb = mid(a)[1], mid(b)[1]                    # 20 2行にわたる1文を削除
        pen(d, [(a[0]-2, ya), (a[2]+2, ya)]); pen(d, [(b[0]-2, yb), (b[2]+2, yb)]); pen(d, [(b[2], yb), (b[2]+20, yb+22), (RM, yb+22)], 3); note(img, (RM+6, yb+2), 'トル')
        r = R['21'][0]                                                   # 21 見出しを太字に
        d.ellipse([r[0]-8, r[1]-6, r[2]+8, r[3]+6], outline=INK, width=4); pen(d, [(r[2]+8, mid(r)[1]), (r[2]+30, r[1]-30), (RM, r[1]-30)], 3); note(img, (RM+6, r[1]-52), '太字')
        r = R['22'][0]; x = (r[0]+r[2])/2 + (r[2]-r[0])/4                # 22 「障」に斜線
        pen(d, [(x+10, r[1]+2), (x-10, r[3]-2)]); pen(d, [(x+10, r[1]+2), (x+20, r[1]-12), (1360, r[1]-12)], 3); note(img, (1366, r[1]-34), '証')
        r = R['23'][0]; x = r[0]                                         # 23 読点の挿入
        pen(d, [(x-10, r[3]+11), (x, r[3]-4), (x+10, r[3]+11)]); pen(d, [(x-10, r[3]+11), (x-25, r[3]+16), (130, r[3]+16)], 3); note(img, (100, r[3]-2), '、')
        r = R['P2'][0]                                                   # P2 鉛筆
        d.ellipse([r[0]-6, r[1]-6, r[2]+6, r[3]+6], outline=PEN, width=2); note(img, (r[0], r[3]+4), '７日では？', c=PEN, size=24)
        d.ellipse([1430, 2050, 1560, 2180], outline=(215, 40, 40), width=6); note(img, (1452, 2094), '校了', c=(215, 40, 40), size=34)   # S1 印鑑

doc = pymupdf.open(f'{src}/old.pdf'); scan = pymupdf.open()
for pno in range(1, 5):
    pix = doc[pno-1].get_pixmap(dpi=DPI); img = Image.frombytes('RGB', (pix.width, pix.height), pix.samples); d = ImageDraw.Draw(img)
    note(img, (1380, 64), 'T1', c=(30, 30, 30), size=34)                 # 記入者ID(黒)
    paper(img, pno, d, img)
    a = np.array(img).astype(np.float32); h, w = a.shape[:2]
    M = cv2.getRotationMatrix2D((w/2, h/2), rng.uniform(-1.8, 1.8), rng.uniform(0.98, 1.02)); M[:, 2] += rng.uniform(-30, 30, 2)
    a = cv2.warpAffine(a, M, (w, h), borderValue=(255, 255, 255)) * (np.array([250, 247, 238])/255.0)
    a = np.clip(cv2.GaussianBlur(a, (3, 3), 0.8) + rng.normal(0, 7, a.shape), 0, 255).astype(np.uint8)
    ok, jpg = cv2.imencode('.jpg', cv2.cvtColor(a, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 70])
    pg = scan.new_page(width=595.28, height=841.89); pg.insert_image(pg.rect, stream=jpg.tobytes())
scan.save(f'{out}/T1_scan.pdf')

# デジタル朱入れ(Acrobatの注釈に相当)
doc = pymupdf.open(f'{src}/old.pdf'); RED = (1, 0, 0); P = lambda r: pymupdf.Rect(*[v*72/DPI for v in r])
VQ = lambda r: pymupdf.Quad(pymupdf.Point(r.x1, r.y0), pymupdf.Point(r.x1, r.y1), pymupdf.Point(r.x0, r.y0), pymupdf.Point(r.x0, r.y1))   # 縦組み: 列に沿った向き
def done(a, text=''): a.set_colors(stroke=RED); a.set_info(content=text); a.update(); return a
p1, p2, p3, p4 = doc[0], doc[1], doc[2], doc[3]
done(p1.add_strikeout_annot([P(r).quad for r in R['01']]), '目指し（以下同様）')
r = P(R['02'][0]); done(p1.add_caret_annot(pymupdf.Point(r.x1, r.y1)), '全国の店舗で')
r = P(R['03'][0]); done(p1.add_caret_annot(pymupdf.Point(r.x0, r.y1)), 'ご')
ft = p1.add_freetext_annot(pymupdf.Rect(420, 180, 585, 215), '全体的に「お問い合わせ」→「お問合せ」', fontsize=8, text_color=RED); ft.update()
done(p1.add_strikeout_annot(P(R['05'][0]).quad), 'トル')
done(p1.add_strikeout_annot(P(R['06'][0]).quad), '11,800')
r = P(R['07'][0]); q = pymupdf.Rect(r.x0 + r.width*0.3, r.y0, r.x1 - r.width*0.3, r.y1); done(p1.add_strikeout_annot(q.quad), '（木）')
r = P(R['08'][0]); done(p1.add_ink_annot([[(r.x0+r.width/2+r.width*0.42*np.cos(t), r.y0+r.height/2+r.height*0.42*np.sin(t)) for t in np.linspace(0, 2*np.pi, 50)]]), '写真差し替え')
done(p2.add_strikeout_annot(VQ(P(R['09'][0]))), '始める')
done(p2.add_strikeout_annot(VQ(P(R['10'][0]))), '夏')
done(p2.add_strikeout_annot(VQ(P(R['11'][0]))), '各店舗')
r = P(R['12'][0]); done(p2.add_ink_annot([[(r.x1+3, r.y0-2), (r.x0-3, r.y0-2), (r.x0-12, r.y0+12)]]), '改行')
r = P(R['13'][0]); done(p2.add_ink_annot([[(r.x0+r.width/2+(r.width/2+4)*np.cos(t), r.y0+r.height/2+(r.height/2+4)*np.sin(t)) for t in np.linspace(0, 2*np.pi, 40)]]), 'ママ')
done(p3.add_strikeout_annot(P(R['14'][0]).quad), '18,800')
done(p3.add_strikeout_annot(P(R['15'][0]).quad), 'LD-56')
r = P(R['16'][0]); done(p3.add_ink_annot([[(r.x0+8, r.y0+8), (r.x1-8, r.y1-8)], [(r.x1-8, r.y0+8), (r.x0+8, r.y1-8)]]), '差替')
r = P(R['17'][0]); done(p3.add_caret_annot(pymupdf.Point(r.x1, r.y1)), '（0.8L）')
done(p3.add_strikeout_annot(P(R['18'][0]).quad), '2年')
done(p4.add_strikeout_annot(P(R['19'][0]).quad), 'ご利用になれます')
done(p4.add_strikeout_annot([P(r).quad for r in R['20']]), 'トル')
r = P(R['21'][0]); done(p4.add_ink_annot([[(r.x0+r.width/2+(r.width/2+5)*np.cos(t), r.y0+r.height/2+(r.height/2+4)*np.sin(t)) for t in np.linspace(0, 2*np.pi, 40)]]), '太字')
r = P(R['22'][0]); q = pymupdf.Rect(r.x0 + r.width/2, r.y0, r.x1, r.y1); done(p4.add_strikeout_annot(q.quad), '証')
r = P(R['23'][0]); done(p4.add_caret_annot(pymupdf.Point(r.x0, r.y1)), '、')
doc.save(f'{out}/T1_digital.pdf'); print('ok')
