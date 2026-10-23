# テストキットの生成ソース

ダミー原稿・赤字指示書・正解表・実施手順書を作り直すためのファイルです。普段は使いません。

| ファイル | 役割 |
|---|---|
| `content.py` | 原稿の文面と、初校／修正後の違い・正解表の定義（`[[ID\|初校\|修正後]]` の形） |
| `gen_docs.py` | 初校・修正後のHTMLを作る |
| `print.js` | HTMLをChromiumでPDFにし、正解の位置（`old_rects.json`）を書き出す |
| `make_sheet.py` | 正解表（`gt.json`・`正解表.csv`）と赤字指示書を作る |
| `make_guide.py` | 実施手順書を作る |
| `htmltopdf.js` | HTMLをA4のPDFにする |

```sh
npm install @fontsource/noto-sans-jp@5.1.0 @fontsource/noto-serif-jp@5.1.0 playwright
python3 gen_docs.py && node print.js
python3 make_sheet.py && node htmltopdf.js sheet.html sheet.pdf
python3 make_guide.py && node htmltopdf.js guide.html guide.pdf
```

フォントはNoto Sans JP／Noto Serif JP（SIL Open Font License）を使っています。
