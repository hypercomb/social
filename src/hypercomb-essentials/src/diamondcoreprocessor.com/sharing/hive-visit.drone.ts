// diamondcoreprocessor.com/sharing/hive-visit.drone.ts
//
// The VISITOR side of static hive hosting — "adopt for review".
//
// A hive-link bundle (hive-link.ts) arrives via the /<sig> boot capture:
// MeetingInviteWorker decodes it and emits `hive:link`. This drone then:
//
//   1. Resolves the publisher's CURRENT head for the linked branch from
//      their signed hive index (hive-pointer.ts) — verified against the
//      pubkey pinned in the bundle, so no host can substitute content.
//   2. Localizes the branch's layer closure into the content pool
//      (broker.adopt, layersOnly + silent — content-addressed bytes are
//      inert cache, NOT adoption).
//   3. Seeds a PREVIEW head (history.seedPreviewHead) at /<branchName> and
//      navigates there: the branch renders through the one real render
//      path, browsable, with ZERO lineage writes. Foreign pages/scripts
//      stay behind the render-time verification gate as always.
//   4. The preview banner (shell surface) offers Adopt / Dismiss:
//      `hive:adopt-accept` drops the preview and folds the branch through
//      SwarmAdoptDrone.adoptResolvedBranch — ADOPT IS ADOPT, the same
//      gesture as a mesh adopt, code consent and all. `hive:adopt-dismiss`
//      drops the preview and walks away — nothing was ever written.
//
// The whole flow rides the HTTPS byte tier only: it works with
// hc:mesh-public OFF (private mode) and never touches the relay.
//
// FOLLOW UPDATES (phase 1 = boot poll): an adopted static root records a
// follow in hc:static-follows. Shortly after boot this drone fetches each
// followed publisher's index ONCE, O(1)-compares the published head to the
// sync receipt, and re-folds through syncResolvedBranch when the publisher
// moved — same receipts, same tombstone respect as mesh auto-sync.

