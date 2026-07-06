// meadowverse/public/meadowverse.worker.js
// service worker
// - serves esm modules from /opfs/** without letting the bundler transform them
// - cache-first
// - opfs fallback (prod reads bytes from opfs)
// - correct content-type + head support
//
// Storage model: bees/dependencies live in sign(meaning) POOLS (dirs at the
// OPFS root named by sha256 of 'bees' / 'dependencies'); layers are bare
// sig-named files at the flat OPFS root. The legacy `__bees__` /
// `__dependencies__` / `__layers__` dirs are read-fallback drain sources
// only. Every route below resolves NEW location first, then legacy, and
// accepts both URL shapes (`/opfs/<poolSig>/…` and `/opfs/__x__/…`) so the
// import map keeps working throughout the drain window.

const CACHE_NAME = 'meadowverse-modules-v1'
const OPFS_PREFIX = '/opfs/'
const LEGACY_DEP_DIR = '__dependencies__'
const LEGACY_BEE_DIR = '__bees__'
const LEGACY_LAYER_DIR = '__layers__'
const SIG_RE = /^[a-f0-9]{64}$/i

// sign(meaning) pool addresses, derived (sha256 of the UTF-8 meaning bytes)
// — same convention as Store.poolSignature; no registry, any tier computes
// the identical address.
let poolSigsPromise = null
function poolSigs() {
  return (poolSigsPromise ??= (async () => {
    const sign = async (meaning) => {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(meaning))
      return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
    }
    return { bees: await sign('bees'), dependencies: await sign('dependencies') }
  })())
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  if (url.origin !== self.location.origin) return

  const method = (event.request.method || 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') return

  if (!url.pathname.startsWith(OPFS_PREFIX)) return

  event.respondWith(handleOpfsRequest(event.request))
})

/* ----------------------------------------
 * /opfs/<dirToken>/<name> resolution
 * ------------------------------------- */

async function handleOpfsRequest(request) {
  const url = new URL(request.url)
  const segments = url.pathname.slice(OPFS_PREFIX.length).split('/').filter(Boolean)
  const dirToken = segments[0] ?? ''
  const sig = readSignature(url.pathname)
  if (!sig) return new Response('invalid signature', { status: 400 })

  const cached = await tryCacheMatch(request)
  if (cached) return toHeadIfNeeded(request, cached)

  const pools = await poolSigs()

  // source dirs, NEW location first then legacy; `null` = the flat OPFS root
  let dirs
  let fallbackType = 'application/javascript; charset=utf-8'
  if (dirToken === LEGACY_DEP_DIR || dirToken === pools.dependencies) {
    dirs = [pools.dependencies, LEGACY_DEP_DIR]
  } else if (dirToken === LEGACY_BEE_DIR || dirToken === pools.bees) {
    dirs = [pools.bees, LEGACY_BEE_DIR]
  } else if (dirToken === LEGACY_LAYER_DIR) {
    dirs = [null, LEGACY_LAYER_DIR]
    fallbackType = 'application/json; charset=utf-8'
  } else if (SIG_RE.test(dirToken)) {
    // some other sig-named dir (a future pool) — serve it as addressed
    dirs = [dirToken]
  } else {
    return new Response('module not found', { status: 404 })
  }

  // name shapes vary across eras: bare `<sig>` (pools / flat root) and
  // `<sig>.js` / `<sig>.json` (legacy installs) — probe all of them.
  const names = [...new Set([segments[segments.length - 1], sig, `${sig}.js`, `${sig}.json`])]

  for (const dirName of dirs) {
    const response = await tryReadFromOpfs(dirName, names, fallbackType)
    if (response) {
      await cachePut(request, response)
      return toHeadIfNeeded(request, response)
    }
  }

  return new Response('module not found', { status: 404 })
}

/* ----------------------------------------
 * cache utilities
 * ------------------------------------- */

async function tryCacheMatch(request) {
  try {
    const cache = await caches.open(CACHE_NAME)
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

function contentTypeFor(fileName, fallbackType) {
  if (fileName.endsWith('.json')) return 'application/json; charset=utf-8'
  if (fileName.endsWith('.js')) return 'application/javascript; charset=utf-8'
  return fallbackType // bare sig — type comes from the route that asked
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

  return SIG_RE.test(token) ? token : null
}

/* ----------------------------------------
 * opfs helpers
 * ------------------------------------- */

// dirName === null reads the flat OPFS root (layers live there now).
// Directories are opened WITHOUT create — an absent pool or an already
// drained legacy dir is simply a miss.
async function tryReadFromOpfs(dirName, fileNames, fallbackType) {
  try {
    const root = await self.navigator.storage.getDirectory()
    const dir = dirName === null ? root : await root.getDirectoryHandle(dirName)
    for (const fileName of fileNames) {
      try {
        const fileHandle = await dir.getFileHandle(fileName)
        const file = await fileHandle.getFile()
        const headers = new Headers()
        headers.set('content-type', contentTypeFor(fileName, fallbackType))
        headers.set('cache-control', 'no-store')
        return new Response(file, { status: 200, headers })
      } catch {
        // next name shape
      }
    }
    return null
  } catch {
    return null
  }
}
