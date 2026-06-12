// scripts/repro-double-adopt.cjs
//
// Reproduces: tile data renders twice in the DCP treeview after adopting
// the same tile a second time. Publisher A creates one tile; adopter B
// adopts it, closes the portal, adopts again. After each adopt we probe
// the DCP iframe's sections (rootSig duplicates), the rendered tree rows,
// and the domains-lineage branch entries.

const { chromium } = require('playwright')

const URL = 'http://localhost:4250/'
const RELAY = 'ws://localhost:7777'
const ROOM = 'dup-' + Date.now().toString(36)
const SECRET = 'sec-' + Math.random().toString(36).slice(2, 10)
const TILE = 'dolphin'

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
      && window.ioc?.get?.('@diamondcoreprocessor.com/SwarmAdoptDrone')
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

async function fireAdopt(page, label) {
  return page.evaluate((cellLabel) => {
    const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    swarm?.emitEffect?.('tile:action', { action: 'adopt', label: cellLabel })
    return true
  }, label)
}

async function closePortal(page) {
  return page.evaluate(() => {
    const bus = globalThis.__hypercombEffectBus
    bus?.emit?.('global:escape', {})
    return !!bus
  })
}

function dcpFrame(page) {
  return page.frames().find(f => f.url().includes('localhost:2400') || f.url().includes('127.0.0.1:2400'))
}

async function waitForDcpFrame(page, timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const f = dcpFrame(page)
    if (f) {
      const ready = await f.evaluate(() => !!window.__dcpHome).catch(() => false)
      if (ready) return f
    }
    await new Promise(r => setTimeout(r, 300))
  }
  return null
}

// Probe the DCP installer state: sections (rootSig/domain/kind + item names),
// rendered tree-row names, and the domains-lineage branch entries.
async function probeDcp(frame) {
  return frame.evaluate(async () => {
    const home = window.__dcpHome
    const storage = window.__dcpDomains
    const sections = (home?.sections?.() ?? []).map(s => ({
      domain: s.domain,
      domainName: s.domainName,
      rootSig: (s.rootSig || '').slice(0, 12),
      kind: s.kind ?? null,
      loading: s.loading,
      adoptLabel: s.adoptLabel ?? null,
      itemNames: (s.items ?? []).map(i => `${i.name}${i.visualContext ? ' (ctx)' : ''}${i.hatchBlocker ? ' (egg)' : ''}`),
    }))
    const rows = [...document.querySelectorAll('hc-tree-row .row .name')].map(el => el.textContent.trim())
    const lineage = []
    if (storage?.loadDomainsHive) {
      const hive = await storage.loadDomainsHive()
      for (const d of hive) {
        const branches = await storage.loadDomainBranches(d.name)
        for (const b of branches) {
          lineage.push({ domain: d.name, name: b.name, branchSig: (b.branchSig || '').slice(0, 12), at: b.at, kind: b.kind ?? null })
        }
      }
    }
    return { sections, rows, lineage }
  })
}

function report(label, probe) {
  log(label, `sections (${probe.sections.length}):`)
  for (const s of probe.sections) {
    console.log(`    [${s.kind}] ${s.domainName} root=${s.rootSig} loading=${s.loading} adoptLabel=${s.adoptLabel} items=${JSON.stringify(s.itemNames)}`)
  }
  log(label, `rendered tree rows: ${JSON.stringify(probe.rows)}`)
  log(label, `lineage entries (${probe.lineage.length}):`)
  for (const e of probe.lineage) {
    console.log(`    ${e.domain} :: name=${e.name} sig=${e.branchSig} at=${JSON.stringify(e.at)} kind=${e.kind}`)
  }
}

function findDuplicates(probe) {
  const issues = []
  const sigCount = new Map()
  for (const s of probe.sections) {
    if (!s.rootSig) continue
    sigCount.set(s.rootSig, (sigCount.get(s.rootSig) ?? 0) + 1)
  }
  for (const [sig, n] of sigCount) if (n > 1) issues.push(`section rootSig ${sig} appears ${n}x`)
  // Same tile rendered by more than one CONTENT section — the user-visible
  // duplication even when the sigs differ (re-adopt with an advanced sig).
  const tileCount = new Map()
  for (const s of probe.sections) {
    if (s.kind !== 'content' || !s.adoptLabel) continue
    const k = `${s.domainName}/${s.adoptLabel}`
    tileCount.set(k, (tileCount.get(k) ?? 0) + 1)
  }
  for (const [k, n] of tileCount) if (n > 1) issues.push(`content section for tile "${k}" appears ${n}x`)
  const rowCount = new Map()
  for (const r of probe.rows) rowCount.set(r, (rowCount.get(r) ?? 0) + 1)
  for (const [name, n] of rowCount) if (n > 1) issues.push(`tree row "${name}" appears ${n}x`)
  const linKey = new Map()
  for (const e of probe.lineage) {
    const k = `${e.branchSig}`
    linKey.set(k, (linKey.get(k) ?? 0) + 1)
  }
  for (const [k, n] of linKey) if (n > 1) issues.push(`lineage branchSig ${k} appears ${n}x`)
  return issues
}

async function main() {
  log('A', 'launching publisher')
  const A = await newBrowser()
  await A.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(A.page)
  await configure(A.page)
  await A.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(A.page))) { log('A', 'TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 1500))
  log('A', `publishing tile "${TILE}"`)
  await addTile(A.page, TILE)
  await new Promise(r => setTimeout(r, 2500))

  log('B', 'launching adopter')
  const B = await newBrowser()
  B.page.on('console', m => {
    const t = m.text()
    if (/adopt|branch|lineage|section/i.test(t)) console.log(`      [B console] ${t}`)
  })
  await B.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(B.page)
  await configure(B.page)
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(B.page))) { log('B', 'TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 4000))

  // ---- FIRST ADOPT ----
  log('B', `ADOPT #1 of "${TILE}"`)
  await fireAdopt(B.page, TILE)
  let frame = await waitForDcpFrame(B.page)
  if (!frame) { log('B', 'DCP iframe never appeared'); process.exit(1) }
  // let the section resolve / fill
  await new Promise(r => setTimeout(r, 6000))
  const probe1 = await probeDcp(frame)
  report('B/adopt1', probe1)
  const issues1 = findDuplicates(probe1)

  // ---- close portal, adopt again ----
  log('B', 'closing portal')
  await closePortal(B.page)
  await new Promise(r => setTimeout(r, 1500))

  log('B', `ADOPT #2 of "${TILE}"`)
  await fireAdopt(B.page, TILE)
  frame = await waitForDcpFrame(B.page)
  if (!frame) { log('B', 'DCP iframe never appeared on second adopt'); process.exit(1) }
  await new Promise(r => setTimeout(r, 8000))
  const probe2 = await probeDcp(frame)
  report('B/adopt2', probe2)
  const issues2 = findDuplicates(probe2)

  console.log('\n========== VERDICT ==========')
  console.log(`after adopt #1: ${issues1.length ? issues1.join('; ') : 'no duplicates'}`)
  console.log(`after adopt #2: ${issues2.length ? issues2.join('; ') : 'no duplicates'}`)
  console.log(issues2.length ? 'REPRODUCED: ✗ duplicates after second adopt' : 'NOT REPRODUCED: ✓ clean')
  console.log('=============================\n')

  await A.browser.close()
  await B.browser.close()
  process.exit(0)
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
