// hypercomb-shim/src/kernel.ts
//
// THE KERNEL — the whole of what a minimal install runs by itself.
//
// The install ships this and the processor (/hypercomb-core.runtime.js). The
// kernel knows TWO signatures, baked in at build time (build.mjs computes
// them; none is written in source): the host bundle and the core library.
// It finds their bytes — this device first, then this origin, then the
// default hosts (hypercomb.com, jwize.com) — refuses any that do not hash to
// their signature, keeps them on this device (OPFS, and the service worker's
// cache for a stable address), declares `@hypercomb/core` as processor +
// library, and runs the host. Everything else a host does
// (packages, fonts, locales) arrives the same way, by signature, from there.
//
// A classic script, not a module, and it imports nothing: it must run before
// any module loads, because it declares the page's one import map.

declare const __HC_HOST_SIG__: string
declare const __HC_LIBRARY_SIG__: string

const DEFAULT_HOSTS = ['hypercomb.com', 'jwize.com']
const PROCESSOR = '/hypercomb-core.runtime.js'
// Verified atoms, served by the service worker at a stable address so the
// browser keeps their compiled code (public/hypercomb.worker.js, same name).
const SIG_CACHE = 'hypercomb-sig-v1'
const stable = (sig: string): string => `/@sig/${sig}`

const hex = (buffer: ArrayBuffer): string =>
  [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('')

const verified = async (sig: string, bytes: ArrayBuffer | null): Promise<ArrayBuffer | null> =>
  bytes && hex(await crypto.subtle.digest('SHA-256', bytes)) === sig ? bytes : null

const fromDevice = async (sig: string): Promise<ArrayBuffer | null> => {
  try {
    const root = await navigator.storage.getDirectory()
    const bytes = await (await (await root.getFileHandle(sig)).getFile()).arrayBuffer()
    return bytes.byteLength ? bytes : null   // empty: an interrupted write, not a copy
  } catch { return null }
}

const keep = async (sig: string, bytes: ArrayBuffer): Promise<void> => {
  try {
    const root = await navigator.storage.getDirectory()
    const writable = await (await root.getFileHandle(sig, { create: true })).createWritable()
    try { await writable.write(bytes) } finally { await writable.close() }
  } catch { /* keeping is a cache; the bytes are already in hand */ }
}

const fromNetwork = async (sig: string): Promise<ArrayBuffer | null> => {
  const urls = [`/${sig}`, `/content/${sig}`,
    ...DEFAULT_HOSTS.flatMap(host => [`https://${host}/${sig}`, `https://content.${host}/${sig}`])]
  for (const url of urls) {
    try {
      const response = await fetch(url)
      if (!response.ok) continue
      const bytes = await verified(sig, await response.arrayBuffer())
      if (bytes) return bytes
      console.error(`[kernel] ${url} served bytes that do not hash to ${sig.slice(0, 12)} — refused`)
    } catch { /* try the next place */ }
  }
  return null
}

const sigCache = async (): Promise<Cache | null> => {
  try { return await caches.open(SIG_CACHE) } catch { return null }
}

/** Where to import the bytes of `sig` from, or null when no place has them.
 *  THE ONE HASH is on the way in (fromNetwork): what this device holds was
 *  hashed when it was kept, so it is never hashed again. Warm: the service
 *  worker's stable address, nothing read here at all. */
const resolveSig = async (sig: string): Promise<string | null> => {
  const cache = await sigCache()
  const served = !!navigator.serviceWorker?.controller
  if (served && await cache?.match(stable(sig))) return stable(sig)
  const local = await fromDevice(sig)
  const bytes = local ?? await fromNetwork(sig)
  if (!bytes) return null
  if (!local) await keep(sig, bytes)
  await cache?.put(stable(sig), new Response(bytes, { headers: { 'content-type': 'text/javascript' } })).catch(() => {})
  return served && cache ? stable(sig) : URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }))
}

const blob = (code: string): string => URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))

const fail = (reason: string): void => {
  console.error(`[kernel] ${reason}`)
  const note = document.createElement('p')
  note.setAttribute('role', 'alert')
  note.style.cssText = 'position:fixed;inset:auto 0 40%;text-align:center;font:15px system-ui,sans-serif'
  note.textContent = `This host could not start: ${reason}`
  document.body.append(note)
}

/** The one import map: core first, then the packages' map the host cached on
 *  the last boot (a hint it re-derives and corrects). */
const declareImports = (library: string): void => {
  const core: Record<string, string> = {
    // Absolute: a path does not resolve against the facade's blob: base.
    '@hypercomb/core': blob(`export*from'@hypercomb/core/processor';export*from'${new URL(library, location.href).href}'`),
    '@hypercomb/core/processor': PROCESSOR,
  }
  let cached: Record<string, string> = {}
  try { cached = JSON.parse(localStorage.getItem('hc:importmap') ?? '{}').imports ?? {} } catch { /* none */ }
  const imports = { ...core, ...Object.fromEntries(Object.entries(cached).filter(([key]) => !(key in core))) }
  const json = JSON.stringify({ imports })
  const map = document.createElement('script')
  map.type = 'importmap'
  map.textContent = json
  document.head.append(map)
  Object.assign(window, { __hcCoreImports: core, __hcImportMapApplied: json })
}

void (async () => {
  const [host, library] = await Promise.all([resolveSig(__HC_HOST_SIG__), resolveSig(__HC_LIBRARY_SIG__)])
  const missing = [[host, __HC_HOST_SIG__], [library, __HC_LIBRARY_SIG__]].find(([url]) => !url)
  if (missing) return fail(`no copy of ${missing[1]!.slice(0, 12)} here or on ${DEFAULT_HOSTS.join(', ')}`)
  declareImports(library!)
  try { await import(/* @vite-ignore */ host!) } catch (error) {
    // A cached copy that no longer runs: drop both and start once more from
    // the device or the network (the import map is declared, so only a
    // reload re-picks).
    if (host!.startsWith('/@sig/') && !sessionStorage.getItem('hc:kernel-retry')) {
      sessionStorage.setItem('hc:kernel-retry', '1')
      const cache = await sigCache()
      await Promise.all([__HC_HOST_SIG__, __HC_LIBRARY_SIG__].map(sig => cache?.delete(stable(sig))))
      return location.reload()
    }
    fail(String(error))
  }
  sessionStorage.removeItem('hc:kernel-retry')
})()
