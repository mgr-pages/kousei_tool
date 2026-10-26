# 内容で照合する処理(レイアウトが違う原稿×成果物)の採点: test/run.js の出力を正解(gt.json)と比べる
#   python3 test/content/evaluate.py test/content/gt.json 出力.json
#   1行目に「合格 / 見逃し / 余分な検出 / ページの対応」の件数、2行目以降に不合格の内訳
import json, sys
gt = json.load(open(sys.argv[1], encoding='utf-8'))
F = json.load(open(sys.argv[2], encoding='utf-8'))
pages_path = sys.argv[2][:-5] + '.pages.json'
P = json.load(open(pages_path, encoding='utf-8'))

def texts(f):
    segs = f.get('segs') or []
    dele = ''.join(t for k, t in segs if k == '-')
    ins = ''.join(t for k, t in segs if k == '+')
    other = (f.get('show') or '') + (f.get('note') or '') + ''.join(f.get('texts') or [])
    return dele, ins, other

used, lines, ok, miss = set(), [], 0, 0
for e in gt['expect']:
    hits = []
    for f in F:
        if f['id'] in used or f['page'] != e['page'] or f['cat'] not in e['cat']:
            continue
        d, i, o = texts(f)
        if e['has'] not in d + o + i:
            continue
        if 'to' in e and e['to'] not in i:
            continue
        hits.append(f)
    need = e.get('count', 1)
    for f in hits[:need]:
        used.add(f['id'])
    if len(hits) >= need:
        ok += 1
    else:
        miss += 1
        lines.append(f"   {e['id']} p{e['page']} 見逃し（{len(hits)}/{need}件） {e['what']}")
extra = [f for f in F if f['cat'] in gt['strict'] and f['id'] not in used]
for f in extra:
    d, i, o = texts(f)
    lines.append(f"   余分な検出 p{f['page']} {f['cat']} 原稿「{d}」→成果物「{i or o}」")
bad = 0
for k, v in gt['pages'].items():
    p = P[int(k) - 1]
    good = p['q'] == v['q']
    if good and 'side' in v and p.get('region'):
        c = (p['region'][0] + p['region'][2]) / 2 / max(1, p['w'])
        good = (c > 0.5) == (v['side'] == '右')
    if not good:
        bad += 1
        lines.append(f"   ページの対応 p{k}: 正解 {v} / 結果 q={p['q']} region={p.get('region')}")
print(f"内容照合 {len(gt['expect'])}件中 合格{ok}件 / 見逃し{miss}件 / 余分な検出{len(extra)}件 / ページの対応の誤り{bad}件")
for l in lines:
    print(l)
