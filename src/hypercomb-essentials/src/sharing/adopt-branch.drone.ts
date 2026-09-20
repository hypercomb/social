// sharing/adopt-branch.drone.ts
//
// THE WHOLE BRANCH, ON PURPOSE. A peer tile in a swarm carries one door that
// takes it (the wand: one tile, never its children — the walk is the adopt)
// and, from here, a second one that takes it AND everything under it.
//
// The ruling that shaped the wand (2026-09-06: no branch adoption by default,
// "we want to dissuade people from mindlessly adding stuff to their hive")
// still governs this door — it is what makes it ASK. Before a single byte is
// folded the participant sees the count, who the tiles come from, and, past
// a dozen, a warning that walking in and taking what they actually want is
// the way to keep a hive theirs. Provenance is not decoration: in a swarm
// several participants can publish the same tile at the same place, and the
// dialog names every one of them and says whose version is being taken.
//
// Nothing here is a new adopt path. The count is the broker's layer-only
// walk (membership, a handful of tiny JSONs, never the branch's pictures);
// the fold is SwarmAdoptDrone.adoptResolvedBranch — inspection, code consent,
// receipts and the Beehaviors landing are the same as every explicit adopt.

import { Drone, EffectBus, requestConfirm, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import type { OverlayActionDescriptor, OverlayTileContext } from '../presentation/tiles/tile-overlay.drone.js'

const OWNER = '@diamondcoreprocessor.com/AdoptBranchDrone'
const ACTION = 'adopt-branch'
const SWARM_ADOPT_KEY = '@diamondcoreprocessor.com/SwarmAdoptDrone'
const SWARM_KEY = '@diamondcoreprocessor.com/SwarmDrone'
const BROKER_KEY = '@diamondcoreprocessor.com/ContentBrokerDrone'

/** Past this many tiles the dialog warns and its button turns danger-red. */
const LARGE_BRANCH = 12
/** How long the count may take before the dialog asks without a number. */
const COUNT_BUDGET_MS = 8_000

// A tree: trunk with two branches. Same 24-box, white-fill convention as the
// rest of the overlay glyphs.
const BRANCH_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M11 21v-6.2c-1.9-.4-3.4-1.7-4.1-3.4C4.6 11 3 9.1 3 7a4 4 0 0 1 7.6-1.7A4 4 0 0 1 21 7c0 2.1-1.6 4-3.9 4.4-.7 1.7-2.2 3-4.1 3.4V21h-2zm1-7.9c1.6 0 3-1 3.5-2.4l.3-.9.9-.1C18.2 9.6 19 8.4 19 7a2 2 0 0 0-3.8-.9L12 9.4 8.8 6.1A2 2 0 0 0 5 7c0 1.4.8 2.6 2.3 2.7l.9.1.3.9c.5 1.4 1.9 2.4 3.5 2.4z"/></svg>'

type SwarmAdoptLike = {
  wandEligible?: (label: string) => boolean
  peerBranchFor?: (label: string, pubkey?: string) => { layerSig: string; at: string[]; domain?: string; label: string; pubkey?: string } | null
  adoptResolvedBranch?: (
    branch: { layerSig: string; at: string[]; domain?: string; label: string },
  ) => Promise<'committed' | 'exists' | 'rewound' | 'unavailable' | 'declined' | 'uninspectable'>
}
type SwarmLike = {
  peerTilesAtCurrentSig?: () => readonly { name: string; peerPubkey: string }[]
  labelFor?: (pubkey: string) => string
}
type BrokerLike = {
  adopt?: (rootSig: string, opts?: { layersOnly?: boolean; silent?: boolean; quiet?: boolean }) => Promise<{ layers: number; failed: number }>
}
type TileActionPayload = { action: string; label: string }

const ioc = <T>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

const eligible = (label: string): boolean => {
  try { return ioc<SwarmAdoptLike>(SWARM_ADOPT_KEY)?.wandEligible?.(label) === true } catch { return false }
}

const DESCRIPTOR: OverlayActionDescriptor = {
  name: ACTION,
  owner: OWNER,
  svgMarkup: BRANCH_SVG,
  x: 0,
  y: 0,
  hoverTint: 0xb8f0c8,
  // Peer tiles only — the profile the overlay assigns a tile that is not
  // yours. Your own tile has nothing to adopt.
  profile: 'public-external',
  visibleWhen: (ctx: OverlayTileContext) => eligible(ctx.label),
  labelKey: 'action.adopt-branch',
  descriptionKey: 'action.adopt-branch.description',
}

export class AdoptBranchDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'
  public override description =
    'The branch door on a peer tile: counts the tiles under it, names the participants they come from, asks, then adopts the whole branch through the same fold every explicit adopt uses.'

  protected override listens = ['render:host-ready', 'overlay:request-register', 'tile:action']
  protected override emits = ['overlay:register-action', 'activity:log']

  #bound = false
  /** One dialog per tile at a time — a double-press must not stack two. */
  #asking = new Set<string>()

  protected override heartbeat = async (): Promise<void> => {
    if (this.#bound) return
    this.#bound = true
    // Same handshake as every other icon provider: emit once the overlay
    // exists, and again whenever it asks (idempotent — descriptors are
    // name-keyed, so a repeat is a no-op).
    this.onEffect('render:host-ready', () => this.emitEffect('overlay:register-action', DESCRIPTOR))
    this.onEffect('overlay:request-register', () => this.emitEffect('overlay:register-action', DESCRIPTOR))
    this.onEffect<TileActionPayload>('tile:action', (p) => {
      if (p?.action !== ACTION) return
      const label = String(p.label ?? '').trim()
      if (label) void this.#offer(label)
    })
  }

  #t = (key: string, params?: Record<string, string | number>, fallback = key): string => {
    const i18n = ioc<I18nProvider>(I18N_IOC_KEY)
    return i18n?.t(key, params) ?? fallback
  }

  #say = (message: string, icon = '✦'): void => {
    EffectBus.emit('activity:log', { message, icon })
  }

  /** Who publishes `label` at this location, freshest first, as the names
   *  the participant knows them by (a label if they announced one, else the
   *  start of their key). */
  #publishersOf = (label: string): { pubkey: string; name: string }[] => {
    const swarm = ioc<SwarmLike>(SWARM_KEY)
    const seen = new Set<string>()
    const out: { pubkey: string; name: string }[] = []
    for (const t of swarm?.peerTilesAtCurrentSig?.() ?? []) {
      if (t.name !== label || seen.has(t.peerPubkey)) continue
      seen.add(t.peerPubkey)
      const known = swarm?.labelFor?.(t.peerPubkey)?.trim()
      out.push({ pubkey: t.peerPubkey, name: known || t.peerPubkey.slice(0, 8) })
    }
    return out
  }

  /** Tiles UNDER the root, from the publisher's layer closure. Null when the
   *  walk did not finish inside the budget or could not resolve — the dialog
   *  then asks without a number rather than pretending it has one. */
  #countUnder = async (layerSig: string): Promise<number | null> => {
    const broker = ioc<BrokerLike>(BROKER_KEY)
    if (!broker?.adopt) return null
    const walk = broker.adopt(layerSig, { layersOnly: true, silent: true, quiet: true })
      .then(stats => (stats.failed > 0 ? null : Math.max(0, stats.layers - 1)))
      .catch(() => null)
    const budget = new Promise<null>(resolve => setTimeout(() => resolve(null), COUNT_BUDGET_MS))
    return Promise.race([walk, budget])
  }

  #offer = async (label: string): Promise<void> => {
    if (this.#asking.has(label)) return
    this.#asking.add(label)
    try {
      const adopt = ioc<SwarmAdoptLike>(SWARM_ADOPT_KEY)
      // RESOLVE BEFORE THE FIRST AWAIT — the same rule the wand keeps: the
      // location and the offer are gesture-time facts, and a navigation can
      // land behind this handler.
      const branch = adopt?.peerBranchFor?.(label) ?? null
      const publishers = this.#publishersOf(label)
      if (!branch || !adopt?.adoptResolvedBranch) {
        this.#say(this.#t('swarm.adopt-branch.unresolved', { label }, `nobody here is offering “${label}” right now`))
        return
      }
      const taking = publishers.find(p => p.pubkey === branch.pubkey) ?? publishers[0]
      const publisher = taking?.name ?? (branch.pubkey?.slice(0, 8) ?? '')
      const others = publishers.filter(p => p !== taking).map(p => p.name)

      const count = await this.#countUnder(branch.layerSig)
      const large = count === null || count >= LARGE_BRANCH
      const params = { label, count: count ?? '?', publisher, others: others.join(', ') }
      const message = count === 0
        ? 'swarm.adopt-branch.message-leaf'
        : others.length > 0 ? 'swarm.adopt-branch.message-many' : 'swarm.adopt-branch.message'
      const warning = count === null
        ? 'swarm.adopt-branch.uncounted'
        : count >= LARGE_BRANCH ? 'swarm.adopt-branch.warning' : undefined

      const yes = await requestConfirm({
        title: 'swarm.adopt-branch.title',
        message,
        messageParams: params,
        warning,
        warningParams: params,
        confirmLabel: 'swarm.adopt-branch.confirm',
        cancelLabel: 'confirm.cancel',
        danger: large,
      })
      if (!yes) return

      const result = await adopt.adoptResolvedBranch(branch)
      if (result === 'committed' || result === 'exists') {
        this.#say(this.#t('swarm.adopt-branch.done', params, `added “${label}” and ${params.count} tiles from ${publisher}`))
        return
      }
      // The fold already explained itself for 'unavailable' / 'uninspectable'
      // (features:outcome); the rest still deserve a line in the participant's
      // own words.
      if (result === 'rewound' || result === 'declined') {
        this.#say(this.#t('swarm.adopt-branch.failed', { label, reason: result }, `“${label}” was not added: ${result}`))
      }
    } finally {
      this.#asking.delete(label)
    }
  }
}

window.ioc.register(OWNER, new AdoptBranchDrone())
