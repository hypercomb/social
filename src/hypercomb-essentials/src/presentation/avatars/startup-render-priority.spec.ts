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

  it('keeps agent bees behind the paint barrier: deaf until pulsed, mounted once, seeded late', () => {
    // WHAT THIS USED TO ASSERT, AND WHY IT DOESN'T ANY MORE. The bee drone
    // once carried the gate itself: it watched `render:tiles-target`, tore its
    // own ticker down (`#pauseForTileRender`), and mounted only when a
    // `render:cell-count` arrived carrying that pass id or better. e5be06adc
    // deleted all of it. The PER-NAVIGATION half is gone deliberately — bees
    // now keep flying across a layer change, and there is nothing left in the
    // drone that re-paints them against a pass verdict.
    //
    // The STARTUP half survived by moving UP: the drone never subscribes to
    // anything until the processor pulses it, and the processor cannot reach
    // it until the first-tile-paint barrier opens (asserted above). What
    // follows is that mechanism — every step of it, so a change that puts the
    // bees back on the boot path fails here rather than in a profile.

    // The pass identity is still published. Its consumer today is
    // SequenceCycleDrone (sequence/arrange-after-paint.spec.ts, which drives
    // the effect synthetically) — so this is the only guard left that the
    // renderer still emits it at all.
    expect(TILES).toContain("this.emitEffect('render:tiles-target', { locationKey, renderPassId })")
    expect(TILES).toContain('renderPassId: this.#tileRenderPassId')

    // DEAF UNTIL PULSED. Every subscription is taken in `heartbeat`, never at
    // module load — so EffectBus's last-value replay of `render:host-ready`
    // cannot reach a drone the processor has not started yet.
    expect(BEE).toMatch(/override heartbeat = async \(\): Promise<void> => \{\s*this\.#ensureEffects\(\)/)
    expect(BEE).toMatch(/#ensureEffects = \(\): void => \{\s*if \(this\.#effectsRegistered\) return/)

    // ONE WAY IN. The layer, the registry listeners, the ticker and the
    // pointer listeners are all raised by `#mount`, and `#mount` is reachable
    // from exactly one place: the host-ready handler, inside those effects.
    expect(BEE.match(/this\.#mount\(\)/g) ?? []).toHaveLength(1)
    expect(BEE).toMatch(/onEffect<HostReadyPayload>\('render:host-ready'[\s\S]{0,400}?this\.#mount\(\)/)
    expect(BEE).toContain('if (!this.#app || !this.#world) return')

    // NOT IN THE RENDER-FIRST COHORT. This is what actually holds the drone
    // behind the barrier: the shell pulses the three render keys before the
    // barrier and everything else after it, so naming the bees here would put
    // them back in front of first paint.
    const renderFirstStart = DEV_APP.indexOf('const RENDER_FIRST_KEYS')
    expect(renderFirstStart).toBeGreaterThan(-1)
    expect(DEV_APP.slice(renderFirstStart, DEV_APP.indexOf('])', renderFirstStart)))
      .not.toContain('AgentBee')

    // ANIMATION IS BOUND ONCE, AND RELEASED. One `ticker.add` in the file, and
    // it is the mount's.
    expect(BEE.match(/ticker\.add\(/g) ?? []).toHaveLength(1)
    expect(BEE).toMatch(/if \(!this\.#tickerBound\) \{[\s\S]{0,120}?this\.#app\.ticker\.add\(this\.#onTick\)/)
    expect(BEE).toContain('this.#app.ticker.remove(this.#onTick)')

    // NEITHER POOL WALK IS ON THE MOUNT PATH. The queued-ask seed and the
    // talked-to-tiles read both walk storage; mounting must not await either,
    // or the barrier opening would simply move the stall one step later.
    expect(BEE).toContain('requestIdleCallback(seed, { timeout: 4000 })')
    expect(BEE).toContain('else setTimeout(seed, 1200)')
    expect(BEE).toMatch(/setTimeout\(\(\) => \{[\s\S]{0,200}?this\.#refreshResting\(\)[\s\S]{0,40}?\}, REST_SETTLE_MS\)/)
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
