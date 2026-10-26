# 成果物だけで見る日本語のチェックの模擬データ(文言はすべて架空)
#   python3 test/jcheck/make.py 出力フォルダ   → genko.txt(原稿：成果物と同じ文) と seika.pdf(成果物 A4縦 1ページ)
#   成果物には、決まった誤りと、誤りと間違えやすい正しい書き方を入れてある(正解は test/jcheck/gt.json)
import sys, os
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

out = sys.argv[1] if len(sys.argv) > 1 else 'testdata/jcheck'
os.makedirs(out, exist_ok=True)
pdfmetrics.registerFont(TTFont('ipag', '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'))
LINES = [
    '春の文具フェアのご案内',
    '開催日：2027年5月8日（土）',                         # 正しい
    '先行受付：2027年6月1日（水）',                       # 曜日の誤り(火曜日)
    '受付：5/10(月)〜5/14(金)',                           # 正しい
    'お問い合わせ（平日10時〜17時',                        # 閉じかっこがない
    'TEL 0120-123-456　（受付時間 9:00〜18:00）',          # 正しい(空白でまとまりが分かれても閉じている)
    '1）申し込む　2）支払う　（注）当日払いも可',            # 番号のかっこは正しい
    'ご来場をを お待ちしております。。',                    # 助詞・句点の重なり
    '話の的を得た説明が好評です。',                        # よくある誤用
    '会場では新しい手帳が見れる予定です。',                  # ら抜き言葉
    '本店 TEL 03-1234-567',                              # 電話番号の桁が足りない
    '〒123-4567 架空県みどり市1-2-3',                     # 正しい
    '〒12-3456 架空県あおば市4-5-6',                       # 郵便番号の形の誤り
    'お申し込みはWebで。申込みは郵送でも受け付けます。',      # 表記ゆれ
    '申込書は店頭にあります。取扱説明書も配布します。',        # 複合語の決まった書き方(表記ゆれではない)
    'サーバの点検とサーバーの交換を行います。',               # 表記ゆれ(長音)
]
c = canvas.Canvas(os.path.join(out, 'seika.pdf'), pagesize=(595, 842))
y = 800
for s in LINES:
    c.setFont('ipag', 12 if y < 800 else 18)
    c.drawString(50, y, s)
    y -= 34
# 飾りのために少しずらして重ねて描いた文字(影)。重なった一部の文字列を、かっこの閉じ忘れとしない
c.setFont('ipag', 14)
c.setFillColorRGB(0.7, 0.7, 0.7); c.drawString(51, y - 1, '「myZ（マイゼット')
c.setFillColorRGB(0, 0, 0); c.drawString(50, y, '「myZ（マイゼット）」から！')
c.showPage(); c.save()
with open(os.path.join(out, 'genko.txt'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(LINES + ['「myZ（マイゼット）」から！']) + '\n')
print('ok', out)
