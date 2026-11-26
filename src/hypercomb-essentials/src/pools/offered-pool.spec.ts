// pools/offered-pool.spec.ts : leaving a pool on a host and gathering it back,
// against a fake host that serves atoms by signature and one signed index per
// key. No network and no IoC: every collaborator is injected.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { SignatureService, registerPoolMeaning } from '@hypercomb/core'
import {
  OFFERED_MAX_MEMBERS,
  offeredListBytes,
  offeredMembersOf,
  offeredRootKey,
  publishOfferedPool,
  readOfferedPool,
  readOfferedPools,
  type OfferedPublishDeps,
  type OfferedReadIo,
} from './offered-pool.js'

const meaning = 'recipe:template'
const enc = new TextEncoder()
const sign = (bytes: Uint8Array): Promise<string> => SignatureService.sign(bytes.slice().buffer as ArrayBuffer)
const atomOf = async (text: string): Promise<{ sig: string; bytes: Uint8Array }> => {
  const bytes = enc.encode(text)
  return { sig: await sign(bytes), bytes }
}
const keyOf = (ch: string): string => ch.repeat(64)

/** A hive's side of a publish: a store, and a log of what was asked of the host in order. */
const publishWorld = (held: Map<string, Uint8Array> = new Map()) => {
  const log: string[] = []
  const deps: OfferedPublishDeps = {
    put: async bytes => { const sig = await sign(bytes); held.set(sig, bytes); log.push(`put ${sig}`); return sig },
    bytesOf: async sig => held.get(sig) ?? null,
    publish: async (host, sigs, bytesOf) => {
      for (const sig of sigs) {
        if (!await bytesOf(sig)) return { ok: false, error: `${sig.slice(0, 12)} is not held here` }
        log.push(`send ${host} ${sig}`)
      }
      return { ok: true }
    },
    stamp: async (host, key, sig) => { log.push(`stamp ${host} ${key} ${sig}`); return { ok: true } },
    clear: async (host, key) => { log.push(`clear ${host} ${key}`); return { ok: true } },
  }
  return { deps, log, held }
}

/** Hosts as a reader sees them: per host its ledger keys, per key its roots, and the atoms it serves. */
const readWorld = () => {
  const keys = new Map<string, string[]>()
  const roots = new Map<string, Record<string, string>>()
  const atoms = new Map<string, Uint8Array>()
  const asked: string[] = []
  const io: OfferedReadIo = {
    keysOf: async host => keys.get(host) ?? [],
    indexOf: async (host, pubkey) => roots.get(`${host}|${pubkey}`) ?? null,
    atom: async (host, sig) => { asked.push(`${host} ${sig}`); return atoms.get(`${host}|${sig}`) ?? null },
    own: async () => null,
  }
  /** Offer members on a host under a key: the atoms, the list, the root. */
  const offer = async (host: string, pubkey: string, texts: readonly string[], listed = meaning): Promise<string[]> => {
    const sigs: string[] = []
    for (const text of texts) {
      const atom = await atomOf(text)
      atoms.set(`${host}|${atom.sig}`, atom.bytes)
      sigs.push(atom.sig)
    }
    const list = offeredListBytes(listed, sigs)
    const listSig = await sign(list)
    atoms.set(`${host}|${listSig}`, list)
    roots.set(`${host}|${pubkey}`, { [offeredRootKey(meaning)]: listSig })
    return sigs
  }
  return { io, keys, roots, atoms, asked, offer }
}

type World = { __HC_READONLY__?: boolean; ioc?: { get(key: string): unknown } }

afterEach(() => {
  delete (globalThis as World).__HC_READONLY__
  delete (globalThis as World).ioc
  vi.unstubAllGlobals()
})

