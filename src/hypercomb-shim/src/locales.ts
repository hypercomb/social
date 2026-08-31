// hypercomb-shim/src/locales.ts
//
// A LOCALE IS CONTENT. It lives on a host in a pool of meaning and resolves by
// signature, exactly like a bee, a layer or a resource. It is never bundled
// into the shell and never handed out as an installer resource.
//
// Both halves of that matter:
//
//   NOT BUNDLED — fourteen catalogs are 2.9 MB, and bundling them puts every
//   language into every host's entry bundle to serve the one language a
//   visitor actually reads. The shim's entry drops from 3,253 kB to ~180 kB by
//   doing nothing more than refusing to carry them.
//
//   NOT AN INSTALLER RESOURCE — a language is not something you install. It is
//   bytes a host holds, which you fetch when you need them, verify against
//   their own name, and keep. Putting locales in the install manifest would
//   make adding a language a package rebuild and a merkle cascade; as content
//   it is one more file on a host.
//
// The resolution chain, cheapest first, verified at every step:
//
//   sign('translations') pool  →  flat OPFS root  →  <origin>/<sig>
//
// A network hit is written back into the pool, so a locale is fetched once per
// participant and is then local forever. `/locales.json` is a pointer, the
// same class of thing as `/pin`: mutable by design, naming content that is
// not.

import { registerPoolMeaning, SignatureService } from '@hypercomb/core'

const SIG_RE = /^[a-f0-9]{64}$/

/** The pool of meaning that holds locale catalogs. In core's frozen bare-word
 *  set, and already the Store's `translations` pool. */
const TRANSLATIONS_MEANING = 'translations'

/** locale → signature. A pointer, like /pin: everything it names is verified. */
const LOCALES_INDEX = '/locales.json'

type PoolStore = {
  getPool(meaning: string): Promise<FileSystemDirectoryHandle | null>
}

const decode = (bytes: ArrayBuffer): Record<string, string> | null => {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, string>
      : null
  } catch { return null }
}

const verify = async (bytes: ArrayBuffer, signature: string): Promise<boolean> =>
  (await SignatureService.sign(bytes)) === signature

let indexPromise: Promise<Record<string, string>> | null = null

/** What locales this host publishes, and the signature of each. Fetched once
 *  per session; an unreachable index means no host catalogs, which the loader
 *  degrades through exactly like a failed import. */
const localeIndex = async (): Promise<Record<string, string>> => {
  indexPromise ??= (async () => {
    try {
      const res = await fetch(LOCALES_INDEX, { cache: 'no-store' })
      if (!res.ok) return {}
      const raw: unknown = await res.json()
      if (!raw || typeof raw !== 'object') return {}
      const out: Record<string, string> = {}
      for (const [locale, sig] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof sig === 'string' && SIG_RE.test(sig)) out[locale] = sig
      }
      return out
    } catch { return {} }
  })()
  return indexPromise
}

const readFromPool = async (sig: string): Promise<ArrayBuffer | null> => {
  const store = window.ioc?.get?.<PoolStore>('@hypercomb.social/Store')
  if (!store?.getPool) return null
  try {
    const pool = await store.getPool(TRANSLATIONS_MEANING)
    const handle = await pool?.getFileHandle(sig, { create: false })
    return handle ? await (await handle.getFile()).arrayBuffer() : null
  } catch { return null }
}

const writeToPool = async (sig: string, bytes: ArrayBuffer): Promise<void> => {
  const store = window.ioc?.get?.<PoolStore>('@hypercomb.social/Store')
  if (!store?.getPool) return
  try {
    const pool = await store.getPool(TRANSLATIONS_MEANING)
    if (!pool) return
    // Present already? Re-writing a content-addressed file invalidates any
    // Blob already handed out for that signature.
    try { await pool.getFileHandle(sig, { create: false }); return } catch { /* absent */ }
    const handle = await pool.getFileHandle(sig, { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(bytes) } finally { await writable.close() }
  } catch { /* cache fill is best-effort — the bytes are already in hand */ }
}

const readFromRoot = async (sig: string): Promise<ArrayBuffer | null> => {
  try {
    const root = await navigator.storage.getDirectory()
    const handle = await root.getFileHandle(sig, { create: false })
    return await (await handle.getFile()).arrayBuffer()
  } catch { return null }
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

/**
 * The resolver `initializeRuntime` calls. Returns null for a locale this host
 * does not publish, which the loader treats as absent — the same graceful
 * degradation a failed import gets.
 *
 * Every path verifies. The local ones verify too, and that is not paranoia
 * about origin-private storage: a file named `<sig>` that does not hash to
 * `<sig>` is also what a truncated write or an interrupted eviction looks
 * like, and a corrupt catalog would render as garbage text rather than fail
 * loudly.
 */
export const signatureCatalogs = async (locale: string): Promise<Record<string, string> | null> => {
  const index = await localeIndex()
  const sig = index[locale]
  if (!sig) return null

  const local = await readFromPool(sig) ?? await readFromRoot(sig)
  if (local && await verify(local, sig)) return decode(local)
  if (local) console.warn(`[locales] local copy of ${locale} failed verification — refetching`)

  const remote = await fetchFromOrigin(sig)
  if (!remote) return null
  if (!await verify(remote, sig)) {
    console.error(`[locales] ${locale}: origin served bytes that do not hash to ${sig.slice(0, 12)} — refused`)
    return null
  }
  await writeToPool(sig, remote)
  return decode(remote)
}

/** Which locales this host publishes. For a language picker that should offer
 *  what is actually available rather than a list compiled into the shell. */
export const publishedLocales = async (): Promise<string[]> =>
  Object.keys(await localeIndex()).sort()
