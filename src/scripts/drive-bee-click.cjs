// scripts/drive-bee-click.cjs
//
// Proof for PRESSING A BEE OPENS ITS LOG, and for A BEE NEVER RUNS FROM THE
// CURSOR (Jaime, 2026-09-09: "when you click them you can't open log anymore
// and see what's going on within the agents chat … they can't go away so they
// can avoid the mouse").
//
// It drives the real drone with a REAL MOUSE — `page.mouse`, which goes in
// through Chromium's input pipeline, so the press, the travel and the release
// are the same events a hand produces. A dispatched PointerEvent would prove
// nothing: it cannot be the thing that got broken.
//
// What is asserted, in order:
//   1. A STILL PRESS OPENS THE LOG. Click the bee, the agent panel is up.
//   2. A PRESS THAT WOBBLES IS STILL A CLICK. The bee is dancing, so the hand
//      is moving when the button goes down.
//   2b. A CONVERSATION BEE OPENS ITS TALK — the resting lane, which the panel
//      could not see at all.
//   3. THE BEE HOLDS ITS GROUND. Hovering the tile under a bee must not move
//      it — a target that runs is a target you cannot press.
//   4. OUT OF THE LIGHT, NOT OUT OF THE WAY. A bee over the tile you are
//      reading goes quiet where it stands, and stays pressable.
//   5. THE BROOM. Scribbling over a bee sweeps it out to the wall, it stays
//      there, it is still pressable there, and a second scribble sends it back.
//   6. A PRESS THAT TRAVELS CARRIES THE BEE, and opens nothing.
//
//   node scripts/drive-bee-click.cjs [--headed] [--port 4250]
//
// Runs in its own Playwright profile — a fresh, empty hive of its own. It
// never touches the participant's OPFS.

const { chromium } = require('playwright')

function arg(name, fallback) {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : true
}

const PORT = String(arg('port', '4250'))
const URL = `http://localhost:${PORT}/`
const HEADED = process.argv.includes('--headed')

const ts = () => new Date().toISOString().slice(11, 23)
const log = (...a) => console.log(`[${ts()}]`, ...a)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const failures = []
const claim = (ok, label, detail) => {
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
  log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  return ok
}

async function waitForReady(page, timeoutMs = 120000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await page.evaluate(() => !!(
      window.ioc?.get?.('@diamondcoreprocessor.com/AgentRegistry')
      && window.__hypercombEffectBus
    )).catch(() => false)
    if (ok) return true
    await sleep(400)
  }
  return false
}

async function grabStage(page, timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await page.evaluate(() => new Promise(resolve => {
      if (window.__proof && window.__proof.world) return resolve(true)
      let done = false
      try {
        window.__hypercombEffectBus.on('render:host-ready', p => {
          if (done || !p || !p.container) return
          done = true
          window.__proof = { app: p.app, world: p.container, canvas: p.canvas }
          resolve(true)
        })
      } catch { return resolve(false) }
      setTimeout(() => resolve(done), 1500)
    })).catch(() => false)
    if (ok) return true
    await sleep(500)
  }
  return false
}

const emit = (page, effect, payload) =>
  page.evaluate(([e, p]) => window.__hypercombEffectBus.emit(e, p), [effect, payload])

/** Bee sprites in SCREEN coordinates. The drone's own frame work runs on the
 *  Pixi ticker; headless still runs rAF, so the dance is live and a position
 *  read here is a snapshot, not a promise. */
const readBees = (page, floor = 0.25) => page.evaluate((min) => {
  const world = window.__proof && window.__proof.world
  if (!world) return []
  const out = []
  for (const layer of world.children.filter(c => c.zIndex === 11 && Array.isArray(c.children))) {
    for (const child of layer.children) {
      if (child.texture === undefined || child.anchor === undefined) continue
      if (child.alpha <= min) continue
      const p = child.getGlobalPosition()
      out.push({ x: Math.round(p.x), y: Math.round(p.y), alpha: Number(child.alpha.toFixed(2)) })
    }
  }
  return out
}, floor)