describe('the list document', () => {
  it('names its root key by the meaning', () => {
    expect(offeredRootKey(meaning)).toBe('pool:recipe:template')
  })

  it('is canonical: the meaning, then the members once each in the order given', () => {
    const a = keyOf('a')
    const b = keyOf('b')
    expect(new TextDecoder().decode(offeredListBytes(meaning, [b, a, b]))).toBe(JSON.stringify({ meaning, members: [b, a] }))
    expect(offeredMembersOf(offeredListBytes(meaning, [b, a, b]), meaning)).toEqual([b, a])
  })

  it('reads only a list of its own meaning, of signatures, within the caps', () => {
    const a = keyOf('a')
    expect(offeredMembersOf(offeredListBytes('mail:template', [a]), meaning)).toBeNull()
    expect(offeredMembersOf(enc.encode(JSON.stringify({ meaning, members: [a.toUpperCase()] })), meaning)).toBeNull()
    expect(offeredMembersOf(enc.encode(JSON.stringify({ meaning, members: 'none' })), meaning)).toBeNull()
    expect(offeredMembersOf(enc.encode(JSON.stringify([a])), meaning)).toBeNull()
    expect(offeredMembersOf(enc.encode('not json'), meaning)).toBeNull()
    const many = Array.from({ length: OFFERED_MAX_MEMBERS + 1 }, (_, at) => at.toString(16).padStart(64, '0'))
    expect(offeredMembersOf(enc.encode(JSON.stringify({ meaning, members: many })), meaning)).toBeNull()
    expect(offeredMembersOf(enc.encode(JSON.stringify({ meaning, members: [], pad: 'x'.repeat(70_000) })), meaning)).toBeNull()
  })
})

describe('publishOfferedPool', () => {
  it('sends the closure, the members and the list, then stamps the root key', async () => {
    const one = await atomOf('one')
    const two = await atomOf('two')
    const picture = await atomOf('a picture one names')
    const world = publishWorld(new Map([[one.sig, one.bytes], [two.sig, two.bytes], [picture.sig, picture.bytes]]))

    const done = await publishOfferedPool('content.example.com', meaning, [one.sig, two.sig, one.sig], { closure: [picture.sig], deps: world.deps })

    const listSig = await sign(offeredListBytes(meaning, [one.sig, two.sig]))
    expect(done).toEqual({ ok: true, host: 'example.com', meaning, count: 2 })
    expect(world.log).toEqual([
      `put ${listSig}`,
      `send example.com ${picture.sig}`,
      `send example.com ${one.sig}`,
      `send example.com ${two.sig}`,
      `send example.com ${listSig}`,
      `stamp example.com pool:recipe:template ${listSig}`,
    ])
  })

  it('stamps nothing when an atom could not be sent', async () => {
    const one = await atomOf('one')
    const world = publishWorld()
    const done = await publishOfferedPool('example.com', meaning, [one.sig], { deps: world.deps })
    expect(done.ok).toBe(false)
    expect(world.log.some(line => line.startsWith('stamp'))).toBe(false)
  })

  it('says why when the index refuses the stamp', async () => {
    const one = await atomOf('one')
    const world = publishWorld(new Map([[one.sig, one.bytes]]))
    world.deps.stamp = async () => ({ ok: false, reason: 'no signer' })
    expect(await publishOfferedPool('example.com', meaning, [one.sig], { deps: world.deps })).toEqual({ ok: false, reason: 'no signer' })
  })

  it('withdraws on no members: clears the root key and sends nothing', async () => {
    const world = publishWorld()
    const done = await publishOfferedPool('example.com', meaning, [], { deps: world.deps })
    expect(done).toEqual({ ok: true, host: 'example.com', meaning, count: 0 })
    expect(world.log).toEqual(['clear example.com pool:recipe:template'])
  })

  it('refuses a meaning without a colon, too many members, a member that is no signature, and a missing host', async () => {
    const world = publishWorld()
    const one = keyOf('a')
    const many = Array.from({ length: OFFERED_MAX_MEMBERS + 1 }, (_, at) => at.toString(16).padStart(64, '0'))
    for (const done of [
      await publishOfferedPool('example.com', 'recipes', [one], { deps: world.deps }),
      await publishOfferedPool('example.com', meaning, many, { deps: world.deps }),
      await publishOfferedPool('example.com', meaning, ['not a signature'], { deps: world.deps }),
      await publishOfferedPool('', meaning, [one], { deps: world.deps }),
      await publishOfferedPool('192.168.1.4:8080', meaning, [one], { deps: world.deps }),
    ]) {
      expect(done.ok).toBe(false)
      expect(done.ok ? '' : done.reason).not.toBe('')
    }
    expect(world.log).toEqual([])
  })

  it('refuses a visitor hive, which cannot publish', async () => {
    (globalThis as { __HC_READONLY__?: boolean }).__HC_READONLY__ = true
    const world = publishWorld()
    const done = await publishOfferedPool('example.com', meaning, [keyOf('a')], { deps: world.deps })
    expect(done).toEqual({ ok: false, reason: 'This visitor hive cannot publish.' })
    expect(world.log).toEqual([])
  })

  it('answers with words where no host service is loaded', async () => {
    expect(await publishOfferedPool('example.com', meaning, [keyOf('a')])).toEqual({ ok: false, reason: 'Host sync is unavailable.' })
  })

  it('publishes through the store and the host service of the hive when no deps are handed in', async () => {
    const one = await atomOf('one')
    const kept = new Map<string, Uint8Array>([[one.sig, one.bytes]])
    const sent: { host: string; sig: string; held: boolean }[] = []
    const services: Record<string, unknown> = {
      '@hypercomb.social/Store': {
        // jsdom's Blob has no arrayBuffer(); a FileReader reads it, as mail/template-pool.spec.ts does.
        putResource: (blob: Blob) => new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onerror = () => reject(reader.error)
          reader.onload = async () => {
            const bytes = new Uint8Array(reader.result as ArrayBuffer)
            const sig = await sign(bytes)
            kept.set(sig, bytes)
            resolve(sig)
          }
          reader.readAsArrayBuffer(blob)
        }),
        getResourceLocal: async (sig: string) => kept.has(sig) ? { arrayBuffer: async () => kept.get(sig)!.slice().buffer } : null,
      },
      '@diamondcoreprocessor.com/HostSyncService': {
        publishAtoms: async (host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>) => {
          for (const sig of sigs) sent.push({ host, sig, held: !!await bytesOf(sig) })
          return { ok: false, error: `${host} could not be reached` }
        },
      },
    }
    ;(globalThis as World).ioc = { get: key => services[key] }

    const done = await publishOfferedPool('example.com', meaning, [one.sig])

    const listSig = await sign(offeredListBytes(meaning, [one.sig]))
    expect(done).toEqual({ ok: false, reason: 'example.com could not be reached' })
    expect(sent).toEqual([{ host: 'example.com', sig: one.sig, held: true }, { host: 'example.com', sig: listSig, held: true }])
    expect(kept.has(listSig)).toBe(true)
  })
})

