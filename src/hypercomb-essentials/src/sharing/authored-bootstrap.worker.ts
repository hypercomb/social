// sharing/authored-bootstrap.worker.ts
//
// Keeps the authored-sigs allow-set (authored-sigs.ts) whole: every session it
// reconciles the sign('authored') pool with the localStorage cache, so
// authorship survives a localStorage clear. Runs OFF the boot path —
// idle-scheduled, never gates paint.
//
// THE GRANDFATHERING WALK IS RETIRED (2026-11-16, jwize: "make sure we aren't
// vulnerable"). It once walked the whole lineage and marked every page it
// found as this hive's own, skipping only the adopted and carried roots. Those
// lists live in localStorage alone, so on a new device, a restored hive or a
// cleared cache they are empty and the walk marked a peer's pages as yours —
// and an authored page runs in the hive itself, unsealed (feature-availability
// .ts runsSealed). Nothing in a walk can tell a peer's page from your own. So
// nothing is marked by walking: a page is yours because this hive wrote it
// (the bridge, the website and tile-file writers, a page made from one of
// yours). An older page of yours that was never marked runs sealed — it still
// shows; it cannot reach the hive until it is written again.

import { Worker } from '@hypercomb/core'
import { reconcileAuthoredPool } from './authored-sigs.js'

export class AuthoredBootstrapWorker extends Worker {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'keeps the authored-sigs pool and cache reconciled; marks nothing by walking'

  protected override ready = (): boolean => !!(globalThis as any).ioc?.get('@hypercomb.social/Store')

  protected override act = async (): Promise<void> => {
    const idle = (globalThis as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout: number }) => number)
      | undefined
    const run = (): void => { void reconcileAuthoredPool().catch(() => 0) }
    if (idle) idle(run, { timeout: 10_000 })
    else setTimeout(run, 3_000)
  }
}

const _authoredBootstrap = new AuthoredBootstrapWorker()
window.ioc.register('@diamondcoreprocessor.com/AuthoredBootstrapWorker', _authoredBootstrap)
