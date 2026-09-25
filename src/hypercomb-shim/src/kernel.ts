// hypercomb-shim/src/kernel.ts
//
// THE KERNEL — the whole of what a minimal install runs by itself.
//
// The install ships this and the processor (/hypercomb-core.runtime.js). The
// kernel knows TWO signatures, baked in at build time (build.mjs computes
// them; none is written in source): the host bundle and the core library.
// It finds their bytes — this device first, then this origin, then the
// default hosts (hypercomb.com, jwize.com) — refuses any that do not hash to
// their signature, keeps them on this device, declares `@hypercomb/core` as
// processor + library, and runs the host. Everything else a host does
// (packages, fonts, locales) arrives the same way, by signature, from there.
//
// A classic script, not a module, and it imports nothing: it must run before
// any module loads, because it declares the page's one import map.

declare const __HC_HOST_SIG__: string
declare const __HC_LIBRARY_SIG__: string

const DEFAULT_HOSTS = ['hypercomb.com', 'jwize.com']
const PROCESSOR = '/hypercomb-core.runtime.js'

const hex = (buffer: ArrayBuffer): string =>
  [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('')

const verified = async (sig: string, bytes: ArrayBuffer | null): Promise<ArrayBuffer | null> =>
  bytes && hex(await crypto.subtle.digest('SHA-256', bytes)) === sig ? bytes : null

const fromDevice = async (sig: string): Promise<ArrayBuffer | null> => {
  try {
    const root = await navigator.storage.getDirectory()
    return await (await (await root.getFileHandle(sig)).getFile()).arrayBuffer()
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

/** A blob URL for the verified bytes of `sig`, or null when no place has them. */
const resolveSig = async (sig: string): Promise<string | null> => {
  const local = await verified(sig, await fromDevice(sig))
  const bytes = local ?? await fromNetwork(sig)
  if (!bytes) return null
  if (!local) await keep(sig, bytes)
  return URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }))
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
    '@hypercomb/core': blob(`export*from'@hypercomb/core/processor';export*from'${library}'`),
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
  try { await import(/* @vite-ignore */ host!) } catch (error) { fail(String(error)) }
})()
