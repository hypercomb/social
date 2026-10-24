// publish-panel-domains.spec.ts — WHAT EACH DOMAIN HOSTS, and acting on the
// picked apps (jwize 2026-10-24). The panel is shell code with no render
// harness here, so — like the other Publish panel specs — this reads its
// source and pins the contract between the panel and the two drones. The
// answers themselves are pure and tested in hypercomb-shared/ui/publish-panel/
// publish-apps.spec.ts.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')
const PANEL = '../../../hypercomb-shared/ui/publish-panel/'
const HTML = read(`${PANEL}publish-panel.component.html`)
const TS = read(`${PANEL}publish-panel.component.ts`)
const STATUS = read('./publish-status.drone.ts')
const GROUPS = read('./publish-groups.drone.ts')
const EN = JSON.parse(read('../../../hypercomb-shared/i18n/en.json')) as Record<string, string>
const JA = JSON.parse(read('../../../hypercomb-shared/i18n/ja.json')) as Record<string, string>

describe('every domain opens on what it hosts', () => {
  it('a chevron opens one domain at a time, and at the root a press on the row does too', () => {
    expect(TS).toMatch(/readonly domainsOpen = accordion\(\)/)
    expect(HTML).toMatch(/class="pdoor-expand"[\s\S]*?\[attr\.aria-expanded\]="domainsOpen\.isOpen\(zone\)"[\s\S]*?\(click\)="toggleDomain\(zone\); \$event\.stopPropagation\(\)"/)
    expect(HTML).toMatch(/\(click\)="current\(\) \? flipDoor\(current\(\), zone\) : toggleDomain\(zone\)"/)
  })

  it('never shows the domain twice: the line under it is the count at the root, the address on a tile', () => {
    expect(HTML).not.toMatch(/@if \(address\(current\(\), zone\); as shown\)/)
    expect(HTML).toMatch(/@if \(domainLine\(zone\); as line\)/)
    expect(TS).toMatch(/if \(at === zone\) return null/)
  })

  it('lists each app by its path and its address there, from the pure answers', () => {
    expect(TS).toMatch(/from '\.\/publish-apps'/)
    expect(HTML).toMatch(/@for \(app of apps; track app\.key\)/)
    expect(HTML).toMatch(/\(click\)="visit\(app\)"/)
    expect(TS).toMatch(/row\.path\.replace\(\/\^\\\/\+\/, ''\)/)
  })
})

describe('picked apps: in memory, published one after another, or grouped on their page', () => {
  it('a pick is a checkbox, kept in memory only — nothing is stored', () => {
    expect(HTML).toMatch(/class="papp-pick"[\s\S]*?role="checkbox"[\s\S]*?\[attr\.aria-checked\]="isPicked\(app\)"/)
    expect(TS).toMatch(/readonly picked = signal<ReadonlySet<string>>\(new Set\(\)\)/)
    expect(TS).not.toMatch(/localStorage/)
  })

  it('Escape folds the open domain first (keeping focus), then clears the picks, then closes the window', () => {
    expect(TS).toMatch(/const open = this\.domainsOpen\.open\(\)\s*if \(open !== null\) \{\s*this\.#keepFocusOn\(open\)\s*return this\.domainsOpen\.dismiss\(\)\s*\}\s*if \(this\.picked\(\)\.size > 0\) \{ this\.clearPicks\(\); return true \}/)
  })

  it('an app links to the address the drone gave, with its own scheme — never a made-up https', () => {
    expect(HTML).toMatch(/\[href\]="appUrl\(app, zone\)"/)
    expect(HTML).not.toMatch(/'https:\/\/' \+/)
  })

  it('while a sweep re-reads the picks, the bar never says they have no changes', () => {
    expect(HTML).toMatch(/@if \(!batch\(\) && !pickedChecking\(\) && pickedRows\(\)\.length > 0 && pickedChanged\(\)\.length === 0\)/)
  })

  it('the panel names the changed picks; the drone runs them one at a time, deepest first', () => {
    expect(TS).toMatch(/EffectBus\.emit\('publish:run-many', \{ keys \}\)/)
    expect(STATUS).toMatch(/'publish:run', 'publish:run-many'/)
    expect(STATUS).toMatch(/const plan = batchOrder\(this\.#rows, keys\)\.map\(row => \(\{ key: row\.key, state: row\.state \}\)\)/)
    expect(STATUS).toMatch(/for \(const \{ key, state \} of plan\) \{[\s\S]*?await this\.#run\(key, true, state\)/)
    // A single publish waits while the picked ones run: both re-sign the index.
    expect(STATUS).toMatch(/if \(this\.#batch && !batched\)/)
    // So does every other act that writes the index — a withdrawal the batch
    // has not reached would otherwise be published again.
    for (const act of ['#door', '#ownAddress', '#forget', '#unpublish']) {
      expect(STATUS, act).toMatch(new RegExp(String.raw`async ${act}\([^)]*\): Promise<void> \{\s*if \(this\.#waitForBatch\(\)\) return`))
    }
    // One that throws counts as not published; the rest still run.
    expect(STATUS).toMatch(/try \{ ok = await this\.#run\(key, true, state\) \}\s*catch/)
    // A row rebuilt mid-run as 'comparing' keeps the state it was picked in.
    expect(STATUS).toMatch(/const state = row\.state === 'comparing' && planned \? planned : row\.state/)
  })

  it('a group is made on the page the picks share, lit there, and shows at the root too', () => {
    expect(TS).toMatch(/EffectBus\.emit\('publish-groups:create', \{ segments: page\.segments, members: page\.members \}\)/)
    expect(GROUPS).toMatch(/'publish-groups:publish',\s*'publish-groups:create',/)
    expect(GROUPS).toMatch(/filter\(label => reading\.children\.includes\(label\)\)/)
    expect(GROUPS).toMatch(/if \(!reading\.on\) \{\s*EffectBus\.emit\('features:enable'/)
    // Switched off for the hive, nothing is made that could never be seen.
    expect(GROUPS).toMatch(/if \(reading\.dormant\) \{/)
    // Picks from another page walk there, so the new group can be published.
    expect(TS).toMatch(/if \(here\.join\('\/'\) !== page\.segments\.join\('\/'\)\)/)
    expect(TS).toMatch(/const here = this\.current\(\)\?\.segments \?\? \(this\.currentKey\(\) \? null : \[\]\)/)
    // Groups are no longer inside the on-a-tile block.
    expect(HTML.indexOf('PUBLISH GROUPS on this layer')).toBeLessThan(HTML.indexOf('THE DETAILS, folded'))
  })
})

describe('every word it says is in the catalogs', () => {
  const used = [...new Set([
    ...[...HTML.matchAll(/'((?:publish|publish-groups)\.(?:domain|apps|selection)[\w.-]*)'/g)].map(m => m[1]),
    ...[...STATUS.matchAll(/'(publish\.batch\.[\w.-]+)'/g)].map(m => m[1]),
    ...[...GROUPS.matchAll(/'(publish-groups\.(?:made-from|not-on-page|not-made))'/g)].map(m => m[1]),
    ...[...TS.matchAll(/'(publish\.apps\.[\w.-]+)'/g)].map(m => m[1]),
  ])]
  const has = (catalog: Record<string, string>, key: string): boolean =>
    key in catalog || `${key}.other` in catalog

  it('in English and Japanese', () => {
    expect(used.length).toBeGreaterThan(12)
    for (const key of used) {
      expect(has(EN, key), key).toBe(true)
      expect(has(JA, key), key).toBe(true)
    }
  })
})
