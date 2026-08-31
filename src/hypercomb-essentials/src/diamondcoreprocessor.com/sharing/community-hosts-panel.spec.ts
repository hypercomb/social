import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const shared = join(here, '..', '..', '..', '..', 'hypercomb-shared')
const DRONE = readFileSync(join(here, 'publish-status.drone.ts'), 'utf8')
const HTML = readFileSync(join(shared, 'ui', 'publish-panel', 'publish-panel.component.html'), 'utf8')
const TS = readFileSync(join(shared, 'ui', 'publish-panel', 'publish-panel.component.ts'), 'utf8')
const EN = JSON.parse(readFileSync(join(shared, 'i18n', 'en.json'), 'utf8')) as Record<string, string>

// TWO FACTS, KEPT APART. What you carry is a community of host artifacts; where
// a branch publishes is a mark that branch wears. Collapsing them is what made
// one mistyped hostname permanent — it entered as a claim, and a claim was
// never withdrawn.
describe('publish panel — community and the line item', () => {
  it('the tab is the community you carry, not a picker', () => {
    expect(HTML).toMatch(/setTab\('community'\)/)
    expect(HTML).toMatch(/publish\.tab\.community/)
    expect(HTML).toMatch(/@case \('community'\)/)
    expect(HTML).not.toMatch(/setTab\('domains'\)/)
    expect(HTML).not.toMatch(/@case \('domains'\)/)
    expect(EN['publish.tab.community']).toBe('Community')
  })

  it('a stored `domains` tab still opens — the spelling changed, not the place', () => {
    expect(TS).toMatch(/if \(v === 'domains'\) return 'community'/)
  })

  it('the branch picks its hosts on its own line item, and may pick several', () => {
    const row = HTML.indexOf('class="pdet-domains pcur-hosts"')
    const tabs = HTML.indexOf('<nav class="publish-tabs"')
    expect(row).toBeGreaterThan(-1)
    expect(row).toBeLessThan(tabs)          // above the tabs: it belongs to the row
    expect(HTML).toMatch(/toggleHost\(row, choice\.zone\)/)
    expect(HTML).toMatch(/makePrimary\(row, choice\.zone\)/)
  })

  it('the community tab adds and REMOVES hosts', () => {
    expect(HTML).toMatch(/addCommunityHost\(hostInput\)/)
    expect(HTML).toMatch(/removeCommunityHost\(zone\)/)
    expect(TS).toMatch(/EffectBus\.emit\('publish:community-add'/)
    expect(TS).toMatch(/EffectBus\.emit\('publish:community-remove'/)
    expect(DRONE).toMatch(/onEffect<\{ zone\?: string \}>\('publish:community-add'/)
    expect(DRONE).toMatch(/onEffect<\{ zone\?: string \}>\('publish:community-remove'/)
  })

  it('the pick-list is the community, never a union of past claims', () => {
    expect(DRONE).toMatch(/#knownZones\(_keys: Iterable<string>\): string\[\] \{[\s\S]{0,600}?return \[\.\.\.this\.#community\]/)
    // The claim union survives ONLY as the one-time seed for an empty pool.
    expect(DRONE).toMatch(/async #readCommunity/)
    expect(DRONE).toMatch(/const carried = await listCommunityHosts\(\)/)
  })

  it('a branch answers with the marks it wears, before any legacy record', () => {
    expect(DRONE).toMatch(/const named = this\.#branchHosts\.get\(key\) \?\? \[\][\s\S]{0,200}?if \(named\.length > 0\) return named/)
    expect(DRONE).toMatch(/void setBranchHosts\(segments, zones\)/)
    expect(DRONE).toMatch(/await hostsOfBranch\(/)
  })
})
