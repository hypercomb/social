// publish-panel-domains.spec.ts — THE PUBLISH WINDOW AS A DRILLDOWN (jwize
// 2026-11-04: "the list for publishing should be a drilldown. You see the domain
// and you choose, then you see the creations in a list and you turn them on and
// off. That is it"; "65 percent of the list is for single domains and then there
// is a shorter list of named groups below"; "if you hold to click multiple
// domains, when you release it opens up the creations right then"; "turn them
// on or off, or sync if there is a mix"). The panel is shell code with no render
// harness here, so — like the other Publish panel specs — this reads its source
// and pins the contract between the panel and the drones. The answers
// themselves are pure and tested in hypercomb-shared/ui/publish-panel/
// publish-apps.spec.ts and community-host-groups.spec.ts.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')
const PANEL = '../../../hypercomb-shared/ui/publish-panel/'
const HTML = read(`${PANEL}publish-panel.component.html`)
const TS = read(`${PANEL}publish-panel.component.ts`)
const SCSS = read(`${PANEL}publish-panel.component.scss`)
const STATUS = read('./publish-status.drone.ts')
const HOSTS = read('./hosts.drone.ts')
const EN = JSON.parse(read('../../../hypercomb-shared/i18n/en.json')) as Record<string, string>
const JA = JSON.parse(read('../../../hypercomb-shared/i18n/ja.json')) as Record<string, string>

