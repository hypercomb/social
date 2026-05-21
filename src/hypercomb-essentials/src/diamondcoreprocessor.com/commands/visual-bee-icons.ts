// diamondcoreprocessor.com/commands/visual-bee-icons.ts
//
// Bridges VisualBeeRegistry → IconProviderRegistry. For every adoptable
// visual bee, registers an overlay icon (profile `public-external`) so
// peer-supplied views can be opted into on a tile. Click dispatches the
// bee's slash command for the clicked cell.
//
// ── How icons appear on a tile ────────────────────────────────────────
//
// tile-actions.drone.ts merges IconProviderRegistry entries with its
// built-in icon catalog and builds OverlayActionDescriptors. Each
// descriptor carries `visibleWhen(ctx)` evaluated per-tile by the
// overlay renderer — that's where peer-vs-own / has-decoration-of-kind
// filtering happens.
//
// Click handling: tile-actions emits `tile:action { action, label }`
// when an overlay icon fires. We listen for actions matching `view:*`
// and translate them into a slash-command dispatch — same effect as the
// user typing `/<view>` in the command palette, but scoped to the cell
// they clicked.
//
// ── Visibility predicate ──────────────────────────────────────────────
//
// `visibleWhen` is synchronous. The renderer can't await an OPFS read
// for each tile each frame. So we pre-compute a per-cell map of which
// decoration kinds are present locally, updated when the layer changes.
// Today we return `true` unconditionally as a scaffold — the per-cell
// kind index is the natural next step (mirror the substrate
// `hasSubstrate` pattern; see substrate.drone.ts).
//
// ── Per-feature adoption flow ─────────────────────────────────────────
//
// 1. Peer's layer has `decorations` slot entries. Adopter sees the slot
//    (already in the merkle tree).
// 2. For each entry whose kind is registered with VisualBeeRegistry,
//    the icon surfaces on the tile.
// 3. Click → slash command runs locally → writes a local decoration via
//    `writeDecoration`, sig lands in adopter's `decorations` slot.
// 4. Renderer reads adopter's slot, fetches decoration content, renders.
//
// Step 3 currently re-runs the command (e.g., regenerates the website
// via Claude). A future variant: "copy peer's exact sig" — same content
// hash, instant deduped fetch from the resource pipeline. That variant
// will be a click-modifier (shift-click to copy, click to regenerate).

import { EffectBus } from '@hypercomb/core'
import type { VisualBeeRegistry, VisualBeeDescriptor } from './visual-bee-registry.js'
import { hasDecorationKind } from './decoration-kind-index.js'

/** IoC key for the shell-side icon registry. */
const ICON_REGISTRY_KEY = '@hypercomb.social/IconProviderRegistry'

/** Action-name prefix for visual-bee overlay icons. The tile-action
 *  dispatcher in this module listens for actions matching `view:*`. */
const VIEW_ACTION_PREFIX = 'view:'

/** Profile under which visual-bee icons register. `public-external`
 *  matches the "peer-supplied" semantics: these are features adopted
 *  from someone else's tile, surfaced in the pool of available icons
 *  rather than the always-on row. */
const ICON_PROFILE = 'public-external'

/** Bare-bones default SVG used when a visual bee doesn't carry its own
 *  icon mark. Replace per-bee by registering a richer icon under the
 *  same name in IconProviderRegistry from the bee's own module. */
const DEFAULT_VIEW_ICON_SVG = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="12" cy="12" r="9"/>
  <path d="M3 12h18"/>
  <path d="M12 3a14 14 0 0 1 0 18"/>
  <path d="M12 3a14 14 0 0 0 0 18"/>
