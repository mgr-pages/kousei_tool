# 実物のPDF(どんなレイアウトでもよい)に、誤りを無作為に入れた「新しい版」と、その一部を注釈で指示した「原稿」を作る
#   正解を人が決めなくても、どのPDFでも検出率を測れるようにするための道具(入れたPDFと出力は、リポジトリに入れない)
#   python3 -I test/realcheck/mutate.py 入力.pdf 出力フォルダ [--seed 1] [--per-page 12] [--pages 1-4]
#   出力:
#     base.pdf   前の版(入力のページそのまま)
#     new.pdf    新しい版(誤りを入れたもの)
#     genko.pdf  前の版に、マーカーの注釈で指示を入れたもの
#     truth.json 入れた誤りの位置・種類・役割と、誤りを入れた副作用で見た目が変わった所(side)
#   誤りは、その字を取り除いて(PyMuPDF の redaction)、同じ位置に別の字を書き込んで入れる。字を取り除くと、同じ行の後ろの字の位置が
#   少し変わることがある(実際の直しで起きる字の送りに近い)。誤りの枠の外で見た目が変わった所を side に書き出し、採点では余分な検出と分けて数える
#   1ページに入れるもの(--per-page 12 のとき):
#     指示どおりに直したもの 8(1字の置き換え・2字の置き換え・数字1字・2〜5字の削除。注釈あり)
#     指示にない変更 2(置き換え・削除。注釈なし)
#     直し間違い 1(注釈の字と違う字に直した)
#     直っていない 1(注釈だけで、直していない)
#   文字データのある字だけを対象にする(アウトライン化した字・画像の字には入れない)。横組みの字は置き換えと削除、ほかの向きの字は削除だけ
#   要るもの: PyMuPDF と IPAゴシック
import sys, os, json, random, argparse
import pymupdf

IPAG = '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'
POOL = {'kanji': '東西南北春夏秋冬山川海空', 'hira': 'あいうえおかきくけこさしすせそ', 'kata': 'アイウエオカキクケコサシスセソ',
        'digit': '0123456789', 'upper': 'ABCDEFGHKLMNPRSTXY', 'lower': 'abcdefghkmnprstxy'}

def cls(c):
    o = ord(c)
    if '0' <= c <= '9': return 'digit'
    if 0x4E00 <= o <= 0x9FFF: return 'kanji'
    if 0x3041 <= o <= 0x3096: return 'hira'
    if 0x30A1 <= o <= 0x30FA: return 'kata'
    if 'A' <= c <= 'Z': return 'upper'
    if 'a' <= c <= 'z': return 'lower'
    return None

def chars_of(page):
    out = []
    for b in page.get_text('rawdict')['blocks']:
        for l in b.get('lines', []):
            horiz = abs(l['dir'][0] - 1) < 1e-3 and abs(l['dir'][1]) < 1e-3 and l.get('wmode', 0) == 0
            for s in l['spans']:
                run = []
                for ch in s['chars']:
                    if not ch['c'].strip():
                        run = []; continue   # 空白で続きを切る
                    it = dict(c=ch['c'], box=[float(v) for v in ch['bbox']], origin=[float(v) for v in ch['origin']], size=float(s['size']), color=int(s['color']), horiz=horiz, run=run, k=len(run))
                    run.append(it); out.append(it)
    return out

def gap(a, b):
    dx = max(0, max(a[0], b[0]) - min(a[2], b[2])); dy = max(0, max(a[1], b[1]) - min(a[3], b[3]))
    return (dx * dx + dy * dy) ** 0.5

def union(bs):
    return [min(b[0] for b in bs), min(b[1] for b in bs), max(b[2] for b in bs), max(b[3] for b in bs)]

def other(c, rnd, avoid=''):
    pool = [x for x in POOL[cls(c)] if x != c and x not in avoid]
    return rnd.choice(pool)

# 役割: ok 指示どおり(注釈あり・直した) / free 指示にない変更(注釈なし・直した) / wrong 直し間違い(注釈の字と違う字に直した) / skip 直っていない(注釈だけ)
PLAN = [('rep', 'ok'), ('digit', 'ok'), ('del', 'ok'), ('rep2', 'ok'), ('rep', 'ok'), ('digit', 'ok'), ('del', 'ok'), ('rep2', 'ok'),
        ('rep', 'free'), ('del', 'free'), ('rep', 'wrong'), ('rep', 'skip')]

