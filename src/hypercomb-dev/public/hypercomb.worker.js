// hypercomb-web/public/hypercomb.worker.js
// service worker
// - serves esm modules from /opfs/** without letting vite transform them
// - cache-first
// - opfs fallback (prod reads bytes from opfs)
// - dev served verbatim from /dev/** (NO rewrite)
// - correct content-type + head support

const CACHE_NAME = 'hypercomb-modules-v2'
// Module/layer requests all live under /opfs/. The dir token after it is
// either a POOL OF MEANING signature (sign('bees') / sign('dependencies'),
// derived below — never hardcoded) or a legacy `__x__` URL token kept
// servable for pages that froze an old import map. Either shape resolves
// pool-first with the legacy OPFS dir as a drain-window read fallback.
const OPFS_PREFIX = '/opfs/'
// Embedded-website resource lookups: /@resource/<sig> → flat OPFS root
// `<root>/<sig>` (legacy content dirs as read fallback). Any content-type
// — resolved from blob mime sniff / extension fallback.
const SITE_RESOURCE_PREFIX = '/@resource/'

// Pools of meaning: install-cache dirs at the OPFS root named by
// sign(<meaning>) — sha256 of the UTF-8 bytes of the meaning string.
// DERIVED at runtime so the SW computes the identical address Store does,
// with no registry and no hardcoded hex.
const BEES_MEANING = 'bees'
const DEPENDENCIES_MEANING = 'dependencies'
let poolSigsPromise = null
function poolSignatures() {
  return poolSigsPromise ??= (async () => ({
    bees: await sha256Hex(new TextEncoder().encode(BEES_MEANING)),
    dependencies: await sha256Hex(new TextEncoder().encode(DEPENDENCIES_MEANING)),
  }))()
}

// SHA-256 of zero bytes — the only signature whose valid content is empty.
// Any OTHER sig read as a 0-byte file is an interrupted write: treat it as
// a miss and keep falling back to wherever the complete bytes live
// (mirrors Store's incomplete-write guard).
const EMPTY_CONTENT_SIG = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

// Phase-2 resource streaming. The page posts host domains (self + community)
// via postMessage; on an OPFS miss for /@resource/<sig> the SW streams the
// bytes from a host and sha256-verifies them before serving. KNOWN_DOMAINS is
// the in-memory copy; it's also persisted inside CACHE_NAME (DOMAINS_CACHE_KEY
// — a Cache-API URL key, not an OPFS dir) so a restarted SW that serves before
// the page re-posts still has the list.
const SW_DOMAINS_MSG = 'hc:sw:domains'
const DOMAINS_CACHE_KEY = '/__hc_sw_domains__'
let KNOWN_DOMAINS = []

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
      ))
      .then(() => loadDomains())
      .then(domains => { if (domains.length) KNOWN_DOMAINS = domains })
      .then(() => self.clients.claim())
  )
})

// Page → SW host-domain hand-off (see hypercomb-shared/core/sw-domains.ts).
// Used by the /@resource/ OPFS-miss fallback to know which hosts to try.
self.addEventListener('message', (event) => {
  const data = event.data
  if (!data || data.type !== SW_DOMAINS_MSG) return
  const domains = Array.isArray(data.domains)
    ? data.domains.filter((d) => typeof d === 'string' && d)
    : []
  if (domains.length) {
    // MERGE with what we already know — posts arrive from two independent
    // senders (the boot re-post and the broker's learned-host pushes) and a
    // replace would let whichever fired last drop the other's hosts.
    KNOWN_DOMAINS = [...new Set([...domains, ...KNOWN_DOMAINS])]
    void persistDomains(KNOWN_DOMAINS)
  }
})

