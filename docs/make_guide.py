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
CAT = [('#d1343b', '指示どおりになっていない', '指示（コメント・書き込み）の文字が成果物に見当たらない、消す指示の文字が残っている（自動で判定）'),
       ('#d1343b', '直っていない', '赤字があるのに、成果物で変わっていない'),
       ('#d9730d', '指示にない変更', '赤字がないのに、成果物で変わっている（文字・改行・画像・色・位置）'),
       ('#d9730d', '原稿と違う', 'レイアウトが違うページ・データの原稿（Excel など）で、原稿と文字が違う・原稿の文字がない・原稿にない文字がある'),
       ('#9b3fa0', '直し忘れ', '全体指示・以下同様で直すはずの語が、成果物に残っている'),
       ('#1c7ed6', '文字だけ違う', '見た目は同じでも文字が違う（長音「ー」と漢数字「一」など）'),
       ('#1f8f4e', '赤字どおり変わった', '赤字の箇所が変わっている。中身が指示どおりかを確認'),
       ('#1f8f4e', '指示・書き込みの確認（人が判断）', '文字では判定できない原稿のコメント・指示（後送・使う画像・書式・配置など）と、成果物に残っているアタリ・未支給・質問'),
       ('#6b7280', '読み取れない赤字', 'どの文字への指示か読み取れなかった赤字（欄外の注記など）'),
       ('#8a8600', '全体・以下同様どおり', '赤字のない箇所だが、全体指示・以下同様として変わっている'),
       ('#0f7b8a', '日本語の誤り', '成果物だけで見て誤りの可能性が高いもの（日付と曜日の食い違い・かっこの閉じ忘れ・「をを」などの重なり・よくある誤用・電話番号の桁）'),
       ('#5b7cba', '全角・半角などの違い', '書き方だけが原稿と違う（全角・半角、記号の形など）'),
       ('#0f7b8a', '日本語の確認', '成果物の中の表記ゆれ（「問い合わせ」と「問合せ」など）・ら抜き言葉・二重敬語・重複表現・半角カナ'),
       ('#8a8f99', '原稿が画像の部分', '原稿が画像のため、文字では比べていない部分（成果物の文字を添えて示す。目で確認）')]
