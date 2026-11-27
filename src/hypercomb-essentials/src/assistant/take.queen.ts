// assistant/take.queen.ts
//
// `take <signature>` — A CREATION FOUND ELSEWHERE, TAKEN INTO THIS HIVE
// (jwize 2026-11-13: "explore across domains including shared community
// creations", "use the hive to build stuff").
//
// A model can find what other hives made public: `explore <name>` lists the
// published tiles of a name by signature, `pool host:publications` lists every
// creation's head, and `read <signature>` walks into either. Until this word
// it could only look. `take` brings the tile a signature names, and every tile
// under it, onto a page of this hive:
//
//   take <signature>               onto the page the participant is on
//   take <signature> at /<route>   onto that page (`at /` is the first page)
//
// NOTHING HERE IS A NEW ADOPT PATH. The fold is
// SwarmAdoptDrone.adoptResolvedBranch — inspection, the refusal of code, the
// combine with what the participant already holds, and the read-back are the
// ones every explicit adopt uses (adopt-branch.drone.ts, site-replica.ts).
//
// IT STAYS IN THE HIVE. What goes out is what a read of the same signature
// sends: a request for it, and for the layers it names, to the hosts this
// hive already asks. Nothing is signed, nothing is published, no host is told
// who asked. What is written is layers on this device, one step in the page's
// history, and this device's own adopt receipts. Sharing what was taken is
// the participant's own act, never this word's.
//
// THE HAND IS THE PARTICIPANT'S. A signature reaches a model through a pool or
// a name explored, and the chat holds every change that follows such a read
// for the participant's Run (execution-queue.ts, `foreign`). The branch door
// asks with a count; this word has no dialog, so it will not bring more than
// TAKE_MAX_TILES at once, and says how to take a part instead.
//
// A take that did not happen THROWS, so a machine's receipt never says "ran"
// for nothing.

import { QueenBee, EffectBus } from '@hypercomb/core'
import { foundHostsOf } from './found-hosts.js'
import { HIVE_TREE_READER_IOC_KEY } from './hive-tree-reader.js'

const SWARM_ADOPT_KEY = '@diamondcoreprocessor.com/SwarmAdoptDrone'
const BROKER_KEY = '@diamondcoreprocessor.com/ContentBrokerDrone'
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const LINEAGE_KEY = '@hypercomb.social/Lineage'

/** The most tiles one take brings. The branch door warns a participant past a
 *  dozen and still lets them choose; nobody is shown a count here, so past
 *  this the word refuses and names the way to take a part. */
export const TAKE_MAX_TILES = 100

const SIGNATURE = /^[0-9a-f]{64}$/
const FORM = /^([0-9a-f]{64})(?:\s+at\s+(\/.*))?$/i
const BACKSLASH = String.fromCharCode(92)
const unsafe = (name: string): boolean =>
  [...name].some(ch => ch === '/' || ch === BACKSLASH || ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)

export const TAKE_FORMS = 'take <signature>, or take <signature> at /<route>'

export type TakeRequest = {
  readonly sig: string
  /** The page said with `at`, from the first page; null for the page the
   *  participant is on. */
  readonly route: readonly string[] | null
}

/** What a take line asks for, or the reason it asks for nothing. */
export const parseTake = (args: string): TakeRequest | string => {
  const match = FORM.exec(String(args ?? '').trim())
  if (!match) return `take needs the signature of a published tile: ${TAKE_FORMS}`
  if (match[2] === undefined) return { sig: match[1].toLowerCase(), route: null }
  const route = match[2].split('/').map(part => part.trim()).filter(Boolean)
  if (route.some(unsafe)) return `that is not a page of this hive: ${TAKE_FORMS}`
  return { sig: match[1].toLowerCase(), route }
}

