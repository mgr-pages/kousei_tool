# 字形どうしの見た目の差: 0.33画素刻みで位置を合わせた上で「局所的な差の最大値」をとる
import numpy as np, cv2
SH = [-1, -2/3, -1/3, 0, 1/3, 2/3, 1]
def canvas(g, H, W, dx=0.0, dy=0.0):
    c = np.full((H, W), 255, np.float32); y = (H-g.shape[0])//2; x = (W-g.shape[1])//2
    c[y:y+g.shape[0], x:x+g.shape[1]] = g
    if dx or dy: c = cv2.warpAffine(c, np.float32([[1, 0, dx], [0, 1, dy]]), (W, H), flags=cv2.INTER_LINEAR, borderValue=255)
    return c
def local_diff(a, b):
    H, W = max(a.shape[0], b.shape[0])+6, max(a.shape[1], b.shape[1])+6
    A = canvas(a, H, W); best = 1e9
    for dy in SH:
        for dx in SH:
            d = cv2.blur(np.abs(A - canvas(b, H, W, dx, dy)), (5, 5)).max()
            best = min(best, d)
    return best
