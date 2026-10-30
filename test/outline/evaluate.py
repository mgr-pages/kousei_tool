# 一部の文字だけをアウトライン化した成果物の模擬データの結果を採点する
#   python3 test/outline/evaluate.py test/outline/gt.json ケース名 結果.json [--need-new]
#   --need-new: 違う字の成果物の側(アウトラインの字)も読めていること(文字データのない所を読む処理)を求める
import json, sys
gt = json.load(open(sys.argv[1], encoding='utf-8'))['cases'][sys.argv[2]]
res = json.load(open(sys.argv[3], encoding='utf-8'))
need_new = '--need-new' in sys.argv
ov = lambda a, b: min(a[2], b[2]) > max(a[0], b[0]) and min(a[3], b[3]) > max(a[1], b[1])
used, ok, lines = set(), 0, []
for e in gt['expect']:
    hit = [k for k, f in enumerate(res) if k not in used and ov(f.get('nbox') or f['box'], e['box'])]
    if not hit:
        lines.append(f"   見逃し {e['what']}"); continue
    k = hit[0]; used.add(k); f = res[k]
    segs = f.get('segs') or []
    old = ''.join(s[1] for s in segs if s[0] == '-'); new = ''.join(s[1] for s in segs if s[0] == '+')
    good = e['old'] in old and (not need_new or e['new'] in new)
    ok += good
    if not good: lines.append(f"   不合格 {e['what']}（出た違い：{old or '（なし）'}→{new or '（なし）'}）")
extra = [f for k, f in enumerate(res) if k not in used]
for f in extra: lines.append(f"   余分な検出 {f['cat']} {f.get('show', '')[:40]} {f['box']}")
print(f"{gt['what']}：{len(gt['expect'])}件中 合格{ok}件 / 見逃し{sum(1 for l in lines if '見逃し' in l)}件 / 余分な検出{len(extra)}件")
for l in lines: print(l)
