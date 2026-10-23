# 最小の編集手順で2つの並びを比べる(Myers法)。difflibは繰り返しの多い並び(表の「1年」が並ぶ列など)で変更位置を取り違えるため
def myers_edits(a, b):
    n, m = len(a), len(b); v = {1: 0}; trace = []
    for d in range(n + m + 1):
        trace.append(dict(v))
        for k in range(-d, d + 1, 2):
            x = v[k + 1] if k == -d or (k != d and v[k - 1] < v[k + 1]) else v[k - 1] + 1
            y = x - k
            while x < n and y < m and a[x] == b[y]: x += 1; y += 1
            v[k] = x
            if x >= n and y >= m:
                return _back(trace, n, m)
    return []

def _back(trace, n, m):
    x, y, out = n, m, []
    for d in range(len(trace) - 1, -1, -1):
        v = trace[d]; k = x - y
        pk = k + 1 if k == -d or (k != d and v.get(k - 1, -1) < v.get(k + 1, -1)) else k - 1
        px = v.get(pk, 0); py = px - pk
        while x > px and y > py: out.append(('=', x - 1, y - 1)); x -= 1; y -= 1
        if d > 0: out.append(('+', None, y - 1) if x == px else ('-', x - 1, None))
        x, y = px, py
    return out[::-1]

def opcodes(a, b):
    """difflib.SequenceMatcher.get_opcodes() と同じ形式"""
    res, i, j, k, E = [], 0, 0, 0, myers_edits(a, b)
    while k < len(E):
        if E[k][0] == '=':
            s = k
            while k < len(E) and E[k][0] == '=': k += 1
            res.append(('equal', i, i + k - s, j, j + k - s)); i += k - s; j += k - s
        else:
            di = dj = 0
            while k < len(E) and E[k][0] != '=':
                if E[k][0] == '-': di += 1
                else: dj += 1
                k += 1
            res.append(('replace' if di and dj else ('delete' if di else 'insert'), i, i + di, j, j + dj)); i += di; j += dj
    return res

def pairs(a, b): return [(o[1] + t, o[3] + t) for o in opcodes(a, b) if o[0] == 'equal' for t in range(o[2] - o[1])]
