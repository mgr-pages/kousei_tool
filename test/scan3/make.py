# 紙の赤字原稿(旧版を刷ったもの)＋旧版＋成果物の模擬データ(文言はすべて架空)
#   python3 test/scan3/make.py 出力フォルダ   → old.pdf(旧版)・new.pdf(成果物)・scan.pdf(旧版を刷って赤字を書き込み、スキャンしたもの)・truth.json
#   旧版から成果物への変化:
#     指示どおり: 価格「9,800円」→「8,800円」(価格を丸で囲み、横に書き込み)、「期間限定」の行を消す(取り消し線)、見出しを大きく(「大きく」と矢印)
#     指示にない変化: 電話番号の1桁(文字)、写真の位置と色(見た目)
#     直していない赤字: 「お問い合わせ」の下線と書き込み(成果物で変わっていない)
#   スキャン: 150dpi で描き、わずかに回し、紙の色とノイズを足す。赤字は手書き風の太さ・揺れで描く
#   要るもの: reportlab・PyMuPDF・Pillow・numpy と IPAゴシック
import sys, os, json, math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import pymupdf

out = sys.argv[1] if len(sys.argv) > 1 else 'testdata/scan3'
os.makedirs(out, exist_ok=True)
FONT = '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'
pdfmetrics.registerFont(TTFont('G', FONT))
W, H = 595, 842

def page(path, new):
    c = canvas.Canvas(path, pagesize=(W, H))
    c.setTrimBox((20, 20, W - 20, H - 20))
    c.setFont('G', 30 if new else 22); c.drawString(60, 770, 'あたらしい暮らしの家電')                # 見出し(成果物は大きく)
    c.setFont('G', 12)
    y = 720
    for s in ['毎日の家事を、もっと楽しく。', 'しずかなサーキュレーターで、部屋の空気をやさしく動かします。', '軽くて持ち運びやすく、寝室でも使えます。']:
        c.drawString(60, y, s); y -= 22
    c.setFillColorRGB(0.85, 0.55, 0.3) if not new else c.setFillColorRGB(0.35, 0.6, 0.85)       # 写真(成果物は色と位置が違う)
    c.rect(330 if not new else 345, 430, 200, 150, fill=1, stroke=0)
    c.setFillColorRGB(0, 0, 0)
    c.setFont('G', 16); c.drawString(60, 560, '特別価格')
    c.setFont('G', 26); c.drawString(60, 525, '8,800円' if new else '9,800円')                       # 価格(指示どおりに直す)
    c.setFont('G', 12)
    if not new: c.drawString(60, 490, '期間限定・数量限定のご案内です。')                             # 消す行
    c.drawString(60, 400, 'ご購入・修理のお問い合わせは、お近くの販売店へ。')                           # 下線の指示(直していない)
    c.drawString(60, 378, '色は白・黒・緑の3色からお選びいただけます。')
    c.setFont('G', 10)
    c.drawString(60, 120, 'お客さま相談室　0120-555-018' if new else 'お客さま相談室　0120-555-013')     # 電話番号(指示にない変化)
    c.drawString(60, 104, '受付時間　平日9:00〜17:00')
    c.showPage(); c.save()

page(os.path.join(out, 'old.pdf'), False)
page(os.path.join(out, 'new.pdf'), True)

# スキャン: 旧版を描き、赤字を手書き風に書き込む
DPI = 150; k = DPI / 72
pix = pymupdf.open(os.path.join(out, 'old.pdf'))[0].get_pixmap(dpi=DPI)
img = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
rnd = random.Random(7)
d = ImageDraw.Draw(img)
RED = (214, 40, 46)
P = lambda x, y: (x * k, (H - y) * k)   # PDF の座標(左下が原点) → 画像の座標
def wobble(pts, amp=1.2):
    return [(x + rnd.uniform(-amp, amp), y + rnd.uniform(-amp, amp)) for x, y in pts]
def line(pts, w=3):
    d.line(wobble(pts), fill=RED, width=w, joint='curve')
def ellipse(cx, cy, rx, ry, w=3):
    pts = [P(cx + rx * math.cos(t / 40 * 2 * math.pi), cy + ry * math.sin(t / 40 * 2 * math.pi)) for t in range(43)]
    line(pts, w)
hand = ImageFont.truetype(FONT, int(14 * k))
def note(x, y, s):
    d.text(P(x, y), s, fill=RED, font=hand)
marks = []
# 1) 価格を丸で囲み、横に「8,800円」
ellipse(115, 534, 70, 22); note(200, 545, '8,800円に'); line([P(185, 534), P(200, 540)]); marks.append(dict(kind='A', what='価格', box=[45, 505, 260, 560]))
# 2) 「期間限定…」の行に取り消し線と「トル」
line([P(56, 494), P(256, 494)], 3); note(265, 500, 'トル'); marks.append(dict(kind='A', what='消す行', box=[56, 485, 300, 505]))
# 3) 見出しに「大きく」と矢印
note(330, 790, '大きく'); line([P(325, 780), P(300, 776)]); line([P(300, 776), P(306, 781)]); line([P(300, 776), P(306, 771)]); marks.append(dict(kind='A', what='見出し', box=[60, 765, 400, 800]))
# 4) 「お問い合わせ」に下線と書き込み(成果物では直していない)
line([P(118, 395), P(190, 395)], 3); note(120, 415, '「ご相談」に'); marks.append(dict(kind='B', what='お問い合わせ', box=[110, 390, 240, 430]))
truth = dict(marks=marks, changes=[dict(kind='C2', what='電話番号', before='3', after='8', box=[60, 115, 260, 132]), dict(kind='C3', what='写真', box=[330, 430, 545, 580])])
# 紙の色・わずかな回転・ノイズ
img = img.rotate(0.4, resample=Image.BICUBIC, fillcolor=(255, 255, 255))
a = np.asarray(img).astype(np.float32)
a = a * np.array([0.97, 0.96, 0.93]) + np.random.RandomState(7).normal(0, 4, a.shape)
img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.4))
img.save(os.path.join(out, 'scan.pdf'), 'PDF', resolution=DPI)
json.dump(truth, open(os.path.join(out, 'truth.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('ok', out)
