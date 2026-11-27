// presentation/tiles/page-run-gate.ts
//
// MAY THIS PAGE RUN HERE? One answer for every surface that mounts a page the
// participant may not have authored — the site view and the post-it view —
// so neither can forget to ask. It is T5's activation gate: a FOREIGN page
// (published by a domain that is not yours, or sitting under an adopted root)
// runs only once it is verified — reviewed-and-accepted, bypassed, or from a
// trusted domain (sharing/feature-availability.ts). Your own authoring is
// never gated.
//
// A page that may not run is never blank and never executes: the surface
// shows it INERT — its text, with nothing that runs (scripts, styles, frames)
// taken out — until the participant reviews it. The post-it view did not ask
// at all before 2026-11-04 and re-created every <script> a foreign post-it
// carried; the site view asked with its own copy of this question.

import { featureNeedsReview, runsSealed } from '../../sharing/feature-availability.js'
import { trialOf } from '../../files/try-page.js'
import { FRAME_MAX_ONE, FRAME_POLICY, pageFrame, type FrameLayer, type FrameReader, type PageFrameOptions } from '../../history/revision-viewer.model.js'

const BROKER_KEY = '@diamondcoreprocessor.com/ContentBrokerDrone'

/** The domain that published the page at `sig`, as the broker learned it from
 *  the mesh or a host; '' when nothing is attributed. */
export const pagePublisherDomain = (sig: string): string => {
  try {
    const broker = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
      ?.get<{ getKnownDomains?: (s: string) => string[] }>(BROKER_KEY)
    return broker?.getKnownDomains?.(sig)?.[0] ?? ''
  } catch { return '' }
}

/** May the page at `sig`, mounted at `segments`, execute — its scripts run,
 *  its resources stream? False means: show it inert and offer the review. */
export const mayRunPage = (segments: readonly string[], sig: string, publisher: string = pagePublisherDomain(sig)): boolean =>
  !featureNeedsReview(segments, sig, publisher)

/** Does a page that may run, run SEALED — in a frame of its own origin, with
 *  nothing of this hive in reach — because it is someone else's? The second
 *  question every page surface asks, after `mayRunPage` (feature-availability.ts
 *  runsSealed). A review lets a page run; it never lets it run as you.
 *
 *  A TRIAL is sealed too, wherever it is asked (2026-11-27): a page a model
 *  wrote runs in this hive only after a person brings it home (try-page.ts).
 *  The site view shows a trial's own door before it asks this; every other
 *  surface (the room view, a part seated in a page, a post-it) asked only this,
 *  and ran the trial as the hive. Trials written before then were marked
 *  authored, so the trial is asked here and not left to authorship. */
export const pageRunsSealed = (segments: readonly string[], sig: string, publisher: string = pagePublisherDomain(sig)): boolean =>
  trialOf(sig) !== null || runsSealed(segments, sig, publisher)

const BLOCKS = 'p,div,section,article,header,footer,main,aside,nav,h1,h2,h3,h4,h5,h6,li,tr,pre,blockquote,figure,figcaption,details,summary,dt,dd,br,hr'

/** The page with nothing in it that runs: its visible text, one line per
 *  block, scripts, styles, frames and templates gone. Never empty — a page
 *  that is only code says so, instead of showing nothing. */
export const inertPageText = (html: string): string => {
  const doc = new DOMParser().parseFromString(String(html ?? ''), 'text/html')
  doc.querySelectorAll('script,style,noscript,template,iframe,object,embed,link').forEach(n => n.remove())
  doc.body?.querySelectorAll(BLOCKS).forEach(n => n.after(doc.createTextNode('\n')))
  const text = (doc.body?.textContent ?? '')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text || '(this page has no text of its own)'
}

type PageStore = { getResource: (sig: string) => Promise<Blob | null> }

/** The tile's current layer, as a page reads it through its tile. */
const layerAt = async (segments: readonly string[]): Promise<FrameLayer | null> => {
  const history = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc?.get<{
    sign: (lineage: { explorerSegments?: () => readonly string[] }) => Promise<string>
    currentLayerAt: (locationSig: string) => Promise<FrameLayer | null>
  }>('@diamondcoreprocessor.com/HistoryService')
  if (!history) return null
  try { return await history.currentLayerAt(await history.sign({ explorerSegments: () => segments })) } catch { return null }
}

