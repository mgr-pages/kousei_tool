#!/bin/bash
# 自動テスト一式: テストキットの修正後ダミー原稿と、模擬の赤字原稿(紙のスキャン8通り・注釈PDF1通り)をブラウザ版で照合し、正解表で採点する
#   あわせて、レイアウトが違う原稿(ラフ)と成果物の模擬データ(testdata/content)を照合し、test/content/gt.json で採点する
#   データファイルの原稿(Excel・Word など)の模擬データ(testdata/office)も照合し、test/office/gt.json で採点する
#   成果物だけで見るチェックは、testdata/jcheck を照合し、test/jcheck/gt.json で採点する
#   商品マスタ(Excel)の一部の列を載せたカタログと、ページの端の切れ端は、testdata/records を照合し、test/records/gt.json で採点する
#   数字の違い(1件ずつ・数字全体で出るか)と仕上がりの外のページ情報は、testdata/numtrim を照合し、test/numtrim/gt.json で採点する
#   bash test/suite.sh テストデータのフォルダ 正解表(gt.json) 採点スクリプト(evaluate.py) 出力フォルダ
set -u
DATA=$1; GT=$2; EVAL=$3; OUT=$4
cd "$(dirname "$0")/.." && mkdir -p "$OUT"
run() { node test/run.js "$1" "$2" "$OUT/$3.json" > "$OUT/$3.log" 2>&1; }
# ログの最後の行の先頭 n 文字(cut -c はバイトで数えるため、日本語の途中で切れる)
head1() { tail -1 "$1" | python3 -c "import sys; print(sys.stdin.read()[:$2].rstrip())"; }
# 紙は4つずつ同時に動かす(1つの照合はほぼ1コアしか使わないため)
for batch in "1 2 3 4" "5 6 7 8"; do
  for s in $batch; do run "$DATA/s$s/T1_scan.pdf" "$DATA/new.pdf" paper_s$s & done
  wait
done
S=$DATA/split
# 複数ファイル: 分割したPDFをばらばらの順で渡す(画面と同じく名前の順に並ぶ)。1ファイルのとき(s1・注釈)と同じ結果になるか
run "$DATA/T1_digital.pdf" "$DATA/new.pdf" digital &
run "$S/scan-2.pdf,$S/scan-1.pdf" "$S/new-b.pdf,$S/new-a.pdf" split_scan &
run "$S/digital-2.pdf,$S/digital-1.pdf" "$S/new-a.pdf,$S/new-b.pdf" split_digital &
# レイアウトが違う原稿(ラフ)と成果物(見開き): ページの対応と内容の照合(test/content/make.py で作った模擬データ)
run "$DATA/content/rough.pdf" "$DATA/content/final.pdf" content &
#   旧版(任意)も渡したとき: 原稿のない部分の旧版からの変化・前回のまま・旧版のまま(直っていない)の見分け
OLD="$DATA/content/old.pdf" run "$DATA/content/rough.pdf" "$DATA/content/final.pdf" content_old &
# データファイルの原稿(Excel・Word・PowerPoint・テキスト・CSV)と成果物PDF(test/office/make.py で作った模擬データ)
O=$DATA/office
run "$O/1_price.xlsx,$O/2_notice.docx,$O/3_set.pptx,$O/4_contact.txt,$O/5_shops.csv" "$O/final.pdf" office &
#   確認が厳しくなりやすい場合(test/office/variants.py): 「¥1,280」×「1,280円」、商品マスターの一部だけを載せた表
run "$O/variant_yen.xlsx" "$O/final.pdf" office_yen &
run "$O/variant_master.xlsx" "$O/final.pdf" office_master &
# 成果物だけで見るチェック(test/jcheck/make.py で作った模擬データ)
run "$DATA/jcheck/genko.txt" "$DATA/jcheck/seika.pdf" jcheck &
#   原稿なし(成果物だけ)でも同じ項目が出るか
run - "$DATA/jcheck/seika.pdf" jcheck_only &
# 書式の指示(太字・大きさ・色)を注釈で入れた原稿と成果物(test/layout/make.py で作った模擬データ)
run "$DATA/layout/genko.pdf" "$DATA/layout/seika.pdf" layout &
wait
# 一部の文字だけをアウトライン化した成果物と、注釈のない(スキャンでない)PDFの原稿(test/outline/make.py で作った模擬データ)
run "$DATA/outline/genko.pdf" "$DATA/outline/seika.pdf" outline_same &
run "$DATA/outline/genko.pdf" "$DATA/outline/seika_ng.pdf" outline_ng &
run "$DATA/outline/genko.pdf" "$DATA/outline/old.pdf" outline_plain &
#   レイアウトが違う原稿(テキスト)・旧版だけ(原稿なし)のとき: 文字データのない所を OCR で読んで照合する
run "$DATA/outline/genko.txt" "$DATA/outline/seika.pdf" outline_text_same &
run "$DATA/outline/genko.txt" "$DATA/outline/seika_ng.pdf" outline_text_ng &
OLD="$DATA/outline/old.pdf" run - "$DATA/outline/seika_ng.pdf" outline_old_ng &
# グラフを含むデータファイルの原稿(Excel・PowerPoint・Word)と、グラフを載せた成果物(test/charts/make.py で作った模擬データ)
run "$DATA/charts/chart.xlsx,$DATA/charts/chart.pptx,$DATA/charts/chart.docx" "$DATA/charts/final.pdf" charts &
# 商品マスタの一部の列を載せたカタログ・ページの端の切れ端(test/records/make.py で作った模擬データ)。ページの辞書を圧縮したPDFでも同じか
run "$DATA/records/master.xlsx" "$DATA/records/catalog.pdf" records &
run "$DATA/records/master.xlsx" "$DATA/records/catalog_objstm.pdf" records_objstm &
wait
# 数字(金額・時刻・日付)の違いと、仕上がり(トンボ)の外のページ情報(test/numtrim/make.py で作った模擬データ)。入れるファイルの組み合わせごとに
N=$DATA/numtrim
run - "$N/new.pdf" numtrim_new &
OLD="$N/old.pdf" run - "$N/new.pdf" numtrim_old &
run "$N/old.pdf" "$N/new.pdf" numtrim_marks &
run "$N/genko.txt" "$N/new.pdf" numtrim_text &
OLD="$N/old.pdf" run "$N/genko.txt" "$N/new.pdf" numtrim_all &
wait
for s in 1 2 3 4 5 6 7 8; do
  echo "紙 s$s: $(head1 "$OUT/paper_s$s.log" 60) | $(python3 "$EVAL" "$GT" "$OUT/paper_s$s.json" --csv "$OUT/paper_s$s.csv" | sed -n 1p)"
  python3 "$EVAL" "$GT" "$OUT/paper_s$s.json" | tail -n +2
