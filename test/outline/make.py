# 一部の文字だけをアウトライン化した(文字を線で描いた)成果物の模擬データを作る(文言はすべて架空)
#   python3 test/outline/make.py 出力フォルダ
#   genko.pdf      : 原稿(すべて文字データのある文字。同じレイアウト)
#   genko.txt      : 原稿(テキスト。レイアウトが違う原稿として使う)
#   seika.pdf      : 成果物(2つ目の段落と見出しだけをアウトライン化。文字は原稿と同じ)
#   seika_ng.pdf   : 成果物(アウトライン化した段落の中で1字違う：「速暖」→「即暖」、見出しの「秋」→「冬」)
#   old.pdf        : 旧版(すべて文字データのある文字。成果物と同じ文)
#   アウトラインは、フォントの字形をそのまま同じ位置に線で描く(文字データだけがなくなる)
import sys, os
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from fontTools.ttLib import TTFont as FTFont
from fontTools.pens.basePen import BasePen

FONT = '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'
pdfmetrics.registerFont(TTFont('ipag', FONT))
ft = FTFont(FONT)
GS, CMAP, UPM, HMTX = ft.getGlyphSet(), ft.getBestCmap(), ft['head'].unitsPerEm, ft['hmtx']

class Pen(BasePen):
    def __init__(self, path, x, y, s):
        super().__init__(GS); self.p, self.x, self.y, self.s = path, x, y, s
    def T(self, q): return (self.x + q[0] * self.s, self.y + q[1] * self.s)
    def _moveTo(self, q): self.p.moveTo(*self.T(q))
    def _lineTo(self, q): self.p.lineTo(*self.T(q))
    def _curveToOne(self, a, b, c): self.p.curveTo(*self.T(a), *self.T(b), *self.T(c))
    def _closePath(self): self.p.close()

def outlined(c, text, x, y, size):
    s = size / UPM; path = c.beginPath()
    for ch in text:
        g = CMAP.get(ord(ch))
        if g is None: continue
        GS[g].draw(Pen(path, x, y, s)); x += HMTX[g][0] * s
    c.drawPath(path, fill=1, stroke=0, fillMode=1)   # 1: 非ゼロ回転数規則(TrueType の字形)

TITLE = '秋の新商品のご案内'
PARAS = [
    '春の新商品のお知らせです。そよかぜ扇風機は、静かな運転と軽い本体が特長です。お部屋の空気をやさしく循環させます。',
    'ぽかぽかヒーターは、すぐに暖まる速暖モードを備えています。電源は家庭用コンセントです。転倒すると自動で止まります。',
    'お問い合わせは、お客様相談室までお寄せください。受付時間は平日の午前9時から午後5時までです。',
]
PER_LINE = 26

def page(path, out_title=False, out_para=None, ng=False):
    c = canvas.Canvas(path, pagesize=(595, 842))
    t = TITLE.replace('秋', '冬') if ng else TITLE
    (outlined if out_title else lambda c, s, x, y, z: (c.setFont('ipag', z), c.drawString(x, y, s)))(c, t, 60, 770, 22)
    y = 720
    for k, p in enumerate(PARAS):
        if ng and k == out_para: p = p.replace('速暖', '即暖')
        for i in range(0, len(p), PER_LINE):
            line = p[i:i + PER_LINE]
            if k == out_para: outlined(c, line, 60, y, 16)
            else: c.setFont('ipag', 16); c.drawString(60, y, line)
            y -= 24
        y -= 18
    c.showPage(); c.save()

out = sys.argv[1]; os.makedirs(out, exist_ok=True)
page(f'{out}/genko.pdf')
page(f'{out}/old.pdf')
page(f'{out}/seika.pdf', out_title=True, out_para=1)
page(f'{out}/seika_ng.pdf', out_title=True, out_para=1, ng=True)
with open(f'{out}/genko.txt', 'w', encoding='utf-8') as f: f.write('\n'.join([TITLE] + PARAS) + '\n')
print('ok', out)
