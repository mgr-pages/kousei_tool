#!/bin/bash
# 直しを無作為に入れた模擬データ(test/inject/make.py)を、3通りの照合の仕方で動かして採点する
#   bash test/inject/run.sh 出力フォルダ [種(seed)の数] [最初の種(既定は1)]
#   old: 旧版＋成果物 / marks: 同じレイアウトのPDF原稿(注釈なし)＋成果物 / text: テキストの原稿＋成果物
set -u
OUT=$1; N=${2:-5}; S0=${3:-1}
cd "$(dirname "$0")/../.." && python3 test/inject/make.py "$OUT" "$N" "$S0" > /dev/null
jobs=()
for v in $(seq "$S0" $((S0 + N - 1))); do
  D=$OUT/v$v
  jobs+=("OLD=$D/old.pdf node test/run.js - $D/new.pdf $D/old.json > $D/old.log 2>&1")
  jobs+=("node test/run.js $D/old.pdf $D/new.pdf $D/marks.json > $D/marks.log 2>&1")
  jobs+=("node test/run.js $D/genko.txt $D/new.pdf $D/text.json > $D/text.log 2>&1")
done
printf '%s\n' "${jobs[@]}" | xargs -P 4 -I{} bash -c '{}'
for m in old marks text; do python3 test/inject/evaluate.py "$OUT" $m; done
