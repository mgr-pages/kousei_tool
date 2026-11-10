# 差し込み印刷(名刺)の模擬データを作る(会社・人・住所・電話番号・メールはすべて架空)
#   python3 test/merge/make.py 出力フォルダ                 → meishi.xlsx(原稿：名刺のデータの表)と seika.pdf(成果物：名刺の表と裏。誤りなし)、
#                                                            seika_err.pdf・truth_err.json(種7で誤りを4か所入れたもの)、seika_err2.pdf・truth_err2.json
#                                                            (種7で別の種類の誤り(--more)を4か所入れたもの。どちらも自動テスト一式で使う)
#   python3 test/merge/make.py 出力フォルダ 種の数 [最初の種]  → 出力フォルダ/v{種}/ に、誤りを無作為に4か所入れた seika.pdf と truth.json
#   原稿の作り: 1行目が見出し。表の上に会社名・住所(大阪本社・東京営業所)、見出しのない列に事業所の電話番号の表、人数の行。
#     役職は日本語・英語とも改行で2・3行のことがある。携帯は国内の書き方と国番号つきの書き方の2行。勤務地(名刺には載らない)
#     2枚目のシート(グループ会社)には同じ人の行が、別の役職で載る(名刺には使わない)
#   成果物の作り: 名刺1人分が表(日本語)と裏(英語)の2ページ。仕上がり 55×91mm(TrimBox)、上にページの外までかかるページ情報。
#     表: 役職(2〜3行)・縦組みの氏名(1字ずつ)・会社名・住所2行・T/F・M・E。裏: 英語の役職・ローマ字の氏名(大文字・字間あり・右寄せ)・
#     会社名・英語の住所2行(原稿にない字)・国番号つきの T/F・M・E。東京営業所の人は住所と電話番号が東京のもの
#   誤りの種類(truth.json の type): name 氏名の1字 / title 役職の1字 / titledrop 役職の1行が抜ける / entitle 英語の役職の1字 /
#     roman ローマ字の氏名の1字 / email_f・email_b 表・裏のメールの1字 / mobile_f・mobile_b 表・裏の携帯の1桁 /
#     tmpl_en 英語の住所の1字(原稿にない字) / tmpl_co 会社名の1字 / tel_f 事業所の電話番号の1桁 / teldrop 事業所の電話番号が消える(「T」だけ残る)
#   --more を付けると、別の種類の誤り(字が増える・ほかの人の値・行ごと消える)を入れる:
#     title_add 役職の頭か終わりに1字増える / entitle_add 英語の役職の頭か終わりに1語増える / name_add 縦組みの氏名の終わりに1字増える /
#     swap_title 役職の1行がほかの人の役職 / swap_email_b 裏のメールがほかの人のメール / line_drop 裏の英語の会社名・住所(原稿にない字)の1行が消える /
#     co_drop 表の会社名の行が消える / addr_drop 表の住所の1行が消える
#   要るもの: reportlab・openpyxl と IPAゴシック・Liberation Sans
import sys, os, json, random
import openpyxl
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