// Per-fetch logging is opt-in: every asset, sig HEAD, and resource read
// passes through here, and an active session generates hundreds of these
// — each retained by DevTools. Flip to true only when debugging the SW.
const SW_DEBUG = false

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (SW_DEBUG) console.log('[SW] fetch', event.request.method, url.pathname)

  if (url.origin !== self.location.origin) return

  const method = (event.request.method || 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') return

  if (url.pathname === '/house.png' || url.pathname === '/spw.png') {
    event.respondWith(fetchUncachedAsset(event.request))
    return
  }

  if (url.pathname === '/local.png') {
    event.respondWith(fetchWithFallback(event.request, '/house.png'))
    return
  }

  if (url.pathname === '/external.png') {
    event.respondWith(fetchWithFallback(event.request, '/spw.png'))
    return
  }

  // ----------------------------------------
  // prod: opfs resolution by signature
  // ----------------------------------------

  if (url.pathname.startsWith(OPFS_PREFIX)) {
    event.respondWith(handleOpfsRequest(event.request))
    return
  }

  if (url.pathname.startsWith(SITE_RESOURCE_PREFIX)) {
    event.respondWith(handleSiteResourceRequest(event.request))
    return
  }
})

/* ----------------------------------------
 * dev handler (NO rewrite)
 * ------------------------------------- */

async function handleDevRequest(request) {
  const fetched = await fetch(request, { cache: 'no-store' })
  if (!fetched || !fetched.ok) return fetched

  const fixed = withContentType(fetched, guessContentType(request.url))

  // dev: never cache
  return toHeadIfNeeded(request, fixed)
}

/* ----------------------------------------
 * prod module handlers
 * ------------------------------------- */

// Route an /opfs/<dirToken>/<sig>[.ext] request. The dir token is either a
// derived pool signature or a legacy `__x__` URL token (frozen URL shape —
// kept servable so a page holding an old frozen import map keeps working).
// Both shapes read the pool dir first, then the legacy OPFS dir while the
// Store's drain still has files mid-flight there.
async function handleOpfsRequest(request) {
  const url = new URL(request.url)
  const token = url.pathname.split('/')[2] || ''
  if (token === '__layers__') return handleLayerRequest(request)
  const pools = await poolSignatures()
  if (token === pools.bees || token === '__bees__') {
    return handleModuleRequest(request, [pools.bees, '__bees__'])
  }
  if (token === pools.dependencies || token === '__dependencies__') {
    return handleModuleRequest(request, [pools.dependencies, '__dependencies__'])
  }
  return new Response('unknown opfs path', { status: 404 })
}

async function handleModuleRequest(request, dirNames) {
  const url = new URL(request.url)
  const sig = readSignature(url.pathname)
  if (!sig) return new Response('invalid signature', { status: 400 })

  const cached = await tryCacheMatch(request)
  if (cached) return toHeadIfNeeded(request, cached)

  for (const dirName of dirNames) {
    const opfs = await tryReadFromOpfs(dirName, `${sig}.js`)
      || await tryReadFromOpfs(dirName, sig)
    if (opfs) {
      await cachePut(request, opfs)
      return toHeadIfNeeded(request, opfs)
    }
  }

  return new Response('module not found', { status: 404 })
}

async function handleLayerRequest(request) {
  const url = new URL(request.url)
  const sig = readSignature(url.pathname)
  if (!sig) return new Response('invalid signature', { status: 400 })

  const cached = await tryCacheMatch(request)
  if (cached) return toHeadIfNeeded(request, cached)

  // Flat OPFS root first (`<root>/<sig>` — the canonical content
  // address), then the legacy content roots, then the legacy
  // `__layers__` drain dir. Content-addressed, so any hit serves
  // identical bytes.
  const rootFile = await tryReadContentFile(sig)
  if (rootFile) {
    const headers = new Headers()
    headers.set('content-type', 'application/json; charset=utf-8')
    headers.set('cache-control', 'no-store')
    const response = new Response(rootFile, { status: 200, headers })
    await cachePut(request, response)
    return toHeadIfNeeded(request, response.clone())
  }

  const opfs = await tryReadFromOpfs('__layers__', `${sig}.json`)
    || await tryReadFromOpfs('__layers__', sig)
  if (opfs) {
    await cachePut(request, opfs)
    return toHeadIfNeeded(request, opfs)
  }

  return new Response('layer not found', { status: 404 })
}

/* ----------------------------------------
 * embedded-site resources: /@resource/<sig>
 * ------------------------------------- */

