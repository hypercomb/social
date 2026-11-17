// publish-panel-domains.spec.ts — THE PUBLISH WINDOW: TWO ACTS (jwize
// 2026-11-16: "you should have your own domain and the community separate since
// you are feeding the community from all domains including yourself. Then there
// are only on off no selected for anything you click the item turns on for the
// domain but is gray in the community. Do this for all domains. Then all items go
// in the community; if there are multiple versions you should be able to drill
// down into the children and click the one of them. This makes only two things
// you can do in the app here. Add to community through domains and publish live
// … So locally the publishing should now be called staging"). The panel is shell
// code with no render harness here, so — like the other Publish panel specs —
// this reads its source and pins the contract between the panel and the drone.
// The answers themselves are pure and tested in hypercomb-shared/ui/
// publish-panel/publish-apps.spec.ts and community-switch.spec.ts.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')
const PANEL = '../../../hypercomb-shared/ui/publish-panel/'
const HTML = read(`${PANEL}publish-panel.component.html`)
const TS = read(`${PANEL}publish-panel.component.ts`)
const STATUS = read('./publish-status.drone.ts')
const EN = JSON.parse(read('../../../hypercomb-shared/i18n/en.json')) as Record<string, string>
const JA = JSON.parse(read('../../../hypercomb-shared/i18n/ja.json')) as Record<string, string>

