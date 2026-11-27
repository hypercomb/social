// pools/room-entries.spec.ts : entries a room keeps together, against a fake
// host that holds atoms by signature and members by address. No network and no
// IoC: every external is injected. Each test meets in its own room, because a
// member once read is remembered for the page (its bytes hash to its name).

import { describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { SignatureService } from '@hypercomb/core'
import { memberTemplate, readMember, roomPoolAddress } from '../sharing/room-pool.js'
import {
  readRoomEntries,
  roomAtom,
  roomEntriesAddress,
  roomEntryNode,
  roomStanding,
  shareRoomEntry,
  type RoomEntriesDeps,
  type RoomHostAnswer,
} from './room-entries.js'

const MEANING = 'recipe:entry'
const HOST = 'class.example'
const SECRET = 'chalk'
const enc = new TextEncoder()
const sign = (bytes: Uint8Array): Promise<string> => SignatureService.sign(bytes.slice().buffer as ArrayBuffer)
const atomOf = async (text: string): Promise<{ sig: string; bytes: Uint8Array }> => {
  const bytes = enc.encode(text)
  return { sig: await sign(bytes), bytes }
}
const pageOf = (ch: string): string => ch.repeat(64)

let rooms = 0
const freshRoom = (): string => `room-${++rooms}`

/** The room's host: a heap of atoms, members per address, and a log of every write in the order it arrived. */
const hostWorld = () => {
  const atoms = new Map<string, Uint8Array>()
  const members = new Map<string, Map<string, Uint8Array>>()
  const log: string[] = []
  let refusing: Exclude<RoomHostAnswer, { ok: true }> | null = null
  return {
    atoms,
    members,
    log,
    refuse: (answer: Exclude<RoomHostAnswer, { ok: true }> | null): void => { refusing = answer },
    putAtom: async (_host: string, sig: string, bytes: Uint8Array): Promise<RoomHostAnswer> => {
      if (refusing) return refusing
      atoms.set(sig, bytes)
      log.push(`atom ${sig}`)
      return { ok: true }
    },
    putMember: async (_host: string, address: string, name: string, bytes: Uint8Array): Promise<RoomHostAnswer> => {
      if (refusing) return refusing
      const held = members.get(address) ?? new Map<string, Uint8Array>()
      held.set(name, bytes)
      members.set(address, held)
      log.push(`member ${name}`)
      return { ok: true }
    },
    listing: async (_host: string, address: string): Promise<string | null> => {
      const held = members.get(address)
      return held ? [...held.keys()].join('\n') : null
    },
    member: async (_host: string, address: string, name: string): Promise<Uint8Array | null> => members.get(address)?.get(name) ?? null,
    atom: async (_host: string, sig: string): Promise<Uint8Array | null> => atoms.get(sig) ?? null,
  }
}

/** One participant in a room on that host: their own key, their own store, their own clock. */
const participant = (host: ReturnType<typeof hostWorld>, room: string, label = '') => {
  const key = generateSecretKey()
  const pubkey = getPublicKey(key)
  const store = new Map<string, Uint8Array>()
  const clock = { ms: 1_800_000_000_000 }
  const deps: RoomEntriesDeps = {
    joined: () => true,
    room: () => room,
    secret: () => SECRET,
    host: () => HOST,
    signer: () => ({
      signEvent: async evt => finalizeEvent(evt, key) as unknown as Record<string, unknown>,
      knownPublicKeyHex: async () => pubkey,
    }),
    bytesOf: async sig => store.get(sig) ?? null,
    putAtom: host.putAtom,
    putMember: host.putMember,
    listing: host.listing,
    member: host.member,
    atom: host.atom,
    myName: () => label,
    now: () => clock.ms,
  }
  const keep = async (text: string): Promise<string> => {
    const atom = await atomOf(text)
    store.set(atom.sig, atom.bytes)
    return atom.sig
  }
  return { key, pubkey, store, clock, deps, keep }
}

describe('roomEntriesAddress', () => {
  it('is one address per meaning, room, secret and host, and none without a room to address', async () => {
    const address = await roomEntriesAddress(MEANING, 'Lecture', SECRET, HOST)
    expect(address).toMatch(/^[0-9a-f]{64}$/)
    expect(await roomEntriesAddress(MEANING, 'lecture', SECRET, 'CLASS.EXAMPLE')).toBe(address)
    expect(await roomEntriesAddress('recipe:template', 'lecture', SECRET, HOST)).not.toBe(address)
    expect(await roomEntriesAddress(MEANING, 'seminar', SECRET, HOST)).not.toBe(address)
    expect(await roomEntriesAddress(MEANING, 'lecture', 'other', HOST)).not.toBe(address)
    expect(await roomEntriesAddress(MEANING, 'lecture', SECRET, 'other.example')).not.toBe(address)
    expect(await roomEntriesAddress(MEANING, 'lecture', SECRET, '')).toBe('')
    expect(await roomEntriesAddress(MEANING, '', SECRET, HOST)).toBe('')
    expect(await roomEntriesAddress(MEANING, 'lecture', '', HOST)).toBe('')
    expect(await roomEntriesAddress('recipes', 'lecture', SECRET, HOST)).toBe('')
  })

  it('is never the address of the room\'s pages', async () => {
    expect(await roomEntriesAddress(MEANING, 'lecture', SECRET, HOST)).not.toBe(await roomPoolAddress('lecture', SECRET, HOST))
  })
})

describe('shareRoomEntry', () => {
  it('sends the closure, then the head, then a member every reader accepts', async () => {
    const host = hostWorld()
    const room = freshRoom()
    const ana = participant(host, room, 'Ana Lopez')
    const picture = await ana.keep('a picture')
    const head = await ana.keep('{"recipe:entry":1,"name":"Soup"}')

    const shared = await shareRoomEntry(MEANING, { head, page: pageOf('a'), closure: [picture] }, ana.deps)
    expect(shared).toEqual({ ok: true, host: HOST, kept: true })

    expect(host.log.slice(0, 2)).toEqual([`atom ${picture}`, `atom ${head}`])
    expect(host.log).toHaveLength(3)
    const name = (host.log[2] as string).replace('member ', '')
    const address = await roomEntriesAddress(MEANING, room, SECRET, HOST)
    const bytes = host.members.get(address)?.get(name) as Uint8Array
    expect(await readMember(address, name, bytes)).toMatchObject({ name, signer: ana.pubkey, head, page: pageOf('a') })
  })

  it('refuses when the tab is not joined, when the room has no host, and when the meaning has no colon', async () => {
    const host = hostWorld()
    const ana = participant(host, freshRoom())
    const head = await ana.keep('an entry')
    const input = { head, page: pageOf('a') }

    const away = await shareRoomEntry(MEANING, input, { ...ana.deps, joined: () => false })
    const nowhere = await shareRoomEntry(MEANING, input, { ...ana.deps, host: () => '' })
    const unnamed = await shareRoomEntry('recipes', input, ana.deps)
    for (const answer of [away, nowhere, unnamed]) {
      expect(answer.ok).toBe(false)
      expect(answer).not.toHaveProperty('live')
      expect((answer as { reason: string }).reason.length).toBeGreaterThan(10)
    }
    expect(host.log).toEqual([])
  })

  it('refuses an entry that is not a signature, and one whose bytes are not held here', async () => {
    const host = hostWorld()
    const ana = participant(host, freshRoom())
    expect((await shareRoomEntry(MEANING, { head: 'soup', page: pageOf('a') }, ana.deps)).ok).toBe(false)
    expect((await shareRoomEntry(MEANING, { head: pageOf('c'), page: pageOf('a') }, ana.deps)).ok).toBe(false)
    expect(host.log).toEqual([])
  })

  it('answers live, in words, when the host does not admit the key', async () => {
    const host = hostWorld()
    const ana = participant(host, freshRoom())
    const head = await ana.keep('an entry')
    host.refuse({ ok: false, status: 403, said: 'this host keeps bytes for its own people only\nask its operator to add your key' })

    const shared = await shareRoomEntry(MEANING, { head, page: pageOf('a') }, ana.deps)
    expect(shared).toMatchObject({ ok: false, live: true })
    const reason = (shared as { reason: string }).reason
    expect(reason).toContain(HOST)
    expect(reason).toContain('this host keeps bytes for its own people only ask its operator to add your key')
    expect(reason).toContain('shared live while you are here')
    expect(host.log).toEqual([])
  })

  it('answers live when only the member is refused, and plainly when the host said nothing', async () => {
    const host = hostWorld()
    const ana = participant(host, freshRoom())
    const head = await ana.keep('an entry')
    const shared = await shareRoomEntry(MEANING, { head, page: pageOf('a') }, {
      ...ana.deps,
      putMember: async () => ({ ok: false, status: 401 }),
    })
    expect(shared).toMatchObject({ ok: false, live: true })
    expect((shared as { reason: string }).reason).toContain('keeps entries only for its own people.')
    expect(host.log).toEqual([`atom ${head}`])
  })

  it('is not live when the host never answered, or refused for another reason', async () => {
    const host = hostWorld()
    const ana = participant(host, freshRoom())
    const head = await ana.keep('an entry')

    host.refuse({ ok: false })
    const silent = await shareRoomEntry(MEANING, { head, page: pageOf('a') }, ana.deps)
    expect(silent.ok).toBe(false)
    expect(silent).not.toHaveProperty('live')
    expect((silent as { reason: string }).reason).toContain('did not answer')

    host.refuse({ ok: false, status: 413, said: 'too large' })
    const large = await shareRoomEntry(MEANING, { head, page: pageOf('a') }, ana.deps)
    expect(large).not.toHaveProperty('live')
    expect((large as { reason: string }).reason).toContain('too large')
  })

  it('never throws, whatever a collaborator does', async () => {
    const host = hostWorld()
    const ana = participant(host, freshRoom())
    const head = await ana.keep('an entry')
    const broken = await shareRoomEntry(MEANING, { head, page: pageOf('a') }, {
      ...ana.deps,
      signer: () => ({ signEvent: async () => { throw new Error('no key') } }),
    })
    expect(broken.ok).toBe(false)
    const thrown = await shareRoomEntry(MEANING, { head, page: pageOf('a') }, { ...ana.deps, host: () => { throw new Error('no mesh') } })
    expect(thrown.ok).toBe(false)
  })

  it('takes shares one at a time, in the order they were made', async () => {
    const host = hostWorld()
    const ana = participant(host, freshRoom())
    const first = await ana.keep('first')
    const second = await ana.keep('second')
    const slow = { ...ana.deps, putAtom: async (h: string, sig: string, bytes: Uint8Array) => { await new Promise(done => setTimeout(done, 15)); return host.putAtom(h, sig, bytes) } }

    await Promise.all([
      shareRoomEntry(MEANING, { head: first, page: pageOf('a') }, slow),
      shareRoomEntry(MEANING, { head: second, page: pageOf('b') }, ana.deps),
    ])
    expect(host.log.map(line => line.split(' ')[0])).toEqual(['atom', 'member', 'atom', 'member'])
    expect(host.log[0]).toBe(`atom ${first}`)
    expect(host.log[2]).toBe(`atom ${second}`)
  })
})

describe('readRoomEntries', () => {
  it('keeps the newest per signer and page, newest first, and marks the reader\'s own', async () => {
    const host = hostWorld()
    const room = freshRoom()
    const ana = participant(host, room, 'Ana Lopez')
    const ben = participant(host, room, 'Ben')

    const draft = await ana.keep('soup, draft')
    const soup = await ana.keep('soup')
    const bread = await ana.keep('bread')
    const stew = await ben.keep('stew')
    await shareRoomEntry(MEANING, { head: draft, page: pageOf('a') }, ana.deps)
    ana.clock.ms += 10_000
    await shareRoomEntry(MEANING, { head: soup, page: pageOf('a') }, ana.deps)
    ana.clock.ms += 10_000
    await shareRoomEntry(MEANING, { head: bread, page: pageOf('b') }, ana.deps)
    ben.clock.ms += 15_000
    await shareRoomEntry(MEANING, { head: stew, page: pageOf('a') }, ben.deps)

    const read = await readRoomEntries(MEANING, ben.deps)
    expect(read.map(entry => entry.head)).toEqual([bread, stew, soup])
    expect(read.map(entry => entry.you)).toEqual([false, true, false])
    expect(read.map(entry => entry.name)).toEqual(['Ana Lopez', 'Ben', 'Ana Lopez'])
    expect(new TextDecoder().decode(read[2]?.bytes)).toBe('soup')
    expect(read[0]?.signer).toBe(ana.pubkey)

    expect(roomEntryNode(read[0]!)).toEqual({ kind: 'participant', id: ana.pubkey, name: 'Ana Lopez' })
    expect(roomEntryNode(read[1]!)).toEqual({ kind: 'participant', id: ben.pubkey, name: 'Ben', you: true })
  })

  it('reads an entry back after its maker has left: the reader needs only the room', async () => {
    const host = hostWorld()
    const room = freshRoom()
    const ana = participant(host, room, 'Ana')
    await shareRoomEntry(MEANING, { head: await ana.keep('soup'), page: pageOf('a') }, ana.deps)

    const late = participant(host, room, 'Late')
    const read = await readRoomEntries(MEANING, late.deps)
    expect(read).toHaveLength(1)
    expect(read[0]).toMatchObject({ signer: ana.pubkey, name: 'Ana', you: false })
  })

  it('drops an entry its maker took back, even in the same second', async () => {
    const host = hostWorld()
    const room = freshRoom()
    const ana = participant(host, room)
    const soup = await ana.keep('soup')
    const bread = await ana.keep('bread')
    await shareRoomEntry(MEANING, { head: soup, page: pageOf('a') }, ana.deps)
    await shareRoomEntry(MEANING, { head: bread, page: pageOf('b') }, ana.deps)
    const before = host.log.length
    expect(await shareRoomEntry(MEANING, { head: soup, page: pageOf('a'), gone: true }, ana.deps)).toMatchObject({ ok: true })
    expect(host.log.slice(before).map(line => line.split(' ')[0])).toEqual(['member'])

    const read = await readRoomEntries(MEANING, participant(host, room).deps)
    expect(read.map(entry => entry.head)).toEqual([bread])
  })

  it('drops a member whose head bytes do not hash to the head, and a head over the size cap', async () => {
    const host = hostWorld()
    const room = freshRoom()
    const ana = participant(host, room)
    const soup = await ana.keep('soup')
    const forged = await ana.keep('bread')
    const large = await ana.keep('x'.repeat(3000))
    await shareRoomEntry(MEANING, { head: soup, page: pageOf('a') }, ana.deps)
    await shareRoomEntry(MEANING, { head: forged, page: pageOf('b') }, ana.deps)
    await shareRoomEntry(MEANING, { head: large, page: pageOf('c') }, ana.deps)
    host.atoms.set(forged, enc.encode('not bread'))

    const reader = participant(host, room)
    expect((await readRoomEntries(MEANING, reader.deps)).map(entry => entry.head)).toEqual([soup])
    expect((await readRoomEntries(MEANING, reader.deps, { maxHeadBytes: 4096 })).map(entry => entry.head).sort()).toEqual([soup, large].sort())
  })

  it('ignores a member signed for another address, and bytes that are not a member', async () => {
    const host = hostWorld()
    const room = freshRoom()
    const ana = participant(host, room)
    const soup = await ana.keep('soup')
    await shareRoomEntry(MEANING, { head: soup, page: pageOf('a') }, ana.deps)

    const address = await roomEntriesAddress(MEANING, room, SECRET, HOST)
    const elsewhere = await roomEntriesAddress(MEANING, 'another-room', SECRET, HOST)
    const stray = enc.encode(JSON.stringify(finalizeEvent(memberTemplate(elsewhere, pageOf('d'), soup, 1_900_000_000), generateSecretKey())))
    const junk = enc.encode('not an event')
    const held = host.members.get(address) as Map<string, Uint8Array>
    held.set(await sign(stray), stray)
    held.set(await sign(junk), junk)
    held.set(pageOf('e'), stray)

    const read = await readRoomEntries(MEANING, participant(host, room).deps)
    expect(read.map(entry => entry.head)).toEqual([soup])
  })

  it('carries the maker\'s name as one line of at most 48 characters, and none when they gave none', async () => {
    const host = hostWorld()
    const room = freshRoom()
    const ana = participant(host, room, 'room name')
    const ben = participant(host, room)
    const long = `  Ana  Maria\n${'L'.repeat(80)}  `
    await shareRoomEntry(MEANING, { head: await ana.keep('soup'), page: pageOf('a'), name: long }, ana.deps)
    await shareRoomEntry(MEANING, { head: await ben.keep('stew'), page: pageOf('a') }, ben.deps)

    const read = await readRoomEntries(MEANING, participant(host, room).deps)
    const fromAna = read.find(entry => entry.signer === ana.pubkey)
    const fromBen = read.find(entry => entry.signer === ben.pubkey)
    expect(fromAna?.name).toBe(`Ana Maria ${'L'.repeat(38)}`)
    expect(Array.from(fromAna?.name ?? '')).toHaveLength(48)
    expect(fromBen).not.toHaveProperty('name')
    expect(roomEntryNode(fromBen!)).toEqual({ kind: 'participant', id: ben.pubkey })
  })

  it('answers nothing when not joined, when the host lists nothing, and when a collaborator throws', async () => {
    const host = hostWorld()
    const room = freshRoom()
    const ana = participant(host, room)
    await shareRoomEntry(MEANING, { head: await ana.keep('soup'), page: pageOf('a') }, ana.deps)

    expect(await readRoomEntries(MEANING, { ...ana.deps, joined: () => false })).toEqual([])
    expect(await readRoomEntries(MEANING, { ...ana.deps, listing: async () => null })).toEqual([])
    expect(await readRoomEntries(MEANING, { ...ana.deps, listing: async () => { throw new Error('down') } })).toEqual([])
    expect(await readRoomEntries('recipes', ana.deps)).toEqual([])
    expect(await readRoomEntries(MEANING, ana.deps)).toHaveLength(1)
  })

  it('no one key crowds the rest out of a read: a stamp ahead of the clock counts as now, and the cut is taken a signer at a time', async () => {
    const host = hostWorld()
    const room = freshRoom()
    const honest: string[] = []
    for (let n = 0; n < 20; n++) {
      const one = participant(host, room, `p${n}`)
      one.clock.ms += n * 1000
      const head = await one.keep(`entry ${n}`)
      await shareRoomEntry(MEANING, { head, page: pageOf('a') }, one.deps)
      honest.push(head)
    }
    // One key that holds the room's secret signs with its own tooling: as many members as one read
    // takes, each of another page, every one stamped far ahead of the room's clock.
    const loud = participant(host, room, 'loud')
    const flood = await loud.keep('the same entry, again and again')
    host.atoms.set(flood, loud.store.get(flood) as Uint8Array)
    const address = await roomEntriesAddress(MEANING, room, SECRET, HOST)
    const held = host.members.get(address) as Map<string, Uint8Array>
    for (let n = 0; n < 256; n++) {
      const page = n.toString(16).padStart(64, '0')
      const bytes = enc.encode(JSON.stringify(finalizeEvent(memberTemplate(address, page, flood, 4_102_444_800), loud.key)))
      held.set(await sign(bytes), bytes)
    }

    // One read takes 256 members it has not read before: the second has read all 276.
    const reader = participant(host, room)
    await readRoomEntries(MEANING, reader.deps)
    const read = await readRoomEntries(MEANING, reader.deps)
    expect(read).toHaveLength(256)
    // Every other participant's entry is still read.
    expect(honest.filter(head => read.some(entry => entry.head === head))).toEqual(honest)
    expect(read.filter(entry => entry.signer === loud.pubkey)).toHaveLength(236)
    // A stamp ahead of the clock is read as now, never as a time to come.
    const nowSeconds = Math.floor(reader.clock.ms / 1000)
    expect(Math.max(...read.map(entry => entry.at))).toBeLessThanOrEqual(nowSeconds + 19)
    expect(read.filter(entry => entry.signer === loud.pubkey).every(entry => entry.at === nowSeconds)).toBe(true)
    // Still newest first.
    expect(read.map(entry => entry.at)).toEqual([...read.map(entry => entry.at)].sort((a, b) => b - a))
  }, 30_000) // signs a few hundred members: slow on a loaded machine, not a slow path

  it('stops reading a member or an entry that runs past its size, instead of holding it whole', async () => {
    const host = hostWorld()
    const room = freshRoom()
    const ana = participant(host, room)
    const soup = await ana.keep('soup')
    await shareRoomEntry(MEANING, { head: soup, page: pageOf('a') }, ana.deps)
    const address = await roomEntriesAddress(MEANING, room, SECRET, HOST)
    const [name, member] = [...(host.members.get(address) as Map<string, Uint8Array>)][0] as [string, Uint8Array]

    // The room's host answers the entry with a body that states no length and does not end at 2 KB.
    const seen = { pulled: 0, cancelled: false }
    const endless = (): Response => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (seen.pulled >= 2000) { controller.close(); return }
        seen.pulled++
        controller.enqueue(new Uint8Array(1024))
      },
      cancel() { seen.cancelled = true },
    }, { highWaterMark: 0 }))
    const origin = `https://${HOST}`
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === `${origin}/${address}/${name}`) return new Response(member.slice().buffer as ArrayBuffer)
      if (url === `${origin}/${soup}?held`) return endless()
      return new Response('', { status: 404 })
    }))
    try {
      const reader = participant(host, room)
      const { member: _member, atom: _atom, ...overTheWire } = reader.deps
      expect(await readRoomEntries(MEANING, overTheWire)).toEqual([])
      // 2 KB fits in two pieces: the read lets go at the third, far short of the two thousand on offer.
      expect(seen.pulled).toBeLessThanOrEqual(5)
      expect(seen.cancelled).toBe(true)
    } finally { vi.unstubAllGlobals() }
  })

  it('fetches a member once: a second read asks the host only for what is new', async () => {
    const host = hostWorld()
    const room = freshRoom()
    const ana = participant(host, room)
    await shareRoomEntry(MEANING, { head: await ana.keep('soup'), page: pageOf('a') }, ana.deps)

    const reader = participant(host, room)
    let asked = 0
    const counting: RoomEntriesDeps = { ...reader.deps, member: (h, address, name) => { asked++; return host.member(h, address, name) } }
    await readRoomEntries(MEANING, counting)
    expect(asked).toBe(1)
    ana.clock.ms += 10_000
    await shareRoomEntry(MEANING, { head: await ana.keep('bread'), page: pageOf('b') }, ana.deps)
    expect(await readRoomEntries(MEANING, counting)).toHaveLength(2)
    expect(asked).toBe(2)
  })
})

