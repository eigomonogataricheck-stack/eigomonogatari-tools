# 英語物語 非公式ツール(静的サイト / GitHub Pages)
詳細・経緯は `docs/引き継ぎ_詳細.md`(見出しで検索して必要な所だけ読む。全部読まない)。

## 構成(ビルドなし・素のHTML/CSS/JS)
- index.html = 全ページのSPA(`showPage()`)。app.js 共通・計算機入力 / calculator.js ダメージ計算 / catalog.js 図鑑・キャラ選択・絞り込み(共通部品)/ coop*.js 協力 / migration.js 保存データ移行
- CSS: base → calculator → catalog → coop → help(index.html の順)。JSから `<style>` を足さない
- 仮想対戦: battle-*.js(初回に app.js の `openBattle` が読む)+ battle.css。元は 03_仮想対戦/本体/web。移し方は「引き継ぎ_詳細」の仮想対戦の節と 本体/docs/画面へ移す手順.md
- データ: zukan_beta.json。スキル効果量は「割合」(4=400%)、%変換は calculator.js の `amt()` だけ
- ルート直下=公開側。test/=確認用(新デザイン)。公開側へ反映するのはユーザーが見て許可してから
- 公開はユーザーが自分でGitHubにアップ。変えたファイル名と場所を一覧で示す

## 作業ルール
- 計算ロジック(ダメージ式・倍率)は頼まれない限り変えない。localStorage のキー・形式は変えない(変えるなら migration.js に移行)
- id・data-* は JS が参照。変える前に grep で全参照を確認
- `!important` は base.css の `[hidden]` の1か所だけ。同じセレクタを後ろで定義し直さない
- 変えたJS/CSSは index.html の `?v=` を更新。確認は `npx serve .`、375px と 1280px
- 図鑑とキャラ選択のUIは常に同時に直す(共通部品 `characterFilterMarkup` / `createCharacterFilter` / `renderCategoryNav` など)
- 見た目: `--ui-*` 変数を使い色コード直書き禁止。ボタンは役割クラス(`.reset-btn` `.primary` `.danger`)。文字の太さ400〜500。配色は「黒鉛と朱」
- 機能を変えたら app.js の `PAGE_HELP` と `renderComprehensiveHelp` も直す
- 返答・コミットメッセージは日本語

## 進行中の作業
- (なし)
