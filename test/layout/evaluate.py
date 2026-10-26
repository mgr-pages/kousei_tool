# 書式の指示の自動判定の採点: test/run.js の出力を正解(gt.json)と比べる
#   python3 test/layout/evaluate.py test/layout/gt.json 出力.json
#   指示(注釈のコメント)ごとに、その指示の付いた項目の自動判定が正解と同じか。指示どおりでない(ng)ものは「直っていない」(B)でもよい
import json, sys
gt = json.load(open(sys.argv[1], encoding='utf-8'))
F = json.load(open(sys.argv[2], encoding='utf-8'))
lines, ok = [], 0
for e in gt['expect']:
    hs = [f for f in F if (f.get('note') or '').strip() == e['note'] and e['has'] in (f.get('show') or '') + ''.join(t for _, t in (f.get('segs') or []))]
    autos = {f.get('auto') or ('ng' if f['cat'] == 'B' else 'none') for f in hs}
    good = bool(hs) and (autos == {e['auto']} if e['auto'] == 'ok' else 'ng' in autos and 'ok' not in autos)
    ok += good
    if not good: lines.append(f"   {e['id']} 不合格 {e['what']}（結果: {', '.join(sorted(autos)) or '項目なし'}）")
print(f"書式の指示 {len(gt['expect'])}件中 合格{ok}件 / 不合格{len(gt['expect']) - ok}件")
for l in lines: print(l)
