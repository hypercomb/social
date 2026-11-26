// pools/open-entries.spec.ts : the names, the member, the hidden list, the
// listing and the reader's fold of an open entry pool, against the shared test
// vector the host reads too (hypercomb-relay/blossom-worker/entry-pool.vector.json)
// and a fake host that answers by URL. No network and no IoC.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { SignatureService } from '@hypercomb/core'
import { parseRecipeEntry, recipeEntryBytes } from '../recipe/recipe-template.js'
import {
  ENTRY_LIMITS,
  ENTRY_LISTING_HEADERS,
  emptyHiddenList,
  entryCodeLink,
  entryCodeOf,
  entryIndexKeys,
  entryKeyOf,
  entryListingOf,
  entryListingUrl,
  entryMemberBody,
  entryMemberUrl,
  entryPoolAddress,
  entryPoolName,
  entryRecordBytes,
  entryRoomLeft,
  foldEntryMembers,
  forgetEntryMembers,
  hiddenLineText,
  hiddenListBytes,
  hostOffsetOf,
  isEntryLine,
  isOfferablePage,
  parseEntryRecord,
  parseHiddenList,
  readEntryAtomAnswer,
  readEntryListing,
  readEntryMember,
  readEntryPool,
  signEntryMember,
  withHiddenLine,
  type EntryEvent,
  type EntryMember,
  type EntryMemberInput,
} from './open-entries.js'

const here = dirname(fileURLToPath(import.meta.url))
const vector = JSON.parse(readFileSync(resolve(here, '../../../hypercomb-relay/blossom-worker/entry-pool.vector.json'), 'utf8')) as {
  kind: number
  keys: { leader: { seed: string; pubkey: string }; poster: { seed: string; pubkey: string } }
  names: { P: string; O: string; nonce: string; until: number; A: string; H: string }
  record: string
  code: string
  member: { event: EntryEvent; body: string; name: string }
  refused: { why: string; body: string; name: string }[]
}
const { P, O, nonce, until, A, H } = vector.names

const enc = new TextEncoder()
const sign = (bytes: Uint8Array): Promise<string> => SignatureService.sign(bytes.slice().buffer as ArrayBuffer)
const secretOf = async (seed: string): Promise<Uint8Array> => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(seed)))
const hexOf = (ch: string, length = 64): string => ch.repeat(length)
const NOW = until - 3_600

/** A member signed for the vector's pool, as a poster's page signs one. */
const memberOf = async (secret: Uint8Array, over: Partial<EntryMemberInput> = {}): Promise<EntryMember> => {
  const signed = await signEntryMember({
    pool: H, page: hexOf('a'), name: 'Ana', title: 'Soup', content: '{"recipe":1,"values":{}}', createdAt: NOW, ...over,
  }, secret)
  if (!signed.ok) throw new Error(signed.reason)
  const member = await readEntryMember(signed.body, H, signed.name)
  if (!member) throw new Error('the signed member did not read back')
  return member
}

afterEach(() => forgetEntryMembers())

