// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'

vi.stubGlobal('ioc', { register: () => {}, get: () => undefined })
const { readLines } = await import('./read.queen.js')
const { notesStartingWith } = await import('./unfile.queen.js')

const node = (children: string[], notes: string[] = [], extra: Record<string, unknown> = {}) =>
  ({ ok: true as const, root: '/', name: 'x', layerSig: 'a'.repeat(64), children: children.map(name => ({ name, sig: 'b'.repeat(64) })), notes, noteCount: notes.length, ...extra }) as never

describe('read — the word', () => {
  it('says the tiles as routes, so a withheld one can be masked, and counts the withheld', () => {
    const hidden = (s: readonly string[]): boolean => s.join('/') === 'susan'
    expect(readLines([], node(['dolphin', 'susan', 'people']), hidden))
      .toEqual(['Read /: 3 tiles — /dolphin, /people; 1 withheld from AI readers'])
  })

  it('says a tile’s notes, replies indented, long ones cut and said so', () => {
    const lines = readLines(['dolphin'], node(['members'], ['agenda', '  a reply', 'x'.repeat(2_100)]), () => false)
    expect(lines[0]).toBe('Read /dolphin: 1 tile — /dolphin/members')
    expect(lines[1]).toBe('  notes (3):')
    expect(lines[2]).toBe('  1. agenda')
    expect(lines[3]).toBe('    2. a reply')
    expect(lines[4]).toContain('… (cut; 2100 characters)')
  })

  it('says a missing tile plainly', () => {
    expect(readLines(['nowhere'], { ok: false, root: '/nowhere', code: 'not-found' }, () => false))
      .toEqual(['Read /nowhere: there is no tile here to read (not-found)'])
  })
})

describe('unfile — which note the words mean', () => {
  const notes = [
    { id: '1', text: 'Call the printer company about toner' },
    { id: '2', text: 'Call the bank', children: [{ id: '3', text: 'call  THE printer back on Monday' }] },
  ]
  it('matches by how a note starts, ignoring case and spacing, replies included', () => {
    expect(notesStartingWith(notes, 'call the printer').map(note => note.id)).toEqual(['1', '3'])
    expect(notesStartingWith(notes, 'call the printer company').map(note => note.id)).toEqual(['1'])
    expect(notesStartingWith(notes, 'call the bank').map(note => note.id)).toEqual(['2'])
    expect(notesStartingWith(notes, '   ')).toEqual([])
  })
})
