import { describe, expect, it } from 'vitest'
import {
  MARKER_CEILING,
  classifyDirectoryEntry,
  documentSweepVeto,
  documentSweepVetoFor,
  hardDeleteVeto,
  hardDeleteVetoFor,
  markerName,
  mayHardDelete,
  planNamedRemoval,
  planNamedRemovalFor,
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

// ── ADDED IN THE 2026-09 PRUNE-SAFETY PASS ─────────────────────────────────
// The marker ceiling, the document-pool sweep, and named-set removal. Every
// input below is one a reader actually found in the tree.

/** A 64-hex name that BEGINS WITH EIGHT DIGITS — the exact input for which
 *  `parseInt(name, 10)` returns 99999999 and the next mint is nine digits. */
const DIGIT_LEADING_SIG = '99999999ab3f4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5'

describe('markerName — the ceiling is inexpressible, not merely guarded', () => {
  it('pads to exactly eight digits', () => {
    expect(markerName(0)).toBe('00000000')
    expect(markerName(1)).toBe('00000001')
    expect(markerName(MARKER_CEILING)).toBe('99999999')
  })

  it('refuses the index padStart cannot express', () => {
    // String(100000000).padStart(8, '0') is a NO-OP: nine characters, which
    // /^\d{8}$/ then rejects forever, with no repair short of renaming on
    // disk. The bug is that the padding SILENTLY does nothing.
    expect(String(MARKER_CEILING + 1).padStart(8, '0')).toHaveLength(9)
    expect(classifyDirectoryEntry(String(MARKER_CEILING + 1))).toBe('foreign')
    expect(markerName(MARKER_CEILING + 1)).toBeNull()
  })

  it('refuses anything that is not a safe, non-negative integer', () => {
    expect(markerName(-1)).toBeNull()
    expect(markerName(1.5)).toBeNull()
    expect(markerName(NaN)).toBeNull()
    expect(markerName(Number.MAX_SAFE_INTEGER + 10)).toBeNull()
  })

  it('is what stops a digit-leading member poisoning a counter', () => {
    // The full failure, in three lines: a member's name parses as a marker
    // index, the index exceeds the ceiling, the padded name is unreadable.
    expect(parseInt(DIGIT_LEADING_SIG, 10)).toBe(99999999)
    expect(Number(DIGIT_LEADING_SIG)).toBeNaN()
    expect(classifyDirectoryEntry(DIGIT_LEADING_SIG)).toBe('member')
    expect(markerName(parseInt(DIGIT_LEADING_SIG, 10) + 1)).toBeNull()
  })
})

describe('documentSweepVeto — stricter than hardDeleteVeto, and deliberately so', () => {
  it('permits a true one-current-document pool', () => {
    expect(documentSweepVeto([])).toBeNull()
    expect(documentSweepVeto([{ name: A }, { name: DIGIT_LEADING_SIG }])).toBeNull()
  })

  it('REFUSES on a marker, where hardDeleteVeto would allow', () => {
    // hardDeleteVeto permits an all-marker directory: a bag is what the
    // deleter came for. A document sweep must not — a marker is positive
    // proof that somebody's lineage lives at this address.
    expect(hardDeleteVeto([{ name: '00000001' }])).toBeNull()
    expect(documentSweepVeto([{ name: '00000001' }, { name: A }])).toMatch(/lineage marker/)
  })

  it('REFUSES on an author bucket and on a foreign name', () => {
    expect(documentSweepVeto([{ name: A, isDirectory: true }])).toMatch(/author bucket/)
    expect(documentSweepVeto([{ name: '__meta__' }])).toMatch(/unrecognised/)
  })

  it('fails CLOSED', async () => {
    expect(await documentSweepVetoFor(null)).toMatch(/missing/)
    expect(await documentSweepVetoFor({} as never)).toMatch(/cannot be enumerated/)
    expect(await documentSweepVetoFor(dirOf([['00000001', 'file']]))).toMatch(/lineage marker/)
  })
})

describe('planNamedRemoval — a manifest may only NARROW a removal set', () => {
  it('removes what the caller minted, and leaves every sibling it did not name', () => {
    const plan = planNamedRemoval(
      [{ name: A }, { name: B }, { name: `${A}.js` }],
      [A, `${A}.js`],
    )
    expect(plan.refused).toBeNull()
    expect([...plan.remove].sort()).toEqual([A, `${A}.js`].sort())
  })

  it('never widens: a name in the manifest but absent on disk removes nothing', () => {
    // The normal state of replication is a member whose manifest has not
    // arrived — and the inverse, a manifest naming what is not here yet.
    const plan = planNamedRemoval([{ name: A }], [A, B])
    expect(plan.remove).toEqual([A])
  })

  it('refuses the WHOLE plan when the directory holds a marker', () => {
    const plan = planNamedRemoval([{ name: '00000003' }, { name: A }], [A])
    expect(plan.remove).toEqual([])
    expect(plan.refused).toMatch(/lineage marker/)
  })

  it('refuses the WHOLE plan — never a partial sweep — when a named entry is a bucket', () => {
    const plan = planNamedRemoval(
      [{ name: A }, { name: B, isDirectory: true }],
      [A, B],
    )
    expect(plan.remove).toEqual([])
    expect(plan.refused).toMatch(/author bucket/)
  })

  it('reads kind from the handle, so a bucket is never mistaken for a member', async () => {
    expect((await planNamedRemovalFor(dirOf([[A, 'directory']]), [A])).refused).toMatch(/author bucket/)
    expect((await planNamedRemovalFor(dirOf([[A, 'file']]), [A])).remove).toEqual([A])
  })

  it('fails CLOSED', async () => {
    const plan = await planNamedRemovalFor(null, [A])
    expect(plan.remove).toEqual([])
    expect(plan.refused).toMatch(/missing/)
  })

  it('handles the install-cache shape: <sig>.js is FOREIGN, so it can only go by name', () => {
    // This is why the installer purge must be a named-set removal and can
    // never be simplified back into a kind-based sweep.
    expect(classifyDirectoryEntry(`${A}.js`)).toBe('foreign')
    expect(planNamedRemoval([{ name: `${A}.js` }], []).remove).toEqual([])
    expect(planNamedRemoval([{ name: `${A}.js` }], [`${A}.js`]).remove).toEqual([`${A}.js`])
  })
})
