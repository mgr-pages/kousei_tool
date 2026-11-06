# 価格・計算・番号の誤りを無作為に入れた模擬データ(test/jinject/make.py)の結果を採点する
#   python3 test/jinject/evaluate.py 結果のフォルダ [--detail]
#   結果のフォルダには、v{種}/ ごとに truth.json と、test/run.js の出力 seika.json・seika.pages.json を置く(成果物だけで照合したもの)
#   見つけた: 入れた誤りのページの、その種類の項目(price は説明に品番があるもの、tax・noteref は誤りの行に重なるもの、
#     notedef はそのページの注記番号の項目、listno はそのページの丸数字の項目)
#   余分な検出: 価格・計算・番号の項目(price・tax・noteref・listno)のうち、どの誤りにも当たらないもの
import json, sys, glob, os
from collections import defaultdict
root, detail = sys.argv[1], '--detail' in sys.argv
KINDS = {'price', 'tax', 'noteref', 'listno'}
ov = lambda a, b, m: min(a[2], b[2]) + m > max(a[0], b[0]) and min(a[3], b[3]) + m > max(a[1], b[1])
stat, fps, miss, total = defaultdict(lambda: [0, 0]), [], [], 0
for vd in sorted(glob.glob(os.path.join(root, 'v*')), key=lambda d: int(os.path.basename(d)[1:])):
    rp = os.path.join(vd, 'seika.json')
    if not os.path.exists(rp): continue
    edits = json.load(open(os.path.join(vd, 'truth.json'), encoding='utf-8'))['edits']
    pages = json.load(open(os.path.join(vd, 'seika.pages.json'), encoding='utf-8'))
    F = [f for f in json.load(open(rp, encoding='utf-8')) if f['cat'] == 'J' and f['j']['kind'] in KINDS]
    qof = lambda f: pages[f['page'] - 1]['q']
    boxes = lambda f: [b for b in [f.get('nbox')] + (f.get('moreNboxes') or []) if b]
    hit = set()
    for e in edits:
        total += 1
        def ok(f):
            if qof(f) != e['page'] and e['type'] != 'price': return False
            k = f['j']['kind']
            if e['type'] == 'price': return k == 'price' and e['code'] in f['j']['msg']
            if e['type'] == 'tax': return k == 'tax' and any(ov(b, e['box'], 10) for b in boxes(f))
            if e['type'] == 'noteref': return k == 'noteref' and any(ov(b, e['box'], 10) for b in boxes(f))
            if e['type'] == 'notedef': return k == 'noteref'
            if e['type'] == 'listno': return k == 'listno'
        fs = [k for k, f in enumerate(F) if ok(f)]
        st = stat[e['type']]; st[0] += 1; st[1] += bool(fs)
        hit.update(fs)
        if not fs: miss.append((os.path.basename(vd), e))
    for k, f in enumerate(F):
        if k not in hit: fps.append((os.path.basename(vd), f))
found = sum(v[1] for v in stat.values())
print(f'価格・計算・番号: 誤り {total}件中 見つけた {found}件（{100 * found / max(1, total):.1f}%） / 余分な検出 {len(fps)}件')
NAMES = dict(price='同じ品番の価格', tax='税込と税抜の計算', noteref='本文の注記番号', notedef='注記の番号', listno='丸数字の番号')
for t, (n, f) in stat.items(): print(f'   {NAMES.get(t, t):<10} {f}/{n}')
if detail:
    for v, e in miss: print(f'   見逃し {v} p{e["page"] + 1} {e["type"]} {e["before"]}→{e["after"]} 「{e["text"][:30]}」')
    for v, f in fps: print(f'   余分 {v} {f["j"]["kind"]} 「{f["show"]}」 {f["j"]["msg"][:60]}')
