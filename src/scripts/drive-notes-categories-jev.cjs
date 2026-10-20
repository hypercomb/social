#!/usr/bin/env node
// drive-notes-categories-jev — Jev sorts a tile's notes into its categories.
//
//   node scripts/drive-notes-categories-jev.cjs [--url http://localhost:4251/] [--headed]
//
// The participant has Jev switched on and OpenRouter allowed to read the hive
// (set here the way verify-jev-table.cjs sets them, in a throwaway profile
// with a placeholder key). Every request to openrouter.ai is answered in this
// script — nothing leaves the machine. Jev's answers are scripted; everything
// else is the shell: the desk's sort button, the NoteCategories service, the
// jev-sort rubric, the decision call and the tree it writes.
//
// It checks the CALL as well as the result: one choice question per note in
// a single decision, the category labels as the shared options, and the gate —
// a choice Jev is not sure of leaves its note unsorted.

const { chromium } = require('playwright')

const arg = (name, fallback) => {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : true
}
const URL_ = String(arg('url', 'http://localhost:4251/'))
const JEV = '~typesafe/jev-latest'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '  — ' + detail : ''}`) }
async function waitFor(fn, ok, ms = 20000, step = 400) {
  const t0 = Date.now(); let v
  while (Date.now() - t0 < ms) { try { v = await fn() } catch { v = undefined } if (ok(v)) return { ok: true, value: v }; await sleep(step) }
  return { ok: false, value: v }
}

const NOTES = [
  'ATP is made in the mitochondria',
  'DNA is a double helix',
  'Genes are read by RNA polymerase',
  'The room is cold today',
]

;(async () => {
  const browser = await chromium.launch({ headless: arg('headed', false) !== true, args: ['--use-gl=angle', '--ignore-gpu-blocklist'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  // A placeholder, never a real key: every openrouter.ai request is answered below.
  await context.addInitScript(() => { try { localStorage.setItem('hc:llm:openrouter:key', 'sk-or-placeholder-for-tests') } catch {} })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))

  const decisions = []
  await page.route('https://openrouter.ai/**', route => {
    const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' }
    let body = {}
    try { body = JSON.parse(route.request().postData() ?? '{}') } catch { /* not JSON */ }
    const questions = body.questions ?? {}
    if (!Object.keys(questions).some(k => /^n\d+$/.test(k))) return route.fulfill({ status: 404, headers, body: '{}' })
    decisions.push({ model: body.model, questions })
    const answers = {}
    for (const [id, q] of Object.entries(questions)) {
      const note = (/Note: (".*")$/m.exec(q.instructions ?? '') ?? [])[1] ?? '""'
      const text = JSON.parse(note)
      const keyOf = label => Object.entries(q.criteria).find(([, v]) => v === label)?.[0]
      if (/ATP/.test(text)) answers[id] = { type: 'choice', choice: keyOf('Energy'), confidence: 0.93 }
      else if (/DNA/.test(text)) answers[id] = { type: 'choice', choice: keyOf('Genetics'), confidence: 0.9 }
      else if (/Genes/.test(text)) answers[id] = { type: 'choice', choice: keyOf('Genetics'), confidence: 0.41 }   // unsure
      else answers[id] = { type: 'choice', choice: 'none', confidence: 0.88 }
    }
    route.fulfill({ status: 200, headers, body: JSON.stringify({ id: 'gen-sort', model: 'typesafe/jev-fake', answers, usage: { input_tokens: 200, output_tokens: 0, cost: 0.00001 } }) })
  })

  await page.goto(URL_, { waitUntil: 'load' })
  const took = (await waitFor(() => page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').trim() === 'Add +')
    if (btn) btn.click()
    return !!btn
  }), v => v, 30000, 800)).ok
  if (took) await sleep(8000)
  const labels = await waitFor(() => page.evaluate(() => (window.__hypercombEffectBus?.lastValue?.get('render:cell-count')?.labels ?? []).map(String)), v => v?.length > 0, 40000)
  const tile = labels.value?.[0]
  check('a tile to write on', !!tile, tile)

  // The participant's own settings: Jev added and on, OpenRouter may read.
  const jevOn = await page.evaluate((JEV) => {
    const ioc = window.ioc
    ioc.get('@hypercomb.social/LlmModelChoice').add('openrouter', JEV, false)
    const activation = ioc.get('@diamondcoreprocessor.com/LlmActivationStore')
    activation.setEnabled('openrouter', true)
    activation.setEnabled(`openrouter:${JEV}`, true)
    ioc.get('@hypercomb.social/LlmHiveAccess').setMayRead('openrouter', true)
    return ioc.get('@diamondcoreprocessor.com/NoteCategories').jevReady()
  }, JEV)
  check('Jev is switched on and may read the hive', jevOn)

  for (const text of NOTES) {
    await page.evaluate(({ tile, text }) => window.__hypercombEffectBus.emit('note:commit', { cellLabel: tile, text, mark: null }), { tile, text })
    await sleep(700)
  }
  await page.evaluate(() => window.__hypercombEffectBus.emit('notes:panel', { visible: true }))
  await waitFor(() => page.evaluate(() => !!document.querySelector('.cv2-cats')), v => v, 15000)
  await page.evaluate(async (tile) => {
    const svc = window.ioc.get('@diamondcoreprocessor.com/NoteCategories')
    await svc.add(tile, [], 'Energy')
    await svc.add(tile, [], 'Genetics')
  }, tile)
  await sleep(1200)

  const title = await page.evaluate(() => document.querySelector('.cv2-cats-tool[aria-label="Sort notes into categories"]')?.getAttribute('title'))
  check('the sort button says Jev will do it', /Jev/.test(title ?? ''), title)
  await page.click('.cv2-cats-tool[aria-label="Sort notes into categories"]')
  const counts = () => page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('.cv2-cat')).map(b => [b.querySelector('.cv2-cat-name')?.textContent.trim(), b.querySelector('.cv2-cat-count')?.textContent.trim()])))
  const sorted = await waitFor(counts, v => v?.Energy === '1' && v?.Genetics === '1', 30000)
  check('Jev files what it is sure of', sorted.ok, JSON.stringify(sorted.value))
  const base = Number(sorted.value?.['All notes'] ?? 0) - NOTES.length
  check('what it is unsure of — and what fits nowhere — stays unsorted', Number(sorted.value?.Unsorted) === 2 + base, JSON.stringify(sorted.value))

  check('ONE decision for the whole tile', decisions.length === 1, `${decisions.length} calls`)
  const d = decisions[0]
  const ids = Object.keys(d?.questions ?? {})
  check('…one choice question per note', ids.length === NOTES.length + base && ids.every(id => d.questions[id].type === 'choice'), JSON.stringify(ids))
  check('…over the category labels plus "none"', Object.values(d?.questions?.n0?.criteria ?? {}).join('|').startsWith('Energy|Genetics|'), JSON.stringify(d?.questions?.n0?.criteria))
  check('…asked of Jev', String(d?.model ?? '').includes('jev'), d?.model)
  const msg = await page.evaluate(() => document.querySelector('.cv2-cats-msg')?.textContent.trim())
  check('the desk says Jev did it, and how many', /Jev/.test(msg ?? '') && /2/.test(msg ?? ''), msg)

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  console.log(`\n========== ${results.filter(r => r.ok).length}/${results.length} passed ==========`)
  await browser.close()
  process.exit(results.every(r => r.ok) ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
