# 成果物だけで見る日本語のチェックの模擬データ(文言はすべて架空)
#   python3 test/jcheck/make.py 出力フォルダ   → genko.txt(原稿：成果物と同じ文) と seika.pdf(成果物 A4縦 4ページ。4ページ目は英語)
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
# 2ページ目: 辞書(形態素解析)と一覧で見る誤り
LINES2 = [
    '秋の文具フェア　お知らせ',
    'お届け予定日：2月30日',                                  # 存在しない日付
    '会場で資料をが配布します。',                              # 助詞の続き方
    '詳しくは店頭にありますます。',                            # 助動詞の重なり
    '完壁な仕上がりの手帳です。',                              # 誤字(完璧)
    'キャンペーンの一貫として配布します。',                     # 誤用(一環)
    '内臓バッテリーで光るペンです。',                          # 誤字(内蔵)
    '必らず説明書をお読みください。',                          # 送りがなの誤り
    '新しい手帳は軽くて使い安いです。',                         # 誤字(使いやすい)
    'この手帳は文字が見ずらいとの声もあります。',               # かな遣い(づらい)
    'とゆうわけで、ご案内します。',                            # かな遣い(いう)
    'ご意見を読まさせていただきます。',                         # さ入れ言葉
    '明日も来れる方はお知らせください。',                       # ら抜き言葉
    '本を読んだり、手帳に書きます。',                           # 「〜たり」が1つだけ
    '会員の方はご利用ご利用ください。',                         # 語の重なり
    '会員カードはどなたでもご利用できます。',                   # 敬語(ご〜できる)
    'お読みになられる方へ。第1回目の説明会です。',               # 二重敬語・重複表現
    '汚れは布で拭き取ってください。水分はすぐにふき取ってください。',   # 表記ゆれ(辞書の読み)
    'ヴァイオリン教室とバイオリン教室のご案内',                  # 表記ゆれ(カタカナ語)
    'フローリング用のペン。フローリングにも使えます。フローリンク対応。',   # カタカナ語の1字違い
    '定価 ¥12,800　特価 9800円',                               # 金額の桁区切りの混在
    '受付は、平日のみです。ご予約は，電話で受け付けます．',       # 句読点の混在
    'わかる地図と、わかる説明と、わかる表で、分かりやすい案内です。',   # 表記ゆれ(候補は活用をそろえて「わかり」)
    '安全を念頭に入れて作りました。',                             # 誤用(候補は「念頭に置いて」)
]
# 3ページ目: 誤りと間違えやすい正しい書き方(出たら余分な検出)
LINES3 = [
    '冬の文具フェア　ご案内',
    '開催：2028年2月29日（火）',                               # うるう年
    'ここからが本番です。AとBとを比べます。',                    # 「からが」「とを」
    'ますます便利になりました。',                               # 副詞の「ますます」
    '見られる・来られる・食べられる手帳です。',                  # 正しい可能の形
    '行かせていただきます。',                                   # 正しい使役
    '見たり聞いたりします。休んだりします。',                    # 正しい「〜たり」
    '取扱説明書と申込書は店頭にあります。',                      # 複合語
    '機械の操作は、この機会にご確認ください。',                  # 読みが同じ別の語
    '使い方について、続けていきます。店にも行きます。',           # 「について」・補助動詞
    '内臓脂肪の話。首尾一貫して確率が高い。分かりづらい点という話。',   # 似ているが正しい言い方
    '価格 ¥1,280　特価 ¥980',                                   # 3桁の金額は桁区切りなし
    '受付は5時までです。木でできた机。高いものの、一点一点仕上げます。',   # 助詞の重なりではない「でで」「のの」、くり返しの言い方
]
# 4ページ目: 英語(誤りと、誤りと間違えやすい正しい書き方)
LINES4 = [
    'Autumn Stationery Fair',
    'Thank you for visting our shop.',                          # つづりの誤り(visiting)
    'Please read the the manual before use.',                    # 同じ語の重なり
    'This is a original design.',                                # 冠詞(an)
    'We are an family company.',                                 # 冠詞(a)
    'Open: Monday, October 26, 2027',                            # 曜日の誤り(Tuesday)
    'Closed: Sunday, October 31, 2027',                          # 正しい
    'Made in Japan. Free Wi-Fi and LED lights.',                 # 正しい(略語・ハイフン)
    'Visit www.example.com or e-mail info@example.com.',         # 正しい(URL・メール)
    'Available for iPhone users. Made in Tokyo by Kousei.',      # 正しい(商品名・ローマ字)
    'It takes an hour. A university student designed it. An LED lamp.',   # 正しい冠詞
    'Product code KT21-NA and size 3T.',                         # 品番
    'Natural Wood Collection',                                   # 正しい
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
c.showPage()
for lines in (LINES2, LINES3, LINES4):
    y = 800
    for s in lines:
        c.setFont('ipag', 11 if y < 800 else 18)
        c.drawString(40, y, s)
        y -= 34
    c.showPage()
c.save()
with open(os.path.join(out, 'genko.txt'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(LINES + ['「myZ（マイゼット）」から！'] + LINES2 + LINES3 + LINES4) + '\n')
print('ok', out)
