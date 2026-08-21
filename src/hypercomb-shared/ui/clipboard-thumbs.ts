// hypercomb-shared/ui/clipboard-thumbs.ts
//
// ONE RESOLVER for "what does this clipboard entry look like". Both faces of
// the gathered set — the clipboard panel's rows and the chat header's context
// squares — turn a {label, sourceSegments} entry into a blob: URL through
// this one path, so the two can never show different pictures for one entry.
// Shared UI reaches essentials services only at runtime via window.ioc.
//
// `prefer` picks WHICH picture: 'small' is the hex capture (gold rim baked
// in) and belongs to hex-shaped chrome; 'large' is the tile's PICTURE and is
// what a rectangle or square must show first — a hex capture in a square
// frame reads as a mistake, so it is only the last resort.
//
// Thumbnails are best-effort and must NEVER block the UI. Resolution goes
// through the participant-local props-index (localStorage, O(1)) — the same
// cache the renderer reads — with the worker's warm canonical lookup as the
// only fallback. We deliberately do NOT touch `history.currentLayerAt`: for
// a tile with no index entry that read can trigger a cold `preloadAllBags`
// whole-tree scan, and a set of N such entries would fire N scans and hang
// the surface. A miss returns null and the caller shows its glyph.

const SIG_RE = /^[0-9a-f]{64}$/i
const TILE_PROPS_INDEX_KEY = 'hc:tile-props-index'

const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const STORE_KEY = '@hypercomb.social/Store'
const CLIPBOARD_WORKER_KEY = '@diamondcoreprocessor.com/ClipboardWorker'

type HistoryLike = { sign?: (ctx: { explorerSegments: () => string[] }) => Promise<string> }
type StoreLike = { getResource?: (sig: string) => Promise<Blob | null> }

const ioc = (): { get?: (k: string) => unknown } | undefined =>
  (window as { ioc?: { get?: (k: string) => unknown } }).ioc

const lookupPropsSig = (locSig: string, label: string): string | undefined => {
  try {
    const idx = JSON.parse(localStorage.getItem(TILE_PROPS_INDEX_KEY) ?? '{}') as Record<string, string>
    const v = (locSig && idx[locSig]) ?? idx[label]
    return (typeof v === 'string' && SIG_RE.test(v)) ? v : undefined
  } catch { return undefined }
}

/** Canonical props sig from the tile's LAYER (via the worker's warm path),
 *  used only when the localStorage render-index has no entry. Best-effort. */
const canonicalPropsSig = async (segments: readonly string[]): Promise<string | undefined> => {
  const worker = ioc()?.get?.(CLIPBOARD_WORKER_KEY) as
    { propsSigAt?: (s: readonly string[]) => Promise<string | null> } | undefined
  if (!worker?.propsSigAt) return undefined
  try { return (await worker.propsSigAt(segments)) ?? undefined } catch { return undefined }
}

const sigAt = (props: Record<string, unknown>, slot: 'large' | 'small'): string | undefined => {
  const direct = (props as Record<string, { image?: unknown } | undefined>)[slot]
  if (direct && typeof direct === 'object' && typeof direct.image === 'string' && SIG_RE.test(direct.image)) return direct.image
  const flat = (props as { flat?: Record<string, { image?: unknown } | undefined> }).flat
  const fi = flat?.[slot]?.image
  return (typeof fi === 'string' && SIG_RE.test(fi)) ? fi : undefined
}

const imageSigOf = (props: Record<string, unknown>, prefer: 'large' | 'small'): string | undefined =>
  prefer === 'large'
    ? sigAt(props, 'large') ?? sigAt(props, 'small')
    : sigAt(props, 'small')

/** Entry → blob: URL, or null on any miss. The CALLER owns the URL — cache
 *  it, and revoke it when the entry leaves the screen. */
export const resolveEntryImageUrl = async (
  label: string,
  sourceSegments: readonly string[],
  prefer: 'large' | 'small',
): Promise<string | null> => {
  const history = ioc()?.get?.(HISTORY_KEY) as HistoryLike | undefined
  const store = ioc()?.get?.(STORE_KEY) as StoreLike | undefined
  if (!store?.getResource) return null

  let locSig = ''
  if (history?.sign) {
    try { locSig = await history.sign({ explorerSegments: () => [...sourceSegments, label] }) } catch { /* cold */ }
  }
  let propsSig = lookupPropsSig(locSig, label)
  if (!propsSig) {
    // Render-index miss — the tile was never rendered with this image (a cut
    // tile, or a freshly generated image). The canonical read keeps a
    // generated picture from being lost.
    propsSig = await canonicalPropsSig([...sourceSegments, label])
  }
  if (!propsSig) return null

  const propsBlob = await store.getResource(propsSig)
  if (!propsBlob) return null
  let props: Record<string, unknown>
  try { props = JSON.parse(await propsBlob.text()) } catch { return null }

  const imageSig = imageSigOf(props, prefer)
  if (!imageSig) return null
  const imgBlob = await store.getResource(imageSig)
  if (!imgBlob) return null
  return URL.createObjectURL(imgBlob)
}
