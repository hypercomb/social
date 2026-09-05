// setup/install-purge.spec.ts
//
// A legacy install-cache purge removes what an install wrote — and nothing
// else. The old `purgeDir` enumerated and removed every entry; this one
// proves each removal the way its neighbours already did.

import { describe, expect, it, vi } from 'vitest'

// The install module pulls the shell's store barrel, whose script-preloader
// registers into a global at load. Mock the shell the way ensure-install.spec
// does; core stays REAL, because `hardDeleteVetoFor` is the guard under test.
vi.mock('@hypercomb/shared/core', () => ({ Store: class Store {} }))
vi.mock('@hypercomb/runtime/store', () => ({ Store: class Store {} }))
vi.stubGlobal('register', vi.fn())
vi.stubGlobal('get', vi.fn(() => undefined))

import { isInstallArtifactName, purgeInstallCacheDir } from './ensure-install.js'

const SIG = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

type Entry = { kind: 'file'; text?: string } | { kind: 'directory'; children: Record<string, Entry> }

/** A directory fake with just enough surface for the purge and the veto. */
const dir = (name: string, children: Record<string, Entry>): FileSystemDirectoryHandle => {
  const self = {
    name,
    kind: 'directory',
    async *entries() {
      for (const [n, e] of Object.entries(children)) yield [n, e.kind === 'file' ? file(n) : dir(n, e.children)]
    },
    getFileHandle: async (n: string) => { if (children[n]?.kind !== 'file') throw new Error('nf'); return file(n) },
    getDirectoryHandle: async (n: string) => { const e = children[n]; if (e?.kind !== 'directory') throw new Error('nd'); return dir(n, e.children) },
    removeEntry: async (n: string) => { if (!(n in children)) throw new Error('nf'); delete children[n] },
  }
  return self as unknown as FileSystemDirectoryHandle
}
const file = (name: string) => ({ name, kind: 'file', getFile: async () => ({ size: 1, arrayBuffer: async () => new ArrayBuffer(1) }) })

describe('isInstallArtifactName', () => {
  it('admits <sig> and <sig>.js and nothing else', () => {
    expect(isInstallArtifactName(SIG)).toBe(true)
    expect(isInstallArtifactName(`${SIG}.js`)).toBe(true)
    expect(isInstallArtifactName('0000')).toBe(false)
    expect(isInstallArtifactName('manifest.json')).toBe(false)
    expect(isInstallArtifactName(`${SIG}.json`)).toBe(false)
  })
})

describe('purgeInstallCacheDir', () => {
  it('removes install artifacts and leaves everything else, naming what it left', async () => {
    const children: Record<string, Entry> = {
      [SIG]: { kind: 'file' },
      [`${OTHER}.js`]: { kind: 'file' },
      'manifest.json': { kind: 'file' },
      '00000000': { kind: 'file' },           // a marker: never an install's
    }
    const refused = await purgeInstallCacheDir(dir('__bees__', children))
    expect(Object.keys(children).sort()).toEqual(['00000000', 'manifest.json'])
    expect(refused.sort()).toEqual(['00000000', 'manifest.json'])
  })

  it('refuses a directory that is not provably an install-written bag', async () => {
    const children: Record<string, Entry> = {
      // an author bucket / a pool: sig-named members, no marker
      [SIG]: { kind: 'directory', children: { [OTHER]: { kind: 'file' } } },
      // an empty directory: a namespace mid-write, never an install's
      [OTHER]: { kind: 'directory', children: {} },
    }
    const refused = await purgeInstallCacheDir(dir('__dependencies__', children))
    expect(Object.keys(children).sort()).toEqual([OTHER, SIG].sort())
    expect(refused.sort()).toEqual([OTHER, SIG].sort())
  })

  it('removes a directory that is all markers — the bag an install wrote', async () => {
    const children: Record<string, Entry> = {
      // a marker name is EXACTLY eight digits (directory-safety's MARKER_NAME)
      [SIG]: { kind: 'directory', children: { '00000000': { kind: 'file' }, '00000001': { kind: 'file' } } },
    }
    const refused = await purgeInstallCacheDir(dir('__bees__', children))
    expect(Object.keys(children)).toEqual([])
    expect(refused).toEqual([])
  })
})
