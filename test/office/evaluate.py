# データファイルの原稿(Excel・Word・PowerPoint・テキスト・CSV)の照合の採点: test/run.js の出力を正解(gt.json)と比べる
#   python3 test/office/evaluate.py test/office/gt.json 出力.json
#   1行目に「合格 / 見逃し / 余分な検出 / 読んではいけない所 / ページの対応」の件数、2行目以降に不合格の内訳
#   読んではいけない所(absent): 非表示の行・シート・スライド、Wordで削除した変更履歴の文字が、結果に出ていないか
import json, sys
gt = json.load(open(sys.argv[1], encoding='utf-8'))
F = json.load(open(sys.argv[2], encoding='utf-8'))
P = json.load(open(sys.argv[2][:-5] + '.pages.json', encoding='utf-8'))

def texts(f):
    segs = f.get('segs') or []
    dele = ''.join(t for k, t in segs if k == '-')
    ins = ''.join(t for k, t in segs if k == '+')
    other = (f.get('show') or '') + (f.get('note') or '') + ''.join(f.get('texts') or [])
    return dele, ins, other, ''.join(t for _, t in segs)

src = lambda f: P[f['page'] - 1].get('label') or ''
used, lines, ok, miss = set(), [], 0, 0
for e in gt['expect']:
    hits = []
    for f in F:
        if f['id'] in used or e['src'] not in src(f) or f['cat'] not in e['cat']:
            continue
        d, i, o, a = texts(f)
        if e['has'] not in d + o + i or ('to' in e and e['to'] not in i) or ('around' in e and e['around'] not in a):
            continue
        hits.append(f)
    if hits:
        used.add(hits[0]['id']); ok += 1
    else:
        miss += 1
        lines.append(f"   {e['id']} {e['src']} 見逃し {e['what']}")
extra = [f for f in F if f['cat'] in gt['strict'] and f['id'] not in used]
for f in extra:
    d, i, o, _ = texts(f)
    lines.append(f"   余分な検出 {src(f)} {f['cat']} 原稿「{d}」→成果物「{i or o}」")
leak = [(w, f) for w in gt['absent'] for f in F if w in ''.join(texts(f)[:3])]
for w, f in leak:
    lines.append(f"   読んではいけない所が出ている「{w}」 {src(f)} {f['cat']}")
bad = 0
for name, qs in gt['pages'].items():
    got = sorted({p['q'] for p in P if name in (p.get('label') or '') and p['q'] >= 0})
    if got != sorted(qs):
        bad += 1
        lines.append(f"   ページの対応 {name}: 正解 {qs} / 結果 {got}")
print(f"データ原稿 {len(gt['expect'])}件中 合格{ok}件 / 見逃し{miss}件 / 余分な検出{len(extra)}件 / 読んではいけない所{len(leak)}件 / ページの対応の誤り{bad}件")
for l in lines:
    print(l)
