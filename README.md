# Rigel

Blockbench で作ったモデルとアニメーションを、Minecraft Java Edition の display entity で動くデータパックとリソースパックへ書き出す Blockbench プラグイン。

- 書き出し先の版：Minecraft 1.20.4 と 26.3
- 対応する Blockbench：デスクトップ版の 5.2.1 以降

開発の初期段階で、いま書き出せるのは Minecraft 1.20.4 向けのデータパックとリソースパックだけ。26.3 向けの書き出しはまだできない。

## 導入

配布用のファイルはまだ無いので、ソースからビルドして読み込む。

1. [bun](https://bun.com) 1.4.2 で `bun install --frozen-lockfile` と `bun run build` を実行し、`dist/rigel.js` を作る。
2. Blockbench の File メニューから「Plugins...」を開き、ダイアログ上部の「Load Plugin from File」を押して `dist/rigel.js` を選ぶ。

## 使い方

新しいプロジェクトを、モデル形式「Rigel Rig」で作る。次の機能は、この形式のプロジェクトで使える。

### イージング

キーフレームを右クリックし、「イージング」からイージングを選ぶ。選んだイージングは、そのキーフレームから次のキーフレームまでの区間に適用される。キーフレームの補間方式（linear・catmullrom・bezier）は変わらず、区間の中の進み方だけが変わる。

- 組み込みのイージングは、sine・quad・cubic・quart・quint・expo・circ・back・elastic・bounce の In・Out・InOut の 30 種。
- 「プリセットを管理…」では、ベジェの形（CSS の `cubic-bezier()` と同じ 4 つの値）や、back の行き過ぎの量、elastic の振幅と周期を変えたものをプリセットとして保存できる。プリセットはその PC の Blockbench に保存され、JSON で書き出して別の PC で読み込める。
- イージングを当てたキーフレームには、イージングの形そのものが保存される。プロジェクトファイルだけで同じ動きを再生でき、あとでプリセットを編集しても、当て済みのキーフレームは変わらない。
- 「標準のベジェへ変換」は、イージングを当てた区間を Blockbench のベジェのハンドルに置き換え、グラフエディタで形を直せるようにする。区間を 1 本のベジェで近似するため、elastic や bounce のような形は変換すると変わる。

### イージングの制限

- bezier の区間と、前後にキーフレームがない catmullrom の端では、back・elastic の行き過ぎが端の値で止まる。
- 変換すると step の区間や、隣の区間の行き過ぎるイージングの形が変わってしまう場合は、変換しない。

### variant

「Variants」パネルで、テクスチャ違いなどの variant を作る。パネルは、モデリングとアニメーションの画面のサイドバーに出る。ペイントの画面にはパネルを出さず、ビューポートは元のモデルの見た目になる。塗る先が、variant の差し替え先ではなく元のテクスチャだからだ。ほかのパネルと同じように、左右のサイドバーや浮かせた位置へ動かせる。

パネルの一覧の先頭の `default` は、元のモデル。編集も削除もできない。一覧で variant を選ぶと、ビューポートがその variant の見た目になる。この選択は保存されない。一覧の上のボタンで、variant の追加・複製・削除ができる。variant の変更は Undo・Redo できる。

一覧で選んだ variant ごとに、次を決める。

- 名前：関数の名前になる。小文字・数字・`_` だけ。`default` は使えない。
- テクスチャの差し替え：元のテクスチャと差し替えるテクスチャの組。差し替えるテクスチャはプロジェクトに読み込んでおき、UV の大きさを元と同じにする。
- 適用する Bone：外した Bone は、この variant を適用しても今のモデルのまま残る。顔の Bone だけに適用する variant を作れば、それを当てても、体に当てた別の variant は戻らない。
- 適用時の関数：適用した後に呼ぶ関数（任意）。

適用する Bone は、アウトライナーと同じ階層のツリーで選ぶ。Cube を持つ Group が Bone で、display の Group は出ない。親のチェックを切り替えると、子孫もまとめて切り替わる。子の状態がそろっていないときは、親が中間の表示になる。ツリーの上のボタンは次のとおり。

- 全部：すべての Bone に適用する。
- 無し：どの Bone にも適用しない。
- 選択中だけ：アウトライナーで選んでいる Group と、その子孫の Bone だけに適用する。頭の Group を選んで押せば、顔の variant の対象を 1 回で決められる。

#### variant の keyframe

アニメーションの画面では、Timeline の Effects にある「Variant」トラックで variant を切り替えられる。keyframe は variant を 1 つ持ち、`default` も選べる。

- 「Variants」パネルの「再生位置に置く」は、パネルで選んでいる variant の keyframe を、再生位置に一番近い tick に置き、再生位置もその tick へ移す。その tick に keyframe があれば、その variant を替える。トラックの「+」でも置ける。
- keyframe の variant を替えるときは、keyframe をタイムラインか、パネルの keyframe の一覧で選び、パネルの一覧で variant を選ぶ。
- keyframe があるアニメーションでは、再生とスクラブで、Bone ごとに表示する variant を決める。各 Bone には、再生位置以前でその Bone に適用する最後の keyframe の variant を表示する。`default` はすべての Bone に適用する。顔だけに適用する variant の keyframe が、体に適用する variant の keyframe より後ろにあっても、体は体の variant のままで、書き出しの結果と同じになる。再生位置以前にその Bone に適用する keyframe がないときは、アニメーション全体で最後のものを使う。ループで前の周の variant が残るのと同じ考え方だ。どの keyframe もその Bone に適用しないときは、パネルで選んだ variant を表示する。その variant が Bone を外していれば、元の見た目になる。
- プレビューは、keyframe を書き出しと同じ規則で絞ってから、この決め方を当てる。時刻は tick に丸め、同じ tick に複数あれば後ろの 1 つだけを使い、ループの最後の tick にある keyframe も書き出しと同じに扱う（下の「書き出すと」以降）。
- パネルの一覧では、いま Bone が表示している variant のすべてに、表示中の目のマークが付く。元の見た目のままの Bone があるときは、`default` にも付く。
- keyframe が 1 つもないアニメーションと、アニメーション以外の画面では、パネルで選んだ variant を、外していない Bone に表示する。
- トラックの目のアイコンで切るミュートは、プレビューだけに効く。書き出しには、ミュートした keyframe も含まれる。
- keyframe は、variant を改名しても外れない。variant を削除しても、その variant を指す keyframe は残る。存在しない variant を指す keyframe があると、書き出しはそれを知らせて止まる。

書き出すと、keyframe の時刻を tick（1 秒 20 tick、四捨五入）にして、その tick のフレームの関数が `rigel:<リグ名>/variant/<variant 名>` を呼ぶ。温めのあいだは呼ばない。

- 同じ tick に keyframe が複数あるときは、時刻が後の 1 つだけを呼ぶ。
- ループのアニメーションの最後の tick は、frame 0 の姿勢を見せる tick になる。その tick にある keyframe は tick 0 の keyframe として扱い、tick 0 の variant は最後の tick でも適用する。tick 0 にも keyframe があるときは、tick 0 のほうを使い、最後の tick の keyframe は使わない。
- 最初の keyframe より前は何も呼ばないので、再生を始めたときの variant は、それまでに適用していたものになる。再生のたびに同じ variant から始めたいときは、tick 0 に keyframe を置く。
- variant が 1 つもなくても、`default` の keyframe は置ける。このときも `variant/default` を書き出す。

### locator

Bone の下に Locator を置くと、アニメ中のその位置で関数を実行できる。Locator を右クリックして「locator の entity」を選ぶと、locator の位置に entity（当たり判定の mob や marker など）を置いておける。置く entity は、自分では動かないもの（marker や NoAI の mob）にする。entity は、locator が動いた tick と `tp` のときにだけ置き直す。そのため、重力で落ちたり押されたりして動く entity は、次に置き直すまでずれたままになる。

### display

outliner の「display を追加」で、ブロック表示（block_display）・アイテム表示（item_display）・テキスト表示（text_display）を追加する。display は設定を持つ Group として作られ、Bone と同じようにキーフレームで動かせる。設定は、Group を右クリックして「display の設定」で変える。

- ブロック：`minecraft:oak_stairs[facing=east]` の形で指定する。ブロックは Group の pivot を角にして、+x・+y・+z の向きへ伸びる。
- アイテム：item の ID、tag、表示の型（`none`・`thirdperson_righthand` など）を指定する。アイテムの中心が Group の pivot に来る。
- テキスト：文字か JSON のテキストと、行の幅・背景色・文字の不透明度・影・透けて見えるか・揃えを指定する。テキストは下辺の中央が Group の pivot に来て、+z 側から読める向きに置かれる。JSON のテキストに Minecraft が読めない値（色の名前の誤りなど）があると、Minecraft は文字を表示しない。そのため、設定の確定と書き出しのときに知らせる。
- 拡大と追加の NBT（`brightness` など）も指定できる。追加の NBT に `id`・`UUID`・`Tags`・`Passengers`・`transformation`・`interpolation_duration`・`teleport_duration` は書けない。
- display の Group には Cube を入れない。
- display の entity には `rigel.<リグ名>.<名前>` のタグが付く。ほかのデータパックから、手に持たせる item を差し替えるときなどに使う。
- billboard は fixed だけで、ほかは使えない。fixed 以外では、Bone に付けた display の位置がカメラに合わせて回ってしまう。

Blockbench 上では、ブロックとアイテムは大きさと向きが分かる箱と板で、テキストは Minecraft のフォントで描く。

### テキストのフォント

Blockbench 上の text_display は、Minecraft 1.20.4 のフォントを使い、Minecraft と同じ大きさ・位置・折り返しで描く。フォントは、Minecraft の公式ランチャーが置いたファイルから読む。そのため、1.20.4 を一度起動しておく必要がある。プラグインにもこのリポジトリにも、Minecraft のアセットは入っていない。

File > Preferences > Settings の Preview で、次の 2 つを設定する。

- 「text_display のプレビュー：.minecraft の場所」：`versions/1.20.4/1.20.4.jar` とアセット（`assets/indexes`・`assets/objects`）があるフォルダ。既定は、Windows では `%APPDATA%\.minecraft`、macOS では `~/Library/Application Support/minecraft`、Linux では `~/.minecraft`。
- 「text_display のプレビュー：フォントを読むリソースパック」：独自のフォントを入れたリソースパックのフォルダか `.zip`。複数指定するときは `;` で区切る。後に書いたものほど優先される。

初めてフォントを読むときは、Blockbench がフォルダごとに読み取りの許可を求める。「Always allow for this plugin」を選ぶと、次からは聞かれない。拒否した場合は、設定を変えるまでブラウザーのフォントで描く。

- 対応する provider は `bitmap`・`space`・`reference`・`unihex`。`ttf` と `legacy_unicode` は読まないので、それらの provider の文字は欠けた文字の四角になる。
- 背景の外へはみ出す文字（ascent の大きい bitmap、負の幅の space で戻した文字など）も、Minecraft と同じくはみ出したまま描く。
- 文字どうしや下線が重なったところは、書いた順に後のものを上に描く。Minecraft では、どれが上に出るかはカメラからの距離で決まるので、見る位置によっては上下が入れ替わる。
- `.minecraft` の `options.txt` から、言語（`translate` の訳に使う）、Unicode フォントを強制するかどうか、既定の背景の濃さを読む。
- 読めないフォントやファイルがあると、件数と 1 件目を画面に出す。全件は開発者ツールのコンソールで確認できる。
- `obfuscated` の文字は入れ替えずにそのまま描く。右から左へ書く文字（アラビア文字など）も並べ替えない。

### 書き出し（Minecraft 1.20.4）

File メニューの「Export」から「Rigel のパックを書き出す」を選ぶ。開いたダイアログで次の項目を確かめて確定すると、データパックとリソースパックを書き出す。

| 項目 | 内容 |
|---|---|
| リグ名 | 関数・偽プレイヤー・storage の名前になる。小文字・数字・`_` だけ。`core`・`const`・`warm`・`rigel` は使えない |
| 元の item | Bone の表示に使う item（例：`minecraft:white_dye`）。CustomModelData を付けて表示する |
| データパックの置き場所 | ワールドの `datapacks` フォルダ |
| リソースパック | 全リグで共有するリソースパックのフォルダ |
| 温めの 1 かたまり | 1 tick に温める行数の上限。既定は 500 |
| 間引く | 補間で再現できる tick への書き込みを、Bone ごとに省く。既定は切 |
| ずれの上限 | 間引くときに許す、本来の姿勢とのずれ。位置（ブロック）と向き（度）で決め、拡大のずれ（割合）には向きの値をラジアンにして使う。初期値はどちらも 0 |
| 1 回の書き込みで補間する上限 | 1 回の書き込みで補間に任せる tick 数の上限。既定は 20 |
| tp の補間 | リグを tp したときに、client が位置と向きを補間する tick 数（`teleport_duration`）。0〜59 で、既定は 1。0 だと向きはすぐ変わり、位置は 1 tick で移る。1 以上だと位置と向きをその tick 数で補間する。召喚時の tp の後で root と全 Bone に書くので、召喚時の tp には効かない |
| 温めの優先度 | アニメごとに `xhigh`・`high`・`low`。既定は `high` |
| 間引き（アニメごと） | プロジェクトと同じ・間引かない・このアニメの値（位置と向き） |

設定と、初回に作る固有 ID（Bone の UUID に使う）はプロジェクトファイルに入るので、確定した後にプロジェクトを保存する。フォルダへ書き込む前に、Blockbench が初回だけ許可を求める。

書き出すものは次のとおり。

- `datapacks/<リグ名>/`：そのリグのデータパック。
- `datapacks/rigel/`：全リグで共有するデータパック。どのリグを書き出しても同じ内容になる。
- リソースパックの `assets/rigel/models/<リグ名>/` と `assets/rigel/textures/item/<リグ名>/`：Bone のモデルとテクスチャ。variant のモデルは `assets/rigel/models/<リグ名>/<variant 名>/` に、元のモデルを親にしてテクスチャだけを差し替えた形で書く。
- 元の item のモデル（`assets/minecraft/models/item/<item>.json` など）：このリグの overrides だけを入れ替える。ほかのリグや、元からある overrides は残す。ファイルが無いときは、平らなアイテムのモデルとして作る。

データパックのフォルダは、空のときか、Rigel が書き出した印（`rigel.json`）があるときだけ作り直す。リソースパックの直下の `rigel.json` には、リグ名ごとに、書き出したプロジェクトの固有 ID を残す。同じリグ名で別のプロジェクトが書き出していたら、置き換えるかを尋ねてから書き出す。Blockbench で非表示にした Cube も書き出し、Export を切った Cube と Bone は書き出さない。

#### 呼び出し

| 関数 | 動き |
|---|---|
| `rigel:<リグ名>/spawn` | 実行位置に、実行者の向き（yaw・pitch）でリグを出す。すでに居れば失敗で返す |
| `rigel:<リグ名>/play {ID:<番号>}` | アニメを最初から再生する。`with storage rigel:<リグ名> Argument` でも呼べる。無い番号ならチャットに赤字で出して失敗で返す |
| `rigel:<リグ名>/stop` | 今の姿勢のまま再生を終える |
| `rigel:<リグ名>/pause` | 今の姿勢のまま止める。再生中でなければ失敗で返す |
| `rigel:<リグ名>/restart` | pause で止めたところから再生を続ける。pause 中でなければ失敗で返す |
| `rigel:<リグ名>/tp` | リグを実行位置へ動かし、実行者の向きにそろえる。locator の entity も置き直す |
| `rigel:<リグ名>/teleport_duration {duration:<tick>}` | root と全 Bone の `teleport_duration` を変える。新しい値は次の tick 以降の tp から効き、同じ tick の tp は前の値で補間される |
| `rigel:<リグ名>/kill` | リグを消す。locator の entity も消す |
| `rigel:<リグ名>/variant/<variant 名>` | variant を適用する。適用する Bone のモデルを差し替え、適用時の関数があれば呼ぶ。variant の keyframe がある tick にも呼ばれる |
| `rigel:<リグ名>/variant/default` | variant で差し替えたモデルを元に戻す。keyframe に `default` を置いた tick にも呼ばれる |
| `rigel:<リグ名>/at_locator/<locator 名> {function:"<名前空間>:<パス>"}` | locator の今の位置で、リグの向きのまま関数を実行する。`@s` は呼び出し元のまま |

locator の今の位置は、storage `rigel:<リグ名> Locators.<locator 名>` に `{x, y, z}` で入っている。値はリグの向きを基準にした左・上・前の距離なので、マクロで `^$(x) ^$(y) ^$(z)` として使える。locator の entity には `rigel.<リグ名>.<locator 名>` のタグが付く。関数名とタグに使う display と locator の名前は、次の順に変換したものになる。

1. 小文字にする。
2. 英小文字・数字・`_` 以外の文字が続く所を、1 つの `_` に変える。
3. 前後の `_` を除く。何も残らないときは `unnamed` にする。
4. 同じ名前になったときは、display、locator の順に数えて、2 つ目から `_2`・`_3` と付ける。

たとえば `Hand (L)` は `hand_l` に、日本語だけの名前は `unnamed` になる。

アニメの番号は、Blockbench のアニメ一覧の並び順で 0 から振る。番号と名前の対応は、`play` の関数の先頭にコメントで書く。once のアニメは最後まで再生すると初期姿勢に戻り、hold のアニメは最後の姿勢で止まる。

`/reload` の後は、共通のデータパックが全リグのフレームの関数を優先度の高い順に温める（先に読み込んでおく）。1 tick に温めるのは 1 かたまりだけ。温め終わる前に再生しても、動きは変わらない。

#### 間引き

間引くと、Bone ごとに、display entity の補間（`interpolation_duration`）で途中の tick を再現できる区間をまとめる。区間の始めに区間の終わりの姿勢を 1 回だけ書き、途中の tick の姿勢は client の補間に任せる。区間にまとめてよいかは、途中の全 tick のずれがずれの上限に収まるかで決める。ずれは Minecraft が行列を分解して補間するのと同じ計算で求める。client が数 tick 分の書き込みをまとめて受け取ると、最後の書き込みしか反映されない。その書き込みの区間は、client が直前に描いた姿勢から始まる。そのため、1 tick だけの区間の直後の区間は、3 tick 前までの姿勢から始まっても大きくずれない長さにとどめる。Bone が消えてから 3 tick のあいだは 1 tick の区間にし、消えた姿勢で終わる 1 tick の区間は、補間せずに（`interpolation_duration` を 0 にして）すぐその姿勢へ移す。補間の途中で次の書き込みが届くと、消す前の大きさの一部が次の区間に持ち越されるからだ。アニメの最初の 3 つの区間は 1 tick にする。書き出しが終わると、フレームの書き込みの行数と、間引く前の行数に対する割合を表示する。

- 書き込みが減るぶん、再生中の負荷と温めた後のメモリが減る。play を呼んだ tick のように全 Bone を書く tick の負荷は減らない。
- client の 1 フレームに 150 ms ほどを超える時間がかかったり、server が遅れを取り戻したりして、4 tick 分以上の書き込みがまとめて届くと、消した Bone が次の区間のあいだ縮みながら見えることがある。
- client が書き込みをまとめて受け取ったり、client のフレームが遅かったりすると、間引いたリグでは次の区間のあいだ、1 tick 分ほど遅れた姿勢が見えることがある。間引かないリグでは、次の tick で正しい姿勢に戻る。
- 間引いたリグでは、stop と pause の後も、各 Bone は client に見えている姿勢で止まる。restart すると、区間の残りの tick で区間の終わりへ続く。pause を呼んだ tick に新しい区間を始めた Bone は、1 tick 前の姿勢で止まることがある。ループの 2 周目以降では、pause の直前に書いた Bone が、restart の後に 1 tick 分の動きを数 tick かけて追うことがある。
- 間引いたリグを stop・pause した後で、間引きを切って書き出し直したら、リグを召喚し直す。召喚し直さないと、止めたときの長い `interpolation_duration` が Bone に残り、リグが動かなくなる。
- 間引いたリグでは、play を呼んだ tick と once のアニメが初期姿勢へ戻る tick に、Bone は補間せずにその姿勢へ移る。同じ姿勢を書いて補間をやり直すと、client が前の区間の補間をもう一度見せるからだ。
- variant の keyframe がある tick では、その variant が書き込む Bone の区間を直前で区切り、その tick から次の区間を書き込む。client は、アイテムが替わると補間を表示中の姿勢からやり直すが、区間の進み具合は引き継ぐ。区間の途中でアイテムが替わると、Bone の動きが一瞬ずれるからだ。すでに止まっている Bone は書き込まない。区間を区切るぶん、その Bone の書き込みは増える。
- 間引いたリグは、stop と pause のときに Bone の `shadow_strength` を書き換え、区間の終わりのフレーム番号を `PortalCooldown` に入れる。`shadow_strength` は `shadow_radius` が 0（既定）なら見た目に出ず、`PortalCooldown` は display entity の動きに関わらない。

#### 書き出しの制限

- 同じリグを 2 体同時には出せない。Bone の UUID が固定のため。
- item model の範囲（中心から 24 px）を超える Bone は、モデルを縮めて書き、表示のときに元の大きさへ戻す。
- 親の Bone の不均一な拡大の下で子が回るなど、直角が保たれない変形では、tick の間の補間で形が少しねじれることがある。
- 拡大率が 0 になる tick の前後で、Bone の向きが回って見えることがある。

## 開発

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
```

## ライセンス

Rigel は GNU Affero General Public License v3.0 以降（AGPL-3.0-or-later）で公開する。本文は [LICENSE](LICENSE) にある。

Rigel で書き出したデータパックとリソースパックは、[OUTPUT-EXCEPTION](OUTPUT-EXCEPTION) の追加の許可によって、AGPL の条件なしで自由に使ったり配布したりできる。Rigel 自体とその改変版には、AGPL の条件が適用される。

Rigel は Animated Java を参考にした独立実装で、Animated Java のコードは含まない。

Copyright (C) 2026 EllaCoat
