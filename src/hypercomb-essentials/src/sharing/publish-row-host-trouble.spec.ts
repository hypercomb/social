// publish-row-host-trouble.spec.ts — A PUBLISH ROW NAMES THE DOMAIN THAT
// TAKES NONE OF ITS BYTES (the 2026-10-10 meeting).
//
// `favorites` published at the typo `hyperccomb.com` (NXDOMAIN), and
// business-card at a hypercomb.com that answered a page: a publish domain is
// the participant's choice and is never passed over, so its row must SAY so —
// "favorites: hyperccomb.com can't be reached — check the host name, and that
// the host is running" — rather than the branch reading as uploading for
// ever. What a host is doing is
// host-sync's to know (`hostTrouble`, pinned in host-sync.stuck-uploads.spec);
// here: every row asks it, a host's change reaches the rows at once without a
// sweep, the panel says it under the row, and every catalog can say every why.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const DRONE = readFileSync(join(ROOT, 'hypercomb-essentials', 'src', 'sharing', 'publish-status.drone.ts'), 'utf8')
const PANEL_TS = readFileSync(join(ROOT, 'hypercomb-shared', 'ui', 'publish-panel', 'publish-panel.component.ts'), 'utf8')
const PANEL_HTML = readFileSync(join(ROOT, 'hypercomb-shared', 'ui', 'publish-panel', 'publish-panel.component.html'), 'utf8')
const I18N = join(ROOT, 'hypercomb-shared', 'i18n')

const WHYS = ['unresolved', 'page', 'refused', 'full', 'unreachable']

/** A method's body, from its signature to its closing brace at two spaces. */
const body = (signature: string): string => {
  const start = DRONE.indexOf(signature)
  expect(start, `${signature} not found`).toBeGreaterThan(-1)
  return DRONE.slice(start, DRONE.indexOf('\n  }\n', start))
}

describe('a publish row names the domain that takes none of its bytes', () => {
  it('every row asks host-sync about its domains, primary first, and keeps only a why it can say', () => {
    expect(body('\n  #draftRow(')).toContain('hostTrouble: this.#troubleFor(this.#zonesFor(key))')
    const trouble = body('#troubleFor(zones: readonly string[])')
    expect(trouble).toMatch(/for \(const zone of zones\)/)
    expect(trouble).toMatch(/hostSync\.hostTrouble\(zoneDoor\(zone\)\)/)
    expect(trouble).toMatch(/HOST_TROUBLE_WHYS\.has\(trouble\.why\)/)
    for (const why of WHYS) expect(DRONE).toMatch(new RegExp(`HOST_TROUBLE_WHYS[^\\n]*'${why}'`))
  })

  it('a host that starts or stops taking bytes moves the rows at once — no sweep, no network', () => {
    expect(DRONE).toMatch(/protected override listens: string\[\] = \[[^\]]*'sync:state'/)
    const handler = DRONE.slice(DRONE.indexOf("this.onEffect('sync:state'"))
    const end = handler.indexOf('})')
    const said = handler.slice(0, end)
    expect(said).toContain('this.#retrouble()')
    expect(said).toContain('this.#emit()')
    expect(said).not.toMatch(/#refresh\(|#invalidate\(|fetch\(/)
  })

  it('a re-picked domain is asked about at once, with the paint', () => {
    expect(body('#paintZones(key: string')).toContain('row.hostTrouble = this.#troubleFor(row.zones)')
  })

  it('the panel says it under the row: "<branch>: <host> …"', () => {
    expect(PANEL_HTML).toMatch(/@if \(troubleKey\(row\)\) \{\s*<p class="pcur-why"[^>]*>\{\{ troubleKey\(row\) \| t: troubleParams\(row\) \}\}<\/p>/)
    expect(PANEL_TS).toContain('hostTrouble?: { host: string; why: string } | null')
    expect(PANEL_TS).toContain('`publish.host.${row.hostTrouble.why}`')
    expect(PANEL_TS).toMatch(/branch: row\.segments\[row\.segments\.length - 1\] \?\? row\.path/)
  })

  it('every catalog says every why, naming the branch and the host', () => {
    const files = readdirSync(I18N).filter(f => f.endsWith('.json'))
    expect(files.length).toBeGreaterThanOrEqual(14)
    const en = JSON.parse(readFileSync(join(I18N, 'en.json'), 'utf8')) as Record<string, string>
    expect(en['publish.host.unresolved']).toBe("{branch}: {host} can't be reached — check the host name, and that the host is running")
    for (const file of files) {
      const json = JSON.parse(readFileSync(join(I18N, file), 'utf8')) as Record<string, string>
      for (const why of WHYS) {
        const key = `publish.host.${why}`
        expect(json[key], `${file} is missing ${key}`).toBeTypeOf('string')
        expect((json[key].match(/\{\w+\}/g) ?? []).sort(), `${file} ${key} tokens`).toEqual(['{branch}', '{host}'])
      }
    }
  })
})