async function handleSiteResourceRequest(request) {
  const url = new URL(request.url)
  const rest = url.pathname.slice(SITE_RESOURCE_PREFIX.length)
  // Allow resource URLs like /@resource/<sig> or /@resource/<sig>/extra.png
  // Only the signature is meaningful — the tail is kept so sites can write
  // readable relative URLs, but we serve the same blob for any tail.
  const sig = rest.split('/')[0] ?? ''
  if (!/^[a-f0-9]{64}$/i.test(sig)) {
    return new Response('invalid signature', { status: 400 })
  }

  const cached = await tryCacheMatch(request)
  if (cached) return toHeadIfNeeded(request, cached)

  // Flat OPFS root first (`<root>/<sig>` — the canonical content address,
  // with the legacy content roots as drain-window fallbacks), then the
  // legacy `__resources__` drain dir, host stream last.
  const file = await tryReadContentFile(sig)
    || await tryReadLegacyDirFile('__resources__', sig)
  if (file) {
    const headers = new Headers()
    headers.set('content-type', guessResourceContentType(rest, file, request))
    headers.set('cache-control', 'public, max-age=31536000, immutable')
    const response = new Response(file, { status: 200, headers })

    // Cache immutable — signatures never change.
    await cachePut(request, response)
    return toHeadIfNeeded(request, response.clone())
  }

  // OPFS miss → stream from a host (Phase 2). The SW has no IoC, so it uses
  // the domains the page posted. Bytes are sha256-verified before serving,
  // then written through to OPFS (silently — the SW can't emit
  // content:wrote) so future reads (SW or Store) hit locally and offline.
  const fetched = await fetchResourceFromHosts(sig)
  if (!fetched) return new Response('resource not found', { status: 404 })
  void writeResourceToOpfs(sig, fetched.buf)
  const headers = new Headers()
  // The host stores resources by bare signature (no extension) and serves
  // them as application/octet-stream. Browsers enforce strict MIME checking
  // for <link rel="stylesheet"> (and images), so an octet-stream chrome.css
  // is REFUSED — a fresh adopter's page renders UNSTYLED until the resource
  // is warm in OPFS (where the OPFS branch's URL-tail guess sets text/css).
  // The URL tail (`/chrome.css`) is the authoritative type here, so prefer it
  // over the host's generic type; fall back to the host type only when the
  // tail/sniff/destination can't pin a specific one.
  const guessed = guessResourceContentType(rest, new Blob([fetched.buf]), request)
  headers.set('content-type', guessed !== 'application/octet-stream' ? guessed : (fetched.contentType || guessed))
  headers.set('cache-control', 'public, max-age=31536000, immutable')
  const response = new Response(fetched.buf, { status: 200, headers })
  await cachePut(request, response)
  return toHeadIfNeeded(request, response.clone())
}

function guessResourceContentType(tail, file, request) {
  // Prefer explicit extension in the URL tail; then WHAT THE PAGE IS ASKING
  // FOR (request.destination — a rewritten ref is usually a bare
  // /@resource/<sig> with no extension, but a <link rel="stylesheet"> still
  // says destination 'style', and browsers REFUSE non-text/css stylesheets);
  // then the Blob's sniffed type; last resort octet-stream.
  const ext = (tail.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()
  const map = {
    html: 'text/html; charset=utf-8',
    htm: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'application/javascript; charset=utf-8',
    mjs: 'application/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    woff: 'font/woff',
    woff2: 'font/woff2',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
    txt: 'text/plain; charset=utf-8',
    md: 'text/markdown; charset=utf-8',
  }
  if (ext && map[ext]) return map[ext]
  const destType = destinationContentType(request)
  if (destType) return destType
  if (file.type) return file.type
  return 'application/octet-stream'
}

// Content-type implied by the requesting context. Only destinations where the
// browser enforces (or strongly prefers) a specific type are mapped; images
// and media sniff fine from bytes, so they stay on the blob-type path.
function destinationContentType(request) {
  switch (request && request.destination) {
    case 'style': return 'text/css; charset=utf-8'
    case 'script':
    case 'worker':
    case 'sharedworker': return 'application/javascript; charset=utf-8'
    case 'font': return 'font/woff2'
    default: return ''
  }
}

/* ----------------------------------------
 * cache utilities
 * ------------------------------------- */

async function tryCacheMatch(request) {
  try {
    const cache = await caches.open(CACHE_NAME)

    // cache api only matches GET
    const key =
      request.method === 'HEAD'
        ? new Request(request.url, { method: 'GET' })
        : request

    return await cache.match(key, { ignoreSearch: true })
  } catch {
    return null
  }
}

async function cachePut(request, response) {
  try {
    // cache api only allows GET
    if (request.method !== 'GET') return
    const cache = await caches.open(CACHE_NAME)
    await cache.put(request, response.clone())
  } catch {}
}

/* ----------------------------------------
 * response helpers
 * ------------------------------------- */

function toHeadIfNeeded(request, response) {
  const method = (request.method || 'GET').toUpperCase()
  if (method !== 'HEAD') return response
  const headers = new Headers(response.headers)
  return new Response(null, { status: response.status, headers })
}

function withContentType(res, contentType) {
  const headers = new Headers(res.headers)
  if (!headers.get('content-type')) {
    headers.set('content-type', contentType)
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers
  })
}

