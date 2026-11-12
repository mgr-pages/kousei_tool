# 性質の試験の採点(正解を人が決めなくても、どんなPDFでも成り立つはずのこと)
#   python3 test/props/check.py same 結果.json...            同じPDFを原稿と成果物(または旧版と成果物)に入れた結果: 照合の項目が0件か
#   python3 test/props/check.py unchanged 結果.json...       注釈で指示した原稿と、直していない成果物の結果: 変化の項目が0件か
#   python3 test/props/check.py notes 原稿.pdf 結果.json     注釈の数＝結果に指示として出た数か(返信は返信先にまとめる)。PyMuPDF が要る
#   照合の項目: 成果物だけで見る項目(J と、見た目が同じで文字データが違う字の指摘)を除いたもの
#   変化の項目: 指示にない変更(C2・C3)・赤字どおり変わった(A・A_IMG)・文字だけ違う(E)・書き方だけの違い(V)・全体指示どおり(C1)・原稿と違う(T・N)
import json, sys, os
mode, args = sys.argv[1], sys.argv[2:]
load = lambda p: [f for f in json.load(open(p, encoding='utf-8')) if f['cat'] != 'J' and not f.get('lint')]
name = lambda p: os.path.basename(p).replace('.json', '')
if mode == 'same':
    bad = [(name(p), F) for p in args for F in [load(p)] if F]
    print(f'同じPDFどうし: {len(args)}組中 照合の項目が0件のもの {len(args) - len(bad)}組' + (' / 合格' if not bad else ' / 不合格'))
    for n, F in bad: print(f'   {n}: {len(F)}件 ' + ' '.join(sorted({f["cat"] for f in F})))
elif mode == 'unchanged':
    CH = ('C2', 'C3', 'A', 'A_IMG', 'E', 'V', 'C1', 'T', 'N')
    for p in args:
        F = load(p); ch = [f for f in F if f['cat'] in CH]
        print(f'直していない成果物（{name(p)}）: 変化の項目 {len(ch)}件（0件のはず）・直っていない {sum(1 for f in F if f["cat"] in ("B", "B2"))}件・人が判断 {sum(1 for f in F if f["cat"] in ("K", "M", "G"))}件' + (' / 合格' if not ch else ' / 不合格'))
        for f in ch: print(f'   {f["cat"]} p{f["page"]} {f.get("nbox") or f.get("box")}')
elif mode == 'notes':
    import pymupdf
    doc = pymupdf.open(args[0]); F = load(args[1]); notes = []
    for pno, page in enumerate(doc):
        for a in page.annots() or []:
            t = (a.info.get('content') or '').strip()
            if t and not a.irt_xref and a.type[1] != 'Popup': notes.append((pno, t, [v * 200 / 72 for v in a.rect]))
    key = lambda s: ''.join(str(s).split())
    shown = [key(f.get('note') or '') for f in F]
    ov = lambda a, b: min(a[2], b[2]) > max(a[0], b[0]) and min(a[3], b[3]) > max(a[1], b[1])
    #   全体指示として読んだ注記(G)は、指示の文を持たないので、位置で数える
    glob = lambda p, r: any(f['cat'] == 'G' and f['page'] == p + 1 and f.get('box') and ov(f['box'], r) for f in F)
    miss = [(p, t) for p, t, r in notes if not any(key(t.split('\n')[0]) and key(t.split('\n')[0]) in s for s in shown) and not glob(p, r)]
    print(f'注釈の消し込み（{name(args[1])}）: 注釈 {len(notes)}個のうち、結果に指示として出たもの {len(notes) - len(miss)}個' + (' / 合格' if not miss else ' / 不合格'))
    for p, t in miss: print(f'   出ていない注釈 p{p + 1} 「{t[:20]}」')
