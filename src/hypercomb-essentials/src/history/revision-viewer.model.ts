// history/revision-viewer.model.ts
//
// The pure half of the revision viewer (revision-viewer.view.ts): no IoC,
// nothing registered. What one version of a website tile shows, how its
// versions group into runs of the same page, how a range is narrowed down to
// the one version where something changed, and the document a version runs in.
//
// PER TILE. A website tile's versions are its own lineage's markers
// (HistoryService.listLayers on the tile's location), never the hive-wide
// history: another tile's edits are never in the list.
//
// A VERSION RUNS AS THE SITE RUNS IT. The website view mounts a page inline in
// `#hc-site-view-host`, runs the page's head and body scripts inside that host,
// and marks the host with the entry it was opened at. A page that finds itself
// there reads its tile through `window.ioc` (Lineage, HistoryService, Store). A
// version runs the same way inside a sandboxed frame: its <body> is that host,
// carrying the same marks, the page's head scripts run inside it, and a small
// stand-in `ioc` answers those three services with the version's own layer and
// the bytes it names, read from the hive beforehand. So the page takes its
// ordinary hosted path, its own entrance included.
//
// NOTHING IN THE FRAME REACHES OUT. It is `allow-scripts` only (an opaque
// origin: no storage, no parent, no hive), and its document carries a policy
// that refuses every network request, so an old version that once named a
// third party never contacts it again (no-third-party-requests.md). Its
// pictures are the version's own bytes, inlined.

import { extractPageRefSigs, rewritePageRefs } from '../sharing/decoration-closure.js'

const SIG_RE = /^[0-9a-f]{64}$/

/** The decoration a website page rides on, as the website bee declares it. */
export const WEBSITE_PAGE_KIND = 'visual:website:page'

/** The slot a page written by the website builder sits in (commands/website-slot.ts). */
const WEBSITE_SLOT = 'website'

/** One version of a tile: its marker's position, its layer, and when it was written. */
export type Version = { readonly index: number; readonly layerSig: string; readonly at: number | null }

export type FrameLayer = { readonly name?: string; readonly [slot: string]: unknown }

const sigsIn = (slot: unknown): string[] =>
  Array.isArray(slot) ? slot.map(s => String(s ?? '').toLowerCase()).filter(s => SIG_RE.test(s)) : []

/** A page's first bytes, as the website view tests a legacy context entry. */
const HTML_HEAD_RE = /^\s*(?:\ufeff)?(<!doctype|<html|<svg|<\?xml)/i

/**
 * The page a version shows, in the website view's own order: the newest entry
 * of the website slot, then the website decoration's `htmlSig`, then the first
 * HTML-shaped entry of the legacy context slot. `readJson` reads one record by
 * signature (envelopes followed) or null; `readHead`, when given, reads the
 * first characters of a resource for the legacy test.
 */
export async function pageSigOf(
  layer: FrameLayer | null,
  readJson: (sig: string) => Promise<Record<string, unknown> | null>,
  readHead?: (sig: string) => Promise<string | null>,
  kind: string = WEBSITE_PAGE_KIND,
): Promise<string | null> {
  if (!layer) return null
  const built = sigsIn(layer[WEBSITE_SLOT])
  if (built.length) return built[built.length - 1]!
  for (const sig of sigsIn(layer['decorations'])) {
    const record = await readJson(sig).catch(() => null)
    if (record?.['kind'] !== kind) continue
    const html = String((record['payload'] as Record<string, unknown> | undefined)?.['htmlSig'] ?? '').toLowerCase()
    if (SIG_RE.test(html)) return html
  }
  if (readHead) {
    for (const sig of sigsIn(layer['context'])) {
      const head = await readHead(sig).catch(() => null)
      if (head && HTML_HEAD_RE.test(head)) return sig
    }
  }
  return null
}

/**
 * The signatures a record DECLARES it reads: its `refs` closure when it has
 * one, else the top-level payload fields named `…Sig` / `…Sigs`. Never a blind
 * harvest of every 64-hex string (a lineage address, a key or a group referent
 * is not bytes to carry, and asking hosts for it is the fetch storm the store
 * warns of).
 */
export function carriedSigsOf(record: unknown): string[] {
  if (!record || typeof record !== 'object') return []
  const r = record as Record<string, unknown>
  const out = new Set<string>()
  const take = (value: unknown): void => {
    const v = String(value ?? '').toLowerCase()
    if (SIG_RE.test(v)) out.add(v)
  }
  if (Array.isArray(r['refs']) && r['refs'].length) {
    for (const ref of r['refs']) take(ref)
    return [...out]
  }
  const payload = r['payload']
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      if (/Sigs?$/.test(key)) { if (Array.isArray(value)) value.forEach(take); else take(value) }
    }
  }
  return [...out]
}

