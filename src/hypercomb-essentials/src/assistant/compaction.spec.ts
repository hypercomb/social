import { describe, expect, it, vi } from 'vitest'
import type { CompactionDeps } from './compaction.js'

// The module registers itself in IoC at load (as every essentials service
// does); this spec exercises the pure `summarize` and needs no live map.
const g = globalThis as { window?: { ioc?: unknown } }
g.window ??= {}
g.window.ioc ??= { register: () => {}, get: () => undefined, whenReady: () => {} }
const { summarize, summaryKey } = await import('./compaction.js')

const sig = (n: number): string => n.toString(16).padStart(64, '0')

/** An in-memory pool: one file per key, the way the real one is used. */
const memoryPool = () => {
  const files = new Map<string, string>()
  const handle = {
    getFileHandle: async (key: string, options?: { create?: boolean }) => {
      if (!files.has(key) && !options?.create) throw new DOMException('no', 'NotFoundError')
      return {
        getFile: async () => ({ text: async () => files.get(key) ?? '' }),
        createWritable: async () => ({
          write: async (data: string | Blob) => { files.set(key, typeof data === 'string' ? data : await data.text()) },
          close: async () => {},
        }),
      }
    },
  } as unknown as FileSystemDirectoryHandle
  return { handle, files }
}

const deps = (over: Partial<CompactionDeps> = {}, pool = memoryPool()): { deps: CompactionDeps; files: Map<string, string> } => ({
  files: pool.files,
  deps: {
    pool: async () => pool.handle,
    anatomySig: async () => sig(9),
    candidates: () => [{ id: 'openrouter', defaultModel: 'deepseek/deepseek-v4-flash-0731' }, { id: 'local', defaultModel: 'qwen3:8b' }],
    mayRead: () => false,
    call: vi.fn(async () => ({ text: 'Three projects, one overdue.', model: 'qwen3:8b-q4', stopReason: 'end', inputTokens: 1, outputTokens: 1 })),
    ...over,
  },
})

describe('compaction — a tile summary as a derived cache', () => {
  it('keys a summary by input, anatomy and model, so any change is a miss', async () => {
    const a = await summaryKey(sig(1), sig(9), 'm')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(await summaryKey(sig(2), sig(9), 'm')).not.toBe(a)
    expect(await summaryKey(sig(1), sig(8), 'm')).not.toBe(a)
    expect(await summaryKey(sig(1), sig(9), 'n')).not.toBe(a)
    expect(await summaryKey(sig(1), sig(9), 'm')).toBe(a)
  })

  it('mints once through the first admitted summariser, then serves the record from the pool', async () => {
    const fx = deps()
    const content = vi.fn(async () => '{"name":"projects"}')
    const first = await summarize(sig(1), content, fx.deps)
    expect(first).toMatchObject({ ok: true, minted: true, record: { providerId: 'local', text: 'Three projects, one overdue.' } })
    // the ungranted keyed provider ranked first was skipped; local wrote it
    expect(fx.deps.call).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'local' }))
    expect(fx.files.size).toBe(1)

    const second = await summarize(sig(1), content, fx.deps)
    expect(second).toMatchObject({ ok: true, minted: false })
    expect(fx.deps.call).toHaveBeenCalledTimes(1)
    expect(content).toHaveBeenCalledTimes(1)
  })

  it('refuses honestly when no candidate may read the hive, and never falls back to a vendor', async () => {
    const fx = deps({ candidates: () => [{ id: 'openrouter', defaultModel: 'x' }] })
    expect(await summarize(sig(1), async () => 'body', fx.deps)).toEqual({ ok: false, code: 'no-summariser' })
    expect(fx.deps.call).not.toHaveBeenCalled()
    const granted = deps({ candidates: () => [{ id: 'openrouter', defaultModel: 'x' }], mayRead: id => id === 'openrouter' })
    expect(await summarize(sig(1), async () => 'body', granted.deps)).toMatchObject({ ok: true, record: { providerId: 'openrouter' } })
  })

  it('is unavailable without a pool or an anatomy, and failed on an empty answer', async () => {
    expect(await summarize(sig(1), async () => 'body', deps({ pool: async () => null }).deps)).toEqual({ ok: false, code: 'unavailable' })
    expect(await summarize(sig(1), async () => 'body', deps({ anatomySig: async () => undefined }).deps)).toEqual({ ok: false, code: 'unavailable' })
    const empty = deps({ call: vi.fn(async () => ({ text: '  ', model: 'm', stopReason: 'end', inputTokens: 0, outputTokens: 0 })) })
    expect(await summarize(sig(1), async () => 'body', empty.deps)).toEqual({ ok: false, code: 'failed' })
    expect(empty.files.size).toBe(0)
  })
})