describe('the names', () => {
  it('reproduces the vector: A, H, the record and the code', async () => {
    expect(await entryPoolAddress(O, nonce)).toBe(A)
    expect(await entryPoolName(A, P, until)).toBe(H)
    const parsed = await parseEntryRecord(enc.encode(vector.record), O)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(new TextDecoder().decode(entryRecordBytes(parsed.record))).toBe(vector.record)
    expect(parsed.record).toEqual({ meaning: 'recipe:entry', title: 'Tuesday class', template: parsed.record.template, by: P, until })
    expect(entryCodeOf(vector.code)).toEqual({ record: O, nonce })
    expect(entryCodeLink('class.example.com', O, nonce)).toBe(`https://class.example.com/${vector.code}`)
    expect(entryCodeOf(`https://class.example.com/${vector.code}`)).toEqual({ record: O, nonce })
  })

  it('names nothing from parts that are not the hex they must be', async () => {
    expect(await entryPoolAddress(O.toUpperCase(), nonce)).toBe('')
    expect(await entryPoolAddress(O, nonce + '0')).toBe('')
    expect(await entryPoolName(A, P, 0)).toBe('')
    expect(await entryPoolName(A, P, 1.5)).toBe('')
    expect(entryCodeLink('', O, nonce)).toBe('')
    expect(entryCodeOf('#post=nope')).toBeNull()
  })

  it('spells the three index keys and reads them back', () => {
    const keys = entryIndexKeys(H)
    expect(keys).toEqual({ open: `entries:${H}`, closed: `entries-closed:${H}`, hidden: `entries-hidden:${H}` })
    expect(entryKeyOf(keys.open)).toEqual({ pool: H, as: 'open' })
    expect(entryKeyOf(keys.closed)).toEqual({ pool: H, as: 'closed' })
    expect(entryKeyOf(keys.hidden)).toEqual({ pool: H, as: 'hidden' })
    expect(entryKeyOf(`entries:${H.toUpperCase()}`)).toBeNull()
    expect(entryKeyOf('pool:recipe:entry')).toBeNull()
  })

  it('spells the listing and the member addresses with by and until', () => {
    const path = { page: 'class.example.com', address: A, by: P, until }
    expect(entryListingUrl(path)).toBe(`https://class.example.com/${A}/?by=${P}&until=${until}`)
    expect(entryMemberUrl(path, vector.member.name)).toBe(`https://class.example.com/${A}/${vector.member.name}?by=${P}&until=${until}`)
    expect(entryListingUrl({ ...path, until: 0 })).toBe('')
    expect(ENTRY_LISTING_HEADERS).toMatchObject({ state: 'X-Entries-State', hidden: 'X-Entries-Hidden', hostTime: 'X-Host-Time' })
  })
})

describe('the opening record', () => {
  it('is refused when spelled another way, over 1 KB, or naming another signature than asked', async () => {
    const spaced = vector.record.replace('{', '{ ')
    expect((await parseEntryRecord(enc.encode(spaced))).ok).toBe(false)
    expect((await parseEntryRecord(enc.encode(vector.record), hexOf('0'))).ok).toBe(false)
    // No valid record reaches 1 KB, so the cap is what a host's padded bytes meet first, before they are parsed.
    const padded = await parseEntryRecord(enc.encode(vector.record + ' '.repeat(1024)))
    expect(padded).toEqual({ ok: false, reason: 'an opening record is at most 1 KB' })
    const extra = vector.record.replace(/}$/, ',"nonce":"00"}')
    expect((await parseEntryRecord(enc.encode(extra))).ok).toBe(false)
    const reordered = JSON.stringify({ ...JSON.parse(vector.record), 'entries:open': 1 })
    expect(reordered).toBe(vector.record)
    const late = vector.record.replace(`"until":${until}`, `"until":${until}.5`)
    expect((await parseEntryRecord(enc.encode(late))).ok).toBe(false)
  })
})

