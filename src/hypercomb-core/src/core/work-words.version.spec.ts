// work-words.version.spec.ts — the build's own source in the loop's words:
// the write header that drafts a file of a revision, and the read that opens
// one (core hive-reads.ts), whatever folder it lies in.

import { describe, expect, it } from 'vitest'
import { applySectionEdits, parseWriteBlock, workInstruction } from './work-words.js'
import { parseHypercombObservationGrammars } from './hive-reads.js'

const REV = 'ab'.repeat(32)

describe('writing a file of the build', () => {
  it('reads `version <revision> <path>` as a file of that revision, whole or by edits', () => {
    expect(parseWriteBlock([`version ${REV} src/documentation/notes.md`, '# notes', 'more'])).toEqual({ version: REV, path: 'src/documentation/notes.md', body: '# notes\nmore' })
    expect(parseWriteBlock([`write version ${REV.toUpperCase()} .gitignore`, 'dist/'])).toMatchObject({ version: REV, path: '.gitignore' })
    const edited = parseWriteBlock([`version ${REV} src/a.ts`, '<<<<<<< SEARCH', 'a = 1', '=======', 'a = 2', '>>>>>>> REPLACE'])
    expect(edited).toMatchObject({ version: REV, path: 'src/a.ts', edits: [{ find: 'a = 1', replace: 'a = 2' }] })
  })

  it('refuses a path out of the tree', () => {
    for (const path of ['../etc/passwd', 'src/../../x', 'src//a.ts', './a.ts']) {
      expect(parseWriteBlock([`version ${REV} ${path}`, 'x'])).toMatchObject({ error: expect.stringMatching(/not a path inside the tree/) })
    }
  })

  it('makes edits that each match exactly once', () => {
    expect(applySectionEdits('a\nb\n', [{ find: 'b', replace: 'c' }])).toEqual({ body: 'a\nc\n' })
    expect(applySectionEdits('a\na\n', [{ find: 'a', replace: 'c' }])).toMatchObject({ error: expect.stringMatching(/more than once/) })
    expect(applySectionEdits('a\n', [{ find: 'z', replace: 'c' }])).toMatchObject({ error: expect.stringMatching(/not in the section/) })
  })

  it('is taught only where revisions are held, with the revisions themselves', () => {
    const base = { canRead: true, readsRunFreely: true, readsPerBlock: 8, canChange: false, vocabulary: '' }
    expect(workInstruction(base)).not.toContain('version <revision signature> <path>')
    const taught = workInstruction({ ...base, canWriteVersion: true, revisions: `${REV} host 2026.10.2.1` })
    expect(taught).toContain('version <revision signature> <path>')
    expect(taught).toContain(`${REV} host 2026.10.2.1`)
  })
})

describe('reading a file of the build', () => {
  it('opens any path of a revision\'s tree, and still continues a page by number', () => {
    const [docs, root, page] = parseHypercombObservationGrammars([`/read ${REV} src/documentation`, `/read ${REV} .gitignore`, `/read ${REV} 4000`], []).observations
    expect(docs).toMatchObject({ verb: 'read', sig: REV, section: 'src/documentation' })
    expect(root).toMatchObject({ verb: 'read', sig: REV, section: '.gitignore' })
    expect(page).toMatchObject({ verb: 'read', sig: REV, from: 4000 })
    expect(page!.section).toBeUndefined()
  })
})
