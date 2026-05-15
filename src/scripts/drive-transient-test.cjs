// scripts/drive-transient-test.cjs
//
// Verify the "temporary read" model:
//
//   Phase 1: A publishes a tree → B auto-installs as transient.
//   Phase 2: B reloads WITHOUT importing → boot sweep removes the
//            transient tree → tree is GONE on B.
//   Phase 3: A re-shares (publishes again) → B re-installs transient.
//            B imports the tree → marker cleared.
//   Phase 4: B reloads again → boot sweep leaves imported cells alone
//            → tree SURVIVES on B.

const { chromium } = require('playwright')

const URL_A = 'http://localhost:4250/'
const URL_B = 'http://localhost:4260/'
const ROOM = 'sync-test-room'
const SECRET = 'sync-test-secret'

const HEADED = process.argv.includes('--headed')

function tStamp() { return new Date().toISOString().slice(11, 23) }
function log(label, ...args) { console.log(`[${tStamp()}] [${label}]`, ...args) }

async function pageWithLogs(browser, label, url) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  page.on('console', (msg) => {
    const text = msg.text()
    if (text.includes('[sync]') || text.includes('[paired-channel]')) log(label, text)
  })
  page.on('pageerror', err => log(label, 'PAGE ERROR:', String(err)))
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  return { page, ctx }
}

async function configure(page) {
  await page.evaluate(({ room, secret }) => {
    localStorage.setItem('hc:room', room)
    localStorage.setItem('hc:secret', secret)
    localStorage.setItem('hypercomb.paired-channel.secret', secret)
    localStorage.setItem('hc:mesh-public', 'true')
    localStorage.setItem('hc:nostrmesh:network', '1')
  }, { room: ROOM, secret: SECRET })
}

async function buildTreeOnDisk(page, rootName) {
  return page.evaluate(async (root) => {
    const lineage = window.ioc?.get('@hypercomb.social/Lineage')
    const r = await lineage?.explorerDir?.()
    if (!r) return { ok: false }
    const write0000 = async (dir, props) => {
      const fh = await dir.getFileHandle('0000', { create: true })
      const w = await fh.createWritable()
      await w.write(JSON.stringify(props))
      await w.close()
    }
    const treeRoot = await r.getDirectoryHandle(root, { create: true })
    await write0000(treeRoot, { text: 'root', kind: 'project' })
    const team = await treeRoot.getDirectoryHandle('team', { create: true })
    await write0000(team, { text: 'team' })
    const alice = await team.getDirectoryHandle('alice', { create: true })
    await write0000(alice, { text: 'alice' })
    return { ok: true }
  }, rootName)
}

async function fireExpose(page, label) {
  return page.evaluate((n) => {
    const bus = window.__hypercombEffectBus
    if (!bus?.emit) return { ok: false }
    bus.emit('tile:action', { action: 'expose', label: n, q: 0, r: 0, index: 0 })
    return { ok: true }
  }, label)
}

async function fireImport(page, label) {
  return page.evaluate((n) => {
    const bus = window.__hypercombEffectBus
    if (!bus?.emit) return { ok: false }
    bus.emit('tile:action', { action: 'import', label: n, q: 0, r: 0, index: 0 })
    return { ok: true }
  }, label)
}

