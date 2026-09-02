import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const shared = join(here, '..', '..', '..', 'hypercomb-shared')
const DRONE = readFileSync(join(here, 'publish-status.drone.ts'), 'utf8')
const HOSTS_DRONE = readFileSync(join(here, 'hosts.drone.ts'), 'utf8')
const PUBLISH_BRANCH = readFileSync(join(here, 'publish-branch.ts'), 'utf8')
const HOST_SYNC = readFileSync(join(here, 'host-sync.service.ts'), 'utf8')
const HTML = readFileSync(join(shared, 'ui', 'publish-panel', 'publish-panel.component.html'), 'utf8')
const TS = readFileSync(join(shared, 'ui', 'publish-panel', 'publish-panel.component.ts'), 'utf8')
const HOSTS_HTML = readFileSync(join(shared, 'ui', 'hosts-panel', 'hosts-panel.component.html'), 'utf8')
const HOSTS_TS = readFileSync(join(shared, 'ui', 'hosts-panel', 'hosts-panel.component.ts'), 'utf8')
const BARREL = readFileSync(join(shared, 'ui', 'shell-surfaces', 'shell-surfaces.barrel.ts'), 'utf8')
const EN = JSON.parse(readFileSync(join(shared, 'i18n', 'en.json'), 'utf8')) as Record<string, string>

