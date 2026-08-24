// diamondcoreprocessor.com/assistant/providers/provider-discovery.ts
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
// Domain discovery composes on top: adopting a domain that publishes specs
// lands them as pool members here, and the sweep picks them up. The spec is
// public content; the KEY the participant later pastes is device-local truth
// (llm-keys.ts) — the two never travel together.

import { SignatureService, isSignature } from '@hypercomb/core'
import { registerLlmProvider } from '../llm-provider-registry.js'
import { compileProviderSpec, parseProviderSpec, type LlmProviderSpec } from './provider-spec.js'

/** The pool's meaning. Colon-carrying, per doctrine — never a bare word. */
export const LLM_PROVIDERS_POOL = 'llm:providers'

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
export const importProviderSpec = async (json: unknown): Promise<LlmProviderSpec> => {
  const spec = parseProviderSpec(json)
  registerLlmProvider(compileProviderSpec(spec))

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
