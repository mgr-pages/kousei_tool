# 文字データのないページだけの旧版と成果物(test/imgonly/make.py)の採点
#   python3 test/imgonly/evaluate.py 出力フォルダ   (suite.sh が imgonly_*.json を書き出したフォルダ)
#   見た目が変わった所(四角の色)と、注釈の違い(成果物にだけある → W、旧版にだけある → K)が出て、ほかの項目が出ないか
import json, sys, os
out = sys.argv[1]
SQ = [680, 560, 1080, 960]   # 色を変えた四角(成果物の枠。200dpi の画素)
ov = lambda a, b: min(a[2], b[2]) > max(a[0], b[0]) and min(a[3], b[3]) > max(a[1], b[1])
#   組み合わせ → (見た目が変わった所の数, 注釈の項目の種類, 注釈の項目の数)
want = {'old_new': (1, 'W', 2), 'new_old': (1, 'K', 2), 'old_annot': (0, 'W', 2), 'annot_annot': (0, None, 0)}
ng = 0
for name, (nl, cat, na) in want.items():
    F = json.load(open(os.path.join(out, f'imgonly_{name}.json'), encoding='utf-8'))
    look = [f for f in F if f.get('fromOld') == 'look']
    ann = [f for f in F if f.get('fromOld') == 'annot']
    other = [f for f in F if f not in look and f not in ann]
    ok = len(look) == nl and all(ov(f['nbox'], SQ) for f in look) and len(ann) == na and all(f['cat'] == cat for f in ann) and not other \
        and (na == 0 or sorted(f['show'] for f in ann) == ['', 'テスト用の確認メモ'])
    ng += not ok
    print(f"{name}: 見た目 {len(look)}/{nl}件・注釈 {len(ann)}/{na}件（{'・'.join(sorted(set(f['cat'] for f in ann))) or 'なし'}）・ほか {len(other)}件 → {'OK' if ok else 'NG'}")
print('文字データのないページ・注釈の試験:', 'すべて OK' if not ng else f'{ng}組 NG')