/** A run of consecutive versions that show the same page. */
export type PageRun = { readonly page: string | null; readonly from: number; readonly to: number }

/** Group versions (oldest first, by position) into runs of the same page. */
export function runsOf(pages: readonly (string | null | undefined)[]): PageRun[] {
  const runs: PageRun[] = []
  pages.forEach((raw, index) => {
    const page = raw ?? null
    const last = runs[runs.length - 1]
    if (last && last.page === page && last.to === index - 1) runs[runs.length - 1] = { page, from: last.from, to: index }
    else runs.push({ page, from: index, to: index })
  })
  return runs
}

// ── narrowing down ───────────────────────────────────────────────────
//
// The owner looks at a version and says whether it looks right or wrong. Once
// one of each is known, the next version to look at is the middle of the gap
// between them, until the two sit side by side: the newer of the pair is where
// it changed. Either side may be the older one: something may have broken
// (right before, wrong after) or been fixed (wrong before, right after).

export type Narrowing = { readonly right: number | null; readonly wrong: number | null }

export const NARROWING_START: Narrowing = { right: null, wrong: null }

/** The narrowing after one more verdict on `index`. */
export function judge(state: Narrowing, index: number, right: boolean): Narrowing {
  return right ? { ...state, right: index } : { ...state, wrong: index }
}

/** The version to look at next, or null while one side is unknown or the search is done. */
export function nextToLook(state: Narrowing): number | null {
  const { right, wrong } = state
  if (right === null || wrong === null) return null
  const lo = Math.min(right, wrong), hi = Math.max(right, wrong)
  if (hi - lo <= 1) return null
  return lo + Math.floor((hi - lo) / 2)
}

/** The version where it changed (the newer of an adjacent right/wrong pair), or null. */
export function changedAt(state: Narrowing): number | null {
  const { right, wrong } = state
  if (right === null || wrong === null) return null
  return Math.abs(right - wrong) === 1 ? Math.max(right, wrong) : null
}

/** How many versions are still between the two marks (0 once found). */
export function leftBetween(state: Narrowing): number | null {
  const { right, wrong } = state
  if (right === null || wrong === null) return null
  return Math.max(0, Math.abs(right - wrong) - 1)
}

// ── the frame a version runs in ──────────────────────────────────────

/** What a version's frame is handed: where the tile is, its layer, and every byte the page may read. */
export type FrameData = {
  readonly segments: readonly string[]
  readonly layer: FrameLayer
  /** signature -> base64 bytes; an envelope signature maps to the bytes it names */
  readonly resources: Readonly<Record<string, string>>
}

/** How the page is hosted: its own signature, and the pictures it embeds, inlined. */
export type FrameHosting = {
  readonly pageSig: string
  /** signature -> data: URL for each picture the page embeds by signature */
  readonly pictures?: Readonly<Record<string, string>>
}

/** JSON made safe to sit inside a <script> element: nothing in it can end the element. */
export const scriptSafeJson = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

/** Refuses every network request: the page runs on its own inline code, inlined pictures and the bytes handed in. */
export const FRAME_POLICY = [
  "default-src 'none'", "script-src 'unsafe-inline' 'unsafe-eval' blob:", "style-src 'unsafe-inline'",
  'img-src data: blob:', 'font-src data:', 'media-src data: blob:', 'worker-src blob:',
  "connect-src 'none'", "frame-src 'none'", "form-action 'none'", "base-uri 'none'",
].join('; ')

