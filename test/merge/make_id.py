# 差し込み印刷の模擬データ(2つ目の作り：社員証。会社・人・番号・日付はすべて架空)。名刺(make.py)だけに合わせた照合になっていないかを見る
#   python3 test/merge/make_id.py 出力フォルダ                 → shain.xlsx(原稿)と shain_seika.pdf(成果物。誤りなし)、
#                                                               shain_seika_err.pdf・shain_truth_err.json(種5で誤りを4か所入れたもの。自動テスト一式で使う)
#   python3 test/merge/make_id.py 出力フォルダ 種の数 [最初の種]  → 出力フォルダ/v{種}/ に、誤りを無作為に4か所入れた seika.pdf・truth.json と shain.xlsx
#   原稿の作り: 1行目が会社名(表の上の共通の値)、2行目が見出し。社員番号(先頭が0の文字)・所属(2行のことがある)・氏名(姓と名の間に空白)・
#     ローマ字・有効期限(日付のセルを「2028年3月31日」の表示形式で)・入社日と内線(社員証に載らない列)。最後に人数の行
#   成果物の作り: 1人1ページ(表だけ)。仕上がり 54×86mm(TrimBox)。上から「KAKUU」・会社名・「社員証」・写真の枠・所属・氏名(横組み・大きい字)・
#     ローマ字(大文字)・「社員番号 …」・「有効期限 …」・「このカードは架空ホールディングス株式会社の所有物です」(会社名を含む決まった文)
#   誤りの種類(truth.json の type): name 氏名の1字 / dept 所属の1字 / num 社員番号の1桁 / date 有効期限の1桁 / roman ローマ字の1字 /
#     name_add_h 氏名の終わりに1字増える / dept_add 所属の頭に1字増える / swap_name 氏名がほかの人のもの / co_drop 会社名の行が消える /
#     tmpl 「社員証」・決まった文の1字 / numdrop 社員番号が消える(「社員番号」だけ残る)
#   要るもの: reportlab・openpyxl と IPAゴシック・Liberation Sans
import sys, os, json, random, datetime
import openpyxl
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

pdfmetrics.registerFont(TTFont('G', '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'))
pdfmetrics.registerFont(TTFont('L', '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'))
W, H, K = 193, 284, 200 / 72
TRIM = (20, 20, 173, 264)
CO = '架空ホールディングス株式会社'
# (社員番号, 所属(改行で2行), 氏名, ローマ字, 有効期限, 入社日, 内線)
PEOPLE = [
    ('012345', '経営企画本部', '架山 太郎', 'Taro Kayama', (2028, 3, 31), (2010, 4, 1), '1101'),
    ('012346', '営業本部\n第一営業部', '空野 花子', 'Hanako Sorano', (2028, 3, 31), (2012, 4, 1), '1102'),
    ('012351', '営業本部\n第二営業部', '緑川 健一', 'Kenichi Midorikawa', (2027, 9, 30), (2015, 10, 1), '1103'),
    ('012360', '庶務部', '森野 由美', 'Yumi Morino', (2028, 3, 31), (2016, 4, 1), '1104'),
    ('012377', '技術本部\n開発第三課', '海老原 誠', 'Makoto Ebihara', (2029, 3, 31), (2018, 4, 1), '1105'),
    ('012388', '人事部', '林田 さくら', 'Sakura Hayashida', (2027, 3, 31), (2019, 4, 1), '1106'),
    ('012390', '技術本部\n品質保証課', '石原 大地', 'Daichi Ishihara', (2028, 9, 30), (2020, 4, 1), '1107'),
    ('012402', '財務部', '小川 美緒', 'Mio Ogawa', (2029, 3, 31), (2021, 4, 1), '1108'),
]
CARDS = [0, 1, 2, 3, 4, 5, 6, 7]
jdate = lambda d: f'{d[0]}年{d[1]}月{d[2]}日'

def book(path):
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = '社員'
    ws.append([CO])
    ws.append(['社員番号', '所属', '氏名', '氏名（ローマ字）', '有効期限', '入社日', '内線'])
    for num, dep, nm, ro, exp, ent, ext in PEOPLE:
        ws.append([num, dep, nm, ro, datetime.date(*exp), datetime.date(*ent), ext])
        r = ws.max_row
        for c in (5, 6): ws.cell(r, c).number_format = 'yyyy"年"m"月"d"日"'
        ws.cell(r, 1).number_format = '@'
    ws.append([None, None, f'{len(PEOPLE)}名'])
    wb.save(path)

