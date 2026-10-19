#!/usr/bin/env node
// drive-window-restore — DOES THE HIVE COME BACK? Drive every open/close path of
// the chat window, the notes desk and the Beehaviors panel (plus the palette,
// the editor, a view, Escape, Back and a reload) on the dev shell and record,
// after every step, what the canvas, the view-mode owners, the window session
// and the viewport look like. Audit: documentation/tool-window-restore-audit-2026-10-18.md
//
// OWN BROWSER PROFILE, always (own OPFS): never a second tab on the
// participant's hive.
//
//   node scripts/drive-window-restore.cjs [--url http://localhost:4250/] [--headed]
//                                        [--engine chrome|msedge|chromium] [--out <file>]
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

const arg = (name, fallback) => {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : true
}
const URL = arg('url', 'http://localhost:4250/')
const HEADED = !!arg('headed', false)
const ENGINE = arg('engine', 'chrome')
const OUT = arg('out', path.join(require('node:os').tmpdir(), 'hypercomb-drive-window-restore.json'))
const VIEW = { width: 1400, height: 900 }

const log = (...a) => console.log(...a)
const errors = []
const report = { url: URL, headed: HEADED, scenarios: [] }

async function main() {
  const launch = ENGINE === 'chromium' ? {} : { channel: ENGINE }
  const browser = await chromium.launch({
    headless: !HEADED, ...launch,
    args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=default'],
  })
  const ctx = await browser.newContext({ viewport: VIEW })
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push({ when: current, kind: 'pageerror', text: String(e.message).slice(0, 300) }))
  page.on('console', m => {
    if (m.type() === 'error' || m.type() === 'warning') {
      const t = m.text()
      if (/ResizeObserver loop|favicon|DevTools/.test(t)) return
      errors.push({ when: current, kind: m.type(), text: t.slice(0, 300) })
    }
  })
  await page.addInitScript(() => {
    try {
      localStorage.setItem('hc:example-hives:dismissed', 'true')
      localStorage.setItem('hc:verbose', '0')
    } catch { /* ignore */ }
  })
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await ready(page)
  await page.waitForFunction(() => !!window.ioc?.get?.('@diamondcoreprocessor.com/ModeRegistry') && !!document.getElementById('pixi-host'), null, { timeout: 90000 })
  await page.waitForFunction(() => !!window.__hypercombEffectBus.lastValue?.get?.('render:host-ready') || !!window.__hypercombEffectBus.lastValue?.get?.('render:unsupported'), null, { timeout: 60000 }).catch(() => {})
  report.gpu = await page.evaluate(() => {
    const bus = window.__hypercombEffectBus
    const hr = bus.lastValue.get('render:host-ready')
    return {
      renderer: hr?.app?.renderer?.name ?? null,
      unsupported: bus.lastValue.get('render:unsupported') ?? null,
      webgl2: !!document.createElement('canvas').getContext('webgl2'),
      visibility: document.visibilityState,
    }
  })
  log('gpu', JSON.stringify(report.gpu))

  // Seed tiles so "content reappears" is a real question.
  await dismissCovers(page)
  for (const name of ['alpha', 'beta', 'gamma']) await submit(page, `create ${name}`)
  await page.waitForTimeout(2500)
  await page.waitForFunction(() => (window.__hypercombEffectBus.lastValue.get('render:cell-count')?.count ?? 0) >= 3, null, { timeout: 15000 }).catch(() => {})
  const seeded = await snap(page, 'seeded')
  report.seeded = seeded
  log('seeded', brief(seeded))

  const S = (name, steps) => scenario(page, name, steps)

  // ── chat ────────────────────────────────────────────────────────────
  await S('chat: toggle open → toggle close', [
    ['open', () => emit(page, 'chat:toggle', {})],
    ['close', () => emit(page, 'chat:toggle', {})],
  ])
  await S('chat: open → chat:close', [
    ['open', () => emit(page, 'chat:open', {})],
    ['close', () => emit(page, 'chat:close', {})],
  ])
  await S('chat: open → × (hcDockedPanelClose)', [
    ['open', () => emit(page, 'chat:open', {})],
    ['close ×', () => page.click('[hcdockedpanel="chat-window"] .hc-panel-close, [hcdockedpanel="chat-window"] button[aria-label*="lose" i]', { timeout: 3000 }).catch(e => ({ skipped: String(e.message).slice(0, 80) }))],
  ])
  await S('chat: open → Escape (sweep parks) → wait 4s', [
    ['open', () => emit(page, 'chat:open', {})],
    ['escape', () => page.keyboard.press('Escape')],
    ['wait 4s', () => page.waitForTimeout(4000)],
  ])
  await S('chat: open → Escape → Escape (put back) → chat:close', [
    ['open', () => emit(page, 'chat:open', {})],
    ['escape', () => page.keyboard.press('Escape')],
    ['escape again', async () => { await page.waitForTimeout(300); await page.keyboard.press('Escape') }],
    ['close', () => emit(page, 'chat:close', {})],
  ])
  await S('chat: open → peek (fold) → close', [
    ['open', () => emit(page, 'chat:open', {})],
    ['peek', () => page.click('.chat-peek', { timeout: 3000 }).catch(e => ({ skipped: String(e.message).slice(0, 80) }))],
    ['close', () => emit(page, 'chat:close', {})],
  ])
  // Escape on a folded chat UNFOLDS it (the window's own dismiss, one level);
  // the press after parks it. Two presses to the hexagons, by design.
  await S('chat: open → peek → Escape (unfold) → Escape (park) → wait 4s', [
    ['open', () => emit(page, 'chat:open', {})],
    ['peek', () => page.click('.chat-peek', { timeout: 3000 }).catch(e => ({ skipped: String(e.message).slice(0, 80) }))],
    ['escape', () => page.keyboard.press('Escape')],
    ['escape again', async () => { await page.waitForTimeout(300); await page.keyboard.press('Escape') }],
    ['wait 4s', () => page.waitForTimeout(4000)],
  ])
  await S('chat: open → navigate under it → close', [
    ['open', () => emit(page, 'chat:open', {})],
    ['goRaw alpha', () => page.evaluate(() => window.ioc.get('@hypercomb.social/Navigation').goRaw(['alpha']))],
    ['close', () => emit(page, 'chat:close', {})],
    ['back to root', () => page.evaluate(() => window.ioc.get('@hypercomb.social/Navigation').goRaw([]))],
  ])
  await S('chat: open → browser BACK (view-back trap) → close', [
    ['open', () => emit(page, 'chat:open', {})],
    ['history.state', () => page.evaluate(() => ({ state: history.state, len: history.length }))],
    ['back', async () => {
      const ours = await page.evaluate(() => typeof history.state?.hcView === 'string')
      if (!ours) return { skipped: 'trap not armed' }
      await page.goBack({ waitUntil: 'commit' }).catch(() => {})
      await page.waitForTimeout(600)
    }],
    ['close', () => emit(page, 'chat:close', {})],
  ])

  // ── notes ───────────────────────────────────────────────────────────
  await S('notes: panel open → panel close', [
    ['open', () => emit(page, 'notes:panel', { visible: true })],
    ['close', () => emit(page, 'notes:panel', { visible: false })],
  ])
  await S('notes: open → Escape (sweep) → wait 4s', [
    ['open', () => emit(page, 'notes:panel', { visible: true })],
    ['escape', () => page.keyboard.press('Escape')],
    ['wait 4s', () => page.waitForTimeout(4000)],
  ])
  await S('notes: open → Escape → Escape (back) → close', [
    ['open', () => emit(page, 'notes:panel', { visible: true })],
    ['escape', () => page.keyboard.press('Escape')],
    ['escape again', async () => { await page.waitForTimeout(300); await page.keyboard.press('Escape') }],
    ['close', () => emit(page, 'notes:panel', { visible: false })],
  ])
  await S('notes: open → × (hide)', [
    ['open', () => emit(page, 'notes:panel', { visible: true })],
    ['close ×', () => page.click('[hcdockedpanel="notes-strip"] .hc-panel-close, [hcdockedpanel="notes-strip"] button[aria-label*="lose" i]', { timeout: 3000 }).catch(e => ({ skipped: String(e.message).slice(0, 80) }))],
  ])

  // ── behaviours ──────────────────────────────────────────────────────
  await S('behaviours: context-open → viewer-close', [
    ['open', () => emit(page, 'features:context-open', {})],
    ['close', () => emit(page, 'features:viewer-close', {})],
  ])
  await S('behaviours: open → Escape (sweep) → wait 4s', [
    ['open', () => emit(page, 'features:context-open', {})],
    ['escape', () => page.keyboard.press('Escape')],
    ['wait 4s', () => page.waitForTimeout(4000)],
  ])
  await S('behaviours: open → Escape → Escape (back) → close', [
    ['open', () => emit(page, 'features:context-open', {})],
    ['escape', () => page.keyboard.press('Escape')],
    ['escape again', async () => { await page.waitForTimeout(300); await page.keyboard.press('Escape') }],
    ['close', () => emit(page, 'features:viewer-close', {})],
  ])

  // ── pairings ────────────────────────────────────────────────────────
  // The F3 table: the one-window rule parks the window you were in when
  // another opens, and the newcomer's CLOSE brings it back (a park does not —
  // see the Escape case below). Each ends by closing the restored window, so
  // the end-state verdict is the bare hive.
  await S('pair: chat → notes (rule parks chat) → notes close (chat back)', [
    ['chat open', () => emit(page, 'chat:open', {})],
    ['notes open', () => emit(page, 'notes:panel', { visible: true })],
    ['notes close', () => emit(page, 'notes:panel', { visible: false })],
    ['chat back?', () => expectShowing(page, ['chat-window'])],
    ['chat close', () => emit(page, 'chat:close', {})],
  ])
  await S('pair: notes → chat → chat close (notes back)', [
    ['notes open', () => emit(page, 'notes:panel', { visible: true })],
    ['chat open', () => emit(page, 'chat:open', {})],
    ['chat close', () => emit(page, 'chat:close', {})],
    ['notes back?', () => expectShowing(page, ['notes-strip', 'tags-viewer'])],
    ['notes close', () => emit(page, 'notes:panel', { visible: false })],
  ])
  await S('pair: chat → behaviours → behaviours close (chat back)', [
    ['chat open', () => emit(page, 'chat:open', {})],
    ['behaviours open', () => emit(page, 'features:context-open', {})],
    ['behaviours close', () => emit(page, 'features:viewer-close', {})],
    ['chat back?', () => expectShowing(page, ['chat-window'])],
    ['chat close', () => emit(page, 'chat:close', {})],
  ])
  await S('pair: behaviours → chat → chat close (behaviours back)', [
    ['behaviours open', () => emit(page, 'features:context-open', {})],
    ['chat open', () => emit(page, 'chat:open', {})],
    ['chat close', () => emit(page, 'chat:close', {})],
    ['behaviours back?', () => expectShowing(page, ['features-viewer'])],
    ['behaviours close', () => emit(page, 'features:viewer-close', {})],
  ])
  await S('pair: notes → behaviours → behaviours close (notes back)', [
    ['notes open', () => emit(page, 'notes:panel', { visible: true })],
    ['behaviours open', () => emit(page, 'features:context-open', {})],
    ['behaviours close', () => emit(page, 'features:viewer-close', {})],
    ['notes back?', () => expectShowing(page, ['notes-strip', 'tags-viewer'])],
    ['notes close', () => emit(page, 'notes:panel', { visible: false })],
  ])
  await S('pair: behaviours → notes → notes close (behaviours back)', [
    ['behaviours open', () => emit(page, 'features:context-open', {})],
    ['notes open', () => emit(page, 'notes:panel', { visible: true })],
    ['notes close', () => emit(page, 'notes:panel', { visible: false })],
    ['behaviours back?', () => expectShowing(page, ['features-viewer'])],
    ['behaviours close', () => emit(page, 'features:viewer-close', {})],
  ])
  await S('pair: chat → notes → Escape → Escape (back) → Escape', [
    ['chat open', () => emit(page, 'chat:open', {})],
    ['notes open', () => emit(page, 'notes:panel', { visible: true })],
    ['escape', () => page.keyboard.press('Escape')],
    ['escape again', async () => { await page.waitForTimeout(300); await page.keyboard.press('Escape') }],
    ['escape third', async () => { await page.waitForTimeout(300); await page.keyboard.press('Escape') }],
    ['wait 4s', () => page.waitForTimeout(4000)],
  ])

  // ── views and editor ────────────────────────────────────────────────
  await S('view: tree on → chat open → chat close → tree off', [
    ['tree on', () => emit(page, 'view:toggle', { view: 'tree', mode: 'on' })],
    ['chat open', () => emit(page, 'chat:open', {})],
    ['chat close', () => emit(page, 'chat:close', {})],
    ['tree off', () => emit(page, 'view:toggle', { view: 'tree', mode: 'off' })],
  ])
  await S('view: tree on → behaviours open (peel) → behaviours close', [
    ['tree on', () => emit(page, 'view:toggle', { view: 'tree', mode: 'on' })],
    ['behaviours open', () => emit(page, 'features:context-open', {})],
    ['behaviours close', () => emit(page, 'features:viewer-close', {})],
  ])
  // ── F3, the other half: a PARK (Escape's sweep) restores nothing ──────
  await S('restore: chat → notes → Escape (park) → wait 4s → nothing back', [
    ['chat open', () => emit(page, 'chat:open', {})],
    ['notes open', () => emit(page, 'notes:panel', { visible: true })],
    ['escape', () => page.keyboard.press('Escape')],
    ['wait 4s', () => page.waitForTimeout(4000)],
    ['nothing back?', () => expectShowing(page, [])],
  ])
  // ── F4: the door that displaces an edit says "draft kept" ──────────
  await S('editor: edit alpha (changed) → chat open (toast) → chat close → editor stays shut', [
    ['edit', () => emit(page, 'tile:action', { action: 'edit', label: 'alpha', q: 0, r: 0, index: 0 })],
    ['change link', () => page.evaluate(() => { window.ioc.get('@diamondcoreprocessor.com/TileEditorService').setLink('https://example.test/kept'); return { dirty: window.ioc.get('@diamondcoreprocessor.com/TileEditorService').dirty } })],
    ['chat open', () => emit(page, 'chat:open', {})],
    ['toast?', () => page.evaluate(() => {
      const toast = window.__hypercombEffectBus.lastValue.get('toast:show')
      const message = String(toast?.message ?? '')
      return /draft kept/i.test(message) ? { toast: message, door: toast?.actionEffect } : { fail: `no draft-kept toast: ${JSON.stringify(toast ?? null).slice(0, 120)}` }
    })],
    ['chat close', () => emit(page, 'chat:close', {})],
    ['editor shut?', () => expectShowing(page, [])],
  ])
  await S('editor: edit alpha → chat open → chat close → Escape', [
    ['edit', () => emit(page, 'tile:action', { action: 'edit', label: 'alpha', q: 0, r: 0, index: 0 })],
    ['chat open', () => emit(page, 'chat:open', {})],
    ['chat close', () => emit(page, 'chat:close', {})],
    ['escape', () => page.keyboard.press('Escape')],
    ['escape', async () => { await page.waitForTimeout(3500); await page.keyboard.press('Escape') }],
  ])

  // ── focus-inside Escape, recovery, the palette, position ───────────
  await S('chat: open → focus input → Escape → wait 4s', [
    ['open', () => emit(page, 'chat:open', {})],
    ['focus input', () => page.click('.chat-input', { timeout: 3000 }).catch(e => ({ skipped: String(e.message).slice(0, 80) }))],
    ['escape', () => page.keyboard.press('Escape')],
    ['wait 4s', () => page.waitForTimeout(4000)],
  ])
  await S('chat: open → focus input → Escape → Escape (back) → close', [
    ['open', () => emit(page, 'chat:open', {})],
    ['focus input', () => page.click('.chat-input', { timeout: 3000 }).catch(e => ({ skipped: String(e.message).slice(0, 80) }))],
    ['escape', () => page.keyboard.press('Escape')],
    ['escape again', async () => { await page.waitForTimeout(300); await page.keyboard.press('Escape') }],
    ['close', () => emit(page, 'chat:close', {})],
  ])
  await S('chat: open → peek → Escape → Escape (back) → close  [recovery]', [
    ['open', () => emit(page, 'chat:open', {})],
    ['peek', () => page.click('.chat-peek', { timeout: 3000 }).catch(e => ({ skipped: String(e.message).slice(0, 80) }))],
    ['escape', () => page.keyboard.press('Escape')],
    ['escape again', async () => { await page.waitForTimeout(300); await page.keyboard.press('Escape') }],
    ['close', () => emit(page, 'chat:close', {})],
  ])
  await S('chat: open → peek → Escape → chat:open → chat:close  [recovery via door]', [
    ['open', () => emit(page, 'chat:open', {})],
    ['peek', () => page.click('.chat-peek', { timeout: 3000 }).catch(e => ({ skipped: String(e.message).slice(0, 80) }))],
    ['escape', () => page.keyboard.press('Escape')],
    ['wait 4s', () => page.waitForTimeout(4000)],
    ['open again', () => emit(page, 'chat:open', {})],
    ['close', () => emit(page, 'chat:close', {})],
  ])
  await S('chat: open → peek → blur (click hive) → Escape → wait 4s', [
    ['open', () => emit(page, 'chat:open', {})],
    ['peek', () => page.click('.chat-peek', { timeout: 3000 }).catch(e => ({ skipped: String(e.message).slice(0, 80) }))],
    ['blur to body', () => page.evaluate(() => { document.activeElement?.blur?.() })],
    ['escape', () => page.keyboard.press('Escape')],
    ['wait 4s', () => page.waitForTimeout(4000)],
  ])
  await S('notes: open → focus composer → Escape → wait 4s', [
    ['open', () => emit(page, 'notes:panel', { visible: true })],
    ['focus composer', () => page.click('[hcdockedpanel="notes-strip"] textarea', { timeout: 3000 }).catch(e => ({ skipped: String(e.message).slice(0, 80) }))],
    ['escape', () => page.keyboard.press('Escape')],
    ['wait 4s', () => page.waitForTimeout(4000)],
  ])
  await S('notes: open → close → palette left standing → tags:view-close', [
    ['open', () => emit(page, 'notes:panel', { visible: true })],
    ['close', () => emit(page, 'notes:panel', { visible: false })],
    ['tags close', () => emit(page, 'tags:view-close', {})],
  ])
  await S('palette: tags:view-open → tags:view-close', [
    ['open', () => emit(page, 'tags:view-open', {})],
    ['close', () => emit(page, 'tags:view-close', {})],
  ])
  await S('pair: palette + chat → chat close', [
    ['palette open', () => emit(page, 'tags:view-open', {})],
    ['chat open', () => emit(page, 'chat:open', {})],
    ['chat close', () => emit(page, 'chat:close', {})],
    ['tags close', () => emit(page, 'tags:view-close', {})],
  ])
  await S('pair: palette + behaviours → behaviours close', [
    ['palette open', () => emit(page, 'tags:view-open', {})],
    ['behaviours open', () => emit(page, 'features:context-open', {})],
    ['behaviours close', () => emit(page, 'features:viewer-close', {})],
    ['tags close', () => emit(page, 'tags:view-close', {})],
  ])
  await S('position: user pan → behaviours open → close (pan kept?)', [
    ['pan 150,90', async () => {
      await page.evaluate(() => window.ioc.get('@diamondcoreprocessor.com/ViewportPersistence').setPan(150, 90, 'user'))
      await page.evaluate(() => window.dispatchEvent(new Event('resize')))
      await page.waitForTimeout(400)
    }],
    ['behaviours open', () => emit(page, 'features:context-open', {})],
    ['behaviours close', () => emit(page, 'features:viewer-close', {})],
    ['pan reset', async () => {
      await page.evaluate(() => window.ioc.get('@diamondcoreprocessor.com/ViewportPersistence').setPan(0, 0, 'user'))
      await page.evaluate(() => window.dispatchEvent(new Event('resize')))
    }],
  ])
  await S('position: user pan → chat open → close (pan kept?)', [
    ['pan 150,90', async () => {
      await page.evaluate(() => window.ioc.get('@diamondcoreprocessor.com/ViewportPersistence').setPan(150, 90, 'user'))
      await page.evaluate(() => window.dispatchEvent(new Event('resize')))
      await page.waitForTimeout(400)
    }],
    ['chat open', () => emit(page, 'chat:open', {})],
    ['chat close', () => emit(page, 'chat:close', {})],
    ['pan reset', async () => {
      await page.evaluate(() => window.ioc.get('@diamondcoreprocessor.com/ViewportPersistence').setPan(0, 0, 'user'))
      await page.evaluate(() => window.dispatchEvent(new Event('resize')))
    }],
  ])
  await S('editor: edit alpha → notes open → notes close (editor parked = cancelled?)', [
    ['edit', () => emit(page, 'tile:action', { action: 'edit', label: 'alpha', q: 0, r: 0, index: 0 })],
    ['notes open', () => emit(page, 'notes:panel', { visible: true })],
    ['notes close', () => emit(page, 'notes:panel', { visible: false })],
    ['tags close', () => emit(page, 'tags:view-close', {})],
  ])

  // ── reload with chat remembered open ───────────────────────────────
  await S('reload: chat remembered open → boot → chat close', [
    ['remember open', () => page.evaluate(() => localStorage.setItem('hc:chat-visible', '1'))],
    ['reload', async () => {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await ready(page)
      await page.waitForFunction(() => !!window.ioc?.get?.('@diamondcoreprocessor.com/ModeRegistry'), null, { timeout: 90000 })
      await page.waitForFunction(() => !!window.__hypercombEffectBus.lastValue?.get?.('render:host-ready') || !!window.__hypercombEffectBus.lastValue?.get?.('render:unsupported'), null, { timeout: 60000 }).catch(() => {})
      await page.waitForTimeout(2500)
    }],
    ['chat close', () => emit(page, 'chat:close', {})],
  ])

  report.errors = errors
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2))
  log('\nwrote', OUT)
  await browser.close()
}

