// assistant/hive-typescript-read.ts
//
// ONE SOURCE ATOM, ASKED OF THE PACKAGE'S OWN HOSTS AND VERIFIED (owner,
// 2026-11-16: "Host the package's TypeScript without installing it, fetched
// only when a file is opened"; 2026-11-17: "Yes, build it").
//
// A package layer names the atom that holds its folder's TypeScript
// (package-typescript.ts). The atom is hosted beside the package and held by
// nothing installed, so reading one is a request. This file is that request
// and nothing else:
//
//   · it asks only the hosts this device already asks for the package
//     (sharing/update-sources.ts packageHosts), so a read can never be aimed
//     at a stranger;
//   · what goes out is a signature and nothing else, as `<base>/<sig>?held`,
//     and a redirect is an error: a listed host cannot pass the ask on to a
//     host that is not listed;
//   · what comes back is counted as it arrives and dropped once it is larger
//     than any atom, so a host cannot fill this device's memory;
//   · what comes back is used only when it hashes to that signature, so a
//     host cannot put its own words under a name a signed layer gave;
//   · nothing is written: no store, no broker, no history. The caller keeps
//     the bytes in memory or drops them.
//
// A host that is down, answers a page, or does not hold the atom is a miss,
// and the next base is asked. A miss is not remembered: the next ask asks
// again, because a publish may have filled the host since.

import { SignatureService, type HostProvider } from '@hypercomb/core'
import { fetchWithDeadline } from '../sharing/bounded-fetch.js'
import { packageHosts } from '../sharing/update-sources.js'

/** An answer larger than this is not an atom. The largest folder is under
 *  four megabytes; this leaves room for it to grow eightfold. */
export const TYPESCRIPT_ATOM_MAX = 33_554_432
/** How long one base gets to hand over one atom. */
export const TYPESCRIPT_READ_MS = 60_000

const SIGNATURE = /^[a-f0-9]{64}$/
/** Where the shell registers the reader of what a domain publishes. Core
 *  declares this name as HOST_IOC_KEY (host.types.ts). It is written out here
 *  because no essentials module has imported that export before, and a shell
 *  in service whose core lacks a name a module imports refuses the module. An
 *  absent provider is only "no base to ask". */
const HOST_PACKAGES_KEY = '@hypercomb.social/HostPackages'

export interface TypescriptReadDeps {
  /** The hosts this device asks for the package, in order. */
  zones(): Promise<readonly string[]>
  /** The URL bases worth asking for one host, in order. */
  bases(zone: string): readonly string[]
  /** The bytes at a URL, or null for anything that is not them. */
  get(url: string, signal?: AbortSignal): Promise<Uint8Array | null>
  /** sha256 of bytes, as hex. */
  sign(bytes: Uint8Array): Promise<string>
}

const unique = (values: readonly string[]): string[] => [...new Set(values.filter(Boolean))]

export const liveTypescriptReadDeps: TypescriptReadDeps = {
  zones: () => packageHosts(),
  // The base the host's pool answered on, then that host bare. The public
  // host holds an atom in its heap under its settled base; asked bare, its
  // worker reads the publisher's own host for it, so an atom the publish did
  // not carry over is still found while the publisher's machine is on.
  bases: zone => {
    let settled: readonly string[] = []
    try {
      settled = (window as { ioc?: { get?: <T>(key: string) => T | undefined } }).ioc
        ?.get?.<Pick<HostProvider, 'bases'>>(HOST_PACKAGES_KEY)?.bases(zone) ?? []
    } catch { settled = [] }
    const origins = settled.map(base => { try { return new URL(base).origin } catch { return '' } })
    return unique([...settled, ...origins])
  },
  get: async (url, signal) => {
    // The read's own clock, not the fetch's. `fetchWithDeadline` marks a host
    // as slow when ITS deadline ends a request; a large atom on a slow line
    // is not a host that stopped answering, so the fetch's deadline is set
    // past this one and this one ends the request instead.
    const own = new AbortController()
    const stop = (): void => own.abort()
    const timer = setTimeout(stop, TYPESCRIPT_READ_MS)
    // A signal that is already aborted never fires its event.
    if (signal?.aborted) stop()
    signal?.addEventListener('abort', stop, { once: true })
    // Every wait below is raced against the read's own end, so the clock and
    // the caller's signal end the read even when a wait ignores the signal.
    const ended = new Promise<never>((_resolve, reject) => {
      const end = (): void => reject(new Error('the read ended'))
      if (own.signal.aborted) end()
      else own.signal.addEventListener('abort', end, { once: true })
    })
    ended.catch(() => undefined)
    let response: Response | undefined
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let whole = false
    try {
      // `no-store`: the browser's own cache is a place on disk, and the
      // TypeScript is held in memory only. `redirect: 'error'`: the ask goes
      // to a host this device already asks for the package and to no other.
      response = await Promise.race([
        fetchWithDeadline(url, { cache: 'no-store', redirect: 'error' }, { timeoutMs: TYPESCRIPT_READ_MS * 2, signal: own.signal }),
        ended,
      ])
      // A host answers a signature it does not hold with 204 (`?held`).
      if (response.status !== 200) return null
      if ((response.headers?.get?.('content-type') ?? '').toLowerCase().includes('text/html')) return null
      // A declared length over the cap is refused before a byte is read.
      if (Number(response.headers?.get?.('content-length') ?? 0) > TYPESCRIPT_ATOM_MAX) return null
      // The length is the host's word, and may be absent or false. The body
      // is read as it arrives and counted: `arrayBuffer()` would hold
      // whatever came, however much, before any check could run.
      reader = response.body?.getReader?.()
      if (!reader) return null
      const chunks: Uint8Array[] = []
      let size = 0
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), ended])
        if (done) break
        if (!value?.byteLength) continue
        size += value.byteLength
        if (size > TYPESCRIPT_ATOM_MAX) return null
        chunks.push(value)
      }
      const bytes = new Uint8Array(size)
      let at = 0
      for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength }
      whole = true
      return bytes
    } catch {
      return null
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', stop)
      // An answer that was not read to its end is ended here, so the host
      // stops sending what nobody will keep.
      if (!whole) {
        try { void (reader ? reader.cancel() : response?.body?.cancel?.())?.catch?.(() => undefined) } catch { /* already closed */ }
      }
    }
  },
  sign: bytes => SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer),
}

/**
 * The atom a signature names, from the first of the package's hosts that
 * hands over bytes hashing to it, with the host that did. Null when the
 * signature is not one, when there is no host to ask, or when no host holds
 * it. Never throws for a host. Nothing is written anywhere.
 */
export const readTypescriptAtom = async (
  raw: string,
  signal?: AbortSignal,
  deps: TypescriptReadDeps = liveTypescriptReadDeps,
): Promise<{ bytes: Uint8Array; host: string } | null> => {
  const sig = String(raw ?? '').toLowerCase()
  if (!SIGNATURE.test(sig)) return null
  const zones = await deps.zones().catch(() => [] as readonly string[])
  for (const zone of zones) {
    let bases: readonly string[] = []
    try { bases = deps.bases(zone) } catch { bases = [] }
    for (const base of bases) {
      if (signal?.aborted) return null
      const bytes = await deps.get(`${base}/${sig}?held`, signal).catch(() => null)
      if (!bytes || !bytes.byteLength || bytes.byteLength > TYPESCRIPT_ATOM_MAX) continue
      if ((await deps.sign(bytes).catch(() => '')) !== sig) continue
      return { bytes, host: zone }
    }
  }
  return null
}
