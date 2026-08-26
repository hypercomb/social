// notes-strip.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years; a
// module-carried catalog must not inherit that. This pins the exact key set
// and its presence in every locale.
//
// THIRTEEN SHARED KEYS, more than any other surface in the campaign — the
// annotations tabs with tile-brief-panel, and eight `notes.*` with
// notes-viewer, which converted three batches earlier. Both halves of the
// notes feature now carry what they draw.
//
// The five `notes.face.*` keys are built at runtime from a stem. And the ONE
// `tags.` key is why this was reference-derived: en.json holds twenty under
// that prefix and this panel renders one.

import { describe, expect, it } from 'vitest'
import { NOTES_STRIP_TRANSLATIONS } from './notes-strip.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'annotations.lists.empty',
  'annotations.tab.lists',
  'annotations.tab.notes',
  'annotations.title',
  'notes.actions',
  'notes.add',
  'notes.addMark',
  'notes.cancel',
  'notes.capturePlaceholder',
  'notes.capturePlaceholderQ',
  'notes.clearFilter',
  'notes.close',
  'notes.collapse',
  'notes.delete',
  'notes.dragToReorder',
  'notes.edit',
  'notes.editMarks',
  'notes.empty.none',
  'notes.exitFullscreen',
  'notes.expand',
  'notes.face.hint',
  'notes.face.label',
  'notes.face.mono',
  'notes.face.sans',
  'notes.face.serif',
  'notes.filterAll',
  'notes.filterNoMatch',
  'notes.filterNotes',
  'notes.filterPlaceholder',
  'notes.filterQuestions',
  'notes.footerCount',
  'notes.formAdd',
  'notes.formAsk',
  'notes.fullscreen',
  'notes.hide',
  'notes.kindLabel',
  'notes.kindNote',
  'notes.kindNotes',
  'notes.kindPoints',
  'notes.kindQuestion',
  'notes.lists.addLine',
  'notes.lists.delete',
  'notes.lists.deleteConfirm',
  'notes.lists.new',
  'notes.lists.newTitle',
  'notes.lists.rename',
  'notes.markDone',
  'notes.markDragHint',
  'notes.markHeading',
  'notes.markList',
  'notes.markMeaning',
  'notes.markPalette',
  'notes.markProse',
  'notes.markRail',
  'notes.markRemove',
  'notes.moreActions',
  'notes.nestUnder',
  'notes.noMarks',
  'notes.noTiles',
  'notes.noValidParents',
  'notes.noteKindAnswer',
  'notes.noteKindQuestion',
  'notes.noteNoMatch',
  'notes.openTile',
  'notes.pageFiltered',
  'notes.peekEmpty',
  'notes.peekMore',
  'notes.peekReading',
  'notes.pickTile',
  'notes.plateAnswers.one',
  'notes.plateAnswers.other',
  'notes.plateChildren.one',
  'notes.plateChildren.other',
  'notes.plateNotes.one',
  'notes.plateNotes.other',
  'notes.plateQuestions.one',
  'notes.plateQuestions.other',
  'notes.promoteToTopLevel',
  'notes.read',
  'notes.reading.empty',
  'notes.save',
  'notes.strip.aria',
  'notes.viewer.aria',
  'notes.viewer.dropHint',
  'notes.viewer.next',
  'notes.viewer.position',
  'notes.viewer.prev',
  'notes.viewer.untag',
  'tags.viewer.title',
].sort()

describe('notes-strip catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(NOTES_STRIP_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(NOTES_STRIP_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(NOTES_STRIP_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    const prefixes = ["notes.", "annotations.", "tags."]
    for (const catalog of Object.values(NOTES_STRIP_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(prefixes.some(prefix => key.startsWith(prefix)), key).toBe(true)
      }
    }
  })
})
