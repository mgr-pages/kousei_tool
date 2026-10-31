# 直しを無作為に入れた模擬データ(test/inject/make.py)の結果を採点する: 直しの種類ごとに、見つけた数と余分な検出を数える
#   python3 test/inject/evaluate.py 結果のフォルダ 照合の仕方(old・marks・text) [--detail]
#   結果のフォルダには、v{種}/ ごとに truth.json と、test/run.js の出力 {照合の仕方}.json・{照合の仕方}.pages.json を置く
#   見つけた: 成果物だけのチェック(J)以外の項目の枠(成果物の側)が、直した字の枠(字の大きさの半分だけ広げたもの)に重なる
#   中身も合う: その項目の違い(旧・新の字)に、直す前の字か直したあとの字が入っている(1行消したものは、消えた字にその行の半分以上)
#   余分な検出: どの直しの枠(字の大きさだけ広げたもの)にも重ならない項目
import json, sys, glob, os
from collections import defaultdict
root, mode, detail = sys.argv[1], sys.argv[2], '--detail' in sys.argv
K = 200 / 72
ov = lambda a, b, m: min(a[2], b[2]) + m > max(a[0], b[0]) and min(a[3], b[3]) + m > max(a[1], b[1])
stat, kinds, fps, miss, total = defaultdict(lambda: [0, 0, 0]), defaultdict(lambda: [0, 0]), [], [], 0
for vd in sorted(glob.glob(os.path.join(root, 'v*'))):
    rp = os.path.join(vd, mode + '.json')
    if not os.path.exists(rp): continue
    edits = json.load(open(os.path.join(vd, 'truth.json'), encoding='utf-8'))['edits']
    res = json.load(open(rp, encoding='utf-8')); pages = json.load(open(os.path.join(vd, mode + '.pages.json'), encoding='utf-8'))
    F = [f for f in res if f['cat'] != 'J']
    boxes = lambda f: [b for b in (f.get('pnboxes') or [f.get('nbox')]) if b]
    qof = lambda f: pages[f['page'] - 1]['q']
    hit = set()
    for e in edits:
        total += 1
        m = 0.5 * e['size'] * K
        fs = [k for k, f in enumerate(F) if qof(f) == e['page'] and any(ov(b, e['box'], m) for b in boxes(f))]
        old = ''.join(s[1] for k in fs for s in (F[k].get('segs') or []) if s[0] == '-'); new = ''.join(s[1] for k in fs for s in (F[k].get('segs') or []) if s[0] == '+')
        if e['type'] in ('linedel', 'sentdel'):
            exact = sum(1 for c in e['before'] if c in old) >= 0.5 * len(e['before'])
            if not fs:   # 消えた行は、位置の分からない「成果物にない」として出ることがある: 消えた字で探す
                fs = [k for k, f in enumerate(F) if qof(f) == e['page'] and sum(1 for c in e['before'] if c in ''.join(s[1] for s in (f.get('segs') or []) if s[0] == '-')) >= 0.5 * len(e['before'])]
                exact = bool(fs)
        elif e['type'] == 'swap':   # 入れ替えは、片方の字が移ったように示されることが多い(「[-記]載[+記]」)
            exact = bool(fs) and any(c in old + new for c in e['before'])
        else:
            lint = ''.join(F[k]['lint']['c'] for k in fs if F[k].get('lint'))   # 見た目が同じで文字データが違う字(「一」→「ー」では？)
            exact = bool(fs) and ((e['before'] and all(c in old for c in e['before'])) or (e['after'] and all(c in new + lint for c in e['after'])))
        st = stat[e['type']]; st[0] += 1; st[1] += bool(fs); st[2] += bool(exact)
        kd = kinds[e['kind']]; kd[0] += 1; kd[1] += bool(fs)
        hit.update(fs)
        if not fs: miss.append((os.path.basename(vd), e))
    for k, f in enumerate(F):
        if k in hit: continue
        if any(qof(f) == e['page'] and any(ov(b, e['box'], e['size'] * K) for b in boxes(f)) for e in edits): continue
        fps.append((os.path.basename(vd), f))
found = sum(v[1] for v in stat.values()); exact = sum(v[2] for v in stat.values())
print(f'{mode}: 直し {total}件中 見つけた {found}件（{100 * found / max(1, total):.1f}%）・中身も合う {exact}件 / 余分な検出 {len(fps)}件')
NAMES = dict(kanji='漢字を別の漢字に', dakuten='濁点・半濁点', choon='長音→漢数字の一', delete='1字消す', insert='1字足す', digit='数字1桁', numlen='数字の桁を増やす',
             symbol='記号', width='全角・半角', swap='2字の入れ替え', small='小さい字(6.5pt)', table='表の価格', linedel='1行消す', sentdel='1文消す', word='漢字2字')
for t, (n, f, x) in stat.items(): print(f'   {NAMES.get(t, t):<12} {f}/{n}' + (f'（中身も合う {x}）' if x != f else ''))
print('   字の所: ' + '　'.join(f'{k} {v[1]}/{v[0]}' for k, v in kinds.items()))
if detail:
    for v, e in miss: print(f'   見逃し {v} p{e["page"] + 1} {e["type"]} {e["kind"]} {e["before"][:10]}→{e["after"][:10]} {e["box"]}')
    for v, f in fps: print(f'   余分 {v} {f["cat"]} {"".join(s[1] if s[0] == "=" else f"[{s[0]}{s[1]}]" for s in (f.get("segs") or []))[:60] or f.get("show", "")[:40]} {f.get("nbox")}')
