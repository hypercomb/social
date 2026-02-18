// hypercomb-web/public/hypercomb.worker.js
// service worker
// - serves esm modules from /opfs/** without letting vite transform them
// - cache-first
// - opfs fallback (prod reads bytes from opfs)
// - dev served verbatim from /dev/** (NO rewrite)
// - correct content-type + head support

const CACHE_NAME = 'hypercomb-modules-v2'
const DEP_PREFIX = '/opfs/__dependencies__/'
const RES_PREFIX = '/opfs/__drones__/'
const LAYER_PREFIX = '/opfs/__layers__/'

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  console.log('[SW] fetch', event.request.method, url.pathname)

  if (url.origin !== self.location.origin) return

  const method = (event.request.method || 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') return

  // ----------------------------------------
  // prod: opfs resolution by signature
  // ----------------------------------------

  if (url.pathname.startsWith(RES_PREFIX)) {
    event.respondWith(handleModuleRequest(event.request, '__drones__'))
    return
  }

  if (url.pathname.startsWith(DEP_PREFIX)) {
    event.respondWith(handleModuleRequest(event.request, '__dependencies__'))
    return
  }

  if (url.pathname.startsWith(LAYER_PREFIX)) {
    event.respondWith(handleLayerRequest(event.request))
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

async function handleModuleRequest(request, dirName) {
  const url = new URL(request.url)
  const sig = readSignature(url.pathname)
  if (!sig) return new Response('invalid signature', { status: 400 })

  const cached = await tryCacheMatch(request)
  if (cached) return toHeadIfNeeded(request, cached)

  const opfs = await tryReadFromOpfs(dirName, `${sig}.js`)
  if (opfs) {
    await cachePut(request, opfs)
    return toHeadIfNeeded(request, opfs)
  }

  return new Response('module not found', { status: 404 })
}

async function handleLayerRequest(request) {
  const url = new URL(request.url)
  const sig = readSignature(url.pathname)
  if (!sig) return new Response('invalid signature', { status: 400 })

  const cached = await tryCacheMatch(request)
  if (cached) return toHeadIfNeeded(request, cached)

  const opfs = await tryReadFromOpfs('__layers__', `${sig}.json`)
  if (opfs) {
    await cachePut(request, opfs)
    return toHeadIfNeeded(request, opfs)
  }

  return new Response('layer not found', { status: 404 })
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

    return await cache.match(key, { ignoreSearch: false })
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

/* ----------------------------------------
 * opfs helpers
 * ------------------------------------- */

async function tryReadFromOpfs(dirName, fileName) {
  try {
    const root = await self.navigator.storage.getDirectory()

    // root-scoped: opfs/__drones__/sig.js
    const direct = await readFromDir(root, dirName, fileName)
    if (direct) return direct

    // domain-scoped: opfs/<domain>/__drones__/sig.js
    for await (const [name, entry] of root.entries()) {
      if (!isDomainName(name)) continue
      const nested = await readFromNested(entry, dirName, fileName)
      if (nested) return nested
    }

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
    return asJsResponse(file, false)
  } catch {
    return null
  }
}

async function readFromNested(domainDir, dirName, fileName) {
  try {
    const dir = await domainDir.getDirectoryHandle(dirName)
    const fileHandle = await dir.getFileHandle(fileName)
    const file = await fileHandle.getFile()
    return asJsResponse(file, true)
  } catch {
    return null
  }
}

function asJsResponse(file, immutable) {
  const headers = new Headers()
  headers.set('content-type', guessContentType(file.name))
  headers.set(
    'cache-control',
    immutable ? 'public, max-age=31536000, immutable' : 'no-store'
  )
  return new Response(file, { status: 200, headers })
}

/* ----------------------------------------
 * domain filtering
 * ------------------------------------- */

function isDomainName(name) {
  const raw = (name ?? '').trim()
  if (!raw || raw.startsWith('__')) return false
  if (raw === '__drones__') return false
  if (raw === '__dependencies__') return false
  if (raw === 'hypercomb') return false
  return /^[a-z0-9.-]+$/i.test(raw) && raw.includes('.')
}