describe('the member', () => {
  it('reproduces the vector member byte for byte, and its name', async () => {
    const body = entryMemberBody(vector.member.event)
    expect(new TextDecoder().decode(body)).toBe(vector.member.body)
    expect(await sign(body)).toBe(vector.member.name)
    const read = await readEntryMember(body, H, vector.member.name)
    expect(read).toMatchObject({ name: vector.member.name, signer: vector.keys.poster.pubkey, label: 'Ana', title: 'Sunday soup', gone: false })
  })

  it('signs the vector event with the poster key: the same id, key and spelling (the signature is randomised)', async () => {
    const secret = await secretOf(vector.keys.poster.seed)
    const event = vector.member.event
    const signed = await signEntryMember({
      pool: H, page: event.tags[1][1], name: 'Ana', title: 'Sunday soup', content: event.content, createdAt: event.created_at,
    }, secret)
    expect(signed.ok).toBe(true)
    if (!signed.ok) return
    expect(signed.event.id).toBe(event.id)
    expect(signed.event.pubkey).toBe(vector.keys.poster.pubkey)
    const text = new TextDecoder().decode(signed.body)
    expect(text.replace(signed.event.sig, event.sig)).toBe(vector.member.body)
    expect(await readEntryMember(signed.body, H, signed.name)).not.toBeNull()
  })

  it('refuses each of the vector\'s thirteen other spellings of that event', async () => {
    expect(vector.refused).toHaveLength(13)
    for (const spelling of vector.refused) {
      const bytes = enc.encode(spelling.body)
      expect(await sign(bytes), spelling.why).toBe(spelling.name)
      expect(await readEntryMember(bytes, H, spelling.name), spelling.why).toBeNull()
      expect(await readEntryMember(bytes, H), spelling.why).toBeNull()
    }
  })

  it('refuses bytes that do not hash to the name they were asked by', async () => {
    expect(await readEntryMember(enc.encode(vector.member.body), H, hexOf('0'))).toBeNull()
  })

  it('refuses a member of another pool', async () => {
    expect(await readEntryMember(enc.encode(vector.member.body), hexOf('b'))).toBeNull()
  })

  it('refuses a member over 4 KB, and the signer refuses to make one', async () => {
    const secret = generateSecretKey()
    const signed = await signEntryMember({ pool: H, page: hexOf('a'), name: 'Ana', title: 'Soup', content: 'x'.repeat(4096), createdAt: NOW }, secret)
    expect(signed.ok).toBe(false)
    const room = entryRoomLeft({ pool: H, page: hexOf('a'), name: 'Ana', title: 'Soup', content: '' })
    const fits = await signEntryMember({ pool: H, page: hexOf('a'), name: 'Ana', title: 'Soup', content: 'x'.repeat(room), createdAt: NOW }, secret)
    expect(fits.ok && fits.body.byteLength).toBe(ENTRY_LIMITS.memberBytes)
    const over = await signEntryMember({ pool: H, page: hexOf('a'), name: 'Ana', title: 'Soup', content: 'x'.repeat(room + 1), createdAt: NOW }, secret)
    expect(over.ok).toBe(false)
  })

  /** The vector's member with one field changed and re-spelled (the signature no longer covers it unless re-signed). */
  const respelled = (change: (event: Record<string, unknown>) => void): Uint8Array => {
    const event = structuredClone(vector.member.event) as unknown as Record<string, unknown>
    change(event)
    return enc.encode(JSON.stringify(event))
  }

  it('refuses another kind, an id that is not the hash, a signature that does not verify', async () => {
    expect(await readEntryMember(respelled(e => { e['kind'] = 30567 }), H)).toBeNull()
    expect(await readEntryMember(respelled(e => { e['id'] = hexOf('0') }), H)).toBeNull()
    const sig = vector.member.event.sig
    const flipped = (sig[0] === 'f' ? 'e' : 'f') + sig.slice(1)
    expect(await readEntryMember(respelled(e => { e['sig'] = flipped }), H)).toBeNull()
  })

  it('refuses tags other than exactly pool, page, name, title and at most one gone of "1"', async () => {
    const secret = generateSecretKey()
    const base = await signEntryMember({ pool: H, page: hexOf('a'), name: 'Ana', title: 'Soup', content: '', createdAt: NOW, gone: true }, secret)
    expect(base.ok && await readEntryMember(base.body, H)).toMatchObject({ gone: true })
    // Re-signed with each wrong tag set, so only the tag rule can refuse it.
    const { finalizeEvent } = await import('nostr-tools/pure')
    const withTags = (tags: string[][]): Uint8Array => {
      const signed = finalizeEvent({ kind: vector.kind, created_at: NOW, tags, content: '' }, secret)
      return entryMemberBody(signed as unknown as EntryEvent)
    }
    const good = [['pool', H], ['page', hexOf('a')], ['name', 'Ana'], ['title', 'Soup']]
    expect(await readEntryMember(withTags(good), H)).not.toBeNull()
    expect(await readEntryMember(withTags([...good, ['gone', 'yes']]), H)).toBeNull()
    expect(await readEntryMember(withTags([...good, ['gone', '1'], ['gone', '1']]), H)).toBeNull()
    expect(await readEntryMember(withTags([...good, ['e', hexOf('c')]]), H)).toBeNull()
    expect(await readEntryMember(withTags(good.slice(0, 3)), H)).toBeNull()
    expect(await readEntryMember(withTags([...good.slice(0, 3), ['title', 'Soup', 'extra']]), H)).toBeNull()
    expect(await readEntryMember(withTags([['pool', H], ['page', 'A'.repeat(64)], ['name', 'Ana'], ['title', 'Soup']]), H)).toBeNull()
    expect(await readEntryMember(withTags([['pool', H], ['page', hexOf('a')], ['name', 'Ana\nB'], ['title', 'Soup']]), H)).toBeNull()
    expect(await readEntryMember(withTags([['pool', H], ['page', hexOf('a')], ['name', 'x'.repeat(49)], ['title', 'Soup']]), H)).toBeNull()
    expect(await readEntryMember(withTags([['pool', H], ['page', hexOf('a')], ['name', 'Ana'], ['title', 't'.repeat(121)]]), H)).toBeNull()
    expect(await readEntryMember(withTags([['pool', H], ['page', hexOf('a')], ['name', '   '], ['title', 'Soup']]), H)).toBeNull()
  })

  it('refuses a name or title the signer would not write', async () => {
    const secret = generateSecretKey()
    expect((await signEntryMember({ pool: H, page: hexOf('a'), name: '', title: 'Soup', content: '', createdAt: NOW }, secret)).ok).toBe(false)
    expect((await signEntryMember({ pool: H, page: hexOf('a'), name: 'Ana', title: 'So‮up', content: '', createdAt: NOW }, secret)).ok).toBe(false)
    expect((await signEntryMember({ pool: H, page: 'nope', name: 'Ana', title: 'Soup', content: '', createdAt: NOW }, secret)).ok).toBe(false)
  })
})

