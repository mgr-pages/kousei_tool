# 書式の指示(太字・大きさ・色)を注釈で入れた原稿と、それを直した成果物の模擬データ(同じレイアウト。文言はすべて架空)
#   python3 test/layout/make.py 出力フォルダ   → genko.pdf(注釈で指示を入れた原稿) と seika.pdf(成果物)
#   成果物には、指示どおりに直した所と、指示と違う直し方をした所がある(正解は test/layout/gt.json)
#   日本語の太字の書体がないため、太字は字の縁を太らせて描く
import sys, os, fitz
FONT = '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'
out = sys.argv[1] if len(sys.argv) > 1 else 'testdata/layout'
os.makedirs(out, exist_ok=True)
BODY = ['文具ひろばでは、毎月さまざまな催しを開いています。', 'くわしい内容は、店頭のお知らせをご覧ください。', 'みなさまのご来店をお待ちしております。',
        '手帳とノートの新しい色がそろいました。', '学校で使う文具もまとめて選べます。', 'お気軽にスタッフへお声がけください。']   # 指示の行の間に入れる、変わらない文
# (文, 指示, 成果物での書き方) 書き方: size・color・bold(縁の太さ)
LINES = [
    ('■配送のご案内', '太字', dict(bold=0.6)),                       # 指示どおり
    ('■返品のご案内', '太字', dict(color=(0.85, 0.1, 0.1))),         # 太字でなく赤にした
    ('ご注文は店頭で承ります。', '大きく', dict(size=15)),             # 指示どおり
    ('お支払いは現金のみです。', '大きく', dict(size=10)),             # 小さくした
    ('セール期間中は全品1割引きです。', '赤字に', dict(color=(0.85, 0.1, 0.1))),   # 指示どおり
    ('営業時間は10時からです。', '赤字に', dict(color=(0.1, 0.2, 0.85))),         # 青にした
]

def page(doc, edited):
    p = doc.new_page(width=595, height=842)
    p.insert_text((60, 70), '春の文具フェアのお知らせ', fontname='ipag', fontfile=FONT, fontsize=18)
    y = 120
    for k, (s, note, how) in enumerate(LINES):
        st = how if edited else {}
        size = st.get('size', 12)
        kw = dict(fontname='ipag', fontfile=FONT, fontsize=size, color=st.get('color', (0.1, 0.1, 0.1)))
        if st.get('bold'): kw.update(render_mode=2, border_width=st['bold'] / size)
        p.insert_text((60, y), s, **kw)
        p.insert_text((60, y + 30), BODY[k], fontname='ipag', fontfile=FONT, fontsize=11)
        y += 80
    return p

doc = fitz.open(); p = page(doc, False)
y = 120
for s, note, how in LINES:
    w = fitz.Font(fontfile=FONT).text_length(s, fontsize=12)
    p.add_highlight_annot(fitz.Rect(60, y - 11, 60 + w, y + 2)).set_info(content=note)
    y += 80
doc.subset_fonts(); doc.save(os.path.join(out, 'genko.pdf'), garbage=4, deflate=True)
doc = fitz.open(); page(doc, True); doc.subset_fonts(); doc.save(os.path.join(out, 'seika.pdf'), garbage=4, deflate=True)
print('ok', out)
