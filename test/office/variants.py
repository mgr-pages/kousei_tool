# データファイルの原稿の、確認が厳しくなりやすい場合の模擬データを作る・採点する(文言はすべて架空)
#   python3 test/office/variants.py make 出力フォルダ   → variant_yen.xlsx・variant_master.xlsx(test/office/make.py で作った 1_price.xlsx をもとにする)
#   python3 test/office/variants.py check 種類(yen|master) 結果.json   → 1行目に「合格 / 不合格」の件数、2行目以降に不合格の内訳
#   yen   : 価格の表示形式を「¥1,280」にした Excel × 成果物「1,280円」。通貨の記号だけの違いを「原稿と違う」とせず、同じ違いを1件にまとめるか
#   master: 成果物に載せない商品を60行足した Excel(商品マスターの一部だけを載せた場合)。載せない行を続きごとに1件にまとめ、
#           本当に抜けた行(B-410)は別に出し、表の後ろの行(発売日・割引率)を見つけるか
import sys, json, os

def make(out):
    from openpyxl import load_workbook
    wb = load_workbook(os.path.join(out, '1_price.xlsx'))
    ws = wb['価格表']
    for row in ws.iter_rows(min_row=3):
        c = row[3]
        if isinstance(c.value, (int, float)) and c.number_format.endswith('"円"'):
            c.number_format = '"¥"#,##0'
    wb.save(os.path.join(out, 'variant_yen.xlsx'))
    wb = load_workbook(os.path.join(out, '1_price.xlsx'))
    ws = wb['価格表']
    ws.insert_rows(15, 60)
    for k in range(60):
        r = 15 + k
        ws.cell(row=r, column=1, value=f'Z-{900 + k}'); ws.cell(row=r, column=2, value=f'見本の商品 {k + 1}号'); ws.cell(row=r, column=3, value=f'{k % 9 + 1}個')
        c = ws.cell(row=r, column=4, value=100 + k * 10); c.number_format = '#,##0"円"'
    wb.save(os.path.join(out, 'variant_master.xlsx'))
    print('ok', out)

def check(kind, path):
    F = json.load(open(path, encoding='utf-8'))
    segs = lambda f, t: ''.join(s for k, s in (f.get('segs') or []) if k == t)
    T = [f for f in F if f['cat'] == 'T']
    tests = []
    tests.append(('価格の違い 1,280円→1,380円 を出す', any('2' in segs(f, '-') and '3' in segs(f, '+') for f in T)))
    tests.append(('成果物にない行 B-410 を1件で出す', sum('クリップ小箱' in segs(f, '-') for f in T) == 1))
    tests.append(('原稿にない行 B-412 を出す', any(f['cat'] == 'N' and 'ふせん特大' in (f.get('show') or '') for f in F)))
    if kind == 'yen':
        unit = lambda f: set(segs(f, '-') + segs(f, '+')) <= set('¥円')
        tests.append(('通貨の記号だけの違いを「原稿と違う」にしない', not any(unit(f) for f in T + [f for f in F if f['cat'] == 'N'])))
        tests.append(('同じ書き方の違いを1件にまとめる(3か所以上)', any(f['cat'] == 'V' and (f.get('more') or 0) >= 3 for f in F)))
    if kind == 'master':
        gone = [f for f in T if f.get('goneN')]
        tests.append(('載せない行(15〜36行目)を1件にまとめる', any(f['goneN'] >= 20 and f['refs'][0] == '15行目' for f in gone)))
        tests.append(('本当に抜けた行(9行目)を、載せない行とまとめない', not any('9行目' in (f.get('refs') or []) for f in gone)))
        tests.append(('表の後ろの行(発売日・割引率)を「原稿にない文字」にしない', not any(f['cat'] == 'N' and ('発売日' in (f.get('show') or '') or '割引率' in (f.get('show') or '')) for f in F)))
        tests.append(('「原稿と違う」は10件以下', len(T) <= 10))
    bad = [n for n, ok in tests if not ok]
    print(f'{kind} {len(tests)}項目中 合格{len(tests) - len(bad)} / 不合格{len(bad)}（全{len(F)}件・うち原稿と違う{len(T)}件）')
    for n in bad:
        print('   不合格:', n)

if sys.argv[1] == 'make':
    make(sys.argv[2])
else:
    check(sys.argv[2], sys.argv[3])
