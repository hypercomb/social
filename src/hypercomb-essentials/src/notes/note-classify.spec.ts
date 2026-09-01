import { describe, expect, it } from 'vitest'
import { isPointRoot, noteDisplayText, noteKindOf, splitNoteRoots, type NoteRole } from './note-classify.js'
import type { Note } from './note-tree.js'

const note = (over: Partial<Note> = {}): Note => ({
  id: '',
  text: 'a note',
  shape: null,
  mark: null,
  tags: [],
  children: [],
  ...over,
})

/** A palette where `label` is a heading, `check_circle` a list item, and
 *  `notes` the prose mark — the seeded set. */
const roleOf = (icon: string | null | undefined): NoteRole =>
  icon === 'label' ? 'heading' : icon === 'notes' ? 'prose' : 'list'

describe('noteKindOf', () => {
  it('reads the conversation markers', () => {
    expect(noteKindOf(note({ text: '[Q] what is this?' }))).toBe('q')
    expect(noteKindOf(note({ text: '[A:abc] it is that' }))).toBe('a')
    expect(noteKindOf(note({ text: '[A 2026] it is that' }))).toBe('a')
    expect(noteKindOf(note({ text: 'plain' }))).toBe('note')
  })

  it('tolerates leading space and an empty body', () => {
    expect(noteKindOf(note({ text: '   [Q] later' }))).toBe('q')
    expect(noteKindOf(note({ text: '' }))).toBe('note')
  })
})

describe('noteDisplayText', () => {
  it('drops the marker the styling already carries', () => {
    expect(noteDisplayText(note({ text: '[Q] what is this?' }))).toBe('what is this?')
    expect(noteDisplayText(note({ text: '[A:abc]  it is that' }))).toBe('it is that')
  })

  it('leaves an ordinary note exactly as written', () => {
    expect(noteDisplayText(note({ text: '  indented on purpose' }))).toBe('  indented on purpose')
  })
})

describe('isPointRoot', () => {
  it('counts a heading or list mark as structure', () => {
    expect(isPointRoot(note({ mark: 'label' }), roleOf)).toBe(true)
    expect(isPointRoot(note({ mark: 'check_circle' }), roleOf)).toBe(true)
  })

  it('leaves a prose mark and an unmarked leaf with the notes', () => {
    expect(isPointRoot(note({ mark: 'notes' }), roleOf)).toBe(false)
    expect(isPointRoot(note(), roleOf)).toBe(false)
  })

  it('treats a nested tree as a hierarchical list whatever its mark', () => {
    expect(isPointRoot(note({ children: [note()] }), roleOf)).toBe(true)
    expect(isPointRoot(note({ mark: 'notes', children: [note()] }), roleOf)).toBe(true)
  })

  it('keeps the conversation out of the structure, even nested', () => {
    expect(isPointRoot(note({ text: '[Q] ask', children: [note()] }), roleOf)).toBe(false)
    expect(isPointRoot(note({ text: '[A:1] answer', mark: 'label' }), roleOf)).toBe(false)
  })

  it('falls back to list for an unknown mark, the way the row renderer does', () => {
    expect(isPointRoot(note({ mark: 'deleted_from_palette' }))).toBe(true)
  })
})

describe('splitNoteRoots', () => {
  it('classifies ROOTS only — a list keeps its prose children', () => {
    const child = note({ text: 'the elaboration' })
    const list = note({ text: 'the point', mark: 'label', children: [child] })
    const prose = note({ text: 'a paragraph' })
    const split = splitNoteRoots([list, prose], roleOf)
    expect(split.lists.map(n => n.text)).toEqual(['the point'])
    expect(split.notes.map(n => n.text)).toEqual(['a paragraph'])
    expect(split.lists[0]!.children).toEqual([child])
  })

  it('puts everything with the notes when there is no palette', () => {
    const split = splitNoteRoots([note({ text: 'one' }), note({ text: 'two' })])
    expect(split.lists).toEqual([])
    expect(split.notes).toHaveLength(2)
  })
})
