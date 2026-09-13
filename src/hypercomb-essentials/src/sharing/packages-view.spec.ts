// packages-view.spec.ts — the Packages window: one searchable list of named
// units, ON or shaded, an update mark where the followed publisher moved one.
// The rows are pure (packageRows), so the list's rules are tested as data;
// the rest are ratchets on the shape the doctrine requires.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { changedUnits, packageRows } from './packages.view'

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
    expect(VIEW).not.toMatch(/your domain|isHome|hosts\.home/)
    expect(EN['packages.mine']).toBe('this hive')
    expect(EN['packages.search-in']).toMatch(/\{host\}/)
  })

  it('lists on rows first, shaded rows after, and search filters both', () => {
    const mine = { root: 'r1', units: [unit('games', 'g1', 'play'), unit('notes', 'n1'), unit('sharing', 's1')] }
    const rows = packageRows({ scope: '', mine, next: null, tree: mine, off: new Set(['notes']), query: '' })
    expect(rows.map(r => `${r.name}:${r.on ? 'on' : 'off'}`)).toEqual(['games:on', 'sharing:on', 'notes:off'])
    expect(rows.every(r => r.held && !r.update && !r.offered)).toBe(true)

    const found = packageRows({ scope: '', mine, next: null, tree: mine, off: new Set(), query: 'PLAY' })
    expect(found.map(r => r.name)).toEqual(['games'])
  })

  it('marks exactly the units the followed publisher moved, and lists the ones it added', () => {
    const mine = { root: 'r1', units: [unit('games', 'g1'), unit('notes', 'n1')] }
    const next = { root: 'r2', units: [unit('games', 'g2'), unit('notes', 'n1'), unit('comfy', 'c1')] }
    expect([...changedUnits(mine.units, next.units)].sort()).toEqual(['comfy', 'games'])

    const rows = packageRows({ scope: '', mine, next, tree: mine, off: new Set(), query: '' })
    const byName = Object.fromEntries(rows.map(r => [r.name, r]))
    expect(byName['games']).toMatchObject({ on: true, update: true })
    expect(byName['notes']).toMatchObject({ on: true, update: false })
    expect(byName['comfy']).toMatchObject({ on: false, held: false, update: true })
  })

  it('a domain lookup is the same list, scoped: its head is on offer, nothing there is "on" unless it is the installed tree', () => {
    const mine = { root: 'r1', units: [unit('games', 'g1')] }
    const theirs = { root: 'r9', units: [unit('games', 'g9'), unit('wheel', 'w1')] }
    const rows = packageRows({ scope: 'jwize.com', mine, next: null, tree: theirs, off: new Set(), query: '' })
    expect(rows.map(r => `${r.name}:${r.on}:${r.held}:${r.offered}`)).toEqual(['games:false:true:true', 'wheel:false:false:true'])

    const same = packageRows({ scope: 'jwize.com', mine, next: null, tree: mine, off: new Set(), query: '' })
    expect(same[0]).toMatchObject({ name: 'games', on: true, offered: false })
  })
})