function guessContentType(nameOrUrl) {
  return nameOrUrl.endsWith('.json')
    ? 'application/json; charset=utf-8'
    : 'application/javascript; charset=utf-8'
}

/* ----------------------------------------
 * signature utilities
 * ------------------------------------- */

function readSignature(pathname) {
  const last = pathname.split('/').pop() ?? ''
  const token =
    last.endsWith('.js') || last.endsWith('.json')
      ? last.slice(0, last.lastIndexOf('.'))
      : last

  return /^[a-f0-9]{64}$/i.test(token) ? token : null
}

async function fetchAlias(request, aliasPath) {
  const aliasUrl = new URL(aliasPath, self.location.origin).toString()
  const aliasRequest = new Request(aliasUrl, {
    method: (request.method || 'GET').toUpperCase() === 'HEAD' ? 'HEAD' : 'GET',
    headers: request.headers,
    mode: 'same-origin',
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'follow'
  })

  const response = await fetch(aliasRequest)
  return toHeadIfNeeded(request, response)
}

async function fetchWithFallback(request, fallbackPath) {
  const primary = await fetchUncachedAsset(request)
  if (primary && primary.ok) return primary
  return await fetchAlias(request, fallbackPath)
}

async function fetchUncachedAsset(request) {
  const method = (request.method || 'GET').toUpperCase()
  const url = new URL(request.url)

  const networkRequest = new Request(url.toString(), {
    method: method === 'HEAD' ? 'HEAD' : 'GET',
    headers: request.headers,
    mode: 'same-origin',
    credentials: 'same-origin',
    cache: 'reload',
    redirect: 'follow'
  })

  const response = await fetch(networkRequest)
  return toHeadIfNeeded(request, response)
}

/* ----------------------------------------
 * opfs helpers
 * ------------------------------------- */

async function tryReadFromOpfs(dirName, fileName) {
  try {
    const root = await self.navigator.storage.getDirectory()
    return await readFromDir(root, dirName, fileName)
  } catch {
    return null
  }
}

// Resolve a content sig to its File: the flat OPFS root (`<root>/<sig>`,
// the canonical address) first, then the legacy content roots
// (`__hive__/`, `hypercomb.io/`) while the Store's self-cleaning drain
// still holds bytes there. A 0-byte file under a non-empty sig is an
// incomplete write — skipped so the read lands on wherever the COMPLETE
// bytes live. Returns the File (caller sets content-type — layers are
// JSON, site resources sniff by tail) or null when absent everywhere.
async function tryReadContentFile(sig) {
  let root
  try {
    root = await self.navigator.storage.getDirectory()
  } catch {
    return null
  }
  try {
    const handle = await root.getFileHandle(sig)
    const file = await handle.getFile()
    if (file.size > 0 || sig === EMPTY_CONTENT_SIG) return file
  } catch { /* not at the root — fall back to the legacy sources */ }
  for (const dirName of ['__hive__', 'hypercomb.io']) {
    try {
      const dir = await root.getDirectoryHandle(dirName)
      const file = await (await dir.getFileHandle(sig)).getFile()
      if (file.size > 0 || sig === EMPTY_CONTENT_SIG) return file
    } catch { /* not in this drain source — keep falling back */ }
  }
  return null
}