let current = 'boot'

async function scenario(page, name, steps) {
  current = name
  const rec = { name, steps: [] }
  log(`\n── ${name}`)
  for (const [desc, run] of steps) {
    let result
    try { result = await run() } catch (e) { result = { error: String(e.message).slice(0, 160) } }
    await page.waitForTimeout(700)
    const s = await snap(page, desc)
    if (result && typeof result === 'object') s.result = result
    rec.steps.push(s)
    log(`  ${desc.padEnd(16)} ${brief(s)}`)
  }
  const last = rec.steps[rec.steps.length - 1]
  // A step may assert something of its own by returning { fail: '…' } — the
  // restore scenarios ask "is the displaced window back?" mid-way, where the
  // end-state verdict (the bare hive) cannot see it.
  const failed = rec.steps.find(s => s.result && typeof s.result.fail === 'string')
  rec.verdict = failed ? `FAIL: ${failed.label}: ${failed.result.fail}` : verdict(last)
  log(`  ⇒ ${rec.verdict}`)
  report.scenarios.push(rec)
  // Reset to a clean slate between scenarios: close everything, forget parks,
  // release any stranded view claim so one scenario cannot poison the next.
  await emit(page, 'chat:close', {})
  await emit(page, 'notes:panel', { visible: false })
  await emit(page, 'features:viewer-close', {})
  await emit(page, 'tags:view-close', {})
  await emit(page, 'view:toggle', { view: 'tree', mode: 'off' })
  await page.evaluate(() => {
    const ws = globalThis.__hypercombWindowSession
    if (ws) for (const p of ws.parked) { try { p.session.unpark() } catch {} }
    if (ws) ws.parked = []
  })
  await emit(page, 'chat:close', {})
  await emit(page, 'notes:panel', { visible: false })
  await emit(page, 'features:viewer-close', {})
  await emit(page, 'tags:view-close', {})
  await page.evaluate(() => {
    const modes = window.ioc.get('@diamondcoreprocessor.com/ModeRegistry')
    for (const o of modes.ownersOf('view:active')) modes.releaseOwner(o)
    document.body.focus?.(); if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur?.()
  })
  await page.waitForTimeout(500)
}

