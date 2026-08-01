// diamondcoreprocessor.com/sharing/content-health.drone.ts
//
// ContentHealthDrone — tells the user what's going on with content
// fetching, in plain words. Design: documentation/content-health.md.
//
// The fetch pipeline is failure-silent by design; ContentBrokerDrone
// mints per-host outcomes ('broker:outcome') at its existing failure/
// success points and this drone turns that stream into ONE overall
// condition, surfaced through the existing conventions only:
//
//   • activity log    — recovery transitions only ("{host} is
//     answering again"); no toasts on degradation
//   • 'content:health' effect — emitted on condition TRANSITIONS only
//     (EffectBus last-value replay makes late surfaces correct)
//
// NO indicator pill. The cloud/link glyphs this drone used to park in the
// command line read as broken chrome and sat there permanently; the pill
// surface is gone. Health is reported through 'content:health' (for any
// surface that wants it) and the recovery activity line only — the
// classifier and ledger are unchanged.
//
// Doctrine (load-bearing):
//   • Render never awaits network — this drone does ZERO work on any
//     render path. Outcome handling is an O(1) ledger push; the
//     classifier runs coalesced on a microtask, off the emitter's
//     stack entirely.
//   • The health surface reports; it never gates. Fetch behavior with
//     this drone absent is identical.
//   • The ledger is IN-MEMORY ONLY — not truth, not a pool, never
//     persisted, wiped on reload.
//   • Healthy = silence. No pill, no log line, nothing.

