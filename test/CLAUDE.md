# 英語物語 非公式ツール(静的サイト / GitHub Pages)

## 構成(ビルド工程なし・素のHTML/CSS/JS)
- index.html … 全ページ(計算機・図鑑・協力ダメージ計算・協力報告書・使い方)を1枚に収めたSPA。ページ切替は `showPage()`(app.js)
- app.js … 共通処理・計算機の入力・キャラ選択モーダル / calculator.js … ダメージ計算 / catalog.js … 図鑑・ピッカー・キャラ絞り込み(共通部品)
- coop.js(約150KB)・coop-detail.js・coop-worker.js … 協力ダメージ計算とデッキ提案 / migration.js … 保存データの移行
- CSS はページ・役割ごとのファイル(2026-10-30 に旧 style.css を廃止して作り直し)。index.html でこの順に読む:
  - base.css … 全ページ共通の土台(`:root` の `--ui-*` 変数、ヘッダー・メニュー、ページ見出し、役割別のボタン、入力欄、共通の選択欄 `.coop-styled-select*`、切替スイッチ、小窓・シート、お気に入りの引き出し、アニメーション)
  - calculator.css … 計算機とスクショ用画面
  - catalog.css … 図鑑・キャラ選択・キャラ詳細(絞り込み・分類タブ・一覧シートは図鑑とキャラ選択の共通部品)
  - coop.css … 協力ダメージ計算(提案結果・提案の小窓を含む)・協力報告書
  - help.css … 使い方・データ移行
  - JS から `<style>` を差し込まない。見た目はすべて上の CSS ファイルに書く
- データ: zukan_beta.json(約1.7MB)
- Tier表は 2026-10-30 に廃止(tier.js・tier_all_patterns.json は削除済み)
- 開発要望.md … 2026-10-30 時点の要望を機能別にまとめた参考資料(作業手順の指示ではない)。ユーザーの指示により以後は編集しない。原本は _archive/ にあり、サイトには不要
- 各ページの「使い方」ボタンの説明文は app.js の `PAGE_HELP`。機能を変えたらここと「使い方」ページ(catalog.js の `renderComprehensiveHelp`)も直す。説明はコードで動作を確かめてから書く
- キャラ画像のドラッグ&ドロップは app.js の共通部品(`registerCharDrag`)。キャラが入る枠を新しく作ったら `data-char-drag="種類:番号"` を付け、種類ごとの get / accepts / swap / place を登録する。見た目は base.css の `.char-drag-*` / `.char-drop-*`
- 左のメニューは、スマホ・タブレットでは≡で開く引き出し(`.sidebar.open`)、PC(1000px以上)では≡で「文字あり」と「アイコンだけ」を切り替える(`html.sidebar-collapsed`、localStorage `eigoSidebarCollapsed`)。処理は app.js の `toggleMenu` / `syncMenuToggle`
- データ移行は独立したページ(`#page-migration`)。中身は migration.js が `#migrationMount` に描画する
- deck.js … 図鑑の「デッキを組む」(図鑑の下に貼り付く5枠のデッキ欄)。ON のあいだは図鑑のキャラを押すとデッキに入る(catalog.js の `card()` から `zukanDeckAdd`)。保存は localStorage `eigoZukanDeckV1`。見た目は catalog.css の「デッキ編成」の章
- 凸数ごとの HP / Power は app.js の `limitBreakMax` / `limitBreakValue` / `limitBreakOptions`。ゲームの式(凸 k の最大Lv = trunc(基本の最大Lv×(1+0.2k))、Lv1 = 無凸値の半分から直線)に、図鑑の無凸・完凸が4つとも一致する基本の最大Lv(30/40/50/60/99)を当てはめる。一致しないキャラは等分の目安。計算機・協力の詳細モードと図鑑の詳細で使う

