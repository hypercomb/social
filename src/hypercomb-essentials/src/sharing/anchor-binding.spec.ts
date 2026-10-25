// sharing/anchor-binding.spec.ts — which anchor this device publishes for: one
// current document in keys:binding, per participant, NEVER replicated, written
// only by taking an invite (and cleared by taking this place off).

import { afterEach, describe, expect, it, vi } from 'vitest'
import { poolKindOfMeaning } from '@hypercomb/core'
import type { DocumentStoreLike } from '../preferences/participant-document.js'
import { ANCHOR_BINDING_MEANING, AnchorBinding, EMPTY_ANCHOR_BINDING, parseAnchorBinding } from './anchor-binding.js'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const settle = async (): Promise<void> => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)) }
const bytes = (v: unknown): ArrayBuffer => new TextEncoder().encode(JSON.stringify(v)).buffer as ArrayBuffer

/** A store whose pools exist once written, as the real one's do. */
const fake = (seed: Record<string, unknown> = {}) => {
  const docs = new Map<string, ArrayBuffer>(Object.entries(seed).map(([k, v]) => [k, bytes(v)]))
  const pools = new Set<string>(Object.keys(seed).map(k => k.split('|')[0]!))
  const handle = (m: string) => ({ name: m } as unknown as FileSystemDirectoryHandle)
  const store: DocumentStoreLike & { docs: Map<string, ArrayBuffer> } = {
    docs,
    initialize: async () => {},
    openPool: async m => pools.has(m) ? handle(m) : null,
    getPool: async m => { pools.add(m); return handle(m) },
    getPoolDoc: async (pool, subKey) => docs.get(`${pool!.name}|${subKey ?? ''}`) ?? null,
    putPoolDoc: async (pool, b, subKey) => { docs.set(`${pool.name}|${subKey ?? ''}`, b); return 'f'.repeat(64) },
  }
  return store
}

const binding = (store?: DocumentStoreLike) =>
  new AnchorBinding({ whenStore: ready => { if (store) ready(store) } })

afterEach(() => { vi.useRealTimers() })

describe('the record', () => {
  it('reads a binding, and refuses bytes that are not one', () => {
    expect(parseAnchorBinding({ kind: 'anchor-binding@1', anchor: A, sources: ['One.Example', 'one.example', ' two.example '] }))
      .toEqual({ kind: 'anchor-binding@1', anchor: A, sources: ['one.example', 'two.example'] })
    for (const raw of [null, 'x', [], {}, { kind: 'other', anchor: A }]) expect(parseAnchorBinding(raw), JSON.stringify(raw)).toBeNull()
  })

  it('an anchor that is not a key is no anchor, and sources never outlive it', () => {
    expect(parseAnchorBinding({ kind: 'anchor-binding@1', anchor: 'nope', sources: ['one.example'] }))
      .toEqual({ kind: 'anchor-binding@1', anchor: null, sources: [] })
    expect(parseAnchorBinding({ kind: 'anchor-binding@1', anchor: A.toUpperCase(), sources: ['one.example'] })?.anchor).toBeNull()
    const many = parseAnchorBinding({ kind: 'anchor-binding@1', anchor: A, sources: Array.from({ length: 20 }, (_, i) => `h${i}.example`) })
    expect(many?.sources).toHaveLength(8)
  })

  it('is a document that never replicates — a device that merely synced it would publish as the wrong key', () => {
    binding()
    expect(poolKindOfMeaning(ANCHOR_BINDING_MEANING)).toMatchObject({ kind: 'document', replicates: false })
  })
})

describe('the binding', () => {
  it('starts unbound: a device is its own anchor', () => {
    const b = binding()
    expect(b.anchor()).toBeNull()
    expect(b.sources()).toEqual([])
    expect(EMPTY_ANCHOR_BINDING.anchor).toBeNull()
  })

  it('binds, writes through to its one pool, and a new instance reads it back', async () => {
    const store = fake()
    const first = binding(store)
    let changes = 0
    first.addEventListener('change', () => changes++)
    first.bind(A, ['One.Example', 'one.example'])
    expect(first.anchor()).toBe(A)
    expect(first.sources()).toEqual(['one.example'])
    expect(changes).toBe(1)
    await settle()
    expect([...store.docs.keys()]).toEqual([`${ANCHOR_BINDING_MEANING}|`])

    const later = binding(store)
    await settle()
    expect(later.anchor()).toBe(A)
    expect(later.sources()).toEqual(['one.example'])
  })

  it('refuses an anchor that is not a key, and unbinding puts the device back on its own key', async () => {
    const store = fake()
    const b = binding(store)
    b.bind('not a key', ['one.example'])
    expect(b.anchor()).toBeNull()
    b.bind(B, [])
    b.unbind()
    expect(b.anchor()).toBeNull()
    await settle()
    expect(JSON.parse(new TextDecoder().decode(store.docs.get(`${ANCHOR_BINDING_MEANING}|`)!))).toEqual(EMPTY_ANCHOR_BINDING)
  })

  it('a document that arrives from disk is announced', async () => {
    const store = fake({ [`${ANCHOR_BINDING_MEANING}|`]: { kind: 'anchor-binding@1', anchor: B, sources: ['one.example'] } })
    const b = binding(store)
    let changes = 0
    b.addEventListener('change', () => changes++)
    await settle()
    expect(b.anchor()).toBe(B)
    expect(changes).toBe(1)
  })
})

describe('ready', () => {
  it('resolves once the pool has been read', async () => {
    const b = binding(fake())
    await b.ready()
    expect(b.anchor()).toBeNull()
  })

  it('resolves after a moment when no store ever comes, so a publish at boot does not wait forever', async () => {
    vi.useFakeTimers()
    const b = binding()
    let done = false
    void b.ready().then(() => { done = true })
    await vi.advanceTimersByTimeAsync(2999)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    expect(done).toBe(true)
    // It has given up: the next reader is not made to wait the same moment again.
    let again = false
    void b.ready().then(() => { again = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(again).toBe(true)
  })
})
