# 旧版から動かしただけの所の試験(test/move/make.py)の採点
#   python3 test/move/evaluate.py 結果.json   (suite.sh が move.json を書き出したもの)
#   ・ブロックA(下へ 20pt＝7.1mm。中身は同じ): 「移動した所」1件で、中身は同じ
#   ・ブロックB(左へ 100pt＝35.3mm。字の一部を消した。足した字はない): 「移動した所」1件で、中身に違いあり。消えた字は文字の項目に出る
#   ・ブロックF(旧版2ページ目から移した): 「移動した所」1件(2ページ目から)。置き換わったブロックE は「置き換わった所」1件
#   ・動かしただけのブロックA・B のまわりに、ほかの見た目の違いの項目が出ない(動かしただけで何件も出ないこと)
import json, sys
F = json.load(open(sys.argv[1], encoding='utf-8'))
k = 200 / 72
box = lambda x0, y0, x1, y1: [x0 * k, y0 * k, x1 * k, y1 * k]
A, B, FB = box(50, 80, 380, 250), box(420, 70, 640, 160), box(470, 300, 770, 470)   # 成果物での位置(pt → 200dpi の画素)
ov = lambda a, b: min(a[2], b[2]) > max(a[0], b[0]) and min(a[3], b[3]) > max(a[1], b[1])
mv = [f for f in F if f.get('fromOld') == 'move']
looks = [f for f in F if f.get('fromOld') == 'look' and not f.get('inMove') and not f.get('replaced')]
rp = [f for f in F if f.get('replaced')]
txt = [f for f in F if f['cat'] == 'C2']
ok = {
    'A を「移動した所」1件・中身は同じ': len([f for f in mv if ov(f['nbox'], A) and '下へ 7.1mm' in f['show'] and '中身は同じ' in f['show']]) == 1,
    'B を「移動した所」1件・中身に違いあり': len([f for f in mv if ov(f['nbox'], B) and '左へ 35.3mm' in f['show'] and '中身に違い' in f['show']]) == 1,
    'B の消えた字が文字の項目に出る': any('教材' in (f.get('show') or '') for f in txt),
    'F を2ページ目から「移動した所」1件': len([f for f in mv if ov(f['nbox'], FB) and '2ページ目から移ってきた' in f['show'] and '中身は同じ' in f['show']]) == 1,
    '置き換わった E を1件': len([f for f in rp if ov(f['nbox'], FB)]) == 1,
    '移動した所は3件だけ': len(mv) == 3,
    '動かしただけの A・B に、ほかの見た目の違いが出ない': not [f for f in looks if ov(f['nbox'], A) or ov(f['nbox'], B)],
}
for n, v in ok.items(): print(f"  {n}: {'OK' if v else 'NG'}")
print('移動の試験:', 'すべて OK' if all(ok.values()) else f"{sum(not v for v in ok.values())}項目 NG", f"（項目 {len(F)}件・移動 {len(mv)}件・見た目 {len(looks)}件・置き換わり {len(rp)}件・文字 {len(txt)}件）")
