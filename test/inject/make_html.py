# 直しを無作為に入れた模擬データ(条件を広げたもの)の HTML を作る(文言はすべて架空)。PDF にするのは render.js
#   python3 test/inject/make_html.py 出力フォルダ [種(seed)の数] [最初の種(既定は1)]
#   make.py との違い: 直すと後ろの字が送られる(段落の行が組み替わる)、縦組み・明朝体・プロポーショナルの字・色地に白抜きの字・回転した字を含む
#   出力フォルダ/v{種}/ に old.html・new.html(直した所に <span data-e="番号"> を付ける)・genko.txt・edits.json(位置は render.js が入れる)
#   直しの種類は make.py と同じ(1行消すの代わりに sentdel: 1文消す)
import sys, os, json, random, html
sys.path.insert(0, os.path.dirname(__file__))
from make import DAK, KANJI, SYM, FW, HW, HIRA, iskanji, iskata, isdig

F_SANS, F_SERIF = "'Noto Sans JP'", "'Noto Serif JP'"
# (名前, ページ, 種類, 字体, 大きさ(pt), 置き方(CSS), 文)
def blocks():
    B = [
        ('h1', 0, 'title', F_SERIF, 22, 'left:20mm; top:16mm; width:175mm;', '冬の新生活応援フェア　２０２６'),
        ('lead', 0, 'body', F_SANS, 10.5, 'left:20mm; top:34mm; width:118mm; line-height:1.75;',
         'いつもご愛顧いただき、誠にありがとうございます。新しい暮らしを始める方に向けて、省エネ性能の高い家電と、毎日の家事を楽にする便利な道具を取りそろえました。'
         '期間中は、対象の商品をお買い上げの方に、ポイントを２倍差し上げます。詳しくは販売店またはホームページでご確認ください。お問い合わせは、お客様センター（０１２０－４５６－'
         '７８９）まで。受付時間は平日の午前９時から午後６時までです。'),
        ('banner', 0, 'banner', F_SANS, 12, 'left:143mm; top:34mm; width:47mm; background:#1f4e8c; color:#fff; padding:3mm; line-height:1.55; font-weight:700;',
         '期間限定　ポイント２倍キャンペーン実施中！１２月２５日まで'),
        ('notes', 0, 'small', "'IPAPGothic'", 6.5, 'left:20mm; top:236mm; width:170mm; line-height:1.6;',
         '※価格はすべて消費税10％込みの希望小売価格です。販売店によって価格が異なる場合があります。※写真は使用イメージです。実際の製品とは色合いが異なることがあります。'
         '※仕様は予告なく変更することがあります。※記載の会社名・製品名は、各社の商標または登録商標です。'),
        ('vert', 1, 'vert', F_SERIF, 11, 'right:20mm; top:18mm; height:112mm; writing-mode:vertical-rl; line-height:1.8;',
         '冬の朝は、部屋がなかなか暖まりません。ぽかぽかセラミックヒーターは、電源を入れてから約三秒で暖かい風が出ます。転倒すると自動で電源が切れる安全機能を備え、'
         'タイマーは最長八時間まで設定できます。しっとりスチーム加湿器のタンクは大容量で、給水の回数を減らせます。フィルターは月に一度、ぬるま湯で洗ってください。'),
        ('body2', 1, 'body', F_SERIF, 10, 'left:20mm; top:140mm; width:170mm; line-height:1.8;',
         'サーキュレーターは、部屋の空気をすみずみまで循環させ、冷房や暖房の効きをよくします。羽根は簡単に取り外して水洗いできます。運転音は静音モードで約２２ｄＢと静かで、'
         '寝室でも気になりません。本体の大きさは幅２４０×奥行２４０×高さ８６０ｍｍ、質量は約３．２ｋｇです。保証期間はお買い上げ日から１年間です。'),
        ('rot', 1, 'rot', F_SANS, 9, 'left:12mm; top:118mm; width:90mm; transform:rotate(-90deg); transform-origin:left top;', '製品の改良のため、デザインや仕様を変更することがあります。'),
    ]
    cols = [(20, 26, 'cell', "'IPAPGothic'"), (47, 60, 'cell', "'IPAGothic'"), (108, 32, 'price', "'IPAGothic'"), (141, 50, 'cell', "'IPAGothic'")]
    rows = [('品番', '品名', '希望小売価格（税込）', '発売日'), ('KX-2041A', 'そよかぜサーキュレーター', '12,800円', '2026年11月5日（木）'),
            ('KX-3150B', 'ぽかぽかセラミックヒーター', '18,480円', '2026年11月12日（木）'), ('HT-7720W', 'しっとりスチーム加湿器', '24,200円', '2026年11月19日（木）'),
            ('AC-5608S', 'スリムタワーエアコン', '98,000円', '2026年12月3日（木）'), ('PB-1290K', 'ハンディクリーナーミニ', '9,980円', '2026年12月10日（木）'),
            ('LT-4410G', 'ベッドサイドライト', '6,578円', '2026年12月17日（木）')]
    for r, row in enumerate(rows):
        for c, s in enumerate(row):
            x, w, kind, font = cols[c]
            B.append((f't{r}{c}', 0, 'head' if r == 0 else kind, font, 9, f'left:{x}mm; top:{130 + r * 8}mm; width:{w}mm;', s))
    return B

