import { chromium } from 'playwright'

const url = process.env.HYPERCOMB_TEST_URL || 'http://localhost:4251'
const cycles = Number(process.env.CYCLES || 8)
const evictEvery = Number(process.env.EVICT_EVERY || 0)
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const context = await browser.newContext()
if (process.env.DIAG === '1') {
  await context.addInitScript(() => localStorage.setItem('hc:diag', '1'))
}
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(String(error)))
if (process.env.DIAG === '1') {
  page.on('console', message => {
    const text = message.text()
    if (/diag:readiness|stress:atlas|^\[nav\]/.test(text)) console.log('[page]', text)
  })
}

const waitForLabels = async (expected, timeout = 20_000) => {
  await page.waitForFunction(
    labels => {
      const cells = window.ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')?.renderedCells
      if (!cells) return false
      const live = new Set([...cells.values()].map(cell => cell.label))
      return labels.every(label => live.has(label))
    },
    expected,
    { timeout },
  )
}

const navigateAndMeasure = async (direction, expected) => page.evaluate(
  async ({ direction, expected }) => {
    const lineage = window.ioc.get('@hypercomb.social/Lineage')
    const renderer = window.ioc.get('@diamondcoreprocessor.com/ShowCellDrone')
    const start = performance.now()
    if (direction === 'in') {
      // Real canvas gesture through TileOverlayDrone, not a programmatic
      // lineage shortcut. This simultaneously verifies the readiness gate and
      // measures the participant's actual click-to-paint latency.
      const canvas = document.querySelector('canvas')
      const cell = renderer.renderedCells.get('dolphin')
      const point = renderer.hexMesh?.toGlobal?.({ x: 0, y: 0 })
      if (!canvas || !cell || !point) throw new Error('Dolphin click target unavailable')
      const rect = canvas.getBoundingClientRect()
      const init = {
        bubbles: true,
        clientX: rect.left + point.x * (rect.width / canvas.width),
        clientY: rect.top + point.y * (rect.height / canvas.height),
        pointerId: 700 + Math.floor(start),
        pointerType: 'mouse',
      }
      canvas.dispatchEvent(new PointerEvent('pointerdown', init))
      canvas.dispatchEvent(new PointerEvent('pointerup', init))
      canvas.dispatchEvent(new MouseEvent('click', init))
    } else {
      lineage.explorerUp()
    }
    while (performance.now() - start < 5_000) {
      const live = new Set([...renderer.renderedCells.values()].map(cell => cell.label))
      if (expected.every(label => live.has(label))) {
        // Internal state is not the finish line. Pixi's ticker was registered
        // before this test callback, so the next animation frame includes the
        // draw becoming visible rather than merely the cells map changing.
        await new Promise(resolve => requestAnimationFrame(resolve))
        return { ms: performance.now() - start, locationKey: renderer.renderedLocationKey }
      }
      await new Promise(resolve => setTimeout(resolve, 4))
    }
    throw new Error(`Timed out navigating ${direction}`)
  },
  { direction, expected },
)

