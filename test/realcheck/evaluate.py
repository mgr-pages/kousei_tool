# 実物のPDFに無作為に入れた誤り(test/realcheck/mutate.py)の結果を採点する
#   python3 test/realcheck/evaluate.py 結果のフォルダ... [--detail]
#   結果のフォルダには、truth.json と、test/run.js の出力(あるものだけ採点する)を置く:
#     old.json    旧版(base.pdf)＋成果物(new.pdf)。原稿なし
#     marks.json  注釈のないPDF原稿(base.pdf)＋成果物(new.pdf)
#     annot.json  注釈で指示を入れた原稿(genko.pdf)＋成果物(new.pdf)
#     same.json   同じファイルどうし(base.pdf を原稿と成果物に入れたもの)。照合の項目が0件になるはず
#   見つけた: 成果物だけのチェック(J)以外の項目の枠が、誤りの枠(字の大きさの半分だけ広げたもの)に重なる
#   余分な検出: どの誤りの枠(字の大きさだけ広げたもの)にも重ならない項目(成果物だけのチェックは数えない)
#     成果物だけで見る項目(J と、見た目が同じで文字データが違う字の指摘)は外す。全体指示・以下同様の推定から出た項目(D・C1)は別に数える
#     誤りを入れた副作用で見た目が変わった所(truth.json の side。字を取り除いたあと、同じ行の後ろの字が少し動いた所など)に出た項目も別に数える
#   注釈つきの原稿では、役割ごとに判定が正しいかも見る:
#     指示どおり(ok)        → 赤字どおり変わった・自動で確認済み(自動OK)。「人が判断」は別に数える
#     直し間違い(wrong)     → 指示どおりになっていない(自動NG)
#     直っていない(skip)    → 直っていない
#     指示にない変更(free)  → 指示にない変更
#   注釈の消し込み: 入れた注釈が、どれかの項目に指示として出ているか(注釈の数＝出た数になるはず)
import json, sys, os
from collections import Counter, defaultdict

K = 200 / 72
dirs = [a for a in sys.argv[1:] if not a.startswith('--')]; detail = '--detail' in sys.argv
ov = lambda a, b, m: min(a[2], b[2]) + m > max(a[0], b[0]) and min(a[3], b[3]) + m > max(a[1], b[1])
CH = ('C2', 'C3', 'E', 'V', 'T', 'N')   # 指示のない変化として出る種類

def boxes(f):
    bs = [b for b in (f.get('pnboxes') or []) + (f.get('pboxes') or []) if b]
    for k in ('nbox', 'box'):
        if f.get(k): bs.append(f[k])
    return bs

def load(d, mode):
    rp = os.path.join(d, mode + '.json')
    if not os.path.exists(rp): return None
    F = [f for f in json.load(open(rp, encoding='utf-8')) if f['cat'] != 'J' and not f.get('lint')]
    pages = json.load(open(os.path.join(d, mode + '.pages.json'), encoding='utf-8'))
    q = lambda f: pages[f['page'] - 1]['q'] if 0 < f['page'] <= len(pages) and pages[f['page'] - 1].get('q') is not None else f['page'] - 1
    return F, q

