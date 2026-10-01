// assistant/model-requests.ts
//
// THE WORK ASKS FOR A STRONGER MODEL (documentation/agent-harness.md §11).
// The everyday questions go to the cheap models, and they should: that is
// where the value is. The balance is kept by the hand-off — a model that
// meets work beyond it says so (`hypercomb-handoff`) and the turn goes up to
// a deeper one. When NO model switched on can take it, that is not a dead
// end to apologise for; it is a REQUEST. It is filed here, one sig-named
// record in the pool `agent:model-requests`, so the participant sees what
// the work asked for and answers it by putting a model on the list
// (`models add <id> deep`) — a line that takes only the work handed up to it.
//
// A request is a fact about a turn that already happened, keyed by its own
// content; nothing reads it on a load path. The bee (chat.drone) starts the
// ledger.

import {
  declarePoolKind, EffectBus, SignatureService, get, isSignature,
  AGENT_MODEL_REQUEST, type AgentModelRequestEvent,
} from '@hypercomb/core'

export const MODEL_REQUESTS_POOL = 'agent:model-requests'
declarePoolKind(MODEL_REQUESTS_POOL, 'set')

export type ModelRequestRecord = {
  readonly kind: 'model-request@1'
  readonly convoId: string
  readonly at: number
  /** The model that handed the work off. */
  readonly from: string
  /** What it said the work needs. */
  readonly needs: string
  readonly tier: string
  /** The harness the turn ran under; '' when none was said. */
  readonly harness: string
}

export const modelRequestRecord = (event: Partial<AgentModelRequestEvent>): ModelRequestRecord => ({
  kind: 'model-request@1',
  convoId: String(event.convoId ?? ''),
  at: Number(event.at) || 0,
  from: String(event.from ?? '').slice(0, 200),
  needs: String(event.needs ?? '').replace(/\s+/g, ' ').trim().slice(0, 300),
  tier: String(event.tier ?? 'deep'),
  harness: String(event.harness ?? ''),
})

export const parseModelRequest = (json: unknown): ModelRequestRecord | null => {
  try {
    const raw = (typeof json === 'string' ? JSON.parse(json) : json) as Record<string, unknown> | null
    if (!raw || raw['kind'] !== 'model-request@1') return null
    return modelRequestRecord(raw as Partial<AgentModelRequestEvent>)
  } catch { return null }
}

type FileLike = { readonly size: number; text(): Promise<string> }
type WritableLike = { write(chunk: ArrayBuffer): Promise<void>; close(): Promise<void> }
type FileHandleLike = { readonly kind: string; getFile?(): Promise<FileLike>; createWritable?(): Promise<WritableLike> }
type DirLike = {
  entries(): AsyncIterable<readonly [string, FileHandleLike]>
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>
}
type StoreLike = { getPool?: (meaning: string) => Promise<DirLike | null | undefined> }

const pool = async (resolve: () => StoreLike | undefined): Promise<DirLike | null> => {
  const store = resolve()
  if (!store?.getPool) return null
  try { return (await store.getPool(MODEL_REQUESTS_POOL)) ?? null } catch { return null }
}

const defaultStore = (): StoreLike | undefined => get<StoreLike>('@hypercomb.social/Store')

/** File one request: content-addressed, so the same one twice is one record. */
export const writeModelRequest = async (record: ModelRequestRecord, resolve: () => StoreLike | undefined = defaultStore): Promise<string> => {
  const bytes = new TextEncoder().encode(JSON.stringify(record)).buffer as ArrayBuffer
  const sig = await SignatureService.sign(bytes)
  const dir = await pool(resolve)
  if (!dir) return sig
  try {
    let present = false
    try { present = !!(await dir.getFileHandle(sig)) } catch { present = false }
    if (!present) {
      const handle = await dir.getFileHandle(sig, { create: true })
      const writable = await handle.createWritable?.()
      if (writable) { try { await writable.write(bytes) } finally { await writable.close() } }
    }
  } catch (error) {
    console.warn('[model-requests] a request was not filed:', error)
  }
  return sig
}

/** Every request the pool holds, newest first. */
export const listModelRequests = async (resolve: () => StoreLike | undefined = defaultStore): Promise<ModelRequestRecord[]> => {
  const dir = await pool(resolve)
  if (!dir) return []
  const out: ModelRequestRecord[] = []
  try {
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'file' || !isSignature(name) || !handle.getFile) continue
      try {
        const file = await handle.getFile()
        if (!file.size) continue
        const record = parseModelRequest(await file.text())
        if (record) out.push(record)
      } catch { /* one unreadable request hides nothing else */ }
    }
  } catch { /* pool unreadable — nothing to list */ }
  return out.sort((a, b) => b.at - a.at)
}

let stop: (() => void) | null = null

/** File what the bus says — the bee wires it (chat.drone). The value the bus
 *  replays to a late subscriber is a request already filed, and filing is
 *  idempotent, so the replay costs nothing. */
export const startModelRequestLedger = (resolve: () => StoreLike | undefined = defaultStore): void => {
  if (stop) return
  stop = EffectBus.on<AgentModelRequestEvent>(AGENT_MODEL_REQUEST, event => {
    if (!event || !event.needs) return
    void writeModelRequest(modelRequestRecord(event), resolve)
  })
}

export const stopModelRequestLedger = (): void => { stop?.(); stop = null }
