import { describe, expect, it } from 'vitest'
import { SignatureService } from './signature.service.js'
import {
  SEAL_OVERHEAD_BYTES,
  isSalted,
  isSealed,
  needsSecret,
  openAtom,
  openWithSecret,
  sealAtom,
  sealToSecret,
} from './content-cipher.js'

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)
const text = (data: Uint8Array): string => new TextDecoder().decode(data)

describe('content cipher', () => {
  it('is convergent — the same plaintext seals to the same signature', async () => {
    // THE property. Everything downstream (dedup, byte-identical mirrors, a
    // root sig that resolves on any host) is this one fact restated.
    const a = await sealAtom(bytes('the hive is yours'))
    const b = await sealAtom(bytes('the hive is yours'))

    expect(Array.from(a.bytes)).toEqual(Array.from(b.bytes))
    expect(await SignatureService.sign(a.bytes.slice().buffer))
      .toBe(await SignatureService.sign(b.bytes.slice().buffer))
  })

  it('round-trips through its own key', async () => {
    const sealed = await sealAtom(bytes('a node is a folder'))
    expect(text((await openAtom(sealed.bytes, sealed.key))!)).toBe('a node is a folder')
  })

  it('gives different plaintexts different signatures', async () => {
    const a = await sealAtom(bytes('one'))
    const b = await sealAtom(bytes('two'))
    expect(Array.from(a.bytes)).not.toEqual(Array.from(b.bytes))
  })

  it('refuses a wrong key without throwing', async () => {
    const sealed = await sealAtom(bytes('secret'))
    const wrong = await sealAtom(bytes('other'))
    expect(await openAtom(sealed.bytes, wrong.key)).toBeNull()
  })

  it('refuses a tampered atom — the tag is the gate, not the header', async () => {
    const sealed = await sealAtom(bytes('untouched'))
    const tampered = sealed.bytes.slice()
    tampered[tampered.length - 1] ^= 0xff
    expect(await openAtom(tampered, sealed.key)).toBeNull()
  })

  it('reports a plaintext atom as unsealed and declines to open it', async () => {
    // Sealed and plaintext atoms sit side by side in one store; the bytes have
    // to answer for themselves without a registry saying which is which.
    const plain = bytes('this was never sealed, it is just content')
    expect(isSealed(plain)).toBe(false)
    expect(await openAtom(plain, new Uint8Array(32))).toBeNull()
  })

  describe('a per-hive secret', () => {
    it('closes the confirmation oracle — a guessed plaintext no longer matches', async () => {
      const guessed = await sealAtom(bytes('dolphin'))
      const salted = await sealAtom(bytes('dolphin'), { secret: bytes('hive-secret') })
      expect(Array.from(salted.bytes)).not.toEqual(Array.from(guessed.bytes))
    })

    it('ends cross-participant dedup, which is the cost of closing it', async () => {
      const mine = await sealAtom(bytes('shared file'), { secret: bytes('my-hive') })
      const yours = await sealAtom(bytes('shared file'), { secret: bytes('your-hive') })
      expect(Array.from(mine.bytes)).not.toEqual(Array.from(yours.bytes))
    })

    it('stays convergent WITHIN one hive', async () => {
      const a = await sealAtom(bytes('shared file'), { secret: bytes('my-hive') })
      const b = await sealAtom(bytes('shared file'), { secret: bytes('my-hive') })
      expect(Array.from(a.bytes)).toEqual(Array.from(b.bytes))
    })

    it('marks itself, so a key offer can know the secret is also needed', async () => {
      expect(isSalted((await sealAtom(bytes('x'), { secret: bytes('s') })).bytes)).toBe(true)
      expect(isSalted((await sealAtom(bytes('x'))).bytes)).toBe(false)
    })
  })

  it('seals an empty atom', async () => {
    const sealed = await sealAtom(new Uint8Array(0))
    expect(sealed.bytes.byteLength).toBe(SEAL_OVERHEAD_BYTES)
    expect((await openAtom(sealed.bytes, sealed.key))!.byteLength).toBe(0)
  })

  it('seals exactly the view it was given, not the buffer behind it', async () => {
    // A Uint8Array is often a window onto a larger buffer. `subtle` takes the
    // whole underlying buffer, so a naive implementation encrypts its
    // neighbours and convergence quietly stops holding.
    const backing = bytes('PADDINGpayloadPADDING')
    const windowed = backing.subarray(7, 14)
    const sealed = await sealAtom(windowed)
    const direct = await sealAtom(bytes('payload'))

    expect(Array.from(sealed.bytes)).toEqual(Array.from(direct.bytes))
    expect(text((await openAtom(sealed.bytes, sealed.key))!)).toBe('payload')
  })

  it('adds a fixed overhead regardless of payload size', async () => {
    for (const size of [1, 1024, 64 * 1024]) {
      const sealed = await sealAtom(new Uint8Array(size))
      expect(sealed.bytes.byteLength).toBe(size + SEAL_OVERHEAD_BYTES)
    }
  })
})

