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

## ライセンス

MIT
