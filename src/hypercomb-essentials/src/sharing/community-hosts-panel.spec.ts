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

  it('applies a build through verified runtime acquisition, then restarts', () => {
    expect(HOSTS_HTML).toMatch(/\(click\)="apply\(pkg\)"/)
    expect(HOSTS_TS).toMatch(/import\('@hypercomb\/runtime\/acquire'\)/)
    expect(HOSTS_TS).toMatch(/await acquire\(sig, sources\)/)
    expect(HOSTS_TS).toMatch(/setTimeout\(\(\) => location\.reload\(\)/)
    expect(EN['hosts.offer.applied']).toMatch(/restarting/i)
  })

  // WHO MAY MAKE IT LIVE. Integrity proves the bytes; it never proved the
  // publisher, and the panel could apply ANY carried domain's package into
  // this origin. Activation now asks the authority gate BEFORE a byte moves,
  // and the panel offers the honest alternative — visit their domain.
  it('refuses a package no followed publisher signed, before fetching it', () => {
    const acquire = readFileSync(join(here, '..', '..', '..', 'hypercomb-runtime', 'src', 'acquire.ts'), 'utf8')
    const gate = acquire.indexOf('await activationAuthority(')
    expect(gate).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(acquire.indexOf('deriveInventory(pkg.packageSig'))
    expect(acquire).toMatch(/if \(!authority\.ok\) return fail\(authority\.error\)/)
    expect(HOSTS_HTML).toMatch(/class="hosts-visit"/)
    expect(HOSTS_HTML).toMatch(/hosts\.builds\.authority/)
    expect(EN['hosts.builds.authority']).toMatch(/publisher you follow/)
  })

  // TWO FACTS AND ONE ACT. A host lists hundreds of builds and every one of
  // them is a valid root forever — but 175 identical rows each with its own
  // button is not a choice. The question is "am I current, and if not make me
  // current": the build you are on, the newest here, and ONE Update button.
  // The ledger stays behind a fold for pinning and rollback.
  it('says which build you are on, from the ONE stamp both install paths leave', () => {
    const root = join(here, '..', '..', '..')
    const runtime = readFileSync(join(root, 'hypercomb-runtime', 'src', 'installed-package.ts'), 'utf8')
    const acquire = readFileSync(join(root, 'hypercomb-runtime', 'src', 'acquire.ts'), 'utf8')
    const ensureInstall = readFileSync(join(root, 'hypercomb-web', 'src', 'setup', 'ensure-install.ts'), 'utf8')
    expect(runtime).toMatch(/export const installedPackageSig/)
    expect(runtime).toMatch(/export const stampInstalledPackage/)
    // Both activation paths stamp it; nothing else writes the key.
    expect(acquire).toMatch(/stampInstalledPackage\(pkg\.packageSig\)/)
    expect(acquire).not.toMatch(/localStorage\.setItem\(INSTALLED_KEY/)
    expect(ensureInstall).toMatch(/stampInstalledPackage\(bundled\.packageSig\)/)
    expect(HOSTS_TS).toMatch(/from '@hypercomb\/runtime\/installed-package'/)
    expect(HOSTS_HTML).toMatch(/yoursKey\(zone\)/)
    expect(EN['hosts.offer.yours']).toMatch(/build \{generation\}/)
  })

  it('offers ONE Update button, which applies the newest build', () => {
    expect(HOSTS_TS).toMatch(/newestOf\(zone: string\): HostPackage \| null \{[\s\S]{0,60}?return this\.offeredOf\(zone\)\[0\]/)
    expect(HOSTS_TS).toMatch(/offeredOf\(zone: string\): HostPackage\[\]/)
    expect(HOSTS_TS).toMatch(/concealed\.has\(p\.packageSig\)/)
  })

  it('says "you hid everything" rather than "publishes nothing"', () => {
    expect(HOSTS_TS).toMatch(/allHidden\(zone: string\): boolean/)
    expect(HOSTS_HTML).toMatch(/hosts\.hidden\.all/)
    expect(EN['hosts.hidden.all']).toBeTruthy()
  })

  it('promises only what a local forget can deliver', () => {
    // Deleting reaches nothing across the network — the build stays on the
    // host that published it, fetchable by anyone who names its signature.
    expect(EN['hosts.hidden.note']).toMatch(/stays published on the host/i)
    expect(EN['hosts.hidden.delete-tip']).toMatch(/stays on the host/i)
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

// ── the other half of the directory: what a domain SERVES ───────────────────
//
// A domain is a list of domains until it can show you what is on them. Jaime,
// 2026-09-09: "just a sidebar with a list of domains, and each time you select
// one you get to see the list of features — and then when you're done you just
// see the list of features that your domain has."
//
// The switch on each creation is an OFFER and nothing else. Per the static
// peers ruling: shaded by default, and the walk in is the adopt. There is no
// door here that brings a branch in, and the publisher never sets the flag for
// you — the offers document is yours, written in your own pool.
const STATIC_PEERS = readFileSync(join(here, 'static-peers.drone.ts'), 'utf8')

describe('the host directory shows what a domain serves', () => {
  it('asks the domain for its creations when you look into it, and only then', () => {
    expect(HOSTS_TS).toMatch(/EffectBus\.emit\('hosts:creations', \{ zone \}\)/)
    expect(STATIC_PEERS).toMatch(/this\.onEffect<\{ zone\?: string \}>\('hosts:creations'/)
    // Asked from look(), never from the render loop or the panel opening.
    expect(HOSTS_TS).toMatch(/async look\(zone: string\)[\s\S]{0,800}?EffectBus\.emit\('hosts:creations'/)
  })

  it('is answered by the drone that owns the offers, so the switch cannot disagree with the hive', () => {
    expect(STATIC_PEERS).toMatch(/'community:offers-render'/)
    expect(STATIC_PEERS).toMatch(/'hosts:creations:render'/)
    // The offered flag is read at emit time, never stored on the card.
    expect(STATIC_PEERS).toMatch(/#renderCreations = \(zone: string\): void => \{[\s\S]{0,600}?offered: this\.#offers\.has\(row\.name\)/)
    // Offering or withdrawing anywhere in the hive redraws every list.
    expect(STATIC_PEERS).toMatch(/#renderOfferState = \(\): void => \{[\s\S]{0,200}?this\.#renderMine\(\)[\s\S]{0,200}?this\.#renderCreations\(zone\)/)
  })

  it('mints the offer where the offers live — shared never builds one', () => {
    expect(STATIC_PEERS).toMatch(/const offer = offerFromCard\(card\)/)
    // Shared holds the shape by hand and never the mapping: no mint here, and
    // no reach into essentials to borrow one.
    expect(HOSTS_TS).not.toMatch(/offerFromCard/)
    expect(HOSTS_TS).not.toMatch(/lineageKey: [^;\n]*\.lineage/)
    expect(HOSTS_TS).not.toMatch(/from '@hypercomb\/essentials/)
    expect(HOSTS_TS).toMatch(/offer: unknown \| null/)
    // The panel sends back exactly what it was handed.
    expect(HOSTS_TS).toMatch(/EffectBus\.emit\('community:offer', row\.offer\)/)
  })

  it('offers a creation and withdraws it — and never adopts a branch', () => {
    expect(HOSTS_TS).toMatch(/EffectBus\.emit\('community:withdraw', \{ name: row\.name \}\)/)
    expect(HOSTS_HTML).not.toMatch(/adopt/i)
    expect(EN['hosts.creations.show-title']).toMatch(/shaded until you walk into it/i)
    expect(EN['hosts.mine.note']).toMatch(/taking one tile never takes its branch/i)
  })

  it('draws no switch on a plate it could not hold', () => {
    expect(HOSTS_HTML).toMatch(/@if \(row\.offer \|\| row\.offered\)/)
    expect(HOSTS_TS).toMatch(/if \(!row\.offer\) return/)
    expect(EN['hosts.creations.unheld']).toBeTruthy()
  })

  it('tells "publishes nothing" from "did not answer" for creations too', () => {
    expect(STATIC_PEERS).toMatch(/answered: cards !== null/)
    expect(HOSTS_HTML).toMatch(/creationsAnswered\(zone\) \? 'hosts\.creations\.none' : 'hosts\.creations\.silent'/)
    expect(EN['hosts.creations.silent']).toMatch(/down/i)
  })

  it('asks the domain’s OWN ledger, never a canonical directory standing in for it', () => {
    expect(STATIC_PEERS).toMatch(/fetchPublicationCards\(\{\}, `https:\/\/\$\{zone\}`\)/)
  })

  it('shows what your hive carries without being asked, from every domain at once', () => {
    // Emitted once the document is read, so a panel opened later replays it.
    expect(STATIC_PEERS).toMatch(/await this\.#migrateLegacyFollows\(\)[\s\S]{0,300}?this\.#renderMine\(\)/)
    expect(HOSTS_TS).toMatch(/'community:offers-render'/)
    expect(HOSTS_HTML).toMatch(/hosts\.mine\.open/)
    expect(EN['hosts.mine.open']).toMatch(/\{count\}/)
  })

  it('puts the creations above the builds — a build is the app, a creation is what somebody made', () => {
    expect(HOSTS_HTML.indexOf('hosts-creations')).toBeGreaterThan(0)
    expect(HOSTS_HTML.indexOf('hosts-creations')).toBeLessThan(HOSTS_HTML.indexOf('hosts-inspector'))
    expect(EN['hosts.builds']).toBe('Builds')
  })
})

// ── a switch is said before it happens, and there is a way back ─────────────
//
// Jaime, 2026-09-11: applying another domain's build restarted the app on
// their version, and "now you come back and your tiles are gone and
// everything's changed". Nothing was deleted and nothing said so. The window
// now names the act (Switch, not Apply), asks before switching to a build
// from any domain but your own, remembers the build you left, and reopens
// after the restart with one button that goes back.
describe('switching builds — named, confirmed, and reversible', () => {
  it('calls it a switch, and an update only on your own domain', () => {
    expect(HOSTS_TS).toMatch(/this\.isHome\(zone\) \? 'hosts\.offer\.update' : 'hosts\.offer\.switch'/)
    expect(EN['hosts.offer.switch']).toBe('Switch to this build')
    expect(EN['hosts.offer.apply']).toBe('Switch')
    expect(EN['hosts.offer.update']).toBe('Update')
  })

  it('asks before switching to another domain’s build, and never before going back', () => {
    const needs = HOSTS_TS.slice(HOSTS_TS.indexOf('#needsConfirm(pkg: HostPackage): boolean'))
    expect(needs).toMatch(/if \(this\.isHome\(pkg\.zone\)\) return false/)
    expect(needs).toMatch(/return pkg\.packageSig !== this\.switched\(\)\?\.from/)
    expect(HOSTS_TS).toMatch(/if \(this\.#needsConfirm\(pkg\)\) \{ this\.pending\.set\(pkg\); return \}/)
    expect(HOSTS_HTML).toMatch(/\(click\)="confirmSwitch\(\)"/)
    expect(HOSTS_HTML).toMatch(/\(click\)="cancelSwitch\(\)"/)
    // The confirm sheet sits OUTSIDE the scrolling body, so it is on screen
    // whichever row asked for it.
    expect(HOSTS_HTML.indexOf('class="hosts-confirm"')).toBeGreaterThan(HOSTS_HTML.lastIndexOf('class="hosts-note"'))
    expect(EN['hosts.confirm.safe']).toMatch(/Nothing is deleted/)
  })

  it('remembers the build a switch left, and offers it back after the restart', () => {
    expect(HOSTS_TS).toMatch(/const SWITCHED_KEY = 'hc:hosts:switched-from'/)
    // Recorded only once the switch has activated, before the restart.
    const sw = HOSTS_TS.slice(HOSTS_TS.indexOf('async #switch(pkg: HostPackage)'))
    expect(sw.indexOf('this.#remember(left, pkg)')).toBeGreaterThan(sw.indexOf('await acquire(sig, sources)'))
    expect(sw.indexOf('this.#remember(left, pkg)')).toBeLessThan(sw.indexOf('location.reload()'))
    expect(HOSTS_TS).toMatch(/sessionStorage\.getItem\(REOPEN_KEY\) === '1'[\s\S]{0,120}?EffectBus\.emit\('hosts:open'/)
    expect(HOSTS_HTML).toMatch(/\(click\)="switchBack\(\)"/)
    expect(EN['hosts.return.go']).toBe('Switch back')
  })

  it('explains the whole thing where you read it, and says tiles are never deleted', () => {
    expect(HOSTS_HTML).toMatch(/@if \(guideOpen\(\)\)/)
    expect(EN['hosts.guide.safe']).toMatch(/never deletes/)
    expect(EN['hosts.guide.builds']).toMatch(/restarts the app/)
    expect(EN['hosts.builds.foreign']).toMatch(/\{host\}/)
  })

  it('never offers Visit on your own domain — that is a second tab on your own hive', () => {
    expect(HOSTS_HTML).toMatch(/@if \(!isHome\(zone\)\) \{\s*<!--[\s\S]{0,400}?class="hosts-visit"/)
  })

  // A FRESHLY DEPLOYED DOMAIN COULD NOT UPDATE FROM ITSELF. hypercomb.io was
  // listed only if you had added it, so its own new build — the one that needs
  // no signature — was not on the list at all.
  it('lists your own domain whether or not you carry it, and drops only what you carry', () => {
    expect(HOSTS_TS).toMatch(/zones\.find\(z => this\.isHome\(z\)\) \?\? this\.home/)
    expect(HOSTS_HTML).toMatch(/@if \(isCarried\(zone\)\) \{[\s\S]{0,60}?class="hosts-drop"/)
    expect(HOSTS_HTML).toMatch(/@if \(!isHome\(zone\)\) \{\s*<p class="hosts-note hosts-authority">/)
  })

  // SIGNED BEFORE OFFERED. jwize.com's newest build reached the host before its
  // stamp did; the one button pointed at it, the gate refused it, and Retry
  // could never succeed.
  it('asks the followed publisher before offering another domain’s newest, and takes the build it signed', () => {
    expect(HOSTS_TS).toMatch(/ATTESTATION_IOC_KEY/)
    expect(HOSTS_TS).toMatch(/await this\.#ask\(zone\)\s*await this\.#checkSigned\(zone\)/)
    expect(HOSTS_TS).toMatch(/find\(p => p\.packageSig === refused\.named\)/)
    expect(HOSTS_TS).toMatch(/update\(zone: string\): void \{\s*const target = this\.targetOf\(zone\)/)
    expect(HOSTS_HTML).toMatch(/@if \(unsignedOf\(zone\); as refused\)/)
    expect(EN['hosts.offer.unsigned-signed']).toMatch(/\{sig\}/)
    expect(EN['hosts.offer.unsigned-none']).toMatch(/\{host\}/)
  })
})

// UPDATES HAPPEN IN ONE PLACE (2026-09-12). The header pill installed with one
// press; now it is a notice that opens the hosts window on the build it
// announces, and the hosts window saves a restore point before any switch.
describe('updating happens in the hosts window', () => {
  const root = join(here, '..', '..', '..')
  const INDICATOR = readFileSync(join(shared, 'ui', 'upgrade-indicator', 'upgrade-indicator.component.ts'), 'utf8')
  const APP = readFileSync(join(root, 'hypercomb-web', 'src', 'app', 'app.ts'), 'utf8')
  const UPGRADE = readFileSync(join(here, '..', 'commands', 'upgrade.queen.ts'), 'utf8')
  const ACQUIRE = readFileSync(join(root, 'hypercomb-runtime', 'src', 'acquire.ts'), 'utf8')

  it('the pill is a notice: it opens Hosts on its build and never installs', () => {
    expect(INDICATOR).not.toMatch(/hypercomb:apply-update/)
    expect(INDICATOR).toMatch(/EffectBus\.emit\('hosts:open', \{ packageSig:/)
    expect(APP).not.toMatch(/addEventListener\('hypercomb:apply-update'/)
    expect(UPGRADE).not.toMatch(/hypercomb:apply-update/)
    expect(UPGRADE).toMatch(/EffectBus\.emit\('hosts:open', \{ source: 'bundled' \}\)/)
  })

  it('opens on the build the notice named', () => {
    expect(HOSTS_TS).toMatch(/EffectBus\.on<[^>]*>\('hosts:open'/)
    expect(HOSTS_TS).toMatch(/async #focusBuild\(/)
  })

  it('saves a restore point before switching, and only once the build may run here', () => {
    const sw = HOSTS_TS.slice(HOSTS_TS.indexOf('async #switch(pkg: HostPackage)'))
    const gate = sw.indexOf('await activationAuthority(')
    const restore = sw.indexOf('createRestorePoint')
    expect(gate).toBeGreaterThan(-1)
    expect(restore).toBeGreaterThan(gate)
    expect(restore).toBeLessThan(sw.indexOf('await acquire(sig, sources)'))
  })

  it('an install from your own domain keeps the bundled update check listening', () => {
    expect(ACQUIRE).toMatch(/source: hostZone\(pkg\.zone\) === hostZone\(location\.host\) \? 'bundled' : 'sentinel'/)
  })
})
