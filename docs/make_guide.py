# 利用ガイド（docs/利用ガイド.pdf）を作り直す
#   python3 docs/make_guide.py [フォントのフォルダ]
# 必要なもの: Node.js と playwright（npm install --no-save playwright && npx playwright install chromium）、
#   Noto Sans JP（cd test-kit/src && npm ci で test-kit/src/node_modules/@fontsource に入る）
# 画面写真は docs/画面例.png。画面を変えたら撮り直して差し替える
import base64, subprocess, sys
from pathlib import Path

DOCS = Path(__file__).resolve().parent
ROOT = DOCS.parent
FONTS = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'test-kit/src/node_modules/@fontsource'
if not (FONTS / 'noto-sans-jp/400.css').exists(): sys.exit(f'フォントが見つかりません: {FONTS}')
shot = base64.b64encode(open(DOCS / '画面例.png', 'rb').read()).decode()
F = FONTS.resolve().as_uri()
CAT = [('#d1343b', '修正漏れの疑い', '赤字があるのに変わっていない。左右の切り抜きを見比べ、直っていなければ「要修正」。「続きの赤字（軽）」は、行の折り返しで続く取り消し線などです。'),
       ('#d9730d', '指示外の変更', '赤字がないのに変わっている。意図した変更か、確認してください（文字・組み・画像・図版・色・位置）。'),
       ('#9b3fa0', '展開漏れ', '全体指示・以下同様が反映されていない箇所。「同じ語が他に（以下同様？）」は、赤字の語と同じ語が他にも残っている箇所です。'),
       ('#1c7ed6', '文字データだけの差し替え', '見た目ではほぼ同じだが、文字が違う（長音「ー」→漢数字「一」など）。'),
       ('#1f8f4e', '赤字どおり変更あり', '赤字の箇所が変わっている。中身が指示どおりかを確認。PDFの注釈なら指示文と自動で照合し、「見当たらない」と出たものは要確認です。'),
       ('#6b7280', '指示箇所に結びつかない赤字', '欄外の注記・印鑑など。読んで、指示であれば該当箇所を確認してください。'),
       ('#8a8600', '全体指示・以下同様で説明できる変更', '赤字の箇所ではないが、全体指示・以下同様として説明がつく変更。')]
