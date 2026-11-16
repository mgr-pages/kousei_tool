# 小さな字をアウトライン化した(文字を線で描いた)旧版・成果物の模擬データを作る(文言はすべて架空)
#   python3 test/outline/make_small.py 出力フォルダ
#   small.pdf       : 旧版(見出し 22pt・価格 8pt・仕様 6pt をアウトライン化。説明の文は文字データのある文字)
#   small_ng.pdf    : 成果物(アウトライン化した 8pt の価格「12,800」→「12,600」、6pt の仕様「1,200W」→「1,250W」を1字ずつ変える)
#   small_shift.pdf : 成果物(旧版と同じ。アウトライン化した字だけを 0.06pt 右下へずらす。書き出し直しの小さなずれ。何も出ないはず)
#   原稿なしで旧版と成果物を比べる試験に使う(どちらもアウトライン化した所は文字データがないので、その所を描いて見た目で比べる)
#   最後に、変えた字の所(200dpi の画素)を出す(test/outline/gt.json の old_small に書く)
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

def advance(text, size, upto):
    s = size / UPM; return sum(HMTX[CMAP[ord(ch)]][0] * s for ch in text[:upto] if ord(ch) in CMAP)

def outlined(c, text, x, y, size):
    s = size / UPM; path = c.beginPath()
    for ch in text:
        g = CMAP.get(ord(ch))
        if g is None: continue
        GS[g].draw(Pen(path, x, y, s)); x += HMTX[g][0] * s
    c.drawPath(path, fill=1, stroke=0, fillMode=1)

H = 842
LINES = [   # (文, 大きさ pt, 左, 下, アウトライン化するか, 成果物で変える前, 変えたあと)
    ('冬のおすすめ家電', 22, 60, 770, True, None, None),
    ('ぽかぽかヒーターは、すぐに暖まる速暖モードを備えています。', 12, 60, 730, False, None, None),
    ('ぽかぽかヒーター　本体価格 12,800円（税込）', 8, 60, 700, True, '12,800', '12,600'),
    ('型番 PH-2026A　消費電力 1,200W　質量 3.2kg', 6, 60, 684, True, '1,200W', '1,250W'),
    ('そよかぜ扇風機　本体価格 9,800円（税込）', 8, 60, 660, True, None, None),
    ('型番 SF-2026B　消費電力 25W　質量 2.1kg', 6, 60, 646, True, None, None),
    ('お問い合わせは、お客様相談室までお寄せください。', 12, 60, 610, False, None, None),
]

def page(path, ng=False, dx=0.0, dy=0.0):
    c = canvas.Canvas(path, pagesize=(595, H))
    for text, size, x, y, out, frm, to in LINES:
        t = text.replace(frm, to) if (ng and frm) else text
        if out: outlined(c, t, x + dx, y - dy, size)
        else: c.setFont('ipag', size); c.drawString(x, y, t)
    c.showPage(); c.save()

out = sys.argv[1]; os.makedirs(out, exist_ok=True)
page(os.path.join(out, 'small.pdf'))
page(os.path.join(out, 'small_ng.pdf'), ng=True)
page(os.path.join(out, 'small_shift.pdf'), dx=0.06, dy=0.06)
K = 200 / 72
for text, size, x, y, out_, frm, to in LINES:
    if not frm: continue
    i = text.index(frm); k = next(j for j in range(len(frm)) if frm[j] != to[j])   # 変えた字
    x0 = x + advance(text, size, i + k); x1 = x + advance(text, size, i + k + 1)
    print(f'{size}pt「{frm}」→「{to}」: box(200dpi) {[round(x0 * K), round((H - y - size) * K), round(x1 * K), round((H - y + 0.2 * size) * K)]}')