describe('the door — a secret-held key', () => {
  const token = bytes('a-capability-token')

  it('opens with the secret alone, knowing nothing about the content', async () => {
    // THE point. An atom key is derived from its plaintext, so it cannot be
    // the way in — you would need what you are trying to read. A visitor
    // holding a token has only the token.
    const sealed = await sealToSecret(bytes('{"closure":["a"],"keys":{}}'), token)
    expect(text((await openWithSecret(sealed, token))!)).toBe('{"closure":["a"],"keys":{}}')
  })

  it('refuses a wrong secret', async () => {
    const sealed = await sealToSecret(bytes('private'), token)
    expect(await openWithSecret(sealed, bytes('other-token'))).toBeNull()
  })

  it('is idempotent — re-sealing the same bytes gives the same atom', async () => {
    // A derived nonce, not a random one: re-publishing unchanged content must
    // not mint a new signature every time.
    const a = await sealToSecret(bytes('index v1'), token)
    const b = await sealToSecret(bytes('index v1'), token)
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('never repeats a nonce across different payloads under one secret', async () => {
    // The key is FIXED per secret, so a repeated nonce here would be the fatal
    // GCM failure. The nonce varies with the content to prevent exactly that.
    const nonceOf = (sealed: Uint8Array): string => Array.from(sealed.subarray(5, 17)).join(',')
    const a = await sealToSecret(bytes('index v1'), token)
    const b = await sealToSecret(bytes('index v2'), token)
    expect(nonceOf(a)).not.toBe(nonceOf(b))
  })

  it('announces that it needs a secret, so a reader can ask for the token', async () => {
    const door = await sealToSecret(bytes('index'), token)
    const atom = await sealAtom(bytes('content'))
    expect(needsSecret(door)).toBe(true)
    expect(needsSecret(atom.bytes)).toBe(false)
    expect(isSealed(door)).toBe(true)
  })

  it('keeps the two key kinds apart — neither opens the other', async () => {
    const door = await sealToSecret(bytes('index'), token)
    const atom = await sealAtom(bytes('content'))
    expect(await openAtom(door, token)).toBeNull()
    expect(await openWithSecret(atom.bytes, token)).toBeNull()
  })

  it('carries the whole closure — one door, then ordinary atoms', async () => {
    // The shape the two halves make together: seal content convergently, list
    // it in an index, seal the index to the token. A holder walks in.
    const page = bytes('<h1>discreet</h1>')
    const sealedPage = await sealAtom(page)
    const pageSig = await SignatureService.sign(sealedPage.bytes.slice().buffer)

    const index = bytes(JSON.stringify({ [pageSig]: Array.from(sealedPage.key) }))
    const door = await sealToSecret(index, token)

    const opened = JSON.parse(text((await openWithSecret(door, token))!)) as Record<string, number[]>
    const key = new Uint8Array(opened[pageSig]!)
    expect(text((await openAtom(sealedPage.bytes, key))!)).toBe('<h1>discreet</h1>')
  })
})
