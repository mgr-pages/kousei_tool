# 見た目(画像)で変更箇所を検出する部分: ブロック分割 → 行 → 字形トークン → 列の比較
import numpy as np, cv2, difflib
from glyphcmp import local_diff
from myers import opcodes as myers_opcodes
DPI = 200; S = DPI/72

def render(page, annots=False):
    pix = page.get_pixmap(dpi=DPI, annots=annots)
    a = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)[..., :3]
    return cv2.cvtColor(a, cv2.COLOR_RGB2BGR)

def ink_mask(img, t=50): return ((255 - img.min(2)) > t).astype(np.uint8)

def runs(v, gap=1):
    """1次元の射影からインクのある区間を返す(gap以下の隙間は連結)"""
    idx = np.where(v > 0)[0]
    if len(idx) == 0: return []
    out, s, p = [], idx[0], idx[0]
    for i in idx[1:]:
        if i - p > gap + 1: out.append((s, p+1)); s = i
        p = i
    out.append((s, p+1)); return out

def group(parts, em):
    """隙間が小さく、まとめても1文字幅(行の太さ)程度に収まる断片を1つの字形にまとめる"""
    out = []
    for p in parts:
        if out and p[0]-out[-1][1] <= 0.3*em and p[1]-out[-1][0] <= 1.05*em: out[-1] = (out[-1][0], p[1])
        else: out.append(p)
    return out

def rule_lines(ink):
    """表の罫線・枠線など、細くて長い線だけを取り出す"""
    h = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((1, 120), np.uint8))
    v = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((120, 1), np.uint8))
    thick = cv2.dilate(cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8)), np.ones((5, 5), np.uint8))
    return ((h | v) & (1 - thick)).astype(np.uint8)

def blocks(img):
    ink = ink_mask(img); ink = ink & (1 - cv2.dilate(rule_lines(ink), np.ones((3, 3), np.uint8)))
    n, lab, st, _ = cv2.connectedComponentsWithStats(cv2.dilate(ink, np.ones((31, 41), np.uint8)))
    out = []
    for i in range(1, n):
        x, y, w, h = st[i][:4]
        sub = ink[y:y+h, x:x+w] * (lab[y:y+h, x:x+w] == i)
        m, _, st2, _ = cv2.connectedComponentsWithStats(sub.astype(np.uint8))
        largest = max((st2[j][2]*st2[j][3] for j in range(1, m)), default=0)
        ys_, xs_ = np.nonzero(sub); tw, th = xs_.max()-xs_.min()+1, ys_.max()-ys_.min()+1
        if min(tw, th) <= 6: kind = 'rule'
        elif largest > 0.3*w*h: kind = 'image'
        else:
            zr = np.mean(sub.sum(1) == 0); zc = np.mean(sub.sum(0) == 0)   # 何も書かれていない行・列の割合
            if zr > zc + 0.08: kind = 'htext'
            elif zc > zr + 0.08: kind = 'vtext'
            else: kind = 'vtext' if th > 1.5*tw else 'htext'
        out.append(dict(box=(x, y, x+w, y+h), kind=kind))
    # 縦組みの段落の最終行のように短い列は、上端がそろう縦組みの列があれば縦組みとみなす
    vw = [b['box'][2]-b['box'][0] for b in out if b['kind'] == 'vtext']
    if vw:
        mw = float(np.median(vw))
        for b in out:
            if b['kind'] == 'htext' and b['box'][2]-b['box'][0] <= 1.3*mw and any(abs(b['box'][1]-c['box'][1]) < 40 for c in out if c['kind'] == 'vtext'):
                b['kind'] = 'vtext'
    return out

