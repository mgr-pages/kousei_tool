# 「位置を先に合わせる」比べ方の試作(同じレイアウトの、文字データのあるPDFどうし)
#   今の照合は、PDFの中の字の並びの順番で対応づけてから、位置で直している。直した字がPDFの最後に書かれるなど、並びの順番が
#   原稿と成果物で違うと、対応づけがずれることがある。この試作は、順番を使わずに次の順で比べる:
#     1) 同じ位置にある同じ字を、まず「同じ」とする(並びの順番に左右されない)
#     2) 残った字(どちらか片方にしかない字・位置が動いた字)を、近いものどうしでまとまりにする
#     3) まとまりの中で、旧の字の並びと新の字の並びを比べ、変わった字・消えた字・入った字・位置だけ動いた字(送り)に分ける
#   python3 -I test/realcheck/posfirst.py 旧.pdf 新.pdf                    … 件数を出す
#   python3 -I test/realcheck/posfirst.py --truth 結果のフォルダ...        … test/realcheck/mutate.py の誤りで採点する(base.pdf と new.pdf を比べる)
#   python3 -I test/realcheck/posfirst.py --truth --browser 結果のフォルダ... … 本体と同じ文字の読み取りで比べた結果(posfirst_browser.js が書いた posfirst.json)を採点する
#   要るもの: PyMuPDF
import sys, json, os, difflib
import pymupdf

def chars(page):
    out = []
    for b in page.get_text('rawdict')['blocks']:
        for l in b.get('lines', []):
            for s in l['spans']:
                for ch in s['chars']:
                    if ch['c'].strip(): out.append((ch['c'], tuple(ch['bbox']), s['size']))
    return out

