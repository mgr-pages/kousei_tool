# 成果物だけで見るチェックの採点: test/run.js の出力を正解(gt.json)と比べる
#   python3 test/jcheck/evaluate.py test/jcheck/gt.json 出力.json
#   1行目に「合格 / 見逃し / 余分な検出」の件数、2行目以降に不合格の内訳。区分 J 以外の項目は数えない
#   cand があれば、候補を入れた文(成果物の前後の字＋候補)も比べる(候補がそのまま置き換えられる形か)
import json, sys
gt = json.load(open(sys.argv[1], encoding='utf-8'))
F = [f for f in json.load(open(sys.argv[2], encoding='utf-8')) if f['cat'] == 'J']
used, lines, ok = set(), [], 0
for e in gt['expect']:
    hit = next((f for f in F if f['id'] not in used and f['j']['kind'] == e['kind'] and e['has'] in f['show'] and f['level'] == e['level'] and ('want' not in e or e['want'] in f['j']['want']) and ('msg' not in e or e['msg'] in f['j']['msg']) and ('cand' not in e or e['cand'] in f['j']['ctx'][0] + f['j']['want'] + f['j']['ctx'][1])), None)
    if hit: used.add(hit['id']); ok += 1
    else: lines.append(f"   {e['id']} 見逃し {e['what']}")
extra = [f for f in F if f['id'] not in used]
for f in extra:
    lines.append(f"   余分な検出 {f['j']['kind']} 「{f['show']}」 {f['j']['msg']}")
print(f"成果物だけのチェック {len(gt['expect'])}件中 合格{ok}件 / 見逃し{len(gt['expect']) - ok}件 / 余分な検出{len(extra)}件")
for l in lines: print(l)
