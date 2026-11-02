// presentation/tiles/portal-carry.drone.ts
//
// PortalCarryDrone — the SHELF icon on tiles, the way onto the shelf
// (documentation/recents-and-the-quick-tray.md, codex A9). It stands in the
// band's always-visible icon row with the others. A click sends a REFERENCE to
// the shelf at the top of the screen: the tile's name, the page it stands on,
// and the sig that page lists it by. Nothing is written — no cut, no marker; the
// source page is untouched until the tray's own drop says otherwise.
//
// It was a drag handle once, and the name stays because the name is an address
// (saved icon arrangements and i18n keys hold it). There is no drag now: a tile
// reaches a portal from the shelf, whose rows drop onto Portals rows.
//
// It also answers `shelf:take-selection`, the bottom-right "to shelf" button:
// every selected tile goes onto the shelf from the page it stands on, and the
// selection clears, because the gesture is done.
//
// Essentials never imports shared: the contract with the tray is the EffectBus
// payload.

import { Drone, EffectBus } from '@hypercomb/core'
import { childEntriesOf, type PlacementHistory } from '../../history/layer-placement.js'
import { takePayload } from './portal-carry.plan.js'

const LINEAGE_KEY = '@hypercomb.social/Lineage'
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const ACTION_NAME = 'portal-carry'
/** The icon registry mounts with the shell; a module that loads before it
 *  asks again shortly rather than never showing the icon. */
const REGISTRY_RETRY_MS = 200

type LineageLike = { explorerSegments?: () => readonly string[]; readonly domain?: unknown }

// move_to_inbox — Material Icons Filled. A tray with an arrow going into it.
const TRAY_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M19 3H4.99c-1.11 0-1.98.9-1.98 2L3 19c0 1.1.88 2 1.99 2H19c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 12h-4c0 1.66-1.35 3-3 3s-3-1.34-3-3H4.99V5H19v10zm-3-5h-2V7h-4v3H8l4 4 4-4z"/></svg>'

/** The shell-side icon registry contract (defined locally — essentials must
 *  not import shared). Same shape contact.drone.ts declares. */
type IconProviderRegistryLike = {
  add(p: {
    name: string
    owner?: string
    svgMarkup: string
    profiles?: readonly string[]
    defaultActive?: boolean
    hoverTint?: number
    labelKey?: string
    descriptionKey?: string
  }): void
  remove(name: string): void
}

export class PortalCarryDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  public override description =
    'Shelf icon on tiles: a click sends a reference to the shelf at the top of the screen; the to-shelf button sends the selection.'

  protected override deps = {}
  protected override listens: string[] = ['tile:action', 'shelf:take-selection']
  protected override emits: string[] = ['quick-tray:take']

  #initialized = false
  /** Whether the icon's provider is currently registered. */
  #iconShown = false
  #registryRetry: ReturnType<typeof setTimeout> | null = null

  protected override sense = () => true

  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    this.#showIcon()
    this.onEffect<{ action?: string; label?: string }>('tile:action', (p) => {
      if (p?.action === ACTION_NAME && p?.label) void this.#take(p.label, this.#here())
    })
    EffectBus.on('shelf:take-selection', () => { void this.#takeSelection() })
  }

  /** The selection, onto the shelf, in the order it reads on the page. */
  async #takeSelection(): Promise<void> {
    const selection = window.ioc.get<{ selected?: ReadonlySet<string>; clear?: () => void }>('@diamondcoreprocessor.com/SelectionService')
    const labels = [...(selection?.selected ?? [])]
    if (labels.length === 0) return
    const here = this.#here()
    for (const label of labels) await this.#take(label, here)
    selection?.clear?.()
  }

  protected override dispose(): void {
    if (this.#registryRetry) { clearTimeout(this.#registryRetry); this.#registryRetry = null }
    if (!this.#iconShown) return
    this.#iconShown = false
    this.#registry()?.remove(ACTION_NAME)
  }

  /** The page the participant is standing on — a take's SOURCE. */
  #here(): string[] {
    const lineage = window.ioc.get<LineageLike>(LINEAGE_KEY)
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }

  #registry(): IconProviderRegistryLike | undefined {
    return (window as { ioc?: { get?: (k: string) => unknown } })
      .ioc?.get?.('@hypercomb.social/IconProviderRegistry') as IconProviderRegistryLike | undefined
  }

  /** Add the icon through the ONE declarative extension point — no edit to
   *  tile-actions' core catalog. No row flag: a plain provider stands in the
   *  always-visible top row with the others. */
  #showIcon(): void {
    const registry = this.#registry()
    if (!registry) {
      this.#registryRetry = setTimeout(() => { this.#registryRetry = null; this.#showIcon() }, REGISTRY_RETRY_MS)
      return
    }
    this.#iconShown = true
    registry.add({
      name: ACTION_NAME,
      owner: this.iocKey,
      svgMarkup: TRAY_ICON_SVG,
      profiles: ['private', 'public-own'],
      defaultActive: true,
      hoverTint: 0xa8c8ff,
      labelKey: 'action.portal-carry',
      descriptionKey: 'action.portal-carry.description',
    })
  }

  /** THE TAKE. Sends the reference to the tray: the label, the source page,
   *  and — read, never written — the sig the source page lists the tile by,
   *  manifest-first through the parent's head. A cold parent sends the
   *  reference without a sig; the tray's drop seals the live subtree anyway,
   *  so nothing is lost but a thumbnail until then. */
  async #take(label: string, source: readonly string[]): Promise<void> {
    let sig: string | null = null
    try {
      const history = window.ioc.get<PlacementHistory>(HISTORY_KEY)
      const lineage = window.ioc.get<LineageLike>(LINEAGE_KEY)
      if (history) {
        const locSig = await history.sign({ domain: lineage?.domain, explorerSegments: () => source })
        const parent = locSig ? await history.currentLayerAt(locSig) : null
        if (parent) {
          const { entries } = await childEntriesOf(history, parent)
          sig = entries.find(e => e.name === label)?.sig ?? null
        }
      }
    } catch { /* cold — the reference still goes */ }
    this.emitEffect('quick-tray:take', takePayload(label, source, sig))
  }
}

const _portalCarry = new PortalCarryDrone()
window.ioc.register('@diamondcoreprocessor.com/PortalCarryDrone', _portalCarry)
