// feedback-viewer.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years; a
// module-carried catalog must not inherit that. This pins the exact key set
// and its presence in every locale.
//
// THREE PREFIXES, AND THAT IS WHY THIS WAS NOT PREFIX-SWEPT. The panel renders
// `action.break-apart` and `controls.show-hidden` alongside its own
// `feedback.*` — sweeping those three prefixes would have moved 173 keys,
// including the entire action.* catalog the tile actions depend on. Only the
// keys the panel actually references moved. `action.break-apart` is shared
// with tile-actions.drone.ts, so it is duplicated here and left in the shell;
// `controls.show-hidden` is referenced by nothing else despite its prefix, so
// it moved.

import { describe, expect, it } from 'vitest'
import { FEEDBACK_VIEWER_TRANSLATIONS } from './feedback-viewer.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'action.break-apart',
  'controls.show-hidden',
  'feedback.answer.placeholder',
  'feedback.answer.send',
  'feedback.answered.message',
  'feedback.answered.title',
  'feedback.approval.approve',
  'feedback.approval.discard',
  'feedback.approval.title',
  'feedback.category.idea',
  'feedback.category.issue',
  'feedback.category.label',
  'feedback.error.message',
  'feedback.error.title',
  'feedback.granted.message',
  'feedback.granted.title',
  'feedback.identity.label',
  'feedback.identity.message',
  'feedback.identity.placeholder',
  'feedback.identity.title',
  'feedback.permission.hint',
  'feedback.placeholder',
  'feedback.reason.answer',
  'feedback.reason.approval',
  'feedback.reason.feedback-loop',
  'feedback.reason.meaning-loop',
  'feedback.replied.message',
  'feedback.replied.title',
  'feedback.reply.error.message',
  'feedback.reply.error.title',
  'feedback.reply.placeholder',
  'feedback.reply.send',
  'feedback.request.message',
  'feedback.request.send',
  'feedback.request.title',
  'feedback.resolve.error.message',
  'feedback.resolve.error.title',
  'feedback.send',
  'feedback.sent.message',
  'feedback.sent.title',
  'feedback.viewer.anonymous',
  'feedback.viewer.answer',
  'feedback.viewer.close',
  'feedback.viewer.empty',
  'feedback.viewer.empty-scope',
  'feedback.viewer.hide-retired',
  'feedback.viewer.reply',
  'feedback.viewer.resolve',
  'feedback.viewer.subtitle',
  'feedback.viewer.title',
  'tags.scope-children',
  'tags.scope-global',
  'tags.scope-local',
].sort()

describe('feedback-viewer catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(FEEDBACK_VIEWER_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(FEEDBACK_VIEWER_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(FEEDBACK_VIEWER_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    const prefixes = ["feedback.", "action.", "controls.", "tags."]
    for (const catalog of Object.values(FEEDBACK_VIEWER_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(prefixes.some(prefix => key.startsWith(prefix)), key).toBe(true)
      }
    }
  })
})