// TWO FACTS, KEPT APART. What you carry is a community of host artifacts; where
// a branch publishes is a mark that branch wears. Collapsing them is what made
// one mistyped hostname permanent — it entered as a claim, and a claim was
// never withdrawn.
//
// A THIRD separation joined them: the community is no longer a TAB inside
// publish. A host exists before any branch names it and outlives every branch
// that does, so it has its own panel and its own drone, and publish reads the
// same pool rather than owning it.
describe('hosts panel — the set, apart from the publishing', () => {
  it('is its own shell surface, mounted from the barrel', () => {
    expect(HOSTS_TS).toMatch(/registerShellSurface\(\{[\s\S]{0,200}?name: 'hc-hosts-panel'/)
    expect(BARREL).toMatch(/import '\.\.\/hosts-panel\/hosts-panel\.component'/)
  })

  it('left the publish panel entirely — no tab, no case, no handlers', () => {
    expect(HTML).not.toMatch(/setTab\('community'\)/)
    expect(HTML).not.toMatch(/@case \('community'\)/)
    expect(HTML).not.toMatch(/setTab\('domains'\)/)
    expect(TS).not.toMatch(/'community'/)
    expect(EN['publish.tab.community']).toBeUndefined()
  })

  it('a stored `community` or `domains` tab lands on Status rather than nothing', () => {
    expect(TS).toMatch(/return v === 'opens' \|\| v === 'versions' \? v : 'status'/)
  })

  it('adds and REMOVES hosts, through the drone that owns the pool', () => {
    expect(HOSTS_HTML).toMatch(/add\(hostInput\)/)
    expect(HOSTS_HTML).toMatch(/remove\(zone\)/)
    expect(HOSTS_TS).toMatch(/EffectBus\.emit\('hosts:add'/)
    expect(HOSTS_TS).toMatch(/EffectBus\.emit\('hosts:remove'/)
    expect(HOSTS_DRONE).toMatch(/onEffect<\{ zone\?: string \}>\('hosts:add'/)
    expect(HOSTS_DRONE).toMatch(/onEffect<\{ zone\?: string \}>\('hosts:remove'/)
  })

  it('has ONE writer — the publish drone reads the pool and no longer acts on it', () => {
    expect(DRONE).not.toMatch(/publish:community-add/)
    expect(DRONE).not.toMatch(/publish:community-remove/)
    expect(DRONE).not.toMatch(/removeCommunityHost/)
    expect(DRONE).not.toMatch(/addCommunityHost/)
    expect(HOSTS_DRONE).toMatch(/removeCommunityHost/)
    expect(HOSTS_DRONE).toMatch(/addCommunityHost/)
  })

  it('reads the list eagerly, so the publish picker is never empty for want of a look', () => {
    // The failure this pins: as a tab, the list did not exist until the
    // publish panel had rendered once.
    expect(HOSTS_DRONE).toMatch(/void this\.#read\(\)/)
    expect(HOSTS_DRONE).toMatch(/const carried = await listCommunityHosts\(\)|await listCommunityHosts\(\)/)
  })

  it('tells "none yet" from "not read yet" instead of flashing an empty state', () => {
    expect(HOSTS_DRONE).toMatch(/loaded: boolean/)
    expect(HOSTS_HTML).toMatch(/@if \(loaded\(\)\) \{/)
  })

  it('counts branches as a DECORATION, never as its own truth', () => {
    // publish:render is read for the count and nothing else; a host with no
    // count renders without one rather than with a zero.
    expect(HOSTS_TS).toMatch(/EffectBus\.on<PublishRenderish>\('publish:render'/)
    expect(HOSTS_HTML).toMatch(/@if \(branchCount\(zone\); as naming\)/)
  })

  // ONE READER of "what does this domain publish". The shim asks it on a cold
  // boot and the app asks it in the panel; two copies would drift on the first
  // change to the manifest shape, and the two readers would then disagree
  // about what a host offers — the one thing they must never do.
  it('reads a host manifest from runtime, never from a second copy', () => {
    const runtime = readFileSync(join(here, '..', '..', '..', 'hypercomb-runtime', 'src', 'host-packages.ts'), 'utf8')
    const shimReplicate = readFileSync(join(here, '..', '..', '..', 'hypercomb-shim', 'src', 'bootstrap', 'replicate.ts'), 'utf8')

    expect(runtime).toMatch(/export const listHostPackages/)
    expect(runtime).toMatch(/export const hostBases/)
    // ACQUISITION ITSELF moved to runtime too, so both shells share one
    // implementation. The shim file is now nothing but a re-export.
    expect(shimReplicate).toMatch(/from '@hypercomb\/runtime\/acquire'/)
    expect(shimReplicate).not.toMatch(/export const listHostPackages = async/)
    expect(shimReplicate).not.toMatch(/export const installPackage = async/)
    expect(shimReplicate).not.toMatch(/const basesFor =/)
    // The panel uses the same one — NOT a drone, because essentials imports
    // core and nothing else and so cannot reach runtime.
    expect(HOSTS_TS).toMatch(/from '@hypercomb\/runtime\/host-packages'/)
    expect(HOSTS_DRONE).not.toMatch(/listHostPackages/)
  })

  it('asks a host what it publishes ON DEMAND, never on open', () => {
    // A manifest runs to megabytes (jwize.com's is 3.4 MB). Opening the panel
    // must not fetch every carried host's.
    expect(HOSTS_TS).toMatch(/async look\(zone: string\)/)
    expect(HOSTS_TS).not.toMatch(/listHostPackages\([\s\S]{0,80}?\)[\s\S]{0,40}?constructor/)
    expect(HOSTS_HTML).toMatch(/\(click\)="look\(zone\)"/)
  })

  it('keeps a large host catalog reachable behind an explicit fold', () => {
    expect(HOSTS_TS).toMatch(/OFFERS_SHOWN/)
    expect(HOSTS_TS).toMatch(/packagesShown\(zone: string\)/)
    expect(HOSTS_HTML).toMatch(/hosts\.offer\.show-all/)
    expect(HOSTS_HTML).toMatch(/hosts\.offer\.show-less/)
  })

  it('adds an offered package through verified runtime acquisition, then restarts', () => {
    expect(HOSTS_HTML).toMatch(/\(click\)="take\(pkg\)"/)
    expect(HOSTS_TS).toMatch(/import\('@hypercomb\/runtime\/acquire'\)/)
    expect(HOSTS_TS).toMatch(/await acquire\(sig, sources\)/)
    expect(HOSTS_TS).toMatch(/setTimeout\(\(\) => location\.reload\(\)/)
    expect(EN['hosts.offer.add']).toBe('Add')
    expect(EN['hosts.offer.added']).toMatch(/restarting/i)
  })

  it('links Publish to the host directory without mixing the two surfaces', () => {
    expect(HTML).toMatch(/\(click\)="openHosts\(\)"/)
    expect(TS).toMatch(/openHosts\(\): void[\s\S]{0,180}?EffectBus\.emit\('hosts:open'/)
    expect(HOSTS_DRONE).toMatch(/'hosts:open'/)
    expect(EN['publish.action.manage-hosts']).toBe('Manage hosts')
  })

  // HOSTING IS A SWITCH, NOT A VERB. There is no `/host` behaviour: either
  // this participant puts bytes on a public host or they do not, and a branch
  // is published from its own line item in the publish panel.
  it('has no /host behaviour anywhere', () => {
    const sideEffects = readFileSync(join(here, '..', 'side-effects.ts'), 'utf8')
    expect(sideEffects).not.toMatch(/sharing\/host\.queen/)
    expect(() => readFileSync(join(here, 'host.queen.ts'), 'utf8')).toThrow()
    expect(EN['slash.host']).toBeUndefined()
    // The GESTURE survives as a plain function — the phone share sheet needs
    // one call that publishes a branch and hands back an openable link.
    const gesture = readFileSync(join(here, 'host-gesture.ts'), 'utf8')
    expect(gesture).toMatch(/export const hostCurrentBranch/)
    expect(gesture).not.toMatch(/readonly command = 'host'/)
    expect(gesture).not.toMatch(/HostQueenBee/)
  })

  it('has NO hosting switch — publishing is the gesture', () => {
    // It was redundant in one direction and untrue in the other. ON armed
    // something `publishBranch` arms itself (`enablePublicHost()`), so it
    // could only ever be already-on by the time it mattered. OFF read as
    // "my sites come down" and did nothing of the kind: bytes already on a
    // host stay (no delete surface, deliberately), the signed index still
    // names the head, every published site keeps serving — and the next
    // publish silently flipped the flag back on, so even the one thing it
    // did do never survived. Taking something down is `unpublishBranch`.
    expect(HOSTS_HTML).not.toMatch(/toggleHosting/)
    expect(HOSTS_HTML).not.toMatch(/role="switch"/)
    expect(HOSTS_HTML).not.toMatch(/hosts-switch/)
    expect(HOSTS_TS).not.toMatch(/toggleHosting/)
    expect(HOSTS_TS).not.toMatch(/hosting/)
    expect(HOSTS_DRONE).not.toMatch(/hosts:set-hosting/)
    expect(HOSTS_DRONE).not.toMatch(/disablePublicHost/)
  })

  it('leaves no orphan strings behind for a control that is gone', () => {
    for (const key of Object.keys(EN)) expect(key.startsWith('hosts.hosting.')).toBe(false)
  })

  it('seeds ONE known host into an empty pool, and only ever once', () => {
    // Replication needs somewhere to pull FROM before anyone has typed
    // anything. But a seed that returns after a removal is the "one entry you
    // cannot delete" bug all over again, so emptiness gets the seed once and a
    // flag makes sure it is once.
    expect(HOSTS_DRONE).toMatch(/const SEED_HOST = 'jwize\.com'/)
    expect(HOSTS_DRONE).toMatch(/if \(this\.#zones\.length === 0\) await this\.#seedOnce\(\)/)
    expect(HOSTS_DRONE).toMatch(/localStorage\.getItem\(SEEDED_KEY\) === '1'\) return/)
  })

  it('spends the one seed only when it actually landed', () => {
    // THE BUG THIS PINS, found live: the flag was set BEFORE the add. On the
    // eager first read the Store has not registered, `addCommunityHost`
    // answers '', and the participant was left flagged-as-seeded with an empty
    // pool — nothing to replicate from, silently and for good.
    const seed = HOSTS_DRONE.slice(HOSTS_DRONE.indexOf('async #seedOnce'))
    const addAt = seed.indexOf('await addCommunityHost(SEED_HOST)')
    const setAt = seed.indexOf('localStorage.setItem(SEEDED_KEY')
    expect(addAt).toBeGreaterThan(-1)
    expect(setAt).toBeGreaterThan(addAt)          // set AFTER the add, never before
    expect(seed).toMatch(/if \(!zone\) return\s*\n\s*try \{ localStorage\.setItem\(SEEDED_KEY/)
    // And the read runs again once the Store exists, so the retry actually happens.
    expect(HOSTS_DRONE).toMatch(/whenReady\?\.\(STORE_KEY, \(\) => \{ void this\.#read\(\) \}\)/)
  })

  it('the branch still picks its hosts on its own line item, and may pick several', () => {
    const row = HTML.indexOf('class="pdet-domains pcur-hosts"')
    const tabs = HTML.indexOf('<nav class="publish-tabs"')
    expect(row).toBeGreaterThan(-1)
    expect(row).toBeLessThan(tabs)          // above the tabs: it belongs to the row
    expect(HTML).toMatch(/toggleHost\(row, choice\.zone\)/)
    expect(HTML).toMatch(/makePrimary\(row, choice\.zone\)/)
  })

  it('renders branch details once, in the properties pane rather than every list row', () => {
    expect((HTML.match(/class="pdet-domains pcur-hosts"/g) ?? [])).toHaveLength(1)
    expect(HTML).not.toMatch(/row\.expanded/)
    expect(HTML).not.toMatch(/class="prow-detail"/)
    expect(TS).not.toMatch(/expanded: boolean/)
    expect(DRONE).not.toMatch(/publish:expand/)
    expect(DRONE).toMatch(/publish:inspect/)
  })

  it('the pick-list is the community, never a union of past claims', () => {
    expect(DRONE).toMatch(/#knownZones\(\): string\[\] \{[\s\S]{0,600}?return \[\.\.\.this\.#community\]/)
    expect(DRONE).toMatch(/this\.#community = await listCommunityHosts\(\)/)
    expect(DRONE).not.toMatch(/#readCommunity/)
    expect(DRONE).not.toMatch(/publicHostDomainsFor/)
  })

  it('a branch answers only with the marks it wears, then the standing fallback', () => {
    expect(DRONE).toMatch(/const named = this\.#branchHosts\.get\(key\) \?\? \[\][\s\S]{0,200}?if \(named\.length > 0\) return named/)
    expect(DRONE).toMatch(/await setBranchHosts\(row\.segments, ordered\)/)
    expect(DRONE).toMatch(/await hostsOfBranch\(/)
    expect(PUBLISH_BRANCH).toMatch(/branchZones = await hostsOfBranch\(segs\)/)
    expect(PUBLISH_BRANCH).not.toMatch(/publicHostDomainsFor/)
    expect(HOST_SYNC).not.toMatch(/PUBLIC_HOST_DOMAINS_KEY/)
    expect(HOST_SYNC).not.toMatch(/publicHostDomainFor|publicHostDomainsFor|setPublicHostDomainsFor/)
  })

  it('updates the publish picker from hosts:render without starting a publish sweep', () => {
    expect(HOSTS_DRONE).not.toMatch(/publish:refresh/)
    expect(DRONE).toMatch(/'hosts:render'/)
    expect(DRONE).toMatch(/hosts: this\.#knownZones\(\)/)
  })
})
