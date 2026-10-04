# Rigel

Blockbench プラグイン。Blockbench で作ったモデルとアニメーションを、Minecraft Java Edition の display entity で動くデータパックとリソースパックへ出力する。

- 出力先の版：Minecraft 1.20.4 と 26.3
- 対応する Blockbench：最新の安定版

開発初期で、まだ使える状態ではない。

## イージング

rigel のモデル形式のプロジェクトでは、キーフレームの右クリックメニュー「イージング」から、そのキーフレームで始まる区間にイージングを当てられる。キーフレームの補間方式（linear・catmullrom・bezier）はそのままで、区間の中の進み方だけが変わる。

- 組み込み：sine・quad・cubic・quart・quint・expo・circ・back・elastic・bounce の In・Out・InOut（30 種）
- 行き過ぎ（back・elastic）：linear の区間では直線の先へ、catmullrom の区間では隣の区間の曲線の上へ行き過ぎる。bezier の区間と、前後にキーフレームがない catmullrom の端では、Blockbench が曲線を延ばせないので端の値で止まる
- 「プリセットを管理…」：ベジェの形（CSS の `cubic-bezier()` と同じ 4 つの値）や、back の行き過ぎの量・elastic の振幅と周期を変えた関数をプリセットとして保存する。保存先はこの PC の Blockbench で、JSON で書き出して別の PC で読み込める。当てたキーフレームには形そのものが写るので、プロジェクトだけで同じ動きを再生でき、後でプリセットを編集しても当て済みのキーフレームは変わらない

## 由来

[Animated Java](https://github.com/Animated-Java/animated-java) に着想を得た独立実装。Animated Java のコードやテンプレートは含まない。

## 開発

[bun](https://bun.com) 1.4.2 を使う。依存は公開から 7 日以上経った版だけを解決し（`bunfig.toml`）、install script は実行しない（`package.json` の `trustedDependencies`）。

```sh
bun install --frozen-lockfile
bun run typecheck
bun run build     # dist/rigel.js
bun run test      # 成功は 1 行の集計、失敗は失敗したテストの診断だけを表示。全出力は .test-logs/ に残る
```

bun が PATH に無い環境では、`npm exec --yes --package=bun@1.4.2 -- bun run build` のように版を指定して実行できる。

### 検証用の Blockbench

実機での確認には、公式 release の Blockbench 5.2.1（portable 版）から取り出したアプリを `%LOCALAPPDATA%\rigel-anim\blockbench-5.2.1` に置いた、検証用の Blockbench を使う（Windows 用、展開に 7-Zip が必要）。普段使いの Blockbench とはアプリもデータ領域も分かれていて、自動更新はしない。

```sh
bun scripts/dev-bb.ts setup      # portable 版をダウンロードし、SHA-256 を照合して展開する
bun scripts/dev-bb.ts launch     # 127.0.0.1 だけの開発者用ポート（9467）で起動する
bun scripts/dev-bb.ts install    # dist/rigel.js を読み込み直し、読み込み中に出たエラーを表示する
bun scripts/dev-bb.ts eval "return Plugins.registered.rigel?.version"
bun scripts/dev-bb.ts stop       # 保存せずに終了する
```

### 焼き込みの確認と書き込み数の集計

`scripts/bake-stats.ts` は、起動中の検証用 Blockbench でリグのアニメを tick ごとの値に焼き込み、次の値を表にする。プラグインを `install` してから実行する。

- display entity への書き込み数：毎 tick 全 Bone に書く場合、値が変わった Bone だけに書く場合、補間で再現できる tick を省く場合（許容誤差 3 段階）
- 焼き込んだ値と Blockbench のプレビューの差、量子化の誤差、tick の中間で補間された姿勢のずれ

```sh
bun scripts/bake-stats.ts --synthetic                 # 補間・せん断・拡大 0・ミラーを含む合成リグ
bun scripts/bake-stats.ts path/to/blueprints          # Animated Java の .ajblueprint（ファイルかフォルダ）
```

アニメごとの詳しい結果は `--out` に指定したファイル（既定は OS の一時フォルダ）に JSON で保存する。

## ライセンス

MIT
