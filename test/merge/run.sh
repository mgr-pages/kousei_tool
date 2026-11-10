#!/bin/bash
# 差し込み印刷(名刺)の模擬データに誤りを無作為に入れ、照合して採点する
#   bash test/merge/run.sh 出力フォルダ [種(seed)の数] [最初の種(既定は1)] [--more(別の種類の誤り。test/merge/make.py を参照)]
#   MAKE=test/merge/make_id.py bash test/merge/run.sh …  … 2つ目の作り(社員証)の模擬データで同じことをする
set -u
OUT=$1; N=${2:-20}; S0=${3:-1}; MORE=${4:-}; MAKE=${MAKE:-test/merge/make.py}
cd "$(dirname "$0")/../.." && python3 "$MAKE" "$OUT" "$N" "$S0" $MORE > /dev/null
jobs=()
for v in $(seq "$S0" $((S0 + N - 1))); do x=$(ls "$OUT/v$v/"*.xlsx | head -1); jobs+=("node test/run.js $x $OUT/v$v/seika.pdf $OUT/v$v/seika.json > $OUT/v$v/seika.log 2>&1"); done
printf '%s\n' "${jobs[@]}" | xargs -P 4 -I{} bash -c '{}'
python3 test/merge/evaluate.py "$OUT" --detail
