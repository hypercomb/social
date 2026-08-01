// diamondcoreprocessor.com/sharing/sync-health.drone.ts
//
// SyncHealthDrone — tells the user whether their changes are backed up,
// in plain words. The push-side sibling of content-health.drone.ts (which
// covers the fetch side): HostSyncService closes the backup loop with
// read-back receipts and emits 'sync:state' per host — and until this
// drone, nothing consumed it. The "you got my latest update?" answer
// existed and was invisible.
//
// Semantics of the producer (host-sync.service.ts drain):
//   • a SUCCESSFUL drain emits only { status: 'backed-up', pending: 0 }
//     at the end — the normal single-edit flow never shows a pill.
//   • { status: 'syncing', pending: n } fires only when a drain ENDS
//     still owing receipts — host unreachable, entries waiting. That is
//     a standing "not yet backed up" condition, not a progress tick.
//   • { status: 'unauthorized' } — the host refused this device's writer
//     key; nothing will back up until it is whitelisted.
//
// So the surface follows the health doctrine exactly:
//   • backed up = SILENCE. No log. The steady state is quiet.
//   • NO indicator pill. The cloud/backup glyphs this drone parked in the
//     command line read as broken chrome and sat there permanently; the
//     pill surface is retired. State is reported through 'sync:health'
//     for any surface that wants it.
//   • activity line on RECOVERY only ("backed up to {host}") — the
//     moment a stuck episode closes. Degradation stays quiet chrome.
//   • reports, never gates: fetch/push behavior with this drone absent
//     is identical. All state in-memory, wiped on reload.

import { Drone, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'

const get = (key: string) => (window as any).ioc?.get?.(key)

type SyncStatus = 'backed-up' | 'syncing' | 'unauthorized'

interface SyncState { host: string; pending: number; status: SyncStatus }

type FolderStatus =
  | 'unsupported'
  | 'unconfigured'
  | 'needs-permission'
  | 'syncing'
  | 'backed-up'
  | 'incomplete'
  | 'error'

interface FolderSyncState {
  status: FolderStatus
  folder?: string
  copied?: number
  scanned?: number
  copiedBytes?: number
  totalBytes?: number
  phase?: string
  missingReferences?: number
  error?: string
}

export class SyncHealthDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'
  override description =
    'Surfaces the host-sync backup state as a plain-language indicator pill — quiet when backed up, counting down while stuck'

  protected override listens = ['sync:state', 'host:receipt', 'folder-sync:state']
  protected override emits = ['sync:health', 'indicator:clear', 'activity:log']

  #initialized = false

  /** Last known state per host — transitions drive every emission. */
  #state = new Map<string, SyncState>()

  #folderState: FolderSyncState | null = null

  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    // The pill surface is retired — sweep any `sync:*` / `folder-sync`
    // key an older build left in the command line's persisted set.
    this.#evictPersistedPills()

    this.onEffect<SyncState>('sync:state', (p) => {
      if (!p?.host || !p.status) return
      this.#apply(p)
    })

    // Per-entry receipts tick a stuck host's pending count down live —
    // the service already emits these; the countdown costs it nothing.
    this.onEffect<{ sig: string }>('host:receipt', () => {
      for (const [host, s] of this.#state) {
        if (s.status !== 'syncing' || s.pending <= 0) continue
        this.#state.set(host, { ...s, pending: s.pending - 1 })
      }
    })

    this.onEffect<FolderSyncState>('folder-sync:state', state => {
      if (!state?.status) return
      this.#applyFolder(state)
    })

  }

  // ── transitions ───────────────────────────────────────────────────

  #apply = (next: SyncState): void => {
    const prev = this.#state.get(next.host)
    if (prev && prev.status === next.status && prev.pending === next.pending) return
    this.#state.set(next.host, next)

    if (next.status === 'backed-up') {
      // Recovery line ONLY when a stuck/refused episode closes — the
      // normal edit→drain→backed-up flow emits no prior state and stays
      // silent (screen stillness: no per-edit flash, no log spam).
      if (prev && prev.status !== 'backed-up') {
        const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
        EffectBus.emit('activity:log', {
          message: i18n?.t('sync.backed-up', { host: next.host }) ?? `backed up to ${next.host}`,
          icon: '◈',
        })
      }
    }

    this.emitEffect('sync:health', {
      host: next.host, status: next.status, pending: next.pending,
      prev: prev?.status ?? null, at: Date.now(),
    })
  }

  #applyFolder = (next: FolderSyncState): void => {
    const prev = this.#folderState
    if (prev?.status === next.status
        && prev?.folder === next.folder
        && prev?.copied === next.copied
        && prev?.scanned === next.scanned
        && prev?.copiedBytes === next.copiedBytes
        && prev?.totalBytes === next.totalBytes
        && prev?.phase === next.phase
        && prev?.missingReferences === next.missingReferences
        && prev?.error === next.error) return
    this.#folderState = next

    if (next.status === 'backed-up'
        && prev && ['needs-permission', 'error'].includes(prev.status)) {
      EffectBus.emit('activity:log', {
        message: `folder backup recovered — current in ${next.folder ?? 'the selected folder'}`,
        icon: '◈',
      })
    }

    this.emitEffect('sync:health', {
      target: 'folder',
      status: next.status,
      folder: next.folder ?? null,
      at: Date.now(),
    })
  }

  /** Drop `sync:*` / `folder-sync` keys an older build persisted into the
   *  command line's indicator set. Sync hosts aren't enumerable before the
   *  first sync:state, so the sweep reads the persisted keys. */
  #evictPersistedPills = (): void => {
    try {
      const saved = localStorage.getItem('hc:indicators')
      if (!saved) return
      const keys = (JSON.parse(saved) as { key?: string }[])
        .map(p => p?.key)
        .filter((k): k is string =>
          typeof k === 'string' && (k.startsWith('sync:') || k === 'folder-sync'))
      for (const key of keys) EffectBus.emit('indicator:clear', { key })
    } catch { /* malformed persistence — the component tolerates it too */ }
  }
}

const _syncHealth = new SyncHealthDrone()
window.ioc.register('@diamondcoreprocessor.com/SyncHealthDrone', _syncHealth)
