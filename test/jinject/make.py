# 価格・計算・番号のチェックの試験: 架空のカタログ2ページに誤りを無作為に入れた成果物を作る(文言はすべて架空)
#   python3 test/jinject/make.py 出力フォルダ [種(seed)の数] [最初の種(既定は1)]
#   出力フォルダ/v{種}/ に seika.pdf(成果物)と truth.json(入れた誤りの種類・ページ・位置(200dpi の画素))
#   誤りの種類(1つの成果物に5か所。同じ種類は2か所まで):
#     price   同じ品番が2か所以上に載っている価格のうち、1か所の数字を1桁変える
#     tax     税込と税抜を並べた価格の、どちらかの数字を1桁変える(10%の計算に合わなくなるもの)
#     noteref 本文の注記番号(※2 など)を、注記のない番号に変える
#     notedef 注記(説明)の番号を変える(番号が飛ぶ・重なる)
#     listno  箇条書きの丸数字を1つ変える(番号が飛ぶ・重なる)
#   要るもの: reportlab と IPAゴシック
import sys, os, json, random, math
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

pdfmetrics.registerFont(TTFont('ipag', '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'))
K = 200 / 72
CIRC = '①②③④⑤⑥⑦⑧⑨⑩'
PRODUCTS = [('KX-2041A', 'そよかぜサーキュレーター'), ('KX-3150B', 'ぽかぽかセラミックヒーター'), ('HT-7720W', 'しっとりスチーム加湿器'),
            ('AC-5608S', 'スリムタワーエアコン'), ('PB-1290K', 'ハンディクリーナーミニ'), ('LT-4410G', 'ベッドサイドライト'),
            ('DF-3301C', 'コンパクトデスクファン'), ('WF-5520H', 'ウォールファン'), ('MC-8810R', 'ミニクッカー'), ('TS-2207N', 'トースタースリム')]
TAXITEMS = ['電気ケトル', 'コーヒーメーカー', 'ブレンダー', 'ホットプレート', '炊飯器', '電子レンジ', '掃除機', 'アイロン']
NOTES = ['保証の内容は保証書をご覧ください。', '離島への配送は別料金です。', '設置の費用は別にかかります。', '写真は使用イメージです。',
         '在庫の数は店舗にお問い合わせください。', '色は実物と異なることがあります。']
BODY = ['保証期間はお買い上げ日から1年間です', '送料は全国一律です', '設置は専門の業者が行います', '表示の価格は店頭の価格です',
        '在庫には限りがあります', 'カラーは3色からお選びいただけます']
STEPS = ['電源プラグを差し込みます。', '運転ボタンを押します。', '風量を選びます。', 'タイマーを設定します。', '運転を止めます。']
yen = lambda v: f'{v:,}'

def one_digit(rnd, v, ok):
    """v の数字を1桁変えて、ok(新しい値) が真になるものを返す"""
    s = str(v)
    for _ in range(200):
        k = rnd.randrange(len(s)); d = rnd.choice([c for c in '0123456789' if c != s[k] and not (k == 0 and c == '0')])
        w = int(s[:k] + d + s[k + 1:])
        if ok(w): return w
    raise RuntimeError('変えられない')

def tax_ok(inc, exc):
    """ツールと同じ決まり: 税抜×1.1 の切り捨て・四捨五入・切り上げのどれかが税込か、税込÷1.1 のどれかが税抜なら合っている"""
    r = lambda x: {math.floor(x), math.floor(x + 0.5), math.ceil(x)}
    return inc in r(exc * 110 / 100) or exc in r(inc * 100 / 110)

