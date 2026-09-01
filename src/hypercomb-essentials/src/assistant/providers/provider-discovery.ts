// assistant/providers/provider-discovery.ts
//
// WHERE DISCOVERED PROVIDERS LIVE — the `llm:providers` pool.
//
// A provider spec (provider-spec.ts) is content: a sig-named JSON resource in
// a pool of meaning, exactly like every other record in this system. The pool
// address is DERIVED (`Store.poolSignature('llm:providers')` — colon meaning,
// per the known-location-pools doctrine, so it can never collide with a
// lineage bag), which means any client, any domain, any peer computes the
// same address with no registry round-trip.
//
// This file is both halves of the loop:
//
//   SWEEP  — at boot (Store ready), read every sig-named member of the local
//            pool, parse → compile → register. The registry's `change` event
//            then does the rest: the console grows a row, the key indicator
//            arms, the model words appear. No UI code knows this happened.
//   IMPORT — `importProviderSpec(json)` is the write path: validate, compile,
//            REGISTER FIRST (a spec that cannot go live is not saved), then
//            persist the canonical bytes into the pool so the provider is
//            still there after reload. Same content → same sig → dedupe for
//            free; two domains shipping one spec cost one file.
//
// DOMAIN DISCOVERY composes on top. `sharing/published-pools.ts` probes every
// domain this participant learns for the `llm:providers` index it may publish,
// verifies each member against its signature, and hands it here — the same
// import path a pasted spec takes, so a domain can offer a provider but never
// a privileged one. The spec is public content; the KEY the participant later
// pastes is device-local truth (llm-keys.ts) — the two never travel together.
//
// PROVENANCE AND THE HOLD. A spec names an endpoint a key would be sent to,
// so where it came from matters and is recorded device-locally (never in the
// spec — that would change its signature per domain and break dedup). When a
// domain offers a provider pointing AT ITSELF, it is offering its own models
// and arrives usable. When it points somewhere else, it is asking you to send
// your key to a third party: legitimate for a gateway, and indistinguishable
// from a hostile spec, so it arrives HELD (off, with everything visible) and
// one click in the console turns it on.

import { SignatureService, isSignature } from '@hypercomb/core'
import { llmActivation } from '../llm-activation.js'
import { registerLlmProvider } from '../llm-provider-registry.js'
import { registerPublishedPool } from '../../sharing/published-pools.js'
import { compileProviderSpec, parseProviderSpec, type LlmProviderSpec } from './provider-spec.js'

/** The pool's meaning. Colon-carrying, per doctrine — never a bare word.
 *  The SAME string names the local OPFS pool and the index a domain
 *  publishes at `sign(meaning)`; one address, two sides of the loop. */
export const LLM_PROVIDERS_POOL = 'llm:providers'

/** Device-local provenance: which domain offered this provider. Never part
 *  of the spec — see the module comment. */
const ORIGIN_KEY = (providerId: string): string => `hc:llm:${providerId}:origin`

/** The domain that offered this provider, or '' for one the participant
 *  pasted in themselves. Read by the console to say where a row came from. */
export const providerOrigin = (providerId: string): string => {
  try { return globalThis.localStorage?.getItem(ORIGIN_KEY(providerId)) ?? '' } catch { return '' }
}

const rememberOrigin = (providerId: string, origin: string): void => {
  if (!origin) return
  try { globalThis.localStorage?.setItem(ORIGIN_KEY(providerId), origin) } catch { /* session-only */ }
}

/** Does this spec point back at the domain that published it? A bridge (no
 *  endpoint) does too: it names no third party at all. */
const pointsAtItsOwnOrigin = (spec: LlmProviderSpec, origin: string): boolean => {
  if (!spec.endpoint) return true
  try { return new URL(spec.endpoint).host === origin } catch { return false }
}

type DirLike = {
  entries(): AsyncIterable<[string, { kind: string; getFile?: () => Promise<{ size: number; text(): Promise<string> }> }]>
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{
    createWritable(): Promise<{ write(data: ArrayBuffer): Promise<void>; close(): Promise<void> }>
  }>
}
type StoreLike = {
  initialize?: () => Promise<void>
  getPool?: (meaning: string) => Promise<DirLike | null>
}

const store = (): StoreLike | undefined =>
  window.ioc?.get?.('@hypercomb.social/Store') as StoreLike | undefined

const pool = async (): Promise<DirLike | null> => {
  const s = store()
  if (!s?.getPool) return null
  try { await s.initialize?.() } catch { /* boot handles its own failure */ }
  return await s.getPool(LLM_PROVIDERS_POOL)
}

