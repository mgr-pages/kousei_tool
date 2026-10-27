# 商品マスタのような表(Excel)と、その一部の列を載せたカタログPDFの模擬データを作る(自動テスト用。品番・商品名などはすべて架空)
#   python3 test/records/make.py 出力フォルダ
#   → master.xlsx(原稿) と catalog.pdf(成果物 2ページ・トンボと仕上がりの範囲つき)、catalog_objstm.pdf(同じ中身で、ページの辞書を圧縮したもの)
#   カタログには、決まった違いとページの端の切れ端を入れてある(正解は test/records/gt.json)
import sys, os
from openpyxl import Workbook
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.units import mm

out = sys.argv[1] if len(sys.argv) > 1 else 'testdata/records'
os.makedirs(out, exist_ok=True)
pdfmetrics.registerFont(TTFont('G', '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'))

# ---- 原稿: 商品マスタ(1行が1商品。カタログに載るのは品番・入数・単位・価格だけ) ----
#   (品番, 色柄, 厚, 幅, 入数, 単位, 価格)
SHOWN = [
    ('KT21-NA', 'ナチュラル柄', 2.5, 300.0, 16, '箱', 12800),
    ('KT21-WH', 'ホワイト柄', 2.5, 300.0, 16, '箱', 12800),
    ('KT21-GR', 'グレー柄', 2.5, 300.0, 16, '箱', 12800),      # カタログは KT27-GR(品番の1字違い)
    ('KT21-BK', 'ブラック柄', 2.5, 300.0, 16, '箱', 13500),    # カタログは ¥13,000(価格の違い)
    ('KT22-OK', 'オーク柄', 3.0, 150.0, 12, '箱', 15200),      # カタログは 14枚(入数の違い)
    ('KT22-WN', 'ウォルナット柄', 3.0, 150.0, 12, '箱', 15200),
    ('KT22-CH', 'チェリー柄', 3.0, 150.0, 12, '箱', 15200),    # カタログに載せ忘れ
    ('KT22-MA', 'メープル柄', 3.0, 150.0, 12, '箱', 15200),
]
# このカタログには載せない別の商品(品番の形が違う)
HIDDEN = [(f'KT9-{w}{c}', c, 4.0, w, 1, '本', 3600 + w) for w in (120, 240) for c in ('NA', 'WH', 'GR')][:5]
wb = Workbook()
ws = wb.active
ws.title = 'データシート'
ws.append(['商品データ（架空）'])
ws.append(['', '半角10字以内', '半角10字以内', '全角', '小数1桁', '整数', '整数', '全角', '整数', '8桁'])   # 入力の決まり(非表示の行)
ws.row_dimensions[2].hidden = True
ws.append(['区分', '注文コード（必須）', '品番（必須）', '色柄', '厚', '幅', '入数', '単位', '設計価格', '発売日'])
for code, name, t, w, n, u, pr in SHOWN + HIDDEN:
    ws.append(['床材', code.replace('-', ''), code, name, t, w, n, u, pr, 20270401])
wb.save(os.path.join(out, 'master.xlsx'))

# ---- 成果物: カタログ(仕上がり A4、裁ち落とし 3mm、トンボとファイル名・日時の印刷用の情報つき) ----
TW, TH, BL, SL = 210 * mm, 297 * mm, 3 * mm, 15 * mm       # 仕上がりの幅・高さ、裁ち落とし、外側の余白
W, H = TW + 2 * SL, TH + 2 * SL
c = canvas.Canvas(os.path.join(out, 'catalog.pdf'), pagesize=(W, H))

