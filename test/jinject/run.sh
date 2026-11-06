#!/bin/bash
# 価格・計算・番号の誤りを無作為に入れた模擬データを作り、成果物だけで照合して採点する
#   bash test/jinject/run.sh 出力フォルダ [種(seed)の数] [最初の種(既定は1)]
set -u
OUT=$1; N=${2:-20}; S0=${3:-1}
cd "$(dirname "$0")/../.." && python3 test/jinject/make.py "$OUT" "$N" "$S0" > /dev/null
jobs=()
for v in $(seq "$S0" $((S0 + N - 1))); do jobs+=("node test/run.js - $OUT/v$v/seika.pdf $OUT/v$v/seika.json > $OUT/v$v/seika.log 2>&1"); done
printf '%s\n' "${jobs[@]}" | xargs -P 4 -I{} bash -c '{}'
python3 test/jinject/evaluate.py "$OUT" --detail
