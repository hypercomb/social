#!/usr/bin/env node
// drive-notes-lists — drive the annotations window's LISTS tab and shoot it.
//
//   node scripts/drive-notes-lists.cjs [--port 4250] [--out notes-lists.png]
//                                      [--engine msedge] [--headed]
//
// Boots the dev shell in its own browser profile (never the participant's —
// one writer per hive), takes the first-boot example hive so there are tiles
// to write on, opens the annotations window on one of them, switches to the
// lists tab and builds a list the way a participant does: type / Enter, Tab
// to indent, Shift+Tab to come back out. Then measures what is on screen and
// writes a PNG.

const path = require('node:path')
const { chromium } = require('playwright')

function arg(name, fallback) {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : true
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main() {
  const port = Number(arg('port', 4250))
  const out = path.resolve(String(arg('out', 'notes-lists.png')))
  const channel = String(arg('engine', 'msedge'))
  const headless = arg('headed', false) !== true

  const browser = await chromium.launch({
    headless,
    ...(channel === 'chromium' ? {} : { channel }),
    args: ['--use-gl=angle', '--ignore-gpu-blocklist'],
  })
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(String(e)))
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

    await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' })
    await sleep(6000)
    const took = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => (b.innerText || '').trim() === 'Add +')
      if (!btn) return false
      btn.click()
      return true
    })
    if (took) await sleep(10000)

    // Wait for the render pass to publish the layer's tiles.
    let labels = []
    for (let i = 0; i < 60; i++) {
      labels = await page.evaluate(() =>
        (window.__hypercombEffectBus?.lastValue?.get('render:cell-count')?.labels ?? []).map(String))
      if (labels.length > 0) break
      await sleep(500)
    }
    if (labels.length === 0) {
      await page.screenshot({ path: out })
      const state = await page.evaluate(() => ({
        buttons: Array.from(document.querySelectorAll('button')).map(b => (b.innerText || '').trim()).filter(Boolean).slice(0, 30),
        body: document.body.innerText.slice(0, 400),
      }))
      console.log(JSON.stringify(state, null, 2))
      throw new Error('no tiles rendered')
    }

    // Open the annotations window and put a tile in it.
    await page.evaluate(() => window.__hypercombEffectBus.emit('notes:panel', { visible: true }))
    await page.waitForSelector('.notes-strip', { timeout: 8000 })
    await page.evaluate(l => {
      const chip = Array.from(document.querySelectorAll('.cv2-tilechip'))
        .find(c => (c.getAttribute('title') || '') === l)
      if (chip) chip.click()
    }, labels[0])
    await sleep(600)

    // The lists tab.
    await page.evaluate(() => {
      const tab = Array.from(document.querySelectorAll('.cv2-tab'))
        .find(t => (t.innerText || '').trim().toLowerCase() === 'lists')
      if (tab) tab.click()
    })
    await sleep(400)

    // A fresh list, from the foot bar.
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('.cv2-listfoot-btn'))
        .find(b => !b.classList.contains('is-danger'))
      if (btn) btn.click()
    })
    await sleep(1500)

    const born = await page.evaluate(() => ({
      tab: (document.querySelector('.cv2-tab.is-active') || {}).innerText.trim(),
      pane: !!document.querySelector('.cv2-listpane'),
      openLine: !!document.querySelector('.cv2-line.is-new .cv2-line-input'),
      blank: !!document.querySelector('.cv2-list-blank'),
      foot: Array.from(document.querySelectorAll('.cv2-listfoot-btn')).map(b => b.innerText.trim()),
    }))
    console.log('after new list:', JSON.stringify(born))

    // Build a hierarchy with the keyboard alone.
    const line = async (text, tabs = 0, shift = false) => {
      const input = await page.$('.cv2-line.is-new .cv2-line-input')
      if (!input) throw new Error('no open line')
      await input.click()
      for (let i = 0; i < tabs; i++) await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab')
      await page.keyboard.type(text)
      await page.keyboard.press('Enter')
      await sleep(1400)
    }
    await line('milk')
    await line('bread')
    await line('sourdough', 1)
    await line('rye')
    await line('apples', 1, true)

    // Retext AND indent in one keypress: click a line, change its words,
    // press Tab. The text has to land and the line has to move.
    const second = await page.$('.cv2-line[data-note-id]:nth-of-type(2) .cv2-line-text')
    if (second) {
      await second.click()
      await sleep(300)
      await page.keyboard.press('End')
      await page.keyboard.type(' & butter')
      await page.keyboard.press('Tab')
      await sleep(2500)
    }
    const afterDirtyTab = await page.evaluate(() => Array.from(document.querySelectorAll('.cv2-line[data-note-id]'))
      .map(r => `${getComputedStyle(r).getPropertyValue('--depth').trim()}:${(r.querySelector('.cv2-line-text') || {}).innerText?.trim() ?? ''}`))
    console.log('after dirty tab:', JSON.stringify(afterDirtyTab))

    // Drag the last line up above the first — the grip, a real pointer, and
    // the drop indicator the row paints on the way.
    const grip = await page.$('.cv2-line[data-note-id]:nth-of-type(4) .cv2-line-grip')
    const firstRow = await page.$('.cv2-line[data-note-id]')
    if (grip && firstRow) {
      const g = await grip.boundingBox()
      const f = await firstRow.boundingBox()
      await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
      await page.mouse.down()
      await page.mouse.move(f.x + f.width / 2, f.y + 3, { steps: 8 })
      await sleep(200)
      await page.mouse.up()
      await sleep(1600)
    }
    const afterDrag = await page.evaluate(() => Array.from(document.querySelectorAll('.cv2-line[data-note-id]'))
      .map(r => `${getComputedStyle(r).getPropertyValue('--depth').trim()}:${(r.querySelector('.cv2-line-text') || {}).innerText?.trim() ?? ''}`))
    console.log('after drag:', JSON.stringify(afterDrag))

    const shape = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.cv2-line[data-note-id]'))
      const openLine = document.querySelector('.cv2-line.is-new')
      const title = document.querySelector('.cv2-dragbar-listname')
      return {
        title: title ? title.innerText.trim() : null,
        lines: rows.map(r => ({
          text: (r.querySelector('.cv2-line-text') || {}).innerText?.trim() ?? '',
          depth: Number(getComputedStyle(r).getPropertyValue('--depth') || 0),
        })),
        openLineDepth: openLine ? Number(getComputedStyle(openLine).getPropertyValue('--depth') || 0) : null,
        noteTabsPresent: !!document.querySelector('.cv2-notetabs'),
        headPresent: !!document.querySelector('.cv2-listpane-head'),
        sideCardRows: document.querySelectorAll('.cv2-peek.is-pinned .cv2-peek-row').length,
        footButtons: Array.from(document.querySelectorAll('.cv2-listfoot-btn')).map(b => b.innerText.trim()),
      }
    })
    console.log(JSON.stringify(shape, null, 2))

    await page.screenshot({ path: out })
    console.log(`shot: ${out}`)

    // Delete the list: one click arms, the second acts.
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('.cv2-listfoot-btn')).find(b => b.classList.contains('is-danger'))
      if (btn) btn.click()
    })
    await sleep(400)
    const armed = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('.cv2-listfoot-btn')).find(b => b.classList.contains('is-danger'))
      return btn ? { armed: btn.classList.contains('is-armed'), label: btn.innerText.trim() } : null
    })
    console.log('delete armed:', JSON.stringify(armed))
    await page.screenshot({ path: out.replace(/\.png$/, '-armed.png') })
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('.cv2-listfoot-btn')).find(b => b.classList.contains('is-danger'))
      if (btn) btn.click()
    })
    await sleep(1800)
    const afterDelete = await page.evaluate(() => ({
      lines: document.querySelectorAll('.cv2-line[data-note-id]').length,
      blank: !!document.querySelector('.cv2-list-blank'),
      title: (document.querySelector('.cv2-dragbar-listname') || {}).innerText?.trim() ?? null,
      sideCardRows: document.querySelectorAll('.cv2-peek.is-pinned .cv2-peek-row').length,
    }))
    console.log('after delete:', JSON.stringify(afterDelete))
    await page.screenshot({ path: out.replace(/\.png$/, '-deleted.png') })

    // ── The NOTES tab still reorders on the desk. The tree's drag now goes
    //    through the same `note:move` op as a list line, so it is worth
    //    proving the old gesture still lands.
    await page.evaluate(l => {
      window.__hypercombEffectBus.emit('note:commit', { cellLabel: l, text: 'alpha' })
    }, labels[0])
    await sleep(1600)
    await page.evaluate(l => {
      window.__hypercombEffectBus.emit('note:commit', { cellLabel: l, text: 'beta' })
    }, labels[0])
    await sleep(1600)
    await page.evaluate(() => {
      const tab = Array.from(document.querySelectorAll('.cv2-tab'))
        .find(t => (t.innerText || '').trim().toLowerCase() === 'notes')
      if (tab) tab.click()
    })
    await sleep(400)

    // Docked notes tab: no selector row of any kind, and the pinned card
    // beside the window IS the selector — click one of its rows and that
    // note has to be the one the pane is reading.
    const cardPick = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.cv2-peek.is-pinned .cv2-peek-row'))
      const target = rows.find(r => r.innerText.trim() === 'alpha')
      if (target) target.click()
      return {
        noteTabsPresent: !!document.querySelector('.cv2-notetabs'),
        cardRows: rows.map(r => r.innerText.trim()),
        cardAdd: !!document.querySelector('.cv2-peek.is-pinned .cv2-peek-add'),
      }
    })
    await sleep(500)
    const reading = await page.evaluate(() => {
      const el = document.querySelector('.cv2-reading-text, .cv2-reading-scroll')
      const active = document.querySelector('.cv2-peek-row.is-active')
      return { pane: el ? el.innerText.trim().slice(0, 40) : null, active: active ? active.innerText.trim() : null }
    })
    console.log('docked notes tab:', JSON.stringify({ ...cardPick, ...reading }))
    await page.screenshot({ path: out.replace(/\.png$/, '-docked-notes.png') })

    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('.cv2-mini-btn'))
        .find(b => (b.getAttribute('title') || '').toLowerCase().includes('full'))
      if (btn) btn.click()
    })
    await sleep(900)
    const roots = await page.evaluate(() => Array.from(document.querySelectorAll('.cv2-list > .cv2-note[data-note-id]'))
      .map(r => r.innerText.split(String.fromCharCode(10))[0]))
    console.log('desk roots before:', JSON.stringify(roots))
    const grips = await page.$$('.cv2-list > .cv2-note[data-note-id] .cv2-note-grip')
    if (grips.length >= 2) {
      const last = await grips[grips.length - 1].boundingBox()
      const firstRow = await (await page.$('.cv2-list > .cv2-note[data-note-id]')).boundingBox()
      await page.mouse.move(last.x + 2, last.y + last.height / 2)
      await page.mouse.down()
      await page.mouse.move(firstRow.x + firstRow.width / 2, firstRow.y + 3, { steps: 8 })
      await sleep(200)
      await page.mouse.up()
      await sleep(1800)
    }
    const rootsAfter = await page.evaluate(() => Array.from(document.querySelectorAll('.cv2-list > .cv2-note[data-note-id]'))
      .map(r => r.innerText.split(String.fromCharCode(10))[0]))
    console.log('desk roots after: ', JSON.stringify(rootsAfter))
    await page.screenshot({ path: out.replace(/\.png$/, '-desk.png') })

    // The desk's lists tab — three columns, the pane holding one list whole.
    await page.evaluate(() => {
      const tab = Array.from(document.querySelectorAll('.cv2-tab'))
        .find(t => (t.innerText || '').trim().toLowerCase() === 'lists')
      if (tab) tab.click()
    })
    await sleep(400)
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('.cv2-listfoot-btn'))
        .find(b => !b.classList.contains('is-danger'))
      if (btn) btn.click()
    })
    await sleep(1600)
    await line('pack the car')
    await line('jack', 1)
    await line('water')
    await page.screenshot({ path: out.replace(/\.png$/, '-desk-lists.png') })
    if (errors.length) console.log(`page errors:\n${errors.slice(0, 8).join('\n')}`)
  } finally {
    await browser.close()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