describe('the line rule is the recipe reader\'s own', () => {
  it('agrees with recipe-template line() on every character near the rules, and on length', async () => {
    const recipe = hexOf('d')
    const samples: string[] = []
    for (let code = 0; code <= 0xa0; code++) samples.push(`a${String.fromCharCode(code)}b`)
    for (const code of [0x200b, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x202f, 0x2065, 0x2066, 0x2067, 0x2068, 0x2069, 0x206a, 0xfeff]) {
      samples.push(`a${String.fromCharCode(code)}b`)
    }
    samples.push('', ' ', '\t', ' a ', 'x'.repeat(120), 'x'.repeat(121), '\u{1F372}'.repeat(60), '\u{1F372}'.repeat(61))
    for (const sample of samples) {
      const theirs = (await parseRecipeEntry(recipeEntryBytes({ name: sample, recipe }))).ok
      expect(isEntryLine(sample, 120), JSON.stringify(sample)).toBe(theirs)
    }
  })
})

describe('the hidden list', () => {
  it('spells no line as a bare signature, and round-trips its canonical bytes', async () => {
    const key = hexOf('1')
    expect(hiddenLineText({ key })).toBe(`k:${key}`)
    expect(hiddenLineText({ key, page: hexOf('2') })).toBe(`${key}:${hexOf('2')}`)
    expect(hiddenLineText({ key: 'nope' })).toBe('')
    let list = withHiddenLine(emptyHiddenList(), { key }, true)
    list = withHiddenLine(list, { key: hexOf('3'), page: hexOf('4') }, true)
    const bytes = hiddenListBytes(list)
    expect(new TextDecoder().decode(bytes)).toBe(`{"entries:hidden":1,"keys":["k:${key}"],"pages":["${hexOf('3')}:${hexOf('4')}"]}`)
    expect(await parseHiddenList(bytes, await sign(bytes))).toEqual(list)
    expect(withHiddenLine(list, { key }, false).keys).toEqual([])
  })

  it('refuses a bare signature line, another field, a repeated line, a wrong name and more than 64 KB', async () => {
    const key = hexOf('1')
    const doc = (body: Record<string, unknown>): Uint8Array => enc.encode(JSON.stringify({ 'entries:hidden': 1, keys: [], pages: [], ...body }))
    expect(await parseHiddenList(doc({}))).toEqual({ keys: [], pages: [] })
    expect(await parseHiddenList(doc({ keys: [key] }))).toBeNull()
    expect(await parseHiddenList(doc({ pages: [[key, hexOf('2')]] }))).toBeNull()
    expect(await parseHiddenList(doc({ note: 'x' }))).toBeNull()
    expect(await parseHiddenList(doc({ keys: [`k:${key}`, `k:${key}`] }))).toBeNull()
    expect(await parseHiddenList(doc({}), hexOf('0'))).toBeNull()
    const many = Array.from({ length: 1000 }, (_, at) => `k:${at.toString(16).padStart(64, '0')}`)
    expect(await parseHiddenList(doc({ keys: many }))).toBeNull()
  })
})

