// hypercomb-shared/core/ioc.web.ts
//
// MIGRATION STUB — see the note in store.ts. This one is a SIDE-EFFECT
// re-export, not `export *`: ioc.web exports nothing at all. It installs
// `window.ioc` and the bare get/register globals, which is the whole reason
// every shell imports it first.
import '@hypercomb/runtime/ioc.web'
