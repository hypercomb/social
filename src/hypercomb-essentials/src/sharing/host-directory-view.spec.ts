// host-directory-view.spec.ts — the host directory: one window, one list of
// packages at every depth, on or shaded; a count of the hosts carrying the
// same signature; revisions as a drill-down that comes back to the list; an
// older revision that would replace newer parts asks first, and hides them
// when it is taken anyway. The list is pure (directoryRows), so its rules are
// tested as data; the rest are ratchets on the shape the doctrine requires.

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { InstallNode, InstallRevision } from '@hypercomb/core'
import { directoryRows, domainRows, isOlder, offAbove, replacedBeneath, rootsFor, type ServedTree } from './host-directory.view'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..', '..')
const VIEW = readFileSync(join(here, 'host-directory.view.ts'), 'utf8')
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

  it('is one element from essentials, docked as the hosts window the drone asks about — the Angular window is gone', () => {
    expect(VIEW).toMatch(/customElements\.define\(HOST_DIRECTORY_SURFACE, HostDirectoryElement\)/)
    expect(VIEW).toMatch(/registry\.add\(\{ name: HOST_DIRECTORY_SURFACE, owner: OWNER, element: HOST_DIRECTORY_SURFACE/)
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
    expect(ACQUIRE).toMatch(/if \(Object\.keys\(readPicks\(\)\)\.length\) \{\s*const selection = await applySelection\(pkg\.packageSig, held\.held\)/)
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
})
