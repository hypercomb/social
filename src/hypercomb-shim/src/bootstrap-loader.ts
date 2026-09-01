// hypercomb-shim/src/bootstrap-loader.ts
//
// THE PINNED-SIG FETCH PATH. One of the three things the shim is allowed to
// keep (with SW control and the packed-store gate), and the answer to the
// chicken-and-egg: acquisition cannot come from OPFS when OPFS is empty, so
// the shim knows exactly ONE address and reaches everything else through it.
//
//   pin  →  OPFS <sig>  (or network <origin>/<sig>, written back)
//        →  VERIFY the bytes hash to the pin
//        →  import  →  boot()
//
// THE VERIFY IS NOT OPTIONAL AND NOT CONDITIONAL. It runs on the OPFS path
// too, not just the network one. OPFS is origin-private, so a tampered local
// copy is out of the threat model — but "the file named <sig> does not hash to
// <sig>" is also what a truncated write, an interrupted quota eviction, or a
// half-drained migration looks like, and executing those is strictly worse
// than refetching. A hash is microseconds against a module import.
//
// Updating the bootstrap is repinning ONE signature. That is the whole update
// mechanism for the installer itself, which is what makes it forkable: point
// the pin somewhere else and a different acquisition runs, with the same
// guarantee that its bytes are what its name says.

import { SignatureService } from '@hypercomb/core'
import type { Acquisition, BootstrapContext } from './bootstrap/index'

const SIG_RE = /^[a-f0-9]{64}$/

/** Where the origin publishes its current bootstrap signature. THE one
 *  location-addressed read in the chain — a pin has to be mutable or it could
 *  never be repointed, and that is precisely what a pin is for. Everything it
 *  names is content-addressed and verified. */
const PIN_PATH = '/pin'

/** Last pin that verified and ran. Lets a boot proceed offline, and lets a
 *  fetched pin whose bytes do not resolve fall back to one that did. */
const PIN_CACHE_KEY = 'hc:bootstrap-pin'

const readCachedPin = (): string => {
  try {
    const pin = localStorage.getItem(PIN_CACHE_KEY) ?? ''
    return SIG_RE.test(pin) ? pin : ''
  } catch { return '' }
}

const fetchPin = async (): Promise<string> => {
  try {
    // no-store: the pin is the one thing here that is allowed to change, so it
    // must never be answered from cache.
    const res = await fetch(PIN_PATH, { cache: 'no-store' })
    if (!res.ok) return ''
    const pin = (await res.text()).trim().toLowerCase()
    return SIG_RE.test(pin) ? pin : ''
  } catch { return '' }
}

const verify = async (bytes: ArrayBuffer, signature: string): Promise<boolean> =>
  (await SignatureService.sign(bytes)) === signature

const readFromOpfs = async (sig: string): Promise<ArrayBuffer | null> => {
  try {
    const root = await navigator.storage.getDirectory()
    const handle = await root.getFileHandle(sig, { create: false })
    return await (await handle.getFile()).arrayBuffer()
  } catch { return null }
}

const writeToOpfs = async (sig: string, bytes: ArrayBuffer): Promise<void> => {
  try {
    const root = await navigator.storage.getDirectory()
    // Sig-named file at the FLAT ROOT — the canonical content address. No
    // directory is ever created here.
    const handle = await root.getFileHandle(sig, { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(bytes) } finally { await writable.close() }
  } catch { /* cache fill is best-effort; the bytes are already in hand */ }
}

const fetchFromOrigin = async (sig: string): Promise<ArrayBuffer | null> => {
  for (const url of [`/${sig}`, `/content/${sig}`]) {
    try {
      const res = await fetch(url)
      if (!res.ok) continue
      return await res.arrayBuffer()
    } catch { /* try the next address */ }
  }
  return null
}

/** Resolve one signature to verified bytes: local first, origin second, and
 *  never trust either without hashing. Returns null when nothing anywhere
 *  produced bytes that hash to the name. */
const resolveVerified = async (sig: string): Promise<ArrayBuffer | null> => {
  const local = await readFromOpfs(sig)
  if (local && await verify(local, sig)) return local
  if (local) console.warn(`[bootstrap] local copy of ${sig.slice(0, 12)} failed verification — refetching`)

  const remote = await fetchFromOrigin(sig)
  if (!remote) return null
  if (!await verify(remote, sig)) {
    console.error(`[bootstrap] origin served bytes that do not hash to ${sig.slice(0, 12)} — refused`)
    return null
  }
  await writeToOpfs(sig, remote)
  return remote
}

export type BootstrapHandle = Acquisition & { pin: string }

/**
 * Load and run the pinned bootstrap bundle.
 *
 * Pin order: the origin's current pin first (so a repin takes effect on the
 * next boot), the last one that ran second (so an unreachable origin does not
 * strand a node that already holds a working bootstrap).
 *
 * Returns null when no pin resolved. That is a real failure — without
 * acquisition a cold node can never become anything — so the caller reports
 * it rather than continuing quietly.
 */
export const loadBootstrap = async (context: BootstrapContext = {}): Promise<BootstrapHandle | null> => {
  const cached = readCachedPin()
  const candidates = [...new Set([await fetchPin(), cached].filter(Boolean))]
  if (candidates.length === 0) {
    console.error('[bootstrap] no pin — the origin published none and none is cached')
    return null
  }

  for (const pin of candidates) {
    const bytes = await resolveVerified(pin)
    if (!bytes) continue

    // A blob URL, not the raw path: the bytes are already verified and in
    // hand, so importing them directly removes any chance that what runs is
    // different from what was checked — and it works on hosts that answer
    // extension-less files with a MIME type the browser refuses for modules
    // (the XCOPY contract every dumb static host runs into).
    const url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }))
    try {
      const module = await import(/* @vite-ignore */ url) as { boot?: (c: BootstrapContext) => Acquisition }
      if (typeof module.boot !== 'function') {
        console.error(`[bootstrap] ${pin.slice(0, 12)} exports no boot()`)
        continue
      }
      const acquisition = module.boot(context)
      try { localStorage.setItem(PIN_CACHE_KEY, pin) } catch { /* hint only */ }
      console.log(`[bootstrap] ${pin.slice(0, 12)}… verified and running (${(bytes.byteLength / 1024).toFixed(0)} kB)`)
      return { ...acquisition, pin }
    } catch (error) {
      console.error(`[bootstrap] ${pin.slice(0, 12)} failed to run`, error)
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  console.error('[bootstrap] no pin resolved to runnable, verified bytes')
  return null
}
