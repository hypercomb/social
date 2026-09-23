// sharing/sharing.boot.drone.ts
//
// THE SHARING BOOT BEE (atomic-modules-plan.md, step 6). The store stages
// what it reads to the host through `@HostSyncService` from the first read,
// and the signer is what every publishing path signs with — so a boot bee,
// loaded right after the dependencies, registers them. Both are dependencies;
// this bee is the one that registers them.

import { Drone } from '@hypercomb/core'
import { NostrSigner } from './nostr-signer.js'
import { hostSyncService } from './host-sync.service.js'
// The retired push pool's collector schedules itself when loaded, as it did
// in the namespace bundle at boot; the boot lane keeps that timing.
import './retired-push-pool.js'

export class SharingBootDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'

  public override description =
    'Sharing at boot: registers the Nostr signer and the host sync (and its runtime contract key).'

  protected override sense = (): boolean => false
}

window.ioc.register('@diamondcoreprocessor.com/NostrSigner', new NostrSigner())
window.ioc.register('@diamondcoreprocessor.com/HostSyncService', hostSyncService)
// RUNTIME CONTRACT KEY — @hypercomb/runtime names no essentials namespace and
// resolves this as '@HostSyncService'. The store's read-triggered staging (the
// author's push half) goes through that key; without it, it is inert.
window.ioc.register('@HostSyncService', hostSyncService)

window.ioc.register('@diamondcoreprocessor.com/SharingBootDrone', new SharingBootDrone())
