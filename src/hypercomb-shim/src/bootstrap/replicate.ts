// hypercomb-shim/src/bootstrap/replicate.ts
//
// ACQUISITION — moved to runtime, re-exported here.
//
// The implementation now lives in `@hypercomb/runtime/acquire`. It began here,
// which was the right first home: the shim is the cold-boot shell and asking a
// domain for a package is the first thing it ever does. But the web shell needs
// the identical call for the identical reason and cannot import the shim, and
// two acquisitions would have drifted on the first change to either.
//
// Nothing about it was shim-specific — it reaches the Store through IoC and
// touches only `window` and `location` — so the move cost nothing and bought
// one implementation for both shells.
//
// This file stays so the shim's own imports keep one stable site.
export {
  acquire,
  hostBases,
  installPackage,
  installedPackageSig,
  listHostPackages,
  selfBases,
  type HostPackage,
  type InstallOutcome,
} from '@hypercomb/runtime/acquire'
