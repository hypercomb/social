// sharing/sharing.boot.drone.ts
//
// THE SHARING BOOT BEE (atomic-modules-plan.md, step 6). The store stages
// what it reads to the host through `@HostSyncService` from the first read,
// and the signer is what every publishing path signs with — so a boot bee,
// loaded right after the dependencies, registers them. Both are dependencies;
// this bee is the one that registers them.

import { Drone, textThemeChanges } from '@hypercomb/core'
import { NostrSigner } from './nostr-signer.js'
import { hostSyncService } from './host-sync.service.js'
import { setTextThemeOffering, textThemeOfferingStatus, textThemeOfferHost } from './text-theme-offering.js'
import { reconcileCodeTrust, trustCode, trustedCodeDomains, untrustCode } from './code-trust.js'
// The retired push pool's collector schedules itself when loaded, as it did
// in the namespace bundle at boot; the boot lane keeps that timing.
import './retired-push-pool.js'

export class SharingBootDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  /** The boot lane: named in the root, loaded before the bee wave. */
  readonly lane = 'boot'

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

if (!(window as Window & { __HC_READONLY__?: boolean }).__HC_READONLY__) {
  window.ioc.register('@diamondcoreprocessor.com/TextThemeOffering', {
    defaultHost: () => textThemeOfferHost(hostSyncService),
    status: textThemeOfferingStatus,
    set: setTextThemeOffering,
  })
  textThemeChanges.dispatchEvent(new Event('change'))
  // WHOSE CODE MAY RUN HERE (code-trust.ts): the one consent the shell's
  // TrustService and the host directory both keep, held in the trust:code
  // pool. Reconciled with its read cache once the store is up.
  window.ioc.register('@diamondcoreprocessor.com/CodeTrust', {
    trusted: trustedCodeDomains,
    trust: trustCode,
    untrust: untrustCode,
  })
  window.ioc.whenReady('@hypercomb.social/Store', () => { void reconcileCodeTrust() })
}

window.ioc.register('@diamondcoreprocessor.com/SharingBootDrone', new SharingBootDrone())
