// codex.spec.ts — the codex is the one artifact every agent is taught from, so
// the file itself is under test: it must hold base to leaf, name documents that
// exist, and stay lean enough to ride every request.

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { codexSections, parseCodex, validateCodex } from './codex.js'
import { ANATOMY_SECTIONS } from './anatomy.generated.js'

const DOCS = resolve(__dirname, '../../../../documentation')
const text = readFileSync(resolve(DOCS, 'doctrine.codex'), 'utf8')
const tiers = parseCodex(text)
const documentExists = (doc: string): boolean => doc === 'CLAUDE.md' || existsSync(resolve(DOCS, doc))

describe('the codex file', () => {
  it('holds: tiers numbered in order, ids unique, every citation points earlier, every document exists', () => {
    expect(validateCodex(tiers, documentExists)).toEqual([])
  })

  it('has no line the parser would silently drop', () => {
    const lines = text.split(/\r?\n/).filter(line => line && !line.startsWith('HC-CODEX') && !line.startsWith('Base to leaf'))
    const parsed = tiers.length + tiers.reduce((sum, tier) => sum + tier.axioms.length, 0)
    expect(lines).toHaveLength(parsed)
  })

  it('stays lean: the whole artifact rides every request', () => {
    expect(text.length).toBeLessThan(12_000)
  })
})

describe('the validator', () => {
  const doc = (body: string) => parseCodex(`@0 One\n${body}`)

  it('refuses a citation of a later or missing axiom', () => {
    expect(validateCodex(doc('A1<A2: first\nA2: second'), () => true)).toEqual(['A1 cites A2, which does not come before it'])
    expect(validateCodex(doc('A1<Z9: first'), () => true)).toHaveLength(1)
  })

  it('refuses a duplicate id, an empty tier and a missing document', () => {
    expect(validateCodex(doc('A1: a\nA1: b'), () => true)).toEqual(['A1 is defined twice'])
    expect(validateCodex(parseCodex('@0 Empty'), () => true)).toEqual(['tier "Empty" holds no axiom'])
    expect(validateCodex(parseCodex('@0 One ~gone.md\nA1: a'), () => false)).toEqual(['tier "One" names a missing document gone.md'])
  })
})

describe('the anatomy seed', () => {
  it('is the codex, one doctrine section per tier meant for readers of the hive', () => {
    expect(ANATOMY_SECTIONS).toEqual(codexSections(tiers).map(section => section.replace(/__([a-z][a-z0-9-]*)__/gi, (_, name: string) => `the legacy "${name}" folder`)))
  })

  it('leaves the builders\' tier out of the chat\'s anatomy and keeps it for builders', () => {
    expect(codexSections(tiers).join('\n')).not.toContain('Modules (essentials)')
    expect(codexSections(tiers, 'code').join('\n')).toContain('Modules (essentials)')
  })
})
