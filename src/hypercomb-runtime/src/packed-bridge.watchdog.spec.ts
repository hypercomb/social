// The packed-store bridge's watchdog: a worker that stops answering while
// calls wait on it is terminated, every waiting call is released, and a fresh
// worker reopens the pack (packed-bridge.ts, 2026-11-12).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PACKED_LONG_SILENCE_MS, PACKED_SILENCE_MS, PackedBridge } from './packed-bridge'

type Sent = { id: number; cmd: string }

/** A worker that answers only when told to. */
class FakeWorker extends EventTarget {
  sent: Sent[] = []
  terminated = false
  postMessage(message: Sent): void { this.sent.push({ id: message.id, cmd: message.cmd }) }
  terminate(): void { this.terminated = true }
  answer(id: number, result: unknown = null, ok = true): void {
    const data = ok ? { id, ok, result } : { id, ok, error: { kind: 'Busy', message: 'held' } }
    this.dispatchEvent(new MessageEvent('message', { data }))
  }
  answerAll(): void { for (const { id } of this.sent.splice(0)) this.answer(id) }
}

const config = { legacyContentDirs: [], legacyBagParents: [], emptyContentSig: '' }

describe('PackedBridge watchdog', () => {
  let workers: FakeWorker[]
  const spawn = (): Worker => { const w = new FakeWorker(); workers.push(w); return w as unknown as Worker }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    workers = []
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('leaves a worker alone while it keeps answering, however long the backlog', async () => {
    const bridge = new PackedBridge(spawn(), { spawn, config })
    const first = workers[0]
    for (let second = 0; second < 30; second++) {
      void bridge.invoke('dir_get_raw', { sig: 'a', name: String(second) })
      vi.advanceTimersByTime(PACKED_SILENCE_MS / 2)
      first.answerAll()
    }
    expect(first.terminated).toBe(false)
    expect(bridge.restarts).toBe(0)
  })

  it('never fires with nothing waiting, however quiet the worker is', () => {
    const bridge = new PackedBridge(spawn(), { spawn, config })
    vi.advanceTimersByTime(PACKED_SILENCE_MS * 10)
    void bridge.invoke('pack_stats')
    vi.advanceTimersByTime(PACKED_SILENCE_MS - 2_000)
    expect(workers[0].terminated).toBe(false)
  })

  it('restarts a silent worker, releases every waiting call, and reopens the pack', async () => {
    const bridge = new PackedBridge(spawn(), { spawn, config })
    const stuck = workers[0]
    const reads = [bridge.invoke('dir_get_raw', { sig: 'a', name: 'x' }), bridge.invoke('content_get_raw', { sig: 'b' })]
    const settled = reads.map(read => read.then(() => 'resolved', (error: { kind?: string }) => error.kind))

    vi.advanceTimersByTime(PACKED_SILENCE_MS + 1_000)

    expect(stuck.terminated).toBe(true)
    expect(await Promise.all(settled)).toEqual(['Restarted', 'Restarted'])
    expect(bridge.restarts).toBe(1)
    const fresh = workers[1]
    expect(fresh.sent.map(m => m.cmd)).toEqual(['pack_open'])

    // Calls made after the restart go to the fresh worker, behind the open.
    const after = bridge.invoke('content_has', { sig: 'c' })
    expect(fresh.sent.map(m => m.cmd)).toEqual(['pack_open', 'content_has'])
    fresh.answerAll()
    await expect(after).resolves.toBeNull()
  })

  it('ignores a late answer from the worker it replaced', async () => {
    const bridge = new PackedBridge(spawn(), { spawn, config })
    const stuck = workers[0]
    const read = bridge.invoke('dir_get_raw', { sig: 'a', name: 'x' }).catch(() => 'released')
    vi.advanceTimersByTime(PACKED_SILENCE_MS + 1_000)
    expect(await read).toBe('released')
    const next = bridge.invoke('content_has', { sig: 'c' })
    const nextId = workers[1].sent[1].id
    stuck.answer(nextId, 'stale')          // the dead worker reuses no id we wait on
    workers[1].answer(workers[1].sent[0].id)
    workers[1].answer(nextId, true)
    await expect(next).resolves.toBe(true)
  })

  it('gives a command meant to take long the longer allowance', () => {
    const bridge = new PackedBridge(spawn(), { spawn, config })
    void bridge.invoke('pack_compact').catch(() => {})
    vi.advanceTimersByTime(PACKED_SILENCE_MS * 3)
    expect(workers[0].terminated).toBe(false)
    vi.advanceTimersByTime(PACKED_LONG_SILENCE_MS)
    expect(workers[0].terminated).toBe(true)
  })

  it('tries the open again when the old lock is still held, then serves', async () => {
    const bridge = new PackedBridge(spawn(), { spawn, config })
    void bridge.invoke('dir_get_raw', { sig: 'a', name: 'x' }).catch(() => {})
    vi.advanceTimersByTime(PACKED_SILENCE_MS + 1_000)
    const refused = workers[1]
    refused.answer(refused.sent[0].id, null, false)   // Busy: the old handle lingers
    await vi.advanceTimersByTimeAsync(0)
    expect(refused.terminated).toBe(true)
    await vi.advanceTimersByTimeAsync(600)
    const opened = workers[2]
    expect(opened.sent.map(m => m.cmd)).toEqual(['pack_open'])
    const read = bridge.invoke('content_has', { sig: 'c' })
    opened.answerAll()
    await expect(read).resolves.toBeNull()
  })

  it('without a way to reopen, still releases the waiting calls and then fails fast', async () => {
    const bridge = new PackedBridge(spawn(), null)
    const read = bridge.invoke('dir_get_raw', { sig: 'a', name: 'x' }).catch((error: { kind?: string }) => error.kind)
    vi.advanceTimersByTime(PACKED_SILENCE_MS + 1_000)
    expect(await read).toBe('Restarted')
    await expect(bridge.invoke('content_has', { sig: 'c' })).rejects.toMatchObject({ kind: 'Terminated' })
  })
})
