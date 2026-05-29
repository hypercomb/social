// scripts/verify-label-input.cjs
//
// Confirms the mesh-modal label input:
//   - renders inside the modal when opened
//   - seeds from swarm.myLabel() / localStorage on open
//   - typing updates labelDraft signal
//   - Save commits via swarm.setMyLabel (clears publish memo,
//     re-publishes with new label)
//   - persists across reload

const { chromium } = require('playwright')

const URL = 'http://localhost:4250/'

async function clearOpfs(page) {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    for await (const [name] of root.entries()) await root.removeEntry(name, { recursive: true }).catch(() => null)
  })
}
async function waitReady(page) {
  for (let i = 0; i < 100; i++) {
    const ok = await page.evaluate(() => typeof window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')?.setMyLabel === 'function')
    if (ok) return true
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}
async function openModal(page) {
  return page.evaluate(() => {
    const bus = globalThis.__hypercombEffectBus
    bus.emit('mesh:open-modal', {})
  })
}
async function probeInput(page) {
  return page.evaluate(() => ({
    inputExists: !!document.querySelector('.mesh-modal-label-field'),
    placeholder: document.querySelector('.mesh-modal-label-field')?.getAttribute('placeholder') ?? null,
    initialValue: document.querySelector('.mesh-modal-label-field')?.value ?? null,
  }))
}
async function setInputAndSave(page, value) {
  return page.evaluate((v) => {
    const input = document.querySelector('.mesh-modal-label-field')
    if (!input) return false
    // Trigger input — Angular uses native event listeners
    input.value = v
    input.dispatchEvent(new Event('input', { bubbles: true }))
    // Click Save
    const save = document.querySelector('.mesh-modal-btn.primary')
    save?.click()
    return true
  }, value)
}

;(async () => {
  console.log('[boot] launching')
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(page)
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'domcontentloaded' })

  if (!(await waitReady(page))) { console.error('TIMEOUT'); await browser.close(); process.exit(1) }
  await new Promise(r => setTimeout(r, 1000))

  // 1 — open modal, confirm label input renders empty
  await openModal(page)
  await new Promise(r => setTimeout(r, 400))
  const s1 = await probeInput(page)
  console.log('initial', JSON.stringify(s1))
  const renders = s1.inputExists === true && s1.initialValue === ''

  // 2 — type "Alice" and Save
  await setInputAndSave(page, 'Alice')
  await new Promise(r => setTimeout(r, 600))

  const savedToStorage = await page.evaluate(() => localStorage.getItem('hc:user-label'))
  const swarmReturns = await page.evaluate(() =>
    window.ioc.get('@diamondcoreprocessor.com/SwarmDrone').myLabel())
  console.log('after save', { savedToStorage, swarmReturns })
  const saved = savedToStorage === 'Alice' && swarmReturns === 'Alice'

  // 3 — reload, re-open modal, confirm input seeded with "Alice"
  await page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitReady(page))) { console.error('TIMEOUT reload'); await browser.close(); process.exit(1) }
  await new Promise(r => setTimeout(r, 1000))
  await openModal(page)
  await new Promise(r => setTimeout(r, 400))
  const s3 = await probeInput(page)
  console.log('after reload', JSON.stringify(s3))
  const persisted = s3.initialValue === 'Alice'

  // 4 — clear it, Save, confirm empty round-trip
  await setInputAndSave(page, '')
  await new Promise(r => setTimeout(r, 400))
  const emptyAfter = await page.evaluate(() =>
    window.ioc.get('@diamondcoreprocessor.com/SwarmDrone').myLabel())
  console.log('cleared', JSON.stringify({ emptyAfter }))
  const clearable = emptyAfter === ''

  console.log('\n========== VERDICT ==========')
  console.log(`label input renders + empty:       ${renders ? '✓' : '✗'}`)
  console.log(`Save writes localStorage + swarm:  ${saved ? '✓' : '✗'}`)
  console.log(`persists across reload:            ${persisted ? '✓' : '✗'}`)
  console.log(`can clear back to empty:           ${clearable ? '✓' : '✗'}`)
  const pass = renders && saved && persisted && clearable
  console.log(pass ? 'OVERALL: ✓ PASS' : 'OVERALL: ✗ FAIL')
  console.log('=============================\n')

  await browser.close()
  process.exit(pass ? 0 : 1)
})().catch(err => { console.error('[fatal]', err); process.exit(1) })
