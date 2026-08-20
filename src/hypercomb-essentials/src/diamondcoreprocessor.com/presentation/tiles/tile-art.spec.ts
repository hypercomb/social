// tile-art.spec.ts — a behaviour can arrive with a picture, and an author can
// replace it, without either being a special case in the renderer.
//
// The pool holds a POINTER, never bytes. That is what makes the picture an
// ordinary content-addressed resource: deduped, cached by signature, carried
// in a backup, adopted by a peer. These pin the pointer discipline and the
// miss path, because the miss is the common answer — most tiles have no
// default art and are asked on every render pass.

import { beforeEach, describe, expect, it } from 'vitest'

const SIG = (seed: string): string => seed.repeat(64).slice(0, 64)
const ART = SIG('a')

class MemoryFile {
  #text = ''
  constructor(text = '') { this.#text = text }
  async getFile(): Promise<{ text: () => Promise<string> }> {
    return { text: async () => this.#text }
  }
  async createWritable(): Promise<{ write: (v: string) => Promise<void>; close: () => Promise<void> }> {
    return {
      write: async (value: string) => { this.#text = value },
      close: async () => void 0,
    }
  }
}

class MemoryPool {
  readonly files = new Map<string, MemoryFile>()
  async getFileHandle(name: string, opts: { create?: boolean } = {}): Promise<MemoryFile> {
    const found = this.files.get(name)
    if (found) return found
    if (!opts.create) throw new Error('NotFoundError')
    const made = new MemoryFile()
    this.files.set(name, made)
    return made
  }
}

let pool: MemoryPool | null
let poolReads: number

const install = (): void => {
  poolReads = 0
  ;(window as unknown as { ioc: unknown }).ioc = {
    get: (key: string) => key === '@hypercomb.social/Store'
      ? { getPool: async () => { poolReads++; return pool } }
      : undefined,
  }
}

let tileArtSig: typeof import('./tile-art.js').tileArtSig
let setTileArt: typeof import('./tile-art.js').setTileArt
let forgetTileArt: typeof import('./tile-art.js').forgetTileArt

beforeEach(async () => {
  pool = new MemoryPool()
  install()
  ;({ tileArtSig, setTileArt, forgetTileArt } = await import('./tile-art.js'))
  forgetTileArt()
})

describe('default tile art', () => {
  it('resolves a name to the signature the pool points at', async () => {
    pool!.files.set('folder-sync', new MemoryFile(ART))
    expect(await tileArtSig('folder-sync')).toBe(ART)
  })

  it('matches names case- and space-insensitively', async () => {
    pool!.files.set('folder-sync', new MemoryFile(ART))
    expect(await tileArtSig('  Folder-Sync  ')).toBe(ART)
  })

  it('reads a miss as no art, not as an error', async () => {
    expect(await tileArtSig('nothing-here')).toBe('')
  })

  it('caches the miss, because the miss is the common answer', async () => {
    await tileArtSig('nothing-here')
    await tileArtSig('nothing-here')
    await tileArtSig('nothing-here')
    // Asked on every render pass; the pool must be consulted once.
    expect(poolReads).toBe(1)
  })

  it('treats a member that is not a signature as no art', async () => {
    // A pointer written by hand incorrectly must read as absent, not as a
    // signature that 404s on every single render.
    pool!.files.set('bad', new MemoryFile('/images/backup.png'))
    expect(await tileArtSig('bad')).toBe('')
  })

  it('survives a store with no pool at all', async () => {
    pool = null
    expect(await tileArtSig('folder-sync')).toBe('')
  })

  it('writes a pointer and reads it straight back', async () => {
    expect(await setTileArt('folder-sync', ART)).toBe(true)
    expect(await tileArtSig('folder-sync')).toBe(ART)
    // Stored as the POINTER, not the image.
    const stored = await (await pool!.getFileHandle('folder-sync')).getFile()
    expect(await stored.text()).toBe(ART)
  })

  it('refuses to store anything that is not a signature', async () => {
    expect(await setTileArt('folder-sync', 'not-a-signature')).toBe(false)
    expect(await setTileArt('', ART)).toBe(false)
    expect(pool!.files.size).toBe(0)
  })

  it('forgets a cached answer when told to', async () => {
    expect(await tileArtSig('folder-sync')).toBe('')
    pool!.files.set('folder-sync', new MemoryFile(ART))
    // Still cached as a miss — a restore or a peer's pool arriving is exactly
    // the case that needs the invalidation.
    expect(await tileArtSig('folder-sync')).toBe('')
    forgetTileArt('folder-sync')
    expect(await tileArtSig('folder-sync')).toBe(ART)
  })
})
