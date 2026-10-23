# 朱書き照合ツール(試作): 初校PDF × 朱書き(紙スキャン/デジタル注釈) × 修正後PDF を照合し、要確認箇所を分類する
#   python3 proofcheck.py 初校.pdf 修正後.pdf --scan スキャン.pdf [--rules rules.json] --out 出力フォルダ
#   python3 proofcheck.py 初校.pdf 修正後.pdf --digital 注釈入り初校.pdf --out 出力フォルダ
# 判定はすべてルールベース(同じ入力なら同じ結果)。生成AIや外部サービスは使わない。
import sys, os, re, json, argparse, difflib, numpy as np, cv2, pymupdf
from vis import render, blocks, tokens, Codebook, text_changes, image_changes, union, S, DPI
from marks import from_scan, from_annots, anchors
from myers import opcodes as myers_opcodes, pairs as myers_pairs

CAT = {
    'A': '赤字あり・変更あり（内容を人が確認）', 'A_IMG': '赤字あり・画像の変更あり（人が確認）',
    'B': '赤字あり・変更なし（修正漏れの疑い）', 'B2': '続きの赤字（軽）',
    'C1': '全体指示・以下同様で説明できる変更', 'C2': '指示外の変更（文字・組み）', 'C3': '指示外の変更（画像・図版・色・位置）',
    'D': '全体指示・以下同様の展開', 'E': '見た目では差が出ない文字データの変更',
    'F': '指示箇所に結びつかない赤字（人が読む）', 'M': 'ママ・イキ（変更しない指示）どおり変更なし', 'F2': '引き出し線・注記（指示箇所に付随）', 'G': '全体指示として読み取った注記',
}
ov = lambda a, b, m=0: a[0]-m < b[2] and b[0]-m < a[2] and a[1]-m < b[3] and b[1]-m < a[3]

def txt(page, b):
    return page.get_textbox(pymupdf.Rect(*[v/S for v in b])).replace('\n', '').strip() if b else ''

def chars(page):
    out = []
    for b in page.get_text('rawdict')['blocks']:
        for l in b.get('lines', []):
            for s in l['spans']:
                out += [(c['c'], [v*S for v in c['bbox']]) for c in s['chars'] if c['c'].strip()]
    return out

def tok_text(cs, box):
    """字形(トークン)に対応する文字: 中心が字形に入る文字 → 字形の中心を含む文字 → 近くの文字 の順で探す"""
    x0, y0, x1, y1 = box; cx, cy = (x0+x1)/2, (y0+y1)/2
    inside = [c for c, b in cs if x0-2 <= (b[0]+b[2])/2 <= x1+2 and y0-2 <= (b[1]+b[3])/2 <= y1+2]
    if inside: return ''.join(inside)
    cont = [(c, b) for c, b in cs if b[0]-1 <= cx <= b[2]+1 and b[1]-1 <= cy <= b[3]+1]
    if cont: return min(cont, key=lambda c: (c[1][2]-c[1][0])*(c[1][3]-c[1][1]))[0]
    best = min(cs, key=lambda c: ((c[1][0]+c[1][2])/2-cx)**2 + ((c[1][1]+c[1][3])/2-cy)**2, default=None)
    return best[0] if best and abs((best[1][0]+best[1][2])/2-cx) < 40 and abs((best[1][1]+best[1][3])/2-cy) < 40 else ''

def load_scans(path):
    if path.lower().endswith('.pdf'):
        d = pymupdf.open(path); out = []
        for p in d:
            pix = p.get_pixmap(dpi=300); a = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)[..., :3]
            out.append(cv2.cvtColor(a, cv2.COLOR_RGB2BGR))
        return out
    return [cv2.imread(p) for p in path.split(',')]

