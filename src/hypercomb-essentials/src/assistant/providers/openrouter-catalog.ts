// assistant/providers/openrouter-catalog.ts
//
// THE REAL CATALOGUE, ON DEMAND. `openrouter.provider.ts` ships a short,
// deliberately economical roster so automatic tier routing can never reach a
// frontier price by accident (see that file's header). This module is the
// escape hatch for the opposite, EXPLICIT case: a participant who wants to
// call a model that isn't on that safety-first ladder, by picking it from
// OpenRouter's own list rather than guessing an id.
//
// The list endpoint is PUBLIC — no key, no billing, just a catalogue — so
// this fetch happens whether or not a key is saved yet, letting a participant
// browse before they even paste one. Nothing that comes back here is ever
// read by tier resolution or automatic routing: a model picked from this
// catalogue only ever reaches a call the participant explicitly fires (the
// console's "Use this model" action), which is the same explicit-naming path
// as typing a model id directly.

export type OpenRouterCatalogEntry = {
  readonly id: string
  readonly name: string
  /** Dollars per token, as OpenRouter's API reports them — strings, not
   *  numbers, because that's the wire format and there is no arithmetic to
   *  do here, only display. */
  readonly promptPrice?: string
  readonly completionPrice?: string
}

const CATALOG_URL = 'https://openrouter.ai/api/v1/models'
const CACHE_TTL_MS = 10 * 60 * 1000

let cached: readonly OpenRouterCatalogEntry[] | undefined
let cachedAt = 0
let inflight: Promise<readonly OpenRouterCatalogEntry[]> | undefined

type CatalogBody = {
  data?: {
    id?: unknown
    name?: unknown
    pricing?: { prompt?: unknown; completion?: unknown }
  }[]
}

/** Fetch (or reuse a fresh cached copy of) OpenRouter's public model list.
 *  Throws with a plain message on failure — the console shows it verbatim,
 *  same as a failed Test call. */
export const fetchOpenRouterCatalog = async (): Promise<readonly OpenRouterCatalogEntry[]> => {
  const fresh = cached && Date.now() - cachedAt < CACHE_TTL_MS
  if (fresh) return cached as readonly OpenRouterCatalogEntry[]
  if (inflight) return inflight

  inflight = (async () => {
    const response = await fetch(CATALOG_URL)
    if (!response.ok) throw new Error(`OpenRouter catalogue request failed (${response.status})`)
    const body = await response.json() as CatalogBody
    const entries = (body.data ?? [])
      .filter((row): row is { id: string; name?: unknown; pricing?: { prompt?: unknown; completion?: unknown } } =>
        typeof row?.id === 'string' && row.id.length > 0)
      .map(row => ({
        id: row.id,
        name: typeof row.name === 'string' && row.name ? row.name : row.id,
        promptPrice: typeof row.pricing?.prompt === 'string' ? row.pricing.prompt : undefined,
        completionPrice: typeof row.pricing?.completion === 'string' ? row.pricing.completion : undefined,
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
    cached = entries
    cachedAt = Date.now()
    return entries
  })()

  try {
    return await inflight
  } finally {
    inflight = undefined
  }
}

/** For tests and a manual "refresh the list" action. */
export const clearOpenRouterCatalogCache = (): void => { cached = undefined; cachedAt = 0 }
