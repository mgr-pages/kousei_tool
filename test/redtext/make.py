# 赤字を「注釈」でなく、ページの中身(赤い文字・線)として書き込んだPDF原稿の模擬データを作る(文言はすべて架空)
#   python3 test/redtext/make.py 出力フォルダ
#   出力フォルダに、次のものを作る
#     base.pdf    : 成果物(赤字の指示どおりに直していないもの)。test/inject/make.py の種1の直す前の版
#     genko.pdf   : base.pdf に赤い文字・線で指示を書き込んだ原稿(文字データとして赤い文字が入る)
#     applied.pdf : 指示どおりに直した成果物(元の字を消して、同じ書体で書き直したもの。直した行は字が送られる)
#   要るもの: reportlab・PyMuPDF と IPAゴシック
import sys, os, shutil, tempfile
import pymupdf
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'inject'))
import make as inject

F = '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'
RED = (0.85, 0.05, 0.1)
# 書き込む指示(赤い文字・線)
#   1. 価格「12,800円」を線で消し、右に「13,200円」
#   2. 品名「そよかぜ」に下線と引き出し線、右の余白に「そよ風に」
#   3. 本文の右の余白に「全体的に「家電」→「製品」」
#   4. 行の間に挿入の印と小さい字「とても」
def genko(src, out):
    d = pymupdf.open(src); pg = d[0]
    pg.insert_font(fontname='G', fontfile=F)
    txt = lambda x, y, s, size: pg.insert_text((x, y), s, fontname='G', fontsize=size, color=RED)
    line = lambda x0, y0, x1, y1, w=0.9: pg.draw_line((x0, y0), (x1, y1), color=RED, width=w)
    line(298, 268.5, 338, 268.5); txt(341, 272, '13,200円', 8)
    line(128, 274, 160, 274); line(160, 274, 496, 276, 0.5); txt(498, 278, 'そよ風に', 8)
    txt(395, 128, '全体的に「家電」→「製品」', 8)
    line(196, 137, 199, 141); line(199, 141, 202, 137); txt(192, 142.5, 'とても', 5.5)
    d.subset_fonts(); d.save(out, garbage=4, deflate=True)   # 書体は使う字だけを埋め込む

# 指示どおりに直す: 文字列を消して(文字データからも消える)、同じ位置に書き直す
def applied(src, out):
    d = pymupdf.open(src); pg = d[0]
    def rep(old, new, size):
        r = pg.search_for(old)[0]
        pg.add_redact_annot(r); pg.apply_redactions(images=0, graphics=0)
        pg.insert_font(fontname='G', fontfile=F)
        pg.insert_text((r.x0, r.y1 - 0.12 * size - 0.9), new, fontname='G', fontsize=size)
    rep('12,800円', '13,200円', 9)
    rep('そよかぜサーキュレーター', 'そよ風サーキュレーター', 9)
    rep('新しい家電を取りそろえました。', '新しい製品を取りそろえました。', 10.5)
    rep('高めたエアコンや、静かに運転するサーキュレーターなど、全１２', '高めたエアコンや、とても静かに運転するサーキュレーターなど、', 10.5)
    rep('機種をご紹介します。詳しくは販売店またはホームページでご確認', '全１２機種をご紹介します。詳しくは販売店またはホームページでご確認', 10.5)
    d.subset_fonts(); d.save(out, garbage=4, deflate=True)

if __name__ == '__main__':
    out = sys.argv[1]; os.makedirs(out, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        inject.make(1, tmp)
        shutil.copy(os.path.join(tmp, 'old.pdf'), os.path.join(out, 'base.pdf'))
    genko(os.path.join(out, 'base.pdf'), os.path.join(out, 'genko.pdf'))
    applied(os.path.join(out, 'base.pdf'), os.path.join(out, 'applied.pdf'))
    print('作りました:', ', '.join(os.path.join(out, f) for f in ('base.pdf', 'genko.pdf', 'applied.pdf')))
