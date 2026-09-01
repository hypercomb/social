// hypercomb-runtime/src/index.ts
//
// The barrel. Deep imports (`@hypercomb/runtime/store`) are first-class and
// preferred in hosts — a shim that wants the read side should not pull the
// whole package to get it — but the barrel is what a shell consumes and what
// keeps the old `@hypercomb/shared/core` surface intact during the migration.
//
// `ioc.web` is exported for its SIDE EFFECT as much as its API: importing it
// installs `window.ioc`, and everything below registers into that at module
// scope. A host loads it first, always.

// Side effect only — ioc.web exports nothing; it INSTALLS window.ioc and the
// bare get/register globals that every module below uses at module scope.
import './ioc.web'
export * from './store'
export * from './script-preloader'
export * from './dependency-loader'
export * from './runtime-initializer'
export * from './replication-walker'
export * from './sealed-package'
export * from './shell-surface-registry'
export * from './install-monitor'
export * from './proximity-registry'
export * from './sw-domains'
export * from './packed-store-engine'
export * from './packed-store-gate'
export * from './packed-bridge'
export * from './native-filesystem'
export * from './i18n.service'
export * from './shell-contracts'
