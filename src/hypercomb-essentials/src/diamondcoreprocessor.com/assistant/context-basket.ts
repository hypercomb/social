// diamondcoreprocessor.com/assistant/context-basket.ts
//
// THE CONTEXT BASKET — gather signatures while you browse, then ask.
//
// You are on the ask screen, you realise the question needs context, you go
// and find it. So the basket has to survive the trip: navigation, a reload,
// three levels down and back. It is a POOL, not a selection and not a
// component field — the failure this avoids is the one chat replies had all
// day, where state that lived only in memory vanished the moment its surface
// closed.
//
// It holds SIGNATURES, nothing else. That makes it the flat closure root list
// an ask wants — `context: [sig, …]` — with no conversion, and it means
// "add this tile" and "add this whole branch" are the same operation at
// different granularity rather than two features. Duplicates collapse on
// their own, because a set of signatures is a set.
//
// SEPARATE FROM THE PASTE CLIPBOARD, deliberately. Both hold signatures, so
// sharing one bag is tempting and wrong: paste is transient and replaced on
// every copy, context is accumulative across a whole gathering trip. One
// clipboard would mean copying something to paste it silently destroys the
// context you had gathered — a loss you would only notice when the answer
// came back thin.
//
// THE DRAFT LIVES HERE TOO. The question is typed BEFORE the trip and read
// after it; holding it in the ask screen would lose it the moment that screen
// closed to let you navigate, which is the entire flow. Same pool, same
// durability, same reason.

import { EffectBus, isSignature } from '@hypercomb/core'

/** Pool of meaning holding the gathered signatures. Colon-scoped: a bare
 *  `context` would collide with any tile slugged "context", and the root is
 *  an untagged union of lineage bags and pools. */
export const CONTEXT_POOL = 'context:basket'

/** Pool holding the in-flight question. Separate meaning so clearing the
 *  basket never touches the draft and vice versa. */
export const DRAFT_POOL = 'context:draft'

type StoreLike = {
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
  putPoolDoc?: (pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string) => Promise<string | null>
  getPoolDoc?: (pool: FileSystemDirectoryHandle | undefined, subKey?: string) => Promise<ArrayBuffer | null>
}

const store = (): StoreLike | undefined => get<StoreLike>('@hypercomb.social/Store')

/** Every gathered signature, in the order added. Empty when nothing is
 *  gathered — which callers MUST be able to see, because an ask sent with an
 *  empty basket looks identical to one sent with everything. */
export const listContext = async (): Promise<string[]> => {
  const s = store()
  const pool = await s?.getPool?.(CONTEXT_POOL)
  if (!pool || !s?.getPoolDoc) return []
  try {
    const bytes = await s.getPoolDoc(pool)
    if (!bytes) return []
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown
    return Array.isArray(parsed) ? parsed.map(String).filter(isSignature) : []
  } catch { return [] }
}

/** How many signatures are gathered. What the pill shows. */
export const contextCount = async (): Promise<number> => (await listContext()).length

const writeContext = async (sigs: readonly string[]): Promise<boolean> => {
  const s = store()
  const pool = await s?.getPool?.(CONTEXT_POOL)
  if (!pool || !s?.putPoolDoc) return false
  const bytes = new TextEncoder().encode(JSON.stringify(sigs)).buffer as ArrayBuffer
  // putPoolDoc is CORRECT here and wrong for a log: the basket has exactly one
  // current value, so replacing the prior member is the semantics we want.
  const ok = await s.putPoolDoc(pool, bytes)
  if (ok) EffectBus.emit('context:changed', { count: sigs.length })
  return !!ok
}

/** Add signatures. Order-preserving, duplicate-collapsing. Returns how many
 *  were NEW, so a trip that added nothing can say so rather than looking
 *  identical to one that added five. */
export const addContext = async (sigs: readonly string[]): Promise<number> => {
  const incoming = sigs.map(String).filter(isSignature)
  if (incoming.length === 0) return 0

  const current = await listContext()
  const seen = new Set(current)
  const fresh = incoming.filter(s => !seen.has(s))
  if (fresh.length === 0) return 0

  const ok = await writeContext([...current, ...fresh])
  return ok ? fresh.length : 0
}

/** Drop one signature — the basket is edited more often than it is emptied. */
export const removeContext = async (sig: string): Promise<boolean> => {
  const current = await listContext()
  const next = current.filter(s => s !== sig)
  if (next.length === current.length) return false
  return writeContext(next)
}

/** Empty the basket. Does NOT touch the draft. */
export const clearContext = async (): Promise<boolean> => writeContext([])

// ── the draft ────────────────────────────────────────────

/** Hold the question while the participant goes gathering. Written on the way
 *  out, read on the way back. */
export const saveDraft = async (text: string): Promise<boolean> => {
  const s = store()
  const pool = await s?.getPool?.(DRAFT_POOL)
  if (!pool || !s?.putPoolDoc) return false
  const bytes = new TextEncoder().encode(JSON.stringify({ text: String(text ?? ''), at: Date.now() })).buffer as ArrayBuffer
  return !!(await s.putPoolDoc(pool, bytes))
}

/** The held question, or '' when there is none. */
export const readDraft = async (): Promise<string> => {
  const s = store()
  const pool = await s?.getPool?.(DRAFT_POOL)
  if (!pool || !s?.getPoolDoc) return ''
  try {
    const bytes = await s.getPoolDoc(pool)
    if (!bytes) return ''
    const rec = JSON.parse(new TextDecoder().decode(bytes)) as { text?: unknown }
    return typeof rec?.text === 'string' ? rec.text : ''
  } catch { return '' }
}

/** Forget the held question — the ask was sent, or abandoned. */
export const clearDraft = async (): Promise<boolean> => saveDraft('')
