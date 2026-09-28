import { afterEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import {
  RECEIPTS_POOL, listReceipts, receiptRecord, startReceiptLedger, stopReceiptLedger, summarizeReceipts, writeReceipt,
  type AgentReceiptRecord,
} from './agent-receipts.js'

const memoryDir = () => {
  const files = new Map<string, ArrayBuffer>()
  const fileHandle = (name: string) => ({
    kind: 'file' as const,
    getFile: async () => {
      const bytes = files.get(name)
      if (!bytes) throw new DOMException('gone', 'NotFoundError')
      return { size: bytes.byteLength, text: async () => new TextDecoder().decode(bytes) }
    },
    createWritable: async () => {
      let staged: ArrayBuffer = new ArrayBuffer(0)
      return { write: async (chunk: ArrayBuffer) => { staged = chunk }, close: async () => { files.set(name, staged) } }
    },
  })
  return {
    files,
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      if (!files.has(name)) {
        if (!options?.create) throw new DOMException('missing', 'NotFoundError')
        files.set(name, new ArrayBuffer(0))
      }
      return fileHandle(name)
    },
    entries: async function* () { for (const name of [...files.keys()]) yield [name, fileHandle(name)] as const },
  }
}

const withPool = () => {
  const dir = memoryDir()
  const resolve = () => ({ getPool: async (meaning: string) => (meaning === RECEIPTS_POOL ? dir : null) })
  return { dir, resolve }
}

const receipt = (over: Partial<AgentReceiptRecord> = {}): AgentReceiptRecord => ({
  kind: 'agent-receipt@1', harness: 'a'.repeat(64), convoId: 'chat:x', at: 1_000, leg: 1, path: 'judged',
  rounds: 3, weight: 'balanced', ms: 4_000, outcome: 'answered', spent: { rounds: 3, tokens: 12_000 }, ...over,
})

afterEach(() => { stopReceiptLedger() })

describe('the receipts pool', () => {
  it('files a receipt once by its content, and reads them back oldest first', async () => {
    const { dir, resolve } = withPool()
    const sig = await writeReceipt(receipt({ at: 2_000 }), resolve)
    await writeReceipt(receipt({ at: 2_000 }), resolve)
    await writeReceipt(receipt({ at: 1_000, outcome: 'failed' }), resolve)
    expect(dir.files.size).toBe(2)
    expect(dir.files.has(sig)).toBe(true)
    const listed = await listReceipts(resolve)
    expect(listed.map(r => [r.at, r.outcome])).toEqual([[1_000, 'failed'], [2_000, 'answered']])
  })

  it('the ledger files what the bus says, with the harness the turn ran under', async () => {
    const { dir, resolve } = withPool()
    startReceiptLedger(resolve)
    EffectBus.emit('agent:receipt', { id: 'chat:y', convoId: 'chat:y', leg: 2, at: 5_000, harness: 'b'.repeat(64), path: 'direct', rounds: 1, weight: 'fast', ms: 800, outcome: 'answered', spent: { rounds: 1, tokens: 900 } })
    await new Promise(resolveTick => setTimeout(resolveTick, 20))
    const [filed] = await listReceipts(resolve)
    expect(dir.files.size).toBe(1)
    expect(filed).toMatchObject({ harness: 'b'.repeat(64), convoId: 'chat:y', leg: 2, outcome: 'answered', spent: { tokens: 900 } })
  })

  it('a receipt off the bus keeps only what a receipt is', () => {
    const record = receiptRecord({ id: 'i', convoId: 'c', leg: 1, at: 1, path: 'off', rounds: 2, weight: 'deep', ms: 10, outcome: 'stopped', spent: { rounds: 2, tokens: 3 } })
    expect(record).toEqual({ kind: 'agent-receipt@1', harness: '', convoId: 'c', at: 1, leg: 1, path: 'off', rounds: 2, weight: 'deep', ms: 10, outcome: 'stopped', spent: { rounds: 2, tokens: 3 } })
  })
})

describe('the comparison', () => {
  it('groups receipts by harness and averages over answered turns only', () => {
    const quiet = 'q'.repeat(64)
    const standings = summarizeReceipts([
      receipt({ at: 1, spent: { rounds: 4, tokens: 10_000 }, ms: 2_000 }),
      receipt({ at: 2, spent: { rounds: 2, tokens: 6_000 }, ms: 1_000, leg: 3 }),
      receipt({ at: 3, outcome: 'failed', spent: { rounds: 40, tokens: 999_999 } }),
      receipt({ at: 9, harness: quiet, spent: { rounds: 1, tokens: 1_000 }, ms: 500 }),
    ])
    expect(standings.map(s => s.harness)).toEqual([quiet, 'a'.repeat(64)])
    expect(standings[1]).toMatchObject({ runs: 3, answered: 2, failed: 1, stopped: 0, rounds: 3, tokens: 8_000, seconds: 1.5, legs: 2 })
    expect(standings[0]).toMatchObject({ runs: 1, answered: 1, rounds: 1, tokens: 1_000, seconds: 0.5 })
  })
})
