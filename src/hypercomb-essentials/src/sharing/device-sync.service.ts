// sharing/device-sync.service.ts
//
// THE PART THAT CONNECTS (documentation/device-sync.md). A paired device
//
//   - ANSWERS: once this device is paired it listens at the participant's
//     rendezvous address and serves its heads and atoms to any of the
//     participant's other devices that pass the proof. An unpaired device opens
//     nothing — no relay subscription, no cost.
//   - DIALS on request: `device-sync:run` (the Sync button beside Save) dials
//     every other device, runs the walk (device-sync.ts) against each that
//     answers, and reports what moved. Any device can be the backup; the one
//     whose button was pressed walks.
//
// It publishes ONE state on the bus — `device-sync:state`, last-value replayed
// — so the shell's button never asks the service anything: it shows what the
// last state says. A press while a run is going does nothing.
//
// It runs only when asked. The walk is not scheduled, not on boot, not on a
// timer: a participant who never presses Sync never has a byte leave or arrive.
//
// A DEPENDENCY: it registers nothing and subscribes to nothing. The one bee that
// wires it is device-sync.drone.ts (registration is the bee's act).

import { EffectBus, hypercomb, get, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { WALKER_IOC_KEY_LOCAL, type WalkerLike } from './device-sync.walker.js'
import { DeviceLink, type LinkIdentity } from './device-link.js'
import { activeDevices, knownEvents, loadPairing, ownGrant, type PairingState } from './device-pairing.js'
import { DeviceSignaler, type SignalCipher, type SignalMesh } from './device-signal.js'
import { answer, dial, type RtcOptions } from './device-rtc.js'
import { syncFromPeer, type Pull, type SyncProgress, type SyncSummary } from './device-sync.js'
import { localIo, serveOf, syncStore, type RealStoreLike } from './device-sync.store.js'
import type { EventSigner } from './device-delegation.js'

export const DEVICE_SYNC_STATE = 'device-sync:state'
export const DEVICE_SYNC_RUN = 'device-sync:run'

export type DeviceSyncState = {
  /** This device is paired — the Sync button shows only then. */
  paired: boolean
  /** Other devices the participant has. */
  peers: number
  phase: 'idle' | 'syncing' | 'done' | 'error'
  progress?: SyncProgress
  summary?: Totals
  at?: number
}

export type Totals = {
  reached: number
  unreachable: number
  advanced: number
  markers: number
  forks: number
  failed: number
}

export type SyncDeps = {
  store: RealStoreLike & Parameters<typeof loadPairing>[0]
  mesh: SignalMesh
  signer: SignalCipher & EventSigner & { knownPublicKeyHex?: () => Promise<string | null> }
  walker: WalkerLike
  rtc?: RtcOptions
}

const t = (key: string, fallback: string, params: Record<string, string> = {}): string => {
  const value = get<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
  return value && value !== key ? value : fallback.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? '')
}

const fromIoc = (): SyncDeps | null => {
  const store = get<SyncDeps['store']>('@hypercomb.social/Store')
  const mesh = get<SyncDeps['mesh']>('@diamondcoreprocessor.com/NostrMeshDrone')
  const signer = get<SyncDeps['signer']>('@diamondcoreprocessor.com/NostrSigner')
  const walker = get<WalkerLike>(WALKER_IOC_KEY_LOCAL)
  return store && mesh && signer && walker ? { store, mesh, signer, walker } : null
}

export class DeviceSyncService {
  readonly #deps: () => SyncDeps | null
  #state: DeviceSyncState = { paired: false, peers: 0, phase: 'idle' }
  #pairing: PairingState | null = null
  #self: string | null = null
  #stopAnswering: (() => void) | null = null
  #answeringFor: string | null = null
  #running = false

  constructor(deps: () => SyncDeps | null = fromIoc) {
    this.#deps = deps
  }