def make(seed, out):
    rnd = random.Random(seed)
    prods = rnd.sample(PRODUCTS, 8)
    price = {c: rnd.randrange(30, 600) * 100 - rnd.choice([0, 20, 200]) for c, _ in prods}
    # ---- 紙面の中身(文字列と置き方)を先に決め、誤りを入れてから描く ----
    P = [[], []]   # ページごとの [x, y, 大きさ, 文字列, 印]
    def put(pg, x, y, size, s, tag=None): P[pg].append([x, y, size, s, tag])
    for pg, rows, y0 in ((0, prods[:6], 740), (1, [prods[0], prods[1], prods[6], prods[7]], 740)):
        put(pg, 50, 790, 18, ['春の家電セール　ご案内', '春の家電セール　お得な情報'][pg])
        for x, s in ((50, '品番'), (140, '品名'), (360, '価格（税込）')): put(pg, x, y0, 10, s)
        y = y0
        for c, n in rows:
            y -= 20
            put(pg, 50, y, 10, c); put(pg, 140, y, 10, n); put(pg, 360, y, 10, yen(price[c]) + '円', ('price', c))
        y -= 40
        if pg == 0:   # 表に載せた品番のうち3つを、説明でもう一度(同じ税込の価格)
            for c, n in rnd.sample(prods[:6], 3):
                put(pg, 50, y, 11, [f'{c}　{n}　', yen(price[c]), '円（税込）'], ('price', c)); y -= 24
        # 税込と税抜を並べた価格(4か所・3か所)
        for item in rnd.sample(TAXITEMS, 4 if pg == 0 else 3):
            exc = rnd.randrange(20, 500) * 100 - rnd.choice([0, 20, 2]); inc = math.floor(exc * 110 / 100)
            fm = rnd.randrange(4)
            parts = [[f'{item}　税込', yen(inc), '円（税抜', yen(exc), '円）'], [f'{item}　', yen(exc), '円（税込', yen(inc), '円）'],
                     [f'{item}　本体', yen(exc), '円（税込', yen(inc), '円）'], [f'{item}　税込', yen(inc), '円（本体', yen(exc), '円）']][fm]
            put(pg, 50, y, 11, parts, ('tax', inc, exc, fm)); y -= 24
        # 本文の注記番号と注記(1ページ目は※1〜※3、2ページ目は※4〜※5)
        nums = [1, 2, 3] if pg == 0 else [4, 5]
        for k, b in zip(nums, rnd.sample(BODY, len(nums))):
            put(pg, 50, y, 11, [b, f'※{k}', '。'], ('ref', k)); y -= 24
        y -= 6
        for k, t in zip(nums, rnd.sample(NOTES, len(nums))):
            put(pg, 50, y, 8, [f'※{k}', ' ' + t], ('def', k)); y -= 16
        y -= 20
        for k, t in enumerate(rnd.sample(STEPS, 4 if pg == 0 else 3)):
            put(pg, 50, y, 10, [CIRC[k], t], ('list', k + 1)); y -= 20
    # ---- 誤りを入れる ----
    TYPES = ['price', 'tax', 'noteref', 'notedef', 'listno']
    edits, used = [], set()
    plan = rnd.sample(TYPES, 5)   # 5種類を1つずつ
    for t in plan:
        cand = []
        for pg in (0, 1):
            for k, e in enumerate(P[pg]):
                tag = e[4]
                if not tag or (pg, k) in used: continue
                if t == 'price' and tag[0] == 'price' and sum(1 for q in (0, 1) for f in P[q] if f[4] and f[4][0] == 'price' and f[4][1] == tag[1]) >= 2: cand.append((pg, k))
                if t == 'tax' and tag[0] == 'tax': cand.append((pg, k))
                if t == 'noteref' and tag[0] == 'ref': cand.append((pg, k))
                if t == 'notedef' and tag[0] == 'def': cand.append((pg, k))
                if t == 'listno' and tag[0] == 'list' and tag[1] >= 2: cand.append((pg, k))
        # 同じ品番の価格・同じページの注記は、1つの誤りだけにする(誤りどうしが打ち消し合わないように)
        cand = [c for c in cand if not any(u[0] == c[0] and P[u[0]][u[1]][4][0] == P[c[0]][c[1]][4][0] for u in used) or t == 'price']
        if t == 'price': cand = [c for c in cand if not any(P[u[0]][u[1]][4][:2] == P[c[0]][c[1]][4][:2] for u in used)]
        if not cand: continue
        pg, k = rnd.choice(cand); e = P[pg][k]; tag = e[4]; used.add((pg, k))
        if t == 'price':
            v = price[tag[1]]; w = one_digit(rnd, v, lambda w: w != v and w >= 100)
            if isinstance(e[3], list): e[3][1] = yen(w)
            else: e[3] = yen(w) + '円'
            edits.append(dict(type=t, page=pg, code=tag[1], before=yen(v), after=yen(w), k=k))
        elif t == 'tax':
            inc, exc, fm = tag[1], tag[2], tag[3]
            if rnd.random() < 0.5:
                w = one_digit(rnd, inc, lambda w: not tax_ok(w, exc) and w >= 100); idx = 1 if fm in (0, 3) else 3; before, after = yen(inc), yen(w)
            else:
                w = one_digit(rnd, exc, lambda w: not tax_ok(inc, w) and w >= 100); idx = 3 if fm in (0, 3) else 1; before, after = yen(exc), yen(w)
            e[3][idx] = after
            edits.append(dict(type=t, page=pg, before=before, after=after, k=k))
        elif t == 'noteref':
            k0 = tag[1]; w = rnd.choice([8, 9]); e[3][1] = f'※{w}'   # 注記の番号を変える誤り(最大で※7)と重ならない番号
            edits.append(dict(type=t, page=pg, before=f'※{k0}', after=f'※{w}', k=k))
        elif t == 'notedef':
            k0 = tag[1]; nums = [f[4][1] for f in P[pg] if f[4] and f[4][0] == 'def']
            w = rnd.choice([x for x in range(min(nums), max(nums) + 3) if x != k0 and x >= 1])
            e[3][0] = f'※{w}'
            edits.append(dict(type=t, page=pg, before=f'※{k0}', after=f'※{w}', k=k))
        elif t == 'listno':
            k0 = tag[1]; n = sum(1 for f in P[pg] if f[4] and f[4][0] == 'list')
            w = rnd.choice([x for x in range(1, n + 2) if x != k0])
            e[3][0] = CIRC[w - 1]
            edits.append(dict(type=t, page=pg, before=CIRC[k0 - 1], after=CIRC[w - 1], k=k))
    # ---- 描く。誤りを入れた行の枠(200dpi の画素)を正解に書く ----
    os.makedirs(out, exist_ok=True)
    c = canvas.Canvas(os.path.join(out, 'seika.pdf'), pagesize=(595, 842))
    for pg in (0, 1):
        for k, (x, y, size, s, tag) in enumerate(P[pg]):
            s = ''.join(s) if isinstance(s, list) else s
            c.setFont('ipag', size); c.drawString(x, y, s)
            w = pdfmetrics.stringWidth(s, 'ipag', size)
            for e in edits:
                if e['page'] == pg and e['k'] == k: e['box'] = [round(x * K), round((842 - y - size) * K), round((x + w) * K), round((842 - y + 0.25 * size) * K)]; e['text'] = s
        c.showPage()
    c.save()
    for e in edits: del e['k']
    json.dump(dict(seed=seed, edits=edits), open(os.path.join(out, 'truth.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    return len(edits)

if __name__ == '__main__':
    out, n, s0 = sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 20, int(sys.argv[3]) if len(sys.argv) > 3 else 1
    for seed in range(s0, s0 + n): print(f'v{seed}', make(seed, f'{out}/v{seed}'), '件')
