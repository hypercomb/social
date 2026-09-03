// hypercomb-shared/core/ioc.web.ts
//
// MIGRATION STUB — see the note in store.ts. This one is a SIDE-EFFECT
// re-export, not `export *`: ioc.web exports nothing at all. It installs
// `window.ioc` and the bare get/register globals, which is the whole reason
// every shell imports it first.
//
// ── IT IS THE SHELL'S POLYFILL, AND THAT IS NOT A FORMALITY ─────────────
//
// Thirty-one modules in hypercomb-shared/core call the bare `register(...)`
// global at module top level. That is only sound if this module's body has
// already run when theirs does, and "first import in main.ts" does NOT
// guarantee it: the bundler is free to inline an entry-only side-effect module
// into main's own body, which evaluates AFTER every chunk main imports. When
// that happened, the first shared module in the first chunk threw
// `ReferenceError: register is not defined`, window.ioc was never installed,
// and both shells died on the splash with nothing but that one line to go on.
//
// So both angular.json files list this module as the app's `polyfills` entry.
// Angular emits it as its own bundle and index.html loads it BEFORE main.js —
// which is exactly what a polyfill is: the thing that must exist before the
// application does. The import in main.ts stays as documentation of the
// dependency and is a no-op the second time (the installer is guarded).
//
// If you ever remove the polyfills entry, you are betting the whole boot on
// chunk ordering. Don't.
import '@hypercomb/runtime/ioc.web'
