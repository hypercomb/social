import { describe, expect, it } from 'vitest'
import { hasUnpushedEdits, newestBodySig, shouldCommitBody } from './document-edit.js'

const sig = (n: string) => n.repeat(64).slice(0, 64)
const A = sig('a')
const B = sig('b')

describe('reading the current body', () => {
  it('takes the newest signature, since older entries are history', () => {
    expect(newestBodySig({ document: [A, B] })).toBe(B)
  })

  it('skips malformed trailing entries rather than returning junk', () => {
    expect(newestBodySig({ document: [A, 'not-a-sig'] })).toBe(A)
  })

  it('reads a cold or empty layer as no body instead of throwing', () => {
    expect(newestBodySig(null)).toBeNull()
    expect(newestBodySig({})).toBeNull()
    expect(newestBodySig({ document: [] })).toBeNull()
    expect(newestBodySig({ document: 'nonsense' })).toBeNull()
  })
})

describe('deciding whether a save is worth a history entry', () => {
  // A debounced editor fires on every pause and on focus loss. Committing an
  // unchanged body would spend an undo step on nothing.
  it('declines to commit a body identical to the last one', () => {
    expect(shouldCommitBody('# Notes', '# Notes')).toBe(false)
  })

  it('commits a changed body', () => {
    expect(shouldCommitBody('# Notes edited', '# Notes')).toBe(true)
  })

  it('treats whitespace as content rather than normalizing it away', () => {
    expect(shouldCommitBody('# Notes\n\n', '# Notes')).toBe(true)
    expect(shouldCommitBody('# Notes ', '# Notes')).toBe(true)
  })

  it('commits a first body but never commits an empty first body', () => {
    expect(shouldCommitBody('first', null)).toBe(true)
    expect(shouldCommitBody('', null)).toBe(false)
  })

  it('commits a deliberate clear once a body exists', () => {
    expect(shouldCommitBody('', '# Notes')).toBe(true)
  })
})

describe('knowing whether Google is behind', () => {
  it('reports edits made since the last pull', () => {
    expect(hasUnpushedEdits(B, A)).toBe(true)
  })

  it('reports nothing to push when the body still matches what was pulled', () => {
    expect(hasUnpushedEdits(A, A)).toBe(false)
  })

  it('claims nothing when either side is unknown', () => {
    expect(hasUnpushedEdits(null, A)).toBe(false)
    expect(hasUnpushedEdits(A, null)).toBe(false)
  })
})
