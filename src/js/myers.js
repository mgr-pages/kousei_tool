// 最小の編集手順で2つの並びを比べる(Myers法)。表のように同じ内容が繰り返される並びでも変更位置を取り違えない
'use strict';
(function () {
  function edits(a, b) {
    const n = a.length, m = b.length, trace = [];
    let v = new Map([[1, 0]]);
    for (let d = 0; d <= n + m; d++) {
      trace.push(new Map(v));
      for (let k = -d; k <= d; k += 2) {
        let x = (k === -d || (k !== d && v.get(k - 1) < v.get(k + 1))) ? v.get(k + 1) : v.get(k - 1) + 1;
        let y = x - k;
        while (x < n && y < m && a[x] === b[y]) { x++; y++; }
        v.set(k, x);
        if (x >= n && y >= m) return back(trace, n, m);
      }
    }
    return [];
  }
  function back(trace, n, m) {
    let x = n, y = m; const out = [];
    const g = (v, k) => (v.has(k) ? v.get(k) : -1);
    for (let d = trace.length - 1; d >= 0; d--) {
      const v = trace[d], k = x - y;
      const pk = (k === -d || (k !== d && g(v, k - 1) < g(v, k + 1))) ? k + 1 : k - 1;
      const px = v.has(pk) ? v.get(pk) : 0, py = px - pk;
      while (x > px && y > py) { out.push(['=', x - 1, y - 1]); x--; y--; }
      if (d > 0) out.push(x === px ? ['+', null, y - 1] : ['-', x - 1, null]);
      x = px; y = py;
    }
    return out.reverse();
  }
  // Pythonのdifflib.get_opcodes()と同じ形式: [tag, i1, i2, j1, j2]
  PC.opcodes = (a, b) => {
    const E = edits(a, b), res = [];
    let i = 0, j = 0, k = 0;
    while (k < E.length) {
      if (E[k][0] === '=') {
        const s = k; while (k < E.length && E[k][0] === '=') k++;
        res.push(['equal', i, i + k - s, j, j + k - s]); i += k - s; j += k - s;
      } else {
        let di = 0, dj = 0;
        while (k < E.length && E[k][0] !== '=') { if (E[k][0] === '-') di++; else dj++; k++; }
        res.push([di && dj ? 'replace' : (di ? 'delete' : 'insert'), i, i + di, j, j + dj]); i += di; j += dj;
      }
    }
    return res;
  };
  PC.pairs = (a, b) => {
    const out = [];
    for (const [t, i1, i2, j1] of PC.opcodes(a, b)) if (t === 'equal') for (let q = 0; q < i2 - i1; q++) out.push([i1 + q, j1 + q]);
    return out;
  };
})();