describe('the reader\'s fold', () => {
  const nowSeconds = NOW

  it('keeps the newest 8 of one key', async () => {
    const secret = generateSecretKey()
    const members: EntryMember[] = []
    for (let at = 0; at < 9; at++) members.push(await memberOf(secret, { page: at.toString(16).padStart(64, '0'), createdAt: NOW - 100 + at }))
    const fold = foldEntryMembers(members, { nowSeconds })
    expect(fold.rows).toHaveLength(8)
    expect(fold.rows.map(row => row.page)).not.toContain(members[0].page)
  })

  it('stands the newest member of a key and page, and a gone takes the page back', async () => {
    const secret = generateSecretKey()
    const older = await memberOf(secret, { title: 'First', createdAt: NOW - 50 })
    const newer = await memberOf(secret, { title: 'Second', createdAt: NOW - 10 })
    expect(foldEntryMembers([newer, older], { nowSeconds }).rows.map(row => row.title)).toEqual(['Second'])
    const gone = await memberOf(secret, { title: 'Gone', gone: true, createdAt: NOW - 5 })
    expect(foldEntryMembers([older, newer, gone], { nowSeconds }).rows).toEqual([])
    // An older take-back does not remove a newer entry.
    const oldGone = await memberOf(secret, { title: 'Gone', gone: true, createdAt: NOW - 70 })
    expect(foldEntryMembers([oldGone, newer], { nowSeconds }).rows.map(row => row.title)).toEqual(['Second'])
  })

  it('counts a stamp ahead of the clock as now, and breaks a tie by the raw stamp, then the name', async () => {
    const secret = generateSecretKey()
    const ahead = await memberOf(secret, { title: 'Ahead', createdAt: NOW + 5_000 })
    const behind = await memberOf(secret, { title: 'Behind', createdAt: NOW - 1 })
    const fold = foldEntryMembers([behind, ahead], { nowSeconds })
    expect(fold.rows).toHaveLength(1)
    expect(fold.rows[0]).toMatchObject({ title: 'Ahead', at: NOW })
    const sameA = await memberOf(secret, { title: 'One', createdAt: NOW - 3 })
    const sameB = await memberOf(secret, { title: 'Two', createdAt: NOW - 3 })
    const first = [sameA, sameB].sort((a, b) => (a.name < b.name ? -1 : 1))[0]
    expect(foldEntryMembers([sameA, sameB], { nowSeconds }).rows[0].member).toBe(first.name)
    expect(foldEntryMembers([sameB, sameA], { nowSeconds }).rows[0].member).toBe(first.name)
  })

  it('draws rows in the listing\'s order, never by stamp', async () => {
    const one = generateSecretKey()
    const two = generateSecretKey()
    const early = await memberOf(one, { title: 'Early key, old entry', createdAt: NOW - 500 })
    const late = await memberOf(two, { title: 'Late key, new entry', page: hexOf('b'), createdAt: NOW - 1 })
    expect(foldEntryMembers([early, late], { nowSeconds }).rows.map(row => row.title)).toEqual(['Early key, old entry', 'Late key, new entry'])
    expect(foldEntryMembers([late, early], { nowSeconds }).rows.map(row => row.title)).toEqual(['Late key, new entry', 'Early key, old entry'])
  })

  it('hides a key, or one page of a key, by the leader\'s list', async () => {
    const one = generateSecretKey()
    const two = generateSecretKey()
    const a = await memberOf(one, { page: hexOf('a') })
    const b = await memberOf(one, { page: hexOf('b') })
    const c = await memberOf(two, { page: hexOf('c') })
    const byKey = withHiddenLine(emptyHiddenList(), { key: getPublicKey(one) }, true)
    expect(foldEntryMembers([a, b, c], { nowSeconds, hidden: { named: hexOf('9'), list: byKey } }).rows.map(row => row.page)).toEqual([hexOf('c')])
    const byPage = withHiddenLine(emptyHiddenList(), { key: getPublicKey(one), page: hexOf('b') }, true)
    expect(foldEntryMembers([a, b, c], { nowSeconds, hidden: { named: hexOf('9'), list: byPage } }).rows.map(row => row.page)).toEqual([hexOf('a'), hexOf('c')])
  })

  it('draws nothing when the host names a hidden list that was not read', async () => {
    const a = await memberOf(generateSecretKey())
    const fold = foldEntryMembers([a], { nowSeconds, hidden: { named: hexOf('9'), list: null } })
    expect(fold).toEqual({ rows: [], over: false, why: 'hidden-unread' })
    expect(foldEntryMembers([a], { nowSeconds, hidden: { named: null, list: null } }).rows).toHaveLength(1)
  })

  it('takes a member once however often it is listed', async () => {
    const a = await memberOf(generateSecretKey())
    expect(foldEntryMembers([a, a, a], { nowSeconds }).rows).toHaveLength(1)
  })
})