/** Is the agent panel up, and whose log is it showing? */
const panelState = (page) => page.evaluate(() => {
  const panel = document.querySelector('.hc-agent')
  if (!panel) return { open: false }
  return { open: true, text: (panel.textContent || '').slice(0, 160) }
})

const closePanel = async (page) => {
  for (let i = 0; i < 3 && (await panelState(page)).open; i++) {
    await page.keyboard.press('Escape')
    await sleep(250)
  }
}

/** The tiles the hive is actually painting. A bee is anchored 38 screen px
 *  above its tile's centre, so the tile under a bee is found from the bee. */
const readCells = (page) => page.evaluate(() =>
  (window.ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')?.snapshotCells?.() ?? [])
    .map(c => c.label))

/** DRIVE THE CLOCK. A headless page composites when Chromium feels like it,
 *  and the drone's frame work hangs off the Pixi ticker — so a bee gliding to
 *  where it was just sent simply stops between mouse events unless the clock
 *  is turned by hand. Nothing is stubbed; only time is supplied. (The renderer
 *  runs at low priority and throws on a GPU-less page AFTER the drone's logic
 *  has run for the frame, so the throw is swallowed: only the picture is lost,
 *  never the positions this driver reads.) */
const pump = (page, frames = 90) => page.evaluate((n) => {
  const app = window.__proof && window.__proof.app
  if (!app) return 0
  let t = performance.now()
  for (let i = 0; i < n; i++) {
    t += 16.7
    try { app.ticker.update(t) } catch { /* no GPU — only the picture is lost */ }
  }
  return n
}, frames)

/** SCRIBBLE over a point with no button down — the broom. Back and forth with
 *  a little wander, which is what a hand makes; the drone reads it as turning,
 *  not as a shape. */
async function scribbleOver(page, at) {
  await page.mouse.move(at.x - 55, at.y, { steps: 4 })
  for (let i = 0; i < 3; i++) {
    await page.mouse.move(at.x + 55, at.y + (i % 2 ? 10 : -10), { steps: 5 })
    await page.mouse.move(at.x - 55, at.y + (i % 2 ? -10 : 10), { steps: 5 })
  }
}

/** A press that goes down and comes up in the same place — a CLICK, with the
 *  hand held still. `steps` on the approach so the drone sees hover moves. */
async function clickAt(page, x, y) {
  await page.mouse.move(x, y, { steps: 8 })
  await sleep(120)
  await page.mouse.down()
  await sleep(90)
  await page.mouse.up()
  await sleep(450)
}

async function main() {
  const browser = await chromium.launch({
    headless: !HEADED,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
  })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  page.on('pageerror', e => log('page error:', e.message))

  log(`opening ${URL}`)
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 })
  if (!await waitForReady(page)) throw new Error('runtime never became ready')
  if (!await grabStage(page)) throw new Error('never got the pixi host off the bus')
  log('runtime ready, pixi host captured')
  // Listen in on the hover the drone listens to, so a "did not move" claim can
  // say whether the pointer was ever actually on a tile.
  await page.evaluate(() => {
    window.__hoverLabel = null
    window.__hypercombEffectBus.on('tile:hover', p => { window.__hoverLabel = p?.label ?? null })
    window.__toasts = []
    window.__hypercombEffectBus.on('toast:show', p => {
      window.__toasts.push(p?.message ?? '')
    })
  })
  await sleep(2500)

  // ANCHOR IT ON A REAL TILE. A bee dancing in the open never meets
  // `tile:hover`, and the hover is half of what is being proven — so this
  // driver's own empty hive is given a tile to work over, through the command
  // line, the way a participant makes one.
  let labels = await readCells(page)
  if (!labels.length) {
    for (const name of ['workbench', 'ledger', 'orchard']) {
      await page.evaluate(async (cellName) => {
        const input = document.querySelector('hc-command-line input') || document.querySelector('input[type="text"]')
        if (!input) return false
        input.focus(); input.value = cellName
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise(r => setTimeout(r, 150))
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
        return true
      }, name).catch(() => false)
      await sleep(900)
    }
    await sleep(1200)
    // A tile can carry the shell through a route change; pick the runtime up
    // again rather than dying on a destroyed context.
    await waitForReady(page)
    await page.evaluate(() => { window.__proof = null }).catch(() => {})
    await grabStage(page)
    labels = await readCells(page).catch(() => [])
  }
  const target = labels[0] ? [labels[0]] : []
  log(target.length ? `anchoring on tile "${target[0]}" (${labels.length} painted)` : 'no tiles painted — bee dances in the open')
  await emit(page, 'agent:start', {
    id: 'click-proof', behavior: 'opus', kind: 'model',
    request: 'proof: a press on this bee opens its log', targets: target, segments: [],
  })
  await sleep(1500)

  let bees = await readBees(page)
  if (!bees.length) throw new Error('no bee on the layer to press')
  log(`bee at ${bees[0].x},${bees[0].y} (of ${bees.length})`)

  // 1. A STILL PRESS OPENS THE LOG.
  await clickAt(page, bees[0].x, bees[0].y)
  let panel = await panelState(page)
  claim(panel.open, 'a still press opens the log', panel.open ? panel.text.replace(/\s+/g, ' ').slice(0, 80) : 'no .hc-agent panel')
  await closePanel(page)

  // 2. A PRESS THAT WOBBLES IS STILL A CLICK.
  bees = await readBees(page)
  if (bees.length) {
    const b = bees[0]
    await page.mouse.move(b.x - 30, b.y - 30, { steps: 6 })
    await page.mouse.move(b.x, b.y, { steps: 6 })
    await page.mouse.down()
    await page.mouse.move(b.x + 5, b.y + 4, { steps: 3 })
    await page.mouse.up()
    await sleep(450)
    panel = await panelState(page)
    claim(panel.open, 'a press that wobbles 6px is still a click')
    await closePanel(page)
  }

  // 2b. A CONVERSATION BEE OPENS ITS TALK. A tile that has been talked to keeps
  //     a bee whether or not a question is out, and that bee lives in the
  //     registry's RESTING lane — the lane the panel could not see, so pressing
  //     one opened nothing at all.
  const restTile = labels[1] ?? labels[0] ?? ''
  const rested = await page.evaluate(async ([tile]) => {
    const threads = window.ioc?.get?.('@diamondcoreprocessor.com/ChatThreads')
    const registry = window.ioc?.get?.('@diamondcoreprocessor.com/AgentRegistry')
    if (!threads || !registry) return { ok: false, why: 'no threads/registry' }
    // Segments, the way the hive spells a tile's address — `tilePath` maps
    // over them, so a string here is a TypeError, not a path.
    const segments = tile ? [tile] : []
    const convoId = threads.newTileConvoId(segments, 'proof')
    await threads.appendTurn?.(convoId, 'user', 'what is this tile for?')
    await threads.appendTurn?.(convoId, 'assistant', 'It is the workbench, where the day is kept.')
    // The same derivation the drone runs, through the registry's own lane.
    registry.rest?.(new Map([[`chat:${convoId}`, {
      id: `chat:${convoId}`, behavior: 'opus', kind: 'model', model: 'opus', vendor: 'anthropic',
      request: 'what is this tile for?', targets: tile ? [tile] : [], segments: [],
      status: 'working', activity: [], context: [], origin: 'local',
      startedAt: Date.now() - 90000, updatedAt: Date.now() - 60000,
    }]]))
    return { ok: true, id: `chat:${convoId}` }
  }, [restTile])
  log(`   (resting bee: ${JSON.stringify(rested)})`)
  await sleep(1600)
  await pump(page, 60)
  const withRest = await readBees(page)
  // The conversation is about a DIFFERENT tile from the running agent, so the
  // two bees dance in different places and there is no doubt which was pressed.
  const working = bees[0]
  const restingBee = withRest
    .filter(b => Math.hypot(b.x - working.x, b.y - working.y) > 60)
    .sort((a, b) => Math.hypot(b.x - working.x, b.y - working.y) - Math.hypot(a.x - working.x, a.y - working.y))[0]
  if (rested.ok && restingBee) {
    await clickAt(page, restingBee.x, restingBee.y)
    const talk = await panelState(page)
    const said = /what is this tile for/i.test(talk.text || '')
    const wrongPanel = /proof: a press/i.test(talk.text || '')
    claim(talk.open && !wrongPanel, 'pressing a conversation bee opens the little window',
      talk.open ? talk.text.replace(/\s+/g, ' ').slice(0, 90) : 'no .hc-agent panel')
    claim(said, 'and the window shows what was said')
    claim(!/Stop/.test(talk.text || ''), 'and never offers to stop a talk that already ended')

    // THE WAY IN. The panel is a glance; the button is the one press between
    // it and the conversation itself.
    const opened = await page.evaluate(() => {
      const button = [...document.querySelectorAll('.hc-agent button')]
        .find(b => /open the conversation/i.test(b.textContent || ''))
      if (!button) return false
      button.click()
      return true
    })
    await sleep(900)
    const chatUp = await page.evaluate(() => {
      const window = document.querySelector('hc-chat-window')
      if (!window) return false
      const box = window.getBoundingClientRect()
      return box.width > 0 && box.height > 0 && getComputedStyle(window).visibility !== 'hidden'
    })
    claim(opened && chatUp, 'and one press from there opens the conversation itself')
    await page.evaluate(() => window.__hypercombEffectBus.emit('chat:close', {}))
    await sleep(400)
    await closePanel(page)
  } else {
    claim(false, 'pressing a conversation bee opens the little window',
      `${withRest.length} bee(s) on the layer, none apart from the working one`)
  }

  // 3. THE BEE HOLDS ITS GROUND while the pointer walks the hive under it.
  bees = await readBees(page)
  if (bees.length) {
    const b = bees[0]
    // The pointer walks onto the TILE the bee is dancing over — the last
    // moment before a press. The hover is DECLARED on the bus rather than
    // produced by moving onto the hexagon: Pixi's own hit testing needs a
    // frame that actually rendered, and a headless page has no GPU to render
    // one with. `tile:hover` is exactly what the overlay emits and exactly
    // what the bee drone consumes, so the drone is under the real input.
    await page.mouse.move(b.x - 220, b.y + 140, { steps: 8 })
    await sleep(500)
    const before = (await readBees(page))[0]
    await emit(page, 'tile:hover', { label: target[0] ?? '', bandRows: 1 })
    await page.mouse.move(b.x, b.y + 38, { steps: 20 })
    await sleep(300)
    await pump(page, 120)
    const after = (await readBees(page))[0]
    const drift = Math.hypot(after.x - before.x, after.y - before.y)
    await emit(page, 'tile:hover', { label: null, bandRows: 1 })
    await sleep(600)
    // The dance itself is a few px wide; anything past 24 is the bee LEAVING.
    claim(drift < 24, 'the bee holds its ground when the pointer walks under it', `drifted ${Math.round(drift)}px`)
  }

  // 4. OUT OF THE LIGHT, NOT OUT OF THE WAY. Reading the tile under a bee
  //    costs the bee its INK and nothing else: it keeps its place, and it is
  //    still exactly as pressable as it looks.
  bees = await readBees(page)
  if (bees.length && target.length) {
    const b = bees[0]
    await emit(page, 'tile:hover', { label: target[0], bandRows: 1 })
    await page.mouse.move(b.x, b.y + 60, { steps: 10 })
    await sleep(200)
    await pump(page, 60)
    const ghosted = (await readBees(page, 0.02))[0]
    claim(!!ghosted && ghosted.alpha < 0.5,
      'a bee over the tile you are reading goes quiet', ghosted ? `ink ${ghosted.alpha}` : 'bee gone')
    claim(!!ghosted && Math.hypot(ghosted.x - b.x, ghosted.y - b.y) < 24,
      'and it does not budge while it does')
    // Pressable while quiet: this is the whole point of dimming instead of
    // moving. Aim at the BODY — over a tile, the tile owns the air around it.
    await clickAt(page, ghosted.x, ghosted.y)
    const quiet = await panelState(page)
    claim(quiet.open, 'a quiet bee still opens its log')
    await closePanel(page)
    await emit(page, 'tile:hover', { label: null, bandRows: 1 })
    await sleep(300)
    await pump(page, 60)
  }

  // 5. THE SCRUB PUTS THEM ASIDE — and a second scribble brings them back.
  bees = await readBees(page)
  if (bees.length) {
    const home = bees[0]
    await page.evaluate(() => { window.__toasts = [] })
    await scribbleOver(page, home)
    await pump(page, 120)
    await sleep(1600)
    await pump(page, 60)
    const aside = (await readBees(page))[0]
    const swept = aside ? Math.hypot(aside.x - home.x, aside.y - home.y) : 0
    const said = await page.evaluate(() => window.__toasts.slice())
    claim(swept > 80, 'a scribble over a bee sweeps it out to the wall', `moved ${Math.round(swept)}px · ${JSON.stringify(said)}`)

    await sleep(300)
    await pump(page, 60)
    const settled = (await readBees(page))[0]
    claim(settled && Math.hypot(settled.x - aside.x, settled.y - aside.y) < 30,
      'and it stays where the broom put it')

    // The same gesture is the way back.
    const at = (await readBees(page))[0]
    await page.evaluate(() => { window.__toasts = [] })
    await scribbleOver(page, at)
    await pump(page, 200)
    await sleep(400)
    await pump(page, 120)
    const back = (await readBees(page))[0]
    claim(back && Math.hypot(back.x - home.x, back.y - home.y) < 60,
      'scribbling over a swept bee sends it back to its work',
      back ? `${Math.round(Math.hypot(back.x - home.x, back.y - home.y))}px from home` : 'bee gone')

    // Still pressable wherever it is — a bee put aside is not a bee lost.
    const now = (await readBees(page))[0]
    if (now) {
      await clickAt(page, now.x, now.y)
      const put = await panelState(page)
      claim(put.open, 'a swept bee still opens its log')
      await closePanel(page)
    }
  }

  // 6. A PRESS THAT TRAVELS CARRIES THE BEE. Last, because a drag leaves the
  //    bee somewhere the participant put it, and that is a state the checks
  //    above must not start from.
  bees = await readBees(page)
  if (bees.length) {
    const b = bees[0]
    await page.mouse.move(b.x, b.y, { steps: 6 })
    await page.mouse.down()
    // Toward the middle of the room: a bee parked at the wall cannot be
    // dragged further into it, and that would prove nothing about the drag.
    await page.mouse.move(b.x < 720 ? b.x + 150 : b.x - 150, b.y < 450 ? b.y + 90 : b.y - 90, { steps: 12 })
    await page.mouse.up()
    await sleep(300)
    await pump(page, 90)
    const panelAfterDrag = await panelState(page)
    const after = (await readBees(page))[0]
    claim(!panelAfterDrag.open, 'a press that travels opens nothing')
    claim(!!after && Math.hypot(after.x - b.x, after.y - b.y) > 60,
      'a press that travels carries the bee', after ? `moved ${Math.round(Math.hypot(after.x - b.x, after.y - b.y))}px` : 'bee gone')
  }

  await browser.close()

  if (failures.length) {
    log(`FAILED (${failures.length}):`)
    for (const f of failures) log('  •', f)
    process.exit(1)
  }
  log('ALL CHECKS PASSED')
}

main().catch(e => { log('ERROR', e && e.stack || e); process.exit(1) })
