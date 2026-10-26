# レイアウトが違う「原稿（ラフ）」と「成果物」の模擬データを作る(内容で照合する処理の自動テスト用)
#   python3 test/content/make.py 出力フォルダ   → rough.pdf(原稿 3ページ)・final.pdf(成果物 見開き1ページ)
#   原稿1ページ目 → 成果物の右側、原稿3ページ目 → 成果物の左側、原稿2ページ目 → 対応なし(別の商品)
#   成果物には、決まった違いを入れてある(正解は test/content/gt.json)
import sys, os, fitz
FONT = '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'
out = sys.argv[1] if len(sys.argv) > 1 else 'testdata/content'
os.makedirs(out, exist_ok=True)

def box(page, rect, text, size, color=(0.25, 0.25, 0.25), align=0):
    r = fitz.Rect(rect)
    rc = page.insert_textbox(r, text, fontname='ipag', fontfile=FONT, fontsize=size, color=color, align=align)
    assert rc >= 0, (text, rc)

def picture(page, rect, seed):   # 写真の代わりの画像(濃淡の模様)
    w, h = 120, 80
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, w, h), False)
    for y in range(h):
        for x in range(w):
            v = (x * 7 + y * 13 + seed * 31) % 255
            pix.set_pixel(x, y, (v, (v * 3 + seed) % 255, (255 - v) % 255))
    page.insert_image(fitz.Rect(rect), pixmap=pix)

# ---- 原稿(ラフ): A4横 3ページ(文言はすべて架空) ----
doc = fitz.open()
p = doc.new_page(width=842, height=595)
box(p, (30, 25, 600, 55), '来年度からさらに使いやすくなります！', 20)
cols = [
    ('POINT 1　計画づくりはおまかせ', '入力した情報から週間計画を自動作成！毎週見直すから部活や行事と両立できる！'),
    ('POINT 2　苦手に合わせた出題', '目標と理解度に応じて、取り組む問題を自動で選びます。'),
    ('POINT 3　テスト前の総まとめ', 'テスト１週間前からは「直前モード」が始まります。計画→演習→確認問題まで一緒に進めます。'),
]
for k, (hd, body) in enumerate(cols):
    x = 30 + k * 265
    box(p, (x, 80, x + 250, 100), hd, 13, (0, 0, 0))
    box(p, (x, 105, x + 240, 190), body, 11)
picture(p, (560, 250, 800, 410), 1)
box(p, (650, 320, 720, 340), '写真', 14)
p.add_highlight_annot(fitz.Rect(560, 250, 800, 410)).set_info(content='ホーム画面.png\n後送')
box(p, (30, 250, 500, 280), '受講料　1カ月あたり　3,980円', 14)
box(p, (30, 290, 500, 320), '申込締切日　2027年2月24日(水)', 14)
box(p, (30, 340, 520, 400), '毎月の確認テストで、学習の成果を確かめられます。結果は保護者の方にもお知らせします。', 11)
box(p, (620, 470, 760, 495), 'QR後送', 14)
box(p, (30, 420, 520, 440), '※内容は変更になる場合があります。', 11)
# 自動で判定できる指示のコメント: 成果物にある(OK)・成果物にない(NG)・取り消し線とトル(OK)
p.add_text_annot((505, 255), '「（税込）」を追加')
p.add_highlight_annot(fitz.Rect(30, 340, 80, 356)).set_info(content='「毎月」→「隔月」')
p.add_strikeout_annot(fitz.Rect(30, 420, 230, 436)).set_info(content='トル')
# 書式の指示: 大きく(成果物で大きくなっている)・太字(なっていない)・赤字に(なっている)
p.add_highlight_annot(fitz.Rect(30, 25, 400, 52)).set_info(content='大きく')
p.add_highlight_annot(fitz.Rect(30, 80, 250, 98)).set_info(content='太字')
p.add_highlight_annot(fitz.Rect(30, 290, 330, 310)).set_info(content='赤字に')
# 2ページ目: 別の商品(成果物はない)
p = doc.new_page(width=842, height=595)
box(p, (30, 25, 700, 55), '大人向け講座のご案内', 20)
box(p, (30, 80, 500, 200), '週末に受けられるオンライン講座をご用意しています。少人数で質問しやすい講座です。', 12)
# 3ページ目: 裏表紙(成果物の左側)
p = doc.new_page(width=842, height=595)
box(p, (30, 25, 600, 55), 'ご利用者の声', 20)
box(p, (30, 80, 380, 130), '毎日の予定が分かりやすく、続けるきっかけになりました。', 12)
box(p, (420, 80, 800, 130), '短い問題に分かれているので、すき間時間にすぐ復習できました。', 12)
box(p, (30, 160, 800, 190), '詳しいご案内と受講料は、Webサイトでご確認ください。', 14)
box(p, (30, 220, 600, 250), 'お電話でのお問い合わせ　0120-000-000', 14)
doc.subset_fonts()   # フォントは使った字だけを埋め込む(ファイルを小さくする)
doc.save(os.path.join(out, 'rough.pdf'), garbage=4, deflate=True)

