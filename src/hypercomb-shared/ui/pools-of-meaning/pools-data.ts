// hypercomb-shared/ui/pools-of-meaning/pools-data.ts
//
// The referenced-roots snapshot behind the "Pools of Meaning" card: every hive
// ROOT this participant references, from the same participant-local lists the
// content broker and service worker already share (sw-domains.ts reads the
// identical keys). Nothing here is invented — a referenced root is a domain
// identity ([[domain-as-identity]]), and each domain's tree is a pool of
// signatures you can reference about anything.
//
//   self      — `hc:nostrmesh:self-domain` (your own root)
//   community — `hc:community:domains`    (configured community hosts)
//   learned   — `hc:known-domains`        (publisher roots learned by adopting
//                                          / streaming their content; MRU)

export type PoolRootKind = 'self' | 'community' | 'learned'

export interface PoolRoot {
  domain: string
  kind: PoolRootKind
}

export interface PoolsPayload {
  roots: PoolRoot[]
}

const KNOWN_KEY = 'hc:known-domains'

const readList = (key: string): string[] => {
  try {
    const raw = localStorage.getItem(key)
    const arr: unknown = raw ? JSON.parse(raw) : null
    if (Array.isArray(arr)) return arr.filter((d): d is string => typeof d === 'string' && !!d.trim()).map(d => d.trim())
  } catch { /* malformed / absent — ignore */ }
  return []
}

/** Assemble the current referenced-roots snapshot. First occurrence wins, so
 *  a domain that is both community and learned reads as community. */
export function readPoolsData(): PoolsPayload {
  const roots: PoolRoot[] = []
  const seen = new Set<string>()
  const push = (domain: string, kind: PoolRootKind): void => {
    const d = domain.trim()
    if (!d || seen.has(d)) return
    seen.add(d)
    roots.push({ domain: d, kind })
  }
  try {
    const self = localStorage.getItem('hc:nostrmesh:self-domain')?.trim()
    if (self) push(self, 'self')
  } catch { /* ignore */ }
  for (const d of readList('hc:community:domains')) push(d, 'community')
  for (const d of readList(KNOWN_KEY)) push(d, 'learned')
  return { roots }
}

/** Drop one LEARNED root from the known-domains list (self/community are
 *  configuration, not managed here). Returns the fresh snapshot. */
export function forgetPoolRoot(domain: string): PoolsPayload {
  try {
    const next = readList(KNOWN_KEY).filter(d => d !== domain)
    localStorage.setItem(KNOWN_KEY, JSON.stringify(next))
  } catch { /* ignore */ }
  return readPoolsData()
}
