import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { DUB_POOL, type Soundbank } from './dub-bank'
import { BANKS_PER_HOST, bankFor, hostOf, publishSoundbank, readSoundbanksFrom, readTake, soundbankText, type OfferedBank } from './dub-network'

// A SOUNDBANK TRAVELS LIKE A CATALOG (jwize, 2026-11-11: "publish to our host
// pools our own dub so that people in the community can provide their own ...
// then later the participants can change their experiences").

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..', '..')
const WORKER = readFileSync(join(root, 'hypercomb-relay', 'blossom-worker', 'worker.js'), 'utf8')
const DRONE = readFileSync(join(here, 'dub.drone.ts'), 'utf8')
const QUEEN = readFileSync(join(here, 'dub.queen.ts'), 'utf8')

const sig = (character: string): string => character.repeat(64)
const sha = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')
const bank = (extra: Partial<Soundbank> = {}): Soundbank => ({
  kind: 'presentation:soundbank', v: 1, name: 'jwize', at: 5,
  voices: { [sig('a')]: { voice: sig('b'), type: 'audio/webm', seconds: 2 }, [sig('c')]: { voice: '', type: '', seconds: 0, text: 'New words.' } },
  ...extra,
})

describe('offering a soundbank to a host', () => {
  it('puts the bank, ships it with every take it names, then stamps presentation:dubs under your key', async () => {
    const calls: string[] = []
    const done = await publishSoundbank('example.com', bank(), {
      put: async (text) => { calls.push(`put ${JSON.parse(text).kind}`); return sig('d') },
      publish: async (host, sigs) => { calls.push(`publish ${host} ${sigs.join(',')}`); return { ok: true } },
      stamp: async (host, key, value) => { calls.push(`stamp ${host} ${key} ${value}`); return { ok: true } },
    })
    expect(done).toEqual({ ok: true, sig: sig('d'), takes: 1 })
    expect(calls).toEqual([
      'put presentation:soundbank',
      `publish example.com ${sig('d')},${sig('b')}`,
      `stamp example.com ${DUB_POOL} ${sig('d')}`,
    ])
  })

  it('offers nothing when there is nothing, and stamps nothing the host did not take', async () => {
    const never = async (): Promise<never> => { throw new Error('must not be called') }
    expect(await publishSoundbank('example.com', bank({ voices: {} }), { put: never, publish: never, stamp: never }))
      .toMatchObject({ ok: false })
    let stamped = false
    const refused = await publishSoundbank('example.com', bank(), {
      put: async () => sig('d'),
      publish: async () => ({ ok: false, error: 'the host is full' }),
      stamp: async () => { stamped = true; return { ok: true } },
    })
    expect(refused).toEqual({ ok: false, error: 'the host is full' })
    expect(stamped).toBe(false)
  })

  it('a bank has one spelling, so one signature wherever it is offered', () => {
    const one = bank()
    const two = bank({ voices: Object.fromEntries(Object.entries(one.voices).reverse()) })
    expect(soundbankText(one)).toBe(soundbankText(two))
  })

  it('the host lists a stamped bank in the pool of its meaning, where its operator lists that meaning', () => {
    expect(WORKER).toMatch(/const SHARED_RECORD_POOLS = new Set\(\[[^\]]*'presentation:dubs'[^\]]*\]\)/)
    // A write names its host: there is no default host to offer to.
    expect(DRONE).toMatch(/const host = zoneDoor\(rawHost\)\s+if \(!host\) \{ toast\(t\('dub\.nohost'/)
  })
})

describe('reading the banks a host carries', () => {
  const served = (files: Record<string, string | Uint8Array>): typeof fetch =>
    (async (input: RequestInfo | URL) => {
      const url = String(input)
      const hit = Object.entries(files).find(([path]) => url.endsWith(path))
      if (!hit) return new Response(null, { status: 404 })
      return new Response(hit[1] as BodyInit, { status: 200 })
    }) as typeof fetch

  it('believes a bank only when its bytes hash to the name the host listed', async () => {
    const pool = sha(DUB_POOL)
    const good = soundbankText(bank())
    const forged = soundbankText(bank({ name: 'someone else' }))
    const notABank = JSON.stringify({ kind: 'other' })
    const read = await readSoundbanksFrom('https://example.com/', served({
      [`/${pool}`]: [sha(good), sig('9'), sha(notABank)].join('\n') + '\n',
      [`/${sha(good)}`]: good,
      [`/${sig('9')}`]: forged,
      [`/${sha(notABank)}`]: notABank,
    }))
    expect(read.answered).toBe(true)
    expect(read.banks.map(offer => [offer.sig, offer.origin, offer.bank.name])).toEqual([[sha(good), 'https://example.com', 'jwize']])
    expect(read.dropped).toBe(2)
    // A host with no pool is simply not an answer.
    expect((await readSoundbanksFrom('https://nobody.example', served({}))).answered).toBe(false)
    expect(BANKS_PER_HOST).toBeLessThanOrEqual(64)
  })

  it('a take is fetched by its own signature and refused when the bytes are not it', async () => {
    const take = new Uint8Array([1, 2, 3, 4])
    const files = { [`/${sha(take)}`]: take, [`/${sig('7')}`]: take }
    expect(new Uint8Array((await readTake('https://example.com', sha(take), served(files)))!)).toEqual(take)
    expect(await readTake('https://example.com', sig('7'), served(files))).toBeNull()
    expect(await readTake('https://example.com', sig('8'), served(files))).toBeNull()
  })
})

describe('which bank fills a sentence', () => {
  const offer = (name: string, origin: string, at: number, sentences: string[]): OfferedBank => ({
    sig: sha(name), origin,
    bank: bank({ name, at, voices: Object.fromEntries(sentences.map(say => [say, { voice: sig('b'), type: '', seconds: 1 }])) }),
  })
  const home = offer('home', 'https://hypercomb.com', 1, [sig('a')])
  const homeNewer = offer('home newer', 'https://hypercomb.com', 2, [sig('a')])
  const other = offer('other', 'https://friend.example', 3, [sig('a'), sig('c')])

  it('the default is a bank from the host the page is served from, newest first', () => {
    expect(bankFor(sig('a'), [home, homeNewer, other], '', 'hypercomb.com')?.bank.name).toBe('home newer')
    // Another host's bank is never the default, however new it is.
    expect(bankFor(sig('c'), [home, other], '', 'hypercomb.com')).toBeNull()
    expect(bankFor(sig('a'), [other], '', 'hypercomb.com')).toBeNull()
    expect(bankFor(sig('a'), [home], '', '')).toBeNull()
  })

  it('a chosen bank plays where it has the sentence, and the default fills the rest', () => {
    expect(bankFor(sig('c'), [home, other], other.sig, 'hypercomb.com')?.bank.name).toBe('other')
    expect(bankFor(sig('a'), [home, other], other.sig, 'hypercomb.com')?.bank.name).toBe('other')
    const partial = offer('partial', 'https://friend.example', 9, [sig('c')])
    expect(bankFor(sig('a'), [home, partial], partial.sig, 'hypercomb.com')?.bank.name).toBe('home')
    expect(hostOf('https://Hypercomb.com/x')).toBe('hypercomb.com')
  })

  it('your own record outranks every bank, and you can choose none', () => {
    // The order is the drone's: own record, then (unless none is chosen) a bank.
    expect(DRONE).toMatch(/const own = this\.#records\.get\(key\)\s+if \(own\) \{[\s\S]{0,400}\} else if \(this\.#chosen !== NO_BANK\) \{\s+const offer = bankFor\(/)
    expect(DRONE).toContain("export const NO_BANK = '-'")
    // A bank a host offers never replaces what was already taken.
    expect(DRONE).toMatch(/if \(this\.#offered\.some\(held => held\.sig === offer\.sig\)\) continue/)
  })

  it('the bank words are acts sent once, never replayed to a bee that loads later', () => {
    for (const word of ['offer', 'sync', 'banks', 'use']) expect(QUEEN).toContain(`EffectBus.emitTransient('dub:${word}'`)
    // The switch is state; it is the only one replayed.
    expect(QUEEN).toContain("EffectBus.emit('dub:editing'")
  })
})
