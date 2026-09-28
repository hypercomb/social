import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(__dirname, 'show-cell.drone.ts'), 'utf8')
// The verdict and its repair are a branch of their own (tile-readiness.ts);
// view preparation stays with the renderer.
const READY = readFileSync(join(__dirname, 'tile-readiness.ts'), 'utf8')

const memberBody = (marker: string, source = SRC): string => {
  const lines = source.split('\n')
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

describe('show-cell readiness truth', () => {
  it('joins an in-flight first-paint preparation instead of reporting cold', () => {
    expect(SRC).toMatch(/#viewPrepInFlight = new Map<string, Promise<boolean>>\(\)/)
    const body = memberBody('prepareView = async (layerSig: string')
    expect(body).toMatch(/#viewPrepInFlight\.get\(layerSig\)/)
    expect(body).toMatch(/if \(existing\) return existing/)
    expect(body).toMatch(/#viewPrepInFlight\.set\(layerSig, preparation\)/)
  })

  it('keeps a branch shaded until preparation and exact atlas residency finish', () => {
    const body = memberBody('compute = async (', READY)
    expect(body).toMatch(/const prepared = await this\.host\.prepareView\(/)
    expect(body).toMatch(/if \(!prepared\) \{\s*allReady = false/)
    expect(body).toMatch(/if \(!this\.#clickTargetResident\(names, imgs\)\) \{\s*allReady = false\s*this\.#enqueueBake/)
  })

  it('re-shades only a proven target displaced from an atlas', () => {
    const revoke = memberBody('#revokeReadinessForRepair = (label: string): void =>', READY)
    expect(revoke).toMatch(/#childrenReadyByLabel\.delete\(label\)/)
    expect(revoke).toMatch(/#brightLabels\.delete\(label\)/)
    // The renderer repaints the shade the moment the proof is withdrawn.
    expect(revoke).toMatch(/this\.host\.revoked\(label\)/)
    expect(SRC).toMatch(/revoked: label => \{\s*this\.#shadeFadeStartedAt\.delete\(label\)\s*this\.#writeShadeFor\(label\)/)

    // The renderer's eviction handlers hand the victim to readiness.
    expect(memberBody('readonly #onAtlasEvicted = (e?: Event): void =>')).toMatch(/this\.#readiness\.imageEvicted\(/)
    expect(memberBody('readonly #onLabelAtlasEvicted = (e?: Event): void =>')).toMatch(/this\.#readiness\.labelEvicted\(/)

    const imageEviction = memberBody('imageEvicted(victim: string | undefined): void', READY)
    expect(imageEviction).toMatch(/entry\?\.targets/)
    expect(imageEviction.indexOf('#revokeReadinessForRepair(label)'))
      .toBeLessThan(imageEviction.indexOf('#enqueueBake(target.headSig'))

    const labelEviction = memberBody('labelEvicted(victim: string | undefined): void', READY)
    expect(labelEviction.indexOf('#revokeReadinessForRepair(branch)'))
      .toBeLessThan(labelEviction.indexOf('#enqueueBake(headSig'))
  })
})
