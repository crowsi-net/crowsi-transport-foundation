# @crowsi/transport-foundation

[English](README.md)

ローカルprocess間で、上限付きmessageを交換します。framingやtimeoutの処理を、利用側で作り直す必要を減らします。

## 提供する機能

- messageを読み取る前に、サイズと時間の制限を適用します。
- RustとNodeのtransport実装を利用できます。

## 現在の責務

認証、認可、messageの意味は呼出側が担当します。
この文書はpackage配布を有効化しません。checkoutしたソースと宣言済みの依存版を使い、公開配布の有無は別途確認してください。

## 開始手順

Rust 1.97.0以降を導入し、宣言済みの依存を利用できるようにします。公開配布されていない依存には、設定済みprivate registryを使います。このrepositoryで実行してください。

```sh
npm install
npm run test
```

## 文書とソース

[使い方](https://github.com/crowsi-net/crowsi-transport-foundation/blob/main/docs/getting-started.md)

[実装と公開インターフェース](https://github.com/crowsi-net/crowsi-transport-foundation/tree/main/src) · [Rust検証ケース](https://github.com/crowsi-net/crowsi-transport-foundation/tree/main/tests) · [Node検証ケース](https://github.com/crowsi-net/crowsi-transport-foundation/tree/main/test) · [貢献方法](https://github.com/crowsi-net/crowsi-transport-foundation/blob/main/CONTRIBUTING.md) · [セキュリティ報告](https://github.com/crowsi-net/crowsi-transport-foundation/blob/main/SECURITY.md) · [ライセンス](LICENSE) · [帰属表示](NOTICE)
