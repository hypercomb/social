// diamondcoreprocessor.com/sharing/example-hives.worker.ts
//
// First-boot EXAMPLE HIVES offer — a brand-new install lands in something
// alive instead of an empty canvas. When the participant's hive root is
// genuinely empty (cold-miss-aware — "couldn't see" is never "empty"), this
// worker fetches the shell's example roster (`/example-hives.json`, deployed
// data — signatures live there, never in code) and emits `examples:offer` for
// the shell surface to render.
//
// Adoption rides the EXISTING machinery end to end: the accepted example is
// folded by SwarmAdoptDrone.adoptResolvedBranch at the hive root — the same
// complete-or-defer closure pull + importTree cascade every adopt uses — with
// the CDN hosts pre-seeded via ContentBrokerDrone.noteDomainsForSig. Nothing
// is ever auto-written: the fold fires only on the participant's explicit
// accept (`examples:adopt`); dismissing persists a flag and writes nothing.
//
// The examples are content-only by construction. If a roster entry ever
// declared code, the adopt drone's own consent gate fires — this worker
// neither knows nor bypasses it.

import { Worker, get } from '@hypercomb/core'
import { resolveLayerAt, childNamesOfStrict } from '../history/layer-placement.js'

const STORE_KEY = '@hypercomb.social/Store'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const BROKER_KEY = '@diamondcoreprocessor.com/ContentBrokerDrone'
const SWARM_ADOPT_KEY = '@diamondcoreprocessor.com/SwarmAdoptDrone'

/** Participant-local "no thanks" — localStorage, not a pool of meaning. */
const DISMISSED_KEY = 'hc:example-hives:dismissed'
/** The roster the shell deploys alongside itself. Absent (dev shell without
 *  the file, offline) → no offer, no error. */
const ROSTER_URL = '/example-hives.json'

const SIG_RE = /^[a-f0-9]{64}$/
const CELL_RE = /^[\p{L}\p{N}][\p{L}\p{N}\-]{0,63}$/u

/** How long after readiness before the first emptiness probe, and between
 *  retries when the read comes back cold. The offer is a quiet post-boot
 *  affordance, never a boot-path participant. */
const PROBE_DELAY_MS = 2_500
const PROBE_RETRIES = 3

export interface ExampleHiveEntry {
  name: string
  head: string
  tiles?: number
  coverSig?: string
  description?: Record<string, string>
}

export interface ExampleHivesRoster {
  version: number
  domains: string[]
  examples: ExampleHiveEntry[]
}

interface HistoryLike {
  sign: (lineage: unknown) => Promise<string>
  currentLayerAt: (locationSig: string) => Promise<Record<string, unknown> | null>
  getLayerBySig: (sig: string) => Promise<Record<string, unknown> | null>
  childrenManifestFor?: (layer: unknown) => Promise<{ sig: string; layer?: { name?: string } }[] | null>
  previewActive?: boolean
}
interface LineageLike { domain?: unknown }
interface BrokerLike { noteDomainsForSig?: (sig: string, domains: string[]) => void }
interface AdoptLike {
  adoptResolvedBranch: (
    branch: { layerSig: string; at: string[]; domain?: string; label: string },
    opts?: { silent?: boolean },
  ) => Promise<string>
}
interface AdoptRequestPayload { name?: string }

export class ExampleHivesWorker extends Worker {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'example-hives'

  public override description =
    'Offers the published example hives when a fresh install boots onto an empty hive root: fetches the shell\'s roster, and on the participant\'s explicit accept folds the chosen example through the ordinary adopt machinery. Dismiss persists locally; nothing is ever auto-written.'
  public override effects = ['network'] as const
  protected override listens = ['examples:adopt', 'examples:dismiss']
  protected override emits = ['examples:offer', 'examples:adopted', 'toast:show']

  #acted = false
  #roster: ExampleHivesRoster | null = null
  #busy = new Set<string>()

