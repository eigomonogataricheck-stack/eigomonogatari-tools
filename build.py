"""web/app.src.html に engine.js などを埋め込み、単体で動く HTML を作る。  python3 web/build.py
  通常版(内蔵の図鑑なし。同じ場所の zukan_beta.json から作る):
    web/index.html(公開サイト用) / 動作確認用/英語物語_仮想対戦.html(起動.bat で開く)
  運営確認用(内蔵の図鑑あり。zukan_beta.json を読まない・送らない。ダブルクリックで単体で動く):
    web/index_operator.html / web/artifact.html(Artifact公開用の断片)
    内蔵の図鑑 = web/roster.json(zukan_beta.json から web/zukan.js の変換で作ったもの)
  見えない控えの推測データ(meta.json)と古い簡易版(ai.js)は含めない。AIは noHidden で動く(見えない控えは推測しない)
"""
import json, os, sys
from pathlib import Path
# 改善計算の操作で試す用(tools/lab/site_lab.js から): LAB_SITE_OUT = 出力する HTML、LAB_BRAIN_JS・LAB_PARAMS_JSON = 使う操作。指定したときはその HTML だけを書き、ほかの出力には触らない
LAB_OUT = os.environ.get("LAB_SITE_OUT")
here = Path(__file__).parent
src = (here / "app.src.html").read_text(encoding="utf-8")
eng = (here / "engine.js").read_text(encoding="utf-8")
# 2026-11-21: 図鑑(本体/zukan_path.json)が新しくなっていたら、先に web/roster.json を作り直す(試合作りの途中なら作り直さない)
import subprocess as _sp
_r = _sp.run(["node", str(here.parent / "tools" / "make_roster.js"), "--auto"], capture_output=True)
print("キャラ一覧:", (_r.stdout.decode("utf-8", "replace").strip().splitlines() or ["(make_roster.js を動かせなかった)"])[-1])
ros = (here / "roster.json").read_text(encoding="utf-8")
dks = (here / "decks.json").read_text(encoding="utf-8")
# 環境再現のデッキの使用率(tools/env_sim.js の env_decks.json を写したもの)。無ければ null(キャラ生成は decks.json から1体ずつ)
envd = (here / "env_decks.json").read_text(encoding="utf-8") if (here / "env_decks.json").exists() else "null"
assert "</script" not in envd.lower()
# 相性AI(1人分の自動生成で、周りの9デッキに対して一番点数の高いデッキを探す): モデルの重み(python tools/vec_export.py <tag>)と計算(compat_ai.js)
vmod = (here / "vec_model.json").read_text(encoding="utf-8") if (here / "vec_model.json").exists() else "null"
cai = (here / "compat_ai.js").read_text(encoding="utf-8")
# 相性AIの2段目「全体を読む形」(2026-11-21。python tools/set_export.py s1 → web/set_model.json、計算 web/compat_set.js。一致の確認 node tools/set_check.js)
smod = (here / "set_model.json").read_text(encoding="utf-8") if (here / "set_model.json").exists() else "null"
cset = (here / "compat_set.js").read_text(encoding="utf-8")
assert "</script" not in smod.lower() and "</script" not in cset.lower()
dop = (here.parent / "tools" / "deck_opt.js").read_text(encoding="utf-8")   # 全組み合わせから最大のデッキ(tools と同じもの)
assert "</script" not in vmod.lower() and "</script" not in cai.lower() and "</script" not in dop.lower()
assert "</script" not in eng.lower() and "</script" not in ros.lower()
fxd = (here / "fx.json").read_text(encoding="utf-8")
fxj = (here / "fx_engine.js").read_text(encoding="utf-8")
aij = ""    # 古い簡易版(ai.js)は画面から呼ばれないので含めない
# 操作AI(2026-11-25 版5): 画面 = web/brain.js(版2の土台。ツールの照合用に残す)に tools/lab/brain_lab.js の変更(rsim_op 版5 NN推論と同じ)を当てた物 + tools/rsim_op/policy.json(p_nn_v5_best.json)。
#   一致の確認 = node tools/lab/brain_lab_check.js 200 tools/rsim_op/policy.json(手順は docs/画面へ移す手順.md)
import subprocess
OP_POLICY = here.parent / "tools" / "rsim_op" / "policy.json"
def op_brain():
    r = subprocess.run(["node", "-e", "process.stdout.write(require('./tools/lab/brain_lab.js').make())"], cwd=here.parent, capture_output=True)
    if r.returncode != 0: sys.exit("brain_lab.js で操作AIを作れない: " + r.stderr.decode("utf-8", "replace"))
    return r.stdout.decode("utf-8")
