// entry-nonce-store.spec.ts — the nonces of the entry pools this device
// opened (documentation/open-entry-pools.md): kept by the pool's index name,
// never handed out at a sandbox door, never on an event, and found in bytes
// that are about to enter a pool.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const door = vi.hoisted(() => ({ open: false }))
vi.mock('./sandbox-door.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./sandbox-door.js')>()),
  isSandboxDoor: () => door.open,
}))

const {
  ENTRY_NONCE_STORE_IOC_KEY,
  EntryNonceStore,
  entryNonceStorageKey,
  entryNonceStore,
} = await import('./llm-keys.js')
const { get } = await import('../ioc/ioc.js')

const H = 'ab'.repeat(32)
const H2 = 'cd'.repeat(32)
const NONCE = '0123456789abcdef'.repeat(2)
const NONCE2 = 'fedcba9876543210'.repeat(2)

/** Everything this origin's storage holds, as one string. */
const everythingStored = (): string => {
  const out: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i) ?? ''
    out.push(key, localStorage.getItem(key) ?? '')
  }
  return out.join('\n')
}

const changes = (store: EventTarget): Event[] => {
  const seen: Event[] = []
  store.addEventListener('change', event => { seen.push(event) })
  return seen
}

beforeEach(() => {
  localStorage.clear()
  door.open = false
})

describe('the storage key', () => {
  it('is hc:entries:<H>:nonce, one key a pool', () => {
    expect(entryNonceStorageKey(H)).toBe(`hc:entries:${H}:nonce`)
    expect(entryNonceStorageKey(` ${H.toUpperCase()} `)).toBe(`hc:entries:${H}:nonce`)
  })
})

describe('get, set and drop', () => {
  it('holds a nonce under its pool, in storage and in memory', () => {
    const store = new EntryNonceStore()
    expect(store.get(H)).toBe('')
    expect(store.set(H, NONCE)).toBe(true)
    expect(store.get(H)).toBe(NONCE)
    expect(localStorage.getItem(entryNonceStorageKey(H))).toBe(NONCE)
    expect(store.get(H2)).toBe('')
    // A second instance (another tab, a reload) reads what was kept.
    expect(new EntryNonceStore().get(H)).toBe(NONCE)
  })

  it('folds case and trims, because the parts come from the hive\'s own records', () => {
    const store = new EntryNonceStore()
    expect(store.set(H.toUpperCase(), ` ${NONCE.toUpperCase()} `)).toBe(true)
    expect(store.get(H)).toBe(NONCE)
  })

  it('refuses a pool name or a nonce that is not the hex it must be, and keeps nothing', () => {
    const store = new EntryNonceStore()
    for (const [pool, nonce] of [
      [H.slice(1), NONCE], [`${H}0`, NONCE], ['zz'.repeat(32), NONCE],
      [H, NONCE.slice(1)], [H, `${NONCE}0`], [H, 'zz'.repeat(16)], [H, ''], ['', NONCE],
    ]) expect(store.set(pool, nonce), `${pool} / ${nonce}`).toBe(false)
    expect(localStorage.length).toBe(0)
    expect(store.get(H)).toBe('')
  })

  it('drop forgets the nonce for good, in memory and in storage', () => {
    const store = new EntryNonceStore()
    store.set(H, NONCE)
    store.set(H2, NONCE2)
    store.drop(H)
    expect(store.get(H)).toBe('')
    expect(localStorage.getItem(entryNonceStorageKey(H))).toBeNull()
    expect(store.get(H2)).toBe(NONCE2)
    expect(new EntryNonceStore().get(H)).toBe('')
  })

  it('reads only well-formed rows of its own back from storage', () => {
    localStorage.setItem(entryNonceStorageKey(H), NONCE)
    localStorage.setItem(entryNonceStorageKey(H2), 'not a nonce')
    localStorage.setItem(`hc:entries:short:nonce`, NONCE)
    localStorage.setItem('hc:something-else', NONCE2)
    const store = new EntryNonceStore()
    expect(store.get(H)).toBe(NONCE)
    expect(store.get(H2)).toBe('')
    expect(store.carriedBy(NONCE2)).toBe('')
  })
})

describe('a sandbox door holds nothing', () => {
  it('set keeps nothing and get answers empty, even for a nonce held before', () => {
    const store = new EntryNonceStore()
    store.set(H, NONCE)
    door.open = true
    expect(store.get(H)).toBe('')
    expect(store.set(H2, NONCE2)).toBe(false)
    expect(localStorage.getItem(entryNonceStorageKey(H2))).toBeNull()
  })

  it('the refusal in carriedBy still holds at a door, and drop still forgets', () => {
    const store = new EntryNonceStore()
    store.set(H, NONCE)
    door.open = true
    expect(store.carriedBy(`{"x":"${NONCE}"}`)).toBe(H)
    store.drop(H)
    door.open = false
    expect(store.get(H)).toBe('')
  })
})

describe('carriedBy', () => {
  it('names the pool, never the nonce, for bytes that carry a held nonce in either case', () => {
    const store = new EntryNonceStore()
    store.set(H, NONCE)
    store.set(H2, NONCE2)
    const bytes = new TextEncoder().encode(`{"opened":[{"code":"#post=${'e'.repeat(64)}~${NONCE2.toUpperCase()}"}]}`)
    expect(store.carriedBy(bytes)).toBe(H2)
    expect(store.carriedBy(bytes.buffer)).toBe(H2)
    expect(store.carriedBy(`a ${NONCE} b`)).toBe(H)
    expect(store.carriedBy(`{"pool":"${H}","record":"${'e'.repeat(64)}"}`)).toBe('')
    expect(store.carriedBy('')).toBe('')
  })

  it('answers empty when nothing is held', () => {
    expect(new EntryNonceStore().carriedBy(NONCE)).toBe('')
  })
})

describe('change events', () => {
  it('fire on set and drop, carry no detail, and nothing is said for a no-op', () => {
    const store = new EntryNonceStore()
    const seen = changes(store)
    store.set(H, NONCE)
    store.set(H, NONCE)
    store.drop(H)
    store.drop(H)
    expect(seen.length).toBe(2)
    for (const event of seen) expect((event as CustomEvent).detail ?? null).toBeNull()
  })

  it('another tab\'s write to one of its keys reloads it; another key is ignored', () => {
    const store = new EntryNonceStore()
    const seen = changes(store)
    localStorage.setItem(entryNonceStorageKey(H), NONCE)
    window.dispatchEvent(new StorageEvent('storage', { key: 'hc:unrelated' }))
    expect(seen.length).toBe(0)
    expect(store.get(H)).toBe('')
    window.dispatchEvent(new StorageEvent('storage', { key: entryNonceStorageKey(H) }))
    expect(seen.length).toBe(1)
    expect(store.get(H)).toBe(NONCE)
  })
})

describe('what is kept', () => {
  it('only the nonce, under its pool\'s key: never the opening record or the code', () => {
    const store = new EntryNonceStore()
    store.set(H, NONCE)
    expect(everythingStored()).toBe(`${entryNonceStorageKey(H)}\n${NONCE}`)
  })

  it('the singleton is registered under its IoC key', () => {
    expect(get(ENTRY_NONCE_STORE_IOC_KEY)).toBe(entryNonceStore)
  })
})