pdfmetrics.registerFont(TTFont('G', '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'))
pdfmetrics.registerFont(TTFont('L', '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'))   # 英字だけの行の書体(字の幅を埋め込む)
W, H, K = 227, 342, 200 / 72
TRIM = (35.5, 35.5, 191.4, 306.5)
CO = '架空ホールディングス株式会社'
OFFICE = {
    '大阪': dict(addr=('〒530-0000　大阪府大阪市北区架空町1-2-3', '架空ビル5階'), tel='06-0000-1111', fax='06-0000-1112',
               en=('1-2-3 Kakuucho, Kita-ku, Kakuu Building', '5F Osaka 530-0000 Japan')),
    '東京': dict(addr=('〒100-0000　東京都千代田区架空2-3-4', 'みどりタワー9階'), tel='03-0000-2221', fax='03-0000-2222',
               en=('2-3-4 Kakuu, Chiyoda-ku, Midori Tower', '9F Tokyo 100-0000 Japan')),
}
# (部署, 役職(日本語), 役職(英語), 氏名, ローマ字, メール, 携帯の番号, 勤務地)
PEOPLE = [
    ('', '専務取締役\n技術本部長', 'Senior Managing Director\nHead of Technology', '架山太郎', 'Taro Kayama', 't.kayama', '0001', '大阪'),
    ('', '常務取締役\n経営企画室長\n品質管理部長', 'Managing Director\nHead of Corporate Planning\nGeneral Manager, Quality Control', '空野花子', 'Hanako Sorano', 'h.sorano', '0002', '大阪'),
    ('', '執行役員\n研究開発部長', 'Executive Officer\nGeneral Manager, Research', '緑川健一', 'Kenichi Midorikawa', 'k.midorikawa', '0003', '大阪'),
    ('', '経営企画室長', 'Head of Corporate Planning Office', '森野由美', 'Yumi Morino', 'y.morino', '0004', '大阪'),
    ('営業部', '部長', 'General Manager\nSales Division', '海老原誠', 'Makoto Ebihara', 'm.ebihara', '0005', '東京'),
    ('営業部', '課長', 'Manager\nSales Division', '林田さくら', 'Sakura Hayashida', 's.hayashida', '0006', '大阪'),
    ('庶務部', '主任', 'Supervisor\nGeneral Services Division', '石原大地', 'Daichi Ishihara', 'd.ishihara', '0007', '大阪'),
    ('庶務部', '', 'General Services Division', '小川美緒', 'Mio Ogawa', 'm.ogawa', '0008', '東京'),
]
CARDS = [0, 1, 2, 3, 4, 5]   # 名刺を作る人(6人。2人は作らない)

def book(path):
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = '本社'
    ws.append(['部署名', '役職（英語）', '役職', '氏名', '氏名（ローマ字）', 'Eメール', '携帯', '勤務地'])
    ws.append([CO]); ws.append([OFFICE['大阪']['addr'][0] + '　' + OFFICE['大阪']['addr'][1]]); ws.append([OFFICE['東京']['addr'][0] + '　' + OFFICE['東京']['addr'][1]])
    side = ['大阪本社', 'TEL  ' + OFFICE['大阪']['tel'], 'FAX  ' + OFFICE['大阪']['fax'], '東京営業所', 'TEL  ' + OFFICE['東京']['tel'], 'FAX  ' + OFFICE['東京']['fax']]
    for k, (dep, tj, te, nm, ro, em, mo, of) in enumerate(PEOPLE):
        ws.append([dep, te, tj, nm, ro, em + '@example.com', f'090-0000-{mo}\n+81-90-0000-{mo}', of, None, side[k] if k < len(side) else None])
        if k == 3: ws.append([None, None, None, '4名'])
    ws.append([None, None, None, '8名'])
    g = wb.create_sheet('グループ会社')   # 同じ人の行(別の役職)。名刺には使わない
    g.append(['部署名', '役職（英語）', '役職', '氏名', '氏名（ローマ字）', 'Eメール', '携帯', '勤務地'])
    for dep, tj, te, nm, ro, em, mo, of in PEOPLE[:4]: g.append(['', '', '顧問', nm, ro, em + '@example.com', f'090-0000-{mo}', of])
    wb.save(path)

