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
CAT = [('#d1343b', '直っていない', '赤字があるのに、修正後で変わっていない'),
       ('#d9730d', '指示にない変更', '赤字がないのに、修正後で変わっている（文字・改行・画像・色・位置）'),
       ('#9b3fa0', '直し忘れ', '全体指示・以下同様で直すはずの語が、修正後に残っている'),
       ('#1c7ed6', '文字だけ違う', '見た目は同じでも文字が違う（長音「ー」と漢数字「一」など）'),
       ('#1f8f4e', '赤字どおり変わった', '赤字の箇所が変わっている。中身が指示どおりかを確認'),
       ('#6b7280', '読み取れない赤字', 'どの文字への指示か読み取れなかった赤字（欄外の注記など）'),
       ('#8a8600', '全体・以下同様どおり', '赤字のない箇所だが、全体指示・以下同様として変わっている')]
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
del {{ background: #fde2e2; color: #a3151b; text-decoration: line-through }} ins {{ background: #d9f3e2; color: #0b5d2b; text-decoration: none; font-weight: 700 }}
table, .warn, .fig {{ break-inside: avoid }}
</style><body>
<h1>朱書き照合ツール</h1>

<h2>使い方</h2>
<ol>
<li>「朱書き照合ツール.html」をダブルクリックで開く（Google Chrome・Microsoft Edge）。</li>
<li><b>赤字原稿</b>を入れる：紙はカラーでスキャンしたPDFか画像、PDFに注釈で赤字を入れたものはそのPDF。</li>
<li><b>修正後PDF</b>を入れる。</li>
<li>「照合」を押す。</li>
</ol>
<p>どちらも複数のファイルを入れられます（上から順にページをつなげます）。ファイルは外部に送信されません。</p>
<div class="fig"><img src="data:image/png;base64,{shot}"></div>

<h2>結果の見方</h2>
<p>直す必要がありそうなものから順に並びます。違う字だけに色が付きます。</p>
<div class="ex"><span class="lb">修正前</span>ご利用<del>いただけ</del>ます　　<span class="lb">修正後</span>ご利用<ins>になれ</ins>ます</div>
<table>{cats}</table>
<p>各項目に OK・要修正・保留 とメモを付け、CSV・印刷で残せます。</p>

<h2>注意</h2>
<div class="warn"><ul>
<li>見落としを減らすための補助です。最終確認は人が行ってください。</li>
<li>紙の手書きの文字（何に直すか・「全体的に」「ママ」など）は読めません。全体に関わる直しは、同じ直しが複数あることから判断します。</li>
<li>紙では、見た目が同じ別の字への差し替え（「ー」と「一」など）は、カタカナの中の漢字のような形でしか見つけられません。</li>
<li>赤字で字がほとんど隠れた箇所は、直っていても「直っていない」と出ることがあります。</li>
</ul></div>
</body></html>'''
html_path = DOCS / 'guide.html'
html_path.write_text(html, encoding='utf-8')
try:
    subprocess.run(['node', str(ROOT / 'test-kit/src/htmltopdf.js'), str(html_path), str(DOCS / '利用ガイド.pdf')], check=True)
finally:
    html_path.unlink()
print(DOCS / '利用ガイド.pdf')