## 作業ルール
- 計算ロジック(calculator.js / coop.js のダメージ式・倍率)は、頼まれない限り変更しない。UI変更で数値結果が変わらないこと。
- localStorage のキー名・保存形式は変更しない(変える場合は migration.js に移行処理を足す)。
- 要素のid・data-*属性は JS が参照している。名前を変える前に `grep` で参照箇所を全部確認する。
- `!important` は base.css の `[hidden]{display:none!important}` の1か所だけ。ほかで使わない。上書きのルールを末尾に足して直さず、その部品の定義を直接書き換える。同じセレクタを後ろで定義し直さない(画面幅ごとの違いは同じファイルの @media の中に書く)。
- 変更したJS/CSSは index.html の `?v=` を更新する(キャッシュ対策)。
- 画面確認はスマホ幅(375px)とPC幅(1280px)の両方で行う。
- ブラウザ確認が必要なときは `npx serve .` などでローカルサーバーを立てる(fetchで json を読むので file:// では動かない)。
- 返答・コミットメッセージは日本語。

## 図鑑とキャラ選択のUIは常に同時に直す
- 図鑑のUIを修正したら、各所のキャラ選択(計算機の攻撃/攻撃対象・他キャラのスキル、協力の敵/味方、協力報告書)にも同じ変更を反映する。片方だけ直して終わらない。
- 絞り込みは1つの共通部品。HTMLは catalog.js の `characterFilterMarkup(p)`、動作は `createCharacterFilter()`、見た目は catalog.css の絞り込みの章。図鑑は接頭辞 `zk`、キャラ選択は `pk` で同じ部品を2つ作っている。
  - 項目や見た目を変えるときはこの共通部品だけを直す。`#zkFilter` のような図鑑専用のidでCSSを書かない。
  - 確認は図鑑とキャラ選択の両方で行う(キャラ選択は「他キャラのスキル」「協力の2〜5枠」で対象キャラが限定される点も確認)。
- 分類タブ・カード一覧・モード切替タブも共通部品。catalog.js の `renderCategoryNav` / `renderCategoryItems` / `renderModeTabs` を、図鑑は `zukanView`、キャラ選択は `pickerView` を渡して使う。キャラ名検索は `renderNameSearchGroups`、「一覧」シートは `pickerCategoryList` を両方で使う。
  - 見た目は catalog.css の `.char-mode-tabs` / `.char-category-bars` / `.char-large-tabs` / `.char-middle-chips` / `.char-small-chips` / `.char-current` / `.char-item-heading`、一覧シートは `.picker-category-sheet` / `.picker-sheet-*` の1組だけ。`#page-zukan` や `#picker` を付けた個別ルールで見た目を書かない(置き場所の違い、例: `#page-zukan .char-current{top:54px}` だけは可)。

## 見た目の統一ルール
- 色・角丸・太さは図鑑の絞り込みデザインを基準にする。値は base.css の `:root` にある `--ui-*` 変数を使い、色コードを直接書かない。
- ボタンは役割で見た目を決める。補助 = `.reset-btn` / `.mini-reset`、主 = `.download` / `.primary`、危険 = `.danger` を付ける。ON状態は `.active` か `aria-pressed="true"`。個別のボタンに色・枠を書かない。
- 新しいボタンには役割のクラス(`.reset-btn` / `.mini-reset` / `.primary` / `.danger`)を付け、base.css の定義に乗せる。個別に色・枠を書かない。
- ページ見出しは `.page-head` の型にそろえる: `.page-eyebrow`(英字の小見出し)+ `h1` + `.page-lead`(一行説明)、右側に操作ボタン。新しいページもこの型で作る。
- カードは白・`--ui-line` の枠・`--ui-radius-card`・`--ui-shadow-card`。カード見出しには図鑑と同じ形のバッジ(番号 `01` や「攻」「守」)を付ける。
- 2択の選択は切替スイッチにする。計算機・協力では select / checkbox に `data-switch` を付けると app.js の `uiBuildSwitch` がスイッチを作る(元の要素は隠して値の受け渡しに使う。隠す範囲は `data-switch-hide` で指定できる)。
- アニメーションは各CSSの `@media(prefers-reduced-motion:no-preference)` の中にだけ書く。
- 色で意味を伝えるもの(攻=赤 `--ui-attack`、守=青 `--ui-guard`、撃破判定の `#killResult[data-state]`)は変数を使い、ほかの用途に流用しない。
- ボタンや入力欄の文字は枠からはみ出させない。寸法を固定せず、幅が足りなければグループやボタンを折り返す。変更後は数種類の画面幅で、文字が枠に収まっているかを確認する。
