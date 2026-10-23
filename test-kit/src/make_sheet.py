# 正解表(CSV・JSON)と、校正者向けの赤字指示書(HTML→PDF)を作る
import json, csv, io, base64, pymupdf
from PIL import Image, ImageDraw, ImageFont
from content import ITEMS

DPI = 200; K = 0.75 * DPI / 72          # CSS px → 200dpi px
rects = {r['id']: r for r in json.load(open('old_rects.json'))}
MEAN = {'A': '赤字どおりに変更あり', 'B': '赤字あり・変更なし（修正漏れの疑い）', 'C1': '全体指示・以下同様で説明できる変更',
        'D': '全体指示・以下同様の展開漏れ', 'C': '指示外の変更', 'E': '見た目では差が出ない文字の差し替え',
        'G': '全体指示として扱う（場所なし）', 'L': '改行など組みの変更（現状は検出対象外の見込み）',
        'M': 'ママ（変更しないのが正しい。現状は「修正漏れの疑い」と誤って出る見込み）', 'N': '指示ではない書き込み（無視されるのが正しい）'}
KIND = {'instr': '朱書きする指示', 'global': '全体指示・以下同様の展開先', 'unins': '指示外の変更（校正者には伏せる）'}
RES = {'applied': '反映済み', 'missed': '未反映', 'wrong': '違う内容で反映（木→火）', 'note': '—', 'nochange': '変更なし', 'changed': '変更あり'}

gt = []
for gid, page, kind, res, text, where, exp in ITEMS:
    boxes = [[round(v*K) for v in r] for r in rects[gid]['rects']] if gid in rects else []
    gt.append(dict(id=gid, page=page, kind=kind, result=res, expected=exp, instruction=text, where=where, boxes=boxes))