def xycut(bs, rtl, gap=8):
    """ブロックの読み順。上下・左右のうち、いちばん広いすき間で切り分けることを繰り返す(縦組みは左右を右から読む)"""
    if len(bs) <= 1: return list(bs)
    best = None
    for axis in (1, 0):
        iv = sorted((b['box'][axis], b['box'][axis+2]) for b in bs); end = iv[0][1]
        for a0, a1 in iv[1:]:
            if a0 - end >= gap and (best is None or a0 - end > best[0]): best = (a0 - end, axis, (end + a0) / 2)
            end = max(end, a1)
    if best is None: return sorted(bs, key=(lambda b: (-b['box'][2], b['box'][1])) if rtl else (lambda b: (b['box'][1], b['box'][0])))
    _, axis, c = best
    g1 = [b for b in bs if (b['box'][axis]+b['box'][axis+2])/2 <= c]; g2 = [b for b in bs if (b['box'][axis]+b['box'][axis+2])/2 > c]
    if axis == 0 and rtl: g1, g2 = g2, g1
    return xycut(g1, rtl, gap) + xycut(g2, rtl, gap)

def tokens(img, blks):
    """テキストブロックを行に分け、字形の単位(トークン)を読み順に並べる"""
    ink = ink_mask(img); ink = ink & (1 - cv2.dilate(rule_lines(ink), np.ones((3, 3), np.uint8))); toks, lines = [], []
    h_blks = xycut([b for b in blks if b['kind'] == 'htext'], rtl=False)
    v_blks = xycut([b for b in blks if b['kind'] == 'vtext'], rtl=True)
    for b in h_blks + v_blks:
        x0, y0, x1, y1 = b['box']; vert = b['kind'] == 'vtext'; sub = ink[y0:y1, x0:x1]
        bands = runs(sub.sum(0)[::-1] if vert else sub.sum(1), gap=3)
        if len(bands) > 1:
            med = float(np.median([b1-b0 for b0, b1 in bands])); mb = [bands[0]]
            for b0, b1 in bands[1:]:
                p0, p1 = mb[-1]
                if (b1-b0 < 0.5*med or p1-p0 < 0.5*med) and b0-p1 < 0.5*med and (b1-p0) < 1.4*med: mb[-1] = (p0, b1)
                else: mb.append((b0, b1))
            bands = mb
        for (a0, a1) in bands:
            if vert: c0, c1 = x1-a1-x0, x1-a0-x0; band = sub[:, c0:c1]; parts = group(runs(band.sum(1), gap=0), c1-c0)
            else: band = sub[a0:a1, :]; parts = group(runs(band.sum(0), gap=0), a1-a0)
            lb = (x0+c0, y0, x0+c1, y1) if vert else (x0, y0+a0, x1, y0+a1)
            li = len(lines); lines.append(dict(box=lb, vert=vert, toks=[], blk=(x0, y0, x1, y1)))
            for (p0, p1) in parts:
                if vert: seg = band[p0:p1, :]; cs = runs(seg.sum(0), 0); tb = (x0+c0+cs[0][0], y0+p0, x0+c0+cs[-1][1], y0+p1)
                else: seg = band[:, p0:p1]; rs = runs(seg.sum(1), 0); tb = (x0+p0, y0+a0+rs[0][0], x0+p1, y0+a0+rs[-1][1])
                lines[li]['toks'].append(len(toks)); toks.append(dict(box=tb, line=li))
    def col_group(l):
        """同じ段に並ぶ行(横組みは左右の範囲が重なる行、縦組みは上下の範囲が重なり近くにある列)"""
        bx = l['box']
        if l['vert']: return [m for m in lines if m['vert'] and m['toks'] and min(m['box'][3], bx[3]) - max(m['box'][1], bx[1]) > 0.5*min(m['box'][3]-m['box'][1], bx[3]-bx[1]) and abs(m['box'][0]-bx[0]) < 600]
        return [m for m in lines if not m['vert'] and m['toks'] and min(m['box'][2], bx[2]) - max(m['box'][0], bx[0]) > 0.5*min(m['box'][2]-m['box'][0], bx[2]-bx[0])]
    for l in lines:
        if l['toks']: l['mid'] = float(np.median([((toks[k]['box'][0]+toks[k]['box'][2])/2) if l['vert'] else ((toks[k]['box'][1]+toks[k]['box'][3])/2) for k in l['toks']]))
    first = lambda m: toks[m['toks'][0]]['box'][1 if m['vert'] else 0]
    for l in lines:
        if not l['toks']: l['para'] = False; continue
        em = (l['box'][2]-l['box'][0]) if l['vert'] else (l['box'][3]-l['box'][1])
        g = col_group(l); base = float(np.median([first(m) for m in g])) if len(g) >= 3 else min(first(m) for m in g)
        em = float(np.median([(m['box'][2]-m['box'][0]) if m['vert'] else (m['box'][3]-m['box'][1]) for m in g]))
        l['para'] = first(l) - base > 0.5*em
    return toks, lines

