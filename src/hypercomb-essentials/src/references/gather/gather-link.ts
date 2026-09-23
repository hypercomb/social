// references/gather/gather-link.ts
//
// THE LINK BETWEEN A PAGE AND THE GROUP IT GATHERS FROM — made explicit.
//
// `friends` gathers from `people`: the people it shows are references into
// `/people`, and a person made on `friends` is made in `people`. That link used
// to be GUESSED (most of a page's tiles are references from one group —
// create-landing.ts) and shown nowhere, so it could fail without anyone seeing.
// Now it is a mark the page WEARS: one `gathers` decoration per group, written
// once when the page is attached and never touched when members come and go —
// the page's signature moves only when the link itself changes.
//
// Seen from the group, the same link is a TARGET. Standing on `people`, every
// page that gathers from it can be switched on or off, and what you add goes to
// the targets that are on — never to all of them by itself. On/off is the
// participant's own working state (sticky, local); the link travels with the page.
//
// The group's identity is its MOLECULE, `sign(name)`, derived from the route and
// never stored in the record, so no 64-hex rides in the payload to be mistaken
// for a resource the closure must carry.

export const GATHERS_KIND = 'gathers'

/** Colon-scoped, so no tile name can produce it. Its sub-buckets are group
 *  molecules; each file names a page that was attached to that group. The
 *  bucket only nominates — the page's own mark decides. */
export const GATHERS_POOL_MEANING = 'gathers:pages'

/** Participant-local: `{ [groupMolecule]: pageRouteKey[] }` — the targets that are on. */
export const GATHER_TARGETS_STORAGE_KEY = 'hc:gather-targets'

export type GathersPayload = { readonly groupSegments: readonly string[] }

export type GatherTarget = { readonly segments: readonly string[]; readonly on: boolean }

export const routeKey = (segments: readonly string[]): string => segments.join('/')

export const sameRoute = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((segment, index) => segment === b[index])

/** A route the way every reader here wants one: strings, no empties. */
export const cleanRoute = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.map(segment => String(segment ?? '').trim()).filter(Boolean) : []

export const buildGathersPayload = (groupSegments: readonly string[]): GathersPayload =>
  ({ groupSegments: cleanRoute(groupSegments) })

/** The group route a `gathers` record points at, or null when the record is
 *  not one. Strings only — a peer's `3` must not become a group named "3". */
export const groupOfRecord = (record: unknown): string[] | null => {
  const r = record as { kind?: unknown; payload?: { groupSegments?: unknown } } | null
  if (r?.kind !== GATHERS_KIND) return null
  const raw = r.payload?.groupSegments
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every(s => typeof s === 'string' && s.trim())) return null
  return cleanRoute(raw)
}

/** The page a pool record nominates, or null. */
export const pageOfPoolRecord = (record: unknown): string[] | null => {
  const raw = (record as { pageSegments?: unknown } | null)?.pageSegments
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every(s => typeof s === 'string' && s.trim())) return null
  return cleanRoute(raw)
}

export const buildPoolRecord = (pageSegments: readonly string[]): { pageSegments: string[] } =>
  ({ pageSegments: cleanRoute(pageSegments) })

export type TargetState = Readonly<Record<string, readonly string[]>>

export const readTargetState = (raw: string | null | undefined): TargetState => {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string[]> = {}
    for (const [group, pages] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(pages)) continue
      const keys = pages.filter((p): p is string => typeof p === 'string' && p.length > 0)
      if (keys.length) out[group] = [...new Set(keys)]
    }
    return out
  } catch { return {} }
}

/** The state with one target switched. An emptied group disappears, so an
 *  all-off group and a never-touched one read the same. */
export const withTarget = (state: TargetState, group: string, pageKey: string, on: boolean): TargetState => {
  const current = new Set(state[group] ?? [])
  if (on) current.add(pageKey)
  else current.delete(pageKey)
  const next: Record<string, readonly string[]> = { ...state }
  if (current.size) next[group] = [...current]
  else delete next[group]
  return next
}
