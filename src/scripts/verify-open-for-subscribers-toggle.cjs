// scripts/verify-open-for-subscribers-toggle.cjs
//
// Confirms the floating icon on the command line:
//   - renders in the DOM once SwarmDrone is registered
//   - default state matches swarm.openForSubscribers() (true)
//   - clicking flips swarm state and the .on class on the button
//   - persists across reload (localStorage-backed)

const { chromium } = require('playwright')

const URL = 'http://localhost:4250/'

function ts() { return new Date().toISOString().slice(11, 23) }
function log(tag, ...args) { console.log(`[${ts()}] [${tag}]`, ...args) }

async function clearOpfs(page) {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    for await (const [name] of root.entries()) await root.removeEntry(name, { recursive: true }).catch(() => null)
  })
}

async function waitForButton(page, timeoutMs = 25000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const visible = await page.evaluate(() => !!document.querySelector('.open-for-subscribers-btn'))
    if (visible) return true
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}

async function readState(page) {
  return page.evaluate(() => {
    const btn = document.querySelector('.open-for-subscribers-btn')
    const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    return {
      buttonExists: !!btn,
      hasOnClass: !!btn?.classList?.contains('on'),
      ariaPressed: btn?.getAttribute('aria-pressed'),
      swarmValue: swarm?.openForSubscribers?.() ?? null,
      lsValue: localStorage.getItem('hc:open-for-subscribers'),
    }
  })
}

async function clickButton(page) {
  return page.evaluate(() => {
    const btn = document.querySelector('.open-for-subscribers-btn')
    if (!btn) return false
    // Match the (mousedown)="..." handler in the template
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    return true
  })
}

async function main() {
  log('boot', 'launching')
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  // First boot — clear OPFS + localStorage to start clean
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(page)
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'domcontentloaded' })

  if (!(await waitForButton(page))) { log('boot', 'TIMEOUT: button never rendered'); await browser.close(); process.exit(1) }
  await new Promise(r => setTimeout(r, 500))

  const s1 = await readState(page)
  log('initial', JSON.stringify(s1))
  // Default state is ON (true) — see swarm.openForSubscribers
  const initialOk = s1.buttonExists && s1.hasOnClass === true && s1.swarmValue === true

  // Click toggles → expect OFF
  await clickButton(page)
  await new Promise(r => setTimeout(r, 400))
  const s2 = await readState(page)
  log('after click 1', JSON.stringify(s2))
  const toggledOffOk = s2.hasOnClass === false && s2.swarmValue === false && s2.lsValue === '0'

  // Reload — state should persist as OFF
  await page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForButton(page))) { log('reload', 'TIMEOUT'); await browser.close(); process.exit(1) }
  await new Promise(r => setTimeout(r, 800))
  const s3 = await readState(page)
  log('after reload', JSON.stringify(s3))
  const persistedOk = s3.hasOnClass === false && s3.swarmValue === false

  // Click again → ON
  await clickButton(page)
  await new Promise(r => setTimeout(r, 400))
  const s4 = await readState(page)
  log('after click 2', JSON.stringify(s4))
  const toggledBackOk = s4.hasOnClass === true && s4.swarmValue === true

  console.log('\n========== VERDICT ==========')
  console.log(`initial default ON state:    ${initialOk ? '✓' : '✗'}`)
  console.log(`click 1 → OFF + persisted:   ${toggledOffOk ? '✓' : '✗'}`)
  console.log(`reload preserves OFF:        ${persistedOk ? '✓' : '✗'}`)
  console.log(`click 2 → ON:                ${toggledBackOk ? '✓' : '✗'}`)
  const pass = initialOk && toggledOffOk && persistedOk && toggledBackOk
  console.log(pass ? 'OVERALL: ✓ PASS' : 'OVERALL: ✗ FAIL')
  console.log('=============================\n')

  await browser.close()
  process.exit(pass ? 0 : 1)
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
