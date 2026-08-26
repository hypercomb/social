// confirm-dialog.i18n.spec.ts — the drift check, plus the OWNERSHIP guard.
//
// The dialog renders keys it is HANDED: a caller builds a ConfirmRequest
// carrying `title`, `message` and `warning` as i18n KEYS, and the dialog
// pipes them through t(). So `confirm.delete-message` and its siblings belong
// to their CALLERS — and two of those callers are still Angular (the command
// line and the file explorer). Only the two DEFAULT labels the dialog falls
// back to are its own.
//
// Moving the whole `confirm.` prefix would relocate the command line's
// strings into a dialog's file and call it a split. This spec pins the
// boundary so a later careless extraction cannot quietly cross it.

import { describe, expect, it } from 'vitest'
import { CONFIRM_DIALOG_TRANSLATIONS } from './confirm-dialog.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'confirm.cancel',
  'confirm.delete',
].sort()

/** Supplied BY CALLERS in the request payload — these must NOT have been
 *  dragged into the dialog's catalog. */
const CALLERS_KEYS = [
  'confirm.delete-message',
  'confirm.delete-title',
  'confirm.delete-children-warning',
  'confirm.remove-children.one',
  'confirm.remove-children.other',
  'confirm.remove-message.one',
  'confirm.remove-message.other',
]

describe('confirm-dialog catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(CONFIRM_DIALOG_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(CONFIRM_DIALOG_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(CONFIRM_DIALOG_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    for (const catalog of Object.values(CONFIRM_DIALOG_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(key.startsWith('confirm.'), key).toBe(true)
      }
    }
  })

  it('never swallows a caller’s keys (the ownership boundary)', () => {
    for (const [locale, catalog] of Object.entries(CONFIRM_DIALOG_TRANSLATIONS)) {
      for (const key of CALLERS_KEYS) {
        expect(key in catalog, `${locale} must not carry ${key}`).toBe(false)
      }
    }
  })
})
