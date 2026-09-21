// hypercomb-core/src/retired-exports.ts
//
// Names core no longer uses but still EXPORTS, because the export surface is a
// protocol. Bees and dependencies are built with `@hypercomb/core` external;
// the live shell serves core, and a package already in a participant's OPFS
// imports from whatever core that shell ships. Remove a name here and every
// installed package that imports it fails to evaluate with "does not provide
// an export named" — and the shell that should offer the upgrade is running
// beside those broken packages.
//
// Observed 2026-09-21 on a Mac: `ATOMIZER_IOC_PREFIX` (retired 2026-09-01 with
// the atomizer, bc603aae5) was imported by a still-installed package, so its
// dependency failed to load. `export-surface.spec.ts` stops a removal like that
// from shipping again.

/** Retired with the atomizer (break-apart is the one decompose verb). */
export const ATOMIZER_IOC_PREFIX = '@hypercomb.social/Atomizer:'

/** Retired with the atomizer (break-apart is the one decompose verb). */
export const ATOMIZABLE_TARGET_PREFIX = '@hypercomb.social/AtomizableTarget:'
