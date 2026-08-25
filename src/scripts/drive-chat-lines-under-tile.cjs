#!/usr/bin/env node
// drive-chat-lines-under-tile — a tile's conversations live UNDER THE TILE.
//
//   node scripts/drive-chat-lines-under-tile.cjs [--url http://localhost:4450] [--out <dir>]
//
// The grammar under test: a chat about a tile is listed in the rail, under
// that tile, and NOWHERE ELSE. The window's flat roster above the transcript
// is gone — with a rail on screen the bar only NAMES the conversation you are
// in. And a tile holds several: pressing "+ New conversation" twice gives two
// rows, not one, because a conversation that holds nothing yet is still a
// conversation you made and must be able to come back to.
//
//   1. the window shows no chat list, and its name is not a control,
//   2. a tile's fold holds its conversations INSIDE the tile's own block,
//   3. "+ New conversation" adds a row you can see, every time,
//   4. the composer's + adds one under the same tile (never a free chat),
//   5. walking to another page and back leaves each tile's chats under it.

const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

function arg(name, fallback) {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : true
}

const results = []
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail })
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''))
}

const chatRows = page => page.$$eval(
  '.hc-rail-group:not(.hc-rail-hive) .hc-rail-chats .hc-rail-chat:not(.hc-rail-chat-new)',
  els => els.map(el => el.innerText.replace(/\n/g, ' · ').trim())).catch(() => [])

