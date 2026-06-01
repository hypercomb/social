// scripts/verify-adopt-cross-port.cjs
//
// Runs the recursive-adopt scenario against both dev shells (4250 and
// 4251) — one publisher on each port, two adopters, four combinations.
// Confirms the swarm/adopt code path works regardless of which shell
// instance hosts the publisher vs the adopter.

const { chromium } = require('playwright')

const PORTS = [4250, 4251]
const RELAY = 'ws://localhost:7777'
const ROOM = 'cross-' + Date.now().toString(36)
const SECRET = 'sec-' + Math.random().toString(36).slice(2, 10)

function ts() { return new Date().toISOString().slice(11, 23) }
function log(tag, ...args) { console.log(`[${ts()}] [${tag}]`, ...args) }

async function newBrowser() {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  return { browser, page }
}

async function clearOpfs(page) {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    for await (const [name] of root.entries()) {
      await root.removeEntry(name, { recursive: true }).catch(() => null)
    }
  })
}

async function configure(page) {
  await page.evaluate(({ room, secret, relay }) => {
    localStorage.setItem('hc:room', room)
    localStorage.setItem('hc:secret', secret)
    localStorage.setItem('hc:mesh-public', 'true')
    localStorage.setItem('hc:nostrmesh:network', '1')
    localStorage.setItem('hc:nostrmesh:allow-loopback', '1')
    localStorage.setItem('hc:nostrmesh:relays', JSON.stringify([relay]))
  }, { room: ROOM, secret: SECRET, relay: RELAY })
}

async function waitForReady(page, timeoutMs = 25000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await page.evaluate(() => !!(
      window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
      && window.ioc?.get?.('@hypercomb.social/Navigation')
    ))
    if (ok) return true
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}

async function addTile(page, name) {
  return page.evaluate(async (cellName) => {
    const input = document.querySelector('hc-command-line input') || document.querySelector('input[type="text"]')
    if (!input) return false
    input.focus()
    input.value = cellName
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 100))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    return true
  }, name)
}

async function navigateTo(page, segments) {
  return page.evaluate((segs) => {
    const nav = window.ioc?.get?.('@hypercomb.social/Navigation')
    nav?.go?.(segs)
  }, segments)
}

async function fireAdopt(page, label) {
  return page.evaluate((cellLabel) => {
    const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    swarm?.emitEffect?.('tile:action', { action: 'adopt', label: cellLabel, q: 0, r: 0, index: 0 })
  }, label)
}

async function probeTree(page, paths) {
  return page.evaluate(async (paths) => {
    const history = window.ioc?.get?.('@diamondcoreprocessor.com/HistoryService')
    const out = {}
    for (const path of paths) {
      const segs = path === '/' ? [] : path.split('/').filter(Boolean)
      const sig = await history.sign({ explorerSegments: () => segs })
      const layer = await history.currentLayerAt(sig)
      const names = []
      for (const cs of (layer?.children ?? [])) {
        try { const c = await history.getLayerBySig(cs); if (c?.name) names.push(c.name) } catch {}
      }
      out[path] = names.sort()
    }
    return out
  }, paths)
}

async function buildTree(page, port) {
  log('A', `building /dolphin/team/projects on port ${port}`)
  await addTile(page, 'dolphin'); await new Promise(r => setTimeout(r, 800))
  await navigateTo(page, ['dolphin']); await new Promise(r => setTimeout(r, 1000))
  await addTile(page, 'team'); await new Promise(r => setTimeout(r, 800))
  await navigateTo(page, ['dolphin', 'team']); await new Promise(r => setTimeout(r, 1000))
  await addTile(page, 'projects'); await new Promise(r => setTimeout(r, 800))
  await navigateTo(page, []); await new Promise(r => setTimeout(r, 3000))
}

async function runScenario(publisherPort, adopterPort) {
  log('scenario', `publisher on ${publisherPort}, adopter on ${adopterPort}`)

  const A = await newBrowser()
  await A.page.goto(`http://localhost:${publisherPort}/`, { waitUntil: 'domcontentloaded' })
  await clearOpfs(A.page)
  await configure(A.page)
  await A.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(A.page))) { log('A', 'TIMEOUT'); return { ok: false, reason: 'A TIMEOUT' } }
  await new Promise(r => setTimeout(r, 1500))
  await buildTree(A.page, publisherPort)

  const B = await newBrowser()
  await B.page.goto(`http://localhost:${adopterPort}/`, { waitUntil: 'domcontentloaded' })
  await clearOpfs(B.page)
  await configure(B.page)
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(B.page))) { log('B', 'TIMEOUT'); return { ok: false, reason: 'B TIMEOUT' } }
  await new Promise(r => setTimeout(r, 3000))

  await fireAdopt(B.page, 'dolphin')

  let elapsed = -1
  let tree = null
  const t0 = Date.now()
  while (Date.now() - t0 < 15000) {
    tree = await probeTree(B.page, ['/', '/dolphin', '/dolphin/team'])
    if (tree['/'].includes('dolphin') && tree['/dolphin'].includes('team') && tree['/dolphin/team'].includes('projects')) {
      elapsed = Date.now() - t0
      break
    }
    await new Promise(r => setTimeout(r, 400))
  }
  if (elapsed < 0) elapsed = Date.now() - t0

  await A.browser.close()
  await B.browser.close()

  const ok = tree?.['/'].includes('dolphin') && tree?.['/dolphin'].includes('team') && tree?.['/dolphin/team'].includes('projects')
  return { ok, elapsedMs: elapsed, tree }
}

async function main() {
  const results = []
  // Test all 4 combinations: pub@4250→adopter@4250, pub@4250→adopter@4251, etc.
  for (const pubPort of PORTS) {
    for (const adopterPort of PORTS) {
      const r = await runScenario(pubPort, adopterPort)
      results.push({ pubPort, adopterPort, ...r })
      log('scenario', `pub@${pubPort} → adopter@${adopterPort}: ${r.ok ? '✓' : '✗'} (${r.elapsedMs}ms)`)
    }
  }

  console.log('\n========== CROSS-PORT VERDICT ==========')
  for (const r of results) {
    console.log(`pub@${r.pubPort} → adopter@${r.adopterPort}: ${r.ok ? '✓ PASS' : '✗ FAIL'} (${r.elapsedMs}ms)`)
    if (!r.ok) console.log('  tree:', JSON.stringify(r.tree))
  }
  const allOk = results.every(r => r.ok)
  console.log(allOk ? '\nOVERALL: ✓ ALL 4 SCENARIOS PASS' : '\nOVERALL: ✗ SOME FAILED')
  console.log('========================================\n')

  process.exit(allOk ? 0 : 1)
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