// Runs first in the frame, before any of the page's own scripts. Storage: an
// opaque origin throws on localStorage, so both storages are page memory (the
// visitor shell's shim, with nothing kept). ioc: the three services a hosted
// page reads, answering with this version only. Keys: a frame's keys never
// reach the viewer, so Escape and Alt+Left/Right are handed up to it.
const STAND_IN = `(function () {
  var data = JSON.parse(document.getElementById('hc-revision-data').textContent);
  function memory() {
    var m = new Map();
    return {
      get length() { return m.size; },
      key: function (i) { var k = Array.from(m.keys()); return i < k.length ? k[i] : null; },
      getItem: function (k) { k = String(k); return m.has(k) ? m.get(k) : null; },
      setItem: function (k, v) { m.set(String(k), String(v)); },
      removeItem: function (k) { m.delete(String(k)); },
      clear: function () { m.clear(); },
      keeps: function () { return false; }
    };
  }
  try { Object.defineProperty(window, 'localStorage', { configurable: true, value: memory() }); } catch (e) {}
  try { Object.defineProperty(window, 'sessionStorage', { configurable: true, value: memory() }); } catch (e) {}
  function bytes(sig) {
    var b64 = data.resources[String(sig || '').toLowerCase()];
    if (typeof b64 !== 'string') return null;
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return new Blob([out]);
  }
  var lineage = new EventTarget();
  lineage.explorerSegments = function () { return data.segments.slice(); };
  var services = {
    '@hypercomb.social/Lineage': lineage,
    '@diamondcoreprocessor.com/HistoryService': {
      sign: function () { return Promise.resolve('revision'); },
      currentLayerAt: function () { return Promise.resolve(data.layer); }
    },
    '@hypercomb.social/Store': {
      getResource: function (sig) { return Promise.resolve(bytes(sig)); },
      getResourceLocal: function (sig) { return Promise.resolve(bytes(sig)); }
    }
  };
  window.ioc = {
    get: function (key) { return services[key]; },
    has: function (key) { return key in services; },
    list: function () { return Object.keys(services); },
    register: function () {},
    whenReady: function (key, cb) { if (services[key]) cb(services[key]); }
  };
  addEventListener('keydown', function (e) {
    var hand = e.key === 'Escape' || (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'));
    if (!hand) return;
    try { parent.postMessage({ hcRevisionKey: e.key }, '*'); } catch (err) {}
  }, true);
})();`

/** In-page pictures named by signature, rewritten to the inlined bytes (or left as they were). */
function inlinePictures(html: string, pictures: Readonly<Record<string, string>> | undefined): string {
  const marker = 'hc-revision-picture:'
  return rewritePageRefs(html, marker).replace(new RegExp(`${marker}([0-9a-f]{64})`, 'g'), (whole, sig: string) => pictures?.[sig] ?? whole)
}

/**
 * The document one version runs in, for a sandboxed frame's `srcdoc`: the
 * network policy, the version's data and the stand-in first in <head>; the
 * page's <body> as the website view's host with its marks; the page's head
 * scripts moved to the start of the host, where the website view runs them.
 */
export function frameDocument(pageHtml: string, data: FrameData, hosting: FrameHosting): string {
  const html = inlinePictures(String(pageHtml), hosting.pictures)
  const entry = '/' + data.segments.join('/')
  const head = `<meta http-equiv="Content-Security-Policy" content="${FRAME_POLICY}"><meta name="referrer" content="no-referrer">`
    + `<script type="application/json" id="hc-revision-data">${scriptSafeJson(data)}</script><script>${STAND_IN}</script>`

  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const body = doc.body
    body.id = 'hc-site-view-host'
    body.setAttribute('data-hc-site-entry', entry)
    body.setAttribute('data-hc-cell-page', hosting.pageSig)
    const scripts = [...doc.head.querySelectorAll('script')]
    for (let i = scripts.length - 1; i >= 0; i--) body.insertBefore(scripts[i]!, body.firstChild)
    const shell = doc.createElement('template')
    shell.innerHTML = head
    doc.head.insertBefore(shell.content, doc.head.firstChild)
    return '<!doctype html>' + doc.documentElement.outerHTML
  }

  // No DOM to parse with (a worker, a build): the same marks by text.
  const marks = `id="hc-site-view-host" data-hc-site-entry="${entry.replace(/"/g, '&quot;')}" data-hc-cell-page="${hosting.pageSig}"`
  let out = /<body\b[^>]*>/i.test(html)
    ? html.replace(/<body\b([^>]*)>/i, (_whole, attrs: string) => `<body ${marks}${attrs.replace(/\bid\s*=\s*("[^"]*"|'[^']*'|\S+)/i, '')}>`)
    : `<body ${marks}>${html}</body>`
  out = /<head\b[^>]*>/i.test(out)
    ? out.replace(/<head\b[^>]*>/i, opened => opened + head)
    : out.replace(/<body\b/i, `<head>${head}</head><body`)
  return /^\s*<!doctype/i.test(out) ? out : `<!doctype html>${out}`
}

// ── one version, read and framed ─────────────────────────────────────
//
// Shared by the revision viewer (any version) and a managed site door's card
// (the published head): read a layer's page and records through `read`, and
// build the document it runs in. One builder, so the card on a site door and a
// version in the viewer can never run differently.

/** One file travels into a frame only up to this size, and one version's bytes only up to the total. */
export const FRAME_MAX_ONE = 4 * 1024 * 1024
export const FRAME_MAX_TOTAL = 16 * 1024 * 1024
/** At most this many named signatures are read for one version's records (and as many pictures). */
export const FRAME_MAX_CARRIED = 64

