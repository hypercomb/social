// assistant/context-slices.ts
//
// SLICES — an agent-or-participant-chosen merkle selection whose
// PROJECTION composes from its members' own projections (llm-context.ts).
//
// Jaime, 2026-09-15: "The agent can go and explore, guess what sections of
// data matter, create a merkle-tree layer SLICE and add that to the
// context; those can be interpreted and index themselves, because it's
// infinitely expansible." Split along doctrine, same as everywhere else in
// this system:
//
//   THE SLICE IS TRUTH.  Choosing these members is an ACT — an agent or a
//   participant decided this handful belongs together — so it is a layer,
//   minted by `mintSlice`, content-addressed so the same choice always
//   mints the same sig (same reasoning as context-groups.ts's setSignature:
//   two callers picking the same set land on one file, which is dedup, not
//   a collision).
//
//   THE PROJECTION IS DERIVED.  What the slice SAYS is a pure composition
//   of what its members say (llm-context.ts's `projectLayer`, extended to
//   recognise a slice layer and recurse through `readProjection`). Nothing
//   here mints a projection — that stays the optimize phase's job.
//
// A slice is a LAYER — `{ name, kind: 'context-slice', children: [sorted
// member sigs] }` — canonicalised exactly like any other layer
// (history/canonical-layer.ts) and written the same way any layer's bytes
// are written (`Store.writeLayerBytes`). A slice needs nothing new to
// nest: a member sig may itself name another slice, and that recursion is
// the "infinitely expansible" property Jaime asked for.
//
// REACHABILITY. A layer sig nobody's marker and no pool member names is
// litter to every collector in this system (the same argument backgrounds/
// comfy/layouts pools make for their own truth). `context:slices` is that
// pool: one member PER SLICE, NAMED BY THE SLICE'S OWN LAYER SIG, holding
// `{ kind, name, layerSig }` — a record that exists purely to keep the root
// sig file pinned, not to be read as an index (the layer bytes themselves
// are the truth; this member is the leash on them).
//
// NEVER MINTED FROM THE OPTIMIZE PHASE. `mintSlice` is the one and only
// writer of both the layer bytes and the pool member — no cold client could
// rebuild "these are the chosen members" from layers alone
// (optimize-phase.md's litmus), so nothing here may be called from
// `optimize()`. The drone is asked, afterwards, to pre-mint the slice's
// PROJECTION — that part is a derived cache and belongs there.

import { SignatureService, isSignature } from '@hypercomb/core'
import { canonicalLayerJson, type CanonicalLayerContent } from '../history/canonical-layer.js'

/** The pool. Colon-scoped: see pool-registry.ts's `context:slices` entry —
 *  the bare-word list is frozen and no tile may name this meaning. */
export const SLICES_POOL_MEANING = 'context:slices'

/** The layer `kind` a slice carries — `isSliceLayer` and `projectLayer`
 *  (llm-context.ts) both key off this. */
export const SLICE_KIND = 'context-slice'

const NAME_MAX = 128
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/

const badName = (name: unknown): boolean =>
  typeof name !== 'string' || !name || name.length > NAME_MAX
    || name.includes('/') || name.includes('\\') || CONTROL_CHARACTER.test(name)

type SliceValidation =
  | { readonly ok: true; readonly layer: CanonicalLayerContent }
  | { readonly ok: false; readonly reason: string }

/** One place that decides whether a (name, members) pair is a mintable
 *  slice — `sliceLayer` and `mintSlice` are both thin callers of this, so
 *  the refusal rules can never drift between "would this mint" and "why
 *  didn't it". */
const validateSlice = (name: string, memberSigs: readonly string[]): SliceValidation => {
  if (badName(name)) return { ok: false, reason: 'a slice needs a name with no / or \\, no control characters, 128 characters or fewer' }
  if (!Array.isArray(memberSigs) || memberSigs.length === 0) {
    return { ok: false, reason: 'a slice needs at least one member' }
  }
  const lowered: string[] = []
  for (const raw of memberSigs) {
    if (typeof raw !== 'string' || !isSignature(raw.toLowerCase())) {
      return { ok: false, reason: `not a 64-hex signature: ${String(raw)}` }
    }
    lowered.push(raw.toLowerCase())
  }
  const children = Array.from(new Set(lowered)).sort()
  return { ok: true, layer: { name, kind: SLICE_KIND, children } }
}

/**
 * The canonical layer content for a slice, or null on any refusal (empty
 * set, a non-signature member, or a bad name). Pure — no Store, no IoC, no
 * signing. `mintSlice` is what turns this into bytes on disk.
 */