import { Drone, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { validateHiveLinkBundle, STATIC_FOLLOWS_KEY, type HiveLinkBundle } from './hive-link.js'
import { fetchHiveManifestFromAny } from './hive-pointer.js'
import { lineageKey } from '../history/lineage-key.js'
import { isAdoptTombstoned } from './adopted-roots.js'

const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const BROKER_KEY = '@diamondcoreprocessor.com/ContentBrokerDrone'
const NAV_KEY = '@hypercomb.social/Navigation'
const SWARM_ADOPT_KEY = '@diamondcoreprocessor.com/SwarmAdoptDrone'
// Mirrors swarm-adopt.drone.ts SYNC_RECEIPTS_KEY — the ONE receipts map
// both sync sources (mesh broadcasts, static indexes) compare against.
const SYNC_RECEIPTS_KEY = 'hc:synced-publisher-roots'

const SIG_RE = /^[a-f0-9]{64}$/
const BOOT_SYNC_DELAY_MS = 30_000
const BOOT_SYNC_MAX_TRIES = 3

interface HistoryLike {
  sign: (lineage: { explorerSegments: () => string[] }) => Promise<string>
  currentLayerAt: (locationSig: string, stats?: { cold?: boolean }) => Promise<Record<string, unknown> | null>
  getLayerBySig: (sig: string) => Promise<Record<string, unknown> | null>
  seedPreviewHead: (segments: readonly string[], layerSig: string) => Promise<string | null>
  dropPreviewHead: () => void
}

interface BrokerLike {
  adopt: (rootSig: string, opts?: { layersOnly?: boolean; silent?: boolean }) => Promise<{ layers: number; leaves: number; failed: number }>
  noteDomainsForSig?: (sig: string, domains: string[]) => void
}

interface NavLike { go: (segments: readonly string[]) => void }

interface AdoptLike {
  adoptResolvedBranch: (branch: { layerSig: string; at: string[]; domain?: string; label: string }) =>
    Promise<'committed' | 'exists' | 'rewound' | 'unavailable' | 'code-routed' | 'declined' | 'uninspectable'>
  syncResolvedBranch: (branch: { layerSig: string; at: string[]; domain?: string; label: string }) =>
    Promise<'committed' | 'exists' | 'unavailable' | 'rewound'>
}

interface StaticFollow { pubkey: string; hosts: string[]; lineageKey: string }

/** The active preview, if any — what accept/dismiss act on. */
interface ActivePreview { bundle: HiveLinkBundle; head: string; name: string; key: string }

export class HiveVisitDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'

  public override description =
    'Receives a hive-link bundle, resolves the publisher\'s current head from their signed hive index, and renders the branch as a session-only PREVIEW (adopt for review) — zero lineage writes until the explicit Adopt, which folds through the one adopt gesture. Dismiss forgets everything. Boot-polls followed static publishers for updates.'
  public override effects = ['network'] as const
  protected override listens = ['hive:link', 'hive:adopt-accept', 'hive:adopt-dismiss']
  protected override emits = ['preview:mode', 'toast:show', 'activity:log']

  #active: ActivePreview | null = null
  #bootSyncTries = 0

  constructor() {
    super()
    this.onEffect<unknown>('hive:link', (raw) => { void this.#preview(raw) })
    this.onEffect('hive:adopt-accept', () => { void this.#accept() })
    this.onEffect('hive:adopt-dismiss', () => { this.#dismiss() })
    // Follow updates ride a single detached post-boot pass — off the boot
    // path, one index fetch per followed publisher, never a timer loop.
    setTimeout(() => { void this.#bootSync() }, BOOT_SYNC_DELAY_MS)
  }

  #ioc = () => (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
  #i18n = () => this.#ioc()?.get<I18nProvider>(I18N_IOC_KEY)

  #toast(type: string, title: string, message: string): void {
    this.emitEffect('toast:show', { type, title, message })
  }

  // ── 1-2-3: resolve head → localize closure → seed preview ────────────

  #preview = async (raw: unknown): Promise<void> => {
    const bundle = validateHiveLinkBundle(raw)
    if (!bundle) return
    const i18n = this.#i18n()
    const history = this.#ioc()?.get<HistoryLike>(HISTORY_KEY)
    const broker = this.#ioc()?.get<BrokerLike>(BROKER_KEY)
    const nav = this.#ioc()?.get<NavLike>(NAV_KEY)
    if (!history?.seedPreviewHead || !broker?.adopt || !nav) return

    // One preview at a time — a fresh link replaces the current one.
    if (this.#active) this.#dismiss({ silent: true })

    // The publisher's signed index names "now"; the bundle's rootSig hint
    // covers a cold/unreachable index (the old closure stays hosted).
    const key = lineageKey(bundle.segments)
    const manifest = await fetchHiveManifestFromAny(bundle.hosts, bundle.pubkey)
    const head = manifest?.roots[key] ?? bundle.rootSig ?? ''
    if (!SIG_RE.test(head)) {
      this.#toast('error', i18n?.t('preview.banner.title') ?? 'Hive preview',
        i18n?.t('preview.unreachable') ?? 'This hive\'s index is unreachable and the link carries no fallback.')
      return
    }

    // Teach the broker where the bytes live (session-noted tier — works in
    // private mode, no relay flag needed), then localize the layer closure.
    // Bytes in the pool are content-addressed cache, not adoption.
    broker.noteDomainsForSig?.(head, bundle.hosts)
    const stats = await broker.adopt(head, { layersOnly: true, silent: true })
    const root = await history.getLayerBySig(head)
    if (!root) {
      this.#toast('error', i18n?.t('preview.banner.title') ?? 'Hive preview',
        i18n?.t('preview.unreachable-bytes') ?? 'The hive\'s content isn\'t reachable right now — try again shortly.')
      return
    }
    const name = String(root['name'] ?? '').trim() || bundle.segments[bundle.segments.length - 1]

    // Collision: never preview OVER the visitor's own content. currentLayerAt
    // resolves real bags AND parent-carried children, so an occupied name is
    // caught however it is held.
    const locSig = await history.sign({ explorerSegments: () => [name] })
    const occupied = await history.currentLayerAt(locSig).catch(() => null)
    if (occupied || !(await history.seedPreviewHead([name], head))) {
      this.#toast('tip', i18n?.t('preview.banner.title') ?? 'Hive preview',
        i18n?.t('preview.collision', { name }) ?? `You already have "${name}" — move or rename yours first, then open the link again.`)
      return
    }

    this.#active = { bundle, head, name, key }
    nav.go([name])
    this.emitEffect('preview:mode', {
      active: true,
      label: name,
      pubkey: bundle.pubkey,
      hosts: bundle.hosts,
      tiles: stats.layers,
    })
    this.emitEffect('activity:log', {
      message: i18n?.t('preview.started', { name }) ?? `previewing "${name}" — adopt it to keep it, dismiss to walk away`,
      icon: '●',
    })
  }

  // ── 4a: adopt — drop the preview, then the ONE adopt gesture ─────────

  #accept = async (): Promise<void> => {
    const p = this.#active
    if (!p) return
    const history = this.#ioc()?.get<HistoryLike>(HISTORY_KEY)
    const adopt = this.#ioc()?.get<AdoptLike>(SWARM_ADOPT_KEY)
    if (!history || !adopt?.adoptResolvedBranch) return

    // Drop FIRST: the committer refuses every commit while a preview is
    // active, the fold included. The closure is already pool-resident, so
    // the fold needs no network and lands fast.
    history.dropPreviewHead()
    this.emitEffect('preview:mode', { active: false })

    const res = await adopt.adoptResolvedBranch({
      layerSig: p.head,
      at: [],
      domain: p.bundle.hosts[0],
      label: p.name,
    })

    if (res === 'committed' || res === 'exists') {
      this.#recordFollow(p.name, { pubkey: p.bundle.pubkey, hosts: p.bundle.hosts, lineageKey: p.key })
      this.#active = null
      return
    }
    if (res === 'code-routed') {
      // The headless DCP install owns the outcome now; the preview stays
      // down (the features panel is the visible landing). Follow recording
      // waits for a landed fold — phase 2.
      this.#active = null
      return
    }
    // 'declined' / 'rewound' / 'unavailable' / 'uninspectable' — nothing
    // folded. Restore the preview so the visitor keeps what they were
    // looking at; the adopt gesture already explained itself.
    await history.seedPreviewHead([p.name], p.head)
    this.emitEffect('preview:mode', {
      active: true,
      label: p.name,
      pubkey: p.bundle.pubkey,
      hosts: p.bundle.hosts,
    })
  }

  // ── 4b: dismiss — forget everything, walk away ───────────────────────

  #dismiss = (opts?: { silent?: boolean }): void => {
    const p = this.#active
    this.#active = null
    const history = this.#ioc()?.get<HistoryLike>(HISTORY_KEY)
    history?.dropPreviewHead()
    this.emitEffect('preview:mode', { active: false })
    if (opts?.silent) return
    const nav = this.#ioc()?.get<NavLike>(NAV_KEY)
    nav?.go([])
    if (p) {
      const i18n = this.#i18n()
      this.emitEffect('activity:log', {
        message: i18n?.t('preview.dismissed', { name: p.name }) ?? `preview of "${p.name}" dismissed — nothing was kept`,
        icon: '○',
      })
    }
  }

  // ── follow updates: one index fetch per publisher, O(1) head compare ─

  #loadFollows = (): Record<string, StaticFollow> => {
    try {
      const raw = localStorage.getItem(STATIC_FOLLOWS_KEY)
      const obj = raw ? JSON.parse(raw) : {}
      return obj && typeof obj === 'object' ? obj as Record<string, StaticFollow> : {}
    } catch { return {} }
  }

  #recordFollow = (name: string, follow: StaticFollow): void => {
    try {
      const follows = this.#loadFollows()
      follows[name] = follow
      localStorage.setItem(STATIC_FOLLOWS_KEY, JSON.stringify(follows))
    } catch { /* no localStorage — follows degrade to this session */ }
  }

  #loadReceipts = (): Record<string, string> => {
    try {
      const raw = localStorage.getItem(SYNC_RECEIPTS_KEY)
      const obj = raw ? JSON.parse(raw) : {}
      return obj && typeof obj === 'object' ? obj as Record<string, string> : {}
    } catch { return {} }
  }

  #recordReceipt = (name: string, sig: string): void => {
    try {
      const receipts = this.#loadReceipts()
      receipts[name] = sig
      localStorage.setItem(SYNC_RECEIPTS_KEY, JSON.stringify(receipts))
    } catch { /* no localStorage — compare degrades to once-per-session */ }
  }

  #bootSync = async (): Promise<void> => {
    const follows = Object.entries(this.#loadFollows())
    if (follows.length === 0) return
    const broker = this.#ioc()?.get<BrokerLike>(BROKER_KEY)
    const adopt = this.#ioc()?.get<AdoptLike>(SWARM_ADOPT_KEY)
    if (!broker?.adopt || !adopt?.syncResolvedBranch) {
      // Services not registered yet (slow cold boot) — retry a few times,
      // then give up until next boot; follows are never urgent.
      if (++this.#bootSyncTries < BOOT_SYNC_MAX_TRIES) {
        setTimeout(() => { void this.#bootSync() }, BOOT_SYNC_DELAY_MS)
      }
      return
    }

    // One index fetch answers every followed root from that publisher.
    const byPublisher = new Map<string, { hosts: string[]; entries: [string, StaticFollow][] }>()
    for (const [name, follow] of follows) {
      if (!SIG_RE.test(String(follow?.pubkey ?? '')) || !Array.isArray(follow?.hosts)) continue
      const group = byPublisher.get(follow.pubkey) ?? { hosts: [], entries: [] }
      for (const h of follow.hosts) if (!group.hosts.includes(h)) group.hosts.push(h)
      group.entries.push([name, follow])
      byPublisher.set(follow.pubkey, group)
    }

    const receipts = this.#loadReceipts()
    for (const [pubkey, group] of byPublisher) {
      const manifest = await fetchHiveManifestFromAny(group.hosts, pubkey)
      if (!manifest) continue
      for (const [name, follow] of group.entries) {
        // Delete-is-unsubscribe: a tombstoned root never re-folds.
        if (isAdoptTombstoned([name])) continue
        const head = manifest.roots[follow.lineageKey]
        if (!head || receipts[name] === head) continue
        if (!receipts[name]) {
          // Absent receipt BASELINES instead of folding — same rule as mesh
          // auto-sync: a pre-receipt state must never mass-refold on first sight.
          this.#recordReceipt(name, head)
          continue
        }
        broker.noteDomainsForSig?.(head, follow.hosts)
        await adopt.syncResolvedBranch({ layerSig: head, at: [], domain: follow.hosts[0], label: name })
      }
    }
  }
}

const _hiveVisit = new HiveVisitDrone()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/HiveVisitDrone',
  _hiveVisit,
)
