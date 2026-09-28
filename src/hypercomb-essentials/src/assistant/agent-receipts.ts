// assistant/agent-receipts.ts
//
// THE RECEIPTS ARE THE EVAL (documentation/agent-harness.md §7, step 6).
// Every turn ends with an `agent:receipt` on the bus — how it went and what
// it cost, and from step 6 which harness it ran under. This module keeps
// those receipts in a pool of meaning, `agent:receipts`, one sig-named
// record each, and reads them back grouped by harness: runs, how many
// answered, rounds and tokens and seconds to an answer, hand-offs. That is
// how a harness earns adoption — by its receipts, not its description — and
// `harness compare` is the word that reads them.
//
// A receipt is a pure derivation of a turn that already happened, keyed by
// its own content; nothing reads it on a load path, so a wiped pool costs
// nothing but the comparison. The bee (chat.drone) starts the ledger.

import { declarePoolKind, EffectBus, SignatureService, get, isSignature, AGENT_RECEIPT, type AgentReceiptEvent } from '@hypercomb/core'

export const RECEIPTS_POOL = 'agent:receipts'
declarePoolKind(RECEIPTS_POOL, 'set')

export type AgentReceiptRecord = {
  readonly kind: 'agent-receipt@1'
  /** The harness the turn ran under; '' when an older shell said none. */
  readonly harness: string
  readonly convoId: string
  readonly at: number
  readonly leg: number
  readonly path: string
  readonly rounds: number
  readonly weight: string
  readonly ms: number
  readonly firstMs?: number
  readonly outcome: 'answered' | 'failed' | 'stopped'
  readonly spent: { readonly rounds: number; readonly tokens: number }
}

export const receiptRecord = (event: AgentReceiptEvent): AgentReceiptRecord => ({
  kind: 'agent-receipt@1',
  harness: String(event.harness ?? ''),
  convoId: String(event.convoId ?? ''),
  at: Number(event.at) || 0,
  leg: Number(event.leg) || 1,
  path: String(event.path ?? ''),
  rounds: Number(event.rounds) || 0,
  weight: String(event.weight ?? ''),
  ms: Number(event.ms) || 0,
  ...(event.firstMs !== undefined ? { firstMs: Number(event.firstMs) || 0 } : {}),
  outcome: event.outcome === 'failed' || event.outcome === 'stopped' ? event.outcome : 'answered',
  spent: { rounds: Number(event.spent?.rounds) || 0, tokens: Number(event.spent?.tokens) || 0 },
})

export const parseReceipt = (json: unknown): AgentReceiptRecord | null => {
  try {
    const raw = (typeof json === 'string' ? JSON.parse(json) : json) as Record<string, unknown> | null
    if (!raw || raw['kind'] !== 'agent-receipt@1') return null
    return receiptRecord(raw as unknown as AgentReceiptEvent)
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
  try { return (await store.getPool(RECEIPTS_POOL)) ?? null } catch { return null }
}

const defaultStore = (): StoreLike | undefined => get<StoreLike>('@hypercomb.social/Store')

/** File one receipt: content-addressed, so the same turn twice is one record. */
export const writeReceipt = async (record: AgentReceiptRecord, resolve: () => StoreLike | undefined = defaultStore): Promise<string> => {
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
    console.warn('[agent-receipts] a receipt was not filed:', error)
  }
  return sig
}

/** Every receipt the pool holds, oldest first. */
export const listReceipts = async (resolve: () => StoreLike | undefined = defaultStore): Promise<AgentReceiptRecord[]> => {
  const dir = await pool(resolve)
  if (!dir) return []
  const out: AgentReceiptRecord[] = []
  try {
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'file' || !isSignature(name) || !handle.getFile) continue
      try {
        const file = await handle.getFile()
        if (!file.size) continue
        const record = parseReceipt(await file.text())
        if (record) out.push(record)
      } catch { /* one unreadable receipt hides nothing else */ }
    }
  } catch { /* pool unreadable — nothing to compare */ }
  return out.sort((a, b) => a.at - b.at)
}

export type HarnessStanding = {
  readonly harness: string
  readonly runs: number
  readonly answered: number
  readonly failed: number
  readonly stopped: number
  /** Means over ANSWERED turns; 0 when none answered. */
  readonly rounds: number
  readonly tokens: number
  readonly seconds: number
  readonly legs: number
  readonly lastAt: number
}

/** Receipts grouped by harness — the comparison `harness compare` reads. */
export const summarizeReceipts = (records: readonly AgentReceiptRecord[]): HarnessStanding[] => {
  const by = new Map<string, AgentReceiptRecord[]>()
  for (const record of records) {
    const list = by.get(record.harness) ?? []
    list.push(record)
    by.set(record.harness, list)
  }
  const mean = (list: readonly AgentReceiptRecord[], of: (r: AgentReceiptRecord) => number): number =>
    list.length ? Math.round((list.reduce((sum, r) => sum + of(r), 0) / list.length) * 10) / 10 : 0
  return [...by].map(([harness, list]) => {
    const answered = list.filter(r => r.outcome === 'answered')
    return {
      harness,
      runs: list.length,
      answered: answered.length,
      failed: list.filter(r => r.outcome === 'failed').length,
      stopped: list.filter(r => r.outcome === 'stopped').length,
      rounds: mean(answered, r => r.spent.rounds || r.rounds),
      tokens: mean(answered, r => r.spent.tokens),
      seconds: mean(answered, r => r.ms / 1000),
      legs: mean(answered, r => r.leg),
      lastAt: Math.max(...list.map(r => r.at)),
    }
  }).sort((a, b) => b.lastAt - a.lastAt)
}

/** The ledger: every receipt on the bus is filed. Started by the bee. */
let listening: (() => void) | null = null
export const startReceiptLedger = (resolve: () => StoreLike | undefined = defaultStore): void => {
  if (listening) return
  listening = EffectBus.on<AgentReceiptEvent>(AGENT_RECEIPT, event => {
    if (!event?.convoId) return
    void writeReceipt(receiptRecord(event), resolve)
  })
}
export const stopReceiptLedger = (): void => { listening?.(); listening = null }
