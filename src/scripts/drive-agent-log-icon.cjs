// scripts/drive-agent-log-icon.cjs
//
// Proof for THE DOOR THE BEE WAS (Jaime, 2026-09-10: "When the agents are
// hidden can we get a menu icon on the tile overlay to show the agent
// window?").
//
// Hiding the agents takes the bees off the hive, and the bee is how an agent's
// window opens — so while they are hidden the tile carries the door instead.
// What is asserted:
//
//   1. WHILE THE BEES FLY, NO ICON. The bee is the door; two doors for one act
//      is one too many.
//   2. HIDDEN, THE TILE CARRIES IT — but only a tile some agent names, because
//      the icon is the bee that would have been dancing there.
//   3. A TILE NO AGENT NAMES NEVER WEARS IT.
//   4. PRESSING IT OPENS THE AGENT WINDOW — the same little window a press on
//      the bee opens.
//   5. SHOW THE AGENTS AGAIN AND THE ICON GOES. The affordance MOVES; it does
//      not accumulate.
//
// It asks the overlay's own registry (`actionsForTile`, the same list the band,
// the close-up screen and the tile brief are built from) and presses through
// the overlay's own door (`invokeActionForTile`, which emits the same
// `tile:action` a click on the icon emits). The ICON'S PLACEMENT in the band is
// not asserted: drawing it needs a rendered frame, and a headless page has no
// GPU to render one with.
//
//   node scripts/drive-agent-log-icon.cjs [--headed] [--port 4250]
//
// Runs in its own Playwright profile — a fresh, empty hive of its own. It never
// touches the participant's OPFS.

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
      && window.ioc?.get?.('@diamondcoreprocessor.com/TileOverlayDrone')
      && window.__hypercombEffectBus
    )).catch(() => false)
    if (ok) return true
    await sleep(400)
  }
  return false
}

const emit = (page, effect, payload) =>
  page.evaluate(([e, p]) => window.__hypercombEffectBus.emit(e, p), [effect, payload])

/** The affordances the overlay would offer on this tile, by name. */
const actionsOn = (page, label) => page.evaluate((tile) => {
  const overlay = window.ioc?.get?.('@diamondcoreprocessor.com/TileOverlayDrone')
  return (overlay?.actionsForTile?.(tile) ?? []).map(a => a.name)
}, label)

const panelState = (page) => page.evaluate(() => {
  const panel = document.querySelector('.hc-agent')
  if (!panel) return { open: false, text: '' }
  return { open: true, text: (panel.textContent || '').slice(0, 200) }
})

const closePanel = async (page) => {
  for (let i = 0; i < 3 && (await panelState(page)).open; i++) {
    await page.keyboard.press('Escape')
    await sleep(250)
  }
}