def cards(path, rnd=None, n_err=0, more=False):
    """名刺の PDF。rnd があれば、誤りを n_err か所入れて truth を返す(more: 別の種類の誤り)"""
    # ページごとの文字列: [x, y(上から), 大きさ, 文字列, 種類, 字の間, 右寄せ]
    pages = []
    for k in CARDS:
        dep, tj, te, nm, ro, em, mo, of = PEOPLE[k]; o = OFFICE[of]
        f = [[45, 60 + 9 * i, 5.5, t, 'title', 0, False] for i, t in enumerate(tj.split('\n')) if t]
        if dep: f.insert(0, [45, 51, 5.5, dep, 'dep', 0, False])
        f += [[171, 67 + 19 * i, 11, ch, 'name', 0, False] for i, ch in enumerate(nm)]
        f += [[45, 180, 6.3, 'KAKUU', 'co_en', 0, False], [45, 190, 5.5, CO, 'co', 0, False],
              [45, 205, 5.5, o['addr'][0], 'addr', 0, False], [45, 214, 5.5, o['addr'][1], 'addr', 0, False],
              [46, 229, 6.3, f'T　{o["tel"]}    F　{o["fax"]}', 'tel', 0, False], [45, 238, 6.3, f'M　090-0000-{mo}', 'mobile', 0, False],
              [46, 247, 6.3, f'E　{em}@example.com', 'email', 0, False]]
        b = [[45, 62 + 9 * i, 6.3, t, 'entitle', 0, False] for i, t in enumerate(te.split('\n'))]
        given, family = ro.split()
        b += [[181, 110, 10.6, given.upper(), 'roman', 1.2, True], [181, 123, 10.6, family.upper(), 'roman', 1.2, True],
              [45, 180, 6.3, 'KAKUU', 'co_en', 0, False], [45, 189, 6.3, 'Kakuu Holdings Co., Ltd.', 'co_en', 0, False],
              [45, 205, 5.5, o['en'][0], 'tmpl_en', 0, False], [45, 214, 5.5, o['en'][1], 'tmpl_en', 0, False],
              [46, 229, 5.5, f'T +81-{o["tel"][1:]}  F +81-{o["fax"][1:]}', 'tel_en', 0, False], [45, 238, 6.3, f'M +81-90-0000-{mo}', 'mobile', 0, False],
              [46, 247, 6.3, f'E {em}@example.com', 'email', 0, False]]
        pages += [dict(person=k, side='omote', items=f), dict(person=k, side='ura', items=b)]
    edits = []
    if rnd:
        def change(s, pred, alts):
            idx = [i for i, ch in enumerate(s) if pred(ch)]
            i = rnd.choice(idx); ch = s[i]
            return s[:i] + rnd.choice([a for a in alts if a != ch]) + s[i + 1:], i
        KANJI = '山川田村林森木本中野原口石松竹梅花空海緑誠健太郎美子'
        TYPES = ['name', 'title', 'titledrop', 'entitle', 'roman', 'email_f', 'email_b', 'mobile_f', 'mobile_b', 'tmpl_en', 'tmpl_co', 'tel_f', 'teldrop']
        if more: TYPES = ['title_add', 'entitle_add', 'name_add', 'swap_title', 'swap_email_b', 'line_drop', 'co_drop', 'addr_drop']
        done = set()
        for t in rnd.sample(TYPES, len(TYPES)):
            if len(edits) >= n_err: break
            side = 'ura' if t in ('entitle', 'roman', 'email_b', 'mobile_b', 'tmpl_en', 'entitle_add', 'swap_email_b', 'line_drop') else 'omote'
            cand = [(p, i) for p, pg in enumerate(pages) if pg['side'] == side and p not in done for i, it in enumerate(pg['items'])
                    if (t == 'name' and it[4] == 'name') or (t in ('title', 'title_add', 'swap_title') and it[4] == 'title') or (t in ('entitle', 'entitle_add') and it[4] == 'entitle')
                    or (t == 'roman' and it[4] == 'roman') or (t.startswith('email') and it[4] == 'email') or (t.startswith('mobile') and it[4] == 'mobile')
                    or (t == 'tmpl_en' and it[4] == 'tmpl_en') or (t == 'tmpl_co' and it[4] == 'co') or (t in ('tel_f', 'teldrop') and it[4] == 'tel')
                    or (t == 'titledrop' and it[4] == 'title' and sum(1 for x in pg['items'] if x[4] == 'title') >= 2)
                    or (t == 'swap_email_b' and it[4] == 'email') or (t == 'co_drop' and it[4] == 'co') or (t == 'addr_drop' and it[4] == 'addr')
                    or (t == 'line_drop' and (it[4] == 'tmpl_en' or (it[4] == 'co_en' and it[3] != 'KAKUU')))
                    or (t == 'name_add' and it[4] == 'name' and i + 1 < len(pg['items']) and pg['items'][i + 1][4] != 'name')]
            if not cand: continue
            p, i = rnd.choice(cand); it = pages[p]['items'][i]; before = it[3]
            if t == 'name_add':   # 縦組みの氏名の最後の字の下に、1字増える(新しい字の行)
                it = [it[0], it[1] + 19, it[2], rnd.choice(KANJI), 'name', 0, False]; pages[p]['items'].insert(i + 1, it); before, after = '', it[3]
            elif t == 'name': after, _ = change(before, lambda c: True, KANJI)
            elif t in ('title', 'tmpl_co'): after, _ = change(before, lambda c: '一' <= c <= '鿿', KANJI)
            elif t == 'titledrop': after = ''
            elif t in ('entitle', 'roman', 'tmpl_en'): after, _ = change(before, lambda c: c.isalpha(), 'abcdefghijklmnopqrstuvwxyz' if t != 'roman' else 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')
            elif t.startswith('email'): after, _ = change(before, lambda c: c.isalpha() and c != 'E', 'abcdefghijklmnopqrstuvwxyz')
            elif t.startswith('mobile'): after, _ = change(before, lambda c: c.isdigit(), '0123456789')
            elif t == 'tel_f': after, _ = change(before, lambda c: c.isdigit(), '0123456789')
            elif t == 'teldrop': tel = before.split('　')[1].split()[0]; after = before.replace(tel, '　' * 6, 1)   # 電話番号だけを消す(「F」の位置はほぼそのまま)
            elif t == 'title_add': ch = rnd.choice(KANJI); after = ch + before if rnd.random() < 0.5 else before + ch
            elif t == 'entitle_add': after = rnd.choice(['Senior ', 'Deputy ', 'Acting ']) + before if rnd.random() < 0.5 else before + rnd.choice([' Assistant', ' Office', ' Group'])
            elif t == 'swap_title':
                other = [x for k in CARDS for x in PEOPLE[k][1].split('\n') if x and x != before]
                after = rnd.choice(other)
            elif t == 'swap_email_b':
                other = [PEOPLE[k][5] for k in CARDS if PEOPLE[k][5] not in before]
                after = 'E ' + rnd.choice(other) + '@example.com'
            elif t in ('line_drop', 'co_drop', 'addr_drop'): after = ''
            it[3] = after; done.add(p)
            fnt = lambda s: 'L' if all(ord(ch) < 0x3000 for ch in s) else 'G'
            w = max(pdfmetrics.stringWidth(x, fnt(x), it[2]) + it[5] * len(x) for x in (before, after))
            x0 = it[0] - w if it[6] else it[0]
            edits.append(dict(page=p, type=t, before=before, after=after, size=it[2], box=[round(x0 * K), round((it[1] - it[2]) * K), round((x0 + w) * K), round((it[1] + 0.25 * it[2]) * K)]))
    c = canvas.Canvas(path, pagesize=(W, H))
    for pg in pages:
        c.setTrimBox(TRIM); c.setBleedBox((27, 27, 200, 315))
        nm = PEOPLE[pg['person']][3]
        c.setFont('G', 6); c.drawString(36, H + 1.5 - 6, f'ai_kakuu_名刺_{nm}_{pg["side"]}.pdf   1   2026/10/27   18:29')   # ページの外までかかるページ情報
        for x, y, size, s, kind, sp, right in pg['items']:
            if not s: continue
            font = 'L' if all(ord(ch) < 0x3000 for ch in s) else 'G'   # 英字だけの行は欧文の書体
            c.setFont(font, size)
            if sp:
                w = pdfmetrics.stringWidth(s, font, size) + sp * len(s)
                c.saveState(); t = c.beginText(x - w if right else x, H - y); t.setFont(font, size); t.setCharSpace(sp); t.textOut(s); c.drawText(t); c.restoreState()   # 字間はこの行だけ
            else: c.drawString(x, H - y, s)
        c.showPage()
    c.save()
    return edits

if __name__ == '__main__':
    out = sys.argv[1]; os.makedirs(out, exist_ok=True)
    if len(sys.argv) <= 2:
        book(os.path.join(out, 'meishi.xlsx')); cards(os.path.join(out, 'seika.pdf'))
        e = cards(os.path.join(out, 'seika_err.pdf'), random.Random(7), 4)
        json.dump(dict(seed=7, edits=e), open(os.path.join(out, 'truth_err.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        e = cards(os.path.join(out, 'seika_err2.pdf'), random.Random(7), 4, True)   # 別の種類の誤り(字が増える・ほかの人の値・行ごと消える)
        json.dump(dict(seed=7, edits=e), open(os.path.join(out, 'truth_err2.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('ok', out)
    else:
        more = '--more' in sys.argv; a = [x for x in sys.argv if x != '--more']
        n, s0 = int(a[2]), int(a[3]) if len(a) > 3 else 1
        for seed in range(s0, s0 + n):
            d = os.path.join(out, f'v{seed}'); os.makedirs(d, exist_ok=True)
            book(os.path.join(d, 'meishi.xlsx'))
            e = cards(os.path.join(d, 'seika.pdf'), random.Random(seed), 4, more)
            json.dump(dict(seed=seed, edits=e), open(os.path.join(d, 'truth.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
            print(f'v{seed}', len(e), '件')
