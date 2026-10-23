# ローカル操作制御のplayground

[English](README.md)

実際のprovider transport TGZをcheckout外の一時consumerへ導入して公開APIを試します。trusted ownerが擬似account/操作を束縛し、変更を許可して読戻し、replayとJSON escapeのcredential反射を拒否します。

repo rootから実行します。

```sh
npm --prefix packages/crowsi-provider-http-transport ci --ignore-scripts --workspaces=false
npm --prefix packages/crowsi-provider-http-transport run build --workspaces=false
node .github/scripts/provider-consumer.mjs
```

runnerはbuild済みpackageをpackし、空npm設定とpublic registry cacheで公開TypeScript型を検証してdemo.mjsを実行します。自分で生成した一時consumerだけを片付けます。credential/HTTPは擬似で、CLI credential、keyring、実account/cloud resource/invoiceへ接続しません。

prepare/approve/executeのcompositionはownerが持ち、生成コードには渡しません。メモリ内grantは単回・期限付きですが、署名付き永続native認可やOS sandboxではありません。Windows/nativeと実account受入は別条件です。

ownerのPR/mainでconsumerを検証し、版タグのpublish-npm.ymlでCI成功・source・配布物hashを照合してからEnvironmentレビューとnpm所有者承認へ進みます。private管理repoや隣接sourceに依存しません。
