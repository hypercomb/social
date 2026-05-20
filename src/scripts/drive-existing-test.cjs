// scripts/drive-existing-test.cjs
//
// Verify that PRE-EXISTING cells (added before sync is configured)
// flow to the peer when both sides join the channel.
//
//   1. Open A and B (no sync yet)
//   2. Add cell X on A, cell Y on B
//   3. Configure room/secret/mesh-public on both
//   4. Reload (drone joins channel, broadcasts existing)
//   5. Expect A to have BOTH X and Y; B to have BOTH X and Y

const { chromium } = require('playwright')

const URL_A = 'http://localhost:4250/'
const URL_B = 'http://localhost:4260/'
const ROOM = 'existing-test-room'
const SECRET = 'existing-test-secret'
const TILE_A = `prex-${Date.now().toString(36)}`
const TILE_B = `prey-${Date.now().toString(36)}`

async function pageWithLogs(browser, label, url) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  page.on('console', (msg) => {
    const text = msg.text()
    if (text.includes('[sync]') || text.includes('[paired-channel]')) {
      const t = new Date().toISOString().slice(11, 23)
      console.log(`[${t}] [${label}]`, text)
    }
  })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  return page
}

async function addTile(page, name) {
  const input = await page.$('hc-command-line input, input.command-input')
  if (!input) throw new Error('command input not found')
  await input.click({ delay: 50 })
  await input.fill('')
  await input.type(name, { delay: 20 })
  await page.keyboard.press('Enter')
  await new Promise(r => setTimeout(r, 500))
}

async function configureSync(page) {
  await page.evaluate(({ room, secret }) => {
    localStorage.setItem('hc:room', room)
    localStorage.setItem('hc:secret', secret)
    localStorage.setItem('hc:mesh-public', 'true')
    localStorage.setItem('hc:nostrmesh:network', '1')
    localStorage.removeItem('hc:secret-cleared')
  }, { room: ROOM, secret: SECRET })
}

async function ensureOpfsReady(page, timeoutMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await page.evaluate(async () => {
      try {
        const lin = window.ioc?.get('@hypercomb.social/Lineage')
        if (!lin?.explorerDir) return false
        return !!(await lin.explorerDir())
      } catch { return false }
    })
    if (ok) return true
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}

async function tileExists(page, name) {
  return page.evaluate(async (n) => {
    try {
      const lin = window.ioc?.get('@hypercomb.social/Lineage')
      const dir = await lin?.explorerDir?.()
      if (!dir) return false
      await dir.getDirectoryHandle(n, { create: false })
      return true
    } catch { return false }
  }, name)
}

async function clearSecretOnly(page) {
  // Reset just the sync identity so each test starts fresh, but
  // keep OPFS data so we can add tiles before sync.
  await page.evaluate(() => {
    localStorage.removeItem('hc:room')
    localStorage.removeItem('hc:secret')
    localStorage.setItem('hc:mesh-public', 'false')
  })
}

async function main() {
  const browser = await chromium.launch({ headless: true })

  // Phase 1: clean slate (no sync, no leftover tiles)
  const setupA = await browser.newContext()
  const setupB = await browser.newContext()
  const pa0 = await setupA.newPage()
  const pb0 = await setupB.newPage()
  await pa0.goto(URL_A, { waitUntil: 'domcontentloaded' })
  await pb0.goto(URL_B, { waitUntil: 'domcontentloaded' })
  await new Promise(r => setTimeout(r, 1500))
  await clearSecretOnly(pa0); await clearSecretOnly(pb0)
  await pa0.reload({ waitUntil: 'domcontentloaded' })
  await pb0.reload({ waitUntil: 'domcontentloaded' })
  await new Promise(r => setTimeout(r, 2000))
  await setupA.close(); await setupB.close()

  // Phase 2: add pre-existing tiles BEFORE sync
  console.log('[driver] Phase 2: adding pre-existing tiles (no sync yet)')
  const A = await pageWithLogs(browser, 'A', URL_A)
  const B = await pageWithLogs(browser, 'B', URL_B)
  await new Promise(r => setTimeout(r, 2000))
  await ensureOpfsReady(A); await ensureOpfsReady(B)
  await addTile(A, TILE_A)
  await addTile(B, TILE_B)
  console.log('[driver]   added', TILE_A, 'on A,', TILE_B, 'on B')

  // Phase 3: turn sync ON
  console.log('[driver] Phase 3: enabling sync + reload')
  await configureSync(A); await configureSync(B)
  await A.reload({ waitUntil: 'domcontentloaded' })
  await B.reload({ waitUntil: 'domcontentloaded' })
  await new Promise(r => setTimeout(r, 8000))   // wait for broadcast + receive

  // Phase 4: verify cross-installation
  const aHasA = await tileExists(A, TILE_A)
  const aHasB = await tileExists(A, TILE_B)
  const bHasA = await tileExists(B, TILE_A)
  const bHasB = await tileExists(B, TILE_B)

  console.log('[driver] === SUMMARY ===')
  console.log(`[driver]   A has own ${TILE_A}: ${aHasA}`)
  console.log(`[driver]   A has B's ${TILE_B}: ${aHasB}`)
  console.log(`[driver]   B has A's ${TILE_A}: ${bHasA}`)
  console.log(`[driver]   B has own ${TILE_B}: ${bHasB}`)

  const ok = aHasA && aHasB && bHasA && bHasB
  console.log('[driver] RESULT:', ok ? 'OK — existing cells mix on join' : 'FAILED')

  await browser.close()
  process.exit(ok ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(2) })
