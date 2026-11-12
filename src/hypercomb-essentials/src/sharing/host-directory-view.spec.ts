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
import { LIGHT_BRIGHTEST, LIGHT_DIMMEST, LIGHT_UNKNOWN, ageLevel, lightOf, runningStamp, NOTHING_PICKED, codeLines, codeName, filesPicked, pickAll, pickKey, pickMode, publishedCount, publishedOn, stackRows, stillPicked, directoryRows, domainRows, filesOf, hostBehind, isOlder, namedFromVerdict, namedWhenUninstalled, offerableRoots, offeredRevisions, updateProgress, updatingSentence, offAbove, replacedBeneath, revisionDate, revisionGroups, rootsFor, sourcePackagePaths, type ServedTree } from './host-directory.view'
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

  it('a shell that runs its working tree reads its compiled-in packages as on and from source, never "not here yet"', () => {
    // jwize, 2026-11-11, on the dev shell: "everything in host for hypercomb.com
    // says not here yet" — while comfy and the rest ran from source.
    const builtIn = sourcePackagePaths([
      'hypercomb-essentials/src/comfy/comfy.drone.ts',
      'hypercomb-essentials/src/games/arkanoid/arkanoid.drone.ts',
      'hypercomb-essentials/src/side-effects.ts',
      'hypercomb-shared/ui/x.ts',
    ])
    expect([...builtIn].sort()).toEqual(['comfy', 'games', 'games/arkanoid'])

    const next: ServedTree = { root: 'r1', nodes: [node('comfy', 'c1'), node('games', 'g1', ['games/arkanoid']), node('wheel', 'w1')] }
    const board = rows({ next, builtIn, off: new Set(['comfy']) })
    const comfy = board.find(row => row.path === 'comfy')!
    // On whatever the record says (an off written elsewhere does not unload source),
    // and no update to take: no revision reaches a working tree.
    expect([comfy.on, comfy.fromSource, comfy.update, comfy.blockedBy]).toEqual([true, true, false, ''])
    // A package the source does not carry is still honestly not here.
    const wheel = board.find(row => row.path === 'wheel')!
    expect([wheel.on, wheel.fromSource, wheel.held]).toEqual([false, false, false])
    // A hive passes no built-in set, and nothing changes.
    expect(rows({ next }).every(row => !row.fromSource && !row.on)).toBe(true)
    // The row says it, and the switch keeps its reason.
    expect(VIEW).toMatch(/row\.fromSource[\s\S]{0,200}packages\.from-source/)
    expect(EN['packages.from-source']).toBe('from source')
  })

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

  it('once the files are in, the bar says what is being done and that a restart is coming', () => {
    // jwize 2026-11-12: "It is very confusing during an update if something is
    // happening or not after all files are downloaded."
    expect(updatingSentence('', { done: 1, total: 3 })).toBe('Updating — 1 of 3 changed files')
    expect(updatingSentence('', { done: 0, total: 0 })).toBe('Updating…')
    // A shell from before the phases: a full counter still says it is finishing.
    expect(updatingSentence('', { done: 3, total: 3 })).toBe(EN['hosts.updating-finishing'])
    expect(updatingSentence('checking', { done: 3, total: 3 })).toBe(EN['hosts.updating-checking'])
    expect(updatingSentence('applying', { done: 3, total: 3 })).toBe(EN['hosts.updating-applying'])
    expect(updatingSentence('restarting', null)).toBe(EN['hosts.updating-restarting'])
    for (const key of ['finishing', 'checking', 'applying', 'restarting']) expect(EN[`hosts.updating-${key}`]).toMatch(/restart|checking/)
    // The window hears the runtime's phases and says restarting before the reload.
    expect(VIEW).toMatch(/onPhase: phase => \{ this\.#phase = phase; this\.#renderBody\(\) \}/)
    expect(VIEW).toMatch(/if \(updating\) \{ this\.#phase = 'restarting'; this\.#renderBody\(\) \}/)
    // The bar stays for the whole update — a re-read after activation records
    // the new root as running and used to take it away — and the restart is
    // announced, given time to be read, and said again on the other side.
    expect(VIEW).toMatch(/this\.#next && \(this\.#held \|\| this\.#next\.root !== trunk\)/)
    expect(VIEW).toMatch(/\} else if \(!this\.#held\) \{ this\.#next = null; this\.#moved = null \}/)
    expect(VIEW).toMatch(/setTimeout\(\(\) => location\.reload\(\), updating \? 1500 : 400\)/)
    expect(VIEW).toMatch(/if \(where\.updated === true\) \{\s+this\.#justUpdated = true/)
    expect(EN['hosts.updated']).toBe('Update finished — you are running the new version')
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

  it('opens on a list of every host, each saying whether an update waits there', () => {
    // Jaime 2026-09-13: "a vertical list of domains, not the list of items, and it
    // should always start collapsed. The domain would show if there's new updates
    // in the row, and then you click that domain and go to the features." It
    // still starts at the top, on this origin; the list of hosts is now a rail
    // beside the pane instead of a shut accordion over it.
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

  it('is a rail of hosts with one pane open, and one search finishing into lines', () => {
    // Jaime 2026-09-13: "only vertical lists of domains and of the installable
    // updatables… it is a drill down… accordion style with a search." The
    // accordion became a rail when the window went full screen (2026-11-04):
    // the list of hosts stays down the left, the chosen host's pane opens in
    // the middle, and the search still finishes into lines.
    // The rail is the first column of a column browser (the Finder's): a click picks a
    // host, ctrl/cmd stacks another, and the first of the stack is the one whose acts show.
    const pick = VIEW.slice(VIEW.indexOf('#pickHost(zone: string, mode: PickMode, order: readonly string[]): void {'))
    expect(pick).toMatch(/let stack = pickKey\(this\.#stack, zone, mode, order\)/)
    expect(pick).toMatch(/if \(!stack\.keys\.length\) stack = \{ keys: \[zone\], anchor: zone \}/)
    expect(pick).toMatch(/this\.#section = stack\.keys\[0\] \?\? ''\s*this\.#scope = this\.#section/)
    // The Finder's way (Ctrl/Cmd toggles, Shift extends), and a plain click toggles while Select is on.
    expect(VIEW).toMatch(/header\.addEventListener\('click', event => this\.#pickHost\(domain\.zone, this\.#modeOf\(event\), order\)\)/)
    expect(VIEW).toMatch(/header\.setAttribute\('aria-current', 'true'\)/)
    expect(VIEW).toMatch(/if \(this\.#query\.trim\(\)\) \{ this\.#renderMatches\(body, domains\); return \}/)
    // A desk opens onto a host: there is always one pane, never a shut list.
    expect(VIEW).toMatch(/#section = ''/)
    expect(VIEW).not.toMatch(/#toggleSection|#renderAccordion|#section !== null/)
    // Escape clears the search first, then the pane over the columns, then the code being
    // read, then the deepest pick; with nothing picked it has nothing and the desk closes.
    const back = VIEW.slice(VIEW.indexOf('#back(): boolean {'), VIEW.indexOf('// ── what is on screen'))
    const rungs = ['if (this.#menu !== null)', "if (this.#query) { this.#query = ''", "if (this.#view !== 'domains')", 'if (this.#files.keys.length)', 'const deepest = this.#cols.map']
    expect(rungs.map(rung => back.indexOf(rung))).toEqual([...rungs.map(rung => back.indexOf(rung))].sort((a, b) => a - b))
    expect(rungs.every(rung => back.includes(rung))).toBe(true)
    expect(back).not.toMatch(/this\.#section/)
    expect(EN['hosts.search']).toBeTruthy()
  })

  it('is a full-screen desk beside Publish, not inside it: the desks\' doors, one link out, and no publish act of its own', () => {
    // jwize 2026-11-04: "the host window needs to be full screen". Hosts are what
    // comes in and Publish is what goes out, so they stay two windows and meet in
    // one button — and this window holds no act of Publish's.
    expect(VIEW).toMatch(/panel\.dataset\['hcSheet'\] = 'full'/)
    expect(VIEW).toMatch(/dockExclusive: false,\s*ownsSize: false/)
    expect(VIEW).toMatch(/modes\.enter\('view:keeps-controls', HOST_DIRECTORY_WINDOW\)/)
    expect(VIEW).toMatch(/modes\.enter\('view:active', HOST_DIRECTORY_WINDOW\)/)
    expect(VIEW).toMatch(/\.lock\(HOST_DIRECTORY_WINDOW\)/)
    expect(VIEW).toMatch(/\.unlock\(HOST_DIRECTORY_WINDOW\)/)
    expect(VIEW).toMatch(/EffectBus\.emit\('keymap:unsuppress', \{ reason: HOST_DIRECTORY_WINDOW \}\)/)
    // The desk takes the page, so Publish is reached by closing it first.
    const open = VIEW.slice(VIEW.indexOf('#openPublish(): void {'))
    expect(open.indexOf("EffectBus.emit('hosts:close', {})")).toBeLessThan(open.indexOf("EffectBus.emit('publish:view-toggle', {})"))
    expect(VIEW).toMatch(/isWindowShowing\('publish-panel'\)/)
    expect(VIEW).not.toMatch(/publish:door|publish:run|publish-groups/)
    // Only a host has the door: this origin is no destination.
    expect(VIEW).toMatch(/if \(domain\.zone\) \{[\s\S]{0,700}?const publish = button\('hd-link hd-publish'/)
  })

  it('revisions open in a drawer beside the list and the list stays where it was', () => {
    // The old drill replaced the list, and a breadcrumb walked back to it.
    expect(VIEW).toMatch(/const under: View = drawer \? 'domains' : this\.#view/)
    expect(VIEW).toMatch(/if \(open\) this\.#renderRevisions\(drawer\)/)
    expect(VIEW).toMatch(/frame\.classList\.toggle\('with-drawer', open\)/)
    expect(VIEW).toMatch(/\.hd-frame\.with-drawer\{grid-template-columns:/)
  })

  it('a press on the glyph shows a parked desk — the drone\'s flag already says open, so only the view can answer', () => {
    // An Escape sweep parks every window (DOM gone, the drone never told), so the
    // glyph's press made the drone emit the same `open` the view already held: a
    // no-op, and the desk could only come back by a second sweep-restore.
    const connected = VIEW.slice(VIEW.indexOf('connectedCallback(): void {'), VIEW.indexOf('disconnectedCallback(): void {'))
    expect(connected).toMatch(/EffectBus\.on\('hosts:view-toggle', \(\) => \{\s*if \(live && this\.#wanted && !this\.#panel\) \{ this\.#mount\(\)/)
    // A replayed press is not a press: nothing answers until the listener is in.
    const on = connected.indexOf("EffectBus.on('hosts:view-toggle'")
    expect(connected.indexOf('let live = false')).toBeLessThan(on)
    expect(connected.indexOf('live = true', on)).toBeGreaterThan(on)
  })

  it('counts what a host signed index opens there — the rule the Publish panel uses, minus the pointers', () => {
    const head = (n: number): string => String(n).repeat(64).slice(0, 64)
    const manifest = {
      roots: { a: head(1), b: head(2), c: head(3), 'plan:a': head(4), 'install:essentials': head(5), d: 'not-a-signature' },
      doors: { b: ['other.com'], c: ['host.com', 'other.com'] },
    }
    // a lists no doors, so it opens everywhere; b opens only on other.com; c lists this host.
    // Pointers (plan:…, install:…) and a value that is no signature are never branches.
    expect(publishedOn(manifest, 'host.com')).toBe(2)
    expect(publishedOn(manifest, 'other.com')).toBe(3)
    expect(publishedOn({ roots: {} }, 'host.com')).toBe(0)
    // An entry that lists doors and not this one opens nowhere here — even an empty list.
    expect(publishedOn({ roots: { a: head(1) }, doors: { a: [] } }, 'host.com')).toBe(0)
  })

  it('tells the count of a host only when it can, and never reads an unreachable host as an empty one', async () => {
    const key = 'a'.repeat(64)
    const manifest = { roots: { a: '1'.repeat(64), b: '2'.repeat(64) }, createdAt: 1, pubkey: key }
    const index = (result: unknown) => ({ key: async () => key, index: async () => result as never })
    expect(await publishedCount('host.com', index({ ok: true, manifest }))).toBe(2)
    // No index of yours there is a plain none published; every other failure is unknown, not zero.
    expect(await publishedCount('host.com', index({ ok: false, reason: 'http', status: 404 }))).toBe(0)
    expect(await publishedCount('host.com', index({ ok: false, reason: 'http', status: 502 }))).toBeNull()
    expect(await publishedCount('host.com', index({ ok: false, reason: 'unreachable' }))).toBeNull()
    expect(await publishedCount('host.com', index({ ok: false, reason: 'forged' }))).toBeNull()
    expect(await publishedCount('host.com', { key: async () => key, index: async () => { throw new Error('boom') } })).toBeNull()
    // A device with no key cannot be asked about one, and the host is never troubled.
    let asked = 0
    const keyless = { key: async () => '', index: async () => { asked++; return { ok: true, manifest } as never } }
    expect(await publishedCount('host.com', keyless)).toBeNull()
    expect(asked).toBe(0)
  })

  it('reads the count from the own index of the host — never the Publish sweep, never minting a key, painted in place', () => {
    expect(VIEW).toMatch(/publisherKeyHex\(\{ known: true \}\)/)
    expect(VIEW).not.toMatch(/publish-status|publish:refresh|publish:render|publish:peek/)
    // Asked once per host and kept until the desk closes. An answer that outlives its opening is
    // dropped — a read still in flight from before a close once overwrote the fresh one.
    expect(VIEW).toMatch(/if \(this\.#published\.has\(zone\) \|\| this\.#publishedAsk\.has\(zone\)\) return/)
    expect(VIEW).toMatch(/if \(opening !== this\.#opening\) return\s*this\.#publishedAsk\.delete\(zone\)\s*this\.#published\.set\(zone, count\)/)
    expect(VIEW).toMatch(/this\.#opening\+\+[\s\S]{0,1100}?this\.#published\.clear\(\)/)
    // The number sits beside the one door, on the pane of a host and never on this origin.
    expect(VIEW).toMatch(/if \(domain\.zone\) \{\s*const published = make\('span', 'hd-published'\)/)
    // A host that did not answer shows no number, not a zero.
    expect(VIEW).toMatch(/span\.hidden = count === undefined \|\| count === null/)
  })

  it('picks as the Finder picks: a click takes one, ctrl/cmd adds or removes, shift extends from the anchor', () => {
    const order = ['a', 'b', 'c', 'd', 'e']
    let picked = pickKey(NOTHING_PICKED, 'b', 'only', order)
    expect(picked).toEqual({ keys: ['b'], anchor: 'b' })
    picked = pickKey(picked, 'd', 'toggle', order)
    expect(picked).toEqual({ keys: ['b', 'd'], anchor: 'd' })
    picked = pickKey(picked, 'b', 'toggle', order)
    expect(picked).toEqual({ keys: ['d'], anchor: 'b' })
    // A run is from the anchor, and it stays the anchor as the run grows or shrinks — in either direction.
    picked = pickKey(pickKey(NOTHING_PICKED, 'b', 'only', order), 'd', 'range', order)
    expect(picked).toEqual({ keys: ['b', 'c', 'd'], anchor: 'b' })
    expect(pickKey(picked, 'a', 'range', order)).toEqual({ keys: ['a', 'b'], anchor: 'b' })
    expect(pickKey(picked, 'c', 'range', order).keys).toEqual(['b', 'c'])
    // With no anchor a shift-click is just a click; a key the column does not have takes one only.
    expect(pickKey(NOTHING_PICKED, 'c', 'range', order)).toEqual({ keys: ['c'], anchor: 'c' })
    expect(pickKey(picked, 'zzz', 'range', order)).toEqual({ keys: ['zzz'], anchor: 'zzz' })
    // Select all keeps the anchor if it is still there.
    expect(pickAll({ keys: ['b'], anchor: 'b' }, order)).toEqual({ keys: order, anchor: 'b' })
    expect(pickAll(NOTHING_PICKED, order).anchor).toBe('a')
    // Modifiers: shift extends, ctrl or cmd adds, nothing replaces — and shift wins.
    expect(pickMode({ shiftKey: false, ctrlKey: false, metaKey: false })).toBe('only')
    expect(pickMode({ shiftKey: false, ctrlKey: true, metaKey: false })).toBe('toggle')
    expect(pickMode({ shiftKey: false, ctrlKey: false, metaKey: true })).toBe('toggle')
    expect(pickMode({ shiftKey: true, ctrlKey: true, metaKey: false })).toBe('range')
    // A column that changed under a pick does not keep a line it no longer has.
    expect(stillPicked({ keys: ['a', 'x'], anchor: 'x' }, ['a', 'b'])).toEqual({ keys: ['a'], anchor: 'a' })
    const same = { keys: ['a'], anchor: 'a' }
    expect(stillPicked(same, ['a', 'b'])).toBe(same)
  })

  it('stacks hosts as one list: one line per package, who carries it, and whether they disagree', () => {
    const row = (path: string, layerSig: string, extra: Partial<ReturnType<typeof rows>[number]> = {}) =>
      ({ path, name: path, description: '', layerSig, on: false, held: false, blockedBy: '', update: false, picked: false, hidden: 0, count: 1, children: 0, fromSource: false, ...extra })
    const stacked = stackRows([
      { zone: 'one.com', rows: [row('games', 'g1', { children: 2 }), row('notes', 'n1')] },
      { zone: 'two.com', rows: [row('games', 'g1', { children: 3, count: 2 }), row('themes', 't1')] },
      { zone: 'three.com', rows: [row('notes', 'n2', { update: true })] },
    ])
    expect(stacked.map(r => r.path)).toEqual(['games', 'notes', 'themes'])
    const games = stacked.find(r => r.path === 'games')!
    expect(games.zones).toEqual(['one.com', 'two.com'])
    expect(games.differs).toBe(false)
    // The most any host says of its parts and of who carries it; the same signature is no difference.
    expect([games.children, games.count]).toEqual([3, 2])
    const notes = stacked.find(r => r.path === 'notes')!
    expect(notes.zones).toEqual(['one.com', 'three.com'])
    expect(notes.differs).toBe(true)
    expect(notes.update).toBe(true)
    // What runs here comes first, then by path.
    expect(stackRows([{ zone: 'a', rows: [row('b', 'x'), row('a', 'y', { on: true })] }]).map(r => r.path)).toEqual(['a', 'b'])
    expect(stackRows([])).toEqual([])
  })

  it('lists the code files of what is picked: each bee once, at the package that declares it', () => {
    const sig = (n: number): string => String(n).repeat(64).slice(0, 64)
    const layer = (path: string, bees: string[]) => ({ ...node(path, sig(9), [], ''), bees })
    const nodes = [
      layer('games', [sig(1), sig(2) + '.js']),
      layer('games/arkanoid', [sig(3)]),
      layer('notes', [sig(4)]),
      // A second host's version of games: the same bee again, and one more.
      layer('games', [sig(1), sig(5)]),
    ]
    expect(filesPicked(nodes, ['games']).map(f => f.sig)).toEqual([sig(1), sig(2), sig(5)])
    expect(filesPicked(nodes, ['games', 'notes']).map(f => f.sig)).toEqual([sig(1), sig(2), sig(5), sig(4)])
    expect(filesPicked(nodes, ['games']).every(f => f.path === 'games')).toBe(true)
    expect(filesPicked(nodes, ['nothing'])).toEqual([])
    // Only a signature is a file: a malformed entry is never listed.
    expect(filesPicked([layer('x', ['not-a-sig', sig(6)])], ['x']).map(f => f.sig)).toEqual([sig(6)])
  })

  it('names a code file by its first line, and slices it into the lines a panel shows', () => {
    expect(codeName('// @hypercomb/essentials/games/solomon\nexport {}')).toBe('@hypercomb/essentials/games/solomon')
    expect(codeName('//src/sharing/host.ts\n')).toBe('src/sharing/host.ts')
    expect(codeName('var a = 1\n// later')).toBe('')
    expect(codeName('')).toBe('')
    expect(codeName('// ' + 'x'.repeat(300)).length).toBe(90)
    expect(codeLines('a\nb\nc', 2)).toEqual({ lines: ['a', 'b'], more: 1 })
    expect(codeLines('a\nb', 5)).toEqual({ lines: ['a', 'b'], more: 0 })
    expect(codeLines('', 5)).toEqual({ lines: [''], more: 0 })
  })

  it('is a column browser: stacked hosts feed the search and every column, files and code come last', () => {
    // jwize 2026-11-04: "like the mac finder of code and files with multiple select on all
    // columns then you can look at code files in the matrix" … "stacked domains or hives to
    // the searching and views."
    expect(VIEW).toMatch(/#columnModel\(\): \{ rows: StackRow\[\]; picked: Picked; parents: string\[\] \}\[\]/)
    // Each column is the parts of what the one before picked — across every stacked host.
    expect(VIEW).toMatch(/stackRows\(this\.#stack\.keys\.flatMap\(zone => parents\.map\(at => \(\{ zone, rows: this\.#rows\(zone, at, ''\) \}\)\)\)\)/)
    // A pick in a column drops what was picked deeper, and the files with it.
    const pickPackage = VIEW.slice(VIEW.indexOf('#pickPackage(k: number'))
    expect(pickPackage.slice(0, 520)).toMatch(/this\.#cols = \[\.\.\.this\.#cols\.slice\(0, k\), pickKey\(/)
    expect(pickPackage.slice(0, 520)).toMatch(/this\.#files = NOTHING_PICKED/)
    // A row picks on any click that is not on one of its own buttons; its name is the line.
    expect(VIEW).toMatch(/closest\('button:not\(\.hd-name\), a'\)\) return/)
    // The search covers the hosts stacked, one line per package however many carry it.
    const matches = VIEW.slice(VIEW.indexOf('#renderMatches(body: HTMLElement'), VIEW.indexOf('#firewallToggle('))
    expect(matches).toMatch(/stackRows\(stacked\)/)
    expect(matches).toMatch(/this\.#stack\.keys\.map\(zone => \(\{ zone, rows: this\.#rows\(zone, '', this\.#query\) \}\)\)/)
    // Choosing a line opens the columns down to it, and the row takes focus — so Escape, which
    // goes by focus, unwinds this desk instead of putting every window away.
    expect(matches).toMatch(/this\.#focusKey = match\.path/)
    // Hosts stacked are one pane: no act of one host is drawn over several.
    expect(VIEW).toMatch(/if \(this\.#stack\.keys\.length > 1\) \{/)
    // Arrow keys walk a column, shift extends, right opens the next, ctrl/cmd-A takes the lot.
    expect(VIEW).toMatch(/event\.key === 'ArrowDown'\) next\(1\)/)
    expect(VIEW).toMatch(/pick\(key, event\.shiftKey \? 'range' : 'only'\)/)
    expect(VIEW).toMatch(/\(event\.ctrlKey \|\| event\.metaKey\)\) \{\s*event\.preventDefault\(\)/)
    // A redraw puts each column's scroll and the focus back — whichever row held it, for any
    // repaint — and the focus never falls to the body, where Escape would put every window away.
    expect(VIEW).toMatch(/column\.scrollTop = scrolls\[at\] \?\? 0/)
    expect(VIEW).toMatch(/this\.#restoreFocus\(strip, held\)/)
    expect(VIEW).toMatch(/if \(document\.activeElement === document\.body\) this\.#panel\?\.focus\(\{ preventScroll: true \}\)/)
  })

  it('reads code from what is held, and from a host only for a file that is picked — never a bundle nobody asked for', () => {
    const want = VIEW.slice(VIEW.indexOf('#wantCode(files: readonly FileRow[]): void {'), VIEW.indexOf('async #askCode('))
    expect(want).toMatch(/if \(picked\.has\(sig\)\) void this\.#askCode\(sig, true\)/)
    expect(want).toMatch(/else if \(!this\.#heldNot\.has\(sig\)\) void this\.#askCode\(sig, false\)/)
    const ask = VIEW.slice(VIEW.indexOf('async #askCode('), VIEW.indexOf('#codeSoon(): void {'))
    expect(ask).toMatch(/remote \? await store\?\.getResource\?\.\(sig\) : await store\?\.getResourceLocal\?\.\(sig\)/)
    // A big file is read from its start only, and the panel says so.
    expect(ask).toMatch(/const cut = blob\.size > CODE_KEEP/)
    expect(VIEW).toMatch(/const CODE_PANELS = 6/)
    // The matrix: one panel per picked file, the count capped and the rest said.
    expect(VIEW).toMatch(/this\.#files\.keys\.slice\(0, CODE_PANELS\)/)
    expect(VIEW).toMatch(/\.hd-matrix\{[^}]*grid-template-columns:repeat\(auto-fit,minmax\(22rem,1fr\)\)/)
    // Line numbers are drawn by CSS, so copying a file copies the code and not the gutter.
    expect(VIEW).toMatch(/\.hd-code \.cl::before\{content:counter\(l\)/)
    expect(VIEW).toMatch(/user-select:none/)
  })

  it('lights a package: on and current, on and dim by how old the running version is, or out', () => {
    // jwize 2026-11-04: "it should be on but dim if there is a newer version and a spectrum
    // based on how old."
    const day = 86_400_000
    const now = Date.parse('2026-11-05T00:00:00Z')
    expect(lightOf({ on: true, update: false }, undefined, now)).toEqual({ state: 'on', level: 1 })
    expect(lightOf({ on: false, update: false }, undefined, now)).toEqual({ state: 'off', level: 0 })
    // A package that is off is out whatever newer version there is.
    expect(lightOf({ on: false, update: true }, now - day, now)).toEqual({ state: 'off', level: 0 })
    expect(lightOf({ on: true, update: true }, now, now).state).toBe('behind')

    // The spectrum: lit, never as bright as current, dimmer with every age, never out.
    const levels = [0, 1, 7, 30, 90, 180].map(days => ageLevel(now - days * day, now))
    expect(levels[0]).toBeCloseTo(LIGHT_BRIGHTEST)
    expect(levels[0]).toBeLessThan(1)
    for (let at = 1; at < levels.length; at++) expect(levels[at]).toBeLessThan(levels[at - 1]!)
    expect(levels[levels.length - 1]).toBeCloseTo(LIGHT_DIMMEST)
    expect(LIGHT_DIMMEST).toBeGreaterThan(0)
    // Past the far end it stays as dim as it gets; a date in the future is as fresh as now.
    expect(ageLevel(now - 900 * day, now)).toBeCloseTo(LIGHT_DIMMEST)
    expect(ageLevel(now + 5 * day, now)).toBeCloseTo(LIGHT_BRIGHTEST)
    // The first days matter more than the months: a week costs more than a week at three months.
    expect(ageLevel(now - 7 * day, now) - ageLevel(now, now)).toBeLessThan(0)
    expect(ageLevel(now, now) - ageLevel(now - 7 * day, now)).toBeGreaterThan(ageLevel(now - 90 * day, now) - ageLevel(now - 97 * day, now))
    // An age that could not be told is the middle of the spectrum, not the fresh end and not out.
    expect(ageLevel(null, now)).toBe(LIGHT_UNKNOWN)
    expect(ageLevel(Number.NaN, now)).toBe(LIGHT_UNKNOWN)
    expect(lightOf({ on: true, update: true }, null, now)).toEqual({ state: 'behind', level: LIGHT_UNKNOWN })
    expect(lightOf({ on: true, update: true }, undefined, now).level).toBe(LIGHT_UNKNOWN)
    expect(LIGHT_UNKNOWN).toBeGreaterThan(LIGHT_DIMMEST)
    expect(LIGHT_UNKNOWN).toBeLessThan(LIGHT_BRIGHTEST)
  })

  it('reads when the running version first appeared: the earliest date any host gave for that layer', () => {
    const revision = (layer: string, at: string, sources: { at: string }[] = []): InstallRevision =>
      ({ layer, at, sources: sources.map(source => ({ root: 'r', zone: 'h.com', at: source.at })) })
    const revisions = [
      revision('new', '2026-11-01T00:00:00Z'),
      revision('mine', '2026-09-10T00:00:00Z', [{ at: '2026-09-08T12:00:00Z' }, { at: '2026-09-12T00:00:00Z' }]),
      revision('undated', ''),
    ]
    expect(runningStamp(revisions, 'mine')).toBe(Date.parse('2026-09-08T12:00:00Z'))
    expect(runningStamp(revisions, 'new')).toBe(Date.parse('2026-11-01T00:00:00Z'))
    // No revision names it, or none carries a date: unknown, never zero.
    expect(runningStamp(revisions, 'other')).toBeNull()
    expect(runningStamp(revisions, 'undated')).toBeNull()
    expect(runningStamp([], 'mine')).toBeNull()
  })

  it('the light tells and a press on it switches; the manage menu holds the same switch and three more, closed by Escape or a click elsewhere', () => {
    // jwize 2026-11-04: "The update brings to newest or you click the manage icon turn it off
    // or pick revisions and look at code in the finder view."
    // jwize 2026-11-10: "Yes, bulb switches" — the switch was only in the menu, so the
    // bulb is the switch again, and still the light.
    expect(VIEW).toMatch(/const bulb = button\(`hd-bulb \$\{light\.state\}`, ''\)/)
    expect(VIEW).toMatch(/bulb\.addEventListener\('click', \(\) => \{ void this\.#toggle\(row\) \}\)/)
    expect(VIEW).toMatch(/bulb\.setAttribute\('aria-pressed', String\(row\.on\)\)/)
    // One rule decides whether it can be switched, for the bulb and the menu alike.
    expect(VIEW).toMatch(/bulb\.disabled = switching\.blocked/)
    expect(VIEW).toMatch(/const \{ blocked, reason \} = this\.#switchable\(row\)/)
    // A press on the bulb is not a pick of the row.
    expect(VIEW).toMatch(/closest\('button:not\(\.hd-name\), a'\)\) return/)
    expect(VIEW).toMatch(/bulb\.style\.setProperty\('--hd-age', String\(light\.level\)\)/)
    expect(VIEW).toMatch(/\.hd-bulb\.behind\{opacity:var\(--hd-age,\.55\);\}/)
    // The update mark is still the one press that brings a package to the newest.
    expect(VIEW).toMatch(/update\.addEventListener\('click', \(\) => \{ void this\.#takeUpdate\(row\) \}\)/)
    // The menu: turn it off or on, update to the newest (only when there is one), revisions, code.
    const menu = VIEW.slice(VIEW.indexOf('#renderMenu(): void {'), VIEW.indexOf('#lookAtCode(k: number'))
    expect(menu).toMatch(/void this\.#toggle\(row\)/)
    expect(menu).toMatch(/if \(row\.update\) \{\s*item\('updateIcon', t\('hosts\.update-newest'/)
    expect(menu).toMatch(/void this\.#takeUpdate\(row\)/)
    expect(menu).toMatch(/void this\.#openRevisions\(row\.path\)/)
    expect(menu).toMatch(/this\.#lookAtCode\(k, row, /)
    // Looking at the code is the columns: the package is picked, so its files are what opens.
    const look = VIEW.slice(VIEW.indexOf('#lookAtCode(k: number'))
    expect(look.slice(0, 320)).toMatch(/this\.#pickPackage\(k, row\.path, 'only', order\)/)
    // The menu is state, not a node, so a repaint keeps it; Escape closes it first and a click elsewhere
    // closes it in the capture phase, so the click still reaches what it was for.
    expect(VIEW).toMatch(/if \(this\.#menu !== null\) \{ this\.#menu = null; this\.#renderBody\(\); return true \}/)
    expect(VIEW).toMatch(/closest\('\.hd-menu, \.hd-manage'\)\) return\s*this\.#menu = null\s*this\.#renderBody\(\)\s*\}, true\)/)
    expect(VIEW).toMatch(/this\.#renderDrawer\(drawer\)\s*this\.#renderMenu\(\)/)
    // A desk that closes keeps no menu.
    expect(VIEW).toMatch(/this\.#opening\+\+\s*this\.#menu = null/)
    // The age is read only for a row that is on and behind, two at a time, once each.
    expect(VIEW).toMatch(/if \(row\.on && row\.update && running\) this\.#queueAge\(row\.path, running\)/)
    expect(VIEW).toMatch(/while \(this\.#ageActive < 2 && this\.#ageQueue\.length\)/)
    expect(VIEW).toMatch(/if \(this\.#ages\.has\(key\) \|\| this\.#agesAsk\.has\(key\)\) return/)
    // The old ↺ icon is gone: revisions are one of the menu's four.
    expect(VIEW).not.toMatch(/button\('hd-icon', '↺'/)
  })

  it('walks the rail with the arrow keys, the pane following, and your own host has its own entry', () => {
    const keys = VIEW.slice(VIEW.indexOf('#railKeys(event: KeyboardEvent): void {'), VIEW.indexOf('#railKeys(event: KeyboardEvent): void {') + 900)
    expect(keys).toMatch(/event\.key !== 'ArrowDown' && event\.key !== 'ArrowUp'/)
    // Typing in the search or the add field is never taken for a walk.
    expect(keys).toMatch(/target\.closest\('input'\)\) return/)
    expect(VIEW).toMatch(/this\.#railFocus = next\.dataset\['pane'\] \?\? ''/)
    expect(VIEW).toMatch(/const OWN_PANE = '#own'/)
    expect(VIEW).toMatch(/#renderOwn\(body: HTMLElement\): void/)
  })

  it('revisions are a drill-down that returns to the list, and a change reopens it where it was chosen', () => {
    expect(VIEW).toMatch(/type View = 'domains' \| 'revisions' \| 'creations' \| 'mine' \| 'own'/)
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
    // The manifest is read once per package (#readManifest memo, 2026-11-04);
    // the gate reads the activation record's bees off that one read.
    const run = PRELOADER.slice(PRELOADER.indexOf('const manifest = this.#readManifest()'))
    expect(run).toMatch(/const layerRoots = manifest\.layers/)
    expect(run).toMatch(/const enabled = manifest\.bees/)
    expect(run).toMatch(/const keep = new Set\(\[\.\.\.enabled, \.\.\.walked\.criticalBees\]\)/)
    expect(run.indexOf('walked.bees.filter(sig => keep.has(sig))')).toBeLessThan(run.indexOf('#loadBeesPrioritized(walked.bees'))
  })

  it('on and off take effect while the hive runs; the restart is kept for what cannot let go', () => {
    // jwize 2026-11-10: "shouldn't we be able to add and remove features in
    // realtime from the hosts window?"
    const toggle = VIEW.slice(VIEW.indexOf('async #toggle(row: DirectoryRow)'), VIEW.indexOf('async #takeUpdate('))
    // Held bytes: the record is written, then the running hive is asked to match it.
    expect(toggle.indexOf('await install.applyUnits()')).toBeLessThan(toggle.indexOf('await this.#live()'))
    expect(toggle).toMatch(/\} else if \(await this\.#live\(\)\) \{[\s\S]{0,400}?return\s*\}\s*this\.#restart\(\)/)
    // A package only a host carries is picked in, and that still restarts.
    expect(toggle.indexOf('await install.pick(')).toBeLessThan(toggle.indexOf('await this.#live()'))
    // The window reaches the shell over IoC and takes only a plain yes.
    expect(VIEW).toMatch(/ioc<\{ recompose\?: \(\) => Promise<boolean> \}>\('@hypercomb\.social\/ScriptPreloader'\)/)
    expect(VIEW).toMatch(/return \(await preloader\?\.recompose\?\.\(\)\) === true \} catch \{ return false \}/)
    // A bee that declares no dispose() is never half switched off.
    const recompose = PRELOADER.slice(PRELOADER.indexOf('public recompose = async'), PRELOADER.indexOf('static #parseManifest'))
    expect(recompose).toMatch(/typeof leaving\?\.dispose !== 'function'\) return false/)
    expect(recompose.indexOf("!== 'function') return false")).toBeLessThan(recompose.indexOf('await new hypercomb().act('))
    expect(EN['packages.turned-on']).toBeTruthy()
    expect(EN['packages.turned-off']).toBeTruthy()
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
    const list = VIEW.slice(VIEW.indexOf('#packageColumn(rows: readonly StackRow[]'))
    expect(list).toMatch(/const untakeable = !row\.held && !this\.#carrying\(row\.path\)/)
    expect(list).toMatch(/\|\| untakeable\n/)
    const toggle = VIEW.slice(VIEW.indexOf('async #toggle(row: DirectoryRow)'), VIEW.indexOf('async #takeUpdate('))
    expect(toggle).toMatch(/this\.#isBehind\(this\.#scope\) \? this\.#behindText\(this\.#scope\)/)
    expect(toggle).toMatch(/this\.#offerable\(other\.root\)/)
  })

  it('an update no host can serve yet is said plainly, with the hosts behind — and no Update all button', () => {
    const section = VIEW.slice(VIEW.indexOf('#sectionBody(zone: string): HTMLElement {'), VIEW.indexOf('// ── the columns'))
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
