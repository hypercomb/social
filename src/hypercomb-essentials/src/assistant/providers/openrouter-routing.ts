// assistant/providers/openrouter-routing.ts
//
// WHICH HOST RUNS THE MODEL. Behind OpenRouter one model is served by many
// companies (DeepSeek V4 Flash: ~28 hosts), each with its own price,
// quantization and uptime. By default OpenRouter picks the cheapest healthy
// one and falls over on failure. These are the participant's overrides,
// chosen in the console's OpenRouter row, sent as the request's `provider`
// block (https://openrouter.ai/docs/features/provider-routing).
//
// Device-local. Host choices are PER MODEL (hosts differ per model); the
// sort, fallback and privacy switches apply to every OpenRouter call.
// All defaults → no `provider` block at all, so an untouched hive sends
// exactly what it sent before this file existed.

export type OpenRouterSort = 'price' | 'throughput' | 'latency'

export type OpenRouterRouting = {
  /** Host slugs to use for a model, keyed by model id. Empty/absent = any. */
  readonly only?: Readonly<Record<string, readonly string[]>>
  readonly sort?: OpenRouterSort
  /** false = never leave the hosts in `only`. Default true. */
  readonly allowFallbacks?: boolean
  /** true = skip hosts that may store or train on prompts. */
  readonly denyDataCollection?: boolean
}

const STORAGE_KEY = 'hc:llm:openrouter:routing'
const SORTS: readonly OpenRouterSort[] = ['price', 'throughput', 'latency']
const SLUG = /^[a-z0-9][a-z0-9._-]{0,63}$/

/** An endpoint's routing slug is the part of its `tag` before any `/`
 *  (`deepinfra/fp8` → `deepinfra`) — the base slug matches every variant. */
export const hostSlug = (tag: string): string => String(tag ?? '').split('/')[0].trim().toLowerCase()

const sanitise = (raw: unknown): OpenRouterRouting => {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const only: Record<string, string[]> = {}
  const rawOnly = value['only']
  if (rawOnly && typeof rawOnly === 'object') {
    for (const [model, slugs] of Object.entries(rawOnly as Record<string, unknown>)) {
      if (!Array.isArray(slugs) || model.length > 200) continue
      const kept = [...new Set(slugs
        .filter((s): s is string => typeof s === 'string')
        .map(s => s.toLowerCase())
        .filter(s => SLUG.test(s)))].slice(0, 32)
      if (kept.length) only[model] = kept
    }
  }
  const sort = SORTS.includes(value['sort'] as OpenRouterSort) ? value['sort'] as OpenRouterSort : undefined
  return {
    ...(Object.keys(only).length ? { only } : {}),
    ...(sort ? { sort } : {}),
    ...(value['allowFallbacks'] === false ? { allowFallbacks: false } : {}),
    ...(value['denyDataCollection'] === true ? { denyDataCollection: true } : {}),
  }
}

export class OpenRouterRoutingStore extends EventTarget {
  get(): OpenRouterRouting {
    try { return sanitise(JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? '{}')) }
    catch { return {} }
  }

  #save(next: OpenRouterRouting): void {
    const clean = sanitise(next)
    try {
      if (Object.keys(clean).length) globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(clean))
      else globalThis.localStorage?.removeItem(STORAGE_KEY)
    } catch { /* session-only */ }
    this.dispatchEvent(new CustomEvent('change'))
  }

  hostsFor(modelId: string): readonly string[] {
    return this.get().only?.[modelId] ?? []
  }

  setHostsFor(modelId: string, slugs: readonly string[]): void {
    const current = this.get()
    const only = { ...(current.only ?? {}) }
    if (slugs.length) only[modelId] = slugs
    else delete only[modelId]
    this.#save({ ...current, only })
  }

  setSort(sort: OpenRouterSort | undefined): void {
    const { sort: _drop, ...rest } = this.get()
    this.#save(sort ? { ...rest, sort } : rest)
  }

  setAllowFallbacks(allow: boolean): void {
    const { allowFallbacks: _drop, ...rest } = this.get()
    this.#save(allow ? rest : { ...rest, allowFallbacks: false })
  }

  setDenyDataCollection(deny: boolean): void {
    const { denyDataCollection: _drop, ...rest } = this.get()
    this.#save(deny ? { ...rest, denyDataCollection: true } : rest)
  }
}

export const openRouterRouting = new OpenRouterRoutingStore()

/** The request's `provider` block for this model, or undefined when every
 *  setting is OpenRouter's default — so nothing extra is sent. */
export const providerBlock = (routing: OpenRouterRouting, modelId: string): Record<string, unknown> | undefined => {
  const only = routing.only?.[modelId] ?? []
  const block: Record<string, unknown> = {
    ...(only.length ? { order: [...only], only: [...only] } : {}),
    ...(routing.sort ? { sort: routing.sort } : {}),
    ...(routing.allowFallbacks === false ? { allow_fallbacks: false } : {}),
    ...(routing.denyDataCollection ? { data_collection: 'deny' } : {}),
  }
  return Object.keys(block).length ? block : undefined
}
