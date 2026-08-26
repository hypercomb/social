// contact-form.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years; a
// module-carried catalog must not inherit that. This pins the exact key set
// and its presence in every locale.
//
// ONE ANGULAR FOLDER, TWO SURFACES. contact-form and contact-hover registered
// separately (orders 160 and 170) and were ported as two elements, so their
// strings are split into two catalogs rather than one shared blob — a surface
// carries what IT renders.

import { describe, expect, it } from 'vitest'
import { CONTACT_FORM_TRANSLATIONS } from './contact-form.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'contact.field.address',
  'contact.field.email',
  'contact.field.name',
  'contact.field.note',
  'contact.field.organization',
  'contact.field.phone',
  'contact.field.title',
  'contact.field.website',
  'contact.form.cancel',
  'contact.form.import',
  'contact.form.save',
  'contact.form.title',
].sort()

describe('contact-form catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(CONTACT_FORM_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(CONTACT_FORM_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(CONTACT_FORM_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    const prefixes = ["contact."]
    for (const catalog of Object.values(CONTACT_FORM_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(prefixes.some(prefix => key.startsWith(prefix)), key).toBe(true)
      }
    }
  })
})
