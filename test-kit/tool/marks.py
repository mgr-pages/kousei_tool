# 赤字の取得と解釈: 紙スキャン/デジタル注釈 → 赤字マスク → 指示箇所(アンカー)と引き出し線・注記の切り分け
import numpy as np, cv2, pymupdf
from vis import render, S

def red_hsv(bgr):
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    return cv2.inRange(hsv, (0, 90, 90), (10, 255, 255)) | cv2.inRange(hsv, (165, 90, 90), (180, 255, 255))

def from_scan(scan, ref):
    """紙: スキャンを初校の画像に重ね、赤だけを取り出す(初校に元々印刷されている赤は除く)"""
    g = lambda im: (lambda x: (x.__setitem__(red_hsv(im) > 0, 255), x)[1])(cv2.cvtColor(im, cv2.COLOR_BGR2GRAY))
    orb = cv2.ORB_create(6000); k1, d1 = orb.detectAndCompute(g(scan), None); k2, d2 = orb.detectAndCompute(g(ref), None)
    ms = sorted(cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(d1, d2), key=lambda m: m.distance)[:1000]
    H, _ = cv2.findHomography(np.float32([k1[m.queryIdx].pt for m in ms]), np.float32([k2[m.trainIdx].pt for m in ms]), cv2.RANSAC, 3.0)
    w = cv2.warpPerspective(scan, H, (ref.shape[1], ref.shape[0]), borderValue=(255, 255, 255))
    rm = red_hsv(w); rm[cv2.dilate(red_hsv(ref), np.ones((9, 9), np.uint8)) > 0] = 0
    return cv2.morphologyEx(rm, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8)), w

def from_annots(page):
    """デジタル: 注釈あり/なしで描画した差分が朱入れ。コメント文字列も取り出す"""
    a, b = render(page, annots=True), render(page, annots=False)
    rm = ((cv2.absdiff(a, b).max(2) > 40) * 255).astype(np.uint8)
    notes = [dict(type=an.type[1], box=[v*S for v in an.rect], text=an.info.get('content', '')) for an in page.annots()]
    for n in notes:
        if n['type'] == 'Caret':
            x0, y0, x1, y1 = [int(v) for v in n['box']]; rm[max(0, y0-3):y1+3, max(0, x0-3):x1+3] = 0
    return rm, a, notes

def _center(t): x0, y0, x1, y1 = t['box']; return (y0+y1)//2, (x0+x1)//2