def pick(page, rnd, n):
    cs = chars_of(page); R = page.rect; inset = 12
    ok = lambda b: b[0] > R.x0 + inset and b[1] > R.y0 + inset and b[2] < R.x1 - inset and b[3] < R.y1 - inset and b[2] - b[0] > 2 and b[3] - b[1] > 3
    cand = [c for c in cs if ok(c['box']) and c['size'] >= 5]
    rnd.shuffle(cand)
    edits, taken = [], []
    plan = [PLAN[i % len(PLAN)] for i in range(n)]
    for kind, role in plan:
        for c in cand:
            if c.get('used'): continue
            k = cls(c['c'])
            if kind == 'digit' and k != 'digit': continue
            if kind in ('rep', 'rep2') and (k in (None, 'digit') or not c['horiz']): continue
            if kind == 'rep2':
                nx = c['run'][c['k'] + 1] if c['k'] + 1 < len(c['run']) else None
                if not nx or cls(nx['c']) in (None, 'digit') or nx.get('used'): continue
                grp = [c, nx]
            elif kind == 'del':
                m = rnd.randint(2, 5); grp = c['run'][c['k']:c['k'] + m]
                if len(grp) < 2 or any(g.get('used') for g in grp): continue
            else:
                if kind == 'digit' and not c['horiz']: continue
                grp = [c]
            box = union([g['box'] for g in grp])
            if not ok(box) or any(gap(box, t) < 24 for t in taken): continue
            before = ''.join(g['c'] for g in grp)
            after = '' if kind == 'del' else ''.join(other(g['c'], rnd) for g in grp)
            note = 'トル' if kind == 'del' else after
            applied = after
            if role == 'wrong': applied = ''.join(other(g['c'], rnd, avoid=after) for g in grp)   # 注釈の字と違う字に直す
            if role == 'skip': applied = before
            for g in grp: g['used'] = True
            taken.append(box)
            edits.append(dict(rect=box, kind=kind, role=role, before=before, after=applied, note=note if role != 'free' else '',
                              size=grp[0]['size'], origin=grp[0]['origin'], color=grp[0]['color'], horiz=grp[0]['horiz']))
            break
    return edits

def apply(page, edits):
    todo = [e for e in edits if e['role'] != 'skip']
    for e in todo:
        r = e['rect']; w = (r[2] - r[0]) / max(1, len(e['before'])); h = r[3] - r[1]
        if e['horiz']: rr = pymupdf.Rect(r[0] + 0.2 * w, r[1] + 0.25 * h, r[2] - 0.2 * w, r[3] - 0.25 * h)
        else: rr = pymupdf.Rect(r[0] + 0.25 * (r[2] - r[0]), r[1] + 0.1 * h, r[2] - 0.25 * (r[2] - r[0]), r[3] - 0.1 * h)
        page.add_redact_annot(rr, fill=False, cross_out=False)
    if todo: page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE)
    for e in todo:
        if e['after']:
            col = e['color']; rgb = ((col >> 16 & 255) / 255, (col >> 8 & 255) / 255, (col & 255) / 255)
            page.insert_text(pymupdf.Point(e['origin']), e['after'], fontsize=e['size'], fontname='ipag', fontfile=IPAG, color=rgb)

