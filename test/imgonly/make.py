# 文字データのないページ(ページ全体が1枚の画像)だけの旧版と成果物、注釈だけを付けた成果物(内容はすべて架空)
#   python3 test/imgonly/make.py 出力フォルダ   → old.pdf(旧版)・new.pdf(画像の一部を変えて注釈を2つ付けたもの)・annot.pdf(画像は旧版と同じで注釈だけ付けたもの)・
#   redflat.pdf(画像は旧版と同じで、赤い丸と赤い線を画像に描き込んだもの。注釈ではない)
#   旧版と成果物の比べ合わせで、文字データがないページを飛ばしていたため、画像や注釈が違っても0件になった不具合の試験。
#   あわせて、注釈付き・赤を描き込んだ画像だけのPDFを原稿に入れたとき、紙のスキャンとして扱って誤検出が大量に出た不具合の試験
#   要るもの: PyMuPDF・Pillow
import sys, os, io
import fitz
from PIL import Image, ImageDraw

out = sys.argv[1] if len(sys.argv) > 1 else 'testdata/imgonly'
os.makedirs(out, exist_ok=True)
W, H = 1200, 1600   # 画像の画素(ページは 432×576pt。約200dpi)

def poster(changed, red=False):
    im = Image.new('RGB', (W, H), (250, 248, 240)); d = ImageDraw.Draw(im)
    d.rectangle([60, 60, W - 60, 260], fill=(40, 90, 160))                 # 見出しの帯
    for i in range(6): d.rectangle([80 + i * 180, 330, 220 + i * 180, 470], fill=(200, 60 + 30 * i, 60))   # 色の札
    d.ellipse([150, 560, 550, 960], fill=(60, 160, 90))                     # 丸
    d.rectangle([680, 560, 1080, 960], fill=(230, 180, 40) if not changed else (120, 60, 180))   # 四角(成果物では色を変える)
    for y in range(1040, 1500, 40): d.line([100, y, 1100, y], fill=(120, 120, 120), width=3)    # 罫線
    if red:   # 赤ペンのかわり: 丸の札を赤で囲み、罫線の1本に赤い線を重ねる(画像に描き込む)
        d.ellipse([60, 300, 260, 500], outline=(220, 20, 30), width=6)
        d.line([140, 1160, 700, 1160], fill=(220, 20, 30), width=6)
    return im

def page(doc, im):
    b = io.BytesIO(); im.save(b, 'PNG'); p = doc.new_page(width=432, height=576)
    p.insert_image(p.rect, stream=b.getvalue()); return p

for name, changed, annots, red in [('old', False, False, False), ('new', True, True, False), ('annot', False, True, False), ('redflat', False, False, True)]:
    doc = fitz.open(); p = page(doc, poster(changed, red))
    if annots:
        a = p.add_freetext_annot(fitz.Rect(40, 400, 220, 430), 'テスト用の確認メモ', fontsize=10, fontname='helv'); a.update()
        a = p.add_circle_annot(fitz.Rect(60, 200, 200, 340)); a.set_colors(stroke=(1, 0, 0)); a.update()
    doc.save(os.path.join(out, name + '.pdf'), deflate=True, garbage=3)
print('ok', out)