def compare(pa, pb):
    A, B = chars(pa), chars(pb)
    G = 3.0
    idx = {}
    for j, (c, bx, sz) in enumerate(B):
        idx.setdefault((c, int((bx[0] + bx[2]) / 2 // G), int((bx[1] + bx[3]) / 2 // G)), []).append(j)
    usedB = set(); restA = []
    for i, (c, bx, sz) in enumerate(A):   # 1) 同じ位置の同じ字
        cx, cy = (bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2; tol = max(0.6, 0.12 * sz); hit = None
        for gx in (-1, 0, 1):
            for gy in (-1, 0, 1):
                for j in idx.get((c, int(cx // G) + gx, int(cy // G) + gy), []):
                    if j in usedB: continue
                    b2 = B[j][1]
                    if abs((b2[0] + b2[2]) / 2 - cx) <= tol and abs((b2[1] + b2[3]) / 2 - cy) <= tol: hit = j; break
                if hit is not None: break
            if hit is not None: break
        if hit is None: restA.append(i)
        else: usedB.add(hit)
    restB = [j for j in range(len(B)) if j not in usedB]
    # 2) 残った字を、近いものどうし(同じ行・列で続く字、重なる字)でまとまりにする
    items = [('o', i, A[i]) for i in restA] + [('n', j, B[j]) for j in restB]
    par = list(range(len(items)))
    def find(x):
        while par[x] != x: par[x] = par[par[x]]; x = par[x]
        return x
    cell = {}
    for k, (_, _, (c, bx, sz)) in enumerate(items):
        cell.setdefault((int(bx[0] // 40), int(bx[1] // 40)), []).append(k)
    def near(p, q):
        (_, b1, s1), (_, b2, s2) = p, q; s = max(s1, s2)
        ox = min(b1[2], b2[2]) - max(b1[0], b2[0]); oy = min(b1[3], b2[3]) - max(b1[1], b2[1])
        h = min(b1[3] - b1[1], b2[3] - b2[1]); w = min(b1[2] - b1[0], b2[2] - b2[0])
        return (oy >= 0.5 * h and ox >= -1.2 * s) or (ox >= 0.5 * w and oy >= -0.6 * s)
    for k, (_, _, ck) in enumerate(items):
        bx = ck[1]
        for gx in range(int((bx[0] - 60) // 40), int((bx[2] + 60) // 40) + 1):
            for gy in range(int((bx[1] - 30) // 40), int((bx[3] + 30) // 40) + 1):
                for m in cell.get((gx, gy), []):
                    if m > k and near(ck, items[m][2]): par[find(m)] = find(k)
    groups = {}
    for k in range(len(items)): groups.setdefault(find(k), []).append(k)
    out = []
    for ks in groups.values():   # 3) まとまりの中で、旧と新の字の並びを比べる
        order = lambda t: (round(t[2][1][1] / max(2.0, 0.6 * t[2][2])), t[2][1][0])
        O = sorted((items[k] for k in ks if items[k][0] == 'o'), key=order); N = sorted((items[k] for k in ks if items[k][0] == 'n'), key=order)
        so, sn = ''.join(t[2][0] for t in O), ''.join(t[2][0] for t in N)
        ch_o, ch_n, moved = [], [], 0
        for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, so, sn, autojunk=False).get_opcodes():
            if tag == 'equal': moved += i2 - i1
            else: ch_o += [t[2][1] for t in O[i1:i2]]; ch_n += [t[2][1] for t in N[j1:j2]]
        out.append(dict(old=so, new=sn, obox=ch_o, nbox=ch_n, moved=moved, changed=bool(ch_o or ch_n)))
    return dict(nA=len(A), nB=len(B), same=len(A) - len(restA), regions=out)

ov = lambda a, b, m: min(a[2], b[2]) + m > max(a[0], b[0]) and min(a[3], b[3]) + m > max(a[1], b[1])

if sys.argv[1] == '--truth':
    tot = dict(changes=0, found=0, skip=0, skip_quiet=0, extra=0, side=0, moved_regions=0, moved_chars=0, files=0)
    for d in [x for x in sys.argv[2:] if not x.startswith('--')]:
        T = json.load(open(os.path.join(d, 'truth.json'), encoding='utf-8')); a = pymupdf.open(os.path.join(d, 'base.pdf')); b = pymupdf.open(os.path.join(d, 'new.pdf')); tot['files'] += 1
        J = json.load(open(os.path.join(d, 'posfirst.json'), encoding='utf-8')) if '--browser' in sys.argv else None
        for pno in range(a.page_count):
            if J:
                R = J[pno]
                for r in R['regions']: r['changed'] = bool(r['obox'] or r['nbox'])
            else: R = compare(a[pno], b[pno])
            regs = [r for r in R['regions'] if r['changed']]; hit = set()
            tot['moved_regions'] += sum(1 for r in R['regions'] if not r['changed']); tot['moved_chars'] += sum(r['moved'] for r in R['regions'])
            E = [e for e in T['edits'] if e['page'] == pno]
            for e in E:
                m = 0.5 * e['size']; fs = [k for k, r in enumerate(regs) if any(ov(x, e['rect'], m) for x in r['obox'] + r['nbox'])]
                hit.update(fs)
                if e['role'] == 'skip': tot['skip'] += 1; tot['skip_quiet'] += not fs; continue
                if not e.get('visible'): continue
                tot['changes'] += 1; tot['found'] += bool(fs)
                if not fs and '--detail' in sys.argv: print('   見逃し', os.path.basename(d), pno + 1, e['kind'], [round(v) for v in e['rect']])
            for k, r in enumerate(regs):
                if k in hit or any(any(ov(x, e['rect'], e['size']) for x in r['obox'] + r['nbox']) for e in E): continue
                if any(s['page'] == pno and any(ov(x, s['rect'], 2) for x in r['obox'] + r['nbox']) for s in T.get('side', [])): tot['side'] += 1; continue
                tot['extra'] += 1
                if '--detail' in sys.argv: print('   余分', os.path.basename(d), pno + 1, len(r['obox']), len(r['nbox']), [round(v) for v in (r['obox'] + r['nbox'])[0]])
    print(f"位置を先に合わせる試作{'・本体と同じ文字の読み取り' if '--browser' in sys.argv else '・PyMuPDF の字の位置'}（{tot['files']}組）: 見える変化 {tot['found']}/{tot['changes']}（{100 * tot['found'] / max(1, tot['changes']):.1f}%）を見つけた / 余分な検出 {tot['extra']}件 / 副作用で字が動いた所の項目 {tot['side']}件 / 直していない所で何も出なかった {tot['skip_quiet']}/{tot['skip']} / 位置だけ動いた字 {tot['moved_chars']}字（{tot['moved_regions']}か所は位置だけ）")
else:
    a, b = pymupdf.open(sys.argv[1]), pymupdf.open(sys.argv[2])
    for pno in range(min(a.page_count, b.page_count)):
        R = compare(a[pno], b[pno]); regs = [r for r in R['regions'] if r['changed']]
        print(f"p{pno + 1}: 旧 {R['nA']}字・新 {R['nB']}字 / 同じ位置の同じ字 {R['same']}字（{100 * R['same'] / max(1, R['nA']):.1f}%） / 変わった所 {len(regs)}か所（消えた・変わった旧の字 {sum(len(r['obox']) for r in regs)}・入った・変わった新の字 {sum(len(r['nbox']) for r in regs)}） / 位置だけ動いた字 {sum(r['moved'] for r in R['regions'])}字")
