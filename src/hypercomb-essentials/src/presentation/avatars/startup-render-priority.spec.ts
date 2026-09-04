import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const BEE = readFileSync(join(__dirname, 'agent-bee.drone.ts'), 'utf8')
const TILES = readFileSync(join(__dirname, '../tiles/show-cell.drone.ts'), 'utf8')
const BOOT = readFileSync(
  join(__dirname, '../../../../hypercomb-shared/core/bootstrap-history.ts'),
  'utf8',
)
const DEV_APP = readFileSync(
  join(__dirname, '../../../../hypercomb-dev/src/app/app.ts'),
  'utf8',
)
const DEV_MAIN = readFileSync(
  join(__dirname, '../../../../hypercomb-dev/src/main.ts'),
  'utf8',
)
const PRELOADER = readFileSync(
  join(__dirname, '../../../../hypercomb-runtime/src/script-preloader.ts'),
  'utf8',
)
const BARRIER = readFileSync(
  join(__dirname, '../../../../hypercomb-shared/core/first-tile-paint.ts'),
  'utf8',
)
const PREPARE = readFileSync(
  join(__dirname, '../../../scripts/prepare.ts'),
  'utf8',
)
const PACKED_BRIDGE = readFileSync(
  join(__dirname, '../../../../hypercomb-runtime/src/packed-bridge.ts'),
  'utf8',
)
const PACKED_WORKER = readFileSync(
  join(__dirname, '../../../../hypercomb-runtime/src/packed-store.worker.ts'),
  'utf8',
)

describe('startup render priority', () => {
  it('subscribes to first paint before navigation and awaits it before pulsing bees', () => {
    const barrier = BOOT.indexOf('const firstTilePaint = awaitFirstTilePaint(targetLocationKey)')
    const navigation = BOOT.indexOf('this.dispatchPopState()')
    const wait = BOOT.indexOf('await firstTilePaint')
    const pulse = BOOT.indexOf("await this.encounter(preloader, '')")

    expect(barrier).toBeGreaterThan(-1)
    expect(barrier).toBeLessThan(navigation)
    expect(wait).toBeGreaterThan(navigation)
    expect(wait).toBeLessThan(pulse)
    expect(BOOT).toContain("import { awaitFirstTilePaint } from './first-tile-paint'")
    expect(BARRIER).toContain("payload?.settled !== true || payload?.locationKey !== targetLocationKey")
    expect(TILES).toContain("{ ...this.#buildCellCountPayload(cells), settled: final }")
  })

  it('keeps ONE barrier, and that barrier always opens', () => {
    // Two shells, one waiting rule. A second copy is how the give-up valve
    // gets fixed in one shell and stays broken in the other.
    expect(BOOT).not.toContain("EffectBus.on<{ settled?: boolean; locationKey?: string }>('render:cell-count'")
    expect(DEV_APP).not.toContain("EffectBus.on<{ settled?: boolean; locationKey?: string }>('render:cell-count'")

    // The frame that never comes: give up on renderer SILENCE, not on a wall
    // clock, and never wait past the ceiling however noisy the page is.
    expect(BARRIER).toContain('FIRST_TILE_PAINT_SILENCE_MS')
    expect(BARRIER).toContain('FIRST_TILE_PAINT_CEILING_MS')
    expect(BARRIER).toContain('ceilingMs - (Date.now() - startedAt)')
    // Proof of life re-arms the valve BEFORE the payload is judged.
    expect(BARRIER.indexOf('arm()')).toBeLessThan(BARRIER.indexOf('payload?.settled !== true ||'))

    // The handoff that never runs: a hidden tab is never served an animation
    // frame, so the frame is raced by a timer and cannot strand the barrier.
    expect(BARRIER).toContain('requestAnimationFrame(() => release())')
    expect(BARRIER).toContain('setTimeout(release, frameMs)')
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
    const barrier = DEV_APP.indexOf('const firstTilePaint = awaitFirstTilePaint(')
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
    expect(DEV_APP).toContain("import { awaitFirstTilePaint } from '@hypercomb/shared/core/first-tile-paint'")
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
