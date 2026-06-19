// diamondcoreprocessor.com/presentation/tiles/show-features.drone.ts
//
// "Show features" — the puzzle-piece overlay icon. Click it and this drone
// gathers the META details (NO code) of the bee features the clicked tile
// is using, and emits `features:open` so the shell-side right-docked
// features panel can list them. Clicking another tile's icon ADDS that
// tile's features to the same list (the panel accumulates) — you run
// through the hive collecting features without ever leaving for the
// installer.
//
// ── What counts as a "feature" of a tile ──────────────────────────────
//
// A tile's decoration kinds (the hot in-memory `kindsForLabel` index) that
// are OWNED by a registered visual bee (VisualBeeRegistry.byDecorationKind).
// A visual bee IS the render-feature/scripts portion a tile carries
// (website, dashboard, audio, …) — the same honest "has a feature" signal
// the icon's `tileHasVisualBeeFeature` gate uses. Plain images and
// pure-data cards (contact, files) register a layer-slot/icon, NOT a
// VisualBeeRegistry entry, so they are not listed here.
//
// ── Staging is benign (panel-side) ────────────────────────────────────
//
// The panel lets the participant "want" a feature. That is BENIGN: nothing
// activates. It only records the feature's branch signature in a hive-local
// staging list (see feature-staging.ts). When the participant later opens
// the installer, portal-overlay hands the staged sigs over and they come
// PRE-TICKED. We surface `branchSig` here — the publisher's broadcast layer
// sig when a peer offers this tile (the same sig the old features→installer
// hand-off passed as `branch=`), so the installer can resolve and tick it.
// Local-only tiles have no peer branch to install, so they carry no sig and
// stage as metadata-only (a no-op for the installer, still listed for you).

import { Drone } from '@hypercomb/core'
import type { I18nProvider } from '@hypercomb/core'
import { kindsForLabel } from '../../commands/decoration-kind-index.js'
import type { VisualBeeRegistry, VisualBeeDescriptor } from '../../commands/visual-bee-registry.js'

const VISUAL_BEE_REGISTRY_KEY = '@diamondcoreprocessor.com/VisualBeeRegistry'
const SWARM_DRONE_KEY = '@diamondcoreprocessor.com/SwarmDrone'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
const I18N_KEY = '@hypercomb.social/I18n'

const SIG_RE = /^[a-f0-9]{64}$/

/** One feature row handed to the shell panel. All strings are pre-resolved
 *  (i18n applied here, where the provider lives) so the panel stays a dumb
 *  list. `branchSig` is the installer-resolvable handle, present only when a
 *  peer broadcasts this tile's branch. */
interface FeatureItem {
  view: string
  kind: string
  slashCommand?: string
  behavior?: string
  label: string
  description: string
  branchSig?: string
}

interface FeaturesOpenPayload {
  cell: string
  segments: string[]
  features: FeatureItem[]
}

interface TileActionPayload {
  action?: string
  label?: string
}

interface SwarmDroneLike {
  peerTilesAtCurrentSig?: () => readonly ({ name: string } & Record<string, unknown>)[]
}

interface LineageLike {
  explorerSegments?: () => readonly string[]
}

export class ShowFeaturesDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'

  public override description =
    'Gathers the bee-feature metadata (no code) of a clicked tile and emits features:open so the shell panel lists them; the panel accumulates across tiles. Read-only — staging the features is benign and handled panel-side.'

  protected override listens: string[] = ['tile:action']
  protected override emits: string[] = ['features:open']

  constructor() {
    super()
    this.onEffect<TileActionPayload>('tile:action', (payload) => {
      if (String(payload?.action ?? '') !== 'features') return
      const label = String(payload?.label ?? '').trim()
      if (!label) return
      this.#open(label)
    })
  }

  #ioc = () => (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc

  #open(label: string): void {
    const ioc = this.#ioc()
    const registry = ioc?.get<VisualBeeRegistry>(VISUAL_BEE_REGISTRY_KEY)
    if (!registry?.byDecorationKind) return

    const lineage = ioc?.get<LineageLike>(LINEAGE_KEY)
    const parent = (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    const segments = [...parent, label]

    const branchSig = this.#peerBranchSig(label)
    const i18n = ioc?.get<I18nProvider>(I18N_KEY)

    // De-dupe by view: a tile may carry several decorations of the same
    // visual bee (e.g. two website pages) — one feature row is enough.
    const seen = new Set<string>()
    const features: FeatureItem[] = []
    for (const kind of kindsForLabel(label)) {
      const bee: VisualBeeDescriptor | undefined = registry.byDecorationKind(kind)
      if (!bee || seen.has(bee.view)) continue
      seen.add(bee.view)
      features.push(this.#describe(bee, kind, branchSig, i18n))
    }

    this.emitEffect<FeaturesOpenPayload>('features:open', { cell: label, segments, features })
  }

  /** Build a feature row, resolving the bee's i18n label/description here
   *  (fallback to the view name / slash command when no catalog entry). */
  #describe(
    bee: VisualBeeDescriptor,
    kind: string,
    branchSig: string | undefined,
    i18n: I18nProvider | undefined,
  ): FeatureItem {
    const t = (key: string | undefined, fallback: string): string => {
      if (!key) return fallback
      const v = i18n?.t?.(key)
      return typeof v === 'string' && v && v !== key ? v : fallback
    }
    return {
      view: bee.view,
      kind,
      slashCommand: bee.slashCommand,
      behavior: bee.behavior,
      label: t(bee.labelKey, bee.view),
      description: t(bee.descriptionKey, ''),
      ...(branchSig ? { branchSig } : {}),
    }
  }

  /** The publisher's broadcast layer sig for this tile, when a live peer
   *  offers it — the installer-resolvable handle the staging hands over.
   *  Mirrors tile-actions' peerBroadcastsTile cache read. */
  #peerBranchSig(label: string): string | undefined {
    const swarm = this.#ioc()?.get<SwarmDroneLike>(SWARM_DRONE_KEY)
    if (!swarm?.peerTilesAtCurrentSig) return undefined
    for (const tile of swarm.peerTilesAtCurrentSig()) {
      if (tile.name !== label) continue
      const sig = String(tile['layerSig'] ?? '').trim().toLowerCase()
      if (SIG_RE.test(sig)) return sig
    }
    return undefined
  }
}

const _showFeatures = new ShowFeaturesDrone()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/ShowFeaturesDrone',
  _showFeatures,
)
