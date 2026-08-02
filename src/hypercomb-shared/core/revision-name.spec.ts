import { describe, it, expect } from 'vitest'
import { revisionName } from './revision-name'

const SIG_A = 'a'.repeat(64)
const SIG_B = 'b'.repeat(64)
const AT = new Date('2026-08-01T12:00:00Z')

describe('revisionName', () => {
  it('is deterministic — the same build is named the same on every device', () => {
    expect(revisionName({ packageSig: SIG_A, label: 'build 42', at: AT }))
      .toBe(revisionName({ packageSig: SIG_A, label: 'build 42', at: AT }))
  })

  it('gives different builds different words', () => {
    const a = revisionName({ packageSig: SIG_A, label: 'x', at: AT })
    const b = revisionName({ packageSig: SIG_B, label: 'x', at: AT })
    expect(a).not.toBe(b)
  })

  it('reads as words, not as a signature', () => {
    const name = revisionName({ packageSig: SIG_A, label: 'build 42', at: AT })
    expect(name).not.toContain(SIG_A.slice(0, 8))
    expect(name).toMatch(/^[^ ]+ [^ ]+ · build 42$/)
  })

  it('capitalizes the word pair', () => {
    const name = revisionName({ packageSig: SIG_A, label: 'x', at: AT })
    const [adjective, noun] = name.split(' · ')[0].split(' ')
    expect(adjective[0]).toBe(adjective[0].toUpperCase())
    expect(noun[0]).toBe(noun[0].toUpperCase())
  })

  it('falls back to the date when the build has no label of its own', () => {
    const name = revisionName({ packageSig: SIG_A, at: AT, locale: 'en' })
    expect(name.split(' · ')[1]).toBe(AT.toLocaleDateString('en'))
  })

  it('still names an update whose package signature is unknown', () => {
    const name = revisionName({ at: AT })
    expect(name.split(' · ')[0].split(' ')).toHaveLength(2)
  })

  it('names in the locale it is given', () => {
    const en = revisionName({ packageSig: SIG_A, label: 'x', at: AT, locale: 'en' })
    const ja = revisionName({ packageSig: SIG_A, label: 'x', at: AT, locale: 'ja' })
    expect(en).not.toBe(ja)
  })
})
