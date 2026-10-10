// bridge-code-store.spec.ts — the bridge codes this device holds: hashes
// only, the shared rule the broker reads, and the store's own rules.

import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const door = vi.hoisted(() => ({ open: false }))
vi.mock('./sandbox-door.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./sandbox-door.js')>()),
  isSandboxDoor: () => door.open,
}))

const {
  BRIDGE_CODES_STORAGE_KEY,
  BridgeCodeStore,
  bridgeCodeBase32,
  bridgeCodeFingerprint,
  hashBridgeCode,
  mintBridgeCode,
  normalizeBridgeCode,
} = await import('./llm-keys.js')

const nodeHash = (code: string): string => createHash('sha256').update(code, 'utf8').digest('hex')

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

describe('the shared rule', () => {
  it('trims, never folds case, and holds 1–256 characters', () => {
    expect(normalizeBridgeCode('  Hcb-ABC  ')).toBe('Hcb-ABC')
    expect(normalizeBridgeCode('')).toBe('')
    expect(normalizeBridgeCode('   ')).toBe('')
    expect(normalizeBridgeCode(undefined)).toBe('')
    expect(normalizeBridgeCode('x'.repeat(256))).toBe('x'.repeat(256))
    expect(normalizeBridgeCode('x'.repeat(257))).toBe('')
  })

  it('holds printable ASCII only, because a Node client sends the code in a header', () => {
    expect(normalizeBridgeCode('~!#$%&*+-./:;<=>?@[]^_`{|}')).toBe('~!#$%&*+-./:;<=>?@[]^_`{|}')
    for (const code of ['ünïcödé', 'たなかのひみつ', 'two words', 'tab\there', 'hcb-🐝']) {
      expect(normalizeBridgeCode(code)).toBe('')
    }
  })

  it("hashes exactly as Node's createHash does, for any UTF-8", async () => {
    for (const code of ['hcb-abc', 'Hcb-ABC', 'café-код-🐝', 'x'.repeat(256)]) {
      expect(await hashBridgeCode(code)).toBe(nodeHash(code))
    }
  })

  it('names a code by the first 8 characters of its hash', () => {
    expect(bridgeCodeFingerprint(nodeHash('hcb-abc'))).toBe(nodeHash('hcb-abc').slice(0, 8))
  })

  it('writes RFC 4648 base32, lowercase and unpadded', () => {
    const vectors: Record<string, string> = { f: 'my', fo: 'mzxq', foo: 'mzxw6', foob: 'mzxw6yq', fooba: 'mzxw6ytb', foobar: 'mzxw6ytboi' }
    for (const [text, encoded] of Object.entries(vectors)) {
      expect(bridgeCodeBase32(new TextEncoder().encode(text))).toBe(encoded)
    }
  })

  it('mints hcb- and 20 random bytes in base32', () => {
    const one = mintBridgeCode()
    expect(one).toMatch(/^hcb-[a-z2-7]{32}$/)
    expect(mintBridgeCode()).not.toBe(one)
  })
})