  protected override ready = (): boolean => {
    if (this.#acted) return false
    return !!get(STORE_KEY) && !!get(HISTORY_KEY) && !!get(LINEAGE_KEY)
      && !!get(BROKER_KEY) && !!get(SWARM_ADOPT_KEY)
  }

  protected override act = async (): Promise<void> => {
    this.#acted = true

    this.onEffect<AdoptRequestPayload>('examples:adopt', (p) => {
      if (typeof p?.name === 'string' && p.name) void this.#adopt(p.name)
    })
    this.onEffect('examples:dismiss', () => this.#dismiss())

    if (this.#dismissed()) return
    setTimeout(() => { void this.#maybeOffer(PROBE_RETRIES) }, PROBE_DELAY_MS)
  }

  // ── the offer ──────────────────────────────────────────────────────

  #maybeOffer = async (retriesLeft: number): Promise<void> => {
    try {
      const empty = await this.#rootIsEmpty()
      if (empty === 'cold') {
        if (retriesLeft > 0) setTimeout(() => { void this.#maybeOffer(retriesLeft - 1) }, PROBE_DELAY_MS)
        return
      }
      if (!empty) return

      // A live static-hive preview is its own flow — don't talk over it.
      const history = get<HistoryLike>(HISTORY_KEY)
      if (history?.previewActive) {
        if (retriesLeft > 0) setTimeout(() => { void this.#maybeOffer(retriesLeft - 1) }, PROBE_DELAY_MS * 4)
        return
      }

      const roster = await this.#loadRoster()
      if (!roster || roster.examples.length === 0) return
      this.#roster = roster

      // Teach the broker (and through it the service worker) where these
      // sigs live, so cover images and the eventual fold resolve from the
      // public CDN on any origin — loopback and private mode included.
      const broker = get<BrokerLike>(BROKER_KEY)
      for (const e of roster.examples) {
        broker?.noteDomainsForSig?.(e.head, roster.domains)
        if (e.coverSig) broker?.noteDomainsForSig?.(e.coverSig, roster.domains)
      }

      this.emitEffect('examples:offer', { active: true, examples: roster.examples })
    } catch { /* never let the offer probe surface as a boot error */ }
  }

  /** true | false | 'cold'. Empty means the root layer resolves to nothing
   *  anywhere up the chain (fresh install), or resolves with a confirmed
   *  zero-child read. A cold miss is "couldn't see", never "empty". */
  #rootIsEmpty = async (): Promise<boolean | 'cold'> => {
    const history = get<HistoryLike>(HISTORY_KEY)
    const lineage = get<LineageLike>(LINEAGE_KEY)
    if (!history || !lineage) return 'cold'
    const root = await resolveLayerAt(history as never, lineage.domain, [])
    if (!root) return true
    const { names, coldMiss } = await childNamesOfStrict(history as never, root as never)
    if (coldMiss) return 'cold'
    return names.length === 0
  }

  #loadRoster = async (): Promise<ExampleHivesRoster | null> => {
    try {
      const res = await fetch(ROSTER_URL, { cache: 'no-store' })
      if (!res.ok) return null
      // SPA-fallback guard: a dev origin serves index.html for unknown paths.
      if ((res.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) return null
      const raw = await res.json() as Partial<ExampleHivesRoster> | null
      if (!raw || raw.version !== 1) return null
      const domains = (Array.isArray(raw.domains) ? raw.domains : [])
        .map(d => String(d).trim().toLowerCase()).filter(Boolean)
      if (!domains.length) return null
      const examples: ExampleHiveEntry[] = []
      for (const e of Array.isArray(raw.examples) ? raw.examples : []) {
        const name = String((e as ExampleHiveEntry)?.name ?? '').trim()
        const head = String((e as ExampleHiveEntry)?.head ?? '').trim().toLowerCase()
        if (!CELL_RE.test(name) || !SIG_RE.test(head)) continue
        const coverRaw = String((e as ExampleHiveEntry)?.coverSig ?? '').trim().toLowerCase()
        const description = (e as ExampleHiveEntry)?.description
        examples.push({
          name,
          head,
          tiles: Number((e as ExampleHiveEntry)?.tiles) > 0 ? Number((e as ExampleHiveEntry).tiles) : undefined,
          coverSig: SIG_RE.test(coverRaw) ? coverRaw : undefined,
          description: description && typeof description === 'object' ? description : undefined,
        })
      }
      return examples.length ? { version: 1, domains, examples } : null
    } catch { return null }
  }

  // ── the two gestures ───────────────────────────────────────────────

  #adopt = async (name: string): Promise<void> => {
    const roster = this.#roster
    const entry = roster?.examples.find(e => e.name === name)
    if (!roster || !entry || this.#busy.has(name)) return
    this.#busy.add(name)
    this.emitEffect('examples:adopted', { name, status: 'adopting' })
    try {
      const broker = get<BrokerLike>(BROKER_KEY)
      broker?.noteDomainsForSig?.(entry.head, roster.domains)
      const adopt = get<AdoptLike>(SWARM_ADOPT_KEY)
      if (!adopt) throw new Error('adopt machinery unavailable')
      // silent: a fresh participant's content-only fold should simply appear —
      // no Beehaviors panel routing.
      const status = await adopt.adoptResolvedBranch(
        { layerSig: entry.head, at: [], domain: roster.domains[0], label: entry.name },
        { silent: true },
      )
      this.emitEffect('examples:adopted', { name, status })
    } catch {
      this.emitEffect('examples:adopted', { name, status: 'unavailable' })
    } finally {
      this.#busy.delete(name)
    }
  }

  #dismiss = (): void => {
    try { localStorage.setItem(DISMISSED_KEY, 'true') } catch { /* ignore */ }
    this.emitEffect('examples:offer', { active: false, examples: [] })
  }

  #dismissed = (): boolean => {
    try { return localStorage.getItem(DISMISSED_KEY) === 'true' } catch { return false }
  }
}

const _exampleHives = new ExampleHivesWorker()
window.ioc.register('@diamondcoreprocessor.com/ExampleHivesWorker', _exampleHives)