tot = defaultdict(Counter); lines = []
for d in dirs:
    T = json.load(open(os.path.join(d, 'truth.json'), encoding='utf-8')); E = T['edits']; SIDE = T.get('side', [])
    px = lambda e: [v * K for v in e['rect']]
    name = os.path.basename(os.path.normpath(d))
    r = load(d, 'same')
    if r:
        F, q = r; tot['same']['files'] += 1; tot['same']['items'] += len(F)
        for f in F: tot['same']['cat_' + f['cat']] += 1
        if detail:
            for f in F: lines.append(f'   同じファイルどうしで出た項目 {name} p{q(f) + 1} {f["cat"]} {f.get("nbox") or f.get("box")}')
    for mode in ('old', 'marks', 'annot'):
        r = load(d, mode)
        if not r: continue
        F, q = r; S = tot[mode]; S['files'] += 1; hit = set()
        for e in E:
            m = 0.5 * e['size'] * K
            fs = [k for k, f in enumerate(F) if q(f) == e['page'] and any(ov(b, px(e), m) for b in boxes(f))]
            hit.update(fs); cats = [(F[k]['cat'], F[k].get('auto')) for k in fs if F[k]['cat'] != 'A_IMG']   # 画像・図版の変化は、文字の誤りの判定には使わない(誤りを入れた副作用で出ることがある)
            role, vis = e['role'], e.get('visible')
            if role == 'skip':   # 直していない所
                S['skip'] += 1
                if mode != 'annot':
                    S['skip_quiet'] += not fs   # 何も出ないのが正しい
                else:
                    res = 'ok' if any(c in ('B', 'B2') for c, _ in cats) else 'human' if any(c == 'K' for c, _ in cats) else 'falseA' if any(c in ('A', 'A_IMG') for c, _ in cats) else 'none'
                    S['skip_' + res] += 1
                    if res != 'ok' and detail: lines.append(f'   {mode} {name} p{e["page"] + 1} 直っていない → {res} {cats}')
                continue
            if not vis:   # 見た目が変わらなかった誤り(白い字・ほかの物の下の字など): 文字データだけの違いとして別に数える
                S['invisible'] += 1; S['invisible_found'] += bool(fs); continue
            S['changes'] += 1; S['found'] += bool(fs); S['kind_' + e['kind']] += 1; S['kindfound_' + e['kind']] += bool(fs)
            if not fs and detail: lines.append(f'   {mode} {name} p{e["page"] + 1} 見逃し {e["kind"]} {e["role"]} {[round(v) for v in e["rect"]]} {e["size"]:.1f}pt')
            if mode != 'annot': continue
            if role == 'ok':
                res = 'ok' if ('A', 'ok') in cats else 'falseNG' if ('A', 'ng') in cats else 'human' if any(c in ('A', 'A_IMG', 'K') for c, _ in cats) else 'falseB' if any(c in ('B', 'B2') for c, _ in cats) else 'unlinked' if any(c in CH for c, _ in cats) else 'none'
            elif role == 'wrong':
                res = 'ok' if ('A', 'ng') in cats else 'falseOK' if ('A', 'ok') in cats else 'human' if any(c in ('A', 'A_IMG', 'K') for c, _ in cats) else 'falseB' if any(c in ('B', 'B2') for c, _ in cats) else 'unlinked' if any(c in CH for c, _ in cats) else 'none'
            else:   # free: 指示にない変更
                res = 'ok' if any(c in CH for c, _ in cats) else 'falseA' if any(c in ('A', 'A_IMG') for c, _ in cats) else 'other' if cats else 'none'
            S[role] += 1; S[role + '_' + res] += 1
            if res != 'ok' and detail: lines.append(f'   {mode} {name} p{e["page"] + 1} {role} {e["kind"]} → {res} {cats} {[round(v) for v in e["rect"]]}')
        if mode == 'annot':   # 注釈の消し込み
            for e in E:
                if not e['note']: continue
                S['notes'] += 1
                shown = any(q(f) == e['page'] and (f.get('note') or '').strip() and any(ov(b, px(e), 0.5 * e['size'] * K) for b in boxes(f)) for f in F)
                S['notes_shown'] += shown
                if not shown and detail: lines.append(f'   annot {name} p{e["page"] + 1} 注釈が出ていない {e["kind"]} {e["role"]} {[round(v) for v in e["rect"]]}')
        for k, f in enumerate(F):
            if k in hit or any(q(f) == e['page'] and any(ov(b, px(e), e['size'] * K) for b in boxes(f)) for e in E): continue
            if f['cat'] in ('D', 'C1'): S['rule'] += 1; continue   # 全体指示・以下同様の推定から出た項目
            if any(q(f) == s_['page'] and any(ov(b, [v * K for v in s_['rect']], 2) for b in boxes(f)) for s_ in SIDE): S['side'] += 1; continue   # 副作用で動いた字の所
            S['extra'] += 1; S['extra_' + f['cat']] += 1
            if detail: lines.append(f'   {mode} {name} p{q(f) + 1} 余分な検出 {f["cat"]} {f.get("auto") or ""} {f.get("nbox") or f.get("box")}')

pct = lambda a, b: f'{a}/{b}（{100 * a / b:.1f}%）' if b else '0/0'
NAMES = dict(old='旧版＋成果物', marks='注釈のないPDF原稿＋成果物', annot='注釈で指示した原稿＋成果物')
if tot['same']['files']:
    S = tot['same']; print(f"同じファイルどうし: {S['files']}組で、照合の項目 {S['items']}件（0件になるはず）" + (' ' + ' '.join(f'{k[4:]}:{v}' for k, v in S.items() if k.startswith('cat_')) if S['items'] else ''))
for mode in ('old', 'marks', 'annot'):
    S = tot[mode]
    if not S['files']: continue
    print(f"{NAMES[mode]}（{S['files']}組）: 見える変化 {pct(S['found'], S['changes'])} を見つけた / 余分な検出 {S['extra']}件" + (' [' + ' '.join(f'{k[6:]}:{v}' for k, v in S.items() if k.startswith('extra_')) + ']' if S['extra'] else ''))
    print('   種類ごと: ' + '　'.join(f"{k[5:]} {S['kindfound_' + k[5:]]}/{v}" for k, v in S.items() if k.startswith('kind_')))
    if S['rule']: print(f"   全体指示・以下同様の推定から出た項目（誤りの所以外）: {S['rule']}件")
    if S['side']: print(f"   誤りを入れた副作用で字が動いた所に出た項目: {S['side']}件")
    if S['invisible']: print(f"   見た目が変わらなかった誤り（文字データだけの違い）: {S['invisible_found']}/{S['invisible']} を見つけた")
    if mode != 'annot':
        if S['skip']: print(f"   直していない所で何も出なかった: {S['skip_quiet']}/{S['skip']}")
        continue
    for role, label, bad in (('ok', '指示どおり → 自動で確認済み', ('falseNG', 'falseB', 'unlinked', 'none', 'human')), ('wrong', '直し間違い → 指示どおりになっていない', ('falseOK', 'human', 'falseB', 'unlinked', 'none')), ('free', '指示にない変更 → 指示にない変更', ('falseA', 'other', 'none'))):
        if S[role]: print(f"   {label}: {pct(S[role + '_ok'], S[role])}" + ''.join(f"　{b}:{S[role + '_' + b]}" for b in bad if S[role + '_' + b]))
    if S['skip']: print(f"   直っていない → 直っていない: {pct(S['skip_ok'], S['skip'])}" + ''.join(f"　{b}:{S['skip_' + b]}" for b in ('human', 'falseA', 'none') if S['skip_' + b]))
    print(f"   注釈の消し込み: 入れた注釈 {S['notes']}個のうち、項目に出たもの {S['notes_shown']}個")
for l in lines: print(l)