  get state(): DeviceSyncState { return { ...this.#state } }

  /**
   * Read the pairing record and make the listening match it: start answering
   * when this device is paired, stop when it is not (or the master changed).
   * Safe to call whenever the record may have changed.
   */
  async refresh(): Promise<void> {
    const deps = this.#deps()
    if (!deps) return
    const pairing = await loadPairing(deps.store)
    const self = (await deps.signer.knownPublicKeyHex?.().catch(() => null))?.toLowerCase() ?? null
    this.#pairing = pairing
    this.#self = self
    const peers = this.#peerKeys().size

    const paired = !!pairing.master && !!self && peers > 0
    if (!paired || this.#answeringFor !== pairing.master) {
      this.#stopAnswering?.(); this.#stopAnswering = null; this.#answeringFor = null
    }
    if (paired && !this.#stopAnswering) await this.#startAnswering(deps, pairing.master!, self!)
    this.#publish({ paired, peers })
  }

  /** The other devices of this participant: the master and every device it currently vouches for. */
  #peerKeys(): Set<string> {
    const pairing = this.#pairing
    if (!pairing?.master || !this.#self) return new Set()
    const keys = new Set<string>([pairing.master, ...activeDevices(pairing).map(row => row.device)])
    keys.delete(this.#self)
    return keys
  }

  #identity(deps: SyncDeps): LinkIdentity | null {
    const pairing = this.#pairing
    if (!pairing?.master || !this.#self) return null
    return {
      signer: deps.signer,
      self: this.#self,
      master: pairing.master,
      grant: ownGrant(pairing, this.#self),
      known: () => (this.#pairing ? knownEvents(this.#pairing) : []),
    }
  }

  async #startAnswering(deps: SyncDeps, master: string, self: string): Promise<void> {
    const signaler = new DeviceSignaler(deps.mesh, deps.signer, master)
    this.#answeringFor = master
    const stop = await answer(
      signaler,
      from => this.#peerKeys().has(from) && from !== self,
      (peer, channel) => {
        const identity = this.#identity(deps)
        if (!identity) { channel.close(); return }
        // Serving only: the device that dialled is the one that walks.
        new DeviceLink(channel, identity, serveOf(deps.store), { expectedPeer: peer }).start()
      },
      deps.rtc,
    )
    this.#stopAnswering = stop
  }

  /** The Sync button: dial every other device and walk what answers. */
  async run(): Promise<DeviceSyncState> {
    if (this.#running) return this.state
    const deps = this.#deps()
    if (!deps) return this.state
    this.#running = true
    try {
      await this.refresh()
      const identity = this.#identity(deps)
      const peers = [...this.#peerKeys()]
      if (!identity || peers.length === 0) {
        this.#say(t('sync.nopeers', 'No paired device to sync with. Pair one first: pair.'), 'warning')
        return this.state
      }
      this.#publish({ phase: 'syncing', progress: undefined, summary: undefined })

      const totals: Totals = { reached: 0, unreachable: 0, advanced: 0, markers: 0, forks: 0, failed: 0 }
      const signaler = new DeviceSignaler(deps.mesh, deps.signer, identity.master)
      const local = localIo(deps.store)
      for (const peer of peers) {
        const channel = await dial(signaler, peer, { connectMs: 10_000, ...deps.rtc })
        if (!channel) { totals.unreachable += 1; continue }
        const link = new DeviceLink(channel, identity, serveOf(deps.store), { expectedPeer: peer })
        link.start()
        const verdict = await link.ready
        if (!verdict.ok) { totals.unreachable += 1; link.close(); continue }
        const pull: Pull = async (layer, fetch) => {
          const result = await deps.walker.resolveSignatureClosure(layer, { read: local.read, fetch, write: local.write })
          return deps.walker.isComplete(result)
        }
        const summary: SyncSummary = await syncFromPeer(link, syncStore(deps.store), pull, progress => this.#publish({ progress }))
        link.close()
        if (!summary.ok) { totals.unreachable += 1; continue }
        totals.reached += 1
        totals.advanced += summary.advanced
        totals.markers += summary.markers
        totals.forks += summary.forks.length
        totals.failed += summary.failed.length
      }

      this.#publish({ phase: totals.reached > 0 ? 'done' : 'error', summary: totals, at: Date.now(), progress: undefined })
      this.#report(totals)
      if (totals.markers > 0) {
        // What arrived predates the page's cached cell lists: drop them, as Save does.
        EffectBus.emit('fs:changed', { segments: [] })
        // The page repaints from what it holds; a failed repaint must never
        // turn a finished sync into an error.
        try { void Promise.resolve(new hypercomb().act()).catch(() => {}) } catch { /* the next pulse repaints */ }
      }
      return this.state
    } finally {
      this.#running = false
    }
  }

  #report(totals: Totals): void {
    if (totals.reached === 0) {
      this.#say(t('sync.unreachable', 'No other device answered. Open the hive on it, with the same pairing, and press sync again.'), 'warning')
      return
    }
    const parts: string[] = [totals.markers > 0
      ? t('sync.moved', 'Synced: {markers} change(s) in {nodes} node(s).', { markers: String(totals.markers), nodes: String(totals.advanced) })
      : t('sync.level', 'Already level — nothing to sync.')]
    if (totals.forks > 0) parts.push(t('sync.forks', '{count} node(s) differ on both devices and were left as they are.', { count: String(totals.forks) }))
    if (totals.failed > 0) parts.push(t('sync.failed', '{count} node(s) did not finish — press sync again to resume.', { count: String(totals.failed) }))
    if (totals.unreachable > 0) parts.push(t('sync.someunreachable', '{count} device(s) did not answer.', { count: String(totals.unreachable) }))
    this.#say(parts.join(' '), totals.failed > 0 || totals.forks > 0 ? 'warning' : 'success')
  }

  #say(message: string, type: string): void {
    EffectBus.emit('activity:log', { message, icon: '🔄' })
    EffectBus.emit('toast:show', { type, message })
  }

  #publish(patch: Partial<DeviceSyncState>): void {
    this.#state = { ...this.#state, ...patch }
    EffectBus.emit(DEVICE_SYNC_STATE, this.state)
  }
}
