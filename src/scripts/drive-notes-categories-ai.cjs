#!/usr/bin/env node
// drive-notes-categories-ai — the category tree's AI path, end to end.
//
//   node scripts/drive-notes-categories-ai.cjs [--url http://localhost:4251/] [--port 11500] [--headed]
//
// A participant's own AI names the categories (auto_awesome) and, with no Jev
// set up, files the notes into them (sort). The AI here is a stand-in model
// server on this machine speaking the OpenAI-compatible protocol every local
// server speaks (Ollama, LM Studio, llama.cpp) — the shell reaches it through
// the real `local` provider, the real dispatch and the real desk buttons. Only
// the model's answers are scripted:
//
//   - asked to organise, it answers an outline (Energy › ATP, Genetics)
//   - asked to file, it files each note by its words, and leaves one unsure
//
// It checks what the shell SENT as well as what it did with the answer: the
// notes travel as data in the user message, and a suggestion only ever adds.

const http = require('node:http')
const { chromium } = require('playwright')

const arg = (name, fallback) => {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : true
}
const URL_ = String(arg('url', 'http://localhost:4251/'))
const PORT = Number(arg('port', 11500))
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
  'Glycolysis splits glucose into pyruvate',
  'DNA is a double helix',
  'The room is cold today',
]

// ── the stand-in model ──────────────────────────────────────
const asked = []
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Private-Network', 'true')
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
  if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ object: 'list', data: [{ id: 'stand-in', object: 'model' }] }))
  }
  if (req.method === 'POST' && req.url.startsWith('/v1/chat/completions')) {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => {
      const call = JSON.parse(body || '{}')
      const system = (call.messages ?? []).filter(m => m.role === 'system').map(m => String(m.content)).join('\n')
      const user = (call.messages ?? []).filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n')
      asked.push({ system, user })
      let text = ''
      if (/organise/i.test(system)) {
        text = 'Here are categories:\n```json\n[{"name":"Energy","children":[{"name":"ATP"}]},{"name":"Genetics"}]\n```'
      } else if (/file notes/i.test(system)) {
        const cats = [...user.matchAll(/^(\d+)\. (.+)$/gm)].filter(m => user.indexOf(m[0]) < user.indexOf('Notes:')).map(m => m[2])
        const notes = [...user.slice(user.indexOf('Notes:')).matchAll(/^(\d+)\. (.+)$/gm)].map(m => m[2])
        const pick = n => /ATP/.test(n) ? cats.indexOf('Energy › ATP') : /glucose|Glycolysis/i.test(n) ? cats.indexOf('Energy') : /DNA/.test(n) ? cats.indexOf('Genetics') : -1
        text = JSON.stringify(notes.map(pick))
      }
      const out = { id: 'x', object: 'chat.completion', model: 'stand-in', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: text } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }
      if (call.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(`data: ${JSON.stringify({ id: 'x', model: 'stand-in', choices: [{ index: 0, delta: { role: 'assistant', content: text } }] })}\n\n`)
        res.write(`data: ${JSON.stringify({ id: 'x', model: 'stand-in', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`)
        return res.end('data: [DONE]\n\n')
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(out))
    })
    return
  }
  res.writeHead(404); res.end()
})

;(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r))
  const browser = await chromium.launch({ headless: arg('headed', false) !== true, args: ['--use-gl=angle', '--ignore-gpu-blocklist'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript((host) => {
    localStorage.setItem('hc:llm:local:host', host)
    localStorage.setItem('hc:llm:local:model', 'stand-in')
  }, `http://127.0.0.1:${PORT}`)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))

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
  for (const text of NOTES) {
    await page.evaluate(({ tile, text }) => window.__hypercombEffectBus.emit('note:commit', { cellLabel: tile, text, mark: null }), { tile, text })
    await sleep(700)
  }
  await page.evaluate(() => window.__hypercombEffectBus.emit('notes:panel', { visible: true }))
  await waitFor(() => page.evaluate(() => !!document.querySelector('.cv2-cats')), v => v, 15000)

  const ready = await waitFor(() => page.evaluate(() => window.ioc.get('@diamondcoreprocessor.com/NoteCategories')?.aiReady?.()), v => v === true, 30000, 1000)
  check('the participant\'s own AI is ready (the local server answered)', ready.ok)

  // ✨ — the AI names the categories.
  await page.click('.cv2-cats-tool[aria-label="Suggest categories with your AI"]')
  const names = () => page.evaluate(() => Array.from(document.querySelectorAll('.cv2-cat-row .cv2-cat .cv2-cat-name')).map(n => n.textContent.trim()))
  const named = await waitFor(names, v => v?.join() === 'Energy,ATP,Genetics', 30000)
  check('the AI names the categories, nested as it said', named.ok, JSON.stringify(named.value))
  const said = await page.evaluate(() => document.querySelector('.cv2-cats-msg')?.textContent.trim())
  check('…and the desk says how many it added', /3/.test(said ?? ''), said)
  const suggestCall = asked.find(a => /organise/i.test(a.system))
  check('the notes went to it as data in the message', !!suggestCall && NOTES.every(n => suggestCall.user.includes(n)), suggestCall ? suggestCall.user.slice(0, 160) : 'not asked')

  // A second suggestion only adds: nothing new → the tree is unchanged.
  await page.click('.cv2-cats-tool[aria-label="Suggest categories with your AI"]')
  await sleep(2500)
  check('a second suggestion changes nothing it already has', (await names()).join() === 'Energy,ATP,Genetics', JSON.stringify(await names()))
  const second = asked.filter(a => /organise/i.test(a.system))[1]
  check('…and it was shown the categories already there', !!second && /Existing categories:[\s\S]*Energy[\s\S]*ATP/.test(second.user), second ? second.user.slice(0, 120) : 'not asked')

  // sort — with no Jev, the AI files.
  await page.click('.cv2-cats-tool[aria-label="Sort notes into categories"]')
  const counts = () => page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('.cv2-cat')).map(b => [b.querySelector('.cv2-cat-name')?.textContent.trim(), b.querySelector('.cv2-cat-count')?.textContent.trim()])))
  const sorted = await waitFor(counts, v => v?.ATP === '1' && v?.Genetics === '1' && v?.Energy === '2', 30000)
  check('the AI files each note where it fits (Energy counts its ATP child)', sorted.ok, JSON.stringify(sorted.value))
  const sortMsg = await page.evaluate(() => document.querySelector('.cv2-cats-msg')?.textContent.trim())
  check('…the desk says the AI did it, and how many', /AI/.test(sortMsg ?? '') && /3/.test(sortMsg ?? ''), sortMsg)
  const base = Number(sorted.value?.['All notes'] ?? 0) - NOTES.length
  check('the note it was unsure of stays unsorted', Number(sorted.value?.Unsorted) === 1 + base, JSON.stringify(sorted.value))

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  console.log(`\n========== ${results.filter(r => r.ok).length}/${results.length} passed ==========`)
  await browser.close()
  server.close()
  process.exit(results.every(r => r.ok) ? 0 : 1)
})().catch(e => { console.error(e); server.close(); process.exit(1) })