done
echo "注釈PDF: $(head1 "$OUT/digital.log" 60) | $(python3 "$EVAL" "$GT" "$OUT/digital.json" --digital --csv "$OUT/digital.csv" | sed -n 1p)"
python3 "$EVAL" "$GT" "$OUT/digital.json" --digital | tail -n +2
same() { python3 -c "import json,sys; a,b=(json.load(open(f)) for f in sys.argv[1:3]); print('一致' if a==b else '差あり（%d件と%d件）' % (len(a), len(b)))" "$1" "$2" 2>&1; }
echo "レイアウト違い: $(head1 "$OUT/content.log" 40) | $(python3 test/content/evaluate.py test/content/gt.json "$OUT/content.json" | sed -n 1p)"
python3 test/content/evaluate.py test/content/gt.json "$OUT/content.json" | tail -n +2
echo "レイアウト違い＋旧版: $(head1 "$OUT/content_old.log" 40) | $(python3 test/content/evaluate.py test/content/gt_old.json "$OUT/content_old.json" | sed -n 1p)"
python3 test/content/evaluate.py test/content/gt_old.json "$OUT/content_old.json" | tail -n +2
echo "データ原稿: $(head1 "$OUT/office.log" 40) | $(python3 test/office/evaluate.py test/office/gt.json "$OUT/office.json" | sed -n 1p)"
python3 test/office/evaluate.py test/office/gt.json "$OUT/office.json" | tail -n +2
for k in yen master; do echo "データ原稿（$k）: $(python3 test/office/variants.py check $k "$OUT/office_$k.json")"; done
echo "成果物だけのチェック: $(head1 "$OUT/jcheck.log" 30) | $(python3 test/jcheck/evaluate.py test/jcheck/gt.json "$OUT/jcheck.json" | sed -n 1p)"
python3 test/jcheck/evaluate.py test/jcheck/gt.json "$OUT/jcheck.json" | tail -n +2
echo "成果物だけのチェック（原稿なし）: $(head1 "$OUT/jcheck_only.log" 30) | $(python3 test/jcheck/evaluate.py test/jcheck/gt.json "$OUT/jcheck_only.json" | sed -n 1p)"
python3 test/jcheck/evaluate.py test/jcheck/gt.json "$OUT/jcheck_only.json" | tail -n +2
echo "書式の指示: $(head1 "$OUT/layout.log" 30) | $(python3 test/layout/evaluate.py test/layout/gt.json "$OUT/layout.json" | sed -n 1p)"
python3 test/layout/evaluate.py test/layout/gt.json "$OUT/layout.json" | tail -n +2
for k in same ng plain text_same text_ng old_ng; do nn=$([ "${k%_ng}" != "$k" ] && [ "$k" != ng ] && echo --need-new); echo "アウトライン（$k）: $(head1 "$OUT/outline_$k.log" 24) | $(python3 test/outline/evaluate.py test/outline/gt.json $k "$OUT/outline_$k.json" $nn | sed -n 1p)"; python3 test/outline/evaluate.py test/outline/gt.json $k "$OUT/outline_$k.json" $nn | tail -n +2; done
echo "グラフ: $(head1 "$OUT/charts.log" 24) | $(python3 test/charts/evaluate.py test/charts/gt.json "$OUT/charts.json" | sed -n 1p)"; python3 test/charts/evaluate.py test/charts/gt.json "$OUT/charts.json" | tail -n +2
echo "複数ファイル（紙）: 1ファイルのときと$(same "$OUT/split_scan.json" "$OUT/paper_s1.json")"
echo "複数ファイル（注釈）: 1ファイルのときと$(same "$OUT/split_digital.json" "$OUT/digital.json")"
echo "表の商品ごとの照合: $(head1 "$OUT/records.log" 30) | $(python3 test/records/evaluate.py test/records/gt.json "$OUT/records.json" | sed -n 1p)"
python3 test/records/evaluate.py test/records/gt.json "$OUT/records.json" | tail -n +2
for k in new old marks text all; do echo "数字とページ情報（$k）: $(head1 "$OUT/numtrim_$k.log" 24) | $(python3 test/numtrim/evaluate.py test/numtrim/gt.json $k "$OUT/numtrim_$k.json" | sed -n 1p)"; python3 test/numtrim/evaluate.py test/numtrim/gt.json $k "$OUT/numtrim_$k.json" | tail -n +2; done
echo "表の商品ごとの照合（圧縮したPDF）: $(python3 test/records/evaluate.py test/records/gt.json "$OUT/records_objstm.json" | sed -n 1p)"