describe('BridgeCodeStore', () => {
  it('starts empty', () => {
    const store = new BridgeCodeStore()
    expect(store.list()).toEqual([])
    expect(store.hashes()).toEqual([])
  })

  it('stores the hash and never the code', async () => {
    const store = new BridgeCodeStore()
    const added = await store.add('susan', 'hcb-told-to-me')
    const given = await store.generate('raj')
    expect(added).toEqual({ ok: true, fingerprint: nodeHash('hcb-told-to-me').slice(0, 8) })
    expect(given.ok).toBe(true)
    if (!given.ok) return
    expect(given.fingerprint).toBe(nodeHash(given.code).slice(0, 8))

    const stored = everythingStored()
    expect(stored).not.toContain('hcb-told-to-me')
    expect(stored).not.toContain(given.code)
    const rows = JSON.parse(localStorage.getItem(BRIDGE_CODES_STORAGE_KEY) ?? '[]') as { label: string; hash: string; at: number }[]
    expect(rows.map(row => [row.label, row.hash])).toEqual([['susan', nodeHash('hcb-told-to-me')], ['raj', nodeHash(given.code)]])
    expect(store.hashes()).toEqual([nodeHash('hcb-told-to-me'), nodeHash(given.code)])
    expect(store.list().map(entry => [entry.label, entry.fingerprint])).toEqual([
      ['susan', nodeHash('hcb-told-to-me').slice(0, 8)], ['raj', given.fingerprint],
    ])
    // A second store on this device reads the same list back.
    expect(new BridgeCodeStore().hashes()).toEqual(store.hashes())
  })

  it('refuses a name already held in any case, and a code already held under another name', async () => {
    const store = new BridgeCodeStore()
    expect((await store.add('Susan', 'hcb-one')).ok).toBe(true)
    expect(await store.add('susan', 'hcb-two')).toEqual({ ok: false, reason: 'duplicate' })
    expect(await store.generate('SUSAN')).toEqual({ ok: false, reason: 'duplicate' })
    expect(await store.add('raj', '  hcb-one ')).toEqual({ ok: false, reason: 'duplicate' })
    expect(await store.add('raj', 'HCB-ONE')).toMatchObject({ ok: true })
    expect(store.list().map(entry => entry.label)).toEqual(['Susan', 'raj'])
  })

  it('refuses an empty name and a code outside 1–256 printable ASCII characters', async () => {
    const store = new BridgeCodeStore()
    expect(await store.add('', 'hcb-x')).toEqual({ ok: false, reason: 'invalid' })
    expect(await store.add('susan', '   ')).toEqual({ ok: false, reason: 'invalid' })
    expect(await store.add('susan', 'x'.repeat(257))).toEqual({ ok: false, reason: 'invalid' })
    expect(await store.add('susan', 'たなかのひみつ')).toEqual({ ok: false, reason: 'invalid' })
    expect(await store.add('susan', 'two words')).toEqual({ ok: false, reason: 'invalid' })
    expect(store.list()).toEqual([])
  })

  it('withdraws by name in any case, or by 4+ characters of the fingerprint', async () => {
    const store = new BridgeCodeStore()
    await store.add('susan', 'hcb-susan')
    await store.add('raj', 'hcb-raj')
    expect(store.withdraw('SUSAN')).toBe(1)
    expect(store.list().map(entry => entry.label)).toEqual(['raj'])

    const fingerprint = nodeHash('hcb-raj').slice(0, 8)
    expect(store.withdraw(fingerprint.slice(0, 3))).toBe(0)
    expect(store.list()).toHaveLength(1)
    expect(store.withdraw(fingerprint.slice(0, 4).toUpperCase())).toBe(1)
    expect(store.list()).toEqual([])
    expect(localStorage.getItem(BRIDGE_CODES_STORAGE_KEY)).toBeNull()
    expect(store.withdraw('nobody')).toBe(0)
  })

  it('refuses an ambiguous withdraw and withdraws nothing', async () => {
    const store = new BridgeCodeStore()
    await store.add('susan', 'hcb-susan')
    // A name that is also the start of susan's fingerprint names two codes.
    const prefix = nodeHash('hcb-susan').slice(0, 4)
    await store.add(prefix, 'hcb-other')
    expect(store.withdraw(prefix)).toBe(2)
    expect(store.list()).toHaveLength(2)
  })

  it('fires a plain change, with no detail, on every mutation', async () => {
    const store = new BridgeCodeStore()
    const seen = changes(store)
    await store.add('susan', 'hcb-susan')
    await store.generate('raj')
    store.withdraw('susan')
    expect(seen).toHaveLength(3)
    for (const event of seen) {
      expect(event.constructor).toBe(Event)
      expect((event as CustomEvent).detail).toBeUndefined()
    }
    // A refusal changes nothing, and says nothing.
    await store.add('raj', 'hcb-again')
    expect(store.withdraw('nobody')).toBe(0)
    expect(seen).toHaveLength(3)
  })

  it('re-reads on a storage event for its own key, and only its own', () => {
    const store = new BridgeCodeStore()
    const seen = changes(store)
    const hash = nodeHash('hcb-from-another-tab')
    localStorage.setItem(BRIDGE_CODES_STORAGE_KEY, JSON.stringify([{ label: 'susan', hash, at: 1 }]))
    window.dispatchEvent(new StorageEvent('storage', { key: 'hc:something-else' }))
    expect(store.hashes()).toEqual([])
    expect(seen).toHaveLength(0)
    window.dispatchEvent(new StorageEvent('storage', { key: BRIDGE_CODES_STORAGE_KEY }))
    expect(store.hashes()).toEqual([hash])
    expect(seen).toHaveLength(1)
  })

  it('drops rows that are not a name and a 64-hex hash', () => {
    const good = nodeHash('hcb-good')
    localStorage.setItem(BRIDGE_CODES_STORAGE_KEY, JSON.stringify([
      { label: 'good', hash: good, at: 5 },
      { label: 'short', hash: 'abcd', at: 5 },
      { label: 'upper', hash: good.toUpperCase(), at: 5 },
      { label: '', hash: nodeHash('x'), at: 5 },
      { label: 'GOOD', hash: nodeHash('y'), at: 5 },
      { label: 'twin', hash: good, at: 5 },
      null,
    ]))
    expect(new BridgeCodeStore().list()).toEqual([{ label: 'good', fingerprint: good.slice(0, 8), at: 5 }])
    localStorage.setItem(BRIDGE_CODES_STORAGE_KEY, '{not json')
    expect(new BridgeCodeStore().list()).toEqual([])
  })

  it('holds nothing at a sandbox door', async () => {
    localStorage.setItem(BRIDGE_CODES_STORAGE_KEY, JSON.stringify([{ label: 'susan', hash: nodeHash('hcb-held'), at: 1 }]))
    door.open = true
    const store = new BridgeCodeStore()
    expect(store.list()).toEqual([])
    expect(store.hashes()).toEqual([])
    expect(await store.add('raj', 'hcb-typed-at-a-door')).toEqual({ ok: false, reason: 'door' })
    expect(await store.generate('raj')).toEqual({ ok: false, reason: 'door' })
    expect(store.withdraw('susan')).toBe(0)
    expect(everythingStored()).not.toContain('hcb-typed-at-a-door')
    expect(JSON.parse(localStorage.getItem(BRIDGE_CODES_STORAGE_KEY) ?? '[]')).toHaveLength(1)
  })
})