describe('readOfferedPool', () => {
  it('reads the list a ledger key names and every member that hashes to its name', async () => {
    const world = readWorld()
    world.keys.set('example.com', [keyOf('1')])
    const [one, two] = await world.offer('example.com', keyOf('1'), ['one', 'two'])

    const members = await readOfferedPool('example.com', meaning, { io: world.io })

    expect(members.map(member => [member.host, member.pubkey, member.sig])).toEqual([
      ['example.com', keyOf('1'), one],
      ['example.com', keyOf('1'), two],
    ])
    expect(new TextDecoder().decode(members[0]!.bytes)).toBe('one')
  })

  it('drops a forged member and a member that is too large, and keeps the rest', async () => {
    const world = readWorld()
    world.keys.set('example.com', [keyOf('1')])
    const [forged, large, good] = await world.offer('example.com', keyOf('1'), ['forged', 'x'.repeat(400), 'good'])
    world.atoms.set(`example.com|${forged}`, enc.encode('other bytes under a trusted name'))

    const members = await readOfferedPool('example.com', meaning, { io: world.io, maxMemberBytes: 100 })

    expect(members.map(member => member.sig)).toEqual([good])
    expect(members.some(member => member.sig === large)).toBe(false)
  })

  it('ignores a list of the wrong meaning, a forged list and a key that names none', async () => {
    const world = readWorld()
    world.keys.set('wrong.example', [keyOf('1')])
    await world.offer('wrong.example', keyOf('1'), ['one'], 'mail:template')
    expect(await readOfferedPool('wrong.example', meaning, { io: world.io })).toEqual([])

    world.keys.set('forged.example', [keyOf('2')])
    await world.offer('forged.example', keyOf('2'), ['one'])
    const listSig = world.roots.get(`forged.example|${keyOf('2')}`)![offeredRootKey(meaning)]!
    world.atoms.set(`forged.example|${listSig}`, offeredListBytes(meaning, [keyOf('f')]))
    expect(await readOfferedPool('forged.example', meaning, { io: world.io })).toEqual([])

    world.keys.set('silent.example', [keyOf('3')])
    expect(await readOfferedPool('silent.example', meaning, { io: world.io })).toEqual([])
  })

  it('reads the primary key first, at most eight keys, and a member once', async () => {
    const world = readWorld()
    const keys = Array.from({ length: 9 }, (_, at) => keyOf(String(at + 1)))
    world.keys.set('example.com', keys)
    const [shared] = await world.offer('example.com', keys[0]!, ['shared'])
    await world.offer('example.com', keys[1]!, ['shared', 'second'])
    await world.offer('example.com', keys[8]!, ['ninth'])

    const members = await readOfferedPool('example.com', meaning, { io: world.io })

    expect(members.map(member => new TextDecoder().decode(member.bytes))).toEqual(['shared', 'second'])
    expect(members.find(member => member.sig === shared)!.pubkey).toBe(keys[0])
  })

  it('reads the own key on the own host even when the ledger has not listed it', async () => {
    const world = readWorld()
    const [mine] = await world.offer('mine.example', keyOf('9'), ['mine'])
    world.io.own = async () => ({ host: 'content.mine.example', pubkey: keyOf('9') })

    expect((await readOfferedPool('mine.example', meaning, { io: world.io })).map(member => member.sig)).toEqual([mine])
    // The own key is asked only on the own host.
    await world.offer('other.example', keyOf('9'), ['mine'])
    expect(await readOfferedPool('other.example', meaning, { io: world.io })).toEqual([])
  })

  it('answers an unreachable host, a thrown read and a bare-word meaning with nothing', async () => {
    const world = readWorld()
    world.keys.set('example.com', [keyOf('1')])
    await world.offer('example.com', keyOf('1'), ['one'])
    expect(await readOfferedPool('example.com', 'recipes', { io: world.io })).toEqual([])
    expect(await readOfferedPool('', meaning, { io: world.io })).toEqual([])
    world.io.keysOf = async () => { throw new Error('unreachable') }
    expect(await readOfferedPool('example.com', meaning, { io: world.io })).toEqual([])
    world.io.keysOf = async () => [keyOf('1')]
    world.io.indexOf = async () => { throw new Error('unreachable') }
    expect(await readOfferedPool('example.com', meaning, { io: world.io })).toEqual([])
  })
})