def anchors(rm, lines, toks, iblocks):
    """赤字から『どこを指しているか』を取り出す。引き出し線(行を突き抜けるだけの線・行間を走る線)は指示とみなさない"""
    used = np.zeros_like(rm); out = []
    # 1) 囲み: 閉じた赤線の内側にある文字・画像
    closed = cv2.morphologyEx(rm, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    cnts, hier = cv2.findContours(closed, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    for i, c in enumerate(cnts):
        par = hier[0][i][3]
        if par < 0 or cv2.contourArea(c) < 400: continue
        hole = np.zeros_like(rm); cv2.drawContours(hole, cnts, i, 255, -1)
        ring = cv2.dilate(hole, np.ones((15, 15), np.uint8)); ring[cv2.erode(hole, np.ones((7, 7), np.uint8)) > 0] = 0; ring &= rm
        x, y, w, h = cv2.boundingRect(c)
        inside = [k for k, t in enumerate(toks) if hole[_center(t)] > 0]
        if inside: out.append(dict(kind='tokens', toks=set(inside), how='囲み', box=(x, y, x+w, y+h))); used |= ring
        for b in iblocks:
            bx = b['box']; ov = hole[bx[1]:bx[3], bx[0]:bx[2]].sum() / 255
            if ov > 0.5*cv2.countNonZero(hole): out.append(dict(kind='image', how='囲み', box=(x, y, x+w, y+h))); used |= ring
    free = rm.copy(); free[used > 0] = 0
    # 2) 行の上の赤: 行を突き抜けるだけの線は除外し、文字の中央を通る線・書き込みを指示とみなす
    for li, l in enumerate(lines):
        x0, y0, x1, y1 = l['box']; v = l['vert']
        reg = free[y0:y1, max(0, x0-5):x1+5]; n, lab, st, _ = cv2.connectedComponentsWithStats(reg)
        h = (x1 - x0) if v else (y1 - y0)
        for j in range(1, n):
            ys, xs = np.nonzero(lab == j); gy, gx = ys + y0, xs + max(0, x0-5)
            if v: a_min, a_max, c_ext = gx.min() <= x0, gx.max() >= x1-1, gy.max()-gy.min()
            else: a_min, a_max, c_ext = gy.min() == y0, gy.max() == y1-1, gx.max()-gx.min()
            if a_min and a_max and c_ext <= 1.5*h:
                # 両側へ長く伸びていれば「突き抜けるだけの引き出し線」
                e = int(0.8*h)
                def reach(win, axis, rev):
                    idx = np.nonzero(win.any(axis=axis))[0]
                    return 0 if len(idx) == 0 else ((win.shape[1-axis] - idx.min()) if rev else (idx.max() + 1))
                if v: s1 = reach(free[max(0, gy.min()-h):gy.max()+h, max(0, x0-e):x0], 0, True); s2 = reach(free[max(0, gy.min()-h):gy.max()+h, x1:x1+e], 0, False)
                else: s1 = reach(free[max(0, y0-e):y0, max(0, gx.min()-h):gx.max()+h], 1, True); s2 = reach(free[y1:y1+e, max(0, gx.min()-h):gx.max()+h], 1, False)
                if s1 > 0.6*h and s2 > 0.6*h: continue
            # 行の中央から外れた位置(字の上端・下端付近)を通る細い線は、取り消し線ではなく引き出し線とみなす
            thin = (gx.max()-gx.min()+1) if v else (gy.max()-gy.min()+1); mid_off = (gx.mean()-(x0+x1)/2) if v else (gy.mean()-(y0+y1)/2)
            if thin <= 0.25*h and c_ext > h and abs(mid_off) > 0.2*h: continue
            hit = set()
            across = (gx.max()-gx.min()+1) if v else (gy.max()-gy.min()+1); slash = across >= 0.5*h and c_ext <= 3*h   # 短い斜線は行の幅いっぱいで判定
            lo, hi = (0, 1) if slash else (0.2, 0.8)
            for k in l['toks']:
                tx0, ty0, tx1, ty1 = toks[k]['box']
                tol = int(0.3*h) if c_ext <= 0.6*h else 0
                if v: zone = (lab[max(0, ty0-y0-tol):ty1-y0+tol, :] == j)[:, int(tx0-max(0, x0-5)+lo*(tx1-tx0)):int(tx0-max(0, x0-5)+hi*(tx1-tx0))]
                else: zone = (lab[int(lo*h):int(hi*h), :] == j)[:, max(0, tx0-max(0, x0-5)-tol):tx1-max(0, x0-5)+tol]
                if zone.sum() >= 3: hit.add(k)
            if hit:
                out.append(dict(kind='tokens', toks=hit, how='取消線・書込み', box=(int(gx.min()), int(gy.min()), int(gx.max()), int(gy.max())), thin=bool(thin <= 0.25*h), li=li, vert=bool(v), span=int((y1-y0) if v else (x1-x0)), h=int(h)))
                used[gy, gx] = 255
    free[used > 0] = 0
    # 3) 挿入記号(くさび): 行のすぐ下の「Λ」、または行のすぐ上の「V」(行間が狭いときによく使われる)
    def apexes(reg, h):
        """上側の輪郭から、左右とも下がっている頂点を探し、そこから下へ2本の線が開いていくものを返す"""
        res = []; n, lab, st, _ = cv2.connectedComponentsWithStats(reg)
        for j in range(1, n):
            ys, xs = np.nonzero(lab == j)
            if ys.max() - ys.min() < 0.25*h: continue
            top = np.full(xs.max()+12, 10**6); np.minimum.at(top, xs, ys); done_x = -100
            for ax in np.unique(xs):
                ay = top[ax]; L, Rr = top[max(0, ax-10):ax], top[ax+1:ax+11]
                if ax - done_x < 12 or len(L) < 5 or len(Rr) < 5 or ay > min(L.min(), Rr.min()): continue
                lv, rv = L[L < 10**6], Rr[Rr < 10**6]   # 頂点から最も遠い点で、左右とも十分に下がっているか
                if len(lv) < 4 or len(rv) < 4 or not (lv[0] > ay + 0.15*h and rv[-1] > ay + 0.15*h): continue
                spread = []; inner = 0   # 腕の間隔が下へ行くほど広がるか。頂点の真下(腕の内側)に線がある字(「木」など)は除く
                for dy in (int(0.25*h), int(0.35*h), int(0.45*h)):
                    near = (ys >= ay+dy-1) & (ys <= ay+dy+1) & (np.abs(xs-ax) < h)
                    lft, rgt = xs[near & (xs < ax-1)], xs[near & (xs > ax+1)]
                    if dy >= int(0.35*h): inner += int((near & (np.abs(xs-ax) <= 1)).sum())
                    spread.append(rgt.min() - lft.max() if len(lft) and len(rgt) else -1)
                if inner: continue
                ok = [g for g in spread if g > 0]
                if len(ok) >= 2 and ok == sorted(ok) and ok[-1] >= ok[0] + 3 and ok[-1] >= 8: res.append((ax, ay)); done_x = ax
        return res
    for l in [l for l in lines if not l['vert']]:
        x0, y0, x1, y1 = l['box']; h = y1 - y0; xa = max(0, x0-h)   # 行頭・行末の挿入のため左右に1字分広げる
        below = (y1 - int(0.15*h), y1 + int(0.9*h)); above = (max(0, y0 - int(0.9*h)), y0 + int(0.15*h))
        found = [(ax, below[0]+ay) for ax, ay in apexes(free[below[0]:below[1], xa:x1+h], h)]
        reg = np.flipud(free[above[0]:above[1], xa:x1+h]); found += [(ax, above[1]-1-ay) for ax, ay in apexes(np.ascontiguousarray(reg), h)]
        for ax, gy in found:
            gx = ax + xa
            k = next((k for k in l['toks'] if (toks[k]['box'][0]+toks[k]['box'][2])/2 > gx), l['toks'][-1]+1)
            out.append(dict(kind='insert', at=k, how='挿入記号', box=(gx-12, gy-10, gx+12, gy+10)))
    # 4) 画像の上の赤(囲み以外): 縁を突き抜ける・縁から入るだけの細い線は除外
    for b in iblocks:
        x0, y0, x1, y1 = b['box']; reg = free[y0:y1, x0:x1]; n, lab, st, _ = cv2.connectedComponentsWithStats(reg)
        for j in range(1, n):
            x, y, w, h, a = st[j]; edges = (x == 0) + (y == 0) + (x+w >= x1-x0) + (y+h >= y1-y0)
            if edges >= 1 and a / np.hypot(w, h) < 6: continue
            if a > 60: out.append(dict(kind='image', how='書込み', box=(x0+x, y0+y, x0+x+w, y0+y+h)))
    n, lab = cv2.connectedComponents(cv2.dilate(rm, np.ones((5, 5), np.uint8)))
    for a in out:
        x0, y0, x1, y1 = [int(v) for v in a['box']]; ids = lab[max(0, y0):y1+1, max(0, x0):x1+1]; ids = ids[ids > 0]
        a['stroke'] = int(np.bincount(ids).argmax()) if len(ids) else -1
    return out, used