def same_blocks(ot, ol, nt, nl, oids, nids):
    """初校と修正後で、字形の並びがまったく同じブロック(位置は問わない)のトークン番号"""
    def per_block(T, L, ids):
        d = {}
        for k, t in enumerate(T): d.setdefault(tuple(L[t['line']]['blk']), []).append(k)
        return {b: (tuple(ids[k] for k in ks), ks) for b, ks in d.items()}
    ob, nb = per_block(ot, ol, oids), per_block(nt, nl, nids); so, sn = set(), set(); uo, un = set(), set()
    c = lambda b: ((b[0]+b[2])/2, (b[1]+b[3])/2)
    cand = sorted((np.hypot(c(b)[0]-c(n)[0], c(b)[1]-c(n)[1]), b, n) for b, (sq, _) in ob.items() for n, (sq2, _) in nb.items() if sq == sq2)
    for _, b, n in cand:   # 同じ内容のブロックが複数あるときは、位置が近いもの同士を組にする
        if b in uo or n in un: continue
        uo.add(b); un.add(n); so.update(ob[b][1]); sn.update(nb[n][1])
    return so, sn

def layout_changes(ot, ol, nt, nl, oids, nids, pairs):
    """文字は同じだが、段落の始まり(改行・追い込み・字下げ)が変わった箇所"""
    out = []
    first_o = {l['toks'][0]: l for l in ol if l['toks']}; first_n = {l['toks'][0]: l for l in nl if l['toks']}
    if True:
        for k, m in pairs:
            po = k in first_o and first_o[k]['para']; pn = m in first_n and first_n[m]['para']
            if po != pn:
                out.append(dict(kind='text', tag='layout', oi=(k, k+1), nj=(m, m+1), obox=ot[k]['box'], nbox=nt[m]['box'],
                                show='（改行・段落の追加）' if pn else '（追い込み・段落の解除）', before='', after='', nline=''))
    return out

