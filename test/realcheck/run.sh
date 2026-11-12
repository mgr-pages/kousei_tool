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
#   環境変数 MODES="same marks" で、照合の仕方をしぼる(既定は4通りすべて)
#   環境変数 REUSE=1 で、出力フォルダに前に作った誤り(truth.json)があれば作り直さずに使う。DETAIL=1 で見逃し・余分な検出を1件ずつ出す
set -u
OUT=$1; SEED=$2; PER=${3:-12}; shift 3
cd "$(dirname "$0")/../.." && mkdir -p "$OUT"
JOBS=${JOBS:-3}
k=0; DIRS=()
for spec in "$@"; do
  k=$((k + 1)); src=${spec%%:*}; pages=""; [ "$spec" != "$src" ] && pages="--pages ${spec##*:}"
  d="$OUT/f$k"; DIRS+=("$d")
  #   REUSE=1: 出力フォルダに前に作ったもの(truth.json)があれば、作り直さずに使う(直す前とあとを同じ誤りで比べるとき)
  if [ -n "${REUSE:-}" ] && [ -f "$d/truth.json" ]; then continue; fi
  python3 -I test/realcheck/mutate.py "$src" "$d" --seed "$SEED" --per-page "$PER" $pages > "$d.make.log" 2>&1 || { echo "作れません: f$k"; cat "$d.make.log"; }
done
n=0
for d in "${DIRS[@]}"; do
  [ -f "$d/truth.json" ] || continue
  A=$(cd "$d" && pwd)
  for job in "same|$A/base.pdf|$A/base.pdf|" "old|-|$A/new.pdf|OLD=$A/base.pdf" "marks|$A/base.pdf|$A/new.pdf|" "annot|$A/genko.pdf|$A/new.pdf|"; do
    IFS='|' read -r mode marks new env <<< "$job"
    case " ${MODES:-same old marks annot} " in *" $mode "*) ;; *) continue;; esac   # MODES="same marks" のように、照合の仕方をしぼれる
    ( eval "$env node test/run.js \"$marks\" \"$new\" \"$A/$mode.json\"" > "$A/$mode.log" 2>&1 ) &
    n=$((n + 1)); [ $((n % JOBS)) -eq 0 ] && wait
  done
done
wait
python3 test/realcheck/evaluate.py "${DIRS[@]}" ${DETAIL:+--detail}
