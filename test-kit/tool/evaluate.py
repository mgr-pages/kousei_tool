# 採点: ツールの判定結果(findings.json)を正解表(gt.json)と突き合わせる
#   python3 evaluate.py gt.json 結果フォルダ/findings.json [--digital] [--rules-given]
import sys, json, csv, argparse

ov = lambda a, b, m=8: a[0]-m < b[2] and b[0]-m < a[2] and a[1]-m < b[3] and b[1]-m < a[3]
EXPECT = {'A': '赤字どおりに変更あり', 'B': '修正漏れの疑い', 'C1': '全体指示・以下同様で説明', 'D': '展開漏れ', 'C': '指示外の変更',
          'E': '見た目で差が出ない差し替え', 'G': '全体指示の読み取り', 'L': '改行など組みの変更', 'M': 'ママ（変更なしが正しい）', 'N': '指示ではない書き込み'}

def judge(g, F, digital, rules_given):
    hits = [f for f in F if f['page'] == g['page'] and any(ov(b, f['box']) for b in g['boxes'])]
    cats = {f['cat'] for f in hits}; e = g['expected']
    if e == 'A':
        if cats & {'A', 'A_IMG'}:
            f = next(f for f in hits if f['cat'] in ('A', 'A_IMG'))
            if g['result'] == 'wrong':
                if digital: return ('合格' if '見当たらない' in f['check'] else '不合格（内容違いを見逃し）'), '違う内容で反映。デジタルは指示文との自動照合で検出できるか'
                return '合格（内容は人が確認）', '違う内容で反映。紙は中身を人が確認する前提'
            return '合格', ''
        return ('不合格（指示を読み取れず）' if cats & {'C2', 'C3'} else '不合格'), '検出: ' + ','.join(sorted(cats))
    if e == 'B': return ('合格' if 'B' in cats else ('一部（軽い指摘のみ）' if 'B2' in cats else '不合格（重大）')), '検出: ' + ','.join(sorted(cats))
    if e == 'C1':
        if 'C1' in cats: return '合格', ''
        if 'C2' in cats: return '要確認として表示（全体指示が未登録なら妥当）', '検出: C2'
        return '不合格', '検出: ' + ','.join(sorted(cats))
    if e == 'D': return ('合格' if any(f['cat'] == 'D' and ('漏れ' in f['check'] or '未統一' in f['check']) for f in hits) else '不合格（重大）'), ''
    if e == 'C':
        if cats & {'C2', 'C3', 'E'} and not cats & {'A', 'A_IMG', 'C1'}: return '合格', ''
        if cats & {'A', 'A_IMG', 'C1'}: return '不合格（重大：指示どおり扱い）', '検出: ' + ','.join(sorted(cats))
        return '不合格（重大：見逃し）', ''
    if e == 'E': return ('合格' if cats & {'E', 'C2', 'C3'} else '不合格（重大）'), '検出: ' + ','.join(sorted(cats))
    if e == 'G':
        if digital: return ('合格' if any(f['cat'] == 'G' and f['page'] == g['page'] for f in F) else '不合格'), ''
        return '対象外（紙は校正者が画面で登録）' if rules_given else '対象外', ''
    if e == 'L': return ('合格' if cats & {'A'} else '不合格（既知の限界）'), '検出: ' + ','.join(sorted(cats))
    if e == 'M': return ('合格' if 'B' not in cats else '不合格（既知の限界：修正漏れと誤表示）'), ''
    if e == 'N': return ('合格' if not cats & {'A', 'B', 'B2', 'A_IMG'} else '不合格'), '検出: ' + ','.join(sorted(cats))
    return '？', ''

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('gt'); ap.add_argument('findings'); ap.add_argument('--digital', action='store_true')
    ap.add_argument('--rules-given', action='store_true'); ap.add_argument('--csv')
    a = ap.parse_args(); G = json.load(open(a.gt)); F = json.load(open(a.findings))
    rows = []
    for g in G:
        res, note = judge(g, F, a.digital, a.rules_given)
        rows.append([g['id'], g['page'], g['expected'], EXPECT[g['expected']], res, note, g['instruction'] or g['where']])
    # 正解表のどれにも当たらない指摘 = 誤検出
    fa = [f for f in F if f['cat'] in ('A', 'A_IMG', 'B', 'C2', 'C3', 'E') and not any(f['page'] == g['page'] and any(ov(b, f['box']) for b in g['boxes']) for g in G)]
    if a.csv:
        with open(a.csv, 'w', encoding='utf-8-sig', newline='') as fp:
            w = csv.writer(fp); w.writerow(['No.', '頁', '期待', '期待の意味', '結果', '補足', '内容'])
            w.writerows(rows); w.writerow([]); w.writerow(['誤検出（正解表にない指摘）'])
            for f in fa: w.writerow(['', f['page'], f['cat'], f['label'], f['show'], f['how'], str(f['box'])])
    ok = lambda r: r[4].startswith('合格') or r[4].startswith('要確認') or r[4].startswith('対象外')
    crit = [r for r in rows if '重大' in r[4]]; lim = [r for r in rows if '既知の限界' in r[4]]
    print(f"判定 {len(rows)}件中 合格{sum(1 for r in rows if ok(r))}件 / 重大な見逃し{len(crit)}件 / 既知の限界{len(lim)}件 / 誤検出{len(fa)}件 / 人が読む赤字(F){sum(1 for f in F if f['cat'] == 'F')}件")
    for r in rows:
        if not ok(r): print('  ', r[0], f"p{r[1]}", r[4], r[5], '|', r[6][:40])
    for f in fa: print('   誤検出', f"p{f['page']}", f['cat'], f['show'], f['box'])

if __name__ == '__main__': main()
