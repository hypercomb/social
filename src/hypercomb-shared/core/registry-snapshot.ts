// hypercomb-shared/core/registry-snapshot.ts
//
// The hive's read-only view of the DCP installer's registry projection (#62).
//
// DCP (the installer = control plane) owns the registry — domains, the
// logical install, toggles, eggs. The hive (consumer surface = data plane)
// needs to know the EFFECTIVE installed set so it can render/activate only
// what's actually installed, then direct-fetch the bytes itself.
//
// They're cross-origin (DCP iframe ↔ hive parent), so the bridge is
// postMessage: DCP posts 'hc:registry-snapshot' on every logical change;
// portal-overlay (hive side) re-emits it on EffectBus as 'registry:snapshot'
// (last-value replay). This store subscribes, caches the latest snapshot,
// and exposes it as the hive's RENDER FILTER:
//   - isInLogical(sig)     — is this content effectively installed?
//   - isDomainVisible(dom) — did the participant hide this domain?
//
// Fail-open by design: until a snapshot arrives (the installer hasn't
// spoken yet, or the participant never opened it), everything reads as
// "in logical / visible" so the hive never hides the user's own content
// waiting on the installer. The filter only ever NARROWS once the installer
// has projected an explicit set.

import { EffectBus } from '@hypercomb/core'

export interface RegistrySnapshot {
  logical: string[]
  logicalRootSig: string | null
  domains: { name: string; visible: boolean; branchCount: number }[]
  /** The adopted branches with placement — what the hive RENDERS from.
   *  `logicalRootSig` names a layer materialized inside DCP's own OPFS (not
   *  fetchable from the hive), but each branch root came from a host/relay
   *  and resolves anywhere. The hive mounts `name` as a tile at `at` and
   *  walks the branch tree beneath it. `enabled` is the participant's master
   *  switch for the branch — the hive mounts only enabled branches, so solo
   *  reflects "the features that are on" (absent = enabled, for snapshots
   *  from builds that predate the field). Optional: older DCP builds didn't
   *  post branches at all. */
  branches?: { domain: string; name: string; branchSig: string; at: string[]; enabled?: boolean }[]
  generatedAt: number
}

const STORAGE_KEY = 'hc:registry-snapshot'

export class RegistrySnapshotStore extends EventTarget {
  #snapshot: RegistrySnapshot | null = null
  #logical = new Set<string>()

  constructor() {
    super()
    // Hydrate the LAST projected snapshot. The live channel only flows while
    // the installer iframe is open (portal-overlay relays + origin-checks),
    // so without persistence every hive reload forgot the configuration and
    // solo stopped reflecting the adopted/enabled set until the participant
    // re-opened the installer. Fail-open is preserved: a participant who
    // never opened the installer has nothing persisted and everything still
    // reads as in-logical/visible.
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) this.#apply(JSON.parse(raw) as RegistrySnapshot, false)
    } catch { /* corrupt/absent — stay fail-open */ }
    EffectBus.on<RegistrySnapshot>('registry:snapshot', (snap) => this.#apply(snap, true))
  }

  #apply(snap: RegistrySnapshot, persist: boolean): void {
    if (!snap || !Array.isArray(snap.logical)) return
    this.#snapshot = snap
    this.#logical = new Set(snap.logical.map(s => String(s ?? '').toLowerCase()))
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snap)) } catch { /* quota — live copy still works */ }
    }
    this.dispatchEvent(new CustomEvent('change'))
  }

  /** The latest snapshot, or null if none received yet. */
  get snapshot(): RegistrySnapshot | null { return this.#snapshot }

  /** Is a content sig in the effective (logical) install? Fail-open: true
   *  when no snapshot has arrived yet, so the hive renders before the
   *  installer has spoken. Once a snapshot exists, only its `logical` set
   *  passes. */
  isInLogical(sig: string): boolean {
    if (!this.#snapshot) return true
    return this.#logical.has(String(sig ?? '').toLowerCase())
  }

  /** Is a domain visible per the participant's installer visibility toggle?
   *  Default true when unknown / no snapshot. */
  isDomainVisible(domain: string): boolean {
    const d = this.#snapshot?.domains?.find(x => x.name === domain)
    return d ? d.visible : true
  }
}

register('@hypercomb.social/RegistrySnapshot', new RegistrySnapshotStore())
