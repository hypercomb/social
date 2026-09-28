// Exact regression: /friends/jaime and /team/jaime are two appearances in the
// same name pool. Their selected images are allowed to differ. ShowCellDrone
// cannot be constructed cheaply in a unit test (Pixi + OPFS + IoC), so this
// pins the source seam exactly as the existing cells-key ratchets do.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The renderer: show-cell and the branch that reads each tile's face
// (tile-faces.ts). A rule holds wherever in the renderer its code lives.
const DRONE = readFileSync(join(__dirname, 'show-cell.drone.ts'), 'utf8')
const FACES = readFileSync(join(__dirname, 'tile-faces.ts'), 'utf8')
const SRC = DRONE + '\n' + FACES

const memberBody = (marker: string): string => {
  const lines = SRC.split('\n')
  const start = lines.findIndex(line => line.includes(marker))
  expect(start, `member not found: ${marker}`).toBeGreaterThan(-1)
  let open = start
  while (open < lines.length && !lines[open].trimEnd().endsWith('{')) open++
  const out: string[] = []
  for (let i = open + 1; i < lines.length; i++) {
    if (/^ {2}\S/.test(lines[i])) break
    out.push(lines[i])
  }
  return out.join('\n')
}

describe('show-cell same name across lineages', () => {
  it('restores every label-derived cache from the incoming lineage', () => {
    const body = memberBody('enter = (locationKey: string, restorable: boolean): void =>')
    expect(body).toMatch(/locationKey === this\.#locationKey/)
    expect(body).toMatch(/#derivedStateByLocation\.set\(this\.#locationKey/)
    expect(body).toMatch(/this\.#locationKey = locationKey/)
    expect(body).toMatch(/#derivedStateByLocation\.get\(locationKey\)/)
    expect(body).toMatch(/state\.images/)
    expect(body).toMatch(/state\.external/)
    expect(body).not.toMatch(/invalidateLabels\(\)/)
  })

  it('resets before the back-navigation cache can reuse a raw jaime key', () => {
    const reset = DRONE.indexOf('this.#faces.enter(locationKey, this.#layerCellsCache.has(locationKey))')
    const backNav = DRONE.indexOf('// ── back-nav fast path')
    expect(reset).toBeGreaterThan(-1)
    expect(backNav).toBeGreaterThan(reset)
  })

  it('recovers a missing props-index entry before the normal paint completes', () => {
    expect(SRC).toMatch(/let propsSig = propsSigForLabel\(cell\.label\)/)
    expect(SRC).toMatch(/if \(!propsSig\) \{[\s\S]*propsSig = await readTilePropsSigAt\(/)
    expect(SRC).toMatch(/seedLayerKeyedEntries\(\[\[headSig, propsSig\]\]\)/)
    expect(SRC).not.toMatch(/freshIndex\[locationKey\] = propsSig/)
  })

  it('resolves the Life properties incidence before parsing local props', () => {
    expect(SRC).toMatch(/resolveLocalResourceReference\(store, propsSig\)/)
    expect(SRC).not.toMatch(/store\.getResourceLocal\(propsSig\)/)
  })

  it('uses a recoverable picture projection for legacy large-only tiles', () => {
    expect(SRC).toMatch(/recoverableTileImageSig\(props, this\.host\.flat\(\)\)/)
    expect(SRC).not.toMatch(/const smallSig = \(this\.#flat && props\?\.flat\?\.small\?\.image\)/)
  })

  it('never promotes a bare-label legacy appearance into a lineage head', () => {
    expect(SRC).not.toMatch(/legacySig = livePropsIndex\[cell\.label\]/)
    expect(SRC).not.toMatch(/freshIndex\[locationKey\] = legacySig/)
  })

  it('composes root defaults with outer lineage overrides without indexing the merge', () => {
    expect(SRC).toMatch(/effectiveProps = this\.host\.cursorPropsOverride\(\)\?\.has\(cell\.label\)[\s\S]*readTilePropertiesAt\(/)
    expect(SRC).toMatch(/const props: any = Object\.keys\(effectiveProps\)\.length > 0[\s\S]*effectiveProps[\s\S]*outerProps/)
    expect(SRC).not.toMatch(/seedLayerKeyedEntries\(\[\[headSig, effective/)
    expect(SRC).not.toMatch(/freshIndex\[locationKey\] = effective/)
  })

  it('invalidates prepared lineage projections when a root default changes', () => {
    expect(SRC).toMatch(/onEffect<\{ cell: string \}>\('tile:root-default-changed'/)
    expect(DRONE).toMatch(/this\.#faces\.invalidateEverywhere\(label\)/)
    expect(FACES).toMatch(/#derivedStateByLocation\.values\(\)/)
    expect(SRC).toMatch(/#layerCellsCache\.clear\(\)/)
  })

  it('captures the outgoing participant variants before clearing the pass state', () => {
    const capture = SRC.indexOf('const previousVariantLabels = new Set(this.#stackVariantLabels)')
    const clear = SRC.indexOf('this.#stackVariantLabels = new Set()', capture)
    const invalidate = SRC.indexOf('for (const label of previousVariantLabels)', clear)
    expect(capture).toBeGreaterThan(-1)
    expect(clear).toBeGreaterThan(capture)
    expect(invalidate).toBeGreaterThan(clear)
  })

  it('re-resolves pictureless cells restored by the back-nav cache', () => {
    expect(SRC).toMatch(/let hasUnresolvedLocalImage = false/)
    expect(SRC).toMatch(/if \(!cell\.imageSig\) hasUnresolvedLocalImage = true/)
    expect(SRC).toMatch(/evictedSigs\.length > 0 \|\| hasUnresolvedLocalImage/)
    expect(SRC).toMatch(/loadCellImages\(cached\.cells, cachedDir \?\? null, force\)/)
  })

  it('uses the default signature set on every no-explicit-image path', () => {
    expect(SRC).toMatch(/const loadDefaultImage = async \(cold = false\): Promise<void> =>/)
    expect(SRC).toMatch(/pickImageForLabel\?\.\(cell\.label\)/)
    expect(SRC).toMatch(/\} catch \{[\s\S]*await loadDefaultImage\(propsCold\)/)
    expect(SRC).not.toMatch(/no cell dir or no properties file — no image/)
  })

  it('never REMEMBERS the default set while the tile own props are still cold', () => {
    // A cached non-null fallback short-circuits every later pass, so caching
    // one for a cold read strands the tile on substrate art for the session —
    // the shape that hid every published picture on a visitor site.
    expect(SRC).toMatch(/const remember = \(sig: string \| null\): void =>[\s\S]{0,120}?if \(cold\) \{ imageCache\.delete\(cell\.label\); return \}/)
    expect(SRC).toMatch(/let propsCold = false/)
    expect(SRC).toMatch(/if \(effectiveStats\.cold\) propsCold = true/)
    expect(SRC).not.toMatch(/const loadDefaultImage[\s\S]{0,600}?imageCache\.set\(cell\.label, fallbackSig\)/)
  })

  it('isolates off-screen and stale async image derivations from the live lineage cache', () => {
    expect(SRC).toMatch(/const cacheOwner = this\.#locationKey/)
    expect(SRC).toMatch(/prepareOnly \? new Map<string, string \| null>\(\) : new Map\(this\.images\)/)
    expect(SRC).toMatch(/publishOwnedProjection\(\{/)
    expect(SRC).toMatch(/commit\(imageCache, this\.images, true\)/)
    expect(SRC).toMatch(/served !== canonical && cacheOwner === this\.#locationKey/)
  })

  it('pins resolved foreground images before geometry can yield to background atlas work', () => {
    const load = memberBody('  load = async (')
    const decoded = load.indexOf('await Promise.all(cells.map(loadOne))')
    const pinned = load.indexOf('imageAtlas.setPinned(pins)')
    const published = load.indexOf('commit(imageCache, this.images, true)')
    expect(decoded).toBeGreaterThan(-1)
    expect(pinned).toBeGreaterThan(decoded)
    expect(published).toBeGreaterThan(pinned)
    expect(load).toMatch(/if \(!prepareOnly && cacheOwner === this\.#locationKey\)/)
    expect(load).toMatch(/this\.host\.renderedCells\(\)/)
  })
})
