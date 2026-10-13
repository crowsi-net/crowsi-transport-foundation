# Native worker and trusted owner

Build the pinned `crowsi-network-sandbox` example `execute-port-worker`, then set
`CROWSI_WORKLOAD_HELPER` to its absolute executable path and run
`node .github/scripts/provider-consumer.mjs` from this repository.
This packs and installs the candidate into a separate consumer directory.

The trusted parent owns the operation catalog, synthetic credential and approval.
A real isolated worker receives only one-use execute handles. The fixture checks
that the worker cannot read a private owner file, inherit the synthetic secret,
or connect to a host loopback listener. A synthetic write and read-back succeed;
worker approval injection and replay fail before another HTTP call.

No cloud account, real credential, service installation or production operation is
used. Linux requires reviewed bubblewrap and timeout executables; CI installs its
pinned OS prerequisite only on its disposable runner.