def marks(page):
    c.setTrimBox((SL, SL, SL + TW, SL + TH)); c.setBleedBox((SL - BL, SL - BL, SL + TW + BL, SL + TH + BL))
    c.setLineWidth(0.3); c.setStrokeColorRGB(0, 0, 0)
    for x in (SL, SL + TW):          # トンボ(角の線)
        for y in (SL, SL + TH):
            dx = -1 if x == SL else 1; dy = -1 if y == SL else 1
            c.line(x + dx * BL, y, x + dx * (SL - 2), y); c.line(x, y + dy * BL, x, y + dy * (SL - 2))
    c.setFont('G', 6); c.setFillColorRGB(0, 0, 0)
    c.drawString(SL + 5 * mm, SL - 10 * mm, f'katalog_kt.indd   {page}')       # 印刷用の情報(どのページにも同じ位置にある)
    c.drawString(SL + TW - 40 * mm, SL - 10 * mm, '2027/03/15   10:00')

def item(x, y, name, code, price, n, area):
    c.setFont('G', 8); c.setFillColorRGB(0.2, 0.2, 0.2); c.drawString(x, y, f'〈{name}〉')
    c.setFont('G', 9); c.setFillColorRGB(0, 0.6, 0.85); c.drawString(x, y - 12, code)
    c.setFillColorRGB(0, 0, 0); c.drawString(x + 46, y - 12, f'¥{price:,}/箱（{n}枚・{area}㎡）')

def page(no, title, rows, extra):
    marks(no)
    c.setFillColorRGB(0, 0, 0); c.setFont('G', 16); c.drawString(SL + 20 * mm, SL + TH - 30 * mm, title)
    c.setFont('G', 9); c.drawString(SL + 20 * mm, SL + TH - 40 * mm, '木目の表情をいかした床材です。施工の前に、下地の状態をご確認ください。')
    for k, r in enumerate(rows):
        item(SL + 20 * mm + (k % 2) * 85 * mm, SL + TH - 60 * mm - (k // 2) * 22 * mm, *r)
    c.setFont('G', 9); c.setFillColorRGB(0, 0, 0); c.drawString(SL + TW / 2, SL + 10 * mm, str(no))   # ページ番号(仕上がりの内側)
    extra()
    c.showPage()

def extra1():
    # 仕上がりの外(裁ち落としよりも外)に残ったデータの切れ端
    c.setFont('G', 6); c.setFillColorRGB(0.2, 0.2, 0.2); c.drawString(2 * mm, SL + 120 * mm, '部材（巾木')

def extra2():
    # ページの右の端で切れている切れ端(ほかのページの一部)
    c.setFont('G', 8); c.setFillColorRGB(0.2, 0.2, 0.2); c.drawString(W - 4 * mm, SL + 150 * mm, '〈ホワイ')
    c.setFillColorRGB(0, 0.6, 0.85); c.drawString(W - 3 * mm, SL + 150 * mm - 11, 'KT2')
    # 仕上がり線にかかって切れる字
    c.setFillColorRGB(0, 0, 0); c.setFont('G', 8); c.drawString(SL - 6 * mm, SL + 40 * mm, '※写真はイメージです')

page(1, '床材 KTシリーズ 2.5mm', [
    ('ナチュラル柄', 'KT21-NA', 12800, 16, 2.56),
    ('ホワイト柄', 'KT21-WH', 12800, 16, 2.56),
    ('グレー柄', 'KT27-GR', 12800, 16, 2.56),
    ('ブラック柄', 'KT21-BK', 13000, 16, 2.56),
], extra1)
page(2, '床材 KTシリーズ 3.0mm', [
    ('オーク柄', 'KT22-OK', 15200, 14, 1.62),
    ('ウォルナット柄', 'KT22-WN', 15200, 12, 1.62),
    ('メープル柄', 'KT22-MA', 15200, 12, 1.62),
], extra2)
c.save()

# 同じ中身で、ページの辞書を圧縮したオブジェクト(ObjStm)に入れたもの(仕上がりの範囲を、圧縮の中からも読めるかの確認)
import pymupdf
d = pymupdf.open(os.path.join(out, 'catalog.pdf'))
d.save(os.path.join(out, 'catalog_objstm.pdf'), use_objstms=True, deflate=True, garbage=1)
print('作成:', out)