def analyze(old_pdf, new_pdf, scan=None, digital=None, rules=(), outdir=None):
    od, nd = pymupdf.open(old_pdf), pymupdf.open(new_pdf)
    ad = pymupdf.open(digital) if digital else None
    scans = load_scans(scan) if scan else None
    rules = [dict(r) for r in rules]; cb = Codebook(); P = []
    for p in range(len(od)):
        old, new = render(od[p]), render(nd[p]); ob, nb = blocks(old), blocks(new)
        ot, ol = tokens(old, ob); nt, nl = tokens(new, nb)
        oids = [cb.id(old, t, ol[t['line']]) for t in ot]; nids = [cb.id(new, t, nl[t['line']]) for t in nt]
        oc_, nc_ = chars(od[p]), chars(nd[p])
        sk = same_blocks(ot, ol, nt, nl, oids, nids)
        ch = text_changes(cb, ot, nt, oids, nids, old, new, ol, nl, skip=sk)
        oi_ = [k for k in range(len(oids)) if k not in sk[0]]; ni_ = [k for k in range(len(nids)) if k not in sk[1]]
        pairs = [(oi_[a], ni_[b]) for a, b in myers_pairs([oids[k] for k in oi_], [nids[k] for k in ni_])]
        pairs += list(zip(sorted(sk[0]), sorted(sk[1]))) if len(sk[0]) == len(sk[1]) else []
        merged = []   # 同じ行で1字以内に隣接する差分は1件にまとめる
        for c in ch:
            q = merged[-1] if merged else None
            if q and c['oi'][0] - q['oi'][1] <= 1 and c['nj'][0] - q['nj'][1] <= 1 and 0 < q['oi'][1] and c['oi'][0] < len(ot) \
               and ot[c['oi'][0]]['line'] == ot[q['oi'][1]-1]['line']:
                q['oi'] = (q['oi'][0], c['oi'][1]); q['nj'] = (q['nj'][0], c['nj'][1]); q['tag'] = 'replace'
                q['obox'] = union([b for b in (q['obox'], c['obox']) if b]); q['nbox'] = union([b for b in (q['nbox'], c['nbox']) if b])
            else: merged.append(c)
        for c in merged:
            if c['obox'] is None:
                k = max(0, c['oi'][0]-1); b = ot[k]['box']; c['obox'] = (b[2]-3, b[1], b[2]+3, b[3]) if not ol[ot[k]['line']]['vert'] else (b[0], b[3]-3, b[2], b[3]+3)
            if c['nbox'] is None and (c.get('pj') is not None or c['nj'][0] < len(nt)):
                if c.get('pj') is not None: k = c['pj']; b = nt[k]['box']; c['nbox'] = (b[2]-3, b[1], b[2]+3, b[3]) if not nl[nt[k]['line']]['vert'] else (b[0], b[3]-3, b[2], b[3]+3)
                else: b = nt[c['nj'][0]]['box']; c['nbox'] = (b[0]-3, b[1], b[0]+3, b[3]) if not nl[nt[c['nj'][0]]['line']]['vert'] else (b[0], b[1]-3, b[2], b[1]+3)
            c['kind'] = 'text'
            tt = lambda cs, T, a, b: ''.join(tok_text(cs, T[k]['box']) for k in range(max(0, a), min(len(T), b)))
            c['before'] = tt(oc_, ot, c['oi'][0], c['oi'][1]); c['after'] = tt(nc_, nt, c['nj'][0], c['nj'][1])
            c['show'] = f"{tt(oc_, ot, c['oi'][0]-1, c['oi'][1]+1)}→{tt(nc_, nt, c['nj'][0]-1, c['nj'][1]+1)}"
            c['nline'] = ''.join(tt(nc_, nt, l['toks'][0], l['toks'][-1]+1) for l in nl if l['toks'] and c['nbox'] and ov(l['box'], c['nbox']))
        merged += layout_changes(ot, ol, nt, nl, oids, nids, pairs)
        im = image_changes(old, new, ob, nb)
        for c in im: c['show'] = {'changed': '画像・図版の変化', 'moved': '画像・図版の移動', 'removed': '画像・図版の削除'}[c['kind']]
        notes = []
        if scans is not None:
            if p < len(scans): rm, shown = from_scan(scans[p], old)
            else: rm, shown = np.zeros(old.shape[:2], np.uint8), old
        elif ad is not None: rm, shown, notes = from_annots(ad[p])
        else: rm, shown = np.zeros(old.shape[:2], np.uint8), old
        an, used = anchors(rm, [l for l in ol if l['toks']], ot, [b for b in ob if b['kind'] == 'image'])
        for n in notes:   # デジタルの挿入注釈は位置情報から直接読む
            if n['type'] != 'Caret': continue
            x0, y0, x1, y1 = n['box']
            for l in ol:
                lb = l['box']; h = lb[3]-lb[1]
                if not l['vert'] and lb[1]-0.3*h <= y0 <= lb[3]+0.6*h and lb[0] <= x0 <= lb[2]:
                    ks = [k for k in l['toks'] if x0-h/2 <= ot[k]['box'][2] <= x1+h/2 or x0-h/2 <= ot[k]['box'][0] <= x1+h/2]
                    if ks: an.append(dict(kind='insert', at=min(ks)+1, span=(min(ks), max(ks)+1), how='挿入(注釈)', box=(int(x0), int(y0), int(x1), int(y1)), stroke=-1)); break
        for a in an: a['note'] = next((n['text'] for n in notes if n['type'] != 'Caret' and ov(n['box'], a['box'], 8)), '') or \
                                 next((n['text'] for n in notes if n['type'] == 'Caret' and ov(n['box'], a['box'], 2)), '')
        P.append(dict(old=old, new=new, shown=shown, rm=rm, used=used, ot=ot, ol=ol, nt=nt, ch=merged, im=im, an=an, notes=notes, pairs=pairs))

    # 照合: 変更 × 赤字の指示箇所
    for d in P:
        for a in d['an']: a['hit'] = []
        for c in d['ch'] + d['im']:
            c['status'] = None
            for a in d['an']:
                if re.search(r'ママ|イキ', a.get('note', '')) and a['kind'] == 'tokens' and c['kind'] == 'text' and a['toks'] & set(range(c['oi'][0], max(c['oi'][1], c['oi'][0]+1))): a['hit'].append(c); continue
                if c['kind'] == 'text' and a['kind'] == 'tokens':
                    lo, hi = c['oi']; m = bool(a['toks'] & set(range(lo - (1 if c['tag'] == 'layout' else 0), max(hi, lo+1))))
                elif c['kind'] == 'text' and a['kind'] == 'insert':
                    lo, hi = a.get('span', (a['at']-1, a['at']+1)); m = lo <= c['oi'][0] <= hi or lo <= c['oi'][1] <= hi
                elif c['kind'] != 'text' and a['kind'] == 'image': m = ov(c['obox'], a['box'], 5)
                else: m = False
                if m: c['status'] = 'A' if c['kind'] == 'text' else 'A_IMG'; c['anchor'] = a; a['hit'].append(c)

    # 以下同様・全体指示の展開
    occ_cache = {}
    def occurrences(s):
        if s not in occ_cache:
            res = []
            for q in range(len(od)):
                cs = chars(od[q]); j = ''.join(c for c, _ in cs); i = j.find(s)
                while i >= 0: res.append((q, list(union([cs[k][1] for k in range(i, i+len(s))])))); i = j.find(s, i+1)
            occ_cache[s] = res
        return occ_cache[s]
    expansions = []
    def expand(src, frm, to, scope, origin):
        for q, r in occurrences(frm):
            if src and q == src[0] and ov(r, src[1], 2): continue
            hitc = next((c for c in P[q]['ch'] if c['tag'] != 'layout' and ov(c['obox'], r, 2)), None)
            st = '展開済み' if hitc and to in hitc['nline'] else ('別の変更あり' if hitc else '変更なし（展開漏れの候補）')
            if hitc and st == '展開済み' and hitc['status'] is None: hitc['status'] = 'C1'; hitc['why'] = origin
            if scope == 'after' and src and (q, r[1], r[0]) < (src[0], src[1][1], src[1][0]): st += '（指示より前なので対象外の可能性）'
            expansions.append(dict(page=q+1, frm=frm, to=to, status=st, origin=origin, box=[int(v) for v in r]))
    for p, d in enumerate(P):
        for a in d['an']:
            for c in a['hit']:
                if c['kind'] != 'text' or not c['before'] or c['tag'] == 'layout': continue
                scope = 'after' if '以下同様' in a.get('note', '') else 'candidate'
                if scope == 'candidate' and not (c['after'] and len(c['before']) >= 2 and re.search(r'[\u3040-\u30ff\u4e00-\u9fffA-Za-z]', c['before'])): continue
                expand((p, c['obox']), c['before'], c['after'], scope, '以下同様' if scope == 'after' else '同じ語の他の箇所（以下同様の候補）')
    for d in P:
        for n in d['notes']:
            m = re.search(r'「(.+?)」\s*(?:→|を)\s*「(.+?)」', n['text'])
            if m and '全体' in n['text']: rules.append(dict(frm=m.group(1), to=m.group(2), src='注釈')); n['rule'] = True
    for r in rules: expand(None, r['frm'], r['to'], 'all', '全体指示')
    remain = [dict(page=q+1, frm=r['frm'], box=[int(v*S) for v in rect]) for r in rules for q in range(len(nd)) for rect in nd[q].search_for(r['frm'])]

    # 文字データでの裏取り: 見た目で「同じ」と対応づいた字形どうしで、文字データが違うもの
    lookalike = []
    for p, d in enumerate(P):
        def owner(cs, T):
            res = {}
            for c, b in cs:
                cx, cy = (b[0]+b[2])/2, (b[1]+b[3])/2
                k = next((k for k, t in enumerate(T) if t['box'][0]-2 <= cx <= t['box'][2]+2 and t['box'][1]-2 <= cy <= t['box'][3]+2), None)
                if k is not None: res[k] = res.get(k, '') + c
            return res
        oc, nc = owner(chars(od[p]), d['ot']), owner(chars(nd[p]), d['nt'])
        for k, m in d['pairs']:
            if k in oc and m in nc and oc[k] != nc[m] and not any(ov(d['ot'][k]['box'], c['obox'], 2) for c in d['ch']):
                lookalike.append(dict(page=p+1, show=f"{oc[k]}→{nc[m]}", box=list(d['ot'][k]['box'])))

    # 結果の一覧
    F = []
    def add(page, cat, box, show='', how='', note='', check='', nbox=None):
        F.append(dict(page=page, cat=cat, label=CAT[cat], box=[int(v) for v in box], nbox=[int(v) for v in nbox] if nbox is not None else None, show=show, how=how, note=note, check=check))
    for p, d in enumerate(P):
        for c in d['ch'] + d['im']:
            st = c['status']
            if st is None:
                if c['kind'] == 'text': st = 'C3' if c.get('look') == 'color' else 'C2'
                else: st = 'C3'
            a = c.get('anchor', {}); chk = ''
            if a.get('note') and c['kind'] == 'text' and c['tag'] != 'layout':
                want = re.sub(r'（.*?）|\(.*?\)', '', a['note']).strip()
                ctx = txt(nd[p], (c['nbox'][0]-80, c['nbox'][1]-4, c['nbox'][2]+80, c['nbox'][3]+4)) if c.get('nbox') else ''
                chk = '指示文が修正後にある（自動確認OK）' if want and want.replace(' ', '') in ctx.replace(' ', '') else '指示文が修正後に見当たらない（要確認）'
            show = c['show'] + ('（色のみ）' if c.get('look') == 'color' else '')
            add(p+1, st, c['obox'], show, a.get('how', c.get('why', '')), a.get('note', ''), chk, c.get('nbox'))
        done = {a['stroke'] for a in d['an'] if a['hit']}; f0 = len(F)
        along = lambda b, v: (b[1], b[3]) if v else (b[0], b[2])   # 行の向きに沿った範囲
        for a in d['an']:
            keep = bool(re.search(r'ママ|イキ', a.get('note', '')))
            if keep and a['hit']: add(p+1, 'C2', a['box'], 'ママ／イキの指示なのに変更あり', a['how'], a['note']); continue
            if keep: add(p+1, 'M', a['box'], txt(od[p], a['box']), a['how'], a['note']); continue
            if a['hit']: continue
            # 指示どおり変わった赤字のすぐ隣(行の折り返しで続く取り消し線など)は、続きの赤字として軽く扱う
            adj = a['kind'] == 'tokens' and any(b['hit'] and b['kind'] == 'tokens' and any((k-1) in b['toks'] or (k+1) in b['toks'] for k in a['toks']) for b in d['an'])
            cat = 'B2' if (a['stroke'] in done and a['stroke'] >= 0) or adj else 'B'
            # 同じ一続きの赤字、または同じ行で途切れて続く細い線は、1件にまとめる
            gap = lambda f: max(along(a['box'], a.get('vert'))[0] - along(f['box'], a.get('vert'))[1], along(f['box'], a.get('vert'))[0] - along(a['box'], a.get('vert'))[1])
            prev = next((f for f in F[f0:] if f['cat'] == cat and a['kind'] == 'tokens' and (
                         (f.get('stroke') == a['stroke'] and a['stroke'] >= 0 and a['stroke'] not in done and f['box'][1] < a['box'][3] and a['box'][1] < f['box'][3]) or
                         (f.get('thin') and a.get('thin') and f.get('li') == a.get('li') and gap(f) <= 20))), None)
            if prev: prev['box'] = [int(v) for v in union([prev['box'], a['box']])]; prev['show'] = txt(od[p], prev['box']); continue
            add(p+1, cat, a['box'], txt(od[p], a['box']) if a['kind'] != 'insert' else '（挿入位置）', a['how'], a.get('note', ''))
            F[-1].update(stroke=a['stroke'], thin=bool(a.get('thin')), li=a.get('li'), vert=a.get('vert'), span=a.get('span'), lh=a.get('h'))
        # まとめたあとで行のほぼ全長(かつ字2つ分より長く)にわたる細い線は、引き出し線の可能性として示す
        for f in F[f0:]:
            if f.get('thin') and f.get('span'):
                s, e = along(f['box'], f['vert'])
                if e - s >= 0.9*f['span'] and e - s > 2*f['lh']: f['how'] += '（細い線：引き出し線の可能性）'
        rest = d['rm'].copy(); rest[d['used'] > 0] = 0
        n, lab, st, _ = cv2.connectedComponentsWithStats(cv2.dilate(rest, np.ones((25, 25), np.uint8)))
        for j in range(1, n):
            x, y, w, h, _ = st[j]; b = (x, y, x+w, y+h)
            if cv2.countNonZero(rest[y:y+h, x:x+w]) < 60: continue
            if any(nn.get('rule') and ov(nn['box'], b) for nn in d['notes']): add(p+1, 'G', b); continue
            add(p+1, 'F2' if any(ov(b, a['box'], 30) for a in d['an']) else 'F', b)
    for e in expansions: add(e['page'], 'D', e['box'], f"{e['frm']}→{e['to']}", e['origin'], '', e['status'])
    for r in remain: add(r['page'], 'D', r['box'], f"{r['frm']}（修正後に残っている）", '全体指示', '', '未統一')
    for l in lookalike: add(l['page'], 'E', l['box'], l['show'])

    if outdir:
        os.makedirs(outdir, exist_ok=True)
        json.dump(F, open(f'{outdir}/findings.json', 'w'), ensure_ascii=False, indent=1)
        col = {'A': (0, 160, 0), 'A_IMG': (0, 160, 0), 'B': (0, 0, 230), 'B2': (120, 120, 230), 'C1': (170, 170, 0), 'C2': (230, 90, 0), 'C3': (230, 90, 0),
               'D': (200, 0, 200), 'E': (0, 140, 255), 'M': (0, 160, 0), 'F': (90, 90, 90), 'F2': (190, 190, 190), 'G': (90, 90, 90)}
        for p, d in enumerate(P):
            L = cv2.addWeighted(d['shown'], 0.55, np.full_like(d['old'], 255), 0.45, 0); R = cv2.addWeighted(d['new'], 0.55, np.full_like(d['new'], 255), 0.45, 0)
            for f in F:
                if f['page'] != p+1 or f['cat'] == 'F2' or (f['cat'] == 'D' and f['check'] == '展開済み'): continue
                b = f['box']; cv2.rectangle(L, (b[0]-6, b[1]-6), (b[2]+6, b[3]+6), col[f['cat']], 4)
                if f['nbox']: b = f['nbox']; cv2.rectangle(R, (b[0]-6, b[1]-6), (b[2]+6, b[3]+6), col[f['cat']], 4)
            cv2.imwrite(f'{outdir}/page{p+1}.jpg', np.hstack([L, np.full((L.shape[0], 20, 3), 80, np.uint8), R]), [cv2.IMWRITE_JPEG_QUALITY, 85])
    return F

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('old'); ap.add_argument('new')
    ap.add_argument('--scan'); ap.add_argument('--digital'); ap.add_argument('--rules'); ap.add_argument('--out', required=True)
    a = ap.parse_args()
    rules = json.load(open(a.rules)) if a.rules else []
    F = analyze(a.old, a.new, a.scan, a.digital, rules, a.out)
    for f in sorted(F, key=lambda f: (f['cat'], f['page'])):
        if f['cat'] in ('F2',): continue
        print(f"p{f['page']} | {f['cat']} {f['label']} | {f['show']} | {f['how']} {('/ 指示文「' + f['note'] + '」') if f['note'] else ''} {f['check']}")
