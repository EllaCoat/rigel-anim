# Rigel

Blockbench で作ったモデルとアニメーションを、Minecraft Java Edition の display entity で動くデータパックとリソースパックへ書き出す Blockbench プラグイン。

- 書き出し先の版：Minecraft 1.20.4 と 26.3
- 対応する Blockbench：デスクトップ版の 5.2.1 以降

開発の初期段階で、データパックとリソースパックの書き出しはまだできない。いま使えるのは、モデル形式「Rigel Rig」とキーフレームのイージングだけ。

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

### 制限

- bezier の区間と、前後にキーフレームがない catmullrom の端では、back・elastic の行き過ぎが端の値で止まる。
- 変換すると step の区間や、隣の区間の行き過ぎるイージングの形が変わってしまう場合は、変換しない。

## 由来

[Animated Java](https://github.com/Animated-Java/animated-java) に着想を得た独立実装。Animated Java のコードやテンプレートは含まない。

## 開発

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
```

## ライセンス

MIT
