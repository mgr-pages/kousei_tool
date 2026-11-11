# コメント(注釈)で指示を入れたPDF原稿の模擬データ(題材・文言はすべて架空の写真教室の案内)
#   python3 test/annot2/make.py 出力フォルダ   → genko.pdf(旧版＋注釈)・seika.pdf(成果物)・truth.json
#   注釈は、デザインのPDFにマーカー(ハイライト)と付箋で入れたもの。次の型を入れる:
#     字の置き換え(成果物では同じ読みの別の字に誤って直した → 指示どおりになっていない)・数字の置き換え・
#     字のない所に引いたマーカーで注の行を足す・字の右の何もない所に引いたマーカーで字を足す(やり方の説明つき)・
#     素材のファイル名の指定・語の途中に字を足す・行を消す(トル)・「※トル」(成果物で「※」が残った → 指示どおりになっていない)・
#     作る人の質問の書き込みへの返事・付箋のやり取り(返信つき)・指示のない変化(1字消えた)・
#     「、」1字だけのコメント・「（以下同様）」の添え書きのあるコメント
#   要るもの: reportlab・PyMuPDF と IPAゴシック
import sys, os, json
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import pymupdf

out = sys.argv[1] if len(sys.argv) > 1 else 'testdata/annot2'
os.makedirs(out, exist_ok=True)
pdfmetrics.registerFont(TTFont('G', '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'))
W, H = 595, 842

def page(path, new):
    c = canvas.Canvas(path, pagesize=(W, H))
    c.setFillColorRGB(0.15, 0.35, 0.3); c.setFont('G', 20); c.drawString(50, 790, '春の写真教室のご案内')
    c.setFillColorRGB(0, 0, 0); c.setFont('G', 11)
    # 1) 「土日」→「週末」の指示(成果物は「集末」と誤って直した)
    c.drawString(50, 750, '教室は' + ('集末' if new else '土日') + 'に開いています。カメラの貸し出しもあります。')
    # 2) 参加費(3,200 → 2,900)と、その下に注を足す指示(マーカーは字のない所)
    c.setFont('G', 12); c.drawString(50, 700, '参加費　１回あたり')
    c.setFont('G', 22); c.drawString(200, 696, '2,900円' if new else '3,200円')
    if new:
        c.setFont('G', 8); c.drawString(50, 680, '※来年度から参加費が変わります。詳しくは右のコードからご覧ください。')
    # 3) 素材の指定(仮の所に「仮」。成果物は本物の代わりの模様)
    c.setFillColorRGB(0.9, 0.95, 1) if not new else c.setFillColorRGB(1, 1, 1)
    c.rect(450, 650, 70, 70, fill=1, stroke=1)
    c.setFillColorRGB(0, 0, 0)
    if not new:
        c.setFont('G', 14); c.drawString(478, 678, '仮')
    else:
        for i in range(7):
            for j in range(7):
                if (i * 3 + j * 5) % 4 < 2: c.rect(455 + 9 * i, 655 + 9 * j, 8, 8, fill=1, stroke=0)
    # 4) 会場(「第二」を足す指示)と、指示にない変化(「駅前店」→「駅店」)
    c.setFont('G', 12); c.drawString(50, 610, '会場　南川市立' + ('第二' if new else '') + '図書館')
    c.setFont('G', 10); c.drawString(50, 590, '集合場所　北山' + ('駅店' if new else '駅前店') + 'の入り口')
    # 5) 箇条書き: 1行目を消し(トル)、2行目の「※」も消して上下の真ん中に(成果物は「※」が残った)
    c.setFont('G', 11)
    if not new:
        c.drawString(80, 540, '※雨の日も室内のスタジオで開きます')
        c.drawString(80, 524, '※はじめての方の体験会を追加しました')
    else:
        c.drawString(80, 532, '※はじめての方の体験会を追加しました')
    # 6) 作る人の質問の書き込み(旧版だけ)。返事のコメントが付く
    if not new:
        c.setFillColorRGB(0.85, 0.1, 0.1); c.rect(380, 470, 120, 18, fill=1, stroke=0)
        c.setFillColorRGB(1, 1, 1); c.setFont('G', 10); c.drawString(386, 475, '線の色を合わせますか？')
    c.setFillColorRGB(0, 0, 0)
    # 7) 「、」を入れる指示(コメントは「、」1字だけ)と、「こつ」→「コツ」(以下同様。2つ目は指示なしで直す)
    c.setFont('G', 11); c.drawString(50, 440, 'お申し込みは' + ('、' if new else '') + '電話で受け付けます。')
    c.drawString(50, 415, '撮影の' + ('コツ' if new else 'こつ') + 'を学びます。' + ('コツ' if new else 'こつ') + 'は先生が教えます。')
    # 8) 文書番号(後ろに「 A」を足す指示。マーカーは字の右の何もない所)
    c.setFont('G', 9); c.drawString(450, 60, 'No.4521' + (' A' if new else ''))
    c.showPage(); c.save()

