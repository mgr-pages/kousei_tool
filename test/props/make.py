# 性質の試験に使う、デザインの多い架空のチラシとカタログ(文言・店名・商品はすべて架空)
#   python3 test/props/make.py 出力フォルダ   → design.pdf(2ページ)
#   実物の印刷物で、同じPDFどうしを比べても項目が出た原因(デザインの赤い要素を赤字の書き込みと読む、字形の切り分けが揺れる)を
#   再現するための要素を入れてある: 赤〜橙のグラデーションの帯、赤みのある写真(JPEG)、大きな赤い見出し(字間を詰めたもの)、
#   赤い丸の札と白抜きの字、桃色の囲み、赤い細い線と点線、赤い見出しの表、赤い価格、小さい字(6.5pt)、色地に白抜きの字
#   要るもの: reportlab・Pillow・numpy と IPAゴシック
import sys, os, io
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

out = sys.argv[1] if len(sys.argv) > 1 else 'testdata/props'
os.makedirs(out, exist_ok=True)
pdfmetrics.registerFont(TTFont('G', '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'))
pdfmetrics.registerFont(TTFont('P', '/usr/share/fonts/opentype/ipafont-gothic/ipagp.ttf'))
rng = np.random.default_rng(20261112)

def jpeg(img, q=72):
    b = io.BytesIO(); img.convert('RGB').save(b, 'JPEG', quality=q); b.seek(0); return ImageReader(b)

def gradient(w, h, c0, c1):
    t = np.linspace(0, 1, w)[None, :, None]; a = np.array(c0, float)[None, None, :] * (1 - t) + np.array(c1, float)[None, None, :] * t
    return Image.fromarray(np.repeat(a, h, 0).astype(np.uint8))

