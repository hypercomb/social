// ui/command-line/inert-line.spec.ts — a command-stance line that reads as no
// behaviour is KEPT, and says why nothing ran.
//
// One '/word' leaves the bar in command stance (sticky across lines and
// reloads). From then on a typed tile name was read as prose, found no
// behaviour, and the line was cleared: no tile, no message, no history. At a
// meeting that read as "I cannot share". The stance itself is unchanged —
// only the silence is gone.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(process.cwd(), 'hypercomb-shared', 'ui', 'command-line', 'command-line.component.ts'), 'utf8')
const en = JSON.parse(readFileSync(join(process.cwd(), 'hypercomb-shared', 'i18n', 'en.json'), 'utf8')) as Record<string, string>

describe('the inert command-stance line', () => {
  const start = src.indexOf('#commitUtterance(text: string): boolean {')
  const body = src.slice(start, src.indexOf('\n  }\n', start))
  const inert = body.slice(body.indexOf('if (!reading.actions.length) {'), body.indexOf('return true', body.indexOf('if (!reading.actions.length) {')))

  it('keeps the line as typed — no clear()', () => {
    expect(start).toBeGreaterThan(-1)
    expect(inert.length).toBeGreaterThan(0)
    expect(inert.includes('this.clear()')).toBe(false)
  })

  it("says it with the catalog's 'command.inert' hint, naming what was typed", () => {
    expect(inert).toContain("'command.inert'")
    expect(inert).toContain("EffectBus.emit('activity:log'")
    expect(en['command.inert']).toContain('{text}')
  })

  it('never falls through to tile creation or history — the reading still owns the commit', () => {
    expect(inert.includes('commitCreateCellInPlace')).toBe(false)
    expect(inert.includes('#recordHistory')).toBe(false)
  })
})
