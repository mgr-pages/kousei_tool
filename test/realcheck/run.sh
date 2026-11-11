#!/bin/bash
# 実物のPDFで、照合の汎用性を確かめる(正解を人が決めなくてよい試験)。入れたPDFと出力はリポジトリに入れない
#   bash test/realcheck/run.sh 出力フォルダ 種 [1ページの誤りの数] PDF[:ページ範囲]...
#   例: bash test/realcheck/run.sh out/realcheck 1 12 手元の成果物.pdf カタログ.pdf:1-4
#   PDFごとに、次の4通りを照合して採点する(test/realcheck/evaluate.py):
#     same   同じファイルどうし(項目が0件になるはず)
#     old    旧版＋成果物(誤りを入れた版)
#     marks  注釈のないPDF原稿＋成果物
#     annot  注釈で指示を入れた原稿＋成果物
#   同時に動かす数は環境変数 JOBS(既定 3)
set -u
OUT=$1; SEED=$2; PER=${3:-12}; shift 3
cd "$(dirname "$0")/../.." && mkdir -p "$OUT"
JOBS=${JOBS:-3}
k=0; DIRS=()
for spec in "$@"; do
  k=$((k + 1)); src=${spec%%:*}; pages=""; [ "$spec" != "$src" ] && pages="--pages ${spec##*:}"
  d="$OUT/f$k"; DIRS+=("$d")
  python3 -I test/realcheck/mutate.py "$src" "$d" --seed "$SEED" --per-page "$PER" $pages > "$d.make.log" 2>&1 || { echo "作れません: f$k"; cat "$d.make.log"; }
done
n=0
for d in "${DIRS[@]}"; do
  [ -f "$d/truth.json" ] || continue
  A=$(cd "$d" && pwd)
  for job in "same|$A/base.pdf|$A/base.pdf|" "old|-|$A/new.pdf|OLD=$A/base.pdf" "marks|$A/base.pdf|$A/new.pdf|" "annot|$A/genko.pdf|$A/new.pdf|"; do
    IFS='|' read -r mode marks new env <<< "$job"
    ( eval "$env node test/run.js \"$marks\" \"$new\" \"$A/$mode.json\"" > "$A/$mode.log" 2>&1 ) &
    n=$((n + 1)); [ $((n % JOBS)) -eq 0 ] && wait
  done
done
wait
python3 test/realcheck/evaluate.py "${DIRS[@]}" ${DETAIL:+--detail}
