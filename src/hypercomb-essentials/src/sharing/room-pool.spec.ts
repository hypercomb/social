import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { listingNames, memberTemplate, readMember, roomPoolAddress, standingMembers, type RoomMember } from './room-pool.js'

const sha256 = async (bytes: Uint8Array): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer))]
    .map(b => b.toString(16).padStart(2, '0')).join('')

const PAGE = 'a'.repeat(64)
const HEAD = 'b'.repeat(64)

async function signedMember(pool: string, key = generateSecretKey(), page = PAGE, head = HEAD, at?: number) {
  const bytes = new TextEncoder().encode(JSON.stringify(finalizeEvent(memberTemplate(pool, page, head, at), key)))
  return { bytes, name: await sha256(bytes), signer: getPublicKey(key) }
}

describe('roomPoolAddress', () => {
  it('is one address per room, secret and host — and none without a host', async () => {
    const a = await roomPoolAddress('Lecture', 'secret', 'hypercomb.com')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(await roomPoolAddress('lecture', 'secret', 'HYPERCOMB.COM')).toBe(a)   // the room words fold
    expect(await roomPoolAddress('lecture', 'other', 'hypercomb.com')).not.toBe(a)
    expect(await roomPoolAddress('lecture', 'secret', 'jwize.com')).not.toBe(a)
    expect(await roomPoolAddress('lecture', 'secret', '')).toBe('')
  })
})

describe('readMember', () => {
  it('reads a signed member of this pool that hashes to its name', async () => {
    const pool = await roomPoolAddress('lecture', 'secret', 'hypercomb.com')
    const { bytes, name, signer } = await signedMember(pool)
    expect(await readMember(pool, name, bytes)).toMatchObject({ name, signer, head: HEAD, page: PAGE })
  })

  it('refuses another pool, a wrong name, and a forged signature', async () => {
    const pool = await roomPoolAddress('lecture', 'secret', 'hypercomb.com')
    const elsewhere = await signedMember(await roomPoolAddress('other', 'secret', 'hypercomb.com'))
    expect(await readMember(pool, elsewhere.name, elsewhere.bytes)).toBeNull()
    const { bytes } = await signedMember(pool)
    expect(await readMember(pool, 'c'.repeat(64), bytes)).toBeNull()
    const evt = JSON.parse(new TextDecoder().decode(bytes))
    evt.tags = [...evt.tags.filter((t: string[]) => t[0] !== 'head'), ['head', 'd'.repeat(64)]]
    const forged = new TextEncoder().encode(JSON.stringify(evt))
    expect(await readMember(pool, await sha256(forged), forged)).toBeNull()
  })
})

describe('standingMembers', () => {
  it('keeps each signer\'s newest member per page', () => {
    const m = (name: string, signer: string, page: string, at: number): RoomMember => ({ name, signer, head: HEAD, page, at })
    const standing = standingMembers([m('1', 'ana', 'p', 10), m('2', 'ana', 'p', 20), m('3', 'ana', 'q', 5), m('4', 'ben', 'p', 15)])
    expect(standing.map(x => x.name)).toEqual(['3', '4', '2'])
  })
})

describe('listingNames', () => {
  it('reads newline signatures and nothing else', () => {
    expect(listingNames(`${HEAD}\n${PAGE}\n`)).toEqual([HEAD, PAGE])
    expect(listingNames('<!doctype html><html>')).toEqual([])
  })
})