const cells = (page) => page.evaluate(() =>
  (window.ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')?.snapshotCells?.() ?? [])
    .map(c => c.label))

async function addTile(page, name) {
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
  await sleep(2500)

  let labels = await cells(page)
  if (labels.length < 2) {
    for (const name of ['workbench', 'orchard']) await addTile(page, name)
    await sleep(1200)
    await waitForReady(page)
    labels = await cells(page).catch(() => [])
  }
  const worked = labels[0]
  const untouched = labels[1] ?? ''
  if (!worked) throw new Error('no tile to work over')
  log(`agent on "${worked}", nothing on "${untouched || '(no second tile)'}"`)

  await emit(page, 'agent:start', {
    id: 'icon-proof', behavior: 'opus', kind: 'model',
    request: 'proof: the tile carries the door while the bees are hidden',
    targets: [worked], segments: [],
  })
  await sleep(1200)

  // 1. WHILE THE BEES FLY, NO ICON.
  await emit(page, 'render:set-agents-visible', { visible: true })
  await sleep(600)
  let names = await actionsOn(page, worked)
  claim(!names.includes('agent-log'), 'while the bees fly, the tile carries no icon',
    names.join(' '))

  // 2. HIDDEN — the tile with the agent carries it.
  await emit(page, 'render:set-agents-visible', { visible: false })
  await sleep(700)
  names = await actionsOn(page, worked)
  claim(names.includes('agent-log'), 'hidden, the worked tile carries the door', names.join(' '))

  // 3. A TILE NO AGENT NAMES NEVER WEARS IT.
  if (untouched) {
    const other = await actionsOn(page, untouched)
    claim(!other.includes('agent-log'), 'a tile no agent names never wears it', other.join(' '))
  }

  // 4. PRESSING IT OPENS THE AGENT WINDOW.
  await closePanel(page)
  await page.evaluate((tile) => {
    window.ioc?.get?.('@diamondcoreprocessor.com/TileOverlayDrone')
      ?.invokeActionForTile?.('agent-log', tile)
  }, worked)
  await sleep(700)
  const panel = await panelState(page)
  claim(panel.open, 'pressing it opens the agent window',
    panel.open ? panel.text.replace(/\s+/g, ' ').slice(0, 90) : 'no .hc-agent panel')
  claim(/the tile carries the door/i.test(panel.text),
    'and the window is about the agent on THAT tile')
  await closePanel(page)

  // 4b. A CONVERSATION COUNTS AS AN AGENT. The bee over a talked-to tile is a
  //     resting one, and it is the same door.
  const rested = await page.evaluate(async ([tile]) => {
    const threads = window.ioc?.get?.('@diamondcoreprocessor.com/ChatThreads')
    const registry = window.ioc?.get?.('@diamondcoreprocessor.com/AgentRegistry')
    if (!threads || !registry) return { ok: false }
    const convoId = threads.newTileConvoId([tile], 'icon-proof')
    await threads.appendTurn?.(convoId, 'user', 'who planted the orchard?')
    await threads.appendTurn?.(convoId, 'assistant', 'You did, last spring.')
    registry.rest?.(new Map([[`chat:${convoId}`, {
      id: `chat:${convoId}`, behavior: 'opus', kind: 'model', model: 'opus', vendor: 'anthropic',
      request: 'who planted the orchard?', targets: [tile], segments: [],
      status: 'working', activity: [], context: [], origin: 'local',
      startedAt: Date.now() - 90000, updatedAt: Date.now() - 60000,
    }]]))
    return { ok: true }
  }, [untouched]).catch(() => ({ ok: false }))
  if (rested.ok && untouched) {
    await sleep(700)
    const talked = await actionsOn(page, untouched)
    claim(talked.includes('agent-log'), 'a talked-to tile carries it too', talked.join(' '))
    await page.evaluate((tile) => {
      window.ioc?.get?.('@diamondcoreprocessor.com/TileOverlayDrone')
        ?.invokeActionForTile?.('agent-log', tile)
    }, untouched)
    await sleep(700)
    const talk = await panelState(page)
    claim(/who planted the orchard/i.test(talk.text), 'and it opens what was said there',
      talk.open ? talk.text.replace(/\s+/g, ' ').slice(0, 90) : 'no .hc-agent panel')
    await closePanel(page)
  }

  // 4c. IT SAYS WHAT IT IS. The band draws its hint from the catalog, and a
  //     missing key renders as the raw key — "action.agent-log" on a hexagon.
  const said = await page.evaluate(() => {
    const i18n = window.ioc?.get?.('@hypercomb.social/I18n')
    return {
      label: i18n?.t?.('action.agent-log') ?? '',
      hint: i18n?.t?.('action.agent-log.description') ?? '',
    }
  })
  claim(!!said.label && said.label !== 'action.agent-log'
    && !!said.hint && said.hint !== 'action.agent-log.description',
    'the icon says what it is in the catalog, not as a raw key',
    `${said.label} — ${said.hint}`)

  // 5. SHOW THE AGENTS AGAIN AND THE DOOR GOES BACK TO THE BEE.
  await emit(page, 'render:set-agents-visible', { visible: true })
  await sleep(700)
  names = await actionsOn(page, worked)
  claim(!names.includes('agent-log'), 'showing the agents takes the icon away again',
    names.join(' '))

  await browser.close()

  if (failures.length) {
    log(`FAILED (${failures.length}):`)
    for (const f of failures) log('  •', f)
    process.exit(1)
  }
  log('ALL CHECKS PASSED')
}

main().catch(e => { log('ERROR', e && e.stack || e); process.exit(1) })