import { Drone, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'

const get = (key: string) => (window as any).ioc?.get?.(key)

// Types stay LOCAL to this drone (no sharing/index.ts export).
type OutcomeClass = 'ok' | 'not-found' | 'unreachable' | 'timeout' | 'mismatch'
type HealthCondition = 'offline' | 'host-down' | 'waiting' | 'missing' | 'tampered' | 'healthy'

interface BrokerOutcome { host: string; cls: OutcomeClass; at: number }

interface HostLedger {
  /** Rolling window of recent outcomes, oldest → newest. */
  window: { cls: OutcomeClass; at: number }[]
  /** Not window-pruned — "prior success" must outlive the window. */
  lastSuccessAt: number | null
  lastFailureAt: number | null
}

// Rolling window bounds — last ~50 outcomes or ~5 minutes per host.
const WINDOW_MAX = 50
const WINDOW_MS = 5 * 60_000

// A host with prior success is "consistently" failing once its most
// recent outcomes are this many unreachable/timeouts in a row.
const HOST_DOWN_STREAK = 3

// Everything-unreachable inference for `offline` (when navigator.onLine
// still claims true): at least this many distinct hosts, ALL with a
// failure streak of at least this length.
const ALL_DOWN_HOSTS = 2
const ALL_DOWN_STREAK = 2

/** Keys of the retired health pills — swept on boot so a persisted one
 *  from an older build can't linger in the command line. */
const ALL_PILL_KEYS: readonly string[] = (['offline', 'host-down', 'waiting', 'missing', 'tampered'] as const)
  .map(c => `health:${c}`)

export class ContentHealthDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'
  override description =
    'Classifies per-host fetch outcomes into one plain-language content-health condition and surfaces it as an indicator pill'

  protected override listens = ['broker:outcome']
  protected override emits = ['content:health', 'indicator:clear', 'activity:log']

  #initialized = false

  /** In-memory ledger, per host. Never persisted, wiped on reload. */
  #ledger = new Map<string, HostLedger>()

  /** Current overall condition — transitions drive every emission. */
  #condition: HealthCondition = 'healthy'
  #conditionHost: string | null = null

  /** Microtask-coalesced classify — keeps the outcome handler O(1) so
   *  a broker emit from a render-adjacent fetch costs nothing here. */
  #classifyQueued = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    // The pill surface is retired — sweep any key an older build left in
    // the command line's persisted set.
    for (const key of ALL_PILL_KEYS) EffectBus.emit('indicator:clear', { key })

    this.onEffect<BrokerOutcome>('broker:outcome', (p) => {
      if (!p?.host || !p.cls) return
      this.#record(p)
      this.#scheduleClassify()
    })

    // The missing browser inputs — the fetch pipeline had zero of these.
    window.addEventListener('online', () => this.#scheduleClassify())
    window.addEventListener('offline', () => this.#scheduleClassify())
  }

  // ── ledger ────────────────────────────────────────────────────────

  #record = ({ host, cls, at }: BrokerOutcome): void => {
    let entry = this.#ledger.get(host)
    if (!entry) {
      entry = { window: [], lastSuccessAt: null, lastFailureAt: null }
      this.#ledger.set(host, entry)
    }
    const when = Number.isFinite(at) ? at : Date.now()
    entry.window.push({ cls, at: when })
    if (entry.window.length > WINDOW_MAX) entry.window.splice(0, entry.window.length - WINDOW_MAX)
    if (cls === 'ok') entry.lastSuccessAt = when
    else entry.lastFailureAt = when
  }

  #prune = (): void => {
    const cutoff = Date.now() - WINDOW_MS
    for (const entry of this.#ledger.values()) {
      let drop = 0
      while (drop < entry.window.length && entry.window[drop].at < cutoff) drop++
      if (drop > 0) entry.window.splice(0, drop)
    }
  }

  /** Consecutive most-recent unreachable/timeout outcomes. */
  #failStreak = (entry: HostLedger): number => {
    let n = 0
    for (let i = entry.window.length - 1; i >= 0; i--) {
      const cls = entry.window[i].cls
      if (cls === 'unreachable' || cls === 'timeout') n++
      else break
    }
    return n
  }

  /** The host answered — ok or a definite not-found (a 404 IS an answer). */
  #answers = (entry: HostLedger): boolean => {
    const last = entry.window[entry.window.length - 1]
    return !!last && (last.cls === 'ok' || last.cls === 'not-found')
  }

  // ── classifier ────────────────────────────────────────────────────

  #scheduleClassify = (): void => {
    if (this.#classifyQueued) return
    this.#classifyQueued = true
    queueMicrotask(() => {
      this.#classifyQueued = false
      this.#apply(...this.#classify())
    })
  }

  /** Derive the overall condition in the doc's priority order:
   *  offline > host-down > waiting > missing > tampered > healthy.
   *  `waiting` needs pending-sig state the broker outcomes don't carry,
   *  so this classifier never yields it (by design — no new state
   *  elsewhere); its i18n copy is in place for when that input lands. */
  #classify = (): [HealthCondition, string | null] => {
    this.#prune()

    // 'local' is the store fast-path, not a network host — it informs
    // the ledger for future consumers but never drives a condition.
    const hosts: [string, HostLedger][] = []
    for (const [host, entry] of this.#ledger) {
      if (host === 'local' || entry.window.length === 0) continue
      hosts.push([host, entry])
    }

    // offline — the browser says so, or everyone we dial is unreachable.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return ['offline', null]
    if (hosts.length >= ALL_DOWN_HOSTS && hosts.every(([, e]) => this.#failStreak(e) >= ALL_DOWN_STREAK)) {
      return ['offline', null]
    }

    // host-down — prior success, now consistently unreachable/timing out,
    // while another host answers OR it's the only host we know.
    for (const [host, entry] of hosts) {
      if (entry.lastSuccessAt === null) continue
      if (this.#failStreak(entry) < HOST_DOWN_STREAK) continue
      const anotherAnswers = hosts.some(([h, e]) => h !== host && this.#answers(e))
      if (anotherAnswers || hosts.length === 1) return ['host-down', host]
    }

    // missing — every host that said anything lately says not-found
    // (the mesh's silence-timeout counts as "nobody has it" too).
    if (hosts.length > 0) {
      let sawNotFound = false
      const allMissing = hosts.every(([host, entry]) => {
        const last = entry.window[entry.window.length - 1]
        if (last.cls === 'not-found') { sawNotFound = true; return true }
        return host === 'mesh' && last.cls === 'timeout'
      })
      if (allMissing && sawNotFound) return ['missing', null]
    }

    // tampered — any signature mismatch in the recent window.
    for (const [host, entry] of hosts) {
      if (entry.window.some(o => o.cls === 'mismatch')) return ['tampered', host]
    }

    return ['healthy', null]
  }

  // ── surfaces — transitions only ───────────────────────────────────

  #apply = (next: HealthCondition, host: string | null): void => {
    if (next === this.#condition && host === this.#conditionHost) return
    const prev = this.#condition
    const prevHost = this.#conditionHost
    this.#condition = next
    this.#conditionHost = host

    // Activity log on RECOVERY only — the downed host answered again.
    // Degradation stays quiet.
    if (prev === 'host-down' && next !== 'offline' && prevHost) {
      const entry = this.#ledger.get(prevHost)
      if (entry && this.#answers(entry)) {
        const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
        EffectBus.emit('activity:log', {
          message: i18n?.t('health.recovered', { host: prevHost }) ?? `${prevHost} is answering again`,
          icon: '◈',
        })
      }
    }

    this.emitEffect('content:health', { condition: next, host, prev, at: Date.now() })
  }

}

const _contentHealth = new ContentHealthDrone()
window.ioc.register('@diamondcoreprocessor.com/ContentHealthDrone', _contentHealth)
