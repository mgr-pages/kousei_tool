# グラフを含むデータファイルの原稿の模擬データの結果を採点する: python3 test/charts/evaluate.py test/charts/gt.json 結果.json
import json, sys
gt = json.load(open(sys.argv[1], encoding='utf-8'))
res = json.load(open(sys.argv[2], encoding='utf-8'))
def sides(f):
    segs = f.get('segs') or []
    return ''.join(s[1] for s in segs if s[0] != '+'), ''.join(s[1] for s in segs if s[0] != '-')
used, ok, lines = set(), 0, []
for e in gt['expect']:
    hit = [k for k, f in enumerate(res) if k not in used and e['old'] in sides(f)[0] and e['new'] in sides(f)[1]]
    if hit: used.add(hit[0]); ok += 1
    else: lines.append(f"   見逃し {e['what']}")
extra = [f for k, f in enumerate(res) if k not in used]
for f in extra: lines.append(f"   余分な検出 {f['cat']} {''.join(('[' + s[0] + ':' + s[1] + ']') if s[0] != '=' else s[1] for s in (f.get('segs') or []))[:60]}")
print(f"グラフの照合 {len(gt['expect'])}件中 合格{ok}件 / 見逃し{len(gt['expect']) - ok}件 / 余分な検出{len(extra)}件")
for l in lines: print(l)
