// host-directory-view.spec.ts — the host directory: one window, one list of
// packages at every depth, on or shaded; a count of the hosts carrying the
// same signature; revisions as a drill-down that comes back to the list; an
// older revision that would replace newer parts asks first, and hides them
// when it is taken anyway. The list is pure (directoryRows), so its rules are
// tested as data; the rest are ratchets on the shape the doctrine requires.

import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { InstallNode, InstallRevision } from '@hypercomb/core'
import { directoryRows, domainRows, filesOf, hostBehind, isOlder, namedFromVerdict, namedWhenUninstalled, offerableRoots, offeredRevisions, updateProgress, offAbove, replacedBeneath, revisionDate, revisionGroups, rootsFor, type ServedTree } from './host-directory.view'
import { ATTESTED_PACKAGES_KEY, attestPackage } from './package-attestation'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..', '..')
const VIEW = readFileSync(join(here, 'host-directory.view.ts'), 'utf8')
// The hosts bee defines the element and adds its surface (atomic-modules-plan.md).
const HOSTS_BEE = readFileSync(join(here, 'hosts.drone.ts'), 'utf8')
const HOSTS_DRONE = readFileSync(join(here, 'hosts.drone.ts'), 'utf8')
const ACQUIRE = readFileSync(join(root, 'hypercomb-runtime', 'src', 'acquire.ts'), 'utf8')
const TREE = readFileSync(join(root, 'hypercomb-runtime', 'src', 'package-tree.ts'), 'utf8')
const INSTALL_TYPES = readFileSync(join(root, 'hypercomb-core', 'src', 'install.types.ts'), 'utf8')
const PRELOADER = readFileSync(join(root, 'hypercomb-runtime', 'src', 'script-preloader.ts'), 'utf8')
const BARREL = readFileSync(join(root, 'hypercomb-shared', 'ui', 'shell-surfaces', 'shell-surfaces.barrel.ts'), 'utf8')
const INDICATOR = readFileSync(join(root, 'hypercomb-shared', 'ui', 'upgrade-indicator', 'upgrade-indicator.component.ts'), 'utf8')
const UPGRADE = readFileSync(join(here, '..', 'commands', 'upgrade.queen.ts'), 'utf8')
const DEV_MAIN = readFileSync(join(root, 'hypercomb-dev', 'src', 'main.ts'), 'utf8')
const EN = JSON.parse(readFileSync(join(root, 'hypercomb-shared', 'i18n', 'en.json'), 'utf8')) as Record<string, string>

const node = (path: string, layerSig: string, children: string[] = [], description = ''): InstallNode =>
  ({ path, name: path.slice(path.lastIndexOf('/') + 1), layerSig, bees: [], children, description, base: layerSig })

const rows = (input: Partial<Parameters<typeof directoryRows>[0]>) => directoryRows({
  scope: '', at: '', query: '', running: [], picks: {}, eclipsed: [], next: null, carried: new Map(), off: new Set(), moved: null,
  ...input,
})

/** games { arkanoid { themes }, bubble } · notes, as it runs here. */
const running = [
  node('games', 'g1', ['games/arkanoid', 'games/bubble'], 'play'),
  node('games/arkanoid', 'a1', ['games/arkanoid/themes']),
  node('games/arkanoid/themes', 't1'),
  node('games/bubble', 'b1'),
  node('notes', 'n1'),
]