cats = ''.join(f'<tr><td><span class="sw" style="background:{c}"></span>{a}</td><td>{b}</td></tr>' for c, a, b in CAT)
html = f'''<!doctype html><html lang="ja"><meta charset="utf-8"><style>
@import url("{F}/noto-sans-jp/400.css"); @import url("{F}/noto-sans-jp/700.css");
@page {{ size: A4; margin: 14mm }} body {{ font-family: "Noto Sans JP"; font-size: 9.5pt; color: #222; line-height: 1.65 }}
h1 {{ font-size: 17pt; margin: 0 }} .sub {{ color: #555; margin: 1mm 0 4mm }}
h2 {{ font-size: 11.5pt; margin: 5mm 0 2mm; border-left: 1.2mm solid #0b6bcb; padding-left: 2mm; break-after: avoid }}
table {{ border-collapse: collapse; width: 100% }} td, th {{ border: 0.3mm solid #bbb; padding: 1.2mm 2mm; vertical-align: top }}
th {{ background: #eef4fb }} td:first-child {{ white-space: nowrap; font-weight: 700 }}
.sw {{ display: inline-block; width: 3mm; height: 3mm; border-radius: 0.6mm; margin-right: 1.5mm; vertical-align: -0.3mm }}
.box {{ border: 0.4mm solid #0b6bcb; background: #f3f8fe; padding: 2.5mm 4mm; border-radius: 1.5mm }}
.warn {{ border: 0.4mm solid #c77700; background: #fff7ea; padding: 2.5mm 4mm; border-radius: 1.5mm }}
ol, ul {{ margin: 1mm 0; padding-left: 6mm }} img {{ width: 100%; border: 0.3mm solid #bbb; border-radius: 1mm }} .cap {{ font-size: 8pt; color: #666; text-align: center }}
.pb {{ break-before: page }} table, .warn, .fig {{ break-inside: avoid }} li {{ break-inside: avoid }}
</style><body>
<h1>朱書き照合ツール　利用ガイド</h1>
<div class="sub">初校・朱書き・修正後を照合し、確認が必要な箇所を一覧にします</div>
<div class="box">Google Chrome または Microsoft Edge で、次のどちらかを開くだけで使えます（インストール不要）。<br>・Web：<b>https://mgr-pages.github.io/kousei_tool/</b><br>・ファイル：「朱書き照合ツール.html」をダブルクリック（インターネット接続も不要）<br>どちらの場合も、選んだPDFは<b>このパソコンのブラウザの中だけで処理され、外部には送信されません</b>。</div>

<h2>1. 用意するもの</h2>
<table><tr><th>もの</th><th>注意</th></tr>
<tr><td>初校PDF</td><td>朱書きする前のデータ（校正紙として印刷したPDF）</td></tr>
<tr><td>修正後PDF</td><td>赤字を反映したPDF。初校と同じページ順・同じ書き出し設定にしてください（書体の版や出力設定が違うと、全体が変更として出ます）</td></tr>
<tr><td>朱書き（紙）</td><td>朱書きした校正紙を<b>カラー・300dpi</b>でスキャンしたPDF（または画像）。ページ順は初校と同じに</td></tr>
<tr><td>朱書き（PDF）</td><td>Acrobatなどで初校PDFに<b>注釈</b>で朱入れしたPDF（取り消し線・テキストの挿入・置換・手書き・コメント）</td></tr></table>

<h2>2. 手順</h2>
<ol>
<li>①初校PDF、②修正後PDFを選ぶ。</li>
<li>③朱書きの種類（紙のスキャン／PDFへの注釈／なし）を選び、ファイルを選ぶ。</li>
<li>紙の朱書きに「全体的に〜に統一」がある場合は、④全体指示に「変更前 → 変更後」を登録する（手書きの文字は読めないため）。</li>
<li>「照合を開始」を押す。4ページで20〜40秒ほどかかります（パソコンの性能によります）。</li>
<li>確認が必要な順に一覧が出ます。各項目の左右の切り抜き（初校＋朱書き／修正後）を見比べ、<b>OK・要修正・保留</b>とメモを付けます。項目を押すと右側にページ全体が表示され、ページ上の枠を押すと該当する項目に移ります。</li>
<li>「CSVで保存」「印刷・PDFで保存」で結果を残します。確認の状態は、同じファイルを開き直したときに復元されます（このパソコンのブラウザに保存）。</li>
</ol>
<div class="fig"><img src="data:image/png;base64,{shot}"><div class="cap">照合後の画面（上：ファイルの指定と結果の概要／下左：確認が必要な項目と切り抜き、下右：ページ全体）<br>※ ボタンの表記はブラウザの言語設定によって「ファイルを選択」などになります</div></div>

<h2>3. 判定の見方（上から順に確認してください）</h2>
<table>{cats}</table>

<h2>4. 精度を上げる朱書き・スキャンのコツ</h2>
<ul>
<li><b>引き出し線は行間や欄外を通す</b>。文字の行の真ん中を、行に沿って通すと、取り消し線と見分けられないことがあります。</li>
<li>挿入は<b>くさび（∧ や ∨）</b>で、文字と文字の間をはっきり示す。</li>
<li>欄外の赤字が本文の文字に重ならないようにする。</li>
<li>鉛筆の疑問出しは対象外です（赤だけを読みます）。朱肉の印鑑は、本文から離れた余白に押してください。</li>
<li>スキャンは<b>カラー・300dpi</b>。「白紙除去」「文字くっきり」などの自動補正は、できれば切る。少しの傾きやずれは自動で補正します。</li>
<li>PDFへの注釈で朱入れすると、指示文（コメント）との自動照合ができ、精度も上がります。全体指示は「全体的に「A」→「B」」、以下同様はコメントに「以下同様」と書くと自動で読み取ります。</li>
</ul>

<h2>5. 注意（できないこと）</h2>
<div class="warn">
<ul>
<li>このツールは<b>見落としを減らすための補助</b>です。<b>判定が出ないことは「問題がない」ことの保証ではありません</b>。最終確認は必ず人が行ってください。</li>
<li>紙の手書きの指示文（何に直すか）は読めません。「赤字どおり変更あり」の中身は人が確認してください。</li>
<li>紙の「ママ」「イキ」は読めないため、「修正漏れの疑い」と出ます。</li>
<li>見た目ではほぼ同じ差し替え（「ー」と「一」など）は、PDFの文字データで検出します。文字をアウトライン化したPDFでは検出できません。</li>
<li>赤い写真や赤い背景の上の赤字は、読み取りにくいことがあります。</li>
</ul></div>

<h2>6. 困ったとき</h2>
<table><tr><th>症状</th><th>対処</th></tr>
<tr><td>処理が終わらない・重い</td><td>ページ数が多いと時間がかかります。数十ページ以上は、分けて照合してください。</td></tr>
<tr><td>ページ数が違うと出る</td><td>同じページ番号どうしを比べます。初校・修正後・スキャンのページ順をそろえてください。</td></tr>
<tr><td>赤字がほとんど読まれない</td><td>スキャンがカラーになっているか、赤ペンの色が薄すぎないかを確認してください。</td></tr>
<tr><td>全体が「指示外の変更」になる</td><td>初校と修正後で、書体の版・書き出し設定・ページの大きさが違う可能性があります。同じ設定で書き出してください。</td></tr>
</table>
</body></html>'''
html_path = DOCS / 'guide.html'
html_path.write_text(html, encoding='utf-8')
try:
    subprocess.run(['node', str(ROOT / 'test-kit/src/htmltopdf.js'), str(html_path), str(DOCS / '利用ガイド.pdf')], check=True)
finally:
    html_path.unlink()
print(DOCS / '利用ガイド.pdf')