// Bare-sig read from one legacy drain dir (e.g. `__resources__`). Read
// fallback only — the SW never creates or writes these dirs.
async function tryReadLegacyDirFile(dirName, sig) {
  try {
    const root = await self.navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(dirName)
    const file = await (await dir.getFileHandle(sig)).getFile()
    if (file.size > 0 || sig === EMPTY_CONTENT_SIG) return file
    return null
  } catch {
    return null
  }
}

async function readFromDir(rootDir, dirName, fileName) {
  try {
    const dir = await rootDir.getDirectoryHandle(dirName)
    const fileHandle = await dir.getFileHandle(fileName)
    const file = await fileHandle.getFile()
    return asJsResponse(file)
  } catch {
    return null
  }
}

function asJsResponse(file) {
  const headers = new Headers()
  headers.set('content-type', guessContentType(file.name))
  headers.set('cache-control', 'no-store')
  return new Response(file, { status: 200, headers })
}

/* ----------------------------------------
 * host streaming (Phase 2): /@resource/ OPFS-miss fallback
 * ------------------------------------- */

async function persistDomains(domains) {
  try {
    const cache = await caches.open(CACHE_NAME)
    await cache.put(DOMAINS_CACHE_KEY, new Response(JSON.stringify(domains), {
      headers: { 'content-type': 'application/json' }
    }))
  } catch { /* best-effort */ }
}

async function loadDomains() {
  try {
    const cache = await caches.open(CACHE_NAME)
    const res = await cache.match(DOMAINS_CACHE_KEY)
    if (res) { const arr = await res.json(); if (Array.isArray(arr)) return arr }
  } catch { /* ignore */ }
  return []
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  let hex = ''
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, '0')
  return hex
}

// Try each known host in order; the first response whose bytes sha256 to the
// requested sig wins. Loopback hosts use http (content-side analog of the
// mesh allow-loopback); real domains use https. Returns { buf, contentType }
// or null. Verification is the backstop — a wrong/hostile domain can only
// cost a 404, never serve incorrect bytes.
async function fetchResourceFromHosts(sig) {
  let domains = KNOWN_DOMAINS
  if (!domains || domains.length === 0) domains = await loadDomains()
  for (const raw of (domains || [])) {
    const host = String(raw || '').replace(/^https?:\/\//, '').replace(/\/+$/, '').trim()
    if (!host) continue
    const scheme = /^(localhost|127(?:\.\d+){3}|\[?::1\]?)(?::\d+)?$/i.test(host) ? 'http' : 'https'
    // Flat heap first (`/<sig>` — the canonical address; host-sync pushes
    // land there), legacy typed pool fallback for unmigrated hosts.
    for (const path of [`/${sig}`, `/__resources__/${sig}`]) {
      try {
        const res = await fetch(`${scheme}://${host}${path}`, { cache: 'no-store' })
        if (!res || !res.ok) continue
        // SPA fallback guard: sig-addressed bytes are never text/html.
        if ((res.headers.get('content-type') || '').toLowerCase().includes('text/html')) continue
        const buf = await res.arrayBuffer()
        if (await sha256Hex(buf) !== sig) continue
        return { buf, contentType: res.headers.get('content-type') || '' }
      } catch { /* network / CORS / cert — try next path / host */ }
    }
  }
  return null
}

// Write-through to OPFS. Skip if already present — re-writing an existing
// content-addressed file invalidates any Blob already handed out for that sig
// (NotReadableError), the hazard Store.putResource documents. The bytes land
// as a sig-named file at the FLAT OPFS ROOT — the canonical content address.
// No directory is created, ever: the legacy `__hive__`/`__resources__` dirs
// are drain sources the Store removes, and a create here would resurrect them.
async function writeResourceToOpfs(sig, buffer) {
  try {
    const root = await self.navigator.storage.getDirectory()
    try { await root.getFileHandle(sig); return } catch { /* not present — create */ }
    const handle = await root.getFileHandle(sig, { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(buffer) } finally { await writable.close() }
  } catch { /* best-effort cache fill */ }
}