json.dump(gt, open('gt.json', 'w'), ensure_ascii=False, indent=1)
with open('正解表.csv', 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.writer(f); w.writerow(['No.', 'ページ', '種類', '修正後の状態', '指示内容（校正者向け）', '場所・内容', '期待する判定', '判定の意味'])
    for g in gt: w.writerow([g['id'], g['page'], KIND.get(g['kind'], g['kind']), RES[g['result']], g['instruction'], g['where'], g['expected'], MEAN[g['expected']]])

# 指示箇所に番号を付けたページ縮小図(指示のある範囲だけを切り出して大きく載せる)
doc = pymupdf.open('old.pdf'); TD = 110; k = 0.75 * TD / 72; mm = TD / 25.4
font = ImageFont.truetype('/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf', 26); thumbs = []
CROP = {1: (12, 212), 2: (14, 180), 3: (12, 226), 4: (12, 122)}   # 切り出す範囲(mm, 上端〜下端)
for pno in range(4):
    pix = doc[pno].get_pixmap(dpi=TD); im = Image.frombytes('RGB', (pix.width, pix.height), pix.samples); d = ImageDraw.Draw(im)
    for g in gt:
        if g['page'] != pno+1 or g['kind'] != 'instr' or g['id'] not in rects: continue
        x0, y0, x1, y1 = [v*k for v in rects[g['id']]['rects'][0]]
        d.rectangle([x0-3, y0-3, x1+3, y1+3], outline=(0, 120, 220), width=3)
        cx, cy = x0 - 6, y0 - 6; d.ellipse([cx-19, cy-19, cx+19, cy+19], fill=(0, 120, 220))
        d.text((cx, cy), g['id'], font=font, fill=(255, 255, 255), anchor='mm')
    t, b_ = CROP[pno+1]; im = im.crop((0, int(t*mm), im.width, int(b_*mm)))
    b = io.BytesIO(); im.save(b, 'PNG'); thumbs.append('data:image/png;base64,' + base64.b64encode(b.getvalue()).decode())

rows = ''.join(f'<tr><td class="no">{g["id"]}</td><td>{g["page"]}</td><td>{g["where"]}</td><td>{g["instruction"]}</td><td class="chk"></td></tr>'
               for g in gt if g['kind'] == 'instr')
html = f'''<!doctype html><html lang="ja"><meta charset="utf-8"><style>
@import url("node_modules/@fontsource/noto-sans-jp/400.css"); @import url("node_modules/@fontsource/noto-sans-jp/700.css");
@page {{ size: A4; margin: 14mm 14mm 14mm 14mm }} body {{ font-family: "Noto Sans JP"; font-size: 9.5pt; color: #222; line-height: 1.6 }}
h1 {{ font-size: 16pt; margin: 0 0 2mm }} h2 {{ font-size: 11.5pt; margin: 5mm 0 1.5mm; border-left: 1.2mm solid #0078dc; padding-left: 2mm }}
table {{ border-collapse: collapse; width: 100% }} td, th {{ border: 0.3mm solid #999; padding: 1.2mm 2mm; vertical-align: top }}
th {{ background: #eef4fb; font-weight: 700 }} td.no {{ font-weight: 700; text-align: center; width: 9mm }} td.chk {{ width: 10mm }}
.box {{ border: 0.4mm solid #0078dc; background: #f3f8fe; padding: 2.5mm 4mm; border-radius: 1.5mm }}
ul {{ margin: 1mm 0; padding-left: 5mm }} .pb {{ page-break-before: always }}
.thumbs img {{ width: 100%; border: 0.3mm solid #999; display: block }} .thumbs > div {{ break-inside: avoid; margin-bottom: 3mm }}
.cap {{ font-size: 8.5pt; color: #555; text-align: center }}
</style><body>
<h1>校正テスト　赤字指示書（校正者の方へ）</h1>
<div class="box">このテストは、校正支援ツールが<b>人によって異なる朱書きの書き方</b>を正しく読み取れるかを確かめるためのものです。
校正の腕前を測るものではありません。<b>いつもどおりの書き方で</b>朱書きしてください。</div>
<h2>用意するもの</h2>
<ul><li>「01_初校ダミー.pdf」を<b>A4・実際のサイズ（拡大縮小なし）・カラー</b>で印刷したもの（4枚）</li>
<li>普段使っている赤ペン／鉛筆（疑問出し用）／普段使っている校了印・担当印（あれば）</li></ul>
<h2>書き方のお願い</h2>
<ul>
<li>各ページ右上の「記入者ID」欄に、主催者から伝えられたIDを<b>黒のペン</b>で書いてください（赤は使わないでください）。</li>
<li>下の表の指示を、<b>普段どおりの記号・引き出し線・欄外への書き方</b>で朱書きしてください。線の引き方や書く場所は自由です。</li>
<li>指示の順番は自由です。表の右端の欄は、書き終えたら印を付ける用です。</li>
<li>No.04（全体指示）は、1ページ目の欄外の好きな場所に、普段の全体指示の書き方で書いてください。</li>
<li>P1・P2は<b>鉛筆</b>で書いてください（赤ペンは使わない）。</li>
<li>表にない書き込みはしないでください（判定の正解が分からなくなるため）。</li>
<li>「修正後」のPDFは見ないでください。</li>
</ul>
<h2>朱書きしていただく指示（全{sum(1 for g in gt if g['kind'] == 'instr')}項目）</h2>
<table><tr><th>No.</th><th>頁</th><th>場所の目安</th><th>指示内容</th><th>済</th></tr>{rows}</table>
<h2>書き終えたら</h2>
<ul><li>4枚を<b>カラー・300dpi</b>でスキャンし、1つのPDFにまとめてください（ファイル名：<b>ID_scan.pdf</b>）。</li>
<li>スキャナの「白紙除去」「文字くっきり」などの自動補正は、可能なら切ってください。</li>
<li>余裕があれば、1ページ目だけスマートフォンでも撮影してください（ファイル名：<b>ID_photo.jpg</b>。真上から、影が入らないように）。</li>
<li>Acrobatなどで<b>PDFに直接朱入れ</b>できる方は、同じ指示を「01_初校ダミー.pdf」に注釈で入れたものも作ってください（ファイル名：<b>ID_digital.pdf</b>。使う機能は普段どおりで構いません）。</li></ul>
<div class="pb"></div><h2>指示箇所の位置（青い番号が上の表のNo.です）</h2>
<div class="thumbs">{''.join(f'<div><img src="{t}"><div class="cap">{i+1}ページ目</div></div>' for i, t in enumerate(thumbs))}</div>
<p style="font-size:8.5pt;color:#555">※No.04（全体指示）とS1（印鑑）は場所の指定がないため、図には番号がありません。</p>
</body></html>'''
open('sheet.html', 'w').write(html)
print('instr', sum(1 for g in gt if g['kind'] == 'instr'), 'total', len(gt))
