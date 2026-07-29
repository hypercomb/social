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
      return !!renderer?.pixiRenderer && !!axial?.items
    },
    undefined,
    { timeout: 60_000 },
  )
  // The invariant starts once the window has actually presented. IoC/renderer
  // registration happens earlier than the first compositor frame.
  await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(resolve))
    await new Promise(resolve => requestAnimationFrame(resolve))
  })

  const result = await page.evaluate(async () => {
    const bus = window.__hypercombEffectBus
    const renderer = window.ioc.get('@diamondcoreprocessor.com/ShowCellDrone')
    const lineage = window.ioc.get('@hypercomb.social/Lineage')
    const segments = [...(lineage.explorerSegments?.() ?? [])]
    const cell = `instant-mutation-${Date.now().toString(36)}`

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
          const membershipMs = performance.now() - start
          // Pixi's ticker runs before this callback. The frame therefore
          // includes the geometry produced by the membership event.
          const frameStart = performance.now()
          await new Promise(resolve => requestAnimationFrame(resolve))
          return {
            totalMs: performance.now() - start,
            membershipMs,
            frameMs: performance.now() - frameStart,
          }
        }
        await new Promise(resolve => setTimeout(resolve, 1))
      }
      throw new Error(`cell never became ${present ? 'visible' : 'absent'}`)
    }

    const addSettled = settled('add')
    const addStart = performance.now()
    bus.emit('cell:added', { cell, segments })
    const addEmitMs = performance.now() - addStart
    const addPaint = await paintedMembership(true)
    const addMs = addEmitMs + addPaint.totalMs
    await addSettled

    const removeSettled = settled('remove')
    const removeStart = performance.now()
    bus.emit('cell:removed', { cell, segments })
    const removeEmitMs = performance.now() - removeStart
    const removePaint = await paintedMembership(false)
    const removeMs = removeEmitMs + removePaint.totalMs
    await removeSettled

    return {
      addMs: Math.round(addMs),
      addEmitMs: Math.round(addEmitMs),
      addMembershipMs: Math.round(addPaint.membershipMs),
      addFrameMs: Math.round(addPaint.frameMs),
      removeMs: Math.round(removeMs),
      removeEmitMs: Math.round(removeEmitMs),
      removeMembershipMs: Math.round(removePaint.membershipMs),
      removeFrameMs: Math.round(removePaint.frameMs),
      cell,
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
