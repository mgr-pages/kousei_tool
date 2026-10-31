# 直しを無作為に入れた模擬データを作る(見逃しを種類ごとに数えるため。文言はすべて架空)
#   python3 test/inject/make.py 出力フォルダ [種(seed)の数] [最初の種(既定は1)]
#   出力フォルダ/v{種}/ に、次のものを作る
#     old.pdf    : 直す前(旧版。同じレイアウトのPDF原稿としても使う)
#     new.pdf    : 直しを入れた成果物(直した行のほかは同じ位置)
#     genko.txt  : 直す前の文(テキスト。レイアウトが違う原稿として使う)
#     truth.json : 入れた直しの一覧(種類・直す前と後の字・成果物での位置(200dpi の画素))
#   直しの種類(同じ種類を1つの成果物に3か所まで):
#     kanji 漢字を別の漢字に / dakuten 濁点・半濁点の違い(は→ば など) / choon 長音「ー」を漢数字「一」に(形がほぼ同じ) /
#     delete 1字消す / insert 1字足す / digit 数字1桁を変える / numlen 数字の桁を増やす(4,730→14,730) /
#     symbol 記号を変える(、→。 など) / width 全角と半角を変える / swap 隣り合う2字を入れ替える /
#     small 小さい字(6.5pt)の中の1字を変える / table 表の価格の数字を変える / linedel 1行を消す / word 漢字2字を別の2字に
import sys, os, json, random
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

pdfmetrics.registerFont(TTFont('G', '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'))
pdfmetrics.registerFont(TTFont('P', '/usr/share/fonts/opentype/ipafont-gothic/ipagp.ttf'))
W, H, K = 595.28, 841.89, 200 / 72

# (ページ, 種類, 字体, 大きさ, x, y(下から), 文, 段落の番号)。段落の番号が同じ行は、テキストの原稿では1つの段落につなげる
def layout():
    L = []
    add = lambda pg, kind, f, sz, x, y, s, para=None: L.append(dict(pg=pg, kind=kind, font=f, size=sz, x=x, y=y, s=s, para=para))
    add(0, 'title', 'G', 20, 60, 770, '秋の新製品カタログ　２０２６')
    lead = ['いつもご愛顧いただき、誠にありがとうございます。今年の秋は、', '暮らしを快適にする新しい家電を取りそろえました。省エネ性能を',
            '高めたエアコンや、静かに運転するサーキュレーターなど、全１２', '機種をご紹介します。詳しくは販売店またはホームページでご確認',
            'ください。お問い合わせは、お客様センター（０１２０－３４５－', '６７８）まで。受付時間は平日の午前９時から午後６時までです。']
    for i, s in enumerate(lead): add(0, 'body', 'G', 10.5, 60, 725 - i * 18, s, 'lead')
    cols = [60, 128, 300, 400]
    for j, s in enumerate(['品番', '品名', '希望小売価格（税込）', '発売日']): add(0, 'head', 'G', 9, cols[j], 590, s)
    rows = [('KX-2041A', 'そよかぜサーキュレーター', '12,800円', '2026年11月5日（木）'), ('KX-3150B', 'ぽかぽかセラミックヒーター', '18,480円', '2026年11月12日（木）'),
            ('HT-7720W', 'しっとりスチーム加湿器', '24,200円', '2026年11月19日（木）'), ('AC-5608S', 'スリムタワーエアコン', '98,000円', '2026年12月3日（木）'),
            ('PB-1290K', 'ハンディクリーナーミニ', '9,980円', '2026年12月10日（木）'), ('LT-4410G', 'ベッドサイドライト', '6,578円', '2026年12月17日（木）')]
    for i, r in enumerate(rows):
        for j, s in enumerate(r): add(0, 'price' if j == 2 else 'cell', 'P' if j == 0 else 'G', 9, cols[j], 570 - i * 18, s)
    notes = ['※価格はすべて消費税10％込みの希望小売価格です。販売店によって価格が異なる場合があります。',
             '※写真は使用イメージです。実際の製品とは色合いが異なることがあります。仕様は予告なく変更することがあります。',
             '※記載の会社名・製品名は、各社の商標または登録商標です。']
    for i, s in enumerate(notes): add(0, 'small', 'G', 6.5, 60, 430 - i * 11, s)
    add(1, 'title', 'G', 16, 60, 770, '製品の特長とお手入れについて')
    body = ['サーキュレーターは、部屋の空気をすみずみまで循環させ、冷房や', '暖房の効きをよくします。羽根は簡単に取り外して水洗いできます。',
            'ヒーターは、電源を入れてから約３秒で暖かい風が出ます。転倒する', 'と自動で電源が切れる安全機能を備えています。タイマーは最長８時',
            '間まで設定できます。加湿器のタンクは２．５Ｌの大容量で、給水の', '回数を減らせます。フィルターは月に一度、ぬるま湯で洗ってください。']
    for i, s in enumerate(body): add(1, 'body', 'G', 10.5, 60, 730 - i * 18, s, 'body')
    feats = ['・運転音は約２２ｄＢ（静音モード時）', '・消費電力は最大１，２００Ｗ（ヒーター強運転時）', '・本体サイズ：幅２４０×奥行２４０×高さ８６０ｍｍ',
             '・質量：約３．２ｋｇ（タンクを除く）', '・保証期間：お買い上げ日から１年間']
    for i, s in enumerate(feats): add(1, 'body', 'G', 9, 60, 600 - i * 16, s)
    smalls = ['※ご使用の前に、取扱説明書をよくお読みのうえ、正しくお使いください。', '※お手入れの際は、必ず電源プラグをコンセントから抜いてください。',
              '※製品の改良のため、デザインや仕様を変更することがあります。']
    for i, s in enumerate(smalls): add(1, 'small', 'G', 6.5, 60, 490 - i * 11, s)
    return L