export const sliceLayer = (name: string, memberSigs: readonly string[]): CanonicalLayerContent | null => {
  const result = validateSlice(name, memberSigs)
  return result.ok ? result.layer : null
}

/** A layer this module recognises as a slice — `llm-context.ts`'s
 *  `projectLayer` asks this before composing through members. */
export const isSliceLayer = (layer: unknown): layer is CanonicalLayerContent & { children: string[] } => {
  if (!layer || typeof layer !== 'object') return false
  const candidate = layer as { kind?: unknown; children?: unknown }
  return candidate.kind === SLICE_KIND && Array.isArray(candidate.children)
}

type PoolLike = {
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<{
    getFile(): Promise<{ text(): Promise<string> }>
    createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>
  }>
}

type StoreLike = {
  writeLayerBytes(signature: string, bytes: ArrayBuffer): Promise<void>
  getPool(meaning: string): Promise<PoolLike | null>
  openPool(meaning: string): Promise<PoolLike | null>
}

const ioc = <T>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

/** Asks the drone to pre-mint this sig's projection — same door
 *  llm-context.ts's own `enqueueMint` uses, kept as a local copy rather
 *  than an import so this module never depends on llm-context.ts's
 *  internals (only the reverse dependency — llm-context.ts calling into
 *  `isSliceLayer` — is meant to exist). */
const enqueueProjection = (sig: string): void => {
  try {
    ioc<{ enqueue?: (sig: string) => void }>('@diamondcoreprocessor.com/LlmContextDrone')?.enqueue?.(sig)
  } catch { /* best-effort — a later read enqueues it again regardless */ }
}

/**
 * Mint a slice: write its canonical layer bytes (by signature, exactly
 * like any other layer) and a `context:slices` pool member naming it —
 * both writes are THIS FUNCTION'S doing, never the optimize phase's.
 * Idempotent: the same name plus the same set of members always produces
 * the same sig, and rewriting identical bytes under an existing name costs
 * nothing but the write.
 */
export const mintSlice = async (
  name: string,
  memberSigs: readonly string[],
): Promise<{ readonly ok: true; readonly sig: string } | { readonly ok: false; readonly reason: string }> => {
  const validation = validateSlice(name, memberSigs)
  if (!validation.ok) return validation

  const store = ioc<StoreLike>('@hypercomb.social/Store')
  if (!store) return { ok: false, reason: 'no store available' }

  const bytes = new TextEncoder().encode(canonicalLayerJson(validation.layer))
  const sig = await SignatureService.sign(bytes.buffer as ArrayBuffer)
  await store.writeLayerBytes(sig, bytes.buffer as ArrayBuffer)

  const pool = await store.getPool(SLICES_POOL_MEANING)
  if (pool) {
    try {
      const handle = await pool.getFileHandle(sig, { create: true })
      const writable = await handle.createWritable()
      try {
        await writable.write(JSON.stringify({ kind: SLICE_KIND, name: validation.layer.name, layerSig: sig }))
      } finally {
        await writable.close()
      }
    } catch { /* the layer bytes are already written; a missing leash costs reachability, not correctness */ }
  }

  enqueueProjection(sig)
  return { ok: true, sig }
}

/** The slices this participant holds — a status line, and the spec's own
 *  proof that the pool member exists. Read-only: opens via `openPool`
 *  (never `create: true`), same async-iteration pattern as `changes.ts`'s
 *  own `listChanges`. */
export const listSlices = async (): Promise<readonly { readonly name: string; readonly layerSig: string }[]> => {
  const store = ioc<StoreLike>('@hypercomb.social/Store')
  const pool = await store?.openPool(SLICES_POOL_MEANING).catch(() => null)
  if (!pool) return []

  const out: { name: string; layerSig: string }[] = []
  try {
    const entries = (pool as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()
    for await (const [, handle] of entries) {
      if (handle.kind !== 'file') continue
      try {
        const file = await (handle as FileSystemFileHandle).getFile()
        const parsed = JSON.parse(await file.text()) as { name?: unknown; layerSig?: unknown }
        if (typeof parsed.name === 'string' && typeof parsed.layerSig === 'string') {
          out.push({ name: parsed.name, layerSig: parsed.layerSig })
        }
      } catch { /* a corrupt member is dropped, never thrown on */ }
    }
  } catch { /* the pool has no entries iterator (a bare Map stub, say) */ }
  return out
}