g, s = os.path.join(out, 'genko.pdf'), os.path.join(out, 'seika.pdf')
page(g, False); page(s, True)

# 注釈を入れる(PyMuPDF は上が原点)
doc = pymupdf.open(g); p = doc[0]
def hl(rect, text):
    a = p.add_highlight_annot(pymupdf.Rect(*rect)); a.set_info(content=text, title='確認者'); a.update(); return a
def under(s):   # 字の並び s の位置
    for b in p.get_text('rawdict')['blocks']:
        for l in b.get('lines', []):
            for sp in l['spans']:
                t = ''.join(ch['c'] for ch in sp['chars'])
                k = t.find(s)
                if k >= 0:
                    cs = sp['chars'][k:k + len(s)]
                    return (cs[0]['bbox'][0], min(c['bbox'][1] for c in cs), cs[-1]['bbox'][2], max(c['bbox'][3] for c in cs))
    raise SystemExit('not found: ' + s)
hl(under('土日'), '週末\n\nよろしくお願いいたします')
hl(under('3,200'), '2,900')
r = under('参加費'); hl((50, r[3] + 6, 330, r[3] + 18), '※来年度から参加費が変わります。詳しくは右のコードからご覧ください。')
hl((452, H - 718, 518, H - 652), 'sample_code_2.ai')
hl(under('図'), '第二')
hl(under('※雨の日も室内のスタジオで開きます'), 'トル')
r1 = under('※雨'); r2 = under('※は'); hl((r1[0], r1[1], r1[0] + (r1[2] - r1[0]) / 2, r2[3]), '※トル\n上下の真ん中にそろえる')
hl(under('線の色を合わせますか？'), 'ご質問の件、今のままで問題ありません。')
hl(under('みは'), '、')
hl(under('こつ'), 'コツ（以下同様）')
r = under('No.4521'); hl((r[2] + 1, r[1] - 2, r[2] + 16, r[3] + 2), 'A\n\n前に半角アキ')
# 付箋のやり取り(返信は In Reply To でつなぐ)
t = p.add_text_annot((300, H - 640), '地図を入れていただけないでしょうか。'); t.set_info(title='依頼者'); t.update()
for k, txt in enumerate(['住所を下に小さく足す形でよろしいですか。', '了解です。その形で進めてください。']):
    rp = p.add_text_annot((300, H - 640), txt); rp.set_info(title='確認者' if k == 0 else '依頼者'); rp.set_irt_xref(t.xref); rp.update()
doc.saveIncr()

truth = {
  'instr': [
    {'note': '週末', 'want': 'A', 'auto': 'ng', 'what': '「土日」→「週末」（成果物は「集末」）'},
    {'note': '2,900', 'want': 'A', 'auto': 'ok', 'what': '参加費'},
    {'note': '※来年度から参加費', 'want': 'A', 'auto': 'ok', 'what': '字のない所に注を足す'},
    {'note': 'sample_code_2.ai', 'want': 'human', 'what': '素材の指定'},
    {'note': '第二', 'exact': True, 'want': 'A', 'auto': 'ok', 'what': '「第二」を足す'},
    {'note': 'トル', 'exact': True, 'want': 'A', 'auto': 'ok', 'what': '1行目を消す'},
    {'note': '※トル', 'want': 'A', 'auto': 'ng', 'what': '「※」が残った'},
    {'note': '今のままで問題ありません', 'want': 'human', 'what': '質問への返事'},
    {'note': 'A', 'exact_first': True, 'want': 'human', 'what': '字の右に「 A」を足す'},
    {'note': '地図を入れていただけないでしょうか', 'want': 'K', 'what': '付箋のやり取り（返信つき）'},
    {'note': '、', 'exact': True, 'want': 'A', 'auto': 'ok', 'what': '「、」を入れる（1字だけのコメント）'},
    {'note': 'コツ（以下同様）', 'want': 'A', 'auto': 'ok', 'what': '「こつ」→「コツ」（添え書きの「（以下同様）」は探さない）'},
  ],
  'extra': [{'what': '「駅前店」→「駅店」（指示にない変更）', 'cat': 'C2', 'text': '前'}],
}
json.dump(truth, open(os.path.join(out, 'truth.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('ok', out)
