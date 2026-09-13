// packages-view.spec.ts — the Packages window: one searchable list of named
// units, ON or shaded, an update mark where the followed publisher moved one.
// The rows are pure (packageRows), so the list's rules are tested as data;
// the rest are ratchets on the shape the doctrine requires.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { changedUnits, packageRows, treeCarrying } from './packages.view'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..', '..')
const VIEW = readFileSync(join(here, 'packages.view.ts'), 'utf8')
const ACQUIRE = readFileSync(join(root, 'hypercomb-runtime', 'src', 'acquire.ts'), 'utf8')
const INSTALL_TYPES = readFileSync(join(root, 'hypercomb-core', 'src', 'install.types.ts'), 'utf8')
const PRELOADER = readFileSync(join(root, 'hypercomb-runtime', 'src', 'script-preloader.ts'), 'utf8')
const BARREL = readFileSync(join(root, 'hypercomb-shared', 'ui', 'shell-surfaces', 'shell-surfaces.barrel.ts'), 'utf8')
const INDICATOR = readFileSync(join(root, 'hypercomb-shared', 'ui', 'upgrade-indicator', 'upgrade-indicator.component.ts'), 'utf8')
const UPGRADE = readFileSync(join(here, '..', 'commands', 'upgrade.queen.ts'), 'utf8')
const EN = JSON.parse(readFileSync(join(root, 'hypercomb-shared', 'i18n', 'en.json'), 'utf8')) as Record<string, string>

const unit = (name: string, layerSig: string, description = '') => ({ name, layerSig, bees: [], description })

