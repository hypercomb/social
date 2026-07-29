import { chromium } from 'playwright'

const url = process.env.HYPERCOMB_TEST_URL || 'http://localhost:4251'
const branchCount = Number(process.env.BRANCH_COUNT || 6)
const childrenPerBranch = Number(process.env.CHILDREN_PER_BRANCH || 8)
const rounds = Number(process.env.ROUNDS || 3)
const branchNames = [
  'dolphin', 'orca', 'whale', 'seal', 'otter',
  'narwhal', 'beluga', 'porpoise', 'manta', 'shark',
].slice(0, branchCount)
if (branchNames.length !== branchCount) throw new Error('BRANCH_COUNT exceeds the named stress branches')

const childrenByBranch = Object.fromEntries(branchNames.map(branch => [
  branch,
  Array.from({ length: childrenPerBranch }, (_, index) => `${branch}-child-${String(index).padStart(2, '0')}`),
]))

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const context = await browser.newContext()
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', error => pageErrors.push(String(error)))

const waitForLabels = async (labels, timeout = 30_000) => {
  await page.waitForFunction(
    expected => {
      const cells = window.ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')?.renderedCells
      if (!cells) return false
      const live = new Set([...cells.values()].map(cell => cell.label))
      return expected.every(label => live.has(label))
    },
    labels,
    { timeout },
  )
}

try {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => !!window.ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')?.pixiRenderer,
    undefined,
    { timeout: 60_000 },
  )

  // Build several real destinations. This is intentionally a busy root: while
  // one branch is ready and clicked, the idle preloader is still preparing the
  // others—the case the single-Dolphin regression could not exercise.
  for (const branch of branchNames) {
    for (const child of childrenByBranch[branch]) {
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
      }, { text: `${branch}/${child}`, child })
      await page.waitForTimeout(500)
    }
  }
  await page.waitForTimeout(2_000)
  await waitForLabels(branchNames)

  // Capture readiness and continuous event-loop responsiveness. A batched
  // label/image bake shows up here as timer drift even before a click task gets
  // a chance to execute.
  await page.evaluate(() => {
    window.__preloadStressCells = null
    window.__preloadStressMaxDrift = 0
    window.__hypercombEffectBus.on('render:cell-count', payload => {
      window.__preloadStressCells = payload
    })
    window.__hypercombEffectBus.on('render:tile-readiness', payload => {
      const previous = window.__preloadStressCells
      if (previous) window.__preloadStressCells = { ...previous, shadedLabels: payload?.shadedLabels ?? [] }
    })
    let expected = performance.now() + 10
    window.__preloadStressTimer = setInterval(() => {
      const now = performance.now()
      window.__preloadStressMaxDrift = Math.max(window.__preloadStressMaxDrift, now - expected)
      expected = now + 10
    }, 10)
    window.ioc.get('@diamondcoreprocessor.com/ShowCellDrone').requestRender()
  })

  const waitUntilReady = async branch => {
    await page.waitForFunction(
      label => {
        const payload = window.__preloadStressCells
        return payload?.branchLabels?.includes(label) && !payload?.shadedLabels?.includes(label)
      },
      branch,
      { timeout: 30_000 },
    )
  }

  const enterAndPaint = async (branch, expected) => page.evaluate(
    async ({ branch, expected }) => {
      const renderer = window.ioc.get('@diamondcoreprocessor.com/ShowCellDrone')
      const canvas = document.querySelector('canvas')
      const cell = renderer.renderedCells.get(branch)
      if (!canvas || !cell) throw new Error(`Click target unavailable: ${branch}`)
      const spacing = 38
      const local = {
        x: Math.sqrt(3) * spacing * (cell.q + cell.r / 2),
        y: spacing * 1.5 * cell.r,
      }
      const point = renderer.hexMesh.toGlobal(local)
      const rect = canvas.getBoundingClientRect()
      const start = performance.now()
      const init = {
        bubbles: true,
        clientX: rect.left + point.x * (rect.width / canvas.width),
        clientY: rect.top + point.y * (rect.height / canvas.height),
        pointerId: 800 + Math.floor(start),
        pointerType: 'mouse',
      }
      canvas.dispatchEvent(new PointerEvent('pointerdown', init))
      canvas.dispatchEvent(new PointerEvent('pointerup', init))
      canvas.dispatchEvent(new MouseEvent('click', init))
      while (performance.now() - start < 5_000) {
        const live = new Set([...renderer.renderedCells.values()].map(item => item.label))
        if (expected.every(label => live.has(label))) {
          await new Promise(resolve => requestAnimationFrame(resolve))
          return performance.now() - start
        }
        await new Promise(resolve => setTimeout(resolve, 2))
      }
      throw new Error(`Timed out entering ${branch}`)
    },
    { branch, expected },
  )

  const backAndPaint = async () => page.evaluate(async expected => {
    const lineage = window.ioc.get('@hypercomb.social/Lineage')
    const renderer = window.ioc.get('@diamondcoreprocessor.com/ShowCellDrone')
    const start = performance.now()
    lineage.explorerUp()
    while (performance.now() - start < 5_000) {
      const live = new Set([...renderer.renderedCells.values()].map(item => item.label))
      if (expected.every(label => live.has(label))) {
        await new Promise(resolve => requestAnimationFrame(resolve))
        return performance.now() - start
      }
      await new Promise(resolve => setTimeout(resolve, 2))
    }
    throw new Error('Timed out returning to stress root')
  }, branchNames)

  const entries = []
  const backs = []
  for (let round = 0; round < rounds; round++) {
    for (const branch of branchNames) {
      await waitUntilReady(branch)
      entries.push(await enterAndPaint(branch, childrenByBranch[branch]))
      backs.push(await backAndPaint())
    }
  }

  const responsiveness = await page.evaluate(() => {
    clearInterval(window.__preloadStressTimer)
    return window.__preloadStressMaxDrift
  })
  const roundedEntries = entries.map(Math.round)
  const roundedBacks = backs.map(Math.round)
  const maxEntryMs = Math.max(...roundedEntries)
  const maxBackMs = Math.max(...roundedBacks)
  if (maxEntryMs > 50) throw new Error(`Ready branch missed the next painted frame: ${roundedEntries.join(', ')}`)
  if (maxBackMs > 50) throw new Error(`Back transition missed the next painted frame: ${roundedBacks.join(', ')}`)
  if (responsiveness > 50) throw new Error(`Background preload blocked the main thread for ${Math.round(responsiveness)}ms`)
  if (pageErrors.length) throw new Error(pageErrors.join('\n'))

  console.log('PASS preload interactivity:', JSON.stringify({
    branchCount,
    childrenPerBranch,
    rounds,
    transitions: entries.length + backs.length,
    maxEntryMs,
    maxBackMs,
    maxEventLoopDriftMs: Math.round(responsiveness),
    entries: roundedEntries,
    backs: roundedBacks,
  }))
} finally {
  await browser.close()
}