async function main() {
  const url = arg('url', 'http://localhost:4450')
  const out = arg('out', path.join(__dirname, '..', '..', 'test-results', 'chat-lines'))
  fs.mkdirSync(out, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!window.__hypercombEffectBus, null, { timeout: 90000 })

  // A fresh profile lands on the first-boot offer; take an example hive so
  // there is a tile to hold a conversation.
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button'))
    .some(b => (b.innerText || '').trim() === 'Add +'), null, { timeout: 60000 }).catch(() => {})
  const seeded = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').trim() === 'Add +')
    if (!btn) return false
    btn.click(); return true
  })
  if (seeded) await page.waitForTimeout(12000)

  // The window is a SETUP CHECKLIST until an AI is configured, and the
  // checklist has no conversation in it. Say the bridge is on and the
  // checklist is done — both are participant-local flags, and neither
  // reaches the hive — then reload so the window comes up as a chat.
  await page.evaluate(() => {
    try {
      localStorage.setItem('hypercomb.claudeBridge.enabled', '1')
      localStorage.setItem('hc:bridge-setup-done', '1')
    } catch {}
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!window.__hypercombEffectBus, null, { timeout: 90000 })
  await page.waitForTimeout(6000)

  await page.evaluate(() => window.__hypercombEffectBus.emit('chat:open', {}))
  await page.waitForSelector('.chat-rail', { timeout: 30000 })
  await page.waitForSelector('.chat-bar', { timeout: 30000 })
  await page.waitForTimeout(800)
  // The seeded hive has to have LANDED — the rail lists it from the same walk
  // the canvas does, and a reload mid-seed leaves an empty level.
  await page.waitForSelector('.hc-rail-group:not(.hc-rail-hive)', { timeout: 60000 })

  // 1 — the main view holds no chat lines, and the name is only a name.
  const listRows = await page.$$eval('.chat-list-row', els => els.length).catch(() => 0)
  const still = await page.$$eval('.chat-current-still', els => els.length).catch(() => 0)
  const toggles = await page.$$eval('button.chat-current', els => els.length).catch(() => 0)
  check('the window lists no chats — the rail carries them', listRows === 0 && toggles === 0,
    `rows=${listRows} toggles=${toggles}`)
  check('the bar only NAMES the conversation', still === 1, `still=${still}`)

  // 1b — THE HIVE'S OWN ROW. One item at the top, drawn as itself, holding
  // the conversations that are about no single tile.
  const hive = await page.$eval('.hc-rail-hive', el => ({
    first: el.parentElement?.firstElementChild === el,
    name: el.querySelector('.hc-rail-name')?.textContent?.trim() ?? '',
    // No picture-mark by design: a comb cell here collided with the gutter's
    // unread cell. The NAME carries the identity.
    mark: !!el.querySelector('.hc-rail-icon'),
    nameColor: getComputedStyle(el.querySelector('.hc-rail-name')).color,
    tileNameColor: (() => {
      const tile = el.parentElement?.querySelector('.hc-rail-group:not(.hc-rail-hive) .hc-rail-name')
      return tile ? getComputedStyle(tile).color : ''
    })(),
  })).catch(() => null)
  check('the hive has a row of its own, first in the list',
    !!hive && hive.first && hive.name === 'Hypercomb', JSON.stringify(hive))
  check('it does not look like a tile', !!hive && hive.nameColor !== hive.tileNameColor,
    hive ? `hive='${hive.nameColor}' tile='${hive.tileNameColor}'` : 'no hive row')

  // Global chats: add two under it, and the header says what you are in. The
  // fold may already be open — a window that opens with no thread of its own
  // starts a GLOBAL one, which is the hive's row doing its job.
  const hiveRows = () => page.$$eval('.hc-rail-hive .hc-rail-chat:not(.hc-rail-chat-new)',
    els => els.map(el => el.innerText.replace(/\n/g, ' · ').trim())).catch(() => [])
  if (!(await page.$('.hc-rail-hive .hc-rail-chats'))) {
    await page.click('.hc-rail-hive .hc-rail-chev', { force: true })
    await page.waitForSelector('.hc-rail-hive .hc-rail-chats', { timeout: 20000 })
  }
  // Let the window's own boot conversation land before counting: it starts
  // one under the hive, and counting mid-flight compares two different lists.
  await page.waitForTimeout(1200)
  const hiveBefore = (await hiveRows()).length
  for (let i = 0; i < 2; i++) {
    await page.click('.hc-rail-hive .hc-rail-chat-new', { force: true })
    await page.waitForTimeout(900)
  }
  const globals = await hiveRows()
  check('the hive holds global conversations — several',
    globals.length === hiveBefore + 2, `${hiveBefore} → ${globals.length}: ${JSON.stringify(globals)}`)
  const header = await page.$eval('.chat-subject', el => el.innerText.trim()).catch(() => '')
  check('the header names the hive while you are in a global chat',
    header.toUpperCase().includes('HYPERCOMB'), `header='${header}'`)
  await page.screenshot({ path: path.join(out, 'hive.png') })

  // 2 — unfold a tile: its conversations sit inside the tile's own block.
  await page.click('.hc-rail-group:not(.hc-rail-hive) .hc-rail-chev', { force: true })
  await page.waitForSelector('.hc-rail-group:not(.hc-rail-hive) .hc-rail-chats', { timeout: 20000 })
  const inside = await page.$eval('.hc-rail-group:not(.hc-rail-hive) .hc-rail-chats', el => el.parentElement?.className ?? '')
  check('the fold is INSIDE the tile\'s block', inside.includes('hc-rail-group'), `parent='${inside}'`)
  await page.screenshot({ path: path.join(out, 'folded.png') })

  // 3 — every press of "+ New conversation" is a row you can see.
  const before = (await chatRows(page)).length
  await page.click('.hc-rail-group:not(.hc-rail-hive) .hc-rail-chat-new', { force: true })
  await page.waitForTimeout(900)
  const afterOne = await chatRows(page)
  await page.click('.hc-rail-group:not(.hc-rail-hive) .hc-rail-chat-new', { force: true })
  await page.waitForTimeout(900)
  const afterTwo = await chatRows(page)
  check('one press, one conversation', afterOne.length === before + 1, JSON.stringify(afterOne))
  check('a tile holds SEVERAL — the second press is a second row',
    afterTwo.length === before + 2, JSON.stringify(afterTwo))

  // 4 — the composer's + adds one under the same tile, never a free chat.
  await page.click('.chat-new')
  await page.waitForTimeout(900)
  const afterPlus = await chatRows(page)
  check('the composer\'s + lands under the tile too',
    afterPlus.length === afterTwo.length + 1, JSON.stringify(afterPlus))
  await page.screenshot({ path: path.join(out, 'three-chats.png') })

  // 5 — CHANGE PAGES. Hold to go inside (the hive's own gesture, 450ms), and
  // the tiles on the new page carry their own conversations the same way.
  const parentName = await page.$eval('.hc-rail-group:not(.hc-rail-hive) .hc-rail-name', el => el.textContent.trim())
  const box = await (await page.$('.hc-rail-group:not(.hc-rail-hive) .hc-rail-main')).boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(900)
  await page.mouse.up()
  await page.waitForTimeout(1500)
  const level = await page.$eval('.hc-rail-title', el => el.textContent.trim()).catch(() => '')
  check('holding walks INTO the tile — a new page of tiles',
    level.toLowerCase().includes(parentName.toLowerCase()), `level='${level}' from='${parentName}'`)

  const childChev = await page.$('.hc-rail-group:not(.hc-rail-hive) .hc-rail-chev')
  if (childChev) {
    await childChev.click({ force: true })
    await page.waitForSelector('.hc-rail-group:not(.hc-rail-hive) .hc-rail-chats', { timeout: 20000 })
    await page.click('.hc-rail-group:not(.hc-rail-hive) .hc-rail-chat-new', { force: true })
    await page.waitForTimeout(900)
  }
  const childRows = await chatRows(page)
  check('a tile on the NEW page holds its own conversation too',
    childRows.length === 1, JSON.stringify(childRows))
  await page.screenshot({ path: path.join(out, 'inside.png') })

  // ...and coming back out, the tile we left still holds its three.
  await page.click('.hc-rail-back')
  await page.waitForTimeout(1500)
  // The fold is remembered per tile, so pressing the arrow again would SHUT
  // what walking back out reopened. Only unfold if it came back folded.
  if (!(await page.$('.hc-rail-group:not(.hc-rail-hive) .hc-rail-chats'))) {
    await page.click('.hc-rail-group:not(.hc-rail-hive) .hc-rail-chev', { force: true }).catch(() => {})
    await page.waitForTimeout(900)
  }
  const backRows = await chatRows(page)
  check('coming back out, the tile still holds every conversation it had',
    backRows.length === afterPlus.length, `${backRows.length} of ${afterPlus.length} — ${JSON.stringify(backRows)}`)

  await page.screenshot({ path: path.join(out, 'after-walk.png') })
  const rail = await page.$('.chat-rail')
  if (rail) await rail.screenshot({ path: path.join(out, 'rail.png') })
  await browser.close()

  const bad = results.filter(r => !r.ok)
  console.log(bad.length ? `\n${bad.length} failed` : '\nall green')
  process.exit(bad.length ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(1) })
