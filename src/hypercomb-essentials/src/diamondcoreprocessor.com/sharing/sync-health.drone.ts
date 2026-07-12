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

  protected override listens = ['sync:state', 'host:receipt', 'indicator:dismiss']
  protected override emits = ['sync:health', 'indicator:set', 'indicator:clear', 'activity:log']

  #initialized = false

  /** Last known state per host — transitions drive every emission. */
  #state = new Map<string, SyncState>()

  /** Hosts whose pill the user dismissed for the CURRENT episode.
   *  Cleared when the host transitions to backed-up (episode over). */
  #dismissed = new Set<string>()

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
        .filter((k): k is string => typeof k === 'string' && k.startsWith('sync:'))
      for (const key of keys) EffectBus.emit('indicator:clear', { key })
    } catch { /* malformed persistence — the component tolerates it too */ }
  }
}

const _syncHealth = new SyncHealthDrone()
window.ioc.register('@diamondcoreprocessor.com/SyncHealthDrone', _syncHealth)
