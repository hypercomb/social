import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const DRONE = readFileSync(join(here, 'publish-status.drone.ts'), 'utf8')

// A SWITCH ANSWERS AT ONCE, OR IT READS AS BROKEN.
//
// Ticking a host wears enrollment marks — a commit per host — and the sweep
// behind that re-reads every door over the network. Both are correct and both
// are slow, and the panel used to restate the row only after they were done:
// the box sat on its old state for a second or more, so people clicked it
// again. The choice is made the moment it is made; the writes are how it is
// KEPT, not how it is decided, so the read-model moves first and the writes
// reconcile it.
const body = (name: string): string => {
  const start = DRONE.indexOf(`async ${name}(`)
  expect(start, `${name} not found`).toBeGreaterThan(-1)
  const end = DRONE.indexOf('\n  }', start)
  return DRONE.slice(start, end)
}

describe('publish panel — a host tick paints before it writes', () => {
  it('#setTarget restates the row BEFORE awaiting the mark writes', () => {
    const set = body('#setTarget')
    const painted = set.indexOf('this.#paintZones(key, ordered)')
    const written = set.indexOf('await setBranchHosts(')
    expect(painted).toBeGreaterThan(-1)
    expect(written).toBeGreaterThan(-1)
    expect(painted).toBeLessThan(written)
  })

  it('a refusal restates the truth rather than leaving the tick lying', () => {
    expect(body('#setTarget')).toMatch(/if \(written\.join\(','\) !== ordered\.join\(','\)\) this\.#paintZones\(key, written\)/)
  })

  it('the paint moves the read-model AND the door, then says so at once', () => {
    const paint = DRONE.slice(DRONE.indexOf('#paintZones(key: string'))
    expect(paint).toMatch(/this\.#branchHosts\.set\(key, \[\.\.\.zones\]\)/)
    expect(paint).toMatch(/this\.#hostByKey\.delete\(key\)/)
    expect(paint).toMatch(/this\.#emit\(\)/)
  })

  it('the tick coalesces its re-sweep instead of starting one per click', () => {
    const set = body('#setTarget')
    expect(set).not.toMatch(/void this\.#refresh\(\)/)
    expect(set).toMatch(/this\.#invalidate\(\)/)
  })

  it('a change made mid-sweep is owed another sweep, never dropped', () => {
    expect(DRONE).toMatch(/if \(this\.#refreshing\) \{ this\.#again = true; return \}/)
    expect(DRONE).toMatch(/if \(this\.#again\) \{ this\.#again = false; this\.#invalidate\(\) \}/)
  })

  it('the opens-as pick paints first too, and puts itself back on a failure', () => {
    const opens = body('#setOpensAs')
    const painted = opens.indexOf('row.opensAs = view')
    const written = opens.indexOf('await writeDefaultView(')
    expect(painted).toBeGreaterThan(-1)
    expect(painted).toBeLessThan(written)
    expect(opens).toMatch(/row\.opensAs = before/)
  })
})