DAK = ['かが', 'きぎ', 'くぐ', 'けげ', 'こご', 'さざ', 'しじ', 'すず', 'せぜ', 'そぞ', 'ただ', 'ちぢ', 'つづ', 'てで', 'とど', 'はばぱ', 'ひびぴ', 'ふぶぷ', 'へべぺ', 'ほぼぽ',
       'カガ', 'キギ', 'クグ', 'ケゲ', 'コゴ', 'サザ', 'シジ', 'スズ', 'セゼ', 'ソゾ', 'タダ', 'チヂ', 'ツヅ', 'テデ', 'トド', 'ハバパ', 'ヒビピ', 'フブプ', 'ヘベペ', 'ホボポ']
KANJI = '新親価値格各品晶番審名命発登日目月用秋科暮慕快決適摘家宅電雷性姓能態高髙静精運軍転伝紹招介会詳洋販飯売買店点確碓認任受授付府平半午牛時待'
SYM = {'、': '。', '。': '、', '・': '、', '（': '(', '）': ')', '：': ':', '×': 'x', '％': '%', '※': '＊'}
FW = {chr(c): chr(c - 0xFEE0) for c in range(0xFF10, 0xFF1A)} | {chr(c): chr(c - 0xFEE0) for c in range(0xFF21, 0xFF3B)} | {chr(c): chr(c - 0xFEE0) for c in range(0xFF41, 0xFF5B)}
HW = {v: k for k, v in FW.items()}
HIRA = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわを'
iskanji = lambda c: '一' <= c <= '鿿'
iskata = lambda c: 'ァ' <= c <= 'ヺ'
isdig = lambda c: c.isdigit()

def candidates(t, s, kind):
    """種類 t の直しを入れられる位置と、直したあとの字を返す: [(位置, 消す字数, 入れる字)]"""
    out = []
    for i, c in enumerate(s):
        if t == 'kanji' and iskanji(c): out.append((i, 1, None))
        elif t == 'dakuten' and any(c in g for g in DAK): out.append((i, 1, None))
        elif t == 'choon' and c == 'ー' and i > 0 and iskata(s[i - 1]): out.append((i, 1, '一'))
        elif t == 'delete' and c.strip() and kind != 'price': out.append((i, 1, ''))
        elif t == 'insert' and kind not in ('price',) and i > 0: out.append((i, 0, None))
        elif t == 'digit' and isdig(c) and kind != 'price': out.append((i, 1, None))
        elif t == 'numlen' and isdig(c) and (i == 0 or not (isdig(s[i - 1]) or s[i - 1] in ',，．.')): out.append((i, 0, None))
        elif t == 'symbol' and c in SYM: out.append((i, 1, SYM[c]))
        elif t == 'width' and (c in FW or (c in HW and c.isalpha())): out.append((i, 1, FW.get(c) or HW.get(c)))
        elif t == 'swap' and i + 1 < len(s) and iskanji(c) and iskanji(s[i + 1]) and c != s[i + 1]: out.append((i, 2, s[i + 1] + c))
        elif t == 'small' and kind == 'small' and 'ぁ' <= c <= 'ん': out.append((i, 1, None))
        elif t == 'table' and kind == 'price' and isdig(c): out.append((i, 1, None))
        elif t == 'word' and i + 1 < len(s) and iskanji(c) and iskanji(s[i + 1]): out.append((i, 2, None))
    return out

