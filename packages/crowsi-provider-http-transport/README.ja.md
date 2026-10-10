# @crowsi/provider-http-transport

[English](README.md)

許可したHTTPS originへ、request/responseのbyte上限とtimeout付きでHTTP通信を行います。製品API、認証方式、アカウント、データ保存は含みません。

## 導入と使い方

`0.10.0`はnpmで公開済みです。実際の接続先と認証方針は、利用アプリの所有者が確認して設定してください。

```sh
npm install --save-exact @crowsi/provider-http-transport@0.10.0
```

```js
import { createProviderHttpTransport } from '@crowsi/provider-http-transport'
const transport = createProviderHttpTransport({
  allowedOrigins: ['https://provider.example'],
  maximumRequestBytes: 65536,
  maximumResponseBytes: 1048576,
  timeoutMs: 15000
})
// 実際の接続先・認証情報は利用appの所有者が設定します。
const result = await transport.request({ url: 'https://provider.example/items' })
```

## 通信方針と上限

- originはpath、末尾slash、userinfoを含まないcanonical HTTPS originを指定します。HTTP、別origin/port、URL内認証情報、fragment、redirectを拒否します。
- methodはGET/POST/PATCH/PUT/DELETEだけを許可します。GET/DELETEのbodyは拒否します。
- string、URLSearchParams、ArrayBuffer/view、Blobを実byte数で検査します。FormDataやstreamなど、事前に数えられないbodyは、宣言がBodyInitでもruntimeで拒否します。
- byte上限は1 byte〜16 MiB、timeoutは1〜60000 msです。既定はrequest 64 KiB、response 1 MiB、timeout 15000 msです。

responseは`status`、`statusText`、`Headers`、`Uint8Array`のbodyを返します。HTTPエラーstatusの解釈は利用アプリが行います。
停止したfetch/body待ちもabortまたはtimeoutで終了します。best-effortのstream cancel処理を待ち続けて結果を止めることはありません。
caller cancellationは`transport/request/aborted`、内部timerは`transport/request/timeout`、通信失敗は`transport/request/unavailable`です。origin、サイズ、method、redirectのエラーも`ProviderTransportError.code`で判定できます。

## 認証情報と時間制限

callerのheadersをfetchへ渡し、request情報は結果に追加しません。認証headerの生成・保存・ログ出力は行いません。
browser fetchの既定credentials/CORS/cookie動作は変更しません。同一originでは既定動作でcookieが送られることがあります。
`cause`は診断用の元エラーを保持し、URLや認証情報を含み得ます。詳細なcauseをログへ出さず、安全なcodeで扱ってください。
`fetchImplementation`は信頼された差替え用で、signalとmanual redirectに従う責任があります。それらを無視する実装の外部通信を強制停止するsandboxではありません。
timeoutは非同期I/O待ちを制限します。event loop停止やbrowser休止中の実時間は保証しません。

## 開発と検証

runtimeはNode.js 22以降です。リリース検査はNode.js 24.15.0、npm 11.12.1を使用します。

```sh
npm ci
npm run check
npm test
npm pack
```

`src/*.mts`が型付き実装です。`npm run build`で`dist/*.mjs`と型宣言を同時に生成します。生成物を手で編集したりcommitしたりしないでください。
`npm run check`はBiome format/lint、実装とconsumerのstrict型検査、要求された120物理行制限を検証します。内部規則は空行・コメントを除いた149行ですが、これらの検査はより厳しい物理行制限を適用します。
`prepack`は検査、build、runtime testsを実行します。公開前に、正確なarchiveをfresh consumerで確認してください。
合成fetch/streamケースとloopback専用adapterで失敗経路を検証します。実TLS、browser cookie/CORS、顧客サービスとの互換性を示すものではありません。テストでは実providerの認証情報や外部mail APIを使いません。

[使い方](https://github.com/crowsi-net/crowsi-provider-http-transport/blob/main/docs/getting-started.md) · [セキュリティ報告](SECURITY.md) · [Apache-2.0](LICENSE) · [帰属表示](NOTICE)