# ---- 成果物: 見開き(A3横)1ページ。左が裏表紙、右が原稿1ページ目の内容(配置・改行・字の大きさを変える) ----
#   old=True で、前回の成果物(旧版 old.pdf)を作る: 旧版を任意で渡したときの確認用(正解は test/content/gt_old.json)
def spread(old):
    doc = fitz.open()
    p = doc.new_page(width=1191, height=842)
    L, R = 40, 620
    # 左側(原稿3ページ目)
    box(p, (L, 40, L + 500, 75), 'ご利用者の声', 22, (0.1, 0.25, 0.6))
    box(p, (L, 100, L + 240, 160), '毎日の予定が分かりやすく、続けるきっかけになりました。', 11, (0.1, 0.25, 0.6))
    box(p, (L + 270, 100, L + 520, 180), '短い問題に分かれているので、すき間時間にすぐ復習できました。', 11, (0.1, 0.25, 0.6))
    box(p, (L, 220, L + 520, 245), '詳しいご案内と受講料は、 Webサイトでご確認ください。', 13, (0.1, 0.25, 0.6))
    box(p, (L, 280, L + 520, 305), 'お電話でのお問い合わせ　0120-000-000', 13)
    box(p, (L, 320, L + 520, 340), '［受付時間］月曜日～金曜日　午前10:00～午後5:00' if old else '［受付時間］月曜日～土曜日　午前10:00～午後6:00', 10)   # 原稿にない文字(旧版から変わった)
    # 原稿のない部分(左下の欄外): 旧版から変わった発行年・旧版と同じ注記・旧版にだけある注記
    box(p, (L, 760, L + 520, 776), '発行：文具ひろば事務局　2026年版' if old else '発行：文具ひろば事務局　2027年版', 9)
    box(p, (L, 780, L + 520, 796), 'このチラシは再生紙を使用しています。', 9)
    if old:
        box(p, (L, 800, L + 520, 816), '※旧ロゴは使用しません。', 9)
    if not old:   # 成果物の書き込み(ピンクの帯に白抜き)
        p.draw_rect(fitz.Rect(L + 380, 40, L + 520, 56), color=None, fill=(0.88, 0.0, 0.42))
        box(p, (L + 382, 41, L + 520, 56), 'アタリ：ファイル名001', 9, (1, 1, 1))
    # 右側(原稿1ページ目)
    box(p, (R, 40, R + 520, 70), '来年度からさらに', 22, (0.1, 0.25, 0.6))
    box(p, (R, 72, R + 520, 102), '使いやすくなります！', 22, (0.1, 0.25, 0.6))
    y = 130
    for hd, body in [
        ('POINT 1　計画づくりはおまかせ', '入力した情報から週間計画を自動生成！毎週見直すから部活や行事と両立！'),      # 作成→生成・「できる」が抜け(旧版のまま)
        ('POINT 2　苦手に合わせた出題', '目標と理解度に応じて、取り組む問題を自動で選びます。'),
        ('POINT 3　テスト前の総まとめ', 'テスト1週間前からは「直前モード」が始まります。計画▶演習▶確認問題まで一緒に進めます。'),   # １→1(書き方)・→→▶
    ]:
        box(p, (R, y, R + 520, y + 18), hd, 12, (0, 0, 0))
        box(p, (R + 10, y + 22, R + 330, y + 70), body, 10)
        y += 85
    picture(p, (R + 340, 380, R + 540, 510), 1)
    box(p, (R + 340, 515, R + 540, 530), '※画面はイメージです。', 8)   # 原稿では画像の部分
    box(p, (R, 400, R + 330, 420), '受講料　1カ月あたり　3,800円（税込）' if old else '受講料　1カ月あたり　3,980円（税込）', 13)   # （税込）が原稿にない。旧版の価格は原稿どおりに直った
    box(p, (R, 430, R + 330, 450), '申込締切日　2026年2月25日（水）' if old else '申込締切日　2027年2月24日（水）', 13, (0.25, 0.25, 0.25) if old else (0.85, 0.1, 0.1))   # (水)→（水）(書き方)。赤字にの指示どおり赤
    box(p, (R, 470, R + 330, 520), '毎月の確認テストで、学習の成果を確かめられます。結果は保護者の方にもお知らせします。', 10)
    if not old:
        p.draw_rect(fitz.Rect(R + 400, 360, R + 540, 376), color=None, fill=(0.88, 0.0, 0.42))
        box(p, (R + 402, 361, R + 540, 376), '未支給', 9, (1, 1, 1))
    doc.subset_fonts()
    doc.save(os.path.join(out, 'old.pdf' if old else 'final.pdf'), garbage=4, deflate=True)

spread(False)
spread(True)
print('ok', out)
