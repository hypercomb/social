// meadowverse/public/meadowverse.worker.js
// service worker
// - serves esm modules from /opfs/** without letting the bundler transform them
// - cache-first
// - opfs fallback (prod reads bytes from opfs)
// - correct content-type + head support

const CACHE_NAME = 'meadowverse-modules-v1'
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

  if (url.origin !== self.location.origin) return

  const method = (event.request.method || 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') return

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

  // Layers live in domain folders at opfsRoot (no __layers__ intermediary).
  // Search all non-reserved directories for the layer file.
  const opfs = await tryReadLayerFromDomainDirs(sig)
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

async function tryReadLayerFromDomainDirs(sig) {
  try {
    const root = await self.navigator.storage.getDirectory()
    for await (const [name, handle] of root.entries()) {
      if (handle.kind !== 'directory') continue
      if (name.startsWith('__')) continue
      try {
        const fileHandle = await handle.getFileHandle(sig)
        return asJsResponse(await fileHandle.getFile())
      } catch { /* not in this domain dir */ }
    }
  } catch { /* opfs unavailable */ }
  return null
}

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