class Codebook:
    """見た目が同じ字形に同じIDを振る。形は位置補正後の局所差、色は平均色で比較"""
    def __init__(self, tol=75): self.protos = []; self.tol = tol
    def id(self, img, t, line):
        x0, y0, x1, y1 = t['box']; crop = img[y0:y1, x0:x1]
        g = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY).astype(np.float32)
        m = ink_mask(crop).astype(bool); col = crop[m].mean(0) if m.any() else np.zeros(3)
        off = ((y0+y1)/2 - line['mid']) if not line['vert'] else ((x0+x1)/2 - line['mid'])
        cov = (255 - g) / max(1, 255 - g.min()); norm = 255 - 255*np.clip(cov, 0, 1)   # 色に左右されない形
        small = cv2.resize(norm, (8, 8), interpolation=cv2.INTER_AREA); inkq = float((255 - norm).sum()) / 255
        for i, p in enumerate(self.protos):
            if abs(p['h']-g.shape[0]) > 2 or abs(p['w']-g.shape[1]) > 2 or abs(p['off']-off) > 3: continue
            if np.abs(p['small'] - small).mean() > 40: continue
            if np.abs(p['col'] - col).max() > 40: continue
            if abs(p['ink'] - inkq) > 0.15 * max(p['ink'], inkq): continue
            if local_diff(p['norm'], norm) < self.tol: return i
        self.protos.append(dict(h=g.shape[0], w=g.shape[1], off=off, col=col, norm=norm, small=small, ink=inkq)); return len(self.protos) - 1
    def shape_same(self, a, b):
        p, q = self.protos[a], self.protos[b]
        return abs(p['h']-q['h']) <= 2 and abs(p['w']-q['w']) <= 2 and local_diff(p['norm'], q['norm']) < self.tol
    def color_diff(self, a, b): return np.abs(self.protos[a]['col'] - self.protos[b]['col']).max()

def union(boxes):
    if not boxes: return None
    b = np.array(boxes); return (int(b[:, 0].min()), int(b[:, 1].min()), int(b[:, 2].max()), int(b[:, 3].max()))

def strip(img, T, L, a, b):
    """トークンa..bを、行の高さで切り出して横(縦組みは縦)につなぎ、インクのない列(行)を詰めた画像"""
    parts = []
    for k in range(a, b):
        t = T[k]; l = L[t['line']]; x0, y0, x1, y1 = t['box']
        c = img[l['box'][1]:l['box'][3], x0:x1] if not l['vert'] else img[y0:y1, l['box'][0]:l['box'][2]]
        parts.append(c if not l['vert'] else np.rot90(c))
    if not parts: return None
    h = max(p.shape[0] for p in parts); parts = [cv2.copyMakeBorder(p, 0, h-p.shape[0], 0, 0, cv2.BORDER_CONSTANT, value=(255, 255, 255)) for p in parts]
    g = cv2.cvtColor(np.hstack(parts), cv2.COLOR_BGR2GRAY); keep = (255 - g).max(0) > 50
    return g[:, keep].astype(np.float32)

