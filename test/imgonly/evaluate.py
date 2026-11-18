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
#   原稿に入れたとき(画像だけのPDFの原稿を、紙のスキャンとして扱わず、成果物と描画が同じと測って比べるか)
#   組み合わせ → (結果のページの種類, 指示の項目の数(以上), 見た目が変わった所の数)。「指示にない変更」の文字の項目(C2)は出ないこと
mk = {'mk_annot_old': ('annot', 2, 0), 'mk_annot_new': ('annot', 2, 1), 'mk_redflat_old': ('scan', 1, 0)}
for name, (kind, na, nl) in mk.items():
    if not os.path.exists(os.path.join(out, f'imgonly_{name}.json')): ng += 1; print(f'{name}: 出力なし → NG'); continue
    F = json.load(open(os.path.join(out, f'imgonly_{name}.json'), encoding='utf-8'))
    P = json.load(open(os.path.join(out, f'imgonly_{name}.pages.json'), encoding='utf-8'))
    ins = [f for f in F if f['cat'] in ('A', 'B', 'B2', 'K', 'F', 'F2', 'M')]
    look = [f for f in F if f['cat'] == 'C3']
    bad = [f for f in F if f['cat'] in ('C1', 'C2', 'T', 'N', 'E')]
    ok = P and P[0]['kind'] == kind and len(ins) >= na and len(look) == nl and all(ov(f['nbox'] or f['box'], SQ) for f in look) and not bad \
        and (name != 'mk_annot_old' or (len(ins) == 2 and any(f.get('note') == 'テスト用の確認メモ' for f in ins)))
    ng += not ok
    print(f"{name}: ページ {P[0]['kind'] if P else 'なし'}（{kind}）・指示 {len(ins)}件（{na}以上）・見た目 {len(look)}/{nl}件・文字の違い {len(bad)}件 → {'OK' if ok else 'NG'}")
print('文字データのないページ・注釈の試験:', 'すべて OK' if not ng else f'{ng}組 NG')