/** A response with the listing's own headers. */
const listingResponse = (body: string, headers: Record<string, string>, status = 200): Response =>
  new Response(body, { status, headers })

describe('the listing', () => {
  it('reads the state, the hidden list, the host\'s time and the names', async () => {
    const names = [hexOf('1'), hexOf('2')]
    const listing = await entryListingOf(listingResponse(names.join('\n') + '\n', {
      'X-Entries-State': 'open', 'X-Entries-Hidden': hexOf('9'), 'X-Host-Time': String(NOW),
    }))
    expect(listing).toMatchObject({ reached: true, state: 'open', names, over: false, hidden: hexOf('9'), hostTime: NOW })
    expect(hostOffsetOf(listing, (NOW - 30) * 1000)).toBe(30)
  })

  it('knows no pool without the state header, and reads no names from an ordinary listing', async () => {
    const listing = await entryListingOf(listingResponse(hexOf('1') + '\n', {}))
    expect(listing).toMatchObject({ state: null, names: [], hidden: null })
    const odd = await entryListingOf(listingResponse(hexOf('1') + '\n', { 'X-Entries-State': 'opened', 'X-Entries-Hidden': 'not-a-sig' }))
    expect(odd).toMatchObject({ state: null, names: [], hidden: null })
  })

  it('takes an expired pool as having nothing to draw, with the host\'s words', async () => {
    const listing = await entryListingOf(listingResponse('', { 'X-Entries-State': 'expired', 'X-Reason': 'this one has expired', 'X-Host-Time': String(NOW) }))
    expect(listing).toMatchObject({ state: 'expired', names: [], said: 'this one has expired' })
  })

  it('takes the first 256 names and says a longer listing is over its limit', async () => {
    const names = Array.from({ length: 300 }, (_, at) => at.toString(16).padStart(64, '0'))
    const listing = await entryListingOf(listingResponse(names.join('\n') + '\n', { 'X-Entries-State': 'open' }))
    expect(listing.names).toEqual(names.slice(0, 256))
    expect(listing.over).toBe(true)
    const exactly = await entryListingOf(listingResponse(names.slice(0, 256).join('\n') + '\n', { 'X-Entries-State': 'open' }))
    expect(exactly.over).toBe(false)
    expect(exactly.names).toHaveLength(256)
  })
})