describe('the top level: your community apart, then the domains, yours first', () => {
  it('the community is its own section, ahead of the domains', () => {
    expect(HTML).toMatch(/<section class="pcommunity"[\s\S]*?\(click\)="openCommunity\(\)"[\s\S]*?<section class="pdomains"/)
  })

  it('your own domain leads the list and says so', () => {
    expect(TS).toMatch(/return yours \? \[yours, \.\.\.rest\] : rest/)
    expect(TS).toMatch(/this\.yourZone\.set\(String\(p\.zone \?\? ''\)\.toLowerCase\(\)\)/)
    expect(HTML).toMatch(/@if \(isYours\(zone\)\) \{<span class="pdrow-tag">\{\{ 'publish\.domain\.yours' \| t \}\}/)
  })

  it('nothing is selected: no groups, no Ctrl-held domains, no mixed state, no Sync', () => {
    for (const gone of ['chosen', 'isMultiPress', 'openGroup', 'hosts:group-save', 'naming(', 'scopeState', 'mixed', 'sync(']) {
      expect(TS.includes(gone), gone).toBe(false)
      expect(HTML.includes(gone), gone).toBe(false)
    }
  })

  it('a domain row opens that one domain', () => {
    expect(HTML).toMatch(/class="pdrow"[\s\S]*?\(click\)="openDomain\(zone\)"/)
    expect(TS).toMatch(/openDomain\(zone: string\): void \{\s*this\.#open\(\{ kind: 'domain', zone \}\)/)
  })
})

describe('in a domain: each creation on or off — on stages it there', () => {
  it('a creation is a switch, on or off in this one domain', () => {
    expect(HTML).toMatch(/class="prow"[\s\S]*?role="switch"[\s\S]*?\[attr\.aria-checked\]="isOn\(row\)"[\s\S]*?\(click\)="press\(row\)"/)
    expect(TS).toMatch(/isOn\(row: PublishRow\): boolean \{\s*return this\.doorOn\(row, this\.scopeZone\(\)\)/)
  })

  it('a press flips it in that domain alone, as one intent', () => {
    expect(TS).toMatch(/const on = !this\.doorOn\(row, zone\)/)
    expect(TS).toMatch(/EffectBus\.emit\('publish:doors', \{ key: row\.key, zones: \[zone\], on \}\)/)
  })

  it('the tile you stand on is listed, so an unstaged one can be switched on', () => {
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

  it('the drone moves a creation in ONE signed index rewrite', () => {
    expect(STATUS).toMatch(/'publish:set-target', 'publish:door', 'publish:doors',/)
    expect(STATUS).toMatch(/async #door\(key: string, rawZones: readonly string\[\], on: boolean\): Promise<boolean> \{\s*if \(this\.#waitForBatch\(\)\) return false/)
  })
})

describe('in the community: gray is staged, lit is live', () => {
  it('everything on in any domain feeds it: your rows, what followed domains offer, what the showcase names', () => {
    expect(TS).toMatch(/hosts: domains\.filter\(zone => this\.doorOn\(row, zone\)\)/)
    expect(TS).toMatch(/\.filter\(v => v\.hosts\.length > 0\)/)
    expect(TS).toMatch(/communityEntries\(this\.pubkey\(\), own, community\.offered, community\.live\)/)
    expect(STATUS).toMatch(/offeredInstances\?: \(\) => readonly OfferedInstance\[\]/)
  })

  it('an entry is lit when live; a press on one version publishes it live or takes it out', () => {
    expect(HTML).toMatch(/\[class\.on\]="entry\.live"[\s\S]*?\(click\)="pressEntry\(entry\)"/)
    expect(TS).toMatch(/EffectBus\.emit\('publish:community', communityPress\(entry, version\)\)/)
  })

  it('a name with several versions opens to them, and a press picks the one', () => {
    expect(TS).toMatch(/if \(entry\.versions\.length > 1\) \{ this\.#open\(\{ kind: 'versions', name: entry\.name \}\); return \}/)
    expect(HTML).toMatch(/@for \(version of entry\.versions;[\s\S]*?\(click\)="pressVersion\(entry, version\)"/)
    // back from the versions is the community, not the top
    expect(TS).toMatch(/this\.drill\.set\(this\.drill\(\)\?\.kind === 'versions' \? \{ kind: 'showcase' \} : null\)/)
  })

  it('the drone signs it through community-switch, one write at a time, and says busy meanwhile', () => {
    expect(STATUS).toMatch(/'publish:community', 'community:offers-render'/)
    expect(STATUS).toMatch(/const result = await switchInCommunity\(\{ zone, item, on, others \}\)/)
    expect(STATUS).toMatch(/if \(mine\) \{ this\.#communityBusy\.add\(id\); this\.#emit\(\) \}/)
    expect(HTML).toMatch(/\[class\.busy\]="entryBusy\(entry\)"/)
  })

  it('the community lives on your own domain: with none named it says so', () => {
    expect(STATUS).toMatch(/if \(!zone\) \{\s*this\.#toast\('warning', 'publish\.community\.no-zone'/)
    expect(HTML).toMatch(/@if \(!community\(\)\.zone\) \{\s*<p class="pnote">\{\{ 'publish\.community\.no-zone' \| t \}\}/)
  })

  it('both ways (jwize 2026-11-16: "any bound items turn off on the domains … are bidirectional"): yours out of the community is off its domains; off its last domain, out of the community', () => {
    // out of the community: one of yours, published from here, is bound to its domains — refused while it is busy
    expect(STATUS).toMatch(/const row = !on && bound && item\.pubkey === this\.#payload\.pubkey \? this\.#rows\.find\(r => r\.key === item\.lineage\) : undefined/)
    expect(STATUS).toMatch(/if \(row!\.busyPhase \|\| this\.#inFlight\.has\(row!\.key\)\) \{\s*this\.#toast\('tip', 'publish\.community\.busy'/)
    // and off them, said only once both have landed; the withdrawal goes through its own domains, never every host
    expect(STATUS).toMatch(/if \(await this\.#offEverywhere\(item\.lineage\)\) \{\s*this\.#toast\('success', 'publish\.community\.out-everywhere'/)
    expect(STATUS).toMatch(/const left = \[\.\.\.\(row\.doors \?\? this\.#zonesFor\(key\)\)\]/)
    // off the last domain (or withdrawn by publish:unpublish): out of the community, only once the withdrawal landed
    expect(STATUS).toMatch(/const done = await this\.#unpublish\(key, left\)\s*row\.busyPhase = null\s*if \(!done\) \{[^\n]*return false \}\s*\/\/[^\n]*\n\s*await this\.#outOfCommunity\(key\)/)
    expect(STATUS).toMatch(/void this\.#unpublish\(key\)\.then\(done => \{ if \(done\) void this\.#outOfCommunity\(key\) \}\)/)
    // always asked of the signed record, in the lane, after a switch already queued for it
    expect(STATUS).toMatch(/async #outOfCommunity\(key: string\): Promise<void> \{\s*const own = this\.#payload\.pubkey\s*if \(!SIG_RE\.test\(own\)\) return\s*await this\.#communitySwitch\(\{ pubkey: own, lineage: key \}, false, \[\], false\)/)
    expect(EN['publish.community.out-everywhere']).toMatch(/off its domains/)
  })

  it('the live list is read with the sweep and never waited on', () => {
    expect(STATUS).toMatch(/void this\.#readShowcase\(\)/)
  })
})

describe('the top: one input, Stage changes, and one Escape per level', () => {
  it('the input is always at the top, ahead of every list, and searches whatever is showing', () => {
    expect(HTML.indexOf('class="psearch-input"')).toBeGreaterThan(-1)
    expect(HTML.indexOf('class="psearch-input"')).toBeLessThan(HTML.indexOf('class="plevel"'))
    expect(HTML.indexOf('class="psearch-input"')).toBeLessThan(HTML.indexOf('class="publish-scroll"'))
    expect(TS).toMatch(/matchesQuery\(text, zone\)/)
    expect(TS).toMatch(/\.filter\(row => matchesQuery\(text, this\.appName\(row\)\)\)/)
    expect(TS).toMatch(/matchesQuery\(text, entry\.name, \.\.\.entry\.versions\.flatMap\(v => v\.hosts\)\)/)
  })

  it('Stage changes is at the top, and says "checking" — not "nothing" — while a sweep re-reads', () => {
    expect(HTML.indexOf('class="pgo"')).toBeLessThan(HTML.indexOf('class="plevel"'))
    expect(HTML).toMatch(/\(click\)="stageChanges\(\)"/)
    expect(HTML).toMatch(/@else if \(changed\(\)\.length > 0\) \{[\s\S]*?\} @else if \(checking\(\)\) \{[\s\S]*?publish\.selection\.checking[\s\S]*?\} @else \{[\s\S]*?publish\.top\.none/)
    expect(TS).toMatch(/this\.refreshing\(\) \|\| this\.#listed\(\)\.some\(row => row\.state === 'comparing'\)/)
  })

  it('locally it is staging: the words say stage, publish is the community\'s', () => {
    expect(EN['publish.selection.publish']).toMatch(/^Stage changes/)
    expect(EN['publish.top.none']).toMatch(/stage/)
    expect(EN['publish.state.pending']).toBe('staging')
    expect(EN['publish.done']).toMatch(/^Staged/)
    expect(EN['publish.community.row-tip']).toMatch(/publish it live/)
  })

  it('Escape peels one level: the search, the drilldown — then the window', () => {
    expect(TS).toMatch(/if \(this\.query\(\) !== ''\) \{ this\.query\.set\(''\); return true \}\s*if \(this\.drill\(\)\) \{ this\.back\(\); return true \}\s*return false/)
  })
})

describe('Stage changes: the panel names the changed rows; the drone runs them one at a time, deepest first', () => {
  it('goes through publish:run-many', () => {
    expect(TS).toMatch(/EffectBus\.emit\('publish:run-many', \{ keys \}\)/)
    expect(STATUS).toMatch(/'publish:run', 'publish:run-many'/)
    expect(STATUS).toMatch(/const plan = batchOrder\(this\.#rows, keys\)\.map\(row => \(\{ key: row\.key, state: row\.state \}\)\)/)
    expect(STATUS).toMatch(/for \(const \{ key, state \} of plan\) \{[\s\S]*?await this\.#run\(key, true, state\)/)
    expect(STATUS).toMatch(/if \(this\.#batch && !batched\)/)
    for (const act of ['#door', '#ownAddress', '#forget', '#unpublish']) {
      expect(STATUS, act).toMatch(new RegExp(String.raw`async ${act}\([^)]*\): Promise<(?:void|boolean)> \{\s*if \(this\.#waitForBatch\(\)\) return`))
    }
    expect(STATUS).toMatch(/try \{ ok = await this\.#run\(key, true, state\) \}\s*catch/)
    expect(STATUS).toMatch(/const state = row\.state === 'comparing' && planned \? planned : row\.state/)
  })
})

describe('every word it says is in the catalogs', () => {
  const used = [...new Set([
    ...[...HTML.matchAll(/'(publish\.[\w.-]+)'/g)].map(m => m[1]),
    ...[...TS.matchAll(/'(publish\.(?:apps|state|here|failure|header)\.[\w.-]+)'/g)].map(m => m[1]),
    ...[...STATUS.matchAll(/'(publish\.(?:batch|community)\.[\w.-]+)'/g)].map(m => m[1]),
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
