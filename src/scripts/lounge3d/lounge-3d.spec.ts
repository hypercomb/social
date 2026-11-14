// @vitest-environment node
// (esbuild refuses jsdom's typed arrays, and nothing here needs a DOM)
//
// scripts/lounge3d/lounge-3d.spec.ts
//
// The lounge leans on things it does not own, each checked against the
// installed packages so an upgrade fails here first instead of in a visitor's
// browser:
//
// - the no-eval Pixi's two private tables, imported by file path;
// - the portal shader's names, which the looking glasses' flip bit reads
//   (mirrorFlipBit in lounge-3d.ts);
// - the bundle the hive stores, which borrows the page's Pixi: it must carry
//   no Pixi and none of `@pixi/3d`'s core, and every name the bundled extras
//   take from that core must be one the lent module exports;
// - the --preview bundle, which carries its own: built the way the site
//   builds it, naming no other host and carrying no three.js.

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { PIXI_LENDER, bundleLounge, bundleLoungeWith } from './bundle-lounge.js'

const packageDir = (name: string): string => {
  const found = [resolve(process.cwd(), 'node_modules', name), resolve(process.cwd(), '../node_modules', name)]
    .find(dir => existsSync(dir))
  if (!found) throw new Error(`${name} is not installed`)
  return found
}
const source = readFileSync(resolve(process.cwd(), 'scripts/lounge3d/lounge-3d.ts'), 'utf8')

describe('the lounge on Pixi’s own 3D', () => {
  it('imports no three.js', () => {
    expect(source).not.toMatch(/from ['"]three(\/|['"])/)
  })

  it('finds the no-eval tables where it imports them from', () => {
    const pixi = packageDir('pixi.js')
    const uniforms = readFileSync(resolve(pixi, 'lib/unsafe-eval/uniforms/uniformSyncFunctions.mjs'), 'utf8')
    const ubo = readFileSync(resolve(pixi, 'lib/unsafe-eval/ubo/uboSyncFunctions.mjs'), 'utf8')
    expect(uniforms).toMatch(/export\s*\{[^}]*\buniformParserFunctions\b/)
    expect(ubo).toMatch(/export\s*\{[^}]*\buboParserFunctions\b/)
  })

  it('reads the portal shader by names @pixi/3d still uses', () => {
    const extras = readFileSync(resolve(packageDir('@pixi/3d'), 'dist/pixijs-3d-extras.mjs'), 'utf8')
    const flipBit = source.slice(source.indexOf('const mirrorFlipBit'), source.indexOf('interface MirrorRig'))
    for (const name of ['portalScreenUV', 'samplePortal', 'decodeFrame', 'portalTint']) {
      expect(flipBit, `the flip bit no longer reads ${name}`).toContain(name)
      expect(extras, `@pixi/3d's portal shader no longer has ${name}`).toContain(name)
    }
    expect(extras).toMatch(/function portalExitClipPlane\b/)
  })
})

describe('the bundle the hive stores borrows the page’s Pixi', () => {
  it('carries no Pixi and none of @pixi/3d’s core', async () => {
    const { text, inputs } = await bundleLoungeWith()
    expect(inputs.filter(p => p.includes('node_modules/pixi.js/'))).toEqual([])
    expect(inputs.filter(p => p.includes('node_modules/@pixi/3d/') && !p.includes('/dist/extras/'))).toEqual([])
    // It asks the hive's lender first, then the page's import map.
    expect(text).toContain(PIXI_LENDER)
    expect(text).toContain('import("pixi.js")')
    expect(text).toContain('import("@pixi/3d")')
    expect(text).not.toContain('gstatic.com')
    // The room's own source and three extras: about 100 KB. Past 250 KB,
    // something of Pixi's came back inside.
    expect(text.length).toBeLessThan(250_000)
  }, 60_000)

  it('sends the extras only names the lent @pixi/3d exports', async () => {
    const { inputs } = await bundleLoungeWith()
    const dist = resolve(packageDir('@pixi/3d'), 'dist')
    const entry = readFileSync(resolve(dist, 'index.mjs'), 'utf8')
    const exported = new Set([...entry.matchAll(/export\s*\{([^}]*)\}/g)]
      .flatMap(m => m[1]!.split(',').map(part => part.trim().split(/\s+as\s+/).pop()!)))
    const extras = inputs.filter(p => p.includes('node_modules/@pixi/3d/dist/extras/'))
    expect(extras.length).toBeGreaterThan(0)
    const missing: string[] = []
    for (const file of extras) {
      const full = resolve(process.cwd(), file)
      const text = readFileSync(full, 'utf8')
      for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*"(\.[^"]+)"/g)) {
        const target = resolve(dirname(full), m[2]!)
        if (relative(resolve(dist, 'extras'), target).split(sep)[0] !== '..') continue
        for (const name of m[1]!.split(',').map(part => part.trim().split(/\s+as\s+/)[0]!).filter(Boolean)) {
          if (!exported.has(name)) missing.push(`${name} (${file})`)
        }
      }
    }
    expect(missing, 'the extras take a name the lent @pixi/3d does not export').toEqual([])
  }, 60_000)
})

describe('the --preview bundle carries its own', () => {
  it('bundles to one script that names no other host', async () => {
    const bundle = await bundleLounge({ pixi: 'own' })
    expect(bundle).not.toContain('gstatic.com')
    expect(bundle).toContain('/vendor/draco/')
    expect(bundle).not.toMatch(/three\.module|REVISION\s*=\s*["']\d+["']/)
    // Pixi and its 3D ride inside: about 1.2 MB. A jump well past that means
    // something new came along for the ride.
    expect(bundle.length).toBeLessThan(1_500_000)
  }, 60_000)
})