describe('the packages window', () => {

  it('is an element from essentials through the install port — never a barrel entry, never a runtime import', () => {
    expect(VIEW).toMatch(/customElements\.define\(PACKAGES_SURFACE, PackagesElement\)/)
    expect(VIEW).toMatch(/registry\.add\(\{ name: PACKAGES_SURFACE, owner: OWNER, element: PACKAGES_SURFACE/)
    expect(VIEW).not.toMatch(/@hypercomb\/runtime/)
    expect(VIEW).toMatch(/ioc<InstallProvider>\(INSTALL_IOC_KEY\)/)
    expect(BARREL).not.toMatch(/packages/)
    expect(ACQUIRE).toMatch(/ioc\?\.register\?\.\(INSTALL_IOC_KEY, installProvider\)/)
    expect(INSTALL_TYPES).toMatch(/export const INSTALL_IOC_KEY = '@hypercomb\.social\/Install'/)
  })

  it('a unit that is off does not load: the preloader keeps the activation record\'s bees, not every bee the layers declare', () => {
    // Found on the real hive 2026-09-13: `comfy` off wrote 133 bees to the
    // record, and ComfyDrone still registered — the preloader walked the
    // layers and unioned THEIR bees, reading the record only when there were
    // no layers to walk. The layers say what exists; the record says what runs.
    const run = PRELOADER.slice(PRELOADER.indexOf('const layerRoots = ScriptPreloader.readManifestLayers()'))
    expect(run).toMatch(/const enabled = ScriptPreloader\.readManifestBees\(\)/)
    expect(run).toMatch(/const keep = new Set\(\[\.\.\.enabled, \.\.\.walked\.criticalBees\]\)/)
    expect(run.indexOf('walked.bees.filter(sig => keep.has(sig))')).toBeLessThan(run.indexOf('#loadBeesPrioritized(walked.bees'))
  })

  it('the notice and /upgrade open it, and nothing calls the origin "your domain"', () => {
    expect(INDICATOR).toMatch(/EffectBus\.emit\('packages:open'/)
    expect(UPGRADE).toMatch(/EffectBus\.emit\('packages:open', \{\}\)/)
    expect(VIEW).toMatch(/EffectBus\.on<[^>]*>\('packages:open'/)
    expect(VIEW).not.toMatch(/\byour domain\b(?!s)|isHome|hosts\.home/)
    expect(EN['packages.mine']).toBe('this hive')
    expect(EN['packages.search-in']).toMatch(/\{host\}/)
  })

  it('lists on rows first, shaded rows after, and search filters both', () => {
    const mine = { root: 'r1', units: [unit('games', 'g1', 'play'), unit('notes', 'n1'), unit('sharing', 's1')] }
    const carried = new Map([['jwize.com', mine]])
    const rows = packageRows({ scope: '', mine, next: null, carried, off: new Set(['notes']), query: '' })
    expect(rows.map(r => `${r.name}:${r.on ? 'on' : 'off'}`)).toEqual(['games:on', 'sharing:on', 'notes:off'])
    expect(rows.every(r => r.held && !r.update && r.count === 1)).toBe(true)

    const found = packageRows({ scope: '', mine, next: null, carried, off: new Set(), query: 'PLAY' })
    expect(found.map(r => r.name)).toEqual(['games'])
  })

  it('marks exactly the units the followed publisher moved, and lists the ones it added', () => {
    const mine = { root: 'r1', units: [unit('games', 'g1'), unit('notes', 'n1')] }
    const next = { root: 'r2', units: [unit('games', 'g2'), unit('notes', 'n1'), unit('comfy', 'c1')] }
    expect([...changedUnits(mine.units, next.units)].sort()).toEqual(['comfy', 'games'])

    const rows = packageRows({ scope: '', mine, next, carried: new Map(), off: new Set(), query: '' })
    const byName = Object.fromEntries(rows.map(r => [r.name, r]))
    expect(byName['games']).toMatchObject({ on: true, update: true })
    expect(byName['notes']).toMatchObject({ on: true, update: false })
    expect(byName['comfy']).toMatchObject({ on: false, held: false, update: true })
  })

  it('this hive is the switchboard: the union of every domain, a count of how many carry each, on/off by name everywhere', () => {
    // Jaime 2026-09-13: "your domain is a list of all of the packages on or
    // off and that includes all domains together… a number beside the
    // packages to see how many of your hosts carry that particular package…
    // if you turn them on it should turn them on for all domains that have
    // it because they're identical… if you turn anything off on the main one
    // it shades it on all the domains."
    const mine = { root: 'r1', units: [unit('games', 'g1'), unit('notes', 'n1')] }
    const jwize = { root: 'r9', units: [unit('games', 'g9'), unit('wheel', 'w1')] }
    const plugin = { root: 'r7', units: [unit('games', 'g1')] }
    const carried = new Map([['jwize.com', jwize], ['pluginthematrix.com', plugin]])
    const off = new Set(['games'])

    const board = packageRows({ scope: '', mine, next: null, carried, off, query: '' })
    expect(board.map(r => `${r.name}:${r.on}:${r.held}:${r.count}`)).toEqual(['notes:true:true:0', 'games:false:true:2', 'wheel:false:false:1'])

    // A domain is the same board filtered to what it carries — games is off
    // there too, because the switch is the name.
    const there = packageRows({ scope: 'jwize.com', mine, next: null, carried, off, query: '' })
    expect(there.map(r => `${r.name}:${r.on}:${r.held}`)).toEqual(['games:false:true', 'wheel:false:false'])

    // A package not held is taken from where it is carried — the scope's own
    // domain first, then the followed publisher, then any domain.
    expect(treeCarrying('wheel', { scope: 'jwize.com', next: null, carried })?.root).toBe('r9')
    expect(treeCarrying('wheel', { scope: '', next: null, carried })?.root).toBe('r9')
    expect(treeCarrying('games', { scope: '', next: { root: 'r2', units: [unit('games', 'g2')] }, carried })?.root).toBe('r2')
    expect(treeCarrying('absent', { scope: '', next: null, carried })).toBeNull()
  })

  it('a row is a heading that opens alone — thousands read as names', () => {
    expect(VIEW).toMatch(/#opened = ''/)
    expect(VIEW).toMatch(/const opened = this\.#opened === row\.name/)
    expect(VIEW).toMatch(/this\.#opened = opened \? '' : row\.name/)
    expect(VIEW).toMatch(/pk-where/)
  })

  it('the origin is the shell, never a host: the web shell takes packages only from the hosts it carries', () => {
    // Jaime 2026-09-13: "only have imports from our own host servers and never
    // from hypercomb.io… the hosts are your proxy." The bundled install stays
    // only where the origin IS the host: the visitor door and the native shell.
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
