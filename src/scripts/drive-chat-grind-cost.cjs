#!/usr/bin/env node
// drive-chat-grind-cost — what a grinding chat session costs the rest of the hive.
//
//   node scripts/drive-chat-grind-cost.cjs [--url http://localhost:4450]
//
// While a session is answering over the bridge, every reply that lands is an
// event the rail hears. The question this measures is what it does about it:
// a change that NAMES its conversation reads that one bucket and folds a
// burst into a single repaint; one that does not names nothing, and the whole
// threads pool is walked — once per reply, on the same main thread the bees
// pulse on.
//
// Counting the work, not the frames: headless rAF is synthetic and says
// nothing, while every directory opened is real time the hive does not get.
//
// Expect: a burst of 8 replies is 8 pool walks the old way, 0 walks and 8
// bucket reads the new one.
const { chromium } = require('playwright')
const URL = process.argv[2] || 'http://localhost:4450'
const CONVOS = 14, TURNS = 3, BURST = 8
;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 240)))
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!window.__hypercombEffectBus, null, { timeout: 90000 })
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button'))
    .some(b => (b.innerText || '').trim() === 'Add +'), null, { timeout: 60000 }).catch(() => {})
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('button')).find(b => (b.innerText||'').trim() === 'Add +')?.click()
    try { localStorage.setItem('hypercomb.claudeBridge.enabled','1'); localStorage.setItem('hc:bridge-setup-done','1') } catch {}
  })
  await page.waitForTimeout(12000)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!window.__hypercombEffectBus, null, { timeout: 90000 })
  await page.waitForTimeout(7000)
  await page.evaluate(() => window.__hypercombEffectBus.emit('chat:open', {}))
  await page.waitForSelector('.hc-rail-group', { timeout: 60000 })
  await page.waitForTimeout(1500)

  // A hive with a real conversation history behind it.
  const ids = await page.evaluate(async ({ CONVOS, TURNS }) => {
    const threads = window.ioc.get('@diamondcoreprocessor.com/ChatThreads')
    const out = []
    for (let c = 0; c < CONVOS; c++) {
      const id = threads.tileConvoId(['honey-garden', `thread-${c}`])
      for (let t = 0; t < TURNS; t++) {
        await threads.appendTurn(id, t % 2 ? 'assistant' : 'user', `turn ${t} of thread ${c} — some words to store`)
      }
      out.push(id)
    }
    return out
  }, { CONVOS, TURNS })
  console.log('conversations seeded:', ids.length)

  // COUNT THE WORK, not the frames: headless rAF is synthetic, but every
  // directory this opens is real main-thread time the bees do not get.
  await page.evaluate(() => {
    const store = window.ioc.get('@hypercomb.social/Store')
    const real = store.getPool.bind(store)
    window.__counts = { walks: 0, buckets: 0 }
    store.getPool = async (meaning) => {
      const pool = await real(meaning)
      if (!pool || meaning !== 'threads') return pool
      return new Proxy(pool, {
        get(target, prop) {
          if (prop === 'entries') return (...a) => { window.__counts.walks++; return target.entries(...a) }
          if (prop === 'getDirectoryHandle') return (...a) => { window.__counts.buckets++; return target.getDirectoryHandle(...a) }
          const value = target[prop]
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    }
  })

  // Measure the main thread while a burst lands.
  const measure = async (label, named) => {
    const result = await page.evaluate(async ({ ids, BURST, named }) => {
      const frames = []
      let last = performance.now()
      let running = true
      const tick = (now) => { frames.push(now - last); last = now; if (running) requestAnimationFrame(tick) }
      requestAnimationFrame(tick)
      await new Promise(r => setTimeout(r, 250))       // settle
      window.__counts.walks = 0; window.__counts.buckets = 0
      const t0 = performance.now()
      for (let i = 0; i < BURST; i++) {
        window.__hypercombEffectBus.emit('chat:threads-changed', named ? { convoId: ids[i % ids.length] } : {})
      }
      await new Promise(r => setTimeout(r, 2500))
      running = false
      const total = performance.now() - t0
      const gaps = frames.slice(2)
      return {
        frames: gaps.length,
        worstGapMs: Math.round(Math.max(...gaps)),
        medianGapMs: Math.round(gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] || 0),
        overMs: Math.round(total),
        poolWalks: window.__counts.walks,
        bucketOpens: window.__counts.buckets,
      }
    }, { ids, BURST, named })
    console.log(label, JSON.stringify(result))
    return result
  }

  const walk = await measure('walk each change  :', false)
  await page.waitForTimeout(1200)
  const merge = await measure('named + coalesced :', true)
  console.log(`pool walks per burst of ${BURST}: ${walk.poolWalks} -> ${merge.poolWalks}`)
  console.log(`bucket opens:               ${walk.bucketOpens} -> ${merge.bucketOpens}`)
  await browser.close()
})().catch(e => { console.error(e.message); process.exit(1) })
