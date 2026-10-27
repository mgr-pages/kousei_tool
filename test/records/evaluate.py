# 表(商品マスタ)の商品ごとの照合と、ページの端の文字の採点: test/run.js の出力を正解(gt.json)と比べる
#   python3 test/records/evaluate.py test/records/gt.json 出力.json
#   1行目に「合格 / 見逃し / 余分な検出」の件数、2行目以降に不合格の内訳。一致した商品(自動で確認済み)の件数も確かめる
import json, sys
gt = json.load(open(sys.argv[1], encoding='utf-8'))
F = json.load(open(sys.argv[2], encoding='utf-8'))
ok_n = sum(f['rec']['n'] for f in F if f.get('rec') and f['rec']['kind'] == 'ok')
F = [f for f in F if not (f.get('rec') and f['rec']['kind'] == 'ok')]

def match(e, f):
    if 'rec' in e:
        r = f.get('rec')
        return bool(r) and r['kind'] == e['rec'] and all(str(r.get(k)) == str(e[k]) for k in ('want', 'got', 'key', 'field', 'n') if k in e) and ('refs' not in e or (f.get('refs') or [f.get('ref')]) == e['refs'])
    j = f.get('j') or {}
    return f['cat'] == 'J' and j.get('kind') == 'edge' and j.get('sub') == e['edge'] and e['has'] in (f.get('show') or '')

used, lines, ok = set(), [], 0
for e in gt['expect']:
    hit = next((f for f in F if f['id'] not in used and match(e, f)), None)
    if hit: used.add(hit['id']); ok += 1
    else: lines.append(f"   {e['id']} 見逃し {e['what']}")
extra = [f for f in F if f['id'] not in used]
for f in extra:
    lines.append(f"   余分な検出 {f['cat']} 「{f.get('show') or ''}」 {json.dumps(f.get('rec') or (f.get('j') or {}).get('msg'), ensure_ascii=False)}")
if ok_n != gt['ok']:
    lines.append(f"   一致した商品の数が違う（{ok_n}件。正解は{gt['ok']}件）")
print(f"表の商品ごとの照合・端の文字 {len(gt['expect'])}件中 合格{ok}件 / 見逃し{len(gt['expect']) - ok}件 / 余分な検出{len(extra)}件 / 一致した商品{ok_n}件（正解{gt['ok']}件）")
for l in lines: print(l)
