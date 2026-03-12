// hypercomb-web/public/hypercomb.worker.js
// service worker
// - serves esm modules from /opfs/** without letting vite transform them
// - cache-first
// - opfs fallback (prod reads bytes from opfs)
// - dev served verbatim from /dev/** (NO rewrite)
// - correct content-type + head support

const CACHE_NAME = 'hypercomb-modules-v2'
const DEP_PREFIX = '/opfs/__dependencies__/'
const RES_PREFIX = '/opfs/__bees__/'
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

  if (url.pathname.startsWith(RES_PREFIX)) {
    event.respondWith(handleModuleRequest(event.request, '__bees__'))
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