def same_look(old, new, ot, ol, nt, nl, i1, i2, j1, j2):
    a, b = strip(old, ot, ol, i1, i2), strip(new, nt, nl, j1, j2)
    if a is None or b is None or abs(a.shape[1]-b.shape[1]) > 3 or abs(a.shape[0]-b.shape[0]) > 4: return False
    h, w = min(a.shape[0], b.shape[0]), min(a.shape[1], b.shape[1]); ia, ib = (255-a).sum(), (255-b).sum()
    return local_diff(a[:h, :w], b[:h, :w]) < 75 and abs(ia-ib) < 0.1*max(ia, ib)

def text_changes(cb, ot, nt, oids, nids, old=None, new=None, ol=None, nl=None, skip=(set(), set())):
    out = []
    oi = [k for k in range(len(oids)) if k not in skip[0]]; ni = [k for k in range(len(nids)) if k not in skip[1]]
    for tag, a1, a2, b1, b2 in myers_opcodes([oids[k] for k in oi], [nids[k] for k in ni]):
        if tag == 'equal': continue
        # 絞り込んだ並びの位置を、元のトークン番号に戻す
        i1 = oi[a1] if a1 < len(oi) else len(oids); i2 = oi[a2-1]+1 if a2 > a1 else i1
        j1 = ni[b1] if b1 < len(ni) else len(nids); j2 = ni[b2-1]+1 if b2 > b1 else j1
        if tag == 'replace' and old is not None and i2-i1 <= 6 and j2-j1 <= 6 and same_look(old, new, ot, ol, nt, nl, i1, i2, j1, j2): continue
        c = dict(tag=tag, oi=(i1, i2), nj=(j1, j2), pj=ni[b1-1] if b1 > 0 else None)
        c['obox'] = union([ot[k]['box'] for k in range(i1, i2)]) if i2 > i1 else None
        c['nbox'] = union([nt[k]['box'] for k in range(j1, j2)]) if j2 > j1 else None
        if tag == 'replace' and i2-i1 == j2-j1 and all(cb.shape_same(oids[i1+k], nids[j1+k]) for k in range(i2-i1)):
            c['look'] = 'color' if max(cb.color_diff(oids[i1+k], nids[j1+k]) for k in range(i2-i1)) > 40 else 'same_look'
        out.append(c)
    return out

def image_changes(old, new, ob, nb):
    """画像・図版ブロック: 同じ見た目を探し、同位置=変化なし/別位置=移動/見つからない=差分を出す"""
    out = []; ng = cv2.cvtColor(new, cv2.COLOR_BGR2GRAY); used = set()
    for b in [x for x in ob if x['kind'] == 'image']:
        x0, y0, x1, y1 = b['box']; tpl = cv2.cvtColor(old[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY)
        res = cv2.matchTemplate(ng, tpl, cv2.TM_SQDIFF_NORMED); mv, _, ml, _ = cv2.minMaxLoc(res)
        if mv < 0.003:
            if abs(ml[0]-x0) <= 2 and abs(ml[1]-y0) <= 2: continue
            out.append(dict(kind='moved', obox=b['box'], nbox=(ml[0], ml[1], ml[0]+x1-x0, ml[1]+y1-y0))); continue
        cands = [x for x in nb if x['kind'] == 'image']
        iou = lambda a, c: max(0, min(a[2], c[2])-max(a[0], c[0])) * max(0, min(a[3], c[3])-max(a[1], c[1]))
        best = max(cands, key=lambda c: iou(b['box'], c['box']), default=None)
        if best is None or iou(b['box'], best['box']) == 0: out.append(dict(kind='removed', obox=b['box'])); continue
        used.add(best['box']); u = union([b['box'], best['box']])
        d = cv2.absdiff(old[u[1]:u[3], u[0]:u[2]], new[u[1]:u[3], u[0]:u[2]]).max(2) > 40
        d = cv2.morphologyEx(d.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        ys, xs = np.nonzero(d)
        if len(xs): out.append(dict(kind='changed', obox=(u[0]+xs.min(), u[1]+ys.min(), u[0]+xs.max(), u[1]+ys.max()), nbox=best['box']))
    return out