describe('reading a pool', () => {
  const page = 'class.example.com'
  const path = { page, address: A, by: P, until }

  /** A fake host: the listing, the members by name, atoms by signature. */
  const hostWith = (members: Map<string, Uint8Array>, options: { hidden?: { sig: string; bytes: Uint8Array | null }; state?: string } = {}) => {
    const asked: string[] = []
    const fetch = async (url: string): Promise<Response> => {
      asked.push(url)
      const at = new URL(url)
      if (at.pathname === `/${A}/` && at.search === `?by=${P}&until=${until}`) {
        return listingResponse([...members.keys()].join('\n') + '\n', {
          'X-Entries-State': options.state ?? 'open', 'X-Host-Time': String(NOW),
          ...(options.hidden ? { 'X-Entries-Hidden': options.hidden.sig } : {}),
        })
      }
      const name = at.pathname.split('/')[2]
      if (at.pathname.startsWith(`/${A}/`) && members.has(name)) return new Response(members.get(name)!.slice())
      if (options.hidden?.bytes && at.pathname === `/${options.hidden.sig}`) return new Response(options.hidden.bytes.slice())
      return new Response('not here', { status: 404 })
    }
    return { fetch, asked, now: () => (NOW - 20) * 1000 }
  }

  it('draws every verified member, skips bytes that are not a member of this pool, and gives the offset', async () => {
    const secret = generateSecretKey()
    const good = await signEntryMember({ pool: H, page: hexOf('a'), name: 'Ana', title: 'Soup', content: 'x', createdAt: NOW }, secret)
    const other = await signEntryMember({ pool: hexOf('e'), page: hexOf('b'), name: 'Bo', title: 'Stew', content: 'y', createdAt: NOW }, secret)
    if (!good.ok || !other.ok) throw new Error('could not sign')
    const members = new Map([[good.name, good.body], [other.name, other.body], [hexOf('7'), enc.encode('not the bytes named')]])
    const host = hostWith(members)
    const read = await readEntryPool(path, H, host)
    expect(read).toMatchObject({ reached: true, state: 'open', offset: 20 })
    expect(read.rows.map(row => row.member)).toEqual([good.name])
    // A member read once is not asked again.
    const before = host.asked.length
    await readEntryPool(path, H, host)
    expect(host.asked.length - before).toBe(2)
  })

  it('applies the hidden list the host names, and draws nothing when it does not arrive', async () => {
    const secret = generateSecretKey()
    const good = await signEntryMember({ pool: H, page: hexOf('a'), name: 'Ana', title: 'Soup', content: 'x', createdAt: NOW }, secret)
    if (!good.ok) throw new Error('could not sign')
    const members = new Map([[good.name, good.body]])
    const list = hiddenListBytes(withHiddenLine(emptyHiddenList(), { key: getPublicKey(secret) }, true))
    const sig = await sign(list)
    const hidden = await readEntryPool(path, H, hostWith(members, { hidden: { sig, bytes: list } }))
    expect(hidden.rows).toEqual([])
    expect(hidden.why).toBeUndefined()
    expect(hidden.hidden.list?.keys).toEqual([`k:${getPublicKey(secret)}`])
    forgetEntryMembers()
    const missing = await readEntryPool(path, H, hostWith(members, { hidden: { sig, bytes: null } }))
    expect(missing).toMatchObject({ rows: [], why: 'hidden-unread' })
    forgetEntryMembers()
    const wrong = await readEntryPool(path, H, hostWith(members, { hidden: { sig, bytes: enc.encode('{"entries:hidden":1,"keys":[],"pages":[]}') } }))
    expect(wrong.why).toBe('hidden-unread')
  })

  it('still draws a closed pool, and draws nothing from one the host does not know', async () => {
    const secret = generateSecretKey()
    const good = await signEntryMember({ pool: H, page: hexOf('a'), name: 'Ana', title: 'Soup', content: 'x', createdAt: NOW }, secret)
    if (!good.ok) throw new Error('could not sign')
    const members = new Map([[good.name, good.body]])
    expect((await readEntryPool(path, H, hostWith(members, { state: 'closed' }))).rows).toHaveLength(1)
    const unknown = await readEntryPool(path, H, hostWith(members, { state: '' }))
    expect(unknown).toMatchObject({ reached: true, state: null, rows: [] })
  })

  it('answers unreached when the host does not answer, and never throws', async () => {
    const read = await readEntryPool(path, H, { fetch: async () => { throw new Error('offline') } })
    expect(read).toMatchObject({ reached: false, state: null, rows: [] })
  })
})