try {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => !!window.ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')?.pixiRenderer,
    undefined,
    { timeout: 60_000 },
  )

  const children = Array.from({ length: 12 }, (_, index) => `calf-${String(index).padStart(2, '0')}`)
  for (const child of children) {
    await page.evaluate(async ({ text, child }) => {
      const bus = window.__hypercombEffectBus
      await new Promise((resolve, reject) => {
        let off = () => {}
        const timer = setTimeout(() => {
          off()
          reject(new Error(`Timed out creating ${child}`))
        }, 10_000)
        off = bus.on('cell:added', payload => {
          if (payload?.cell !== child) return
          clearTimeout(timer)
          off()
          resolve()
        })
        bus.emit('command-line:remote-submit', { text })
      })
    }, { text: `dolphin/${child}`, child })
    // The incremental event precedes the async history commit. Keep setup
    // sequential so the next command cannot race the previous layer head.
    await page.waitForTimeout(500)
  }
  // Allow the last history/head cascade to settle before accepting a
  // readiness replay. Otherwise an intermediate head can be briefly ready
  // while the final child commit is still replacing it.
  await page.waitForTimeout(2_000)
  await waitForLabels(['dolphin'])

  // A first-boot offer may have opened while the initially empty root was
  // settling. The moment a real tile paints, that empty-page surface must
  // yield the canvas; otherwise the renderer is healthy but every tile is
  // trapped behind a still-mounted modal.
  await page.waitForFunction(
    () => !document.querySelector('hc-example-hives-offer .offer-card'),
    undefined,
    { timeout: 5_000 },
  )

  // Destructive-key regression: Delete/Backspace is selection-only. Merely
  // hovering a tile must not remove it; the single-tile path is the explicit
  // trash icon in the tile overlay.
  const dolphinPoint = await page.evaluate(() => {
    const renderer = window.ioc.get('@diamondcoreprocessor.com/ShowCellDrone')
    const selection = window.ioc.get('@diamondcoreprocessor.com/SelectionService')
    selection?.clear?.()
    const canvas = document.querySelector('canvas')
    const cell = renderer?.renderedCells?.get?.('dolphin')
    const point = renderer?.hexMesh?.toGlobal?.({ x: 0, y: 0 })
    if (!canvas || !cell || !point) throw new Error('Dolphin hover target unavailable')
    const rect = canvas.getBoundingClientRect()
    return {
      x: rect.left + point.x * (rect.width / canvas.width),
      y: rect.top + point.y * (rect.height / canvas.height),
    }
  })
  await page.mouse.move(dolphinPoint.x, dolphinPoint.y)
  await page.keyboard.press('Delete')
  await page.waitForTimeout(250)
  await waitForLabels(['dolphin'])
  // Leave the overlay before the navigation probe below. That probe targets
  // the tile body; keeping the real pointer over its expanded icon band would
  // correctly let the overlay capture the synthetic press instead.
  await page.mouse.move(0, 0)

  // Wait for the renderer's real readiness proof, not an arbitrary delay.
  await page.evaluate(async () => {
    const bus = window.__hypercombEffectBus
    await new Promise((resolve, reject) => {
      let off = () => {}
      const timer = setTimeout(() => {
        off()
        reject(new Error('Dolphin never reached ready state'))
      }, 30_000)
      off = bus.on('render:cell-count', payload => {
        if (!payload?.labels?.includes('dolphin')) return
        if (!payload?.branchLabels?.includes('dolphin')) return
        if (payload?.shadedLabels?.includes('dolphin')) return
        clearTimeout(timer)
        off()
        resolve()
      })
      // Do not depend on having subscribed before the settling emit.
      window.ioc.get('@diamondcoreprocessor.com/ShowCellDrone').requestRender()
    })
  })

  const samples = []
  for (let index = 0; index < cycles; index++) {
    const into = await navigateAndMeasure('in', children)
    const back = await navigateAndMeasure('back', ['dolphin'])
    samples.push({
      cycle: index + 1,
      intoMs: Math.round(into.ms),
      backMs: Math.round(back.ms),
      intoKey: into.locationKey,
      backKey: back.locationKey,
    })
    // Deliberately below the old 4-second cooldown.
    await page.waitForTimeout(120)

    // Force the shared label atlas past capacity. The default regression does
    // this once; stress runs can set EVICT_EVERY to repeat it. Each generation
    // uses unique labels so it genuinely reuses slots instead of hitting the
    // atlas cache. Readiness must revoke, repair the exact target, and keep the
    // next click hot every time.
    const shouldEvict = evictEvery > 0
      ? (index + 1) % evictEvery === 0 && index < cycles - 1
      : index === 1
    if (shouldEvict) {
      await page.evaluate(async churnGeneration => {
        const bus = window.__hypercombEffectBus
        const renderer = window.ioc.get('@diamondcoreprocessor.com/ShowCellDrone')
        await new Promise((resolve, reject) => {
          let sawRevocation = false
          let exercisingColdClick = false
          let atlasState = 'not churned'
          let latestLabels = []
          let latestShaded = []
          let offReadiness = () => {}
          let offCells = () => {}
          const finish = (error) => {
            clearTimeout(timer)
            offReadiness()
            offCells()
            if (error) reject(error)
            else resolve()
          }
          const waitUntil = async (predicate, description, timeout = 8_000) => {
            const started = performance.now()
            while (performance.now() - started < timeout) {
              if (predicate()) return
              await new Promise(done => setTimeout(done, 8))
            }
            throw new Error(`Timed out ${description}`)
          }
          const timer = setTimeout(() => {
            finish(new Error(`Dolphin readiness did not recover after atlas eviction (${atlasState})`))
          }, 15_000)
          const observe = payload => {
            const shaded = payload?.shadedLabels ?? []
            if (Array.isArray(payload?.shadedLabels)) latestShaded = shaded
            if (localStorage.getItem('hc:diag') === '1') {
              console.log('[diag:readiness-event]', shaded.join(','))
            }
            if (shaded.includes('dolphin') && !exercisingColdClick) {
              // While eviction has legitimately revoked readiness, exercise
              // the real canvas click. A cold click is ALLOWED: it diverts
              // preload priority to this target, navigates, and accepts the
              // honest delay represented by the shade.
              const canvas = document.querySelector('canvas')
              const point = renderer.hexMesh?.toGlobal?.({ x: 0, y: 0 })
              if (!canvas || !point) {
                finish(new Error('Dolphin cold-click target unavailable'))
                return
              }
              exercisingColdClick = true
              sawRevocation = true
              const rect = canvas.getBoundingClientRect()
              const init = {
                bubbles: true,
                clientX: rect.left + point.x * (rect.width / canvas.width),
                clientY: rect.top + point.y * (rect.height / canvas.height),
                pointerId: 991,
                pointerType: 'mouse',
              }
              canvas.dispatchEvent(new PointerEvent('pointerdown', init))
              canvas.dispatchEvent(new PointerEvent('pointerup', init))
              canvas.dispatchEvent(new MouseEvent('click', init))
              const lineage = window.ioc.get('@hypercomb.social/Lineage')
              const targetNames = Array.from({ length: 12 }, (_, n) => `calf-${String(n).padStart(2, '0')}`)
              void (async () => {
                try {
                  await waitUntil(
                    () => lineage.explorerSegments().join('/') === 'dolphin'
                      && targetNames.every(name => renderer.renderedCells.has(name)),
                    'for the diverted cold click to paint /dolphin',
                  )
                  lineage.explorerUp()
                  await waitUntil(
                    () => lineage.explorerSegments().length === 0
                      && latestLabels.includes('dolphin')
                      && !latestShaded.includes('dolphin'),
                    'for Dolphin readiness to repair after returning',
                  )
                  finish()
                } catch (error) {
                  finish(error)
                }
              })()
              return
            }
            if (!sawRevocation || exercisingColdClick) return
            finish()
          }
          offReadiness = bus.on('render:tile-readiness', observe)
          offCells = bus.on('render:cell-count', payload => {
            if (Array.isArray(payload?.labels)) latestLabels = payload.labels
            if (!payload?.labels?.includes('dolphin')) return
            observe(payload)
          })
          const targetNames = Array.from({ length: 12 }, (_, n) => `calf-${String(n).padStart(2, '0')}`)
          const before = targetNames.filter(name => renderer.atlas.hasLabel(name)).length
          renderer.atlas.seed(Array.from(
            { length: 320 },
            (_, n) => `churn-${churnGeneration}-${n}`,
          ))
          const after = targetNames.filter(name => renderer.atlas.hasLabel(name)).length
          atlasState = `target labels ${before}/12 before, ${after}/12 after`
          console.log('[stress:atlas]', atlasState)
        })
      }, index)
    }
  }

  const entries = samples.map(sample => sample.intoMs)
  const maxEntryMs = Math.max(...entries)
  if (maxEntryMs > 80) {
    throw new Error(`Preloaded Dolphin painted-frame entry exceeded 80ms: ${JSON.stringify(samples)}`)
  }
  if (errors.length) throw new Error(errors.join('\n'))
  const ordered = [...entries].sort((a, b) => a - b)
  const percentile = value => ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * value))]
  console.log('PASS repeat navigation:', JSON.stringify({
    cycles,
    evictEvery,
    firstEntryMs: entries[0],
    minEntryMs: ordered[0],
    p50EntryMs: percentile(0.50),
    p95EntryMs: percentile(0.95),
    maxEntryMs,
    samples: cycles <= 20 ? samples : undefined,
  }))
} finally {
  await browser.close()
}
