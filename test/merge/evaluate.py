# 差し込み印刷(名刺)の模擬データ(test/merge/make.py)の結果を採点する
#   python3 test/merge/evaluate.py 結果のフォルダ [--detail]   … v{種}/ ごとに truth.json と、test/run.js の出力 seika.json・seika.pages.json
#   python3 test/merge/evaluate.py --clean 結果.json            … 誤りのない成果物: 差し込みの項目がすべて一致し、余分な検出がないか
#   見つけた: 誤りを入れたページの、差し込みの照合の項目(値が違う・見当たらない・共通の値が違う)か、同じ作りのほかのページと違う所の項目、
#     成果物だけで見るチェックの項目(英語のつづりなど。ページの端の項目は除く)で、枠が誤りの字に重なるもの
#     (1行抜けた役職と、ほかの人の役職に置き換わった役職は、その役職の値が見当たらない項目でもよい)
#   余分な検出: 差し込みの照合の項目と、同じ作りのほかのページと違う所の項目のうち、どの誤りにも当たらないもの
import json, sys, glob, os
from collections import defaultdict
K = 200 / 72
ov = lambda a, b, m: min(a[2], b[2]) + m > max(a[0], b[0]) and min(a[3], b[3]) + m > max(a[1], b[1])
mine = lambda f: (f.get('merge') and f['merge']['kind'] != 'ok') or (f['cat'] == 'J' and f['j']['kind'] == 'tmpl')
if sys.argv[1] == '--clean':
    F = json.load(open(sys.argv[2], encoding='utf-8'))
    ok = sum(1 for f in F if f.get('merge') and f['merge']['kind'] == 'ok')
    bad = [f for f in F if mine(f)]
    other = [f for f in F if not mine(f) and not f.get('merge') and f['cat'] != 'J']
    print(('合格' if not bad and not other and ok else '不合格') + f'（一致したページ {ok}・差し込みの項目の違い {len(bad)}・ほかの項目 {len(other)}）')
    for f in bad + other: print('   ', f['cat'], f.get('show', '')[:30], (f.get('merge') or {}).get('field', ''), (f.get('j') or {}).get('msg', '')[:40])
    sys.exit()
root, detail = sys.argv[1], '--detail' in sys.argv
stat, fps, miss, total = defaultdict(lambda: [0, 0]), [], [], 0
for vd in sorted(glob.glob(os.path.join(root, 'v*')), key=lambda d: int(os.path.basename(d)[1:])):
    rp = os.path.join(vd, 'seika.json')
    if not os.path.exists(rp): continue
    edits = json.load(open(os.path.join(vd, 'truth.json'), encoding='utf-8'))['edits']
    pages = json.load(open(os.path.join(vd, 'seika.pages.json'), encoding='utf-8'))
    ALL = json.load(open(rp, encoding='utf-8'))
    F = [f for f in ALL if mine(f)]
    JO = [f for f in ALL if f['cat'] == 'J' and not mine(f) and f['j']['kind'] != 'edge']   # ほかのチェックの項目(見つけたかどうかだけに使う)
    qof = lambda f: pages[f['page'] - 1]['q']
    boxes = lambda f: [b for b in [f.get('nbox')] + (f.get('pnboxes') or []) + (f.get('moreNboxes') or []) if b]
    hit = set()
    for e in edits:
        total += 1
        def ok(f):
            if qof(f) != e['page']: return False
            if e['type'] == 'titledrop' or (e['type'] == 'swap_title' and f.get('merge') and f['merge']['kind'] == 'missing'): return f.get('merge') and f['merge']['kind'] == 'missing' and f['merge']['want'] == e['before']
            if e['type'] == 'teldrop': return f.get('merge') and f['merge']['kind'] in ('commonMissing', 'common') and f['merge']['want'].split()[-1] in e['before']
            if e['type'] == 'numdrop' and f.get('merge') and f['merge']['kind'] == 'missing': return f['merge']['want'] in e['before']   # 社員番号が消えた(社員証)
            return any(ov(b, e['box'], e['size'] * K) for b in boxes(f))
        fs = [k for k, f in enumerate(F) if ok(f)]
        jo = any(ok(f) for f in JO)
        st = stat[e['type']]; st[0] += 1; st[1] += bool(fs or jo)
        hit.update(fs)
        if not fs and not jo: miss.append((os.path.basename(vd), e))
    for k, f in enumerate(F):
        if k not in hit: fps.append((os.path.basename(vd), f))
found = sum(v[1] for v in stat.values())
print(f'差し込み印刷: 誤り {total}件中 見つけた {found}件（{100 * found / max(1, total):.1f}%） / 余分な検出 {len(fps)}件')
NAMES = dict(name='氏名の1字', title='役職の1字', titledrop='役職の1行が抜ける', entitle='英語の役職の1字', roman='ローマ字の氏名の1字', email_f='表のメール', email_b='裏のメール',
             mobile_f='表の携帯', mobile_b='裏の携帯', tmpl_en='英語の住所(原稿にない字)', tmpl_co='会社名', tel_f='事業所の電話番号', teldrop='事業所の電話番号が消える',
             title_add='役職に1字増える', entitle_add='英語の役職に1語増える', name_add='縦組みの氏名に1字増える', swap_title='役職がほかの人のもの',
             swap_email_b='裏のメールがほかの人のもの', line_drop='英語の会社名・住所の1行が消える', co_drop='会社名の行が消える', addr_drop='住所の1行が消える',
             dept='所属の1字', num='社員番号の1桁', date='有効期限の1桁', name_add_h='横組みの氏名に1字増える', dept_add='所属の頭に1字増える',
             swap_name='氏名がほかの人のもの', tmpl='決まった字の1字', numdrop='社員番号が消える')
for t, (n, f) in sorted(stat.items()): print(f'   {NAMES.get(t, t):<14} {f}/{n}')
if detail:
    for v, e in miss: print(f'   見逃し {v} p{e["page"] + 1} {e["type"]} {e["before"]}→{e["after"]}')
    for v, f in fps: print(f'   余分 {v} {f["cat"]} {(f.get("merge") or {}).get("field", "")} 「{f.get("show", "")[:30]}」 {(f.get("j") or {}).get("msg", "")[:40]}')
