// host-offerings.anchored.spec.ts — a site the publisher's phone published
// (its index signed by a key the publisher's list names, for the publisher)
// is offered like any other, and the offer proves itself offline: it carries
// the chain, and parseHostOffering walks it again.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { SignatureService } from './signature.service.js'
import { parseHostOffering, readHostOfferings } from './host-offerings.js'
import { forgetListedChains } from './index-signer.js'
import { KEY_LIST_MEANING, firstKeyList, keyListTemplate, nextKeyList, readKeyList, type SignedKeyList } from './key-list.js'

const sha = (value: string): Promise<string> =>
  SignatureService.sign(new TextEncoder().encode(value).buffer as ArrayBuffer)

const PUBLISHER_KEY = new Uint8Array(32).fill(7)
const PUBLISHER = getPublicKey(PUBLISHER_KEY)
const PHONE_KEY = new Uint8Array(32).fill(9)
const PHONE = getPublicKey(PHONE_KEY)
const source = 'mirror.example.net'
const route = 'https://garden.example.com/'
const head = 'a'.repeat(64)
const verify = (value: Record<string, unknown>): boolean => verifyEvent(value as never)

const chainAdding = (added: string): SignedKeyList[] => {
  const zero = finalizeEvent(keyListTemplate(firstKeyList(PUBLISHER, 'laptop'), 1_791_000_000), PUBLISHER_KEY)
  const one = nextKeyList(readKeyList(zero as never)!, zero.id, { op: 'add', pubkey: added, label: 'phone' })!
  return [zero, finalizeEvent(keyListTemplate(one, 1_791_000_010), PUBLISHER_KEY)] as unknown as SignedKeyList[]
}

/** The phone's index for the publisher, the offer row for it, and a fetch that serves both. */
const serve = async (tags: string[][], chain: SignedKeyList[] | null) => {
  const index = finalizeEvent({ kind: 30564, created_at: 1, tags,
    content: JSON.stringify({ roots: { garden: head }, doors: { garden: ['example.com'] } }) }, PHONE_KEY)
  const location = await sha('garden.example.com')
  const bytes = JSON.stringify({ kind: 'host:offering', title: 'Garden', route, lineage: 'garden', pubkey: PUBLISHER, location })
  const member = await sha(bytes)
  const pool = await sha('host:offerings')
  const indexes = await sha('hive:indexes')
  const lists = await sha(KEY_LIST_MEANING)
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = String(input)
    if (url === `https://${source}/content/${pool}/`) return new Response(`${member}\n`)
    if (url === `https://${source}/content/${pool}/${member}`) return new Response(bytes)
    if (url === `https://garden.example.com/${indexes}/${PUBLISHER}`) return Response.json(index)
    if (chain && url === `https://garden.example.com/${lists}/${PUBLISHER}`) return Response.json(chain)
    if (url === `https://${source}/content/${location}/`) return new Response('00000000\n')
    if (url === `https://${source}/content/${location}/00000000`) return Response.json({ layer: head })
    return new Response(null, { status: 404 })
  }))
  return readHostOfferings(source, verify)
}

beforeEach(() => forgetListedChains())
afterEach(() => vi.unstubAllGlobals())

describe('an offering a listed key signed for the publisher', () => {
  it('is offered, and the offer carries the chain that proves it offline', async () => {
    const rows = await serve([['anchor', PUBLISHER]], chainAdding(PHONE))
    expect(rows).toMatchObject([{ route, head, pubkey: PUBLISHER }])
    expect(rows[0].keyList).toHaveLength(2)
    expect(parseHostOffering(rows[0], verify)).toMatchObject({ route, head, pubkey: PUBLISHER })
  })

  it('is not offered when the list does not name the signer, or the host holds no list', async () => {
    expect(await serve([['anchor', PUBLISHER]], chainAdding('c'.repeat(64)))).toEqual([])
    forgetListedChains()
    expect(await serve([['anchor', PUBLISHER]], null)).toEqual([])
  })

  it('is not offered without the anchor tag', async () => {
    expect(await serve([], chainAdding(PHONE))).toEqual([])
  })

  it('fails the offline check when the carried chain is missing or tampered', async () => {
    const [row] = await serve([['anchor', PUBLISHER]], chainAdding(PHONE))
    expect(parseHostOffering({ ...row, keyList: undefined }, verify)).toBeNull()
    const tampered = row.keyList!.map((event, n) => n === 1 ? { ...event, sig: '0'.repeat(128) } : event)
    expect(parseHostOffering({ ...row, keyList: tampered }, verify)).toBeNull()
    expect(parseHostOffering({ ...row, keyList: chainAdding('c'.repeat(64)) }, verify)).toBeNull()
  })
})
