// diamondcoreprocessor.com/sharing/share-link.drone.ts
//
// SHARE LINK — the one-off distribution gesture. Every tile gets a link
// overlay icon; clicking it mints a URL deep into this domain's tree and
// copies it to the clipboard. The link is just an ADDRESS (name-first — no
// sigs, no payload): opening it loads the domain like any visit, lands at
// the tile's parent with the tile selected (the canonical bracket form
// `/parent/[tile]`, the same shape NavigationService writes), and — when the
// tile carries a feature — opens the features panel focused on it via the
// `?features=<cell>` landing intent (see hypercomb-shared/core/
// bootstrap-history.ts).
//
// Share the root and you've shared the domain; share a leaf and you've
// shared the one thing. Same URL shape, same machinery — the depth of the
// path decides how targeted the landing is.
//
// The link NEVER auto-activates anything. It lands the recipient ON the
// switch: the adopt click downloads nothing, each feature switch is the
// consent, foreign code still hits the verification gate. A link that
// installed on open would be the drive-by-install every gate exists to
// prevent.

import { Drone } from '@hypercomb/core'
import { kindsForLabel } from '../commands/decoration-kind-index.js'

const LINEAGE_KEY = '@hypercomb.social/Lineage'
const VISUAL_BEE_REGISTRY_KEY = '@diamondcoreprocessor.com/VisualBeeRegistry'
const ICON_PROVIDER_REGISTRY_KEY = '@hypercomb.social/IconProviderRegistry'

// Material Icons Filled `link` — 24×24, white fill (tinted at sprite level).
const LINK_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>'

interface LineageLike {
  explorerSegments?: () => readonly string[]
}

interface VisualBeeRegistryLike {
  byDecorationKind?: (kind: string) => unknown
}

interface IconProviderRegistryLike {
  add(entry: {
    name: string
    owner?: string
    svgMarkup: string
    profiles?: readonly string[]
    defaultActive?: boolean
    hoverTint?: number
    labelKey?: string
    descriptionKey?: string
  }): void
}

interface TileActionPayload {
  action?: string
  label?: string
}

export class ShareLinkDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'

  public override description =
    'Mints a share link for any tile — the URL lands a visitor at the tile\'s parent with the tile selected (/parent/[tile]), and adds the ?features landing intent when the tile carries a feature. Copies to the clipboard; nothing activates on open.'

  protected override listens: string[] = ['tile:action']
  protected override emits: string[] = ['activity:log']

  constructor() {
    super()
    // Contribute the link icon through the ONE declarative extension point
    // (IconProviderRegistry) — no edit to tile-actions' core catalog. All
    // three tile profiles: your own tiles (private / public-own) and a
    // peer's (public-external — pass their address along).
    const registry = this.#ioc()?.get<IconProviderRegistryLike>(ICON_PROVIDER_REGISTRY_KEY)
    registry?.add({
      name: 'share-link',
      owner: '@diamondcoreprocessor.com/ShareLinkDrone',
      svgMarkup: LINK_ICON_SVG,
      profiles: ['private', 'public-own', 'public-external'],
      defaultActive: true,
      hoverTint: 0xa8d8ff,
      labelKey: 'action.share-link',
      descriptionKey: 'action.share-link.description',
    })

    this.onEffect<TileActionPayload>('tile:action', (payload) => {
      if (String(payload?.action ?? '') !== 'share-link') return
      const label = String(payload?.label ?? '').trim()
      if (!label) return
      void this.#mint(label)
    })
  }

  #ioc = () => (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc

  /** Does this tile carry a registered visual-bee feature? Same signal as
   *  the puzzle-piece icon — decides whether the link carries the
   *  open-the-features-panel landing intent. */
  #hasFeature(label: string): boolean {
    const registry = this.#ioc()?.get<VisualBeeRegistryLike>(VISUAL_BEE_REGISTRY_KEY)
    if (!registry?.byDecorationKind) return false
    for (const kind of kindsForLabel(label)) {
      if (registry.byDecorationKind(kind)) return true
    }
    return false
  }

  /** Build the tile's share URL: parent path + canonical bracket selection,
   *  segment content percent-encoded (bootstrap-history decodes per segment
   *  on landing), plus the features intent when there's a feature to land on. */
  #buildUrl(label: string): string {
    const lineage = this.#ioc()?.get<LineageLike>(LINEAGE_KEY)
    const parent = (lineage?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)
    const path = [...parent.map(encodeURIComponent), `[${encodeURIComponent(label)}]`].join('/')
    const intent = this.#hasFeature(label) ? `?features=${encodeURIComponent(label)}` : ''
    return `${window.location.origin}/${path}${intent}`
  }

  async #mint(label: string): Promise<void> {
    const url = this.#buildUrl(label)
    try {
      await navigator.clipboard.writeText(url)
      this.emitEffect('activity:log', { message: `link copied — ${url}`, icon: '●' })
    } catch {
      // Clipboard needs focus/permission — surface the URL so it can still
      // be copied by hand from the activity strip.
      this.emitEffect('activity:log', { message: `copy blocked — ${url}`, icon: '○' })
    }
  }
}

const _shareLink = new ShareLinkDrone()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/ShareLinkDrone',
  _shareLink,
)
