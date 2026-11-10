# 紙の赤字原稿＋旧版＋成果物の模擬データ(test/scan3/make.py)の採点
#   python3 test/scan3/evaluate.py truth.json 出力.json
#   赤字(指示どおり → 赤字どおり変わった(A)、直していない → 直っていない(B))と、指示にない変化(文字 → C2、見た目 → C3)が、
#   それぞれ枠の重なる項目として出ているか。余分な検出: 直っていない(B)・指示にない変更(C2・C3)のうち、正解のどれにも当たらないもの
import json, sys
truth = json.load(open(sys.argv[1], encoding='utf-8'))
F = json.load(open(sys.argv[2], encoding='utf-8'))
K, H = 200 / 72, 842
pt = lambda b: [b[0] / K, b[1] / K, b[2] / K, b[3] / K]   # 項目の枠(PC.DPI の画素・上が原点) → pt(上が原点)
def up(b):   # 正解の枠(pt・下が原点) → 上が原点
    return [b[0], H - b[3], b[2], H - b[1]]
ov = lambda a, b, m=6: min(a[2], b[2]) + m > max(a[0], b[0]) and min(a[3], b[3]) + m > max(a[1], b[1])
used, lines, ok = set(), [], 0
for x in truth['marks'] + truth['changes']:
    want = x['kind']
    hit = [i for i, f in enumerate(F) if f['cat'] == want and (ov(pt(f['box']), up(x['box'])) or (f.get('nbox') and ov(pt(f['nbox']), up(x['box']))))]
    if want == 'C2': hit = [i for i in hit if x['after'] in (F[i].get('show') or '')]
    if hit: ok += 1; used.update(hit)
    else: lines.append(f"   見逃し {x['what']}（{want}）")
total = len(truth['marks']) + len(truth['changes'])
extra = [f for i, f in enumerate(F) if i not in used and f['cat'] in ('B', 'C2', 'C3')]
for f in extra: lines.append(f"   余分な検出 {f['cat']} 「{(f.get('show') or '')[:30]}」")
print(f"紙の赤字原稿＋旧版 {total}件中 合格{ok}件 / 見逃し{total - ok}件 / 余分な検出{len(extra)}件")
for l in lines: print(l)