def candidates(t, s, kind):
    out = []
    for i, c in enumerate(s):
        if t == 'kanji' and iskanji(c): out.append((i, 1, None))
        elif t == 'dakuten' and any(c in g for g in DAK): out.append((i, 1, None))
        elif t == 'choon' and c == 'ー' and i > 0 and iskata(s[i - 1]): out.append((i, 1, '一'))
        elif t == 'delete' and c.strip() and kind != 'price': out.append((i, 1, ''))
        elif t == 'insert' and kind != 'price' and i > 0: out.append((i, 0, None))
        elif t == 'digit' and isdig(c) and kind != 'price': out.append((i, 1, None))
        elif t == 'numlen' and isdig(c) and (i == 0 or not (isdig(s[i - 1]) or s[i - 1] in ',，．.')): out.append((i, 0, None))
        elif t == 'symbol' and c in SYM: out.append((i, 1, SYM[c]))
        elif t == 'width' and (c in FW or (c in HW and c.isalpha())): out.append((i, 1, FW.get(c) or HW.get(c)))
        elif t == 'swap' and i + 1 < len(s) and iskanji(c) and iskanji(s[i + 1]) and c != s[i + 1]: out.append((i, 2, s[i + 1] + c))
        elif t == 'small' and kind == 'small' and 'ぁ' <= c <= 'ん': out.append((i, 1, None))
        elif t == 'table' and kind == 'price' and isdig(c): out.append((i, 1, None))
        elif t == 'word' and i + 1 < len(s) and iskanji(c) and iskanji(s[i + 1]): out.append((i, 2, None))
        elif t == 'sentdel' and kind in ('body', 'vert', 'small') and (i == 0 or s[i - 1] == '。'):   # 1文(「。」まで)を消す
            e = s.find('。', i)
            if e > i: out.append((i, e + 1 - i, ''))
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

TYPES = ['kanji', 'dakuten', 'choon', 'delete', 'insert', 'digit', 'numlen', 'symbol', 'width', 'swap', 'small', 'table', 'sentdel', 'word']
FONTS = '''<link rel="stylesheet" href="{fs}/noto-sans-jp/400.css"><link rel="stylesheet" href="{fs}/noto-sans-jp/700.css"><link rel="stylesheet" href="{fs}/noto-serif-jp/400.css">'''

def page_html(B, texts, marks, fs):
    out = [f'<!doctype html><html lang="ja"><head><meta charset="utf-8">{FONTS.format(fs=fs)}<style>@page {{ size: A4; margin: 0 }} html, body {{ margin: 0 }} '
           '.pg { position: relative; width: 210mm; height: 297mm; overflow: hidden; page-break-after: always; } .b { position: absolute; margin: 0; }</style></head><body>']
    for pg in range(2):
        out.append('<div class="pg">')
        for k, (name, p, kind, font, size, css, _) in enumerate(B):
            if p != pg: continue
            s, ms = texts[k], sorted(marks.get(k, []), key=lambda m: m[0])
            h, at = '', 0
            for (pos, n, eid) in ms:   # 直した所に印(span)。消しただけの所は空の印
                h += html.escape(s[at:pos]) + f'<span data-e="{eid}">' + html.escape(s[pos:pos + n]) + '</span>'; at = pos + n
            h += html.escape(s[at:])
            out.append(f'<p class="b" data-k="{name}" style="{css} font-family:{font}; font-size:{size}pt;">{h}</p>')
        out.append('</div>')
    out.append('</body></html>')
    return ''.join(out)

def make(seed, out, fs):
    rnd = random.Random(1000 + seed)
    B = blocks()
    edits, used, dels = [], {k: [] for k in range(len(B))}, set()
    for t in TYPES:
        for _ in range(3):
            opts = [(k, c) for k, b in enumerate(B) for c in candidates(t, b[6], b[2]) if all(c[0] + c[1] + 4 <= p or p + 6 <= c[0] for p in used[k])
                    and not any(o['line'] == k and o['pos'] < c[0] + c[1] and c[0] < o['pos'] + o['n'] for o in edits)]
            if not opts: break
            k, (i, n, rep) = rnd.choice(opts)
            s = B[k][6]
            rep = fill(t, s, i, n, rnd) if rep is None else rep
            edits.append(dict(id=len(edits), type=t, line=k, pos=i, n=n, before=s[i:i + n], after=rep, page=B[k][1], kind=B[k][2], size=B[k][4])); used[k].append(i)
    olds = [b[6] for b in B]; news = list(olds); marks = {}
    for k in range(len(B)):
        sh = 0
        for e in sorted([e for e in edits if e['line'] == k], key=lambda e: e['pos']):
            p = e['pos'] + sh
            news[k] = news[k][:p] + e['after'] + news[k][p + e['n']:]
            marks.setdefault(k, []).append((p, len(e['after']), e['id']))
            sh += len(e['after']) - e['n']
    os.makedirs(out, exist_ok=True)
    open(f'{out}/old.html', 'w', encoding='utf-8').write(page_html(B, olds, {}, fs))
    open(f'{out}/new.html', 'w', encoding='utf-8').write(page_html(B, news, marks, fs))
    # テキストの原稿: ブロックごとに1行(表は行ごとにタブで区切る)。並びは紙面の順
    lines, row = [], []
    for k, b in enumerate(B):
        if b[0].startswith('t'):
            row.append(olds[k])
            if len(row) == 4: lines.append('\t'.join(row)); row = []
        else: lines.append(olds[k])
    open(f'{out}/genko.txt', 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    json.dump(dict(seed=seed, edits=edits), open(f'{out}/edits.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    return len(edits)

if __name__ == '__main__':
    out, n, s0 = sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 5, int(sys.argv[3]) if len(sys.argv) > 3 else 1
    fs = 'file://' + os.path.abspath(os.path.join(os.path.dirname(__file__), '../../test-kit/src/node_modules/@fontsource'))
    for seed in range(s0, s0 + n): print(f'v{seed}', make(seed, f'{out}/v{seed}', fs), '件')
