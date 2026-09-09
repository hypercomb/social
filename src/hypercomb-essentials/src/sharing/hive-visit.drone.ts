// sharing/hive-visit.drone.ts
//
// A hive-link arrives — what happens depends on WHO you are.
//
// A hive-link bundle (hive-link.ts) arrives via the /<sig> boot capture:
// MeetingInviteWorker decodes it and emits `hive:link`. This drone resolves
// the publisher's CURRENT head for the linked branch from their signed hive
// index (hive-pointer.ts) — verified against the pubkey pinned in the
// bundle, so no host can substitute content — and then:
//
//   A PARTICIPANT (a hive of their own) is handed an OFFER, never a fold.
//   Jaime, 2026-09-06: "Adopt is identical to a swarm — shaded by default,
//   and as you navigate through them you adopt them. Every action is a step
//   towards your permanence, your desires, your hive." The creation appears
//   at their top level as a shaded peer tile (static-peers.drone.ts); the
//   first click takes that tile, the second walks in, the children arrive
//   shaded, each one taken the same way. The link is the same door as the
//   community page's "show in my hive" — reached by a URL instead of a
//   click. Nothing is written until the participant takes something.
//
//   A VISITOR (the published visitor shell — a reader with no hive) gets the
//   PREVIEW MOUNT: the branch's layer closure is localized (content-addressed
//   cache, not adoption), a session-only preview head is seeded at the
//   publisher's segments, and the creation renders through the one real
//   render path with ZERO lineage writes. That mount IS the visitor
//   deployment's render path (hypercomb-web/src/main.visitor.ts listens for
//   `preview:mode` to set the URL base). A visitor has nothing to adopt
//   into, so the banner is a strip that says what is showing, with no exits.
//
// The whole flow rides the HTTPS byte tier only: it works with
// hc:mesh-public OFF (private mode) and never touches the relay.
//
// FOLLOWS. The old "adopt for review" left a follow record per adopted root
// (`hc:static-follows`, localStorage) and re-folded whole branches at boot
// when a publisher moved — a fold with no gesture. Those records are read
// ONCE by the static peer source and become offers; nothing folds at boot
// any more, and nothing writes that key again.

