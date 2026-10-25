// held-address-reader.spec.ts — a held head that misses reads its address again.
import { describe, expect, it, vi } from 'vitest'
import { heldAddressReader } from './held-address-reader.js'
import type { AddressHead } from './published-address.js'

const s = (c: string): string => c.repeat(64)
const HOST = 'jaime-weise.hypercomb.com'
const at = (head: string, host = HOST): AddressHead => ({ head, pubkey: s('p'), lineage: 'jaime-weise', title: 'Jaime', host, publishedAt: 1 })

describe('heldAddressReader', () => {
  it('asks where an address stands once per boot', async () => {
    const readHead = vi.fn(async () => at(s('a')))
    const reader = heldAddressReader({ readHead, readCard: async () => ({ n: 1 }) })
    await reader.head(HOST)
    await reader.head(` ${HOST.toUpperCase()} `)
    expect(readHead).toHaveBeenCalledTimes(1)
  })

  it('a failed read is asked again', async () => {
    const readHead = vi.fn(async (): Promise<AddressHead> => ({ error: 'unreachable' }))
    const reader = heldAddressReader({ readHead, readCard: async () => null })
    await reader.head(HOST)
    await vi.waitFor(async () => { await reader.head(HOST); expect(readHead).toHaveBeenCalledTimes(2) })
  })

  it('a held head that misses on its host reads that host\'s addresses again — the moved head is what the page finds next', async () => {
    let current = s('a')
    const readHead = vi.fn(async (address: string) => at(current, address.startsWith('other') ? 'other.example' : HOST))
    const reader = heldAddressReader({ readHead, readCard: async (head: string) => head === current ? { n: 1 } : null })
    expect(await reader.head(HOST)).toMatchObject({ head: s('a') })
    await reader.head('other.example')

    current = s('b')            // the publisher moved on; the host now 404s the old head
    expect(await reader.card(s('a'), HOST)).toBeNull()
    await vi.waitFor(() => expect(readHead).toHaveBeenCalledTimes(3))
    expect(await reader.head(HOST)).toMatchObject({ head: s('b') })
    // Another host's address was not read again.
    expect(readHead.mock.calls.filter(([address]) => address === 'other.example')).toHaveLength(1)
  })

  it('a card that reads changes nothing', async () => {
    const readHead = vi.fn(async () => at(s('a')))
    const reader = heldAddressReader({ readHead, readCard: async () => ({ n: 1 }) })
    await reader.head(HOST)
    expect(await reader.card(s('a'), HOST)).toEqual({ n: 1 })
    await reader.head(HOST)
    expect(readHead).toHaveBeenCalledTimes(1)
  })
})