/**
 * Register every spec the local pool holds. Idempotent (the registry ignores
 * a re-registration) and forgiving per member — one malformed resource must
 * not take the rest of the roster down with it. Returns the ids registered.
 */
export const sweepProviderPool = async (): Promise<string[]> => {
  const dir = await pool()
  if (!dir) return []
  const registered: string[] = []
  try {
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'file' || !isSignature(name) || !handle.getFile) continue
      try {
        const file = await handle.getFile()
        if (!file.size) continue
        const spec = parseProviderSpec(await file.text())
        registerLlmProvider(compileProviderSpec(spec))
        registered.push(spec.id)
      } catch (err) {
        console.warn(`[provider-discovery] skipping pool member ${name.slice(0, 12)}…:`, err)
      }
    }
  } catch { /* pool unreadable — roster is just the built-ins */ }
  if (registered.length) {
    console.log(`[provider-discovery] ${registered.length} discovered provider(s): ${registered.join(', ')}`)
  }
  return registered
}

/**
 * Validate, compile, REGISTER, then persist one spec. Throws (with the
 * parse reason) rather than half-succeeding; returns the spec it accepted.
 * Persisting canonicalizes: the stored bytes are the parsed spec re-encoded,
 * so cosmetic JSON differences collapse to one signature.
 */
export const importProviderSpec = async (
  json: unknown,
  options: { origin?: string } = {},
): Promise<LlmProviderSpec> => {
  const spec = parseProviderSpec(json)
  registerLlmProvider(compileProviderSpec(spec))

  const origin = String(options.origin ?? '').trim().toLowerCase()
  if (origin) {
    rememberOrigin(spec.id, origin)
    // Held only when the domain sends your key somewhere else — see the
    // module comment. `hold` is one-time and never overrides a participant.
    if (!pointsAtItsOwnOrigin(spec, origin)) llmActivation.hold(spec.id)
  }

  const dir = await pool()
  if (dir) {
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(spec, null, 2)).buffer as ArrayBuffer
      const sig = await SignatureService.sign(bytes)
      const handle = await dir.getFileHandle(sig, { create: true })
      const writable = await handle.createWritable()
      try { await writable.write(bytes) } finally { await writable.close() }
    } catch (err) {
      console.warn(`[provider-discovery] "${spec.id}" registered but not persisted:`, err)
    }
  }
  return spec
}

// ── the domain side: claim `llm:providers` for the probe ───────────────────
//
// One handler, and every domain this participant learns is asked. Nothing in
// the probe knows what a provider is; nothing here knows how a domain was
// learned. `accept` is deliberately the same call a pasted spec makes, so
// there is exactly one path a provider can enter by.
registerPublishedPool({
  meaning: LLM_PROVIDERS_POOL,
  accept: async (record, origin) => (await importProviderSpec(record, { origin })).id,
})

// ── boot: the local pool joins the roster as soon as the store exists ──────
//
// NOT `whenReady` alone. This module is pulled in by `builtin-providers`,
// which `ai-key.drone` imports — the fourth entry in the side-effect barrel,
// evaluated before the web shell has finished installing its own `window.ioc`
// map. A callback parked on the map that is about to be replaced is never
// called, and the symptom is the worst kind: discovered providers work for
// the session that imported them and vanish on reload, which reads as "the
// pool write failed" when the bytes are in fact on disk.
//
// So the sweep WAITS FOR THE STORE ITSELF rather than for a registration on
// one particular ioc instance: a short poll, resolved the moment a Store with
// `getPool` answers, given up after a bounded window so a shell that never
// boots one costs nothing. `whenReady` stays as the fast path when it works.
const SWEEP_POLL_MS = 500
const SWEEP_GIVE_UP_MS = 30_000

let swept = false
const sweepOnce = (): void => {
  if (swept) return
  swept = true
  void sweepProviderPool()
}

const awaitStoreThenSweep = (): void => {
  const started = Date.now()
  const tick = (): void => {
    if (swept) return
    const store = window.ioc?.get?.('@hypercomb.social/Store') as StoreLike | undefined
    if (store?.getPool) { sweepOnce(); return }
    if (Date.now() - started > SWEEP_GIVE_UP_MS) return
    setTimeout(tick, SWEEP_POLL_MS)
  }
  tick()
}

window.ioc?.whenReady?.('@hypercomb.social/Store', () => { sweepOnce() })
awaitStoreThenSweep()
