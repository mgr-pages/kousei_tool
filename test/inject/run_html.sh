#!/bin/bash
# 直しを無作為に入れた模擬データ(条件を広げたもの: test/inject/make_html.py・render.js)を、3通りの照合の仕方で動かして採点する
#   bash test/inject/run_html.sh 出力フォルダ [種(seed)の数] [最初の種(既定は1)]
set -u
OUT=$1; N=${2:-5}; S0=${3:-1}
cd "$(dirname "$0")/../.." && python3 test/inject/make_html.py "$OUT" "$N" "$S0" > /dev/null && node test/inject/render.js "$OUT" > /dev/null
jobs=()
for v in $(seq "$S0" $((S0 + N - 1))); do
  D=$OUT/v$v
  jobs+=("OLD=$D/old.pdf node test/run.js - $D/new.pdf $D/old.json > $D/old.log 2>&1")
  jobs+=("node test/run.js $D/old.pdf $D/new.pdf $D/marks.json > $D/marks.log 2>&1")
  jobs+=("node test/run.js $D/genko.txt $D/new.pdf $D/text.json > $D/text.log 2>&1")
done
printf '%s\n' "${jobs[@]}" | xargs -P 4 -I{} bash -c '{}'
for m in old marks text; do python3 test/inject/evaluate.py "$OUT" $m; done
