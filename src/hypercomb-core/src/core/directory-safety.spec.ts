import { describe, expect, it } from 'vitest'
import {
  classifyDirectoryEntry,
  hardDeleteVeto,
  hardDeleteVetoFor,
  mayHardDelete,
} from './directory-safety.js'

const sig = (seed: string) => seed.repeat(64).slice(0, 64)
const A = sig('a')
const B = sig('b')

// A directory handle shaped like the File System Access API's.
const dirOf = (entries: Array<[string, 'file' | 'directory']>) => ({
  entries: async function* () {
    for (const [name, kind] of entries) yield [name, { kind }] as [string, { kind: string }]
  },
})

describe('classifyDirectoryEntry — the entry decides, never the directory', () => {
  it('reads an 8-digit name as a marker', () => {
    expect(classifyDirectoryEntry('00000000')).toBe('marker')
    expect(classifyDirectoryEntry('00000123')).toBe('marker')
  })

  it('separates a sig-named FILE (member) from a sig-named DIRECTORY (author bucket)', () => {
    expect(classifyDirectoryEntry(A, false)).toBe('member')
    expect(classifyDirectoryEntry(A, true)).toBe('bucket')
  })

  it('treats anything else as foreign', () => {
    expect(classifyDirectoryEntry('__bees__', true)).toBe('foreign')
    expect(classifyDirectoryEntry('0000000')).toBe('foreign')   // 7 digits
    expect(classifyDirectoryEntry('000000000')).toBe('foreign') // 9 digits
    expect(classifyDirectoryEntry(`${A}x`)).toBe('foreign')
  })
})

describe('hardDeleteVeto — a directory may be removed only if every entry is a marker', () => {
  it('allows an empty directory', () => {
    expect(hardDeleteVeto([])).toBeNull()
    expect(mayHardDelete([])).toBe(true)
  })

  it('allows a pure lineage bag — markers are the deleter\'s own history', () => {
    expect(mayHardDelete([{ name: '00000000' }, { name: '00000001' }])).toBe(true)
  })

  it('REFUSES a pool: sig-named member files are somebody else\'s content', () => {
    const veto = hardDeleteVeto([{ name: A }, { name: B }])
    expect(veto).toMatch(/2 member files/)
    expect(veto).toMatch(/shared/)
  })

  it('REFUSES a molecule: author buckets are other participants\' heads', () => {
    const veto = hardDeleteVeto([{ name: A, isDirectory: true }])
    expect(veto).toMatch(/1 author bucket/)
  })

  // The exact shape of the incident this module exists to prevent: a
  // bare-word tile whose lineage bag address is ALSO a pool/molecule address.
  // The markers are genuinely the deleter's; the members are not.
  it('REFUSES a COLLIDING address even though its markers are legitimately the deleter\'s', () => {
    const veto = hardDeleteVeto([
      { name: '00000000' },
      { name: '00000001' },
      { name: A },
      { name: B, isDirectory: true },
    ])
    expect(veto).not.toBeNull()
    expect(veto).toMatch(/1 member file/)
    expect(veto).toMatch(/1 author bucket/)
    expect(veto).toMatch(/alongside 2 markers/)
  })

  it('REFUSES an unrecognised entry, and names it — unknown provenance is not yours', () => {
    const veto = hardDeleteVeto([{ name: '00000000' }, { name: 'notes.json' }])
    expect(veto).toMatch(/1 unrecognised entry \(notes\.json\)/)
  })

  // No registry is consulted anywhere in this module: that is the point. The
  // dangerous molecule address is one no registry can enumerate, because any
  // participant mints one by typing a word.
  it('protects an address no registry could know about', () => {
    expect(mayHardDelete([{ name: A, isDirectory: true }, { name: B, isDirectory: true }])).toBe(false)
  })
})

describe('hardDeleteVetoFor — reads a handle, and fails CLOSED', () => {
  it('allows a bag of markers', async () => {
    expect(await hardDeleteVetoFor(dirOf([['00000000', 'file'], ['00000001', 'file']]))).toBeNull()
  })

  it('refuses a directory holding a member', async () => {
    expect(await hardDeleteVetoFor(dirOf([['00000000', 'file'], [A, 'file']]))).toMatch(/member file/)
  })

  it('refuses when the handle is missing', async () => {
    expect(await hardDeleteVetoFor(null)).toMatch(/missing/)
    expect(await hardDeleteVetoFor(undefined)).toMatch(/missing/)
  })

  it('refuses when the directory cannot be enumerated', async () => {
    expect(await hardDeleteVetoFor({} as never)).toMatch(/cannot be enumerated/)
  })

  it('refuses when enumeration throws — a walker that cannot see must not destroy', async () => {
    const exploding = {
      entries: async function* () {
        yield ['00000000', { kind: 'file' }] as [string, { kind: string }]
        throw new Error('disk went away')
      },
    }
    expect(await hardDeleteVetoFor(exploding)).toMatch(/could not be read \(disk went away\)/)
  })

  it('vetoes on a keys()-only handle, where member and bucket are indistinguishable', async () => {
    const keysOnly = { keys: async function* () { yield '00000000'; yield A } }
    expect(await hardDeleteVetoFor(keysOnly)).toMatch(/member file/)
  })
})