type AdoptOutcome = 'committed' | 'exists' | 'rewound' | 'unavailable' | 'declined' | 'uninspectable'
type SwarmAdoptLike = {
  adoptResolvedBranch?: (
    branch: { layerSig: string; at: string[]; domain?: string; label: string },
    opts?: { silent?: boolean },
  ) => Promise<AdoptOutcome>
}
type BrokerLike = {
  adopt?: (rootSig: string, opts?: { layersOnly?: boolean; silent?: boolean; quiet?: boolean }) => Promise<{ layers: number; failed: number }>
  hintDomainsForSig?: (sig: string, domains: string[]) => void
  knownContentHosts?: () => readonly string[]
}
type HistoryLike = { getLayerBySig?: (sig: string) => Promise<{ name?: unknown } | null> }
type LineageLike = { explorerSegments?: () => readonly string[] }
type TreeReaderLike = {
  readNode?(segments: readonly string[], options: { maxBytes: number; withContent: boolean }): Promise<
    { ok: true; children: readonly { name: string }[] } | { ok: false; code?: string }
  >
}

const service = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

const pageWords = (at: readonly string[]): string => (at.length ? `/${at.join('/')}` : 'the first page')

export class TakeQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'take'
  override description = 'Take a published tile found on another hive into this one, with everything under it'
  override options = ['<signature>', '<signature> at /<route>']
  override examples = [
    { input: '/take <signature>', result: 'Brings the published tile that signature names, and the tiles under it, onto this page' },
    { input: '/take <signature> at /recipes', result: 'Brings it onto the recipes page instead' },
  ]
  // A route is a place, never other words: `at /host/hive` must not be read as
  // the host and hive behaviours.
  override rawArgs = true

  // OFFERED TO A MODEL. ADDITIVE: a tile that was not here arrives, and a tile
  // of the same name already here keeps every value of its own. HIVE, not
  // network: traced to its code 2026-11-14 — the fold asks hosts for
  // signatures exactly as a read does, signs nothing and publishes nothing
  // (the header says what is written). Not page: a route reaches any page,
  // and the adopt receipts are this device's own, kept beside no single tile.
  override machine = {
    forms: '<signature> | <signature> at /<route>',
    example: '/take <signature> at /recipes',
    reach: 'additive' as const,
    scope: 'hive' as const,
    consequence: `Brings the published tile that signature names, and every tile under it, into this hive: onto the page the participant is on, or onto the page at /<route> names (at / is the first page). The signature is one a read gave: a tile's sig from explore, a publication's head from pool host:publications or pool showcase:<zone>, or a child that read <signature> listed. It asks the hosts for those layers as a read does; nothing is signed or published, and code never comes: a tile that carries code is refused whole. A tile of that name already on the page keeps its own values and gains what it lacked. More than ${TAKE_MAX_TILES} tiles at once is refused: read into it and take a part. It is one step in that page's history.`,
    refuse: (args: string): string | undefined => {
      const asked = parseTake(args)
      return typeof asked === 'string' ? asked : undefined
    },
  }

  protected async execute(args: string): Promise<void> {
    const asked = parseTake(args)
    if (typeof asked === 'string') throw new Error(asked)
    const { sig } = asked

    const adopt = service<SwarmAdoptLike>(SWARM_ADOPT_KEY)
    const broker = service<BrokerLike>(BROKER_KEY)
    const history = service<HistoryLike>(HISTORY_KEY)
    const reader = service<TreeReaderLike>(HIVE_TREE_READER_IOC_KEY)
    if (!adopt?.adoptResolvedBranch || !broker?.adopt || !history?.getLayerBySig || !reader?.readNode) {
      throw new Error('taking a published tile is not available here; nothing was taken')
    }

    // WHERE, said or stood on. A route is not a guess: one that names no page
    // is refused aloud, never landed somewhere else.
    const at = asked.route
      ?? [...(service<LineageLike>(LINEAGE_KEY)?.explorerSegments?.() ?? [])].map(String).filter(Boolean)
    const where = pageWords(at)
    const page = await reader.readNode(at, { maxBytes: 1_000_000, withContent: false }).catch(() => null)
    if (!page?.ok) {
      throw new Error(asked.route
        ? `there is no page at ${where}; nothing was taken`
        : `this page could not be read; nothing was taken. Name the page: ${TAKE_FORMS}`)
    }

    // FROM WHERE IT WAS FOUND (reach A4): the hosts the read that named this
    // signature led to are hinted to the broker again before the walk, so
    // bytes kept only on a host outside the broker's tiers are asked there.
    // A hint, never a note: those hosts only LISTED the signature, and the
    // broker learns a host only by the fetch that got its bytes, so a take
    // of a popular head cannot push the hosts earlier adopts rely on out of
    // the persisted list. Attribution only; every byte is still hash-checked,
    // and nothing goes out but the request.
    const found = foundHostsOf(sig)
    if (found.length) {
      try { broker.hintDomainsForSig?.(sig, [...found]) } catch { /* attribution only */ }
    }

    // WHAT, and how much: the layers under the signature, never its pictures.
    // The same walk the branch door counts with; what it fetched stays in the
    // layer pool whether or not the take goes on, as a read's would.
    const walk = await broker.adopt(sig, { layersOnly: true, silent: true, quiet: true }).catch(() => null)
    if (!walk || walk.layers < 1) {
      throw new Error(`no host this hive can ask holds a tile under ${sig.slice(0, 8)}…; nothing was taken`)
    }
    if (walk.failed > 0) {
      throw new Error(`part of what ${sig.slice(0, 8)}… names could not be reached from any host; nothing was taken`)
    }
    if (walk.layers > TAKE_MAX_TILES) {
      throw new Error(`that is ${walk.layers} tiles, and a take brings ${TAKE_MAX_TILES} at most; read ${sig} to walk into it, and take the part that is wanted. Nothing was taken`)
    }
    const layer = await history.getLayerBySig(sig).catch(() => null)
    const name = typeof layer?.name === 'string' ? layer.name.trim() : ''
    if (!name || unsafe(name)) {
      throw new Error(`${sig.slice(0, 8)}… does not name a tile; nothing was taken`)
    }
    const under = walk.layers - 1
    // The fold's domain is a found host the broker now KNOWS, one whose bytes
    // arrived (or one it already asked), never merely the first that listed it.
    const known = new Set((() => { try { return broker.knownContentHosts?.() ?? [] } catch { return [] } })())
    const domain = found.find(host => known.has(host))
    const held = page.children.some(child => child.name === name)

    // WHY THE FOLD SAID NO, in its own words. It explains itself on
    // `features:outcome`; the bus replays the last one as a handler joins, so
    // only what arrives after the join is this take's.
    let said = ''
    let joined = false
    const off = EffectBus.on<{ cell?: string; ok?: boolean; message?: string }>('features:outcome', outcome => {
      if (joined && outcome?.cell === name && outcome.ok === false && outcome.message) said = String(outcome.message)
    })
    joined = true
    let outcome: AdoptOutcome
    try {
      outcome = await adopt.adoptResolvedBranch({ layerSig: sig, at: [...at], label: name, ...(domain ? { domain } : {}) }, { silent: true })
    } finally {
      off()
    }

    if (outcome === 'committed' || outcome === 'exists') {
      const message = outcome === 'exists'
        ? `“${name}” is already at ${where} as published; nothing new was taken`
        : held
          ? `“${name}” was already at ${where}: it kept its own values and gained what it lacked`
          : under > 0
            ? `took “${name}” and ${under} ${under === 1 ? 'tile' : 'tiles'} under it to ${where}`
            : `took “${name}” to ${where}`
      EffectBus.emit('toast:show', { type: outcome === 'exists' ? 'info' : 'success', message })
      EffectBus.emit('activity:log', { message, icon: '●' })
      return
    }
    if (outcome === 'rewound') {
      throw new Error(`${where} is showing its history; return to the present, then take it again. Nothing was taken`)
    }
    // 'unavailable' is code the fold will not bring, or a tile beside it that
    // could not be read; that second case the fold tries again by itself.
    throw new Error(said
      ? `${said}. Nothing was taken now`
      : `“${name}” was not taken: it carries code, which a take never brings, or a tile it sits beside could not be read. Nothing was taken now`)
  }
}

const _take = new TakeQueenBee()
window.ioc.register('@diamondcoreprocessor.com/TakeQueenBee', _take)