/** How a version's bytes are read: `localOnly` asks only this device, never a host. */
export type FrameReader = {
  bytes(sig: string, localOnly?: boolean): Promise<Uint8Array | null>
  /** The last read of this signature (any source) found nothing: it may simply not be here yet. */
  missing(sig: string): boolean
}

export type VersionFrame = {
  readonly page: string | null
  readonly doc: string | null
  /** cold: something it needs is not here yet (worth a retry); no-page: the version shows no page */
  readonly problem: 'cold' | 'no-page' | null
  /** The page is known for sure (no record it needed was missing). */
  readonly settled: boolean
}

const jsonOf = (bytes: Uint8Array | null): Record<string, unknown> | null => {
  if (!bytes) return null
  try { return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown> } catch { return null }
}

/** The page a layer shows, and whether a record it needed was missing. */
export async function pageOfLayer(layer: FrameLayer, read: FrameReader): Promise<{ page: string | null; missed: boolean }> {
  let missed = false
  const readJson = async (sig: string): Promise<Record<string, unknown> | null> => {
    const record = jsonOf(await read.bytes(sig))
    if (!record && read.missing(sig)) missed = true
    return record
  }
  const readHead = async (sig: string): Promise<string | null> => {
    const bytes = await read.bytes(sig, true)
    return bytes ? new TextDecoder().decode(bytes.subarray(0, 512)) : null
  }
  const page = await pageSigOf(layer, readJson, readHead).catch(() => null)
  return { page, missed: !page && missed }
}

/** Everything one version's frame needs, read through `read`, and the document it runs in. */
export async function versionFrame(layer: FrameLayer, segments: readonly string[], read: FrameReader): Promise<VersionFrame> {
  const { page, missed } = await pageOfLayer(layer, read)
  if (!page) return { page: null, doc: null, problem: missed ? 'cold' : 'no-page', settled: !missed }
  const html = await read.bytes(page)
  if (!html) return { page, doc: null, problem: 'cold', settled: true }
  const text = new TextDecoder().decode(html)

  // The bytes the page may read through its tile: every decoration record
  // (under the signature in the slot, envelope or bare) and what each declares.
  const resources: Record<string, string> = {}
  let total = 0, carried = 0
  const carry = async (sig: string, localOnly: boolean): Promise<void> => {
    if (sig === page || sig in resources || carried >= FRAME_MAX_CARRIED) return
    carried++
    const bytes = await read.bytes(sig, localOnly)
    if (!bytes || bytes.length > FRAME_MAX_ONE || total + bytes.length > FRAME_MAX_TOTAL) return
    total += bytes.length
    resources[sig] = toBase64(bytes)
  }
  for (const sig of sigsIn(layer['decorations'])) {
    await carry(sig, false)
    const record = jsonOf(await read.bytes(sig))
    // A group mark names a referent with no bytes behind it.
    if (!record || record['kind'] === 'group') continue
    for (const named of carriedSigsOf(record)) await carry(named, true)
  }
  // The pictures the page embeds by signature, inlined (the frame reaches no network).
  const pictures: Record<string, string> = {}
  for (const sig of pictureSigsOf(text).slice(0, FRAME_MAX_CARRIED)) {
    const bytes = await read.bytes(sig, true)
    if (bytes && bytes.length <= FRAME_MAX_ONE && total + bytes.length <= FRAME_MAX_TOTAL) { total += bytes.length; pictures[sig] = pictureUrl(bytes) }
  }
  const doc = frameDocument(text, { segments, layer, resources }, { pageSig: page, pictures })
  return { page, doc, problem: null, settled: true }
}

/** The signatures of the pictures a page embeds, as the website view resolves them. */
export const pictureSigsOf = (pageHtml: string): string[] => extractPageRefSigs(pageHtml)

/** A data: URL for a picture, its type read from its first bytes. */
export function pictureUrl(bytes: Uint8Array): string {
  const b = bytes
  const type = b[0] === 0x89 && b[1] === 0x50 ? 'image/png'
    : b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg'
    : b[0] === 0x47 && b[1] === 0x49 ? 'image/gif'
    : b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 ? 'image/webp'
    : /<svg[\s>]/i.test(new TextDecoder().decode(b.subarray(0, 512))) ? 'image/svg+xml'
    : 'application/octet-stream'
  return `data:${type};base64,${toBase64(b)}`
}

/** Bytes as base64, in chunks so a large picture does not overflow the call stack. */
export function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