def fill(t, s, i, n, rnd):
    c = s[i] if i < len(s) else ''
    if t == 'kanji': return rnd.choice([k for k in KANJI if k != c])
    if t == 'dakuten': g = next(g for g in DAK if c in g); return rnd.choice([x for x in g if x != c])
    if t in ('digit', 'table'): return rnd.choice([d for d in '0123456789' if d != c]) if c.isascii() else rnd.choice([d for d in '０１２３４５６７８９' if d != c])
    if t == 'numlen': return rnd.choice('123456789') if c.isascii() else rnd.choice('１２３４５６７８９')
    if t == 'insert': return rnd.choice(HIRA)
    if t == 'small': return rnd.choice([h for h in HIRA if h != c])
    if t == 'word': return ''.join(rnd.choice([k for k in KANJI if k not in s[i:i + 2]]) for _ in range(2))
    raise ValueError(t)

TYPES = ['kanji', 'dakuten', 'choon', 'delete', 'insert', 'digit', 'numlen', 'symbol', 'width', 'swap', 'small', 'table', 'linedel', 'word']

def make(seed, out):
    rnd = random.Random(seed)
    L = layout()
    edits, used = [], {k: [] for k in range(len(L))}   # 行 → 直した位置(重ならないように、5字以上離す)
    dels = set()
    for t in TYPES:
        for _ in range(3):
            if t == 'linedel':
                pool = [k for k, l in enumerate(L) if l['kind'] in ('body', 'small') and k not in dels and not used[k]]
                if pool: k = rnd.choice(pool); dels.add(k); edits.append(dict(type=t, line=k, pos=0, n=len(L[k]['s']), before=L[k]['s'], after=''))
                continue
            opts = [(k, c) for k, l in enumerate(L) if k not in dels for c in candidates(t, l['s'], l['kind']) if all(abs(c[0] - p) >= 5 for p in used[k])]
            if not opts: break
            k, (i, n, rep) = rnd.choice(opts)
            s = L[k]['s']
            rep = fill(t, s, i, n, rnd) if rep is None else rep
            edits.append(dict(type=t, line=k, pos=i, n=n, before=s[i:i + n], after=rep)); used[k].append(i)
    # 直したあとの文
    news = [l['s'] for l in L]
    for k in range(len(L)):
        es = sorted([e for e in edits if e['line'] == k and e['type'] != 'linedel'], key=lambda e: -e['pos'])
        for e in es: news[k] = news[k][:e['pos']] + e['after'] + news[k][e['pos'] + e['n']:]
    # 位置(成果物での、直した字の枠。消した字は、その位置の前後の字の境目)
    for e in edits:
        l = L[e['line']]; f, sz = l['font'], l['size']
        if e['type'] == 'linedel': x0, x1 = l['x'], l['x'] + pdfmetrics.stringWidth(l['s'], f, sz)
        else:
            sh = sum(len(o['after']) - o['n'] for o in edits if o['line'] == e['line'] and o['type'] != 'linedel' and o['pos'] < e['pos'])   # 前の直しで字がずれた分
            pre = news[e['line']][:e['pos'] + sh]
            x0 = l['x'] + pdfmetrics.stringWidth(pre, f, sz); x1 = x0 + max(pdfmetrics.stringWidth(e['after'], f, sz), 0.0)
            if x1 - x0 < 1: x0, x1 = x0 - 0.5 * sz, x0 + 0.5 * sz
        e.update(page=l['pg'], kind=l['kind'], size=sz, box=[round(x0 * K), round((H - l['y'] - 0.88 * sz) * K), round(x1 * K), round((H - l['y'] + 0.12 * sz) * K)])
    os.makedirs(out, exist_ok=True)
    for name, texts in (('old', [l['s'] for l in L]), ('new', news)):
        c = canvas.Canvas(f'{out}/{name}.pdf', pagesize=(W, H))
        for pg in range(2):
            for k, l in enumerate(L):
                if l['pg'] != pg or (name == 'new' and k in dels): continue
                c.setFont(l['font'], l['size']); c.drawString(l['x'], l['y'], texts[k])
            c.showPage()
        c.save()
    # テキストの原稿: 段落の行はつなげ、表は行ごとにタブで区切る(並びは紙面の順)
    lines, para, row = [], None, []
    for l in L:
        if l['kind'] in ('cell', 'price', 'head'):   # 表: 4つのセルで1行
            row.append(l['s'])
            if len(row) == 4: lines.append('\t'.join(row)); row = []
            para = None; continue
        if l['para'] and l['para'] == para: lines[-1] += l['s']
        else: lines.append(l['s'])
        para = l['para']
    open(f'{out}/genko.txt', 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    json.dump(dict(seed=seed, edits=edits), open(f'{out}/truth.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    return len(edits)

if __name__ == '__main__':
    out, n, s0 = sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 5, int(sys.argv[3]) if len(sys.argv) > 3 else 1
    for seed in range(s0, s0 + n): print(f'v{seed}', make(seed, f'{out}/v{seed}'), '件')