brj = Path(os.environ["LAB_BRAIN_JS"]).read_text(encoding="utf-8") if LAB_OUT else op_brain()
met = "null"   # 見えない控えの推測データ(meta.json)は含めない
bpp = Path(os.environ["LAB_PARAMS_JSON"]).read_text(encoding="utf-8") if LAB_OUT else OP_POLICY.read_text(encoding="utf-8")
assert "</script" not in bpp.lower()
assert "</script" not in aij.lower() and "</script" not in brj.lower()
assert "</script" not in fxj.lower()
zkj = (here / "zukan.js").read_text(encoding="utf-8")   # 図鑑(zukan_beta.json)を読んだときの変換
assert "</script" not in zkj.lower()
# 内蔵の図鑑の日付(運営確認用の画面下部に出す): 作ったときの図鑑の generatedAt
zdate = ""
sys.path.insert(0, str(here.parent)); from eigo_battle.zukan_path import zukan_path   # 読み先は 本体/zukan_path.json(2026-11-21)
for zp in (zukan_path(),):
    if zp.exists():
        zdate = str(json.loads(zp.read_text(encoding="utf-8")).get("generatedAt") or "")[:10]; break
note = json.dumps(f"{len(json.loads(ros))}体" + (f"・{zdate}" if zdate else ""), ensure_ascii=False)
base = src.replace("/*__ZUKANJS__*/", zkj)
base = base.replace("/*__FXDATA__*/", fxd).replace("/*__FXJS__*/", fxj).replace("/*__AIJS__*/", aij).replace("/*__BRAINJS__*/", brj).replace("/*__META__*/", met).replace("/*__BRAINPARAMS__*/", bpp).replace("/*__ENGINE__*/", eng).replace("/*__DECKS__*/", dks).replace("/*__ENVDECKS__*/", envd).replace("/*__VECMODEL__*/", vmod).replace("/*__DECKOPT__*/", dop).replace("/*__COMPATAI__*/", cai).replace("/*__SETMODEL__*/", smod).replace("/*__COMPATSET__*/", cset)
def body(builtin):
    return base.replace("/*__ROSTER__*/", ros if builtin else "null").replace("/*__ROSTERNOTE__*/", note if builtin else "null")
def full(b):
    return ('<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            '<style>:root{color-scheme:light;padding-block:env(safe-area-inset-top,0px) env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui}[hidden]{display:none!important}</style>\n'
            '</head>\n<body>\n' + b + '\n</body>\n</html>\n')
pub, opr = full(body(False)), full(body(True))
if LAB_OUT:
    Path(LAB_OUT).write_text(pub, encoding="utf-8"); print("built 改善計算の操作の版", len(pub) // 1024, "KB →", LAB_OUT); sys.exit(0)
(here / "index.html").write_text(pub, encoding="utf-8")
(here / "index_operator.html").write_text(opr, encoding="utf-8")
(here / "artifact.html").write_text(body(True), encoding="utf-8")
# 自分で動作を見る用: 動作確認用/(起動.bat で開く。同じフォルダの zukan_beta.json を読む。運営に渡す用の release/ とは別)
mine = here.parent / "動作確認用"
mine.mkdir(exist_ok=True)
(mine / "英語物語_仮想対戦.html").write_text(pub, encoding="utf-8")
# 起動.bat(簡易サーバー): bat は Shift_JIS、ps1 は BOM 付き UTF-8(PowerShell 5.1 用)、改行は CRLF
srv = here / "serve"
(mine / "起動.bat").write_bytes((srv / "起動.bat").read_text(encoding="utf-8").replace("\r\n", "\n").replace("\n", "\r\n").encode("cp932"))
(mine / "server.ps1").write_bytes((srv / "server.ps1").read_text(encoding="utf-8").replace("__ZUKAN_PATH__", str(zukan_path())).replace("\r\n", "\n").replace("\n", "\r\n").encode("utf-8-sig"))
# サイト用: サイト/(index.html + 起動.bat。同じフォルダの zukan_beta.json を読む。zukan_beta.json は利用者が置く物なので触らない。2026-11-11)
site = here.parent.parent / "サイト"   # 一番上の サイト フォルダ(本体の1つ上。2026-11-11 整理)
if site.exists():
    (site / "index.html").write_text(pub, encoding="utf-8")
    (site / "起動.bat").write_bytes((srv / "起動.bat").read_text(encoding="utf-8").replace("\r\n", "\n").replace("\n", "\r\n").encode("cp932"))
    (site / "server.ps1").write_bytes((srv / "server.ps1").read_text(encoding="utf-8").replace("__ZUKAN_PATH__", str(zukan_path())).replace("英語物語_仮想対戦.html", "index.html").replace("\r\n", "\n").replace("\n", "\r\n").encode("utf-8-sig"))
print("built 通常版", len(pub) // 1024, "KB →", mine / "英語物語_仮想対戦.html", "/ 運営確認用", len(opr) // 1024, "KB → web/index_operator.html")
