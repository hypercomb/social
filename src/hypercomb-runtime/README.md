# @hypercomb/runtime

The runtime a Hypercomb **host** needs — and nothing a shell does.

This package exists so `hypercomb-shim` can ship without the monorepo. It was
carved out of `hypercomb-shared/core`, which keeps everything shell-shaped: the
Angular panels, the UI stores, the chrome. What lives here is the part with no
opinion about how anything looks.

```
ioc.web            installs window.ioc
store              OPFS: read by signature, pools of meaning, sigbags
script-preloader   imports bees; the processor's BeeResolver
dependency-loader  namespace bundles (retires with the import map, Phase 4)
runtime-initializer  i18n, layer materialisation, host resolution
replication-walker   THE protocol: resolve a closure, verify every atom
sealed-package     the closed boundary an installer may hydrate
packed-store-*     the packed store and its one-way-door gate
native-filesystem  Tauri/WebView2 storage override (no-op in a browser)
shell-surface-registry  what mounts, framework-free
install-monitor · proximity-registry · sw-domains
```

**Nothing here may import `hypercomb-shared`.** The dependency runs one way:
`runtime → @hypercomb/core`. A shell may consume this package; this package may
never reach back up. That rule is what makes the boundary real rather than
nominal — see [the scope](../documentation/shim-extraction-scope.md).

While the migration is in flight, `hypercomb-shared/core/*` keeps thin
re-export stubs at the old paths, so web and dev are unchanged. They are
temporary: as importers move to `@hypercomb/runtime`, the stubs delete.