describe('what the review found', () => {
  it('offers no page with a host label, or a try- label, anywhere in its host', () => {
    for (const page of ['host.example.com', 'kitchen.host.example.com', 'try-example.com', 'kitchen.try-example.com', 'https://a.try-b.example.com/soup']) {
      expect(isOfferablePage(page)).toBe(false)
    }
    for (const page of ['example.com', 'https://class.example.com/soup', 'hostess.example.com', 'try.example.com', 'trying.example.com']) {
      expect(isOfferablePage(page)).toBe(true)
    }
  })

  it('carries the page in the opening record when there is one, and reads a record without one as before', async () => {
    const plain = { meaning: 'recipe:entry', title: 'Tuesday class', template: hexOf('7'), by: P, until }
    // The shared vector's record has no page, and is spelled as it always was.
    expect(new TextDecoder().decode(entryRecordBytes(plain))).not.toContain('page')
    expect(await parseEntryRecord(enc.encode(vector.record), O)).toMatchObject({ ok: true })
    const bytes = entryRecordBytes({ ...plain, page: 'https://class.example.com' })
    expect(await parseEntryRecord(bytes)).toMatchObject({ ok: true, record: { page: 'https://class.example.com' } })
    for (const page of ['', ' class.example.com', 'not a page', 'x'.repeat(300) + '.com', 7]) {
      const odd = enc.encode(new TextDecoder().decode(bytes).replace('"https://class.example.com"', JSON.stringify(page)))
      expect(await parseEntryRecord(odd)).toMatchObject({ ok: false })
    }
  })

  it('measures the host\'s time against when the listing arrived, not after the members were read', async () => {
    let clock = (NOW - 20) * 1000
    const secret = generateSecretKey()
    const good = await signEntryMember({ pool: H, page: hexOf('a'), name: 'Ana', title: 'Soup', content: 'x', createdAt: NOW }, secret)
    if (!good.ok) throw new Error('could not sign')
    const fetch = async (url: string): Promise<Response> => {
      const at = new URL(url)
      if (at.pathname === `/${A}/`) return new Response(`${good.name}\n`, { status: 200, headers: { 'X-Entries-State': 'open', 'X-Host-Time': String(NOW) } })
      // Each member read takes a slow minute.
      clock += 60_000
      return new Response(good.body.slice())
    }
    const path = { page: 'class.example.com', address: A, by: P, until }
    const listing = await readEntryListing(path, { fetch, now: () => clock })
    expect(listing.readAt).toBe((NOW - 20) * 1000)
    const read = await readEntryPool(path, H, { fetch, now: () => clock })
    expect(read.offset).toBe(20)
    expect(read.members?.map(member => member.name)).toEqual([good.name])
  })

  it('tells a host that did not answer from one that holds nothing by that name', async () => {
    const page = 'class.example.com'
    expect(await readEntryAtomAnswer(page, hexOf('1'), 64, { fetch: async () => { throw new Error('offline') } })).toEqual({ bytes: null, reached: false })
    expect(await readEntryAtomAnswer(page, hexOf('1'), 64, { fetch: async () => new Response('busy', { status: 503 }) })).toEqual({ bytes: null, reached: false })
    expect(await readEntryAtomAnswer(page, hexOf('1'), 64, { fetch: async () => new Response('no', { status: 404 }) })).toEqual({ bytes: null, reached: true })
    const bytes = enc.encode('an atom')
    const sig = await sign(bytes)
    const found = await readEntryAtomAnswer(page, sig, 64, { fetch: async () => new Response(bytes.slice()) })
    expect(found.bytes && new TextDecoder().decode(found.bytes)).toBe('an atom')
  })
})
