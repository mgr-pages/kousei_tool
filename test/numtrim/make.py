# 数字(金額・時刻・日付・重さ)の違いと、仕上がり(トンボ)の外の印刷用の情報(ページ情報)の模擬データを作る(文言はすべて架空)
#   python3 test/numtrim/make.py 出力フォルダ
#   old.pdf    : 旧版(仕上がり A4・トンボとページ情報つき。ページ情報の日時は 2026/10/29 14:23:05)
#   new.pdf    : 成果物(金額・時刻・日付・重さだけを変えたもの。ページ情報の日時は 2026/10/30 9:11:42)
#   genko.txt  : 原稿(テキスト。旧版と同じ数字。レイアウトが違う原稿として、成果物と数字だけが違う)
#   数字は「4,730→5,060」のように、区切り(「,」「:」「/」「.」「-」)の前後の両方の桁が変わるものにする
import sys, os
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

pdfmetrics.registerFont(TTFont('G', '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'))
TW, TH, BL, SL = 210 * mm, 297 * mm, 3 * mm, 15 * mm       # 仕上がりの幅・高さ、裁ち落とし、外側の余白
W, H = TW + 2 * SL, TH + 2 * SL
# (旧版, 成果物)。1行に1つ以上の数字
LINES = [
    ('そよかぜ扇風機　希望小売価格 {}円（税込）', ['4,730'], ['5,060']),
    ('営業時間 {}〜{}（土日は{}〜{}）', ['10:00', '18:00', '9:30', '17:00'], ['11:30', '19:00', '9:00', '17:30']),
    ('受付番号 {}', ['2026/10/01-1234'], ['2026/11/05-1239']),
    ('ぽかぽかヒーター　{}円', ['1,234,567'], ['1,334,568']),
    ('重さ {}kg', ['2.45'], ['3.15']),
    ('お問い合わせは、お客様相談室までお寄せください。', [], []),
]
STAMP = ('2026/10/29   14:23:05', '2026/10/30   9:11:42')     # ページ情報の日時(旧版, 成果物)

def text(k):
    return [s.format(*(o if k == 0 else n)) for s, o, n in LINES]

def make(path, k):
    c = canvas.Canvas(path, pagesize=(W, H))
    c.setTrimBox((SL, SL, SL + TW, SL + TH)); c.setBleedBox((SL - BL, SL - BL, SL + TW + BL, SL + TH + BL))
    c.setLineWidth(0.3); c.setStrokeColorRGB(0, 0, 0)
    for x in (SL, SL + TW):          # トンボ(角の線)
        for y in (SL, SL + TH):
            dx = -1 if x == SL else 1; dy = -1 if y == SL else 1
            c.line(x + dx * BL, y, x + dx * (SL - 2), y); c.line(x, y + dy * BL, x, y + dy * (SL - 2))
    c.setFont('G', 6); c.setFillColorRGB(0, 0, 0)
    c.drawString(SL + 5 * mm, SL - 10 * mm, 'numtrim_kt.indd   1')          # ページ情報(仕上がりの外)
    c.drawString(SL + TW - 45 * mm, SL - 10 * mm, STAMP[k])
    c.setFont('G', 18); c.drawString(SL + 20 * mm, SL + TH - 30 * mm, '新商品のご案内')
    c.setFont('G', 12)
    for i, s in enumerate(text(k)): c.drawString(SL + 20 * mm, SL + TH - 50 * mm - i * 12 * mm, s)
    c.setFont('G', 9); c.drawString(SL + TW / 2, SL + 10 * mm, '1')         # ページ番号(仕上がりの内側)
    c.showPage(); c.save()

out = sys.argv[1]; os.makedirs(out, exist_ok=True)
make(f'{out}/old.pdf', 0)
make(f'{out}/new.pdf', 1)
with open(f'{out}/genko.txt', 'w', encoding='utf-8') as f: f.write('\n'.join(['新商品のご案内'] + text(0)) + '\n')
print('ok', out)