function verdict(s) {
  const bad = []
  if (s.hostVisible !== 'visible') bad.push(`host ${s.hostVisible}`)
  if (s.canvasVisible !== 'visible') bad.push(`canvas ${s.canvasVisible}`)
  if ((s.owners ?? []).length) bad.push(`view:active owners ${JSON.stringify(s.owners)}`)
  if ((s.bodyView ?? []).includes('hc-view-covered')) bad.push('body covered')
  if (s.hostBox && (Math.abs(s.hostBox[2] - VIEW.width) > 4 || Math.abs(s.hostBox[3] - VIEW.height) > 4)) bad.push(`host box ${s.hostBox.join(',')}`)
  if ((s.covers ?? []).length) bad.push(`covered by ${s.covers.join(' ')}`)
  if (s.header !== 'visible') bad.push(`header ${s.header}`)
  if (s.cellCount && s.cellCount.count === 0) bad.push('cell-count 0')
  return bad.length ? `FAIL: ${bad.join('; ')}` : 'ok'
}

const brief = (s) => `host=${s.hostVisible}/${s.hostBox?.join('x')} owners=${JSON.stringify(s.owners)} vm=${s.viewMode} cells=${s.cellCount?.count ?? '?'} showing=${JSON.stringify(s.showing)} parked=${JSON.stringify(s.parked)} covers=${JSON.stringify(s.covers)} stage=${s.stage ? `${s.stage.x},${s.stage.y}@${s.stage.s}` : '?'} seg=${JSON.stringify(s.segments)}${s.result ? ' ' + JSON.stringify(s.result) : ''}`

