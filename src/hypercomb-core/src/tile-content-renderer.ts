// hypercomb-core/src/tile-content-renderer.ts
//
// Embedded website rendering — the minimal runtime contract.
//
// A cell can carry a single decoration: `websiteSig`. That signature
// resolves to a resource whose bytes are a concatenation of 64-char
// signatures — each pointing to another resource that together make
// up the site. The first sig is ALWAYS a JSON manifest that tells the
// renderer how the rest of the sigs are used.
//
// Bundle bytes:
//
//     <manifest-sig><asset-sig-1><asset-sig-2>...<asset-sig-N>
//
// No delimiters, no padding — the bee splits the string into 64-char
// chunks to get the list.
//
// Manifest shape:
//
//   { "version": 1,
//     "pages":  { "": "<sig>", "home": "<sig>", "about/team": "<sig>" },
//     "assets": { "style.css": "<sig>", "hero.png": "<sig>" },
//     "entry":  "<sig>"        // optional single-page fallback }
//
// When the user navigates into a tile whose subtree root carries
// `websiteSig`, the bee:
//
//   1. Fetch the bundle resource (`websiteSig`).
//   2. Split bytes into 64-char chunks.
//   3. Fetch the first chunk — the manifest.
//   4. Lookup `pages[currentRelativePath]` or fall back to `entry`.
//   5. Fetch the page HTML, rewrite `resource:<sig>` and `asset:<name>`
//      references to `/@resource/<sig>`, render in Shadow DOM.
//
// Authoring happens at design time through a Claude Code skill that
// reads the tile hierarchy and writes the bundle. The runtime does not
// know or care how the bundle was produced — it only needs one sig.

/**
 * Well-known property name on a cell's 0000 file. Value is a 64-hex
 * signature pointing to the bundle resource. The bundle cascades to
 * descendants — a cell inherits the nearest ancestor's websiteSig if
 * it does not have its own.
 */
export const CELL_WEBSITE_PROPERTY = 'websiteSig'

/**
 * Optional: per-cell override of the rendering kind. The default kind
 * for a bundle-decorated cell is `'website'`. A community module can
 * define a different kind (e.g. `'interactive-doc'`) that interprets
 * the same manifest shape differently.
 */
export const CELL_RENDERER_PROPERTY = 'renderer'

/**
 * Manifest shape inside a site bundle. The first 64 chars of the
 * bundle resource always resolve to a JSON document matching this type.
 */
export interface WebsiteManifest {
  readonly version: 1
  /** Map from path-relative-to-site-root → HTML resource signature. */
  readonly pages?: Record<string, string>
  /** Map from logical asset name → resource signature. */
  readonly assets?: Record<string, string>
  /** Fallback entry page when `pages[path]` is undefined. */
  readonly entry?: string
  /** Site title, used for `<title>` if a page does not specify one. */
  readonly title?: string
}

export interface TileRenderFrame {
  /** Path relative to the site root (the cell where `websiteSig` is decorated). */
  readonly pagePath: readonly string[]
  /** Full lineage path to current cell — useful for nav generation. */
  readonly fullPath: readonly string[]
}

export interface TileMountContext {
  /** Full-viewport element the renderer mounts into. */
  readonly host: HTMLElement
  /** The decoded website manifest. */
  readonly manifest: WebsiteManifest
  /** Read any resource from OPFS by signature. */
  readonly getResource: (signature: string) => Promise<Blob | null>
  /** The initial frame. */
  readonly frame: TileRenderFrame
  /** Navigate to an absolute lineage path. */
  readonly navigate: (path: readonly string[]) => void
}

export interface TileContentHandle {
  /** Called on navigation within the same site (no remount). */
  update(frame: TileRenderFrame): void
  unmount(): void
}

export interface TileContentRenderer {
  readonly key: string
  readonly kind: string
  readonly priority?: number
  mount(ctx: TileMountContext): TileContentHandle | Promise<TileContentHandle>
}

export interface TileContentRegistry {
  register(renderer: TileContentRenderer): void
  unregister(key: string): void
  resolve(kind: string): TileContentRenderer | null
}

export const TILE_CONTENT_REGISTRY_IOC_KEY = '@hypercomb.social/TileContentRegistry'
export const SITE_VIEW_IOC_KEY = '@hypercomb.social/SiteView'

/** URL prefix served by the resource service worker from OPFS. */
export const RESOURCE_URL_PREFIX = '/@resource/'

/**
 * Parse a bundle resource's text into an ordered list of signatures.
 * Bundle format: concatenated 64-char hex strings, no delimiters.
 * Invalid bundles return an empty array rather than throwing — caller
 * decides how to surface the failure.
 */
export function parseBundle(bundleText: string): readonly string[] {
  const trimmed = bundleText.trim()
  if (trimmed.length === 0 || trimmed.length % 64 !== 0) return []
  const sigs: string[] = []
  for (let i = 0; i < trimmed.length; i += 64) {
    const chunk = trimmed.slice(i, i + 64)
    if (!/^[0-9a-f]{64}$/i.test(chunk)) return []
    sigs.push(chunk.toLowerCase())
  }
  return sigs
}