/** Someone else's page, ready for a sealed frame: `srcdoc` is the WRAPPER the
 *  frame shows, the page itself one frame deeper; `missed` says some byte it
 *  wanted was not here yet, so the frame is worth building again later. */
export type SealedPage = {
  readonly srcdoc: string
  /** Some byte it names is not here yet (a byte too large to carry is not "missing"). */
  readonly missed: boolean
  /** Those bytes: the frame is worth building again only once one of them arrives. */
  readonly absent: readonly string[]
  /** The tile and layer it was built from: another tile wearing the same page is another frame. */
  readonly builtFrom: string
}

/** The document someone else's page runs in — the frame a version runs in
 *  (revision-viewer.model.ts pageFrame), every byte it may show read here
 *  beforehand, since the frame reaches no network and no service worker — set
 *  one frame deeper inside a wrapper whose policy refuses every navigation of
 *  it (`frame-src 'none'`). A page's own policy cannot stop the page moving
 *  itself to a URL; its embedder's can. So the page cannot navigate away with
 *  what it holds. (A browser that ignores `webrtc 'block'` still lets a page
 *  open a peer connection, which can signal that it was opened; it holds only
 *  its own tile's words and bytes, never the hive.) Its messages reach the
 *  viewer two frames up (`depth: 2`). Null when it cannot be built. */
export async function sealedPageDocument(
  segments: readonly string[],
  pageSig: string,
  html: string,
  store: PageStore,
  options: Omit<PageFrameOptions, 'depth'> = {},
): Promise<SealedPage | null> {
  const bytes = new Map<string, Uint8Array | null>()
  const absent = new Set<string>()
  const reader: FrameReader = {
    bytes: async (sig) => {
      if (bytes.has(sig)) return bytes.get(sig) ?? null
      const found = await store.getResource(sig).catch(() => null)
      if (!found) absent.add(sig)
      const read = found && found.size <= FRAME_MAX_ONE ? new Uint8Array(await found.arrayBuffer()) : null
      bytes.set(sig, read)
      return read
    },
    missing: (sig) => bytes.has(sig) && !bytes.get(sig),
  }
  const layer = await layerAt(segments)
  const doc = await pageFrame(html, pageSig, layer ?? {}, segments, reader, { ...options, depth: 2 }).catch(() => null)
  if (!doc) return null
  return { srcdoc: sealedWrapper(doc), missed: absent.size > 0, absent: [...absent], builtFrom: sealedBuiltFrom(segments, layer) }
}

/** What a sealed frame was built from: its tile and that tile's layer. */
export const sealedBuiltFrom = (segments: readonly string[], layer: FrameLayer | null): string =>
  JSON.stringify([segments, layer ?? {}])

/** The tile's layer now, to compare with what a sealed frame was built from. */
export const sealedSourceAt = async (segments: readonly string[]): Promise<string> => sealedBuiltFrom(segments, await layerAt(segments))

/** The sandbox someone else's page runs under, wrapper and page alike: scripts
 *  only — an opaque origin with no storage, no parent, no hive and no key.
 *  Never `allow-same-origin`. */
export const SEALED_PAGE_SANDBOX = 'allow-scripts'

/** The wrapper's own policy: the page frame's own (no network; the page's
 *  `about:srcdoc` needs no fetch), and its one frame may never be navigated
 *  anywhere. A srcdoc document inherits its embedder's policy, so the page runs
 *  under both — the same rules twice, never fewer. */
export const SEALED_WRAPPER_POLICY = `${FRAME_POLICY}; child-src 'none'`

const attr = (text: string): string => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

/** The wrapper document around a page's frame document. */
export const sealedWrapper = (doc: string): string =>
  '<!doctype html><html><head>'
  + `<meta http-equiv="Content-Security-Policy" content="${SEALED_WRAPPER_POLICY}"><meta name="referrer" content="no-referrer">`
  + '<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}iframe{display:block;border:0;width:100%;height:100%;background:transparent}</style>'
  + `</head><body><iframe sandbox="${SEALED_PAGE_SANDBOX}" referrerpolicy="no-referrer" srcdoc="${attr(doc)}"></iframe></body></html>`

/** The page's own window inside a sealed frame: what its messages come from. */
export const sealedPageWindow = (frame: HTMLIFrameElement): Window | null => {
  try { return frame.contentWindow?.frames?.[0] ?? null } catch { return null }
}
