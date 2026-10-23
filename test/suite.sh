#!/bin/bash
# 自動テスト一式: テストキットのダミー原稿と模擬朱書き(紙8通り・デジタル1通り)をブラウザ版で照合し、正解表で採点する
#   bash test/suite.sh テストデータのフォルダ 正解表(gt.json) 採点スクリプト(evaluate.py) 出力フォルダ
set -u
DATA=$1; GT=$2; EVAL=$3; OUT=$4
cd "$(dirname "$0")/.." && mkdir -p "$OUT"
echo '[{"frm": "お問い合わせ", "to": "お問合せ"}]' > "$OUT/rules.json"
for s in 1 2 3 4 5 6 7 8; do
  node test/run.js "$DATA/old.pdf" "$DATA/new.pdf" scan "$DATA/s$s/T1_scan.pdf" "$OUT/paper_s$s.json" "$OUT/rules.json" > "$OUT/paper_s$s.log" 2>&1
  echo "紙 s$s: $(tail -1 "$OUT/paper_s$s.log" | cut -c1-40) | $(python3 "$EVAL" "$GT" "$OUT/paper_s$s.json" --rules-given --csv "$OUT/paper_s$s.csv" | head -1)"
  python3 "$EVAL" "$GT" "$OUT/paper_s$s.json" --rules-given | tail -n +2
done
node test/run.js "$DATA/old.pdf" "$DATA/new.pdf" digital "$DATA/T1_digital.pdf" "$OUT/digital.json" > "$OUT/digital.log" 2>&1
echo "デジタル: $(tail -1 "$OUT/digital.log" | cut -c1-40) | $(python3 "$EVAL" "$GT" "$OUT/digital.json" --digital --csv "$OUT/digital.csv" | head -1)"
python3 "$EVAL" "$GT" "$OUT/digital.json" --digital | tail -n +2
# 複数ファイル: 分割したPDFをばらばらの順で渡し、名前の順につなげた結果が1ファイルのとき(s1・デジタル)と完全に同じになるか
S=$DATA/split
node test/run.js $S/old-11.pdf,$S/old-9.pdf,$S/old-12.pdf,$S/old-10.pdf $S/new-b.pdf,$S/new-a.pdf scan $S/scan-2.pdf,$S/scan-1.pdf "$OUT/split_scan.json" "$OUT/rules.json" > "$OUT/split_scan.log" 2>&1
node test/run.js $S/old-12.pdf,$S/old-10.pdf,$S/old-9.pdf,$S/old-11.pdf $S/new-a.pdf,$S/new-b.pdf digital $S/digital-2.pdf,$S/digital-1.pdf "$OUT/split_digital.json" > "$OUT/split_digital.log" 2>&1
same() { python3 -c "import json,sys; a,b=(json.load(open(f)) for f in sys.argv[1:3]); print('一致' if a==b else '差あり（%d件と%d件）' % (len(a), len(b)))" "$1" "$2" 2>&1; }
echo "複数ファイル（紙）: 1ファイルのときと$(same "$OUT/split_scan.json" "$OUT/paper_s1.json")"
echo "複数ファイル（注釈）: 1ファイルのときと$(same "$OUT/split_digital.json" "$OUT/digital.json")"
