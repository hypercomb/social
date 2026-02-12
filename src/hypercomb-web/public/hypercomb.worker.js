// hypercomb-web/public/hypercomb.worker.js
// service worker
// - serves esm modules from /opfs/** without letting vite transform them
// - cache-first (dev seeds cache with bytes)
// - opfs fallback (prod reads bytes from opfs)

const CACHE_NAME = 'hypercomb-modules-v1'

const DEP_PREFIX = '/opfs/__dependencies__/'
const RES_PREFIX = '/opfs/__drones__/'

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', async (event) => {
  const url = new URL(event.request.url)
  console.log('[SW] fetch', url.pathname)

  if (url.origin !== self.location.origin) return

  const method = (event.request.method || 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') return

  // if(url.pathname.includes('/dev/')) {
  //   console.log('[SW] ignoring /dev/ request')
  //  //  event.respondWith(handleModuleRequest(event.request, '__dependencies__'))
  //   return
  // }

  if (url.pathname.startsWith(RES_PREFIX)) {
    event.respondWith(handleModuleRequest(event.request, '__drones__'))
    return
  }
})

async function handleModuleRequest(request, dirName) {
  const url = new URL(request.url)
  const sig = readSignature(url.pathname)
  if (!sig) return new Response('invalid signature', { status: 400 })

  const cached = await tryCacheMatch(request)
  if (cached) return toHeadIfNeeded(request, cached)

  const opfs = await tryReadFromOpfs(dirName, sig)
  if (opfs) return toHeadIfNeeded(request, opfs)

  return new Response('module not found', { status: 404 })
}

function readSignature(pathname) {
  const last = pathname.split('/').pop() ?? ''
  const token = last.endsWith('.js') ? last.slice(0, -3) : last
  return /^[a-f0-9]{64}$/i.test(token) ? token : null
}

async function tryCacheMatch(request) {
  try {
    const cache = await caches.open(CACHE_NAME)
    return await cache.match(request, { ignoreSearch: false })
  } catch {
    return null
  }
}

function toHeadIfNeeded(request, response) {
  const method = (request.method || 'GET').toUpperCase()
  if (method !== 'HEAD') return response
  const headers = new Headers(response.headers)
  return new Response(null, { status: response.status, headers })
}

async function tryReadFromOpfs(dirName, sig) {
  try {
    const root = await self.navigator.storage.getDirectory()

    // root-scoped: opfs/__drones__/sig or opfs/__dependencies__/sig
    const direct = await readFromDir(root, dirName, `${sig}.js`)
    if (direct) return direct

    // domain-scoped: opfs/<domain>/__drones__/sig or opfs/<domain>/__dependencies__/sig
    for await (const [name, entry] of root.entries()) {
      if (!entry || entry.kind !== 'directory') continue
      if (!isDomainName(name)) continue
      const nested = await readFromNested(entry, dirName, `${sig}.js`)
      if (nested) return nested
    }

    return null
  } catch {
    return null
  }
}

async function readFromDir(rootDir, dirName, sig) {
  try {
    const dir = await rootDir.getDirectoryHandle(dirName)
    const fileHandle = await dir.getFileHandle(sig)
    const file = await fileHandle.getFile()
    return asJsResponse(file, false)
  } catch {
    return null
  }
}

async function readFromNested(domainDir, dirName, sig) {
  try {
    const dir = await domainDir.getDirectoryHandle(dirName)
    const fileHandle = await dir.getFileHandle(sig)
    const file = await fileHandle.getFile()
    const text = await file.text()
    return asJsResponse(file, true)
  } catch {
    return null
  }
}

function asJsResponse(file, immutable) {
  const headers = new Headers()
  headers.set('content-type', 'application/javascript')
  headers.set('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-store')
  return new Response(file, { status: 200, headers })
}

function isDomainName(name) {
  const raw = (name ?? '').trim()
  if (!raw || raw.startsWith('__')) return false
  if (raw === '__drones__') return false
  if (raw === '__dependencies__') return false
  if (raw === 'hypercomb') return false
  return /^[a-z0-9.-]+$/i.test(raw) && raw.includes('.')
}
