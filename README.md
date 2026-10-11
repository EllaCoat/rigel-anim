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
| ずれの上限 | 間引くときに許す、本来の姿勢とのずれ。位置（ブロック）と向き（度）で決め、拡大のずれ（割合）には向きの値をラジアンにして使う |
| 1 回の書き込みで補間する上限 | 1 回の書き込みで補間に任せる tick 数の上限。既定は 20 |
| 温めの優先度 | アニメごとに `xhigh`・`high`・`low`。既定は `high` |
| 間引き（アニメごと） | プロジェクトと同じ・間引かない・このアニメの値（位置と向き） |

設定と、初回に作る固有 ID（Bone の UUID に使う）はプロジェクトファイルに入るので、確定した後にプロジェクトを保存する。フォルダへ書き込む前に、Blockbench が初回だけ許可を求める。

書き出すものは次のとおり。

- `datapacks/<リグ名>/`：そのリグのデータパック。
- `datapacks/rigel/`：全リグで共有するデータパック。どのリグを書き出しても同じ内容になる。
- リソースパックの `assets/rigel/models/<リグ名>/` と `assets/rigel/textures/item/<リグ名>/`：Bone のモデルとテクスチャ。
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
| `rigel:<リグ名>/tp` | リグを実行位置へ動かし、実行者の向きにそろえる |
| `rigel:<リグ名>/kill` | リグを消す |

アニメの番号は、Blockbench のアニメ一覧の並び順で 0 から振る。番号と名前の対応は、`play` の関数の先頭にコメントで書く。once のアニメは最後まで再生すると初期姿勢に戻り、hold のアニメは最後の姿勢で止まる。

`/reload` の後は、共通のデータパックが全リグのフレームの関数を優先度の高い順に温める（先に読み込んでおく）。1 tick に温めるのは 1 かたまりだけ。温め終わる前に再生しても、動きは変わらない。

#### 間引き

間引くと、Bone ごとに、display entity の補間（`interpolation_duration`）で途中の tick を再現できる区間をまとめる。区間の始めに区間の終わりの姿勢を 1 回だけ書き、途中の tick の姿勢は client の補間に任せる。区間にまとめてよいかは、途中の全 tick のずれがずれの上限に収まるかで決める。ずれは Minecraft が行列を分解して補間するのと同じ計算で求める。client が数 tick 分の書き込みをまとめて受け取ると、最後の書き込みしか反映されない。そのため、1 tick だけの区間の直後の区間は、2 tick 前までの姿勢から始まっても大きくずれない長さにとどめる。アニメの最初の 2 つの区間は 1 tick にする。書き出しが終わると、フレームの書き込みの行数と、間引く前の行数に対する割合を表示する。

- 書き込みが減るぶん、再生中の負荷と温めた後のメモリが減る。play を呼んだ tick のように全 Bone を書く tick の負荷は減らない。
- 間引いたリグでは、stop と pause の後も、各 Bone は client に見えている姿勢で止まる。restart すると、区間の残りの tick で区間の終わりへ続く。pause を呼んだ tick に新しい区間を始めた Bone は、1 tick 前の姿勢で止まることがある。ループの 2 周目以降では、pause の直前に書いた Bone が、restart の後に 1 tick 分の動きを数 tick かけて追うことがある。
- 間引いたリグを stop・pause した後で、間引きを切って書き出し直したら、リグを召喚し直す。召喚し直さないと、止めたときの長い `interpolation_duration` が Bone に残り、リグが動かなくなる。
- 間引いたリグでは、play を呼んだ tick と once のアニメが初期姿勢へ戻る tick に、Bone は補間せずにその姿勢へ移る。同じ姿勢を書いて補間をやり直すと、client が前の区間の補間をもう一度見せるからだ。
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