def differs(pa, pb, rect, dpi=120):
    clip = pymupdf.Rect(rect) + (-1, -1, 1, 1)
    a = pa.get_pixmap(clip=clip, dpi=dpi, alpha=False); b = pb.get_pixmap(clip=clip, dpi=dpi, alpha=False)
    if (a.width, a.height) != (b.width, b.height): return 10 ** 6
    sa, sb = a.samples, b.samples
    return sum(1 for i in range(0, len(sa), 3) if abs(sa[i] - sb[i]) + abs(sa[i + 1] - sb[i + 1]) + abs(sa[i + 2] - sb[i + 2]) > 60)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('out'); ap.add_argument('--seed', type=int, default=1); ap.add_argument('--per-page', type=int, default=12); ap.add_argument('--pages', default='')
    ap.add_argument('--resurvey', action='store_true', help='出力フォルダの base.pdf・new.pdf・truth.json から、副作用で変わった所(side)だけを求め直す(入力は使わない)')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    rnd = random.Random(a.seed)
    bp, npth, gp = (os.path.join(a.out, n) for n in ('base.pdf', 'new.pdf', 'genko.pdf'))
    if not a.resurvey:
        src = pymupdf.open(a.src)
        if a.pages:
            lo, hi = (int(x) for x in a.pages.split('-')); src.select(list(range(lo - 1, min(hi, src.page_count))))
        src.save(bp, garbage=3, deflate=True)
    base = pymupdf.open(bp); new = pymupdf.open(bp); gen = pymupdf.open(bp)
    prev = json.load(open(os.path.join(a.out, 'truth.json'), encoding='utf-8')) if a.resurvey else None
    truth = prev['edits'] if prev else []
    if prev: a.seed = prev.get('seed', a.seed)
    for pno in range(base.page_count if not a.resurvey else 0):
        edits = pick(base[pno], rnd, a.per_page)
        npage, gpage = new[pno], gen[pno]   # ページを変数に持つ(注釈がページから外れないように)
        apply(npage, edits)
        for e in edits:
            e['page'] = pno
            if e['note']:
                an = gpage.add_highlight_annot(pymupdf.Rect(e['rect']).quad)
                an.set_info(content=e['note'], title='確認者'); an.update()
        truth += edits
    if not a.resurvey: new.save(npth, garbage=3, deflate=True); gen.save(gp, garbage=3, deflate=True)
    # 入れた誤りが実際に見えているか(白い字・ほかの物の下の字などは、見た目が変わらない)と、誤りの所の外が変わっていないかを確かめる
    new = pymupdf.open(npth); outside = 0; side = []
    for pno in range(base.page_count):
        es = [e for e in truth if e['page'] == pno]
        for e in es:
            if 'visible' not in e: e['visible'] = differs(base[pno], new[pno], e['rect']) > 3 if e['role'] != 'skip' else False
            for k in ('origin', 'color'): e.pop(k, None)
        # ページ全体(72dpi)の違いのうち、誤りの枠(4pt 広げる)の外の画素。8pt のます目でつながる所を1つの枠にまとめる(副作用で変わった所)
        pa = base[pno].get_pixmap(dpi=72, alpha=False); pb = new[pno].get_pixmap(dpi=72, alpha=False)
        if (pa.width, pa.height) == (pb.width, pb.height):
            R = base[pno].rect; sa, sb, W = pa.samples, pb.samples, pa.width; cells = set(); G = 8
            for i in range(0, len(sa), 3):
                if abs(sa[i] - sb[i]) + abs(sa[i + 1] - sb[i + 1]) + abs(sa[i + 2] - sb[i + 2]) > 60:
                    x = (i // 3) % W + R.x0; y = (i // 3) // W + R.y0
                    if not any(e['rect'][0] - 4 <= x <= e['rect'][2] + 4 and e['rect'][1] - 4 <= y <= e['rect'][3] + 4 for e in es): outside += 1; cells.add((int(x // G), int(y // G)))
            while cells:
                st = [cells.pop()]; grp = []
                while st:
                    cx, cy = st.pop(); grp.append((cx, cy))
                    for dx in (-1, 0, 1):
                        for dy in (-1, 0, 1):
                            if (cx + dx, cy + dy) in cells: cells.discard((cx + dx, cy + dy)); st.append((cx + dx, cy + dy))
                side.append(dict(page=pno, rect=[min(c[0] for c in grp) * G, min(c[1] for c in grp) * G, (max(c[0] for c in grp) + 1) * G, (max(c[1] for c in grp) + 1) * G]))
    json.dump(dict(pages=base.page_count, seed=a.seed, outside_diff=outside, side=side, edits=truth), open(os.path.join(a.out, 'truth.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    n = len(truth); vis = sum(1 for e in truth if e.get('visible'))
    print(f'pages {base.page_count} edits {n} (見える変化 {vis}・直っていない {sum(1 for e in truth if e["role"] == "skip")}) 誤りの外で変わった画素 {outside}（{len(side)}か所）')

main()
