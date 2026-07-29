import { chromium } from 'playwright'

const url = process.env.HYPERCOMB_TEST_URL || 'http://localhost:4251'
const limitMs = Number(process.env.MUTATION_FRAME_LIMIT_MS || 50)
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const context = await browser.newContext()
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', error => pageErrors.push(String(error)))

try {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => {
      const renderer = window.ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')
      const axial = window.ioc?.get?.('@diamondcoreprocessor.com/AxialService')
      return !!renderer?.pixiRenderer && !!renderer?.renderedLocationKey && !!axial?.items
    },
    undefined,
    { timeout: 60_000 },
  )

  const result = await page.evaluate(async () => {
    const bus = window.__hypercombEffectBus
    const renderer = window.ioc.get('@diamondcoreprocessor.com/ShowCellDrone')
    const lineage = window.ioc.get('@hypercomb.social/Lineage')
    const segments = [...(lineage.explorerSegments?.() ?? [])]
    const cell = `instant-mutation-${Date.now().toString(36)}`
    const timeline = []
    const epoch = performance.now()
    const mark = (event, detail = '') => timeline.push({
      at: Math.round(performance.now() - epoch),
      event,
      detail,
    })
    const longTasks = []
    const longTaskObserver = typeof PerformanceObserver === 'function'
      ? new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          longTasks.push({
            at: Math.round(entry.startTime - epoch),
            duration: Math.round(entry.duration),
          })
        }
      })
      : null
    try { longTaskObserver?.observe({ type: 'longtask', buffered: true }) } catch {}
    const offCells = bus.on('render:cell-count', payload => {
      if (payload?.labels?.includes(cell)) mark('cell-count', 'present')
      else mark('cell-count', 'absent')
    })
    const offMutation = bus.on('cell:mutation-state', payload => {
      if (payload?.cell === cell) mark('mutation', `${payload.op}:${payload.state}`)
    })
    const originalApply = renderer.applyGeometry.bind(renderer)
    renderer.applyGeometry = cells => {
      mark('apply-geometry', cells.some(item => item.label === cell) ? 'present' : 'absent')
      return originalApply(cells)
    }
    const originalLabelUv = renderer.atlas.getLabelUV.bind(renderer.atlas)
    renderer.atlas.getLabelUV = label => {
      const start = performance.now()
      const value = originalLabelUv(label)
      mark('label-uv', `${label}:${Math.round(performance.now() - start)}ms`)
      return value
    }
    const originalBuildGeometry = renderer.buildFillQuadGeometry.bind(renderer)
    renderer.buildFillQuadGeometry = (...args) => {
      const start = performance.now()
      const value = originalBuildGeometry(...args)
      mark('build-geometry', `${Math.round(performance.now() - start)}ms`)
      return value
    }

    const settled = op => new Promise((resolve, reject) => {
      let off = () => {}
      const timer = setTimeout(() => {
        off()
        reject(new Error(`${op} did not settle`))
      }, 15_000)
      off = bus.on('cell:mutation-state', payload => {
        if (payload?.cell !== cell || payload?.op !== op) return
        if (payload?.state === 'pending') return
        clearTimeout(timer)
        off()
        if (payload?.state === 'failed') reject(new Error(`${op} commit failed`))
        else resolve()
      })
    })

    const paintedMembership = async present => {
      const start = performance.now()
      while (performance.now() - start < 5_000) {
        const found = renderer.renderedCells.has(cell)
        if (found === present) {
          // Pixi's ticker runs before this callback. The frame therefore
          // includes the geometry produced by the membership event.
          await new Promise(resolve => requestAnimationFrame(resolve))
          mark('painted-frame', present ? 'present' : 'absent')
          return performance.now() - start
        }
        await new Promise(resolve => setTimeout(resolve, 1))
      }
      throw new Error(`cell never became ${present ? 'visible' : 'absent'}`)
    }

    const addSettled = settled('add')
    const addStart = performance.now()
    mark('emit-add')
    bus.emit('cell:added', { cell, segments })
    const addEmitMs = performance.now() - addStart
    const addPaintMs = await paintedMembership(true)
    const addMs = addEmitMs + addPaintMs
    await addSettled

    const removeSettled = settled('remove')
    const removeStart = performance.now()
    mark('emit-remove')
    bus.emit('cell:removed', { cell, segments })
    const removeEmitMs = performance.now() - removeStart
    const removePaintMs = await paintedMembership(false)
    const removeMs = removeEmitMs + removePaintMs
    await removeSettled
    offCells()
    offMutation()
    longTaskObserver?.disconnect()
    renderer.applyGeometry = originalApply
    renderer.atlas.getLabelUV = originalLabelUv
    renderer.buildFillQuadGeometry = originalBuildGeometry

    return {
      addMs: Math.round(addMs),
      addEmitMs: Math.round(addEmitMs),
      addPaintMs: Math.round(addPaintMs),
      removeMs: Math.round(removeMs),
      removeEmitMs: Math.round(removeEmitMs),
      removePaintMs: Math.round(removePaintMs),
      cell,
      timeline,
      longTasks,
    }
  })

  console.log('Instant mutation sample:', JSON.stringify(result))
  if (result.addMs > limitMs) {
    throw new Error(`Optimistic add missed the next painted frame: ${result.addMs}ms`)
  }
  if (result.removeMs > limitMs) {
    throw new Error(`Optimistic remove missed the next painted frame: ${result.removeMs}ms`)
  }
  if (pageErrors.length) throw new Error(pageErrors.join('\n'))

  console.log('PASS instant cell mutations:', JSON.stringify({ limitMs, ...result }))
} finally {
  await browser.close()
}