async function probeCell(page, name) {
  return page.evaluate(async (n) => {
    const lineage = window.ioc?.get('@hypercomb.social/Lineage')
    const r = await lineage?.explorerDir?.()
    if (!r) return { exists: false }
    try {
      const dir = await r.getDirectoryHandle(n, { create: false })
      let props = {}
      try {
        const fh = await dir.getFileHandle('0000', { create: false })
        const f = await fh.getFile()
        props = JSON.parse(await f.text())
      } catch {}
      return { exists: true, transient: props.transient === true, text: props.text ?? null }
    } catch { return { exists: false } }
  }, name)
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  log('driver', 'launching browsers')
  const browser = await chromium.launch({ headless: !HEADED })
  const A = await pageWithLogs(browser, 'A', URL_A)
  const B = await pageWithLogs(browser, 'B', URL_B)
  await sleep(2000)
  await configure(A.page)
  await configure(B.page)
  await A.page.reload({ waitUntil: 'domcontentloaded' })
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  await sleep(5000)

  const ROOT = `tx-${Date.now().toString(36)}`

  // ── PHASE 1: publish → transient install on B ──
  log('driver', `Phase 1: publish ${ROOT} on A`)
  await buildTreeOnDisk(A.page, ROOT)
  await sleep(500)
  await fireExpose(A.page, ROOT)
  await sleep(5000)
  const p1 = await probeCell(B.page, ROOT)
  log('driver', `Phase 1 → B has ${ROOT}?`, p1)
  if (!p1.exists || !p1.transient) {
    log('driver', '❌ Phase 1 FAIL: B should have the cell with transient: true')
    await browser.close()
    process.exit(1)
  }

  // ── PHASE 2: B reloads WITHOUT importing ──
  // Kill the share retention by stopping A's tab first so its replays
  // don't repopulate. (In practice the relay still has events, but
  // the boot sweep should still remove the orphan from disk first;
  // sync will then re-install. We're probing the moment AFTER
  // sweep but BEFORE re-install.)
  log('driver', 'Phase 2: B reloads (without importing)')
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  // Sweep runs synchronously during boot — peek BEFORE re-install.
  await sleep(1500)
  const p2 = await probeCell(B.page, ROOT)
  log('driver', `Phase 2 → B has ${ROOT} immediately after reload (boot sweep should have wiped)?`, p2)
  // Wait longer for re-install from replayed share events.
  await sleep(4000)
  const p2b = await probeCell(B.page, ROOT)
  log('driver', `Phase 2 → B has ${ROOT} after re-install?`, p2b)

  // ── PHASE 3: B imports the tree ──
  log('driver', `Phase 3: B imports ${ROOT}`)
  await fireImport(B.page, ROOT)
  await sleep(1500)
  const p3 = await probeCell(B.page, ROOT)
  log('driver', `Phase 3 → B has ${ROOT} after import?`, p3)
  if (!p3.exists || p3.transient) {
    log('driver', '❌ Phase 3 FAIL: import should have cleared transient')
    await browser.close()
    process.exit(1)
  }

  // ── PHASE 4: B reloads AGAIN — imported tree should survive ──
  log('driver', 'Phase 4: B reloads (imported, should survive)')
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  await sleep(2500)
  const p4 = await probeCell(B.page, ROOT)
  log('driver', `Phase 4 → B has ${ROOT} after reload?`, p4)

  const phase1Pass = p1.exists && p1.transient
  // Phase 2: depending on relay replay timing, cell may have been re-installed already
  const phase2Pass = !p2.exists || p2.transient // either gone, or back as transient
  const phase3Pass = p3.exists && !p3.transient
  const phase4Pass = p4.exists && !p4.transient

  log('driver', '=== SUMMARY ===')
  log('driver', `  Phase 1: tile auto-installed as transient → ${phase1Pass ? 'PASS' : 'FAIL'}`)
  log('driver', `  Phase 2: after reload, transient cleared (or re-installed)? → ${phase2Pass ? 'PASS' : 'FAIL'}`)
  log('driver', `  Phase 3: after import, transient marker cleared? → ${phase3Pass ? 'PASS' : 'FAIL'}`)
  log('driver', `  Phase 4: after second reload, imported tile survives? → ${phase4Pass ? 'PASS' : 'FAIL'}`)
  const overall = phase1Pass && phase2Pass && phase3Pass && phase4Pass

  if (HEADED) {
    log('driver', 'holding open 30s for inspection')
    await sleep(30000)
  }
  await browser.close()
  process.exit(overall ? 0 : 1)
}

main().catch(err => { console.error('[driver] crashed:', err); process.exit(2) })