/** A mid-scenario assertion: exactly these windows are showing (sorted). */
const expectShowing = async (page, want) => {
  const have = await page.evaluate(() => [...(globalThis.__hypercombWindowSession?.showing.keys() ?? [])])
  const a = [...have].sort().join(','), b = [...want].sort().join(',')
  return a === b ? { showing: have } : { fail: `showing [${a}], wanted [${b}]` }
}

const ready = async (page) => {
  await page.waitForFunction(() => !!window.__hypercombEffectBus, null, { timeout: 90000 })
}
const emit = (page, effect, payload) => page.evaluate(([e, p]) => window.__hypercombEffectBus.emit(e, p), [effect, payload])
const submit = async (page, text) => {
  await ready(page)
  await page.evaluate(t => window.__hypercombEffectBus.emit('command-line:remote-submit', { text: t }), text)
  await page.waitForTimeout(600)
}

async function dismissCovers(page) {
  // Anything full-bleed above the canvas at boot (offers, prompts): say what it is.
  const covers = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => {
    const s = getComputedStyle(el); const r = el.getBoundingClientRect()
    return (s.position === 'fixed' || s.position === 'absolute') && +s.zIndex >= 59990 && s.visibility !== 'hidden' && s.display !== 'none' && r.width > 600 && r.height > 400 && el.id !== 'pixi-host' && !el.closest('#pixi-host')
  }).map(el => el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]))
  if (covers.length) log('boot covers:', covers.join(' '))
  report.bootCovers = covers
}