def cards(path, rnd=None, n_err=0):
    pages = []
    for k in CARDS:
        num, dep, nm, ro, exp, ent, ext = PEOPLE[k]
        it = [[30, 34, 8, 'KAKUU', 'logo'], [30, 46, 6.5, CO, 'co'], [30, 64, 11, '社員証', 'tmpl']]
        it += [[30, 150 + 9 * i, 7, d, 'dept'] for i, d in enumerate(dep.split('\n'))]
        it += [[30, 186, 14, nm.replace(' ', '　'), 'name'], [30, 198, 7, ro.upper(), 'roman'],
               [30, 214, 7, f'社員番号　{num}', 'num'], [30, 225, 7, f'有効期限　{jdate(exp)}', 'date'],
               [30, 250, 5, f'このカードは{CO}の所有物です', 'tmpl2']]
        pages.append(dict(person=k, items=it))
    edits = []
    if rnd:
        KANJI = '山川田村林森木本中野原口石松竹梅花空海緑誠健太郎美子'
        def change(s, pred, alts):
            idx = [i for i, ch in enumerate(s) if pred(ch)]; i = rnd.choice(idx)
            return s[:i] + rnd.choice([a for a in alts if a != s[i]]) + s[i + 1:]
        TYPES = ['name', 'dept', 'num', 'date', 'roman', 'name_add_h', 'dept_add', 'swap_name', 'co_drop', 'tmpl', 'numdrop']
        done = set()
        for t in rnd.sample(TYPES, len(TYPES)):
            if len(edits) >= n_err: break
            kind = {'name': 'name', 'name_add_h': 'name', 'swap_name': 'name', 'dept': 'dept', 'dept_add': 'dept', 'num': 'num', 'numdrop': 'num',
                    'date': 'date', 'roman': 'roman', 'co_drop': 'co', 'tmpl': ('tmpl', 'tmpl2')}[t]
            cand = [(p, i) for p, pg in enumerate(pages) if p not in done for i, x in enumerate(pg['items']) if x[4] in (kind if isinstance(kind, tuple) else (kind,))]
            if not cand: continue
            p, i = rnd.choice(cand); x = pages[p]['items'][i]; before = x[3]
            if t == 'name': after = change(before, lambda c: '一' <= c <= '鿿', KANJI)
            elif t == 'dept': after = change(before, lambda c: '一' <= c <= '鿿', KANJI)
            elif t == 'num': after = change(before, lambda c: c.isdigit(), '0123456789')
            elif t == 'numdrop': after = '社員番号　'
            elif t == 'date': after = change(before, lambda c: c.isdigit(), '0123456789')
            elif t == 'roman': after = change(before, lambda c: c.isalpha(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')
            elif t == 'name_add_h': after = before + rnd.choice(KANJI)
            elif t == 'dept_add': after = rnd.choice('新第本総') + before
            elif t == 'swap_name': after = rnd.choice([PEOPLE[j][2].replace(' ', '　') for j in CARDS if PEOPLE[j][2].replace(' ', '　') != before])
            elif t == 'co_drop': after = ''
            elif t == 'tmpl': after = change(before, lambda c: '一' <= c <= '鿿', '証書社員所有物力')
            x[3] = after; done.add(p)
            fnt = lambda s: 'L' if all(ord(ch) < 0x3000 for ch in s) else 'G'
            w = max(pdfmetrics.stringWidth(s, fnt(s), x[2]) for s in (before, after))
            edits.append(dict(page=p, type=t, before=before, after=after, size=x[2], box=[round(x[0] * K), round((x[1] - x[2]) * K), round((x[0] + w) * K), round((x[1] + 0.25 * x[2]) * K)]))
    c = canvas.Canvas(path, pagesize=(W, H))
    for pg in pages:
        c.setTrimBox(TRIM); c.setBleedBox((11, 11, 182, 273))
        c.setFont('G', 5); c.drawString(21, H + 1.5 - 5, f'shain_card_{pg["person"] + 1:02d}.pdf   1   2026/11/10   10:05')   # ページの外までかかるページ情報
        c.setLineWidth(0.5); c.rect(30, H - 140, 50, 62)   # 写真の枠
        for x, y, size, s, kind in pg['items']:
            if not s: continue
            c.setFont('L' if all(ord(ch) < 0x3000 for ch in s) else 'G', size); c.drawString(x, H - y, s)
        c.showPage()
    c.save()
    return edits

if __name__ == '__main__':
    out = sys.argv[1]; os.makedirs(out, exist_ok=True)
    if len(sys.argv) <= 2:
        book(os.path.join(out, 'shain.xlsx')); cards(os.path.join(out, 'shain_seika.pdf'))
        e = cards(os.path.join(out, 'shain_seika_err.pdf'), random.Random(5), 4)   # 自動テスト一式で使う(種5で誤りを4か所)
        json.dump(dict(seed=5, edits=e), open(os.path.join(out, 'shain_truth_err.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('ok', out)
    else:
        n, s0 = int(sys.argv[2]), int(sys.argv[3]) if len(sys.argv) > 3 else 1
        for seed in range(s0, s0 + n):
            d = os.path.join(out, f'v{seed}'); os.makedirs(d, exist_ok=True)
            book(os.path.join(d, 'shain.xlsx'))
            e = cards(os.path.join(d, 'seika.pdf'), random.Random(seed), 4)
            json.dump(dict(seed=seed, edits=e), open(os.path.join(d, 'truth.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
            print(f'v{seed}', len(e), '件')
