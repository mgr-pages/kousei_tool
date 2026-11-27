# 旧版から動かしただけの所を、1か所1件の「移動した所」として出すかの試験データ(内容はすべて架空)
#   python3 test/move/make.py 出力フォルダ   → old.pdf(旧版。1ページ目＝横長のページ、2ページ目＝別案の半分の大きさのページ)・new.pdf(成果物)
#   成果物では: ブロックA を下へ 20pt 動かす(中身は同じ)、ブロックB を左へ 100pt 動かして中の字の一部を消す(足した字はない)、ブロックC・下の帯はそのまま、
#   右下のブロックE を、旧版2ページ目のブロックF に置き換える(別のページの中身を移したもの)
#   要るもの: PyMuPDF
import sys, os
import pymupdf as fitz

out = sys.argv[1] if len(sys.argv) > 1 else 'testdata/move'
os.makedirs(out, exist_ok=True)
W, H = 842, 595

def block_a(p, x, y):   # 見出し・2行の文・枠・丸の印
    p.draw_rect(fitz.Rect(x, y, x + 330, y + 170), color=(0.2, 0.35, 0.65), fill=(0.9, 0.94, 1), width=2)
    p.draw_circle(fitz.Point(x + 30, y + 32), 14, color=(0.85, 0.3, 0.2), fill=(0.95, 0.55, 0.3))
    p.insert_text((x + 55, y + 40), '架空のお知らせ', fontname='japan', fontsize=20, color=(0.1, 0.2, 0.45))
    p.insert_text((x + 20, y + 90), 'テスト用の文章が入ります。', fontname='japan', fontsize=13)
    p.insert_text((x + 20, y + 120), '見本の説明の二行目です。', fontname='japan', fontsize=13)
    for i in range(5): p.draw_rect(fitz.Rect(x + 20 + i * 60, y + 140, x + 70 + i * 60, y + 158), color=None, fill=(0.3 + 0.1 * i, 0.6, 0.5))

def block_b(p, x, y, word):   # 色の札と字
    p.draw_rect(fitz.Rect(x, y, x + 220, y + 90), color=None, fill=(0.85, 0.15, 0.25))
    p.draw_circle(fitz.Point(x + 190, y + 45), 22, color=(1, 1, 1), fill=(1, 0.85, 0.2), width=3)
    p.insert_text((x + 18, y + 55), word, fontname='japan', fontsize=22, color=(1, 1, 1))

def block_c(p, x, y):   # 3×2 の表(動かさない)
    for r in range(2):
        for c in range(3):
            p.draw_rect(fitz.Rect(x + c * 100, y + r * 50, x + c * 100 + 96, y + r * 50 + 46), color=(0.3, 0.3, 0.3), fill=(0.95, 0.9 - 0.1 * r, 0.8 + 0.05 * c), width=1)
            p.insert_text((x + c * 100 + 18, y + r * 50 + 30), f'見本{r * 3 + c + 1}', fontname='japan', fontsize=12)

def block_e(p, x, y):   # 縞の箱(成果物では置き換わる)
    p.draw_rect(fitz.Rect(x, y, x + 300, y + 170), color=None, fill=(0.3, 0.55, 0.3))
    for i in range(8): p.draw_line(fitz.Point(x + 10 + i * 36, y + 10), fitz.Point(x + 40 + i * 36, y + 160), color=(1, 1, 0.8), width=4)

def block_f(p, x, y):   # 別案(旧版2ページ目)のデザイン
    p.draw_rect(fitz.Rect(x, y, x + 300, y + 170), color=None, fill=(0.2, 0.3, 0.6))
    p.draw_circle(fitz.Point(x + 240, y + 60), 40, color=None, fill=(1, 0.7, 0.2))
    p.insert_text((x + 20, y + 60), 'テスト用の見出し', fontname='japan', fontsize=22, color=(1, 1, 1))
    for i in range(4): p.draw_rect(fitz.Rect(x + 20 + i * 50, y + 110, x + 60 + i * 50, y + 150), color=None, fill=(0.9, 0.5 + 0.1 * i, 0.4))

def footer(p):   # 下の帯(動かさない)
    p.draw_rect(fitz.Rect(40, H - 70, W - 40, H - 30), color=None, fill=(0.25, 0.25, 0.3))
    p.insert_text((60, H - 43), '架空の会社 サンプル　お問い合わせは見本の窓口まで', fontname='japan', fontsize=12, color=(1, 1, 1))

d = fitz.open()
p = d.new_page(width=W, height=H); block_a(p, 50, 60); block_b(p, 520, 70, '新しい教材'); block_c(p, 50, 330); block_e(p, 470, 300); footer(p)
p2 = d.new_page(width=420, height=H); block_f(p2, 60, 200)
d.save(os.path.join(out, 'old.pdf'))
d = fitz.open()
p = d.new_page(width=W, height=H); block_a(p, 50, 80); block_b(p, 420, 70, '新しい'); block_c(p, 50, 330); block_f(p, 470, 300); footer(p)
d.save(os.path.join(out, 'new.pdf'))
print('ok', out)
