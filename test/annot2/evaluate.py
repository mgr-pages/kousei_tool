# コメント(注釈)で指示を入れたPDF原稿の模擬データ(test/annot2/make.py)の採点
#   python3 test/annot2/evaluate.py truth.json 出力.json
#   指示ごと: コメントの文で項目を探し、正解どおりか
#     A: 赤字どおり変わった項目で、自動の判定(ok・ng)が正解どおり
#     human: 人が判断する項目(自動の判定なし)。「直っていない」や ng ではない
#     K: 人が判断する指示の項目(コメントのやり取りなど)
#   指示にない変化: 指示にない変更(C2)として出ているか
#   余分な検出: 直っていない(B・B2)、正解にない ng、どの指示にも当たらない指示にない変更(C2・C3。参考に回したものは除く)
import json, sys
truth = json.load(open(sys.argv[1], encoding='utf-8'))
F = json.load(open(sys.argv[2], encoding='utf-8'))
def match(t, f):
    n = f.get('note') or ''
    if t.get('exact'): return n.strip() == t['note']
    if t.get('exact_first'): return n.split('\n')[0].strip() == t['note']
    return t['note'] in n
ok, lines, used, ng_ok = 0, [], set(), set()
for t in truth['instr']:
    hits = [i for i, f in enumerate(F) if match(t, f) and f['cat'] in ('A', 'A_IMG', 'K', 'B', 'B2')]
    w = t['want']
    if w == 'A':
        good = [i for i in hits if F[i]['cat'] == 'A' and F[i].get('auto') == t['auto']]
        bad = [i for i in hits if F[i]['cat'] in ('B', 'B2') or (F[i].get('auto') and F[i].get('auto') != t['auto'])]
        if t['auto'] == 'ng': ng_ok.update(good)
    elif w == 'K':
        good = [i for i in hits if F[i]['cat'] == 'K']
        bad = [i for i in hits if F[i]['cat'] in ('B', 'B2') or F[i].get('auto') == 'ng']
    else:
        good = [i for i in hits if F[i]['cat'] in ('A', 'A_IMG', 'K') and not F[i].get('auto')]
        bad = [i for i in hits if F[i]['cat'] in ('B', 'B2') or F[i].get('auto') == 'ng']
    used.update(hits)
    if good and not bad: ok += 1
    else: lines.append(f"   不合格 {t['what']}: 正解 {w}{('/' + t['auto']) if t.get('auto') else ''}、出たもの {[(F[i]['cat'], F[i].get('auto')) for i in hits]}")
for e in truth['extra']:
    hits = [i for i, f in enumerate(F) if f['cat'] == e['cat'] and e['text'] in (f.get('show') or '') and not f.get('note')]
    used.update(hits)
    if hits: ok += 1
    else: lines.append(f"   見逃し {e['what']}")
extra = [f for i, f in enumerate(F) if i not in used and (f['cat'] in ('B', 'B2') or (f.get('auto') == 'ng' and i not in ng_ok) or (f['cat'] in ('C2', 'C3') and not f.get('textSame') and not f.get('note')))]
for f in extra: lines.append(f"   余分な検出 {f['cat']} 「{(f.get('show') or '')[:30]}」")
total = len(truth['instr']) + len(truth['extra'])
print(f"コメントで指示したPDF原稿 {total}件中 合格{ok}件 / 不合格{total - ok}件 / 余分な検出{len(extra)}件")
for l in lines: print(l)
