import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const BEE = readFileSync(join(__dirname, 'agent-bee.drone.ts'), 'utf8')
const TILES = readFileSync(join(__dirname, '../tiles/show-cell.drone.ts'), 'utf8')
const BOOT = readFileSync(
  join(__dirname, '../../../../../hypercomb-shared/core/bootstrap-history.ts'),
  'utf8',
)

describe('startup render priority', () => {
  it('subscribes to first paint before navigation and awaits it before pulsing bees', () => {
    const barrier = BOOT.indexOf('const firstTilePaint = this.awaitFirstTilePaint(targetLocationKey)')
    const navigation = BOOT.indexOf('this.dispatchPopState()')
    const wait = BOOT.indexOf('await firstTilePaint')
    const pulse = BOOT.indexOf("await this.encounter(preloader, '')")

    expect(barrier).toBeGreaterThan(-1)
    expect(barrier).toBeLessThan(navigation)
    expect(wait).toBeGreaterThan(navigation)
    expect(wait).toBeLessThan(pulse)
    expect(BOOT).toContain('payload?.locationKey !== targetLocationKey')
  })

  it('does not mount, seed, or animate agent bees before the matching tile pass paints', () => {
    expect(TILES).toContain("this.emitEffect('render:tiles-target', { locationKey, renderPassId })")
    expect(TILES).toContain('renderPassId: this.#tileRenderPassId')
    expect(BEE).toContain("onEffect<{ locationKey?: string; renderPassId?: number }>('render:tiles-target'")
    expect(BEE).toContain('this.#pauseForTileRender()')
    expect(BEE).toContain('Number(payload?.renderPassId ?? -1) < target.renderPassId')
    expect(BEE).toMatch(/if \(this\.#tilesPainted\) this\.#mount\(\)/)
    expect(BEE).toMatch(/onEffect<\{ settled\?: boolean; locationKey\?: string; renderPassId\?: number \}>\('render:cell-count',[\s\S]*this\.#tilesPainted = true[\s\S]*this\.#mount\(\)/)
    expect(BEE).toMatch(/if \(!this\.#app \|\| !this\.#world \|\| !this\.#tilesPainted\) return/)
    expect(BEE).toContain('this.#app.ticker.remove(this.#onTick)')
  })
})