describe('readOfferedPool, with nothing injected', () => {
  it('reads the ledger, the signed index, the list and the member from the host itself', async () => {
    const secret = new Uint8Array(32).fill(11)
    const pubkey = getPublicKey(secret)
    const member = await atomOf('a member the host serves')
    const list = offeredListBytes(meaning, [member.sig])
    const listSig = await sign(list)
    const index = finalizeEvent({
      kind: 30564, created_at: 1_700_000_000, tags: [],
      content: JSON.stringify({ v: 1, roots: { [offeredRootKey(meaning)]: listSig } }),
    }, secret)
    const origin = 'https://live.example'
    const served = new Map<string, () => Response>([
      [`${origin}/${await registerPoolMeaning('host:publications')}?held`, () => Response.json({ sites: [{ host: 'live.example', publishers: [{ pubkey, primary: true }] }] })],
      [`${origin}/${await registerPoolMeaning('hive:indexes')}/${pubkey}?held`, () => Response.json(index)],
      // The list only at the legacy spelling, the member at the root.
      [`${origin}/content/${listSig}`, () => new Response(list.slice().buffer as ArrayBuffer)],
      [`${origin}/${member.sig}`, () => new Response(member.bytes.slice().buffer as ArrayBuffer)],
    ])
    const asked: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      asked.push(url)
      return served.get(url)?.() ?? new Response('', { status: 404 })
    }))

    const members = await readOfferedPool('live.example', meaning)

    expect(members.map(one => [one.host, one.pubkey, one.sig])).toEqual([['live.example', pubkey, member.sig]])
    expect(new TextDecoder().decode(members[0]!.bytes)).toBe('a member the host serves')
    expect(asked).toContain(`${origin}/${listSig}`)
  })

  /** A body of `pieces` KB that states no length, counting what a reader takes from it. */
  const endless = (pieces: number) => {
    const seen = { pulled: 0, cancelled: false }
    const respond = (): Response => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (seen.pulled >= pieces) { controller.close(); return }
        seen.pulled++
        controller.enqueue(new Uint8Array(1024).fill(0x20))
      },
      cancel() { seen.cancelled = true },
    }, { highWaterMark: 0 }))
    return { seen, respond }
  }

  it('lets go of a ledger that runs past its size, instead of holding it whole', async () => {
    const ledger = endless(4000)
    const url = `https://big.example/${await registerPoolMeaning('host:publications')}?held`
    vi.stubGlobal('fetch', vi.fn(async (asked: string) => asked === url ? ledger.respond() : new Response('', { status: 404 })))

    expect(await readOfferedPool('big.example', meaning, { io: { own: async () => null } })).toEqual([])

    // A ledger is at most 1 MB: the read stops there, far short of the 4 MB on offer.
    expect(ledger.seen.pulled).toBeLessThanOrEqual(1000)
    expect(ledger.seen.cancelled).toBe(true)
  })

  it('lets go of a list or a member that runs past its size, instead of holding it whole', async () => {
    const pubkey = keyOf('1')
    const big = endless(4000)
    const member = await atomOf('a member the host serves')
    const list = offeredListBytes(meaning, [member.sig])
    const listSig = await sign(list)
    const io: OfferedReadIo = { keysOf: async () => [pubkey], indexOf: async () => ({ [offeredRootKey(meaning)]: listSig }), own: async () => null }

    // The list itself never ends: 64 KB is all that is taken of it, at either spelling.
    vi.stubGlobal('fetch', vi.fn(async () => big.respond()))
    expect(await readOfferedPool('big.example', meaning, { io })).toEqual([])
    expect(big.seen.pulled).toBeLessThanOrEqual(2 * 66)
    expect(big.seen.cancelled).toBe(true)

    // A list that reads, and a member that never ends: 256 KB is all that is taken of it, at either spelling.
    big.seen.pulled = 0
    vi.stubGlobal('fetch', vi.fn(async (asked: string) =>
      asked === `https://big.example/${listSig}` ? new Response(list.slice().buffer as ArrayBuffer) : big.respond()))
    expect(await readOfferedPool('big.example', meaning, { io })).toEqual([])
    expect(big.seen.pulled).toBeLessThanOrEqual(2 * 258)
  })
})

describe('readOfferedPools', () => {
  it('is the union across hosts: one row per signature, the first host kept, every host named', async () => {
    const world = readWorld()
    world.keys.set('a.example', [keyOf('1')])
    world.keys.set('b.example', [keyOf('2')])
    const [shared, onlyA] = await world.offer('a.example', keyOf('1'), ['shared', 'only a'])
    const [, onlyB] = await world.offer('b.example', keyOf('2'), ['shared', 'only b'])

    const union = await readOfferedPools(['a.example', 'content.b.example', 'a.example', 'silent.example'], meaning, { io: world.io })

    expect(union.map(member => [member.sig, member.host, member.hosts])).toEqual([
      [shared, 'a.example', ['a.example', 'b.example']],
      [onlyA, 'a.example', ['a.example']],
      [onlyB, 'b.example', ['b.example']],
    ])
    expect(union[0]!.pubkey).toBe(keyOf('1'))
  })

  it('asks at most sixteen hosts', async () => {
    const world = readWorld()
    const asked: string[] = []
    world.io.keysOf = async host => { asked.push(host); return [] }
    await readOfferedPools(Array.from({ length: 20 }, (_, at) => `h${at}.example`), meaning, { io: world.io })
    expect(asked).toHaveLength(16)
  })
})