describe('the host directory', () => {

  it('lists this hive as the union of every host, with a count of the hosts carrying the SAME signature', () => {
    // Jaime 2026-09-13: "a full laundry list of packages available on those
    // domains… if you switch to jwize.com you see the subset and a number of
    // how many overlaps for this signature."
    const jwize: ServedTree = { root: 'r9', nodes: [node('games', 'g9'), node('wheel', 'w1')] }
    const plugin: ServedTree = { root: 'r7', nodes: [node('games', 'g1', ['games/arkanoid']), node('games/arkanoid', 'a1')] }
    const carried = new Map([['jwize.com', jwize], ['plugin.com', plugin]])

    const board = rows({ running, carried, off: new Set(['notes']) })
    expect(board.map(r => `${r.path}:${r.on}:${r.held}:${r.count}`)).toEqual(['games:true:true:1', 'notes:false:true:0', 'wheel:false:false:1'])

    const there = rows({ scope: 'jwize.com', running, carried })
    expect(there.map(r => `${r.path}:${r.layerSig}:${r.count}`)).toEqual(['games:g9:1', 'wheel:w1:1'])
  })

  it('walks into a branch: the list is its children, and a search reaches every depth beneath it', () => {
    expect(rows({ running }).map(r => r.path)).toEqual(['games', 'notes'])
    expect(rows({ running, at: 'games' }).map(r => `${r.path}:${r.children}`)).toEqual(['games/arkanoid:1', 'games/bubble:0'])
    expect(rows({ running, query: 'THEMES' }).map(r => r.path)).toEqual(['games/arkanoid/themes'])
    expect(rows({ running, query: 'PLAY' }).map(r => r.path)).toEqual(['games'])
    expect(rows({ running, at: 'notes', query: 'themes' })).toEqual([])
  })

  it('off is by path: a part inside a branch that is off is shaded, and names the branch that comes on first', () => {
    const inside = rows({ running, at: 'games', off: new Set(['games']) })
    expect(inside.every(r => !r.on && r.blockedBy === 'games')).toBe(true)
    expect(offAbove('games/arkanoid/themes', new Set(['games/arkanoid']))).toBe('games/arkanoid')
    expect(offAbove('games', new Set(['games']))).toBe('')
  })

  it('marks the way down to a change, and counts the newer parts a hiding revision hides', () => {
    const next: ServedTree = { root: 'r2', nodes: [node('games', 'g2', ['games/arkanoid']), node('games/arkanoid', 'a2'), node('notes', 'n1')] }
    expect(rows({ running, next }).filter(r => r.update).map(r => r.path)).toEqual(['games'])
    expect(rows({ running, next, at: 'games' }).filter(r => r.update).map(r => r.path)).toEqual(['games/arkanoid'])
    // A namespace-only move is what the port says it is.
    expect(rows({ running, next, moved: new Set(['notes']) }).filter(r => r.update).map(r => r.path)).toEqual(['notes'])
    // Looking into a host marks no update — updates are taken in this hive.
    expect(rows({ scope: 'x', running, next, carried: new Map([['x', next]]) }).some(r => r.update)).toBe(false)

    const picked = rows({ running, at: 'games', picks: { 'games/arkanoid': { hides: true } }, eclipsed: ['games/arkanoid/themes'] })
    expect(picked.find(r => r.path === 'games/arkanoid')).toMatchObject({ picked: true, hidden: 1 })
  })

  it('Update all counts only what changed — a file read back from what runs here is not the update', () => {
    // jwize 2026-10-01: "It should only show the tiles that are changed, not
    // the whole amount every time."
    const withBees = (n: InstallNode, ...bees: string[]): InstallNode => ({ ...n, bees })
    const now = [withBees(node('games', 'g1', ['games/arkanoid', 'games/bubble']), 'gb.js'), node('games/arkanoid', 'a1'), withBees(node('games/bubble', 'b1'), 'bb')]
    const next = [withBees(node('games', 'g2', ['games/arkanoid', 'games/bubble']), 'gb'), node('games/arkanoid', 'a2'), withBees(node('games/bubble', 'b1'), 'bb', 'nb')]
    const had = filesOf(now)
    expect([...had].sort()).toEqual(['a1', 'b1', 'bb', 'g1', 'gb'])

    expect(updateProgress('games', next, had, new Set())).toEqual({ done: 0, total: 3 })
    expect(updateProgress('games', next, had, new Set(['g2', 'a2']))).toEqual({ done: 2, total: 3 })
    expect(updateProgress('games/bubble', next, had, new Set(['nb']))).toEqual({ done: 1, total: 1 })
    expect(updateProgress('notes', next, had, new Set())).toEqual({ done: 0, total: 0 })

    // The window: held files are filtered against what ran, and the list is only what changes.
    expect(VIEW).toMatch(/if \(had\.has\(bare\)\) return/)
    expect(VIEW).toMatch(/const changing = moving \? rows\.filter\(row => row\.update\) : \[\]/)
    // One whole sentence over the changed files — never "931 files in".
    expect(updateProgress('', next, had, new Set(['nb']))).toEqual({ done: 1, total: 3 })
    expect(EN['hosts.updating']).toBe('Updating — {done} of {total} changed files')
  })

  it('an older revision is placed by the list, names the newer parts it replaces, and is taken from the trunk first', () => {
    const revisions: InstallRevision[] = [
      { layer: 'c', at: '2026-09-13', sources: [{ root: 'r3', zone: 'jwize.com', at: '' }] },
      { layer: 'b', at: '2026-09-12', sources: [{ root: 'r2', zone: 'jwize.com', at: '' }, { root: 'trunk', zone: '', at: '' }] },
      { layer: 'a', at: '2026-09-01', sources: [{ root: 'r1', zone: 'jwize.com', at: '' }] },
    ]
    expect(isOlder(revisions, 'a', 'b')).toBe(true)
    expect(isOlder(revisions, 'c', 'b')).toBe(false)
    expect(isOlder(revisions, 'a', 'unlisted')).toBe(false)
    expect(rootsFor(revisions[1]!, 'trunk')).toEqual(['trunk', 'r2'])
    expect(rootsFor(revisions[0]!, 'trunk')).toEqual(['r3'])

    const older = [node('games', 'g0', ['games/arkanoid', 'games/bubble']), node('games/arkanoid', 'a0'), node('games/bubble', 'b1')]
    expect(replacedBeneath('games', running, older)).toEqual(['games/arkanoid', 'games/arkanoid/themes'])
  })

  it('lists revisions by name, dates as sub-items, a returning name appending to its own heading', () => {
    // Jaime 2026-09-20: "dates show as subitems if the name hasn't changed —
    // name / dates… renamed / dates… another revision name / dates", then, of a
    // returning name: "clearly to be appended on the other same named revision".
    const at = (layer: string, when: string, name?: string): InstallRevision =>
      ({ layer, at: when, sources: [{ root: `r-${layer}`, zone: 'jwize.com', at: when, ...(name ? { name } : {}) }] })
    const list = [
      at('f', '2026-09-20T12:00:00.000Z', 'stable'),
      at('e', '2026-09-19T09:30:00.000Z', 'stable'),
      at('d', '2026-09-18T08:00:00.000Z', 'renamed'),
      at('c', '2026-09-17T08:00:00.000Z', 'stable'),   // returns after "renamed" — still under "stable"
      at('b', '2026-09-16T08:00:00.000Z', 'another'),
      at('a', '2026-09-15T08:00:00.000Z'),
    ]
    // One heading per name: a name that comes back APPENDS to its own heading.
    const groups = revisionGroups(list)
    expect(groups.map(group => `${group.name || '(none)'}:${group.entries.map(e => e.revision.layer).join('')}`))
      .toEqual(['stable:fec', 'renamed:d', 'another:b', '(none):a'])

    // Nothing named anywhere: one plain group, newest first.
    const plain = revisionGroups([at('x', '2026-09-01T00:00:00.000Z'), at('y', '2026-09-02T00:00:00.000Z')])
    expect(plain[0]!.entries.map(e => e.revision.layer).join('')).toBe('yx')
    expect(plain).toHaveLength(1)
    expect(plain[0]!.name).toBe('')

    // One revision published under two names is a line under each, at its own date.
    const both: InstallRevision = { layer: 'z', at: '2026-09-20T12:00:00.000Z', sources: [
      { root: 'r1', zone: 'jwize.com', at: '2026-09-20T12:00:00.000Z', name: 'beta' },
      { root: 'r2', zone: 'jwize.com', at: '2026-09-10T12:00:00.000Z', name: 'stable' },
    ] }
    expect(revisionGroups([both]).map(run => `${run.name}:${run.entries[0]!.at.slice(0, 10)}`)).toEqual(['beta:2026-09-20', 'stable:2026-09-10'])

    expect(revisionDate('2026-09-20T11:08:33.000Z')).toBe('2026-09-20 11:08')
    expect(revisionDate('2026-09-13')).toBe('2026-09-13')

    // The name travels from the pool member to the row.
    expect(ACQUIRE).toMatch(/row\.label !== row\.packageSig\.slice\(0, 12\)/)
    expect(ACQUIRE).toMatch(/sources: revision\.sources\.map\(\(\{ root, zone, at, name \}\)/)
    expect(INSTALL_TYPES).toMatch(/interface InstallRevisionSource \{[\s\S]*?name\?: string/)
    expect(VIEW).toMatch(/revisionGroups\(revisions, latest\)/)
    expect(EN['hosts.revisions.unnamed']).toBeTruthy()
  })

  it('is one element from essentials, docked as the hosts window the drone asks about — the Angular window is gone', () => {
    expect(HOSTS_BEE).toMatch(/customElements\.define\(HOST_DIRECTORY_SURFACE, HostDirectoryElement\)/)
    expect(HOSTS_BEE).toMatch(/registry\.add\(\{ name: HOST_DIRECTORY_SURFACE, owner: HOST_DIRECTORY_VIEW_KEY, element: HOST_DIRECTORY_SURFACE/)
    expect(VIEW).toMatch(/export const HOST_DIRECTORY_WINDOW = 'hosts-panel'/)
    expect(VIEW).toMatch(/id: HOST_DIRECTORY_WINDOW,[\s\S]{0,200}?launcherControlId: 'hosts'/)
    expect(HOSTS_DRONE).toMatch(/isWindowShowing\('hosts-panel'\)/)
    expect(VIEW).not.toMatch(/@hypercomb\/runtime/)
    expect(VIEW).toMatch(/ioc<InstallProvider>\(INSTALL_IOC_KEY\)/)
    expect(ACQUIRE).toMatch(/ioc\?\.register\?\.\(INSTALL_IOC_KEY, installProvider\)/)
    expect(BARREL).not.toMatch(/hosts-panel|packages/)
    expect(existsSync(join(root, 'hypercomb-shared', 'ui', 'hosts-panel', 'hosts-panel.component.ts'))).toBe(false)
    expect(existsSync(join(here, 'packages.view.ts'))).toBe(false)
  })

  it('opens and closes on the hosts drone\'s word; the notice and /upgrade land in it', () => {
    expect(VIEW).toMatch(/EffectBus\.on<[^>]*>\('hosts:render'/)
    expect(VIEW).toMatch(/EffectBus\.on<[^>]*>\('packages:open'[\s\S]{0,300}?EffectBus\.emit\('hosts:open', \{\}\)/)
    expect(VIEW).toMatch(/close: \(\) => EffectBus\.emit\('hosts:close', \{\}\)/)
    expect(INDICATOR).toMatch(/EffectBus\.emit\('packages:open'/)
    expect(UPGRADE).toMatch(/EffectBus\.emit\('packages:open', \{\}\)/)
    expect(VIEW).not.toMatch(/\byour domain\b(?!s)|isHome|hosts\.home/)
  })

  it('opens collapsed on a vertical list of domains, each saying whether an update waits there', () => {
    // Jaime 2026-09-13: "a vertical list of domains, not the list of items, and it
    // should always start collapsed. The domain would show if there's new updates
    // in the row, and then you click that domain and go to the features."
    const next: ServedTree = { root: 'r2', nodes: [node('games', 'g2')] }
    const served = new Map<string, ServedTree | null>([
      ['plugin.com', { root: 'r1', nodes: [node('games', 'g1')] }],
      ['jwize.com', next],
    ])
    const counts: Record<string, number> = { '': 36, 'plugin.com': 36, 'jwize.com': 36 }
    const input = { homeLabel: 'hypercomb.io', zones: ['plugin.com', 'jwize.com'], served, count: (zone: string) => counts[zone] ?? 0 }

    const waiting = domainRows({ ...input, trunk: 'r1', next })
    expect(waiting.map(r => `${r.label}:${r.update}`)).toEqual(['hypercomb.io:true', 'jwize.com:true', 'plugin.com:false'])

    // Nothing waiting: every domain is still listed, in its own order.
    const quiet = domainRows({ ...input, trunk: 'r2', next })
    expect(quiet.map(r => `${r.label}:${r.update}`)).toEqual(['hypercomb.io:false', 'plugin.com:false', 'jwize.com:false'])

    expect(VIEW).toMatch(/#view: View = 'domains'/)
    expect(VIEW).toMatch(/if \(!this\.#resume\) this\.#toDomains\(\)/)
    expect(VIEW).not.toMatch(/hd-domains|#renderDomains\(|hd-hostbar/)
  })

  it('is an accordion with one search: one domain section open at a time, a search finishing into lines', () => {
    // Jaime 2026-09-13: "only vertical lists of domains and of the installable
    // updatables… it is a drill down… accordion style with a search."
    const toggle = VIEW.slice(VIEW.indexOf('#toggleSection(zone: string): void {'))
    expect(toggle).toMatch(/if \(this\.#section === zone\) \{ this\.#section = null; this\.#scope = '' \}\s*else \{ this\.#section = zone; this\.#scope = zone \}/)
    expect(VIEW).toMatch(/header\.setAttribute\('aria-expanded', String\(open\)\)/)
    expect(VIEW).toMatch(/if \(this\.#query\.trim\(\)\) \{ this\.#renderMatches\(body, domains\); return \}/)
    // Escape clears the search first, then a drill, then the open section.
    const back = VIEW.slice(VIEW.indexOf('#back(): boolean {'))
    expect(back.indexOf("if (this.#query) { this.#query = ''")).toBeLessThan(back.indexOf('if (this.#section !== null)'))
    expect(EN['hosts.search']).toBeTruthy()
  })

  it('revisions are a drill-down that returns to the list, and a change reopens it where it was chosen', () => {
    expect(VIEW).toMatch(/type View = 'domains' \| 'list' \| 'revisions' \| 'creations' \| 'mine'/)
    expect(VIEW).toMatch(/#openRevisions\(row\.path\)/)
    expect(VIEW).toMatch(/revisionsOf\(path, this\.#sources\(\), roots\)/)
    const pick = VIEW.slice(VIEW.indexOf('async #pick('))
    expect(pick).toMatch(/this\.#toList\(this\.#scope, parentOf\(path\)\)\s*this\.#restart\(\)/)
    expect(VIEW).toMatch(/sessionStorage\.setItem\(REOPEN_KEY/)
    expect(VIEW).toMatch(/sessionStorage\.removeItem\(REOPEN_KEY\)/)
  })

  it('an older revision that would replace newer parts asks first; taken anyway, it hides them', () => {
    // Jaime 2026-09-13: "it says this will overwrite all those other things
    // that you know are newer… go configure these on an individual level… the
    // things will be hidden until you go to the latest version again."
    const choose = VIEW.slice(VIEW.indexOf('async #chooseRevision('), VIEW.indexOf('async #pick('))
    expect(choose).toMatch(/isOlder\(/)
    expect(choose).toMatch(/replacedBeneath\(path, selection\.nodes, nodes\)/)
    expect(choose).toMatch(/this\.#warning = \{ revision, replaced, picksBeneath \}/)
    expect(VIEW).toMatch(/void this\.#pick\(path, warning\.revision, true\)/)
    expect(VIEW).toMatch(/this\.#toList\(this\.#scope, path\)/)
    expect(TREE).toMatch(/const eclipsed = new Set\(Object\.keys\(picks\)\.filter\(path => hiding\.some/)
    expect(EN['hosts.downgrade.anyway']).toBeTruthy()
    expect(EN['hosts.downgrade.note']).toMatch(/hidden, not deleted/)
  })

  it('a pick is gated and composed like an install, and refused by name when it reaches sideways', () => {
    const pick = ACQUIRE.slice(ACQUIRE.indexOf('export const pickRevision'), ACQUIRE.indexOf('export const unpickRevision'))
    expect(pick.indexOf('layerAt(candidate, path, io)')).toBeGreaterThan(-1)
    expect(pick.indexOf('layerAt(candidate, path, io)')).toBeLessThan(pick.indexOf('await activationAuthority('))
    expect(pick.indexOf('await activationAuthority(')).toBeLessThan(pick.indexOf('deriveInventory(revision.layer'))
    const apply = ACQUIRE.slice(ACQUIRE.indexOf('export const applySelection'), ACQUIRE.indexOf('const trustedHere'))
    expect(apply).toMatch(/missingNamespaces\(/)
    expect(apply.indexOf('writePicks(live)')).toBeGreaterThan(apply.indexOf('checkCoreCompatibility('))
    expect(apply.indexOf('writePicks(live)')).toBeLessThan(apply.indexOf('await activate('))
    // 076c59e8f (2026-09-23): Update all may release picks first, and the
    // brood is held before the selection is composed.
    expect(ACQUIRE).toMatch(/let picks = readPicks\(\)/)
    expect(ACQUIRE).toMatch(/if \(Object\.keys\(picks\)\.length\) \{[\s\S]{0,800}?const selection = await applySelection\(pkg\.packageSig, held\.held, picks\)/)
    expect(INSTALL_TYPES).toMatch(/pick\(\s*path: string,[\s\S]{0,240}?revision: \{ layer: string; root: string; roots\?: readonly string\[\] \}/)
  })

  it('a package that is off does not load: the preloader keeps the activation record\'s bees, not every bee the layers declare', () => {
    const run = PRELOADER.slice(PRELOADER.indexOf('const layerRoots = ScriptPreloader.readManifestLayers()'))
    expect(run).toMatch(/const enabled = ScriptPreloader\.readManifestBees\(\)/)
    expect(run).toMatch(/const keep = new Set\(\[\.\.\.enabled, \.\.\.walked\.criticalBees\]\)/)
    expect(run.indexOf('walked.bees.filter(sig => keep.has(sig))')).toBeLessThan(run.indexOf('#loadBeesPrioritized(walked.bees'))
  })

  it('the dev shell carries the install port, and nothing acts where no package is installed', () => {
    expect(DEV_MAIN).toMatch(/import '@hypercomb\/runtime\/acquire'/)
    expect(VIEW).toMatch(/const acts = !!reach && !!trunk/)
    expect(EN['hosts.from-source']).toBeTruthy()
    // An older shell's port lists and toggles top-level packages, nothing more.
    expect(VIEW).toMatch(/recursive: typeof install\.selection === 'function' && typeof install\.pick === 'function'/)
  })

  it('the origin is the shell, never a host: the web shell takes packages only from the hosts it carries', () => {
    const APP = readFileSync(join(root, 'hypercomb-web', 'src', 'app', 'app.ts'), 'utf8')
    const MAIN = readFileSync(join(root, 'hypercomb-web', 'src', 'main.ts'), 'utf8')
    const INSTALL = readFileSync(join(root, 'hypercomb-web', 'src', 'setup', 'ensure-install.ts'), 'utf8')
    expect(INSTALL).not.toMatch(/export const checkForUpdate/)
    expect(INSTALL).toMatch(/export const installFromHosts = async/)
    expect(APP).not.toMatch(/checkForUpdate|upgradeHypercomb|upgradeFromBundled|searchParams\.has\('upgrade'\)/)
    const start = MAIN.slice(MAIN.indexOf("window.addEventListener('hypercomb:start-install'"))
    expect(start.indexOf('await installFromHosts()')).toBeGreaterThan(-1)
    expect(start.indexOf('if (!nativeAvailable()) {')).toBeLessThan(start.indexOf('await upgradeFromBundled()'))
    expect(INDICATOR).toMatch(/if \(payload\?\.source !== 'channel'\) return/)
    expect(INDICATOR).not.toMatch(/'bundled'/)
    expect(UPGRADE).toMatch(/window\.ioc\.get\(INSTALL_IOC_KEY\)/)
    expect(UPGRADE).not.toMatch(/upgradeHypercomb/)
  })

  // ── the honest update window (jwize 2026-10-11) ─────────────────────────────
  // A host can serve an older build than the one the followed publisher names
  // — hypercomb.com did, for hours, after each publish — and offering its tree
  // sent the participant into the gate's refusal ("not signed by a publisher
  // you follow — visit hypercomb.com to try it on its own domain"). The window
  // offers only what that publisher names, what runs here, and what it named
  // before; a host holding anything else is told plainly that it is behind.

  const FOLLOWED = 'f'.repeat(64)
  const offer = (named: string, extra: Partial<Parameters<typeof offerableRoots>[0]> = {}) =>
    offerableRoots({ named, trunk: 'trunk', picks: [], witnessed: {}, followed: FOLLOWED, ...extra })

  it('offers the named root, what runs here, and what the followed publisher named before — nothing else', () => {
    const offerable = offer('signed', { picks: ['picked'], witnessed: { older: FOLLOWED, stranger: 'e'.repeat(64) } })
    expect(['signed', 'trunk', 'picked', 'older'].every(offerable)).toBe(true)
    expect(offerable('stale')).toBe(false)
    expect(offerable('stranger')).toBe(false)   // witnessed under another key is no witness
    expect(offerable('')).toBe(false)
    expect(offer('signed', { followed: null, witnessed: { older: FOLLOWED } })('older')).toBe(false)
  })

  it('a stale host tree never joins this hive\'s list — it stays under its own name, which says it is behind', () => {
    const next: ServedTree = { root: 'signed', nodes: [node('games', 'g2')] }
    const stale: ServedTree = { root: 'stale', nodes: [node('games', 'g0'), node('wheel', 'w0')] }
    const carried = new Map<string, ServedTree | null>([['hypercomb.com', stale], ['jwize.com', next]])
    const offerable = offer('signed')

    const board = rows({ running, next, carried, offerable })
    expect(board.map(r => r.path)).toEqual(['games', 'notes'])
    expect(board.find(r => r.path === 'games')?.layerSig).toBe('g1')
    // Without the rule it was the union of every host's head — the stale wheel included.
    expect(rows({ running, next, carried }).map(r => r.path)).toContain('wheel')
    // The host's own list is still what it carries.
    expect(rows({ scope: 'hypercomb.com', running, carried, offerable }).map(r => r.path)).toEqual(['games', 'wheel'])

    const domains = domainRows({ homeLabel: 'hypercomb.io', zones: ['hypercomb.com', 'jwize.com'], trunk: 'trunk', next,
      served: carried, count: () => 1, named: 'signed' })
    expect(domains.map(d => `${d.label}:${d.update}:${d.behind}`)).toEqual(['hypercomb.io:true:false', 'jwize.com:true:false', 'hypercomb.com:false:true'])
    // Before the named build is known, nobody is called behind.
    expect(domainRows({ homeLabel: 'h', zones: ['hypercomb.com'], trunk: 'trunk', next: null, served: carried, count: () => 0 })
      .some(d => d.behind)).toBe(false)
    expect(hostBehind('stale', 'signed')).toBe(true)
    expect(hostBehind('signed', 'signed')).toBe(false)
    expect(hostBehind('', 'signed')).toBe(false)
  })

  it('revisions are only what may be taken, the named root first and marked latest — never a stale host\'s newer date', () => {
    const found: InstallRevision[] = [
      // The stale host's package, listed with a date — it used to sort first.
      { layer: 'stale-layer', at: '2026-10-11T20:00:00.000Z', sources: [{ root: 'stale', zone: 'hypercomb.com', at: '2026-10-11T20:00:00.000Z', name: 'essentials' }] },
      { layer: 'older-layer', at: '2026-10-01T09:00:00.000Z', sources: [{ root: 'older', zone: 'jwize.com', at: '2026-10-01T09:00:00.000Z', name: 'essentials' }] },
      // The signed root, named on no host yet: no date at all.
      { layer: 'signed-layer', at: '', sources: [{ root: 'signed', zone: '', at: '' }] },
    ]
    const offered = offeredRevisions(found, offer('signed', { witnessed: { older: FOLLOWED } }), 'signed', 'essentials')
    expect(offered.map(r => r.layer)).toEqual(['signed-layer', 'older-layer'])
    expect(offered[0]!.sources[0]!.name).toBe('essentials')
    const groups = revisionGroups(offered, 'signed-layer')
    expect(groups.map(g => `${g.name}:${g.entries.map(e => e.revision.layer).join(',')}`)).toEqual(['essentials:signed-layer,older-layer'])
    // Without a lead, dates decide, as before.
    expect(revisionGroups(offered)[0]!.entries[0]!.revision.layer).toBe('older-layer')
    // A lead nothing names still leads.
    expect(revisionGroups([found[1]!, { layer: 'x', at: '', sources: [{ root: 'x', zone: '', at: '' }] }], 'x')[0]!.entries[0]!.revision.layer).toBe('x')
    // The window cuts its list this way, and marks "latest" on the first line.
    expect(VIEW).toMatch(/this\.#revisions = offeredRevisions\(found, this\.#offerable, this\.#named,/)
    expect(VIEW).toMatch(/if \(groupIndex === 0 && index === 0\) choose\.append\(make\('span', 'hd-mark quiet', t\('hosts\.revisions\.latest'/)
  })

  it('takes nothing from a host it may not offer, and says the host is behind instead of leading into the gate', () => {
    const carrying = VIEW.slice(VIEW.indexOf('#carrying(path: string): ServedTree | null {'))
    expect(carrying.slice(0, 400)).toMatch(/this\.#offerable\(tree\.root\)/)
    const list = VIEW.slice(VIEW.indexOf('#packageList(rows: readonly DirectoryRow[]): HTMLElement {'))
    expect(list).toMatch(/const untakeable = !row\.held && !this\.#carrying\(row\.path\)/)
    expect(list).toMatch(/\|\| untakeable\n/)
    const toggle = VIEW.slice(VIEW.indexOf('async #toggle(row: DirectoryRow)'), VIEW.indexOf('async #takeUpdate('))
    expect(toggle).toMatch(/this\.#isBehind\(this\.#scope\) \? this\.#behindText\(this\.#scope\)/)
    expect(toggle).toMatch(/this\.#offerable\(other\.root\)/)
  })

  it('an update no host can serve yet is said plainly, with the hosts behind — and no Update all button', () => {
    const section = VIEW.slice(VIEW.indexOf('#sectionBody(zone: string): HTMLElement {'), VIEW.indexOf('#renderBranch(body: HTMLElement): void {'))
    const notHeld = section.slice(section.indexOf('} else if (!zone && (trunk || runsSource()) && this.#named && this.#named !== trunk && !this.#reading) {'), section.indexOf('if (reach && !trunk) {'))
    expect(notHeld).toMatch(/t\('packages\.updates\.not-held'/)
    expect(notHeld).toMatch(/this\.#isBehind\(host\)/)
    expect(notHeld).not.toMatch(/button\(|hosts\.update-all|#updateAll/)
    // The named root is kept apart from the tree a host could serve.
    expect(VIEW).toMatch(/this\.#named = named\n\s*this\.#offerable = this\.#offerFor\(named\)/)
    expect(EN['packages.updates.not-held']).toBe('An update is ready, but none of your hosts has it yet')
    expect(EN['hosts.behind']).toBe("{host} hasn't got the newest version yet")
  })

  it('a witness is not what the publisher names now — a newer, unwitnessed root is never hidden or called behind', async () => {
    // The tab runs P (witnessed long ago); the publisher has since stamped R,
    // which nobody here has witnessed; hypercomb.com already serves R.
    const [P, R] = ['a'.repeat(64), 'b'.repeat(64)]
    const store = new Map<string, string>([[ATTESTED_PACKAGES_KEY, JSON.stringify({ [P]: FOLLOWED })]])
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } }
    const publisher = { pubkey: FOLLOWED, hosts: ['jwize.com'], channel: 'essentials' }
    const indexNaming = (root: string) => async () => ({ ok: true, manifest: { roots: { 'install:essentials': root } } }) as never

    // The witness alone answers 'held' — which says P was named ONCE.
    const held = await attestPackage(P, [], { storage, publisher, fetchIndex: indexNaming(R) })
    expect(held).toMatchObject({ ok: true, witnessed: 'held' })
    expect(namedFromVerdict(held, P)).toBe('')
    // Unknown cuts nothing and calls nobody behind.
    const served = new Map<string, ServedTree | null>([['hypercomb.com', { root: R, nodes: [node('games', 'g2')] }]])
    expect(offer('')(R)).toBe(true)
    expect(rows({ running, carried: served, offerable: offer('') }).map(r => r.path)).toContain('games')
    expect(domainRows({ homeLabel: 'h', zones: ['hypercomb.com'], trunk: P, next: null, served, count: () => 1, named: '' })
      .some(d => d.behind)).toBe(false)

    // The window reads FRESH, and learns R — R is offered and its host is current.
    const fresh = await attestPackage(P, [], { storage, publisher, fetchIndex: indexNaming(R), fresh: true })
    const named = namedFromVerdict(fresh, P)
    expect(named).toBe(R)
    expect(offer(named, { trunk: P })(R)).toBe(true)
    expect(hostBehind(R, named)).toBe(false)
    // A fresh read naming P itself: P is current, and a host on R is not behind it falsely — R is newer only if named.
    expect(namedFromVerdict(await attestPackage(P, [], { storage, publisher, fetchIndex: indexNaming(P), fresh: true }), P)).toBe(P)
    expect(VIEW).toMatch(/attestPackage\(installedSig, this\.#zones, \{ fresh: true \}\)/)
  })

  it('a shell with nothing installed takes the root the publisher names now', () => {
    const [oldRoot, named] = ['c'.repeat(64), 'd'.repeat(64)]
    const publisher = 'e'.repeat(64)
    expect(namedWhenUninstalled(oldRoot, { ok: false, reason: 'not-named', named })).toBe(named)
    expect(namedWhenUninstalled(named, { ok: true, pubkey: publisher, witnessed: 'current' })).toBe(named)
    // A witness, or a read that cannot say, leaves the announcement. It is not a guess.
    expect(namedWhenUninstalled(oldRoot, { ok: true, pubkey: publisher, witnessed: 'held' })).toBe(oldRoot)
    expect(namedWhenUninstalled(oldRoot, null)).toBe(oldRoot)
    expect(VIEW).toMatch(/attestPackage\(announced, this\.#zones, \{ fresh: true \}\)/)
    expect(VIEW).toMatch(/namedWhenUninstalled\(announced, verdict\)/)
    const updateAll = VIEW.slice(VIEW.indexOf('async #updateAll()'), VIEW.indexOf('async #runningFiles('))
    expect(updateAll).toMatch(/const named = await this\.#namedRoot\(trunk\)/)
    expect(updateAll.indexOf('this.#namedRoot(trunk)')).toBeLessThan(updateAll.indexOf('install.acquire('))
  })

  it('both sentences speak every language the window does', () => {
    const catalogs = readdirSync(join(root, 'hypercomb-shared', 'i18n')).filter(file => file.endsWith('.json'))
    expect(catalogs.length).toBeGreaterThanOrEqual(14)
    for (const file of catalogs) {
      const json = JSON.parse(readFileSync(join(root, 'hypercomb-shared', 'i18n', file), 'utf8')) as Record<string, string>
      expect(json['hosts.behind']?.match(/\{\w+\}/g), `${file} hosts.behind`).toEqual(['{host}'])
      expect(json['packages.updates.not-held']?.trim(), `${file} packages.updates.not-held`).toBeTruthy()
      expect(json['packages.updates.not-held']).not.toMatch(/\{\w+\}/)
    }
  })
})