describe('roomAtom and roomStanding', () => {
  it('reads one verified atom from the room\'s host, within a size', async () => {
    const host = hostWorld()
    const ana = participant(host, freshRoom())
    const picture = await atomOf('a picture')
    host.atoms.set(picture.sig, picture.bytes)
    host.atoms.set(pageOf('f'), enc.encode('not what was asked'))

    expect(new TextDecoder().decode((await roomAtom(picture.sig, 1024, ana.deps)) as Uint8Array)).toBe('a picture')
    expect(await roomAtom(picture.sig, 4, ana.deps)).toBeNull()
    expect(await roomAtom(pageOf('f'), 1024, ana.deps)).toBeNull()
    expect(await roomAtom('soup', 1024, ana.deps)).toBeNull()
    expect(await roomAtom(picture.sig, 1024, { ...ana.deps, joined: () => false })).toBeNull()
  })

  it('says where the tab stands, and never the secret', () => {
    const host = hostWorld()
    const room = freshRoom()
    const ana = participant(host, room)
    const standing = roomStanding(ana.deps)
    expect(standing).toEqual({ joined: true, host: HOST, room })
    expect(JSON.stringify(standing)).not.toContain(SECRET)
    expect(roomStanding({ ...ana.deps, joined: () => false, host: () => '' })).toEqual({ joined: false, host: '', room })
  })
})
