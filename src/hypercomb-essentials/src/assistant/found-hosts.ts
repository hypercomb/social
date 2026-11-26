// assistant/found-hosts.ts
//
// WHERE A READ FOUND A SIGNATURE (reach A4, 2026-11-25). A model finds a
// creation by `explore`, `pool` or a showcase, each of which says which hosts
// led to it, and then opens it with `read` or brings it with `take`. Only the
// showcase told the content broker where a head lives, so a creation whose
// bytes sit only on a host outside the broker's tiers could be found and then
// come back not-found.
//
// One map per page, signature to the hosts it was found at, filled by every
// network read and asked by `take`. Each note is also handed to the broker as
// a HINT (`hintDomainsForSig`), so a later read asks there first, and the
// broker learns none of those hosts: a read lists far more hosts than serve
// it, and the broker's persisted host list is the one adopts rely on across
// reloads (a broker without the hint is told nothing). Attribution only:
// it steers where a read goes, every byte is still SHA-256-checked against its
// name, and nothing is written anywhere or sent to anyone. Memory only, never
// persisted: it is session read state, not a pool.

const SIG = /^[0-9a-f]{64}$/
const HOST = /^[a-z0-9.:[\]-]+$/
/** Signatures remembered; the oldest go first. */
export const FOUND_HOSTS_CAP = 4_000
/** Hosts kept for one signature. */
const HOSTS_PER_SIG = 16

type BrokerLike = { hintDomainsForSig?: (sig: string, domains: string[]) => void }

const found = new Map<string, string[]>()

const broker = (): BrokerLike | undefined => {
  try {
    return (globalThis as { ioc?: { get?: (key: string) => unknown } }).ioc
      ?.get?.('@diamondcoreprocessor.com/ContentBrokerDrone') as BrokerLike | undefined
  } catch { return undefined }
}

/** Remember that `sig` was found at `hosts`, and hint the broker. Hosts
 *  already remembered keep their place; new ones join after them. */
export const noteFoundAt = (rawSig: unknown, rawHosts: readonly unknown[]): void => {
  const sig = String(rawSig ?? '').trim().toLowerCase()
  if (!SIG.test(sig)) return
  const hosts = [...new Set((rawHosts ?? []).map(host => String(host ?? '').trim().toLowerCase())
    .filter(host => host && host.length <= 260 && HOST.test(host)))]
  if (!hosts.length) return
  const held = found.get(sig) ?? []
  const merged = [...new Set([...held, ...hosts])].slice(0, HOSTS_PER_SIG)
  found.delete(sig)
  found.set(sig, merged)
  while (found.size > FOUND_HOSTS_CAP) {
    const oldest = found.keys().next().value as string | undefined
    if (oldest === undefined) break
    found.delete(oldest)
  }
  try { broker()?.hintDomainsForSig?.(sig, [...hosts]) } catch { /* no broker in this shell */ }
}

/** The hosts a read found `sig` at this page, first found first; none when no read did. */
export const foundHostsOf = (rawSig: unknown): readonly string[] =>
  [...(found.get(String(rawSig ?? '').trim().toLowerCase()) ?? [])]

/** Forget every attribution (a test starts clean). */
export const forgetFoundHosts = (): void => { found.clear() }

const HEAD_KEYS = new Set(['head', 'root'])
/** Signatures one document may attribute; a ledger is a few hundred rows. */
const DOCUMENT_NOTES_MAX = 2_000

/** Every 64-hex `head` or `root` value inside a parsed JSON document (a
 *  `host:publications` ledger, a showcase record), each once, bounded. */
export const headsInDocument = (text: string): string[] => {
  let value: unknown
  try { value = JSON.parse(text) } catch { return [] }
  const heads = new Set<string>()
  const walk = (node: unknown, depth: number): void => {
    if (heads.size >= DOCUMENT_NOTES_MAX || depth > 8 || !node || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const item of node) walk(item, depth + 1); return }
    for (const [key, item] of Object.entries(node as Record<string, unknown>)) {
      if (heads.size >= DOCUMENT_NOTES_MAX) return
      if (HEAD_KEYS.has(key) && typeof item === 'string') {
        const sig = item.trim().toLowerCase()
        if (SIG.test(sig)) heads.add(sig)
      } else walk(item, depth + 1)
    }
  }
  walk(value, 0)
  return [...heads]
}
