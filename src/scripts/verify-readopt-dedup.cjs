// scripts/verify-readopt-dedup.cjs
//
// Deterministic section-level test of the re-adopt rules, driving DCP
// directly via its #branch hash (no swarm needed):
//   load 1: adopt sig A as "dolphin"            → one dolphin section (A)
//   load 2: adopt sig B (same tile, new sig)    → ONE dolphin section (B) — replaced, not duplicated
//   load 3: re-adopt sig B (sig already exists) → still one dolphin section (abort)
//   load 4: no hash (pure lineage rebuild)      → still one dolphin section
//   load 5: adopt sig D as "dolphin" AT A DIFFERENT LOCATION → TWO dolphin
//           sections (the sigbag keys branches on (name, at) — the same
//           name at another placement is a different branch, not a re-adopt)

const { chromium } = require('playwright')

const DCP = 'http://localhost:2400/'
const SIG_A = 'a'.repeat(63) + '1'
const SIG_B = 'b'.repeat(63) + '2'
const SIG_D = 'd'.repeat(63) + '4'

function ts() { return new Date().toISOString().slice(11, 23) }
function log(...args) { console.log(`[${ts()}]`, ...args) }

async function probe(page) {
  return page.evaluate(async () => {
    const home = window.__dcpHome
    const storage = window.__dcpDomains
    const sections = (home?.sections?.() ?? [])
      .filter(s => s.kind === 'content')
      .map(s => ({
        domainName: s.domainName,
        rootSig: (s.rootSig || '').slice(0, 8),
        adoptLabel: s.adoptLabel ?? null,
        itemNames: (s.items ?? []).map(i => i.name),
      }))
    const lineage = []
    if (storage?.loadDomainsHive) {
      const hive = await storage.loadDomainsHive()
      for (const d of hive) {
        for (const b of await storage.loadDomainBranches(d.name)) {
          lineage.push({ domain: d.name, name: b.name, sig: (b.branchSig || '').slice(0, 8), at: b.at })
        }
      }
    }
    return { sections, lineage }
  })
}

async function waitReady(page, timeoutMs = 30000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const ok = await page.evaluate(() => !!window.__dcpHome).catch(() => false)
    if (ok) return true
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}

function dolphinCount(p) {
  return p.sections.filter(s => s.adoptLabel === 'dolphin').length
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await (await browser.newContext()).newPage()

  // fresh OPFS so prior runs don't leak lineage entries
  await page.goto(DCP, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    for await (const [name] of root.entries()) {
      await root.removeEntry(name, { recursive: true }).catch(() => null)
    }
    localStorage.clear()
  })

  const results = {}

  log('load 1: adopt sig A')
  await page.goto(`${DCP}#branch=${SIG_A}&at=&label=dolphin`, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })   // hash nav alone doesn't reload — force init path
  if (!(await waitReady(page))) { log('TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 8000))
  results.load1 = await probe(page)
  log('  sections:', JSON.stringify(results.load1.sections))
  log('  lineage: ', JSON.stringify(results.load1.lineage))

  log('load 2: adopt sig B (same tile, new sig)')
  await page.goto(`${DCP}#branch=${SIG_B}&at=&label=dolphin`, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitReady(page))) { log('TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 8000))
  results.load2 = await probe(page)
  log('  sections:', JSON.stringify(results.load2.sections))
  log('  lineage: ', JSON.stringify(results.load2.lineage))

  log('load 3: re-adopt sig B (signature already exists)')
  await page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitReady(page))) { log('TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 8000))
  results.load3 = await probe(page)
  log('  sections:', JSON.stringify(results.load3.sections))

  log('load 4: no hash — pure lineage rebuild')
  await page.goto(DCP, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitReady(page))) { log('TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 8000))
  results.load4 = await probe(page)
  log('  sections:', JSON.stringify(results.load4.sections))

  log('load 5: adopt sig D as "dolphin" at a DIFFERENT location (at=room)')
  await page.goto(`${DCP}#branch=${SIG_D}&at=room&label=dolphin`, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitReady(page))) { log('TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 8000))
  results.load5 = await probe(page)
  log('  sections:', JSON.stringify(results.load5.sections))
  log('  lineage: ', JSON.stringify(results.load5.lineage))

  const c1 = dolphinCount(results.load1)
  const c2 = dolphinCount(results.load2)
  const c3 = dolphinCount(results.load3)
  const c4 = dolphinCount(results.load4)
  const c5 = dolphinCount(results.load5)
  const sig2 = results.load2.sections.find(s => s.adoptLabel === 'dolphin')?.rootSig
  const lin2 = results.load2.lineage.filter(e => e.name === 'dolphin')
  const sigs5 = results.load5.sections.filter(s => s.adoptLabel === 'dolphin').map(s => s.rootSig).sort()
  const lin5 = results.load5.lineage.filter(e => e.name === 'dolphin')

  console.log('\n========== VERDICT ==========')
  console.log(`load 1 dolphin sections: ${c1} (want 1)`)
  console.log(`load 2 dolphin sections: ${c2} (want 1)  rootSig=${sig2} (want ${SIG_B.slice(0, 8)})  lineage entries=${lin2.length} (want 1, sig ${SIG_B.slice(0, 8)})`)
  console.log(`load 3 dolphin sections: ${c3} (want 1)`)
  console.log(`load 4 dolphin sections: ${c4} (want 1)`)
  console.log(`load 5 dolphin sections: ${c5} (want 2 — same name, different placement)  sigs=${JSON.stringify(sigs5)}  lineage entries=${lin5.length} (want 2)`)
  const ok = c1 === 1 && c2 === 1 && c3 === 1 && c4 === 1
    && sig2 === SIG_B.slice(0, 8)
    && lin2.length === 1 && lin2[0].sig === SIG_B.slice(0, 8)
    && c5 === 2
    && JSON.stringify(sigs5) === JSON.stringify([SIG_B.slice(0, 8), SIG_D.slice(0, 8)].sort())
    && lin5.length === 2
  console.log(ok ? 'OVERALL: ✓ PASS — re-adopt replaces, same-sig aborts, different placement coexists' : 'OVERALL: ✗ FAIL')
  console.log('=============================\n')

  await browser.close()
  process.exit(ok ? 0 : 1)
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
