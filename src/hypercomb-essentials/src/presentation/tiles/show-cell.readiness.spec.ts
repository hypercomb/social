import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(__dirname, 'show-cell.drone.ts'), 'utf8')

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

describe('show-cell readiness truth', () => {
  it('joins an in-flight first-paint preparation instead of reporting cold', () => {
    expect(SRC).toMatch(/#viewPrepInFlight = new Map<string, Promise<boolean>>\(\)/)
    const body = memberBody('prepareView = async (layerSig: string')
    expect(body).toMatch(/#viewPrepInFlight\.get\(layerSig\)/)
    expect(body).toMatch(/if \(existing\) return existing/)
    expect(body).toMatch(/#viewPrepInFlight\.set\(layerSig, preparation\)/)
  })

  it('keeps a branch shaded until preparation and exact atlas residency finish', () => {
    const body = memberBody('#computeChildrenReadiness = async (')
    expect(body).toMatch(/const prepared = await this\.prepareView\(/)
    expect(body).toMatch(/if \(!prepared\) \{\s*allReady = false/)
    expect(body).toMatch(/if \(!this\.#clickTargetResident\(names, imgs\)\) \{\s*allReady = false\s*this\.#enqueueBake/)
  })

  it('re-shades only a proven target displaced from an atlas', () => {
    const revoke = memberBody('#revokeReadinessForRepair = (label: string): void =>')
    expect(revoke).toMatch(/#childrenReadyByLabel\.delete\(label\)/)
    expect(revoke).toMatch(/#brightLabels\.delete\(label\)/)
    expect(revoke).toMatch(/#writeShadeFor\(label\)/)

    const imageEviction = memberBody('readonly #onAtlasEvicted = (e?: Event): void =>')
    expect(imageEviction).toMatch(/entry\?\.targets/)
    expect(imageEviction.indexOf('#revokeReadinessForRepair(label)'))
      .toBeLessThan(imageEviction.indexOf('#enqueueBake(target.headSig'))

    const labelEviction = memberBody('readonly #onLabelAtlasEvicted = (e?: Event): void =>')
    expect(labelEviction.indexOf('#revokeReadinessForRepair(branch)'))
      .toBeLessThan(labelEviction.indexOf('#enqueueBake(headSig'))
  })
})
