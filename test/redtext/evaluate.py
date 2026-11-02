# 赤い文字で指示を書き込んだPDF原稿(test/redtext/make.py)の結果を採点する
#   python3 test/redtext/evaluate.py keep 結果.json     : 原稿 genko.pdf と、直していない成果物 base.pdf
#   python3 test/redtext/evaluate.py applied 結果.json  : 原稿 genko.pdf と、指示どおりに直した成果物 applied.pdf
#   赤い文字(指示)を、原稿の字として成果物と比べていないか(「13,200円」などが「成果物にない字」として出ていないか)
#   keep: 文字の違い(原稿と違う・指示にない変更・全角半角など)が1件もなく、価格の指示が「直っていない」(B)で出ること
#   applied: 4か所の直しがそれぞれ「旧→新」の字で出て、価格の指示が「赤字どおり変わった」(A)になり、「直っていない」がないこと
import json, sys
case, res = sys.argv[1], json.load(open(sys.argv[2], encoding='utf-8'))
RED = ['13,200', 'そよ風に', '全体的に', '「家電」→「製品」', 'とても']
TEXT = ('A', 'C2', 'T', 'N', 'V', 'E')
def dels(f): return ''.join(s[1] for s in (f.get('segs') or []) if s[0] == '-')
def ins(f): return ''.join(s[1] for s in (f.get('segs') or []) if s[0] == '+')
bad = []
for f in res:   # 赤い文字が、消えた字(原稿にあって成果物にない字)として出ていないか
    d = dels(f)
    for r in RED:
        if r in d: bad.append(f'赤い文字「{r}」が原稿の字として出た（{f["cat"]}）')
price = lambda f: 820 <= (f.get('nbox') or [0])[0] <= 940 and 720 <= (f.get('nbox') or [0, 0])[1] <= 770   # 価格「12,800円」の所(200dpi の画素)
if case == 'keep':
    for f in res:
        if f['cat'] in TEXT: bad.append(f'余分な検出 {f["cat"]} {dels(f)}→{ins(f)}')
    if not any(f['cat'] == 'B' and price(f) for f in res): bad.append('価格の指示が「直っていない」で出ていない')
else:
    #   項目の違い(segs)から、原稿側・成果物側の字の並びを組み立てて調べる(「1[2→3],[8→2]00円」も「12,800→13,200」として見る)
    side = lambda f, t: ''.join(s[1] for s in (f.get('segs') or []) if s[0] != t)
    want = [('家電', '製品'), ('', 'とても'), ('かぜ', '風'), ('12,800', '13,200')]
    for o, n in want:
        if not any(o in side(f, '+') and n in side(f, '-') and n not in side(f, '+') for f in res if f['cat'] in TEXT):
            bad.append(f'直し「{o}→{n}」が出ていない')
    if not any(f['cat'] == 'A' and price(f) for f in res): bad.append('価格の指示が「赤字どおり変わった」になっていない')
    if any(f['cat'] == 'B' for f in res): bad.append('「直っていない」が出た')
print(('合格' if not bad else '不合格') + f'（{len(res)}件）' + ''.join('\n   ' + b for b in bad))