</svg>`.trim()

type TileIconProvider = {
  name: string
  owner?: string
  svgMarkup: string
  profile: string
  hoverTint?: number
  visibleWhen?: (ctx: unknown) => boolean
  labelKey?: string
  descriptionKey?: string
}

type IconProviderRegistry = {
  add(provider: TileIconProvider): void
  remove(name: string): void
}

const REGISTERED_ICONS = new Set<string>()

/** Compose the IconProviderRegistry name for a visual bee. */
function iconNameForBee(bee: VisualBeeDescriptor): string {
  return `${VIEW_ACTION_PREFIX}${bee.view}`
}

/** Sync the IconProviderRegistry to the current set of adoptable visual
 *  bees. Runs on every VisualBeeRegistry `change` event. Idempotent —
 *  re-adds skip the dup check inside IconProviderRegistry. */
function syncIcons(): void {
  const visualBees = window.ioc.get<VisualBeeRegistry>('@diamondcoreprocessor.com/VisualBeeRegistry')
  const iconRegistry = window.ioc.get<IconProviderRegistry>(ICON_REGISTRY_KEY)
  if (!visualBees || !iconRegistry) return

  const want = new Set<string>()
  for (const bee of visualBees.adoptable()) {
    const name = iconNameForBee(bee)
    want.add(name)
    if (REGISTERED_ICONS.has(name)) continue
    iconRegistry.add({
      name,
      owner: '@diamondcoreprocessor.com/visual-bee-icons',
      svgMarkup: DEFAULT_VIEW_ICON_SVG,
      profile: ICON_PROFILE,
      labelKey: bee.labelKey,
      descriptionKey: bee.descriptionKey,
      // Per-tile visibility: surface the icon on tiles that DON'T
      // already have a decoration of this bee's kind. Clicking opts
      // the cell in to the view (runs the bee's slash command), which
      // writes a decoration → kind-index sees the change → icon
      // naturally hides on the next render. Backed by the in-memory
      // index in decoration-kind-index.ts; populated from
      // `decorations:changed` events and `render:cell-count`
      // hydration.
      //
      // For peer-content adoption (only surface icons for views the
      // peer offers at this cell, not all registered views), the
      // predicate would AND against a peer-offered registry populated
      // from peer's layer during swarm-adopt. That requires
      // capturing peer's layer-sig at adoption time — pending.
      visibleWhen: (ctx) => {
        const label = (ctx as { label?: string })?.label
        return typeof label === 'string' && !hasDecorationKind(label, bee.decorationKind)
      },
    })
    REGISTERED_ICONS.add(name)
  }

  // Remove icons whose bee was unregistered.
  for (const name of REGISTERED_ICONS) {
    if (want.has(name)) continue
    iconRegistry.remove(name)
    REGISTERED_ICONS.delete(name)
  }
}

/** Dispatch a click on a visual-bee icon. Two paths:
 *
 *   1. If the bee declares a `queenKey`, look up that QueenBee in IoC
 *      and call `invoke(label)` — same as if the user typed
 *      `/<view> <label>` in the command palette. The bee runs locally
 *      and (in the migrated world) writes a decoration via
 *      writeDecoration → cascades the sig into the local
 *      `decorations` slot.
 *
 *   2. If no `queenKey`, broadcast `visual-bee:adopt-request` carrying
 *      the view name + label. The bee's own module can listen for this
 *      and react however it wants (custom-rolled adoption path).
 *
 * The label rides on the tile:action payload — same convention as the
 * built-in tile actions. */
function dispatchViewAction(action: string, label: string | undefined): void {
  const view = action.slice(VIEW_ACTION_PREFIX.length)
  if (!view) return
  const visualBees = window.ioc.get<VisualBeeRegistry>('@diamondcoreprocessor.com/VisualBeeRegistry')
  const bee = visualBees?.get(view)
  if (!bee) return

  if (bee.queenKey) {
    const queen = window.ioc.get<{ invoke: (args: string) => Promise<void> | void }>(bee.queenKey)
    if (queen?.invoke) {
      void queen.invoke(label ?? '')
      return
    }
  }

  EffectBus.emit('visual-bee:adopt-request', {
    view: bee.view,
    label: label ?? null,
  })
}

// ── Wire up: listen to registry changes + tile:action events ──────────

;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<VisualBeeRegistry>(
  '@diamondcoreprocessor.com/VisualBeeRegistry',
  (registry) => {
    registry.addEventListener('change', () => syncIcons())
    syncIcons() // initial sync — registry may already have bees registered
  },
)

// tile-action dispatcher. Catch every action whose name starts with the
// view-icon prefix and route it through the visual-bee registry.
addEventListener('tile:action' as keyof WindowEventMap, (event) => {
  const detail = (event as CustomEvent<{ action?: string; label?: string }>).detail
  if (!detail?.action?.startsWith(VIEW_ACTION_PREFIX)) return
  dispatchViewAction(detail.action, detail.label)
})
