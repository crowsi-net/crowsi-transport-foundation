# Local operation control playground

[日本語](README.ja.md)

Run a public-API example against the actual packed provider transport, in a temporary consumer outside this checkout. The trusted owner binds a synthetic account and operation catalog, grants a write, reads the resulting state and rejects replay and escaped credential reflection.

From the repository root:

```sh
npm --prefix packages/crowsi-provider-http-transport ci --ignore-scripts --workspaces=false
npm --prefix packages/crowsi-provider-http-transport run build --workspaces=false
node .github/scripts/provider-consumer.mjs
```

The runner packs the built package, uses empty npm configuration and a public registry cache, verifies exported TypeScript types and executes demo.mjs. It removes only its newly created temporary consumer. Credentials and HTTP are synthetic; no CLI credential, keyring, provider account, cloud resource or invoice is accessed.

The example gives the owner prepare/approve/execute and never grants that composition to generated code. In-memory grants are one-use and expire; they are not a durable signed native authorization or an OS sandbox. Windows/native acceptance and real-account operations remain separate owner requirements.

The provider-consumer workflow runs this example on owner pull requests and main. The existing publish-provider.yml trust binding is retained and verifies the consumer before publication. It needs no private coordinator or neighboring source repository.
