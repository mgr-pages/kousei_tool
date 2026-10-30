# Noto Sans CJK JP（Source Han Sans と同じ文字番号）の「文字番号(CID) → Unicode」の表を作る
#   python3 src/data/make_noto_cid2u.py NotoSansCJKjp-Regular.otf src/data/noto_cjk_cid2u.json
#   フォントは https://github.com/notofonts/noto-cjk の Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf（版 2.004。SIL Open Font License 1.1）
#   PDFに埋め込まれたこのフォントに文字の対応表（ToUnicode）がないとき、文字データが化けるのを正しい字に戻すのに使う（src/js/pdfio.js）
#   同じ字形に複数の文字があるときは、ふつうの字（NFKC で変わらない字。「⽤」(部首) より「用」）を採る。
#   縦書き用の字形・幅違いなど、文字に直接対応しない字形は、字形の差し替え(GSUB)を逆にたどって元の字にする
#   出力: [CIDの始め, Unicodeの始め, 続く数, ...] の並び(CID と Unicode がともに1ずつ増える所をまとめる)
import sys, json, unicodedata
from fontTools.ttLib import TTFont

src, out = sys.argv[1], sys.argv[2]
f = TTFont(src)
cid = lambda g: int(g[3:]) if g.startswith('cid') else None
cand = {}
for u, g in f.getBestCmap().items():
    c = cid(g)
    if c is not None: cand.setdefault(c, []).append(u)
def pick(us):
    return sorted(us, key=lambda u: (unicodedata.normalize('NFKC', chr(u)) != chr(u), u >= 0x10000, u))[0]
m = {c: pick(us) for c, us in cand.items()}
# 字形の差し替え(GSUB の 1対1・選択)を逆にたどる。縦書き(vert・vrt2)を先に
gsub = f['GSUB'].table
def subs(lookup):
    for st in lookup.SubTable:
        if lookup.LookupType == 7: st, typ = st.ExtSubTable, st.ExtensionLookupType
        else: typ = lookup.LookupType
        if typ == 1:
            for a, b in st.mapping.items(): yield a, [b]
        elif typ == 3:
            for a, bs in st.alternates.items(): yield a, bs
order = ['vert', 'vrt2']
feats = sorted(gsub.FeatureList.FeatureRecord, key=lambda r: (order.index(r.FeatureTag) if r.FeatureTag in order else len(order), r.FeatureTag))
for _ in range(3):   # 差し替えの差し替えもたどる
    changed = False
    for r in feats:
        for li in r.Feature.LookupListIndex:
            for a, bs in subs(gsub.LookupList.Lookup[li]):
                ca = cid(a)
                if ca not in m: continue
                for b in bs:
                    cb = cid(b)
                    if cb is not None and cb not in m: m[cb] = m[ca]; changed = True
    if not changed: break
runs, items = [], sorted(m.items())
i = 0
while i < len(items):
    c0, u0 = items[i]; n = 1
    while i + n < len(items) and items[i + n] == (c0 + n, u0 + n): n += 1
    runs += [c0, u0, n]; i += n
json.dump({'font': f['name'].getDebugName(4) + ' ' + f['name'].getDebugName(5).split(';')[0], 'count': len(m), 'runs': runs}, open(out, 'w'), separators=(',', ':'))
print(out, 'CIDs', len(m), 'runs', len(runs) // 3)
