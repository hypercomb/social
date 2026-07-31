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
//   • backed up = SILENCE. No pill, no log. The steady state is quiet.
//   • pill only while backup is stuck or refused, keyed `sync:<host>`,
//     count ticking down live off 'host:receipt' (per-entry, already
//     emitted by the service — no service change for the countdown).
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

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** unit
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

const ICONS: Record<Exclude<SyncStatus, 'backed-up'>, string> = {
  'syncing': 'cloud_sync',
  'unauthorized': 'sync_problem',
}

// English fallbacks for when i18n isn't up yet.
const FALLBACK: Record<Exclude<SyncStatus, 'backed-up'>, string> = {
  'syncing': '{n} changes waiting to back up to {host}',
  'unauthorized': "{host} rejected this device — your changes aren't backing up yet",
}

export class SyncHealthDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'
  override description =
    'Surfaces the host-sync backup state as a plain-language indicator pill — quiet when backed up, counting down while stuck'

  protected override listens = ['sync:state', 'host:receipt', 'folder-sync:state', 'indicator:dismiss', 'indicator:click']
  protected override emits = ['sync:health', 'indicator:set', 'indicator:clear', 'activity:log']

  #initialized = false

  /** Last known state per host — transitions drive every emission. */
  #state = new Map<string, SyncState>()

  /** Hosts whose pill the user dismissed for the CURRENT episode.
   *  Cleared when the host transitions to backed-up (episode over). */
  #dismissed = new Set<string>()

  #folderState: FolderSyncState | null = null

  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    // Evict any sync pill a previous session persisted — sync state is
    // session-scoped; a live condition re-pills via last-value replay.
    // (No host enumeration exists before the first sync:state, so clear
    // by prefix through the component's own persistence key.)
    this.#evictPersistedPills()

    this.onEffect<SyncState>('sync:state', (p) => {
      if (!p?.host || !p.status) return
      this.#apply(p)
    })

    // Per-entry receipts tick a stuck pill's count down live — the
    // service already emits these; the countdown costs it nothing.
    this.onEffect<{ sig: string }>('host:receipt', () => {
      for (const [host, s] of this.#state) {
        if (s.status !== 'syncing' || s.pending <= 0) continue
        const next = { ...s, pending: s.pending - 1 }
        this.#state.set(host, next)
        if (!this.#dismissed.has(host) && next.pending > 0) this.#setPill(next)
      }
    })

    this.onEffect<FolderSyncState>('folder-sync:state', state => {
      if (!state?.status) return
      this.#applyFolder(state)
    })

    this.onEffect<{ key: string }>('indicator:click', ({ key }) => {
      if (key === 'folder-sync') EffectBus.emit('folder-sync:open', {})
    })

    // Respect the user's dismissal for the current episode only.
    this.onEffect<{ key: string }>('indicator:dismiss', ({ key }) => {
      if (!key?.startsWith('sync:')) return
      this.#dismissed.add(key.slice('sync:'.length))
    })
  }

  // ── transitions ───────────────────────────────────────────────────

  #apply = (next: SyncState): void => {
    const prev = this.#state.get(next.host)
    if (prev && prev.status === next.status && prev.pending === next.pending) return
    this.#state.set(next.host, next)

    if (next.status === 'backed-up') {
      EffectBus.emit('indicator:clear', { key: `sync:${next.host}` })
      this.#dismissed.delete(next.host)  // episode over — a recurrence pills again
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
    else if (!this.#dismissed.has(next.host)) {
      this.#setPill(next)
    }

    this.emitEffect('sync:health', {
      host: next.host, status: next.status, pending: next.pending,
      prev: prev?.status ?? null, at: Date.now(),
    })
  }

  #setPill = (s: SyncState): void => {
    if (s.status === 'backed-up') return
    EffectBus.emit('indicator:set', {
      key: `sync:${s.host}`,
      icon: ICONS[s.status],
      label: this.#label(s),
      dismissable: true,
    })
  }

  #label = (s: SyncState): string => {
    const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
    if (s.status === 'unauthorized') {
      return i18n?.t('sync.unauthorized', { host: s.host })
        ?? FALLBACK.unauthorized.replace('{host}', s.host)
    }
    return i18n?.t('sync.pending', { n: s.pending, host: s.host })
      ?? FALLBACK.syncing.replace('{n}', String(s.pending)).replace('{host}', s.host)
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

    if (next.status === 'backed-up') {
      EffectBus.emit('indicator:clear', { key: 'folder-sync' })
      if (prev && ['needs-permission', 'error'].includes(prev.status)) {
        EffectBus.emit('activity:log', {
          message: `folder backup recovered — current in ${next.folder ?? 'the selected folder'}`,
          icon: '◈',
        })
      }
    } else {
      const label = this.#folderLabel(next)
      if (label) {
        EffectBus.emit('indicator:set', {
          key: 'folder-sync',
          icon: 'backup',
          label,
          dismissable: true,
        })
      }
    }

    this.emitEffect('sync:health', {
      target: 'folder',
      status: next.status,
      folder: next.folder ?? null,
      at: Date.now(),
    })
  }

  #folderLabel = (state: FolderSyncState): string => {
    switch (state.status) {
      case 'unconfigured':
        return 'Only on this device — run /folder-sync connect for a private folder backup'
      case 'needs-permission':
        return `Folder backup paused — run /folder-sync resume for ${state.folder ?? 'the selected folder'}`
      case 'syncing':
        return `${state.phase ?? `Backing up to ${state.folder ?? 'folder'}`} — ${state.scanned ?? 0} files / ${formatBytes(state.totalBytes ?? 0)} checked, ${formatBytes(state.copiedBytes ?? 0)} written`
      case 'incomplete':
        return `Hard copy incomplete — ${state.missingReferences ?? 0} referenced items are not local; run /folder-sync hard-copy to retry`
      case 'error':
        return `Folder backup needs attention — ${state.error ?? 'run /folder-sync now to retry'}`
      case 'unsupported':
        return 'Folder backup is unavailable in this browser — use /download for an offline snapshot'
      default:
        return ''
    }
  }

  /** Drop `sync:*` pills from the component's persisted dismissable set —
   *  same stale-pill guard content-health applies to `health:*`, but sync
   *  hosts aren't enumerable before the first sync:state, so the sweep
   *  reads the persisted keys instead of a fixed list. */
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
