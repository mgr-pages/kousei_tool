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
