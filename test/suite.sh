#!/bin/bash
# 自動テスト一式: テストキットの修正後ダミー原稿と、模擬の赤字原稿(紙のスキャン8通り・注釈PDF1通り)をブラウザ版で照合し、正解表で採点する
#   あわせて、レイアウトが違う原稿(ラフ)と成果物の模擬データ(testdata/content)を照合し、test/content/gt.json で採点する
#   データファイルの原稿(Excel・Word など)の模擬データ(testdata/office)も照合し、test/office/gt.json で採点する
#   成果物だけで見るチェックは、testdata/jcheck を照合し、test/jcheck/gt.json で採点する
#   商品マスタ(Excel)の一部の列を載せたカタログと、ページの端の切れ端は、testdata/records を照合し、test/records/gt.json で採点する
#   bash test/suite.sh テストデータのフォルダ 正解表(gt.json) 採点スクリプト(evaluate.py) 出力フォルダ
set -u
DATA=$1; GT=$2; EVAL=$3; OUT=$4
cd "$(dirname "$0")/.." && mkdir -p "$OUT"
run() { node test/run.js "$1" "$2" "$OUT/$3.json" > "$OUT/$3.log" 2>&1; }
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
# 書式の指示(太字・大きさ・色)を注釈で入れた原稿と成果物(test/layout/make.py で作った模擬データ)
run "$DATA/layout/genko.pdf" "$DATA/layout/seika.pdf" layout &
wait
# 商品マスタの一部の列を載せたカタログ・ページの端の切れ端(test/records/make.py で作った模擬データ)。ページの辞書を圧縮したPDFでも同じか
run "$DATA/records/master.xlsx" "$DATA/records/catalog.pdf" records &
run "$DATA/records/master.xlsx" "$DATA/records/catalog_objstm.pdf" records_objstm &
wait
for s in 1 2 3 4 5 6 7 8; do
  echo "紙 s$s: $(tail -1 "$OUT/paper_s$s.log" | cut -c1-60) | $(python3 "$EVAL" "$GT" "$OUT/paper_s$s.json" --csv "$OUT/paper_s$s.csv" | sed -n 1p)"
  python3 "$EVAL" "$GT" "$OUT/paper_s$s.json" | tail -n +2
done
echo "注釈PDF: $(tail -1 "$OUT/digital.log" | cut -c1-60) | $(python3 "$EVAL" "$GT" "$OUT/digital.json" --digital --csv "$OUT/digital.csv" | sed -n 1p)"
python3 "$EVAL" "$GT" "$OUT/digital.json" --digital | tail -n +2
same() { python3 -c "import json,sys; a,b=(json.load(open(f)) for f in sys.argv[1:3]); print('一致' if a==b else '差あり（%d件と%d件）' % (len(a), len(b)))" "$1" "$2" 2>&1; }
echo "レイアウト違い: $(tail -1 "$OUT/content.log" | cut -c1-40) | $(python3 test/content/evaluate.py test/content/gt.json "$OUT/content.json" | sed -n 1p)"
python3 test/content/evaluate.py test/content/gt.json "$OUT/content.json" | tail -n +2
echo "レイアウト違い＋旧版: $(tail -1 "$OUT/content_old.log" | cut -c1-40) | $(python3 test/content/evaluate.py test/content/gt_old.json "$OUT/content_old.json" | sed -n 1p)"
python3 test/content/evaluate.py test/content/gt_old.json "$OUT/content_old.json" | tail -n +2
echo "データ原稿: $(tail -1 "$OUT/office.log" | cut -c1-40) | $(python3 test/office/evaluate.py test/office/gt.json "$OUT/office.json" | sed -n 1p)"
python3 test/office/evaluate.py test/office/gt.json "$OUT/office.json" | tail -n +2
for k in yen master; do echo "データ原稿（$k）: $(python3 test/office/variants.py check $k "$OUT/office_$k.json")"; done
echo "成果物だけのチェック: $(tail -1 "$OUT/jcheck.log" | cut -c1-30) | $(python3 test/jcheck/evaluate.py test/jcheck/gt.json "$OUT/jcheck.json" | sed -n 1p)"
python3 test/jcheck/evaluate.py test/jcheck/gt.json "$OUT/jcheck.json" | tail -n +2
echo "書式の指示: $(tail -1 "$OUT/layout.log" | cut -c1-30) | $(python3 test/layout/evaluate.py test/layout/gt.json "$OUT/layout.json" | sed -n 1p)"
python3 test/layout/evaluate.py test/layout/gt.json "$OUT/layout.json" | tail -n +2
echo "複数ファイル（紙）: 1ファイルのときと$(same "$OUT/split_scan.json" "$OUT/paper_s1.json")"
echo "複数ファイル（注釈）: 1ファイルのときと$(same "$OUT/split_digital.json" "$OUT/digital.json")"
echo "表の商品ごとの照合: $(tail -1 "$OUT/records.log" | cut -c1-30) | $(python3 test/records/evaluate.py test/records/gt.json "$OUT/records.json" | sed -n 1p)"
python3 test/records/evaluate.py test/records/gt.json "$OUT/records.json" | tail -n +2
echo "表の商品ごとの照合（圧縮したPDF）: $(python3 test/records/evaluate.py test/records/gt.json "$OUT/records_objstm.json" | sed -n 1p)"
