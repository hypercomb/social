import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { PassiveReplicationQueue } from './passive-replication-queue.js'

const signature = 'a'.repeat(64)
const intent = { domain: 'backup.test', signature, sources: ['https://source.test'] }

class MemoryStorage {
  value: string | null = null
  reads = 0
  getItem(): string | null { this.reads++; return this.value }
  setItem(_key: string, value: string): void { this.value = value }
}

class ManualIdle {
  callbacks = new Map<number, () => void>()
  next = 1
  request(callback: () => void): number { const id = this.next++; this.callbacks.set(id, callback); return id }
  cancel(handle: number): void { this.callbacks.delete(handle) }
  fire(): void { const callbacks = [...this.callbacks.values()]; this.callbacks.clear(); callbacks.forEach(callback => callback()) }
}

const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

function fixture(storage = new MemoryStorage()) {
  const idle = new ManualIdle()
  const replication = {
    status: vi.fn(async (): Promise<any> => null),
    replicate: vi.fn(async () => true),
    refreshReceipts: vi.fn(async (): Promise<any> => null),
    verify: vi.fn(async () => false),
  }
  const currentGenome = vi.fn(async () => ({ ...intent, inventory: true }))
  const queue = new PassiveReplicationQueue({ replication: replication as never, storage, idle, currentGenome })
  return { queue, storage, idle, replication, currentGenome }
}

beforeEach(() => EffectBus.clear())

describe('passive durable replication', () => {
  it('does zero startup storage, genome, and network work', () => {
    const f = fixture()
    f.queue.start()
    expect(f.storage.reads).toBe(0)
    expect(f.currentGenome).not.toHaveBeenCalled()
    expect(f.replication.status).not.toHaveBeenCalled()
    expect(f.replication.replicate).not.toHaveBeenCalled()
  })

  it('coalesces durable changes before one ready+idle dispatch', async () => {
    const f = fixture()
    f.queue.enqueueCurrentGenome()
    f.queue.enqueueCurrentGenome()
    f.queue.enqueueCurrentGenome()
    expect(f.currentGenome).not.toHaveBeenCalled()
    f.queue.markReady()
    expect(f.currentGenome).not.toHaveBeenCalled()
    f.idle.fire()
    await settle()
    expect(f.currentGenome).toHaveBeenCalledTimes(1)
    expect(f.replication.replicate).toHaveBeenCalledTimes(1)
  })

  it('survives refresh and remains dormant until ready and idle', async () => {
    const storage = new MemoryStorage()
    fixture(storage).queue.enqueueSignature(intent)
    const resumed = fixture(storage)
    expect(resumed.replication.status).not.toHaveBeenCalled()
    resumed.queue.markReady()
    expect(resumed.replication.status).not.toHaveBeenCalled()
    resumed.idle.fire()
    await settle()
    expect(resumed.replication.status).toHaveBeenCalledWith(intent.domain, signature, expect.any(AbortSignal))
  })

  it('removes an intent only after complete status, receipt, and HEAD proof', async () => {
    const f = fixture()
    f.queue.enqueueSignature(intent)
    f.replication.status.mockResolvedValue({ state: 'complete', signature, holes: [], refused: [], limited: false })
    f.replication.refreshReceipts.mockResolvedValue({ version: 1, revision: 1, updatedAt: '', signatures: [] })
    f.queue.markReady(); f.idle.fire(); await settle()
    expect(f.queue.pending().signatures).toHaveLength(1)

    f.replication.refreshReceipts.mockResolvedValue({ version: 1, revision: 2, updatedAt: '', signatures: [signature] })
    f.replication.verify.mockResolvedValue(true)
    f.queue.resume(); f.idle.fire(); await settle()
    expect(f.queue.pending().signatures).toHaveLength(0)
  })
})
