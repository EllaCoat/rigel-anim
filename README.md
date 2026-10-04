# Rigel

Blockbench プラグイン。Blockbench で作ったモデルとアニメーションを、Minecraft Java Edition の display entity で動くデータパックとリソースパックへ出力する。

- 出力先の版：Minecraft 1.20.4 と 26.3
- 対応する Blockbench：最新の安定版

開発初期で、まだ使える状態ではない。

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

## ライセンス

MIT
