// hypercomb-shim/src/kernel.ts
//
// THE KERNEL — the whole of what a minimal install runs by itself.
//
// It knows ONE signature, baked in at build time (build.mjs computes it; no
// signature is written in source). It finds those bytes — this device first,
// then this origin, then the default hosts (hypercomb.com, jwize.com) —
// refuses any that do not hash to the signature, keeps them on this device,
// and runs them. Everything else a host does (the engine, the host console,
// packages, fonts, locales) arrives the same way, by signature, from there.
//
// A classic script, not a module, and it imports nothing: it must run before
// any module loads, so what it starts can still declare the import map.

declare const __HC_HOST_SIG__: string

const SIG = __HC_HOST_SIG__
const DEFAULT_HOSTS = ['hypercomb.com', 'jwize.com']

const hex = (buffer: ArrayBuffer): string =>
  [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('')

const verified = async (bytes: ArrayBuffer | null): Promise<ArrayBuffer | null> =>
  bytes && hex(await crypto.subtle.digest('SHA-256', bytes)) === SIG ? bytes : null

const fromDevice = async (): Promise<ArrayBuffer | null> => {
  try {
    const root = await navigator.storage.getDirectory()
    return await (await (await root.getFileHandle(SIG)).getFile()).arrayBuffer()
  } catch { return null }
}

const keep = async (bytes: ArrayBuffer): Promise<void> => {
  try {
    const root = await navigator.storage.getDirectory()
    const writable = await (await root.getFileHandle(SIG, { create: true })).createWritable()
    try { await writable.write(bytes) } finally { await writable.close() }
  } catch { /* keeping is a cache; the bytes are already in hand */ }
}

const fromNetwork = async (): Promise<ArrayBuffer | null> => {
  const urls = [`/${SIG}`, `/content/${SIG}`,
    ...DEFAULT_HOSTS.flatMap(host => [`https://${host}/${SIG}`, `https://content.${host}/${SIG}`])]
  for (const url of urls) {
    try {
      const response = await fetch(url)
      if (!response.ok) continue
      const bytes = await verified(await response.arrayBuffer())
      if (bytes) return bytes
      console.error(`[kernel] ${url} served bytes that do not hash to ${SIG.slice(0, 12)} — refused`)
    } catch { /* try the next place */ }
  }
  return null
}

const fail = (reason: string): void => {
  console.error(`[kernel] ${reason}`)
  const note = document.createElement('p')
  note.setAttribute('role', 'alert')
  note.style.cssText = 'position:fixed;inset:auto 0 40%;text-align:center;font:15px system-ui,sans-serif'
  note.textContent = `This host could not start: ${reason}`
  document.body.append(note)
}

void (async () => {
  const local = await verified(await fromDevice())
  const bytes = local ?? await fromNetwork()
  if (!bytes) return fail(`no copy of ${SIG.slice(0, 12)} here or on ${DEFAULT_HOSTS.join(', ')}`)
  if (!local) await keep(bytes)
  const url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }))
  try { await import(/* @vite-ignore */ url) } catch (error) { fail(String(error)) }
})()
