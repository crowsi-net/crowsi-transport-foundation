# Using the transport / 導入

## 日本語

利用appが承認した接続先をcanonical HTTPS originのallowlistとして渡します。
公開確認後は`@crowsi/provider-http-transport@0.10.0`をexact registry参照で導入し、利用repo自身のlockfileを生成してください。
現在は公開準備中です。配布物の検証には、同じ版の承認済みTGZを別appにインストールします。

requestの認証headersと許可originはapp所有者の責任で設定します。URLに認証情報を入れず、redirect先を暗黙に許可しません。
返るHTTP status/bodyをappが解釈し、失敗時は`ProviderTransportError.code`を扱います。causeの内容には秘密が含まれ得ます。
AbortSignalでcaller cancellationを指定できます。timeoutはfetchとresponse body読み取りの両方を対象にします。
独自fetchは信頼されたhookであり、通信設定に従う必要があります。

```sh
npm ci
npm test
npm run typecheck
npm pack
```

開発の検証環境はNode24.15.0/npm11.12.1です。runtimeはNode22以上を宣言しています。
配布物のpublic import・型・境界動作を新規consumerで試し、公開後はregistry metadata/integrityを確認して利用側install/build/testへ進みます。

## English

The consuming application supplies a reviewed canonical HTTPS-origin allowlist and explicit authentication headers.
Once registry availability is verified, install the exact `0.10.0` version and generate the consumer's own lockfile. Until then, test the exact reviewed TGZ in a separate host.

Use AbortSignal for caller cancellation. Timeout covers both fetch and response-body waiting; custom fetch implementations are trusted and must honor the transport settings.
Interpret HTTP statuses in the application and handle safe error codes. Retained causes may contain sensitive driver details.
Run the development checks above, verify the actual archive's import/types in a fresh consumer, then verify registry metadata/integrity before migration.
Release checks use Node24.15.0/npm11.12.1; the runtime declares Node22+.