cats = ''.join(f'<tr><td><span class="sw" style="background:{c}"></span>{a}</td><td>{b}</td></tr>' for c, a, b in CAT)
html = f'''<!doctype html><html lang="ja"><meta charset="utf-8"><style>
@import url("{F}/noto-sans-jp/400.css"); @import url("{F}/noto-sans-jp/700.css");
@page {{ size: A4; margin: 14mm }} body {{ font-family: "Noto Sans JP"; font-size: 10pt; color: #222; line-height: 1.7 }}
h1 {{ font-size: 17pt; margin: 0 0 4mm }}
h2 {{ font-size: 12pt; margin: 6mm 0 2mm; border-left: 1.2mm solid #0b6bcb; padding-left: 2mm; break-after: avoid }}
table {{ border-collapse: collapse; width: 100% }} td {{ border: 0.3mm solid #bbb; padding: 1.2mm 2mm; vertical-align: top }}
td:first-child {{ white-space: nowrap; font-weight: 700 }}
.sw {{ display: inline-block; width: 3mm; height: 3mm; border-radius: 0.6mm; margin-right: 1.5mm; vertical-align: -0.3mm }}
.warn {{ border: 0.4mm solid #c77700; background: #fff7ea; padding: 2.5mm 4mm; border-radius: 1.5mm }}
ol, ul {{ margin: 1mm 0; padding-left: 6mm }} img {{ width: 100%; border: 0.3mm solid #bbb; border-radius: 1mm }}
.ex {{ border: 0.3mm solid #ddd; border-radius: 1mm; padding: 2mm 3mm; margin: 2mm 0; font-size: 10.5pt }} .ex .lb {{ font-size: 7.5pt; color: #666; margin-right: 1.5mm }}
del {{ background: #fde2e2; color: #a3151b; text-decoration: none; font-weight: 700 }} ins {{ background: #d9f3e2; color: #0b5d2b; text-decoration: none; font-weight: 700 }}
table, .warn, .fig {{ break-inside: avoid }}
</style><body>
<h1>朱書き照合ツール</h1>

<h2>使い方</h2>
<ol>
<li>「朱書き照合ツール.html」をダブルクリックで開く（Google Chrome・Microsoft Edge）。</li>
<li><b>原稿</b>を入れる：紙はカラーでスキャンしたPDFか画像。注釈で赤字を入れたPDF・ラフ（Googleスライドなどから書き出したPDF）はそのPDF。支給されたデータ（Excel・Word・PowerPoint・テキスト・CSV）はそのファイル。種類の違う原稿を混ぜて入れてもかまいません。</li>
<li><b>成果物（PDF）</b>を入れる。</li>
<li>前回の成果物があれば<b>旧版（任意・PDF）</b>に入れる。原稿のない部分で前回から変わった所を「指示にない変更」として出し、前回から変わっていない所は一覧から外します（「前回のまま」）。</li>
<li>「照合」を押す。</li>
</ol>
<p>どちらも複数のファイルを入れられます（上から順にページをつなげます）。原稿と成果物でページの順番・数・大きさが違っていてもかまいません。原稿の各ページが成果物のどのページのどの範囲に当たるかを自動で探し、ページの表示に点線で示します。ファイルは外部に送信されません。</p>
<div class="fig"><img src="data:image/png;base64,{shot}"></div>

<h2>結果の見方</h2>
<p>直す必要がありそうなものから順に並びます。違う字だけに色が付きます。同じレイアウトのページは字形を重ねて、レイアウトが違うページ（ラフとデザイン後など）は文字の中身で比べます。改行・段組み・配置の違いは、違いとして出しません。</p>
<div class="ex"><span class="lb">原稿</span>ご利用<del>いただけ</del>ます　　<span class="lb">成果物</span>ご利用<ins>になれ</ins>ます</div>
<table>{cats}</table>
<p>指示（コメント・書き込み）は、「「A」→「B」」「「B」を追加」「トル」のように何に直すかが文字で分かるもの、太字・大きく・小さく・「赤字に」・改行・追い込みのように見た目で確かめられるものは自動で判定します。指示どおりと確かめられたもの（指示どおりの違いを含む）は「自動で確認済み」として一覧から外します（「参考も表示」で見られます）。文字や見た目では判定できないもの（後送・画像・揃え・配置など）だけを「人が判断」に出します。</p>
<p>各項目に OK・要修正・保留 とメモを付け、CSV・印刷で残せます。</p>
<p><b>データの原稿（Excel など）</b>：表は行ごと、文章は段落ごとに、成果物のどこに載っているかを探して比べます（表が何ページかに分かれていてもかまいません）。Excel は画面に表示されているとおりの文字（「1,280円」「2027年4月1日」など）で比べ、非表示のシート・行・列は読みません。結果には Excel の行番号（「12行目」）を添えます。数字の桁区切りの「,」のあるなしは違いとしません。「¥1,280」と「1,280円」のような通貨の記号だけの違いは「全角・半角などの違い」として出し、同じ違いが何行もあるときは1件にまとめます。Word の変更履歴は反映したあとの文で比べ、コメントは「指示・書き込みの確認」に出します。</p>

<h2>注意</h2>
<div class="warn"><ul>
<li>見落としを減らすための補助です。最終確認は人が行ってください。</li>
<li>紙の手書きの文字（何に直すか・「全体的に」「ママ」など）は読めません。全体に関わる直しは、同じ直しが複数あることから判断します。</li>
<li>紙では、見た目が同じ別の字への差し替え（「ー」と「一」など）は、カタカナの中の漢字のような形でしか見つけられません。</li>
<li>赤字で字がほとんど隠れた箇所は、直っていても「直っていない」と出ることがあります。</li>
<li>レイアウトが違うページで比べるのは文字データです。原稿が画像の部分（前回の印刷物を貼ったものなど）は文字では比べられないため、「原稿が画像の部分」として示します。成果物の文字がアウトライン化されているページも文字では比べられません（結果の概要に表示します）。</li>
<li>手書きのラフのスキャンなど、レイアウトが違う紙の原稿は比べられません。</li>
<li>「日本語の誤り・確認」は、成果物の文字データだけを決まったルールで見ています。意味の上での不自然さや一覧にない誤用は見つけられません。年の書いていない日付は、成果物に出てくる年で曜日を計算します。</li>
<li>古い形式の Excel・Word・PowerPoint（.xls・.doc・.ppt）は読めません。新しい形式（.xlsx・.docx・.pptx）かPDFで保存し直してください。Word のヘッダー・フッター・脚注、Excel のグラフ・図形の中の文字、PowerPoint のグラフ・SmartArt は読みません。</li>
</ul></div>
</body></html>'''
html_path = DOCS / 'guide.html'
html_path.write_text(html, encoding='utf-8')
try:
    subprocess.run(['node', str(ROOT / 'test-kit/src/htmltopdf.js'), str(html_path), str(DOCS / '利用ガイド.pdf')], check=True)
finally:
    html_path.unlink()
print(DOCS / '利用ガイド.pdf')
