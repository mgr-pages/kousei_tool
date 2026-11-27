# 旧版から見た目が変わった所(写真・図・色・線など。analyze.js の oldLooks)の採点
#   python3 test/look/evaluate.py test/look/gt.json 結果.json
#   正解表の各所(ページ・成果物の枠。200dpi の画素)に「見た目が変わった所」か「移動した所」(動かしただけの所。analyze.js の explainMoves)の
#   項目が重なれば見つけた。どの正解にも重ならない項目は余分な検出
import json, sys
gt, res = json.load(open(sys.argv[1], encoding='utf-8')), json.load(open(sys.argv[2], encoding='utf-8'))
L = [f for f in res if f.get('fromOld') in ('look', 'move')]
ov = lambda a, b: min(a[2], b[2]) > max(a[0], b[0]) and min(a[3], b[3]) > max(a[1], b[1])
hit = [g for g in gt['changes'] if any(f['page'] == g['page'] and ov(f['nbox'], g['box']) for f in L)]
extra = [f for f in L if not any(f['page'] == g['page'] and ov(f['nbox'], g['box']) for g in gt['changes'])]
mv = sum(f.get('fromOld') == 'move' for f in L)
print(f"見た目が変わった所 {len(hit)}/{len(gt['changes'])} を見つけた / 余分な検出 {len(extra)}件（項目 {len(L)}件{f'。うち移動した所 {mv}件' if mv else ''}）")
for g in gt['changes']:
    if g not in hit: print(f"   見逃し p{g['page']} {g['what']} {g['box']}")
for f in extra: print(f"   余分 p{f['page']} {f['nbox']}")
