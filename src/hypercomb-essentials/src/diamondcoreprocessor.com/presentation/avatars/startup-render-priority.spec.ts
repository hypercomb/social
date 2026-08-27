import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const BEE = readFileSync(join(__dirname, 'agent-bee.drone.ts'), 'utf8')
const TILES = readFileSync(join(__dirname, '../tiles/show-cell.drone.ts'), 'utf8')
const BOOT = readFileSync(
  join(__dirname, '../../../../../hypercomb-shared/core/bootstrap-history.ts'),
  'utf8',
)
const DEV_APP = readFileSync(
  join(__dirname, '../../../../../hypercomb-dev/src/app/app.ts'),
  'utf8',
)
const DEV_MAIN = readFileSync(
  join(__dirname, '../../../../../hypercomb-dev/src/main.ts'),
  'utf8',
)
const PRELOADER = readFileSync(
  join(__dirname, '../../../../../hypercomb-shared/core/script-preloader.ts'),
  'utf8',
)
const PREPARE = readFileSync(
  join(__dirname, '../../../../scripts/prepare.ts'),
  'utf8',
)
const PACKED_BRIDGE = readFileSync(
  join(__dirname, '../../../../../hypercomb-shared/core/packed-bridge.ts'),
  'utf8',
)
const PACKED_WORKER = readFileSync(
  join(__dirname, '../../../../../hypercomb-shared/core/packed-store.worker.ts'),
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
    expect(BOOT).toContain('payload?.settled !== true')
    expect(TILES).toContain("{ ...this.#buildCellCountPayload(cells), settled: final }")
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

  it('keeps per-child head repair behind the current-layer paint', () => {
    expect(TILES).toContain('freshenBranchesAfterPaint(out)')
    expect(TILES).toContain("requestIdleCallback?: (cb: () => void")
    expect(TILES).toContain('onBranchesFreshened: fresh =>')
    expect(TILES).toContain('Array.isArray(entry.layer.children) && entry.layer.children.length > 0')
    expect(TILES).not.toContain('await freshenBranches(out)')
  })

  it('does not let the dev processor resolver walk OPFS before first paint', () => {
    const barrier = DEV_APP.indexOf('const firstTilePaint = this.awaitFirstTilePaint()')
    const direct = DEV_APP.indexOf('preloader?.useRegisteredBees?.(values)')
    const pulse = DEV_APP.indexOf('renderFirst.map(')
    const wait = DEV_APP.indexOf('await firstTilePaint')
    const act = DEV_APP.indexOf("await new hypercomb().act('')")
    const background = DEV_APP.indexOf('afterPaint.map(')

    expect(barrier).toBeGreaterThan(-1)
    expect(direct).toBeGreaterThan(barrier)
    expect(direct).toBeLessThan(pulse)
    expect(wait).toBeGreaterThan(pulse)
    expect(wait).toBeLessThan(act)
    expect(background).toBeGreaterThan(act)
    expect(DEV_APP).toContain('RENDER_FIRST_KEYS')
    expect(DEV_APP).toContain("'@diamondcoreprocessor.com/PixiHostWorker'")
    expect(DEV_APP).toContain("'@diamondcoreprocessor.com/ShowCellDrone'")
    expect(DEV_APP).toContain("payload?.settled !== true || payload?.locationKey !== targetLocationKey")
    expect(PRELOADER).toContain('if (this.#registeredBees)')
    expect(PRELOADER).toMatch(/if \(this\.#registeredBees\) \{[\s\S]*return \[\]/)
    expect(PRELOADER).toContain('OPFS module walk skipped')
  })

  it('keeps the generated side-effect entrypoint present during regeneration', () => {
    const cleanStart = PREPARE.indexOf('const preClean = () =>')
    const cleanEnd = PREPARE.indexOf('// export parsing', cleanStart)
    const clean = PREPARE.slice(cleanStart, cleanEnd)

    expect(clean).toContain("join(SRC_ROOT, 'side-effects.ts')")
    expect(clean).toContain('if (preservedRootOutputs.has(file)) continue')
    expect(clean.indexOf('if (preservedRootOutputs.has(file)) continue'))
      .toBeLessThan(clean.indexOf('rmSync(file'))
    expect(DEV_APP).toContain("import '../../../hypercomb-essentials/src/side-effects'")
  })

  it('shows a recoverable error when storage fails before Angular bootstrap', () => {
    expect(DEV_MAIN).toContain('const renderBootFailure = (error: unknown): void =>')
    expect(DEV_MAIN).toContain("document.getElementById('hc-splash')?.remove()")
    expect(DEV_MAIN).toContain("retry.addEventListener('click', () => window.location.reload())")
    expect(DEV_MAIN).toMatch(/main\(\)\.catch\(err => \{[\s\S]*renderBootFailure\(err\)/)
  })

  it('releases packed-store ownership when opening the restored pack fails', () => {
    expect(PACKED_BRIDGE).toMatch(/catch \(error\) \{[\s\S]*bridge\?\.terminate\(\)[\s\S]*return null/)
    expect(PACKED_WORKER).toMatch(/PackedStoreEngine\.open[\s\S]*catch \(error\) \{[\s\S]*this\.#handle\.close\(\)[\s\S]*throw error/)
  })
})