async function snap(page, label) {
  return page.evaluate((label) => {
    const bus = window.__hypercombEffectBus
    const ioc = window.ioc
    const host = document.getElementById('pixi-host')
    const canvas = host?.querySelector('canvas')
    const modes = ioc.get('@diamondcoreprocessor.com/ModeRegistry')
    const vm = ioc.get('@hypercomb.social/ViewMode')
    const vp = ioc.get('@diamondcoreprocessor.com/ViewportPersistence')
    const lineage = ioc.get('@hypercomb.social/Lineage')
    const ws = globalThis.__hypercombWindowSession
    const hr = bus.lastValue.get('render:host-ready')
    const app = hr?.app
    const cs = host ? getComputedStyle(host) : null
    const r = host?.getBoundingClientRect()
    const vis = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).visibility : 'none' }
    const covers = [...document.querySelectorAll('body *')].filter(el => {
      const s = getComputedStyle(el); const b = el.getBoundingClientRect()
      return s.position === 'fixed' && +s.zIndex >= 59990 && s.visibility !== 'hidden' && s.display !== 'none' && s.pointerEvents !== 'none'
        && b.width > 600 && b.height > 400 && el.id !== 'pixi-host' && !el.closest('#pixi-host')
    }).map(el => el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]).slice(0, 6)
    return {
      label,
      hostVisible: cs?.visibility ?? 'none', hostInlineVis: host?.style.visibility ?? '',
      canvasVisible: canvas ? getComputedStyle(canvas).visibility : 'none',
      hostBox: r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null,
      hostInset: host ? [host.style.left, host.style.right, host.style.top, host.style.bottom].join(' ') : null,
      owners: modes?.ownersOf?.('view:active') ?? null, keeps: modes?.ownersOf?.('view:keeps-controls') ?? null,
      bodyView: [...document.body.classList].filter(c => c.startsWith('hc-view')),
      viewMode: vm?.mode,
      cellCount: bus.lastValue.get('render:cell-count') ? { count: bus.lastValue.get('render:cell-count').count, settled: bus.lastValue.get('render:cell-count').settled, key: bus.lastValue.get('render:cell-count').locationKey } : null,
      showing: ws ? [...ws.showing.keys()] : null, parked: ws ? ws.parked.map(p => p.id) : null,
      header: vis('.header-bar'), controls: vis('hc-controls-bar'),
      stage: app ? { x: Math.round(app.stage.position.x), y: Math.round(app.stage.position.y), s: +(app.stage.scale?.x ?? 1).toFixed(3) } : null,
      screen: app ? [Math.round(app.renderer.screen.width), Math.round(app.renderer.screen.height)] : null,
      zoom: vp?.lastZoom ?? null, pan: vp?.lastPan ?? null,
      segments: lineage?.explorerSegments?.() ?? null,
      editor: bus.lastValue.get('editor:mode') ?? null,
      chat: bus.lastValue.get('chat:window-state')?.open ?? null, notes: bus.lastValue.get('notes:panel-state')?.open ?? null, feats: bus.lastValue.get('features:viewer-state')?.open ?? null,
      historyState: history.state,
      covers,
    }
  }, label)
}

main().catch(e => { console.error(e); process.exit(1) })