import { Drone, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { ensureDecorationsIndexed } from '../commands/decoration-kind-index.js'
import { publishLightsWithinAt } from '../commands/publish-lights.js'
import { adoptPublishedLights } from './behavior-enablement.js'
import { validateHiveLinkBundle, type HiveLinkBundle } from './hive-link.js'
import { checkRemoteHiveFormat } from './hive-format.js'
import { fetchHiveManifestFromAny } from './hive-pointer.js'
import { lineageKey } from '../history/lineage-key.js'
import { isPublishedVisitorShell } from './behavior-enablement.js'
import type { StaticOffer } from './static-peers.js'

const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const BROKER_KEY = '@diamondcoreprocessor.com/ContentBrokerDrone'
const NAV_KEY = '@hypercomb.social/Navigation'

const SIG_RE = /^[a-f0-9]{64}$/

/** The route a door carried, read off the SAME payload the bundle came in —
 *  `at` is never part of the bundle (it would change its signature and mean
 *  the same link landed everyone in the same place), so it is validated here
 *  and simply absent when the link was an ordinary invite. */
const routeBeside = (raw: unknown): string[] => {
  const at = (raw as { at?: unknown })?.at
  if (!Array.isArray(at)) return []
  return at.map(s => String(s ?? '').trim()).filter(Boolean).slice(0, 24)
}

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

/** Is this shell a READER of a published site, rather than a participant with
 *  a hive of their own? The visitor bootstrap stamps both marks before it
 *  imports the boot graph (hypercomb-web/src/setup/memory-filesystem.ts), so
 *  this is answerable by the time any visit lands. Agreed by convention, like
 *  the enablement keys — essentials never imports the shell. */
function isReadOnlySession(): boolean {
  try {
    if ((globalThis as { __HC_READONLY__?: boolean }).__HC_READONLY__ === true) return true
    return document?.documentElement?.dataset?.['hypercombMode'] === 'visitor'
  } catch { return false }
}

export class HiveVisitDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'

  public override description =
    'Receives a hive-link bundle and resolves the publisher\'s current head from their signed hive index. A participant is handed an OFFER — the creation appears shaded at their top level and each step through it is the adopt; a visitor shell gets the session-only preview mount that renders the published creation with zero lineage writes.'
  public override effects = ['network'] as const
  protected override listens = ['hive:link']
  protected override emits = ['community:offer', 'preview:mode', 'toast:show', 'activity:log']

  constructor() {
    super()
    this.onEffect<unknown>('hive:link', (raw) => { void this.#arrive(raw) })
  }

  #ioc = () => (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
  #i18n = () => this.#ioc()?.get<I18nProvider>(I18N_IOC_KEY)

  #toast(type: string, title: string, message: string): void {
    this.emitEffect('toast:show', { type, title, message })
  }

  // ── the head, from the publisher's signed index ──────────────────────

  #resolveHead = async (bundle: HiveLinkBundle): Promise<{ key: string; head: string } | null> => {
    const key = lineageKey(bundle.segments)
    const manifest = await fetchHiveManifestFromAny(bundle.hosts, bundle.pubkey)
    // BEFORE anything: does this client read the format this hive is written
    // in? The index is already signature-verified here, and the check is
    // silent unless the hive declares a format this build cannot read.
    if (manifest) void checkRemoteHiveFormat(manifest.roots, bundle.hosts).catch(() => null)
    // The signed index names "now"; the bundle's rootSig hint covers a
    // cold/unreachable index (the old closure stays hosted).
    const head = manifest?.roots[key] ?? bundle.rootSig ?? ''
    if (!SIG_RE.test(head)) {
      const i18n = this.#i18n()
      this.#toast('error', i18n?.t('preview.banner.title') ?? 'Hive link',
        i18n?.t('preview.unreachable') ?? 'This hive\'s index is unreachable and the link carries no fallback.')
      return null
    }
    return { key, head }
  }

  #arrive = async (raw: unknown): Promise<void> => {
    const bundle = validateHiveLinkBundle(raw)
    if (!bundle) { console.warn('[hive-visit] link rejected — malformed bundle', raw); return }
    if (isReadOnlySession()) await this.#previewForVisitor(bundle)
    // WHERE THEY WERE STANDING rides beside the bundle, not inside it: the
    // bundle is one creation's coordinates and is the same for everyone,
    // while the route is this reader's alone (meeting-invite.worker.ts).
    else await this.#offerToParticipant(bundle, routeBeside(raw))
  }

  // ── a participant: the offer ──────────────────────────────────────────

  #offerToParticipant = async (bundle: HiveLinkBundle, at: readonly string[] = []): Promise<void> => {
    const resolved = await this.#resolveHead(bundle)
    if (!resolved) return
    const name = bundle.segments[bundle.segments.length - 1] ?? ''
    const offer: StaticOffer = {
      name, pubkey: bundle.pubkey, hosts: [...bundle.hosts],
      lineageKey: resolved.key, segments: [...bundle.segments], head: resolved.head,
    }
    EffectBus.emit('community:offer', offer)
    // The shaded tile stands at your top level — go where it is, or, when the
    // door said where its reader was standing, go THERE: inside the offer, at
    // the route they came from. Still shaded, still taken one tile at a time
    // — landing somewhere is not holding it.
    this.#ioc()?.get<NavLike>(NAV_KEY)?.go(name && at.length ? [name, ...at] : [])
    const i18n = this.#i18n()
    this.emitEffect('activity:log', {
      message: i18n?.t('offer.arrived', { name })
        ?? `"${name}" is offered in your hive — shaded until you take it; the first click takes a tile, the second walks in`,
      icon: '●',
    })
  }

  // ── a visitor: the preview mount (the visitor deployment's render path) ──

  #previewForVisitor = async (bundle: HiveLinkBundle): Promise<void> => {
    const i18n = this.#i18n()
    const history = this.#ioc()?.get<HistoryLike>(HISTORY_KEY)
    const broker = this.#ioc()?.get<BrokerLike>(BROKER_KEY)
    const nav = this.#ioc()?.get<NavLike>(NAV_KEY)
    if (!history?.seedPreviewHead || !broker?.adopt || !nav) {
      console.warn('[hive-visit] cannot open: missing services', {
        history: !!history?.seedPreviewHead, broker: !!broker?.adopt, nav: !!nav,
      })
      return
    }
    const resolved = await this.#resolveHead(bundle)
    if (!resolved) return
    const { head } = resolved

    // Teach the broker where the bytes live (session-noted tier — works in
    // private mode, no relay flag needed), then localize the layer closure.
    // Bytes in the pool are content-addressed cache, not adoption.
    broker.noteDomainsForSig?.(head, bundle.hosts)
    console.log('[hive-visit] localizing closure from', bundle.hosts.join(','), 'head', head.slice(0, 12))
    const stats = await broker.adopt(head, { layersOnly: true, silent: true })
    console.log('[hive-visit] closure localized', JSON.stringify(stats))
    const root = await history.getLayerBySig(head)
    if (!root) {
      this.#toast('error', i18n?.t('preview.banner.title') ?? 'Hive preview',
        i18n?.t('preview.unreachable-bytes') ?? 'The hive\'s content isn\'t reachable right now — try again shortly.')
      return
    }
    const name = String(root['name'] ?? '').trim() || bundle.segments[bundle.segments.length - 1]

    // WHERE the preview mounts. A published SITE mounts at the publisher's
    // own segments — location-pinned marks (view:default, the pheromone
    // walk) only match where the publisher minted them, so a nested lineage
    // (games/arkanoid) flattened to /arkanoid would arrive as bare hexagons
    // with its face unmatched. A visitor origin holds no content of its own,
    // so nothing can be shadowed there.
    const mount = isPublishedVisitorShell() && bundle.segments.length > 0
      ? [...bundle.segments]
      : [name]

    // Collision: never preview OVER content already standing there.
    const locSig = await history.sign({ explorerSegments: () => [...mount] })
    const occupied = await history.currentLayerAt(locSig).catch(() => null)
    if (occupied) console.warn('[hive-visit] name already occupied:', name)
    if (occupied || !(await history.seedPreviewHead(mount, head))) {
      this.#toast('tip', i18n?.t('preview.banner.title') ?? 'Hive preview',
        i18n?.t('preview.collision', { name }) ?? `"${name}" is already standing here — the link could not be opened.`)
      return
    }

    // Hydrate the preview root's decorations BEFORE arriving. The arrival
    // arbitration (view.bee #openDefaultView) runs pre-paint and reads the
    // synchronous decoration index — deciding before this hydration meant a
    // published site whose root carries a view:default mark got a "hexagons"
    // verdict first, painted the empty grid + splash reveal, and only flipped
    // to its pinned page when the mark hydrated late. With the index warm the
    // first verdict IS the page, show-cell never paints, and the splash holds
    // until the view is up: loading screen → the opened view, nothing between.
    await ensureDecorationsIndexed(mount, []).catch(() => { /* verdict falls back to late hydration */ })
    // THE PUBLICATION'S OWN LIGHTS, adopted before the first paint. A visitor
    // is a brand-new install with no roster to opt in from, so the lights have
    // to come from the publisher or the creation renders undressed — shaded
    // hexagons wearing default art. The mark is sealed into the closure we
    // just landed (commands/publish-lights.ts), so this reads verified bytes,
    // not a side channel.
    //
    // AN EMPTY MARK IS NOT AN INSTRUCTION TO GO DARK. `[]` is truthy, so the
    // old `if (lights)` adopted it — and an empty on-list means every kind is
    // OFF, where an ABSENT one means all-on (isKindGloballyOff). A publication
    // whose census found nothing to name therefore blanked the visitor's whole
    // roster and rendered as bare hexagons wearing default art: strictly worse
    // than never having adopted at all. Adopt only when there is something to
    // light; "the publisher lit nothing" and "this predates the mark" both
    // leave the visitor's defaults alone, which is the same screen either way.
    const lights = await publishLightsWithinAt(mount).catch(() => null)
    if (lights?.length) adoptPublishedLights(lights)
    nav.go(mount)
    this.emitEffect('preview:mode', {
      active: true,
      label: name,
      segments: mount,
      pubkey: bundle.pubkey,
      hosts: bundle.hosts,
      tiles: stats.layers,
    })
  }
}

const _hiveVisit = new HiveVisitDrone()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/HiveVisitDrone',
  _hiveVisit,
)
