import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  HIDDEN_ARTIFACT_KIND,
  HIDDEN_FAMILY,
  HIDDEN_ITEMS_POOL,
  hiddenMeaning,
  hiddenRecord,
} from './concealment.js'
import { familyOfMeaning } from '../pheromones/enrollment.js'

const here = dirname(fileURLToPath(import.meta.url))
const shared = join(here, '..', '..', '..', 'hypercomb-shared')
const POOL = readFileSync(join(here, 'concealment.ts'), 'utf8')
const DRONE = readFileSync(join(here, 'concealment.drone.ts'), 'utf8')
const HOSTS_HTML = readFileSync(join(shared, 'ui', 'hosts-panel', 'hosts-panel.component.html'), 'utf8')
const PUBLISH_HTML = readFileSync(join(shared, 'ui', 'publish-panel', 'publish-panel.component.html'), 'utf8')
const PUBLISH_TS = readFileSync(join(shared, 'ui', 'publish-panel', 'publish-panel.component.ts'), 'utf8')

const SIG = 'a'.repeat(64)

// HIDE FIRST, DELETE SECOND. Deleting is the only act that cannot be answered
// by pressing something again, so no list offers it: a list offers HIDE, and
// what was hidden collects in a delete area where deleting is on the table.
describe('concealment — the doctrine, not a feature', () => {
  it('scopes the meaning to a family, so it can never collide with a bag', () => {
    expect(hiddenMeaning(SIG)).toBe(`hidden:${SIG}`)
    expect(familyOfMeaning(hiddenMeaning(SIG))).toBe(HIDDEN_FAMILY)
    expect(HIDDEN_ITEMS_POOL).toContain(':')
  })

  it('mints nothing for anything that is not a signature', () => {
    for (const raw of ['', '  ', 'not-a-sig', 'a'.repeat(63), 'g'.repeat(64), null, undefined]) {
      expect(hiddenMeaning(raw)).toBe('')
    }
    // Case is folded, so the same thing hidden twice is one member.
    expect(hiddenMeaning('A'.repeat(64))).toBe(`hidden:${'a'.repeat(64)}`)
  })

  it('records canonically — sorted keys, no wall clock, so a re-hide is one member', () => {
    const item = { sig: SIG, scope: 'host-build', label: 'x', from: 'jwize.com', deletable: true, state: 'hidden' as const }
    const record = hiddenRecord(item)
    expect(record.kind).toBe(HIDDEN_ARTIFACT_KIND)
    expect(JSON.stringify(record)).toBe(JSON.stringify(hiddenRecord({ ...item })))
    expect(JSON.stringify(record)).not.toMatch(/\d{13}/)          // no Date.now()
    const keys = Object.keys(record.payload as object)
    expect([...keys].sort()).toEqual(keys)
  })

  it('the state rides IN the record, so hidden and deleted are different bytes', () => {
    const base = { sig: SIG, scope: 's', label: 'l', from: 'f', deletable: true }
    expect(JSON.stringify(hiddenRecord({ ...base, state: 'hidden' })))
      .not.toBe(JSON.stringify(hiddenRecord({ ...base, state: 'deleted' })))
  })

  // THE TWO GATES. Both are refusals in the pool module rather than warnings in
  // a surface, so a new panel cannot reach deletion by emitting an effect.
  it('refuses to delete anything that was not hidden first', () => {
    expect(POOL).toMatch(/if \(!current \|\| current\.state !== 'hidden' \|\| !current\.deletable\) return false/)
  })

  it('refuses to delete what its surface never said may be deleted', () => {
    // Absent means NOT deletable: a surface that has not thought about it gets
    // the answer that costs nothing to be wrong about.
    expect(DRONE).toMatch(/deletable: p\?\.deletable === true/)
  })

  it('deleted outranks hidden, so a stale record can never re-offer a deletion', () => {
    expect(POOL).toMatch(/seen\.state === 'hidden' && item\.state === 'deleted'/)
  })

  it('has ONE owner — the panels emit intents and read a render', () => {
    expect(DRONE).toMatch(/'hidden:conceal', 'hidden:reveal', 'hidden:delete'/)
    expect(DRONE).toMatch(/this\.emitEffect\('hidden:render'/)
    // Shared UI must not import essentials; the shapes are mirrored by hand.
    expect(PUBLISH_TS).not.toMatch(/@hypercomb\/essentials/)
  })

  // THE SURFACES. Both lists offer hide and only hide; both delete areas are
  // folds you open on purpose.
  it('is the same doctrine on both surfaces', () => {
    for (const html of [HOSTS_HTML, PUBLISH_HTML]) {
      expect(html).toMatch(/hidden:conceal|hide\(pkg\)|hideVersion\(row, v\)/)
      expect(html).toMatch(/THE DELETE AREA/)
    }
    expect(PUBLISH_HTML).toMatch(/\(click\)="hideVersion\(row, v\)"/)
    expect(PUBLISH_HTML).toMatch(/\(click\)="destroyVersion\(item\)"/)
    // The live head is never hideable — the row that says what is out there
    // right now is not a row you can lose.
    expect(PUBLISH_HTML).toMatch(/@if \(v\.sig !== row\.live\) \{/)
    expect(PUBLISH_TS).toMatch(/if \(version\.sig === row\.live\) return/)
  })

  it('never promises more than a local forget', () => {
    for (const source of [POOL, DRONE]) {
      expect(source).toMatch(/local forget|stays where it was published|still fetchable/i)
    }
  })
})
