// hypercomb-shim/src/bootstrap/index.ts
//
// THE BOOTSTRAP BUNDLE. Acquisition, delivered as signed content.
//
// This file is NOT part of main.js. It is built separately into one ESM
// module, hashed, and written to the origin under its own signature — and the
// shim reaches it the same way it reaches everything else: by signature,
// verified before it runs. That is the whole point of Phase 4. The installer
// stops being privileged code baked into the shell and becomes a thing you can
// fork, pin, audit, and replace, exactly like a bee.
//
// THE CHICKEN-AND-EGG, and how it is resolved: acquisition cannot be fetched
// from OPFS when OPFS is empty, so something has to know one address before
// anything is installed. The shim knows exactly ONE signature — the pin — and
// nothing else. Everything downstream of that is content-addressed.
//
// WHAT MAY LIVE HERE: anything that only needs `window.ioc` and
// `@hypercomb/core`. Nothing else may be imported from shared — a second copy
// of a stateful shared module (Store above all) would mint a second instance
// and a second IoC registration. The two pure modules this bundle does carry
// (the replication walker and the sealed-package validator) are stateless
// functions over bytes, which is exactly why they are safe to duplicate.
//
// `@hypercomb/core` is EXTERNAL — resolved through the import map, which the
// shim attaches before it loads this bundle. Its `@hypercomb/core` entry is
// unconditional (set before any OPFS access), so it resolves on the coldest
// possible boot.

import { showHostPanel } from './host-panel'

export type BootstrapContext = {
  /** Why the shim loaded us: 'cold' when nothing mounted, 'warm' otherwise.
   *  Present so this bundle can grow an update check without the shim having
   *  to learn what an update is. */
  reason?: 'cold' | 'warm'
}

export type Acquisition = {
  /** Put the add-a-domain card up. Idempotent. */
  prompt(): void
}

/**
 * The bundle's entry point. Called once per boot, immediately after the shim
 * verifies these bytes against the pin.
 *
 * It deliberately does NOT install anything on its own. Acquisition is
 * consumer-requested by doctrine (install-by-replication.md: "The consumer
 * asks; the icon is the answer; the human decides"), so the only thing that
 * ever writes to the heap is a person clicking a package.
 */
export const boot = (_context: BootstrapContext = {}): Acquisition => ({
  prompt: showHostPanel,
})

export { installPackage, installedPackageSig, listHostPackages } from './replicate'
export { addHostZone, hostZone, listHostZones, removeHostZone } from './hosts'