def photo(w, h, base, spots, seed):
    # 赤みのある写真のかわり: 地の色のむら＋ぼかした丸(りんご・トマトのような赤、桃色、濃い赤)＋粒
    r = np.random.default_rng(seed)
    a = np.ones((h, w, 3), float) * np.array(base, float)
    a += r.normal(0, 9, (h, w, 1)) + r.normal(0, 4, (h, w, 3))
    im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)); d = ImageDraw.Draw(im)
    for _ in range(spots):
        x, y, s = r.integers(0, w), r.integers(0, h), r.integers(h // 6, h // 2)
        col = [(205, 40, 38), (232, 96, 80), (244, 170, 160), (150, 22, 30), (236, 120, 40)][r.integers(0, 5)]
        d.ellipse([x - s, y - s, x + s, y + s], fill=col)
        d.ellipse([x - s // 3, y - s // 2, x, y - s // 6], fill=tuple(min(255, c + 50) for c in col))
    return im.filter(ImageFilter.GaussianBlur(1.6))

def badge(c, x, y, r, text, size):
    c.setFillColorRGB(0.86, 0.1, 0.12); c.circle(x, y, r, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1); c.setFont('G', size); c.drawCentredString(x, y - size * 0.35, text)

W, H = 842, 595
c = canvas.Canvas(os.path.join(out, 'design.pdf'), pagesize=(W, H))

# ---- 1ページ目: チラシ ----
c.setFillColorRGB(0.99, 0.97, 0.93); c.rect(0, 0, W, H, fill=1, stroke=0)
c.drawImage(jpeg(gradient(842, 110, (214, 30, 40), (245, 150, 40)), 80), 0, H - 110, 842, 110)
c.setFillColorRGB(1, 1, 1); c.setFont('G', 34); c.drawString(36, H - 62, 'みのり市場　秋の収穫まつり')
c.setFont('G', 13); c.drawString(38, H - 90, '11月21日（土）・22日（日）　午前9時〜午後4時　／　会場：みのり市場 中央広場')
badge(c, 770, H - 56, 40, '入場無料', 15)
c.setFillColorRGB(0.82, 0.08, 0.1); c.setFont('G', 30)
t = c.beginText(36, H - 158); t.setFont('G', 30); t.setCharSpace(-2.2); t.textLine('とれたて野菜と果物が大集合'); c.drawText(t)
c.setFillColorRGB(0.1, 0.1, 0.1); c.setFont('P', 10.5)
for k, line in enumerate(['近くの農家から届いた旬の野菜と果物を、広場いっぱいに並べます。', '試食のコーナーや、こども向けの収穫体験もあります。雨の日は屋根のある通路で開きます。']):
    c.drawString(38, H - 184 - 15 * k, line)
items = [('りんご（ふじ）', '1袋 5個入り', '498'), ('完熟トマト', '1箱 約1kg', '680'), ('さつまいも', '1袋 約800g', '398'), ('ぶどう（巨峰）', '1房', '1,280')]
for k, (name, unit, price) in enumerate(items):
    x = 36 + 196 * k; y = H - 420
    c.drawImage(jpeg(photo(360, 260, [(238, 205, 190), (250, 225, 205), (225, 190, 160), (215, 195, 215)][k], 9, 100 + k), 70), x, y + 78, 180, 130)
    c.setFillColorRGB(1, 0.9, 0.9); c.roundRect(x, y, 180, 70, 6, fill=1, stroke=0)
    c.setFillColorRGB(0.45, 0.05, 0.08); c.setFont('G', 13); c.drawString(x + 8, y + 50, name)
    c.setFillColorRGB(0.2, 0.2, 0.2); c.setFont('P', 9); c.drawString(x + 8, y + 36, unit)
    c.setFillColorRGB(0.85, 0.08, 0.1); c.setFont('G', 26); c.drawRightString(x + 148, y + 8, price)
    c.setFont('G', 11); c.drawString(x + 150, y + 10, '円')
    c.setFillColorRGB(0.3, 0.3, 0.3); c.setFont('P', 6.5); c.drawString(x + 8, y + 24, '税込')
    if k % 2 == 0: badge(c, x + 158, y + 196, 17, '特価', 10)
c.setStrokeColorRGB(0.85, 0.1, 0.12); c.setLineWidth(0.6); c.line(36, H - 436, W - 36, H - 436)
c.setDash(2, 2); c.line(36, H - 442, W - 36, H - 442); c.setDash()
c.setFillColorRGB(0.07, 0.2, 0.4); c.rect(36, 96, 380, 26, fill=1, stroke=0)
c.setFillColorRGB(1, 1, 1); c.setFont('G', 13); c.drawString(46, 104, '収穫体験の時間（各回 先着20名）')
c.setFillColorRGB(0.1, 0.1, 0.1); c.setFont('P', 10)
for k, line in enumerate(['1回目　午前11時〜　さつまいも掘り', '2回目　午後1時〜　りんごの袋づめ', '3回目　午後2時30分〜　野菜のスタンプ遊び']):
    c.drawString(46, 78 - 16 * k, line)
# 赤い見出しの表
tx, ty = 450, 122
c.setFillColorRGB(0.86, 0.1, 0.12); c.rect(tx, ty - 22, 356, 22, fill=1, stroke=0)
c.setFillColorRGB(1, 1, 1); c.setFont('G', 10)
for j, hd in enumerate(['売り場', '主な品', '担当']): c.drawString(tx + 8 + 120 * j, ty - 15, hd)
rows = [('青果', '葉もの・根菜', '北原'), ('果物', 'りんご・ぶどう', '西野'), ('加工品', 'ジャム・干しいも', '東')]
c.setFont('P', 9.5)
for i, r in enumerate(rows):
    y = ty - 22 - 18 * (i + 1)
    c.setFillColorRGB(1, 0.95, 0.94) if i % 2 == 0 else c.setFillColorRGB(1, 1, 1); c.rect(tx, y, 356, 18, fill=1, stroke=0)
    c.setFillColorRGB(0.1, 0.1, 0.1)
    for j, v in enumerate(r): c.drawString(tx + 8 + 120 * j, y + 5, v)
c.setStrokeColorRGB(0.86, 0.1, 0.12); c.setLineWidth(0.4); c.rect(tx, ty - 22 - 18 * len(rows), 356, 22 + 18 * len(rows), fill=0, stroke=1)
c.setFillColorRGB(0.3, 0.3, 0.3); c.setFont('P', 6.5); c.drawString(36, 20, '※写真はイメージです。天候などにより、品ぞろえ・時間が変わることがあります。お問い合わせ：みのり市場 事務所 0120-000-000')
c.showPage()

# ---- 2ページ目: カタログ(小さいます目) ----
c.setFillColorRGB(1, 1, 1); c.rect(0, 0, W, H, fill=1, stroke=0)
c.setFillColorRGB(0.86, 0.1, 0.12); c.rect(0, H - 44, W, 44, fill=1, stroke=0)
c.setFillColorRGB(1, 1, 1); c.setFont('G', 18); c.drawString(30, H - 30, '冬のおくりもの　ご予約カタログ')
c.setFont('P', 9); c.drawRightString(W - 30, H - 28, 'ご予約は12月10日（木）まで')
names = ['りんごジャム', 'ゆずはちみつ', '干しいも', '完熟トマトソース', '黒豆の甘煮', '栗の渋皮煮', 'みかんジュース', '野菜スープ', 'ぶどうゼリー', 'しょうが湯', '柿のドライ', '梅こんぶ茶']
for k, name in enumerate(names):
    col, row = k % 4, k // 4; x = 30 + 198 * col; y = H - 70 - 168 * row
    c.setStrokeColorRGB(0.8, 0.8, 0.8); c.setLineWidth(0.4); c.rect(x, y - 150, 186, 150, fill=0, stroke=1)
    c.drawImage(jpeg(photo(240, 150, [(245, 215, 205), (250, 235, 200), (230, 200, 170), (240, 190, 180)][k % 4], 6, 300 + k), 68), x + 6, y - 86, 96, 60)
    c.setFillColorRGB(0.86, 0.1, 0.12); c.rect(x + 108, y - 40, 34, 13, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1); c.setFont('G', 8); c.drawString(x + 112, y - 37, '送料込')
    c.setFillColorRGB(0.1, 0.1, 0.1); c.setFont('G', 11); c.drawString(x + 6, y - 18, name)
    c.setFont('P', 6.5); c.drawString(x + 108, y - 54, f'品番 M-{2100 + k * 7}')
    c.drawString(x + 108, y - 64, '内容量 280g')
    c.setFillColorRGB(0.85, 0.08, 0.1); c.setFont('G', 16); c.drawString(x + 108, y - 84, f'{1200 + 180 * (k % 5):,}')
    c.setFont('G', 8); c.drawString(x + 152, y - 83, '円（税込）')
    c.setFillColorRGB(0.25, 0.25, 0.25); c.setFont('P', 7.5)
    for i, line in enumerate(['地元の素材を使い、ひとつずつ手づくり', 'しています。贈りものにも向きます。']):
        c.drawString(x + 6, y - 104 - 10 * i, line)
    c.setFillColorRGB(0.6, 0.1, 0.12); c.setFont('P', 6.5); c.drawString(x + 6, y - 132, '※お届けは12月中旬からです')
c.setFillColorRGB(0.3, 0.3, 0.3); c.setFont('P', 6.5); c.drawString(30, 16, 'みのり市場　冬のおくりもの 2026　（内容はすべて架空です）')
c.showPage(); c.save()
print('ok', os.path.join(out, 'design.pdf'))
