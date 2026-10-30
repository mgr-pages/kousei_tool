# 数字の違いと仕上がりの外のページ情報の模擬データの結果を採点する
#   python3 test/numtrim/evaluate.py test/numtrim/gt.json ケース名 結果.json
#   仕上がりの内側: 変えた数字が、それぞれ1件の項目に、数字全体の「旧→新」で出ているか(「4→5」「730→060」のように分かれていないか)
#   仕上がりの外: ページ情報の項目に、仕上がりの外の印(outTrim。詳細設定で隠せる)が付いているか。内側の項目に付いていないか
#   表示の数字のまとまりは、画面と同じ規則(src/js/content.js の PC.numberSegs)で求める
import json, re, sys
gt = json.load(open(sys.argv[1], encoding='utf-8'))
case = gt['cases'][sys.argv[2]]
res = json.load(open(sys.argv[3], encoding='utf-8'))
NUMC, DIGC = re.compile(r'[0-9０-９,，.．:：/／\-－]'), re.compile(r'[0-9０-９]')

def number_segs(segs):
    if not any(t != '=' for t, _ in segs): return segs
    cols, O, N = [], [], []
    for t, s in segs:
        for c in s:
            cols.append((t, c, len(O) if t != '+' else -1, len(N) if t != '-' else -1))
            if t != '+': O.append(c)
            if t != '-': N.append(c)
    def tokens(C):
        tid, n, i = [-1] * len(C), 0, 0
        while i < len(C):
            if not DIGC.match(C[i]): i += 1; continue
            e = i + 1
            while e < len(C) and (DIGC.match(C[e]) or (NUMC.match(C[e]) and e + 1 < len(C) and DIGC.match(C[e + 1]))): e += 1
            for k in range(i, e): tid[k] = n
            n += 1; i = e
        return tid
    tO, tN = tokens(O), tokens(N)
    hot = [c[0] != '=' for c in cols]
    grew = True
    while grew:
        grew = False
        hO = {tO[c[2]] for k, c in enumerate(cols) if hot[k] and c[2] >= 0 and tO[c[2]] >= 0}
        hN = {tN[c[3]] for k, c in enumerate(cols) if hot[k] and c[3] >= 0 and tN[c[3]] >= 0}
        for k, c in enumerate(cols):
            if not hot[k] and ((c[2] >= 0 and tO[c[2]] in hO) or (c[3] >= 0 and tN[c[3]] in hN)): hot[k] = grew = True
    out, k = [], 0
    while k < len(cols):
        if not hot[k]: out.append(('=', cols[k][1])); k += 1; continue
        e = k
        while e < len(cols) and hot[e]: e += 1
        out += [('-', ''.join(c[1] for c in cols[k:e] if c[2] >= 0)), ('+', ''.join(c[1] for c in cols[k:e] if c[3] >= 0))]
        k = e
    return out

def hunks(segs):   # 違いのか所ごとの (旧, 新)
    out, cur = [], None
    for t, s in segs:
        if t == '=': cur = None; continue
        if cur is None: cur = ['', '']; out.append(cur)
        cur[0 if t == '-' else 1] += s
    return [tuple(h) for h in out]

T = gt['trim']
def outside(f):
    bs = f.get('pnboxes') or [f.get('nbox') or f['box']]
    return all(b and not (T[0] <= (b[0] + b[2]) / 2 <= T[2] and T[1] <= (b[1] + b[3]) / 2 <= T[3]) for b in bs)

want = [tuple(x) for x in gt['numbers']] if case['numbers'] else []
inside, outer = [f for f in res if not outside(f)], [f for f in res if outside(f)]
lines, seen, ok = [], {w: 0 for w in want}, True
for f in inside:
    hs = hunks(number_segs(f.get('segs') or []))
    hit = [h for h in hs if h in seen]
    for h in hit: seen[h] += 1
    bad = [h for h in hs if h not in seen]
    if f.get('outTrim'): ok = False; lines.append(f"   不合格 内側の項目に仕上がりの外の印 {f['cat']} {f.get('show', '')[:30]}")
    if bad and hit: ok = False; lines.append(f"   不合格 数字が分かれている {f['cat']} {'／'.join(a + '→' + b for a, b in hs)}")
    elif not hit and f['cat'] not in case.get('allow', []): ok = False; lines.append(f"   余分な検出 {f['cat']} {'／'.join(a + '→' + b for a, b in hs) or f.get('show', '')[:30]}")
for w, n in seen.items():
    if n != 1: ok = False; lines.append(f"   {'見逃し' if n == 0 else f'{n}件に分かれている'} {w[0]}→{w[1]}")
for f in outer:
    if not f.get('outTrim'): ok = False; lines.append(f"   不合格 仕上がりの外の項目に印がない {f['cat']} {f.get('show', '')[:30]}")
if case['slug'] and not outer: ok = False; lines.append('   不合格 ページ情報の項目がない')
if not case['slug'] and outer: ok = False; lines.append(f"   余分な検出 仕上がりの外 {len(outer)}件")
print(f"{case['what']}：数字 {len(want)}件中 1件ずつ出たもの{sum(1 for n in seen.values() if n == 1)}件 / 仕上がりの外 {len(outer)}件（印あり{sum(1 for f in outer if f.get('outTrim'))}件） / {'合格' if ok else '不合格'}")
for l in lines: print(l)