describe('the domains, and under them the named groups', () => {
  it('two thirds of the window are the domains, a third the groups', () => {
    expect(HTML).toMatch(/<section class="pdomains"[\s\S]*?<section class="pgroupsbox"/)
    expect(SCSS).toMatch(/\.pdomains \{ flex: 65 1 0; \}/)
    expect(SCSS).toMatch(/\.pgroupsbox \{\s*flex: 35 1 0;/)
  })

  it('a domain row goes in on a press; Ctrl (⌘) holds it instead, for opening together', () => {
    expect(HTML).toMatch(/class="pdrow"[\s\S]*?\[class\.chosen\]="isChosen\(zone\)"[\s\S]*?\(click\)="pressDomain\(zone, \$event\)"/)
    expect(TS).toMatch(/pressDomain\(zone: string, event: Event\): void \{\s*if \(isMultiPress\(event\)\) \{/)
    expect(TS).toMatch(/return press\.ctrlKey \|\| press\.metaKey/)
    expect(TS).toMatch(/this\.chosen\.set\(new Set\(\)\)\s*this\.#open\(\[zone\], zone, null\)/)
  })

  it('lets go of Ctrl (⌘) and the held domains open together, right then', () => {
    expect(TS).toMatch(/if \(event\.key !== 'Control' && event\.key !== 'Meta'\) return\s*if \(this\.visible\(\) && !this\.drill\(\) && this\.chosen\(\)\.size > 0\) this\.#openChosen\(\)/)
    expect(TS).toMatch(/window\.addEventListener\('keyup', onKeyUp\)/)
    expect(TS).toMatch(/window\.removeEventListener\('keyup', onKeyUp\)/)
    // in the order the list shows them, and the keys are let go of with them
    expect(TS).toMatch(/const held = this\.domains\(\)\.filter\(zone => this\.chosen\(\)\.has\(zone\)\)\s*this\.chosen\.set\(new Set\(\)\)/)
  })

  it('a group opens the domains it holds; its row can be removed without opening it', () => {
    expect(HTML).toMatch(/\(click\)="openGroup\(group\)"/)
    expect(TS).toMatch(/this\.#open\(\[\.\.\.group\.zones\], group\.name, group\.name\)/)
    expect(HTML).toMatch(/class="pgrow-remove"[\s\S]*?\(click\)="removeGroup\(group, \$event\)"/)
    expect(TS).toMatch(/event\.stopPropagation\(\)\s*EffectBus\.emit\('hosts:group-remove', \{ name: group\.name \}\)/)
  })

  it('the groups come from the hosts drone, which owns the domains they name', () => {
    expect(TS).toMatch(/EffectBus\.on<\{ groups\?: unknown \}>\('hosts:render'/)
    expect(HOSTS).toMatch(/'hosts:group-save', 'hosts:group-remove',/)
    expect(HOSTS).toMatch(/groups: this\.#groups\.map\(g => \(\{ name: g\.name, zones: \[\.\.\.g\.zones\] \}\)\)/)
    expect(HOSTS).toMatch(/await saveHostGroup\(p\?\.name, p\?\.zones\)/)
    expect(HOSTS).toMatch(/await removeHostGroup\(p\?\.name\)/)
  })
})

describe('inside: the creations, each a switch', () => {
  it('a creation is a switch that reads on, off or mixed across the domains it covers', () => {
    expect(HTML).toMatch(/class="prow"[\s\S]*?role="switch"[\s\S]*?\[attr\.aria-checked\]="stateOf\(row\) === 'mixed' \? 'mixed' : stateOf\(row\) === 'on'"[\s\S]*?\(click\)="press\(row\)"/)
    expect(TS).toMatch(/return scopeState\(this\.scopeZones\(\), zone => this\.doorOn\(row, zone\)\)/)
  })

  it('a press turns it on across the set, off across the set, or syncs a mix to on — as ONE intent that moves only what has to move', () => {
    expect(TS).toMatch(/this\.#move\(row, wantAfterPress\(this\.stateOf\(row\)\)\)/)
    expect(TS).toMatch(/const zones = zonesToMove\(this\.scopeZones\(\), zone => this\.doorOn\(row, zone\), on\)\s*if \(zones\.length === 0\) return/)
    expect(TS).toMatch(/EffectBus\.emit\('publish:doors', \{ key: row\.key, zones, on \}\)/)
    // no door per domain: the first would leave the row busy and refuse the rest
    expect(TS).not.toMatch(/for \(const zone of zones\) EffectBus\.emit/)
  })

  it('a mixed one offers Sync — on or off, on every domain — and nothing else does', () => {
    expect(HTML).toMatch(/@if \(stateOf\(row\) === 'mixed' && canSwitch\(row\)\) \{[\s\S]*?class="prow-sync"[\s\S]*?\(click\)="sync\(row, true, \$event\)"[\s\S]*?\(click\)="sync\(row, false, \$event\)"/)
    expect(TS).toMatch(/sync\(row: PublishRow, on: boolean, event: Event\): void \{\s*event\.stopPropagation\(\)\s*this\.#move\(row, on\)/)
  })

  it('across several domains a row says how many it is on; on one it says where', () => {
    expect(HTML).toMatch(/'publish\.drill\.on-some' \| t: \{ on: onCount\(row\), count: scopeZones\(\)\.length \}/)
    expect(HTML).toMatch(/'publish\.drill\.on-all' \| t: \{ count: scopeZones\(\)\.length \}/)
    expect(HTML).toMatch(/\[href\]="addressUrl\(row, scopeZones\(\)\[0\]\)"/)
    expect(HTML).not.toMatch(/'https:\/\/' \+/)
    expect(TS).toMatch(/row\.path\.replace\(\/\^\\\/\+\/, ''\)/)
  })

  it('the tile you stand on is listed, so an unpublished one can be switched on', () => {
    expect(TS).toMatch(/Number\(b\.key === this\.currentKey\(\)\) - Number\(a\.key === this\.currentKey\(\)\)/)
    expect(HTML).toMatch(/row\.key === currentKey\(\)[\s\S]*?publish\.apps\.this-tile/)
  })

  it('a row switched off stays on the list, dimmed, until the window closes — or it could not be switched back', () => {
    expect(TS).toMatch(/readonly #kept = signal<ReadonlyMap<string, PublishRow>>\(new Map\(\)\)/)
    expect(TS).toMatch(/else if \(row\.key !== this\.currentKey\(\)\) next\.set\(row\.key, \{ \.\.\.row, live: null, state: 'unpublished' \}\)/)
    expect(TS).toMatch(/close\(\): void \{\s*this\.visible\.set\(false\)\s*this\.#reset\(\)/)
  })

  it('a double press is gone — a press switches, so two would switch twice', () => {
    expect(HTML).not.toMatch(/\(dblclick\)/)
  })

  it('the drone moves a creation across a set of domains in ONE signed index rewrite', () => {
    expect(STATUS).toMatch(/'publish:set-target', 'publish:door', 'publish:doors',/)
    expect(STATUS).toMatch(/this\.onEffect<\{ key\?: string; zones\?: unknown; on\?: boolean \}>\('publish:doors'/)
    expect(STATUS).toMatch(/async #door\(key: string, rawZones: readonly string\[\], on: boolean\): Promise<void> \{\s*if \(this\.#waitForBatch\(\)\) return/)
    expect(STATUS).toMatch(/\? \[\.\.\.new Set\(\[\.\.\.openNow, \.\.\.zones\]\)\]\s*: openNow\.filter\(z => !zones\.includes\(z\)\)/)
    expect(STATUS).toMatch(/const left = on \? \[\] : zones/)
    // the one-domain door is the same act with one zone
    expect(STATUS).toMatch(/this\.#door\(String\(p\?\.key \?\? ''\), \[String\(p\?\.zone \?\? ''\)\], p\?\.on === true\)/)
  })
})

describe('the group, saved from a set of domains with the one input', () => {
  it('a set gathered by ctrl-selection can be kept: two or more domains, not already a group', () => {
    expect(TS).toMatch(/return !!drill && !drill\.group && this\.scopeZones\(\)\.length >= 2/)
    expect(HTML).toMatch(/@if \(canSaveGroup\(\)\) \{[\s\S]*?\(click\)="naming\(\) \? cancelNaming\(\) : startNaming\(\)"/)
  })

  it('the one input takes the name, and Add (or Enter) saves it through the hosts drone', () => {
    expect(TS).toMatch(/readonly inputValue = computed\(\(\) => this\.naming\(\) \? this\.groupName\(\) : this\.query\(\)\)/)
    expect(TS).toMatch(/onEnter\(\): void \{\s*if \(this\.naming\(\)\) this\.addGroup\(\)\s*\}/)
    expect(HTML).toMatch(/\(keydown\.enter\)="onEnter\(\)"/)
    expect(HTML).toMatch(/class="psearch-add"[^>]*\(click\)="addGroup\(\)"/)
    expect(TS).toMatch(/EffectBus\.emit\('hosts:group-save', \{ name, zones \}\)/)
    // the text is the name, not a search, while it is being typed; and a nameless group is not added
    expect(TS).toMatch(/readonly #text = computed<string>\(\(\) => this\.naming\(\) \? '' : this\.query\(\)\)/)
    expect(TS).toMatch(/this\.naming\(\) && this\.groupName\(\)\.trim\(\) !== '' && this\.canSaveGroup\(\)/)
  })

  it('a saved group is opened by its name, and its domains follow the group', () => {
    expect(TS).toMatch(/this\.drill\.set\(\{ zones, title: name, group: name \}\)/)
    expect(TS).toMatch(/const held = this\.groups\(\)\.find\(g => g\.name === drill\.group\)\s*if \(held\) return held\.zones/)
  })
})

describe('the top: one input, Publish changes, and one Escape per level', () => {
  it('the input is always at the top, ahead of every list, and searches whatever is showing', () => {
    expect(HTML.indexOf('class="psearch-input"')).toBeGreaterThan(-1)
    expect(HTML.indexOf('class="psearch-input"')).toBeLessThan(HTML.indexOf('class="plevel"'))
    expect(HTML.indexOf('class="psearch-input"')).toBeLessThan(HTML.indexOf('class="publish-scroll"'))
    expect(TS).toMatch(/matchesQuery\(text, zone\)/)
    expect(TS).toMatch(/matchesQuery\(text, g\.name, \.\.\.g\.zones\)/)
    expect(TS).toMatch(/\.filter\(row => matchesQuery\(text, this\.appName\(row\)\)\)/)
  })

  it('Publish changes is at the top, and says "checking" — not "nothing" — while a sweep re-reads', () => {
    expect(HTML.indexOf('class="pgo"')).toBeLessThan(HTML.indexOf('class="plevel"'))
    expect(HTML).toMatch(/@else if \(changed\(\)\.length > 0\) \{[\s\S]*?\} @else if \(checking\(\)\) \{[\s\S]*?publish\.selection\.checking[\s\S]*?\} @else \{[\s\S]*?publish\.top\.none/)
    expect(TS).toMatch(/this\.refreshing\(\) \|\| this\.#listed\(\)\.some\(row => row\.state === 'comparing'\)/)
    // inside a drilldown it publishes what is live on the scope's domains
    expect(TS).toMatch(/\(!this\.drill\(\) \|\| this\.stateOf\(row\) !== 'off'\)/)
  })

  it('Escape peels one level: the name, the search, the held domains, the drilldown — then the window', () => {
    expect(TS).toMatch(/if \(this\.naming\(\)\) \{ this\.cancelNaming\(\); return true \}\s*if \(this\.query\(\) !== ''\) \{ this\.query\.set\(''\); return true \}\s*if \(this\.chosen\(\)\.size > 0\) \{ this\.chosen\.set\(new Set\(\)\); return true \}\s*if \(this\.drill\(\)\) \{ this\.back\(\); return true \}\s*return false/)
  })
})

describe('Publish changes: the panel names the changed rows; the drone runs them one at a time, deepest first', () => {
  it('goes through publish:run-many', () => {
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
})

describe('every word it says is in the catalogs', () => {
  const used = [...new Set([
    ...[...HTML.matchAll(/'(publish\.(?:domain|domains|drill|apps|selection|search|top|groups|header)[\w.-]*)'/g)].map(m => m[1]),
    ...[...TS.matchAll(/'(publish\.(?:apps|state|here|failure|header)\.[\w.-]+)'/g)].map(m => m[1]),
    ...[...STATUS.matchAll(/'(publish\.batch\.[\w.-]+)'/g)].map(m => m[1]),
  ])]
  const has = (catalog: Record<string, string>, key: string): boolean =>
    key in catalog || `${key}.other` in catalog

  it('in English and Japanese', () => {
    expect(used.length).toBeGreaterThan(20)
    for (const key of used) {
      expect(has(EN, key), key).toBe(true)
      expect(has(JA, key), key).toBe(true)
    }
  })
})
