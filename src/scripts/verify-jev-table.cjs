#!/usr/bin/env node
// verify-jev-table — JEV RUNS THE SHOW, end to end on a running dev server.
//
//   node scripts/verify-jev-table.cjs [http://localhost:4250]
//
// A fresh Playwright profile (its own OPFS, never the participant's hive).
// Every request to openrouter.ai is answered here: the chat worker is the
// OpenRouter default model whose completions stream from this script as
// possibility tables, and the Decisions endpoint is a fake Jev that picks by
// a fixed rule. Everything between is REAL: the router, the OpenRouter
// instance provider, the hive read grant, the Jev service and its source
// boundary, the table parser, the hive's parsers, the tree reader, the
// Execution queue, and the chat loop's plan switch.
//
// Expect: system prompt carries JEV RUNS THE SHOW · round 1 table → Jev picks
// the read → HIVE RESULTS fed back · round 2 table → Jev picks the change →
// waits in Execution, run → receipt fed back · round 3 table → Jev picks
// answer → final prose with the hive's own "Ran in the hive" receipt and the
// Jev token line. Three decisions, zero worker deliberation.
const { chromium } = require('playwright')
const URL_ = process.argv[2] || 'http://localhost:4250'
const JEV = '~typesafe/jev-latest'
const WORKER = 'deepseek/deepseek-v4-flash-0731'
const KEY = `sk-or-v1-${'a1'.repeat(32)}` // synthetic; scratch profile only
const sleep = ms => new Promise(r => setTimeout(r, ms))
const waitFor = async (fn, timeoutMs = 10_000, stepMs = 200) => {
  const until = Date.now() + timeoutMs
  let last
  while (Date.now() < until) { try { last = await fn(); if (last) return last } catch { /* poll */ } await sleep(stepMs) }
  return last
}
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`) }

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript(([key]) => {
    try { localStorage.setItem('hc:llm:openrouter:key', key) } catch {}
    const Native = window.WebSocket
    const Quiet = function (url, protocols) {
      const asked = Array.isArray(protocols) ? protocols : protocols ? [protocols] : []
      if (!asked.includes('vite-hmr')) return new Native(url, protocols)
      const never = new EventTarget()
      Object.assign(never, { url: String(url), readyState: 0, protocol: '', extensions: '', binaryType: 'blob', bufferedAmount: 0, send() {}, close() {} })
      return never
    }
    Quiet.prototype = Native.prototype
    Object.assign(Quiet, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })
    window.WebSocket = Quiet
  }, [KEY])
  const page = await context.newPage()
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)))

  const workerCalls = [], jevCalls = []
  let doLine = ''
  let scenario = 'main'
  const sse = text => {
    const frames = [
      { choices: [{ delta: { content: text } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 30 } },
    ]
    return frames.map(f => `data: ${JSON.stringify(f)}\n\n`).join('') + 'data: [DONE]\n\n'
  }
  const table = rows => '```hypercomb-table\n' + JSON.stringify({ rows }) + '\n```'
  await page.route('https://openrouter.ai/**', route => {
    const url = route.request().url()
    const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' }
    if (url.includes('/api/alpha/decisions')) {
      const body = JSON.parse(route.request().postData() || '{}')
      const rows = body.state?.rows ?? []
      jevCalls.push({ questions: Object.keys(body.questions ?? {}), rows: rows.map(r => `${r.kind}:${r.id}`), model: body.model })
      const read = rows.find(r => r.kind === 'read'), doRow = rows.find(r => r.kind === 'do'), answer = rows.find(r => r.kind === 'answer')
      const pick = read && doRow ? read : doRow ? doRow : answer ?? rows[0]
      const answers = {}
      for (const r of rows) {
        answers[`${r.id}_fit`] = { type: 'noul', noul: r === pick ? 0.98 : 0.15 }
        if (r.kind === 'do') { answers[`${r.id}_rules`] = { type: 'noul', noul: 0.99 }; answers[`${r.id}_grounded`] = { type: 'noul', noul: 0.97 } }
      }
      const probabilities = Object.fromEntries([...rows.map(r => [r.id, r === pick ? 0.96 : 0]), ['none', 0.04]])
      answers['next'] = { type: 'choice', choice: pick.id, confidence: 0.95, probabilities }
      return route.fulfill({ status: 200, headers, body: JSON.stringify({ id: 'gen-dec-fake', model: 'typesafe/jev-1.13-fake', answers, usage: { input_tokens: 400, output_tokens: 0, cost: 0.00002 } }) })
    }
    if (url.includes('/chat/completions')) {
      const body = JSON.parse(route.request().postData() || '{}')
      const messages = body.messages ?? []
      const last = String(messages[messages.length - 1]?.content ?? '')
      const system = JSON.stringify(body)
      // Other callers (the route-flow organizer) share the model; they get an empty organizer answer, not a table.
      if (!/JEV RUNS THE SHOW/.test(system)) return route.fulfill({ status: 200, headers, body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: '{"nodes":[]}' } }] }) })
      workerCalls.push({ system, last, model: body.model, stream: !!body.stream, scenario })
      let text
      if (scenario === 'bare') {
        text = /The participant ran your|The hive ran/.test(last)
          ? 'BARE DONE: the block ran after Jev judged it.'
          : '```hypercomb-do\n' + doLine + '\n```'
      } else if (scenario === 'pick') {
        text = 'PICK DONE: continuing from the sentence you chose.'
      } else if (/Answer the participant now in prose/.test(last)) text = 'PROOF DONE: Jev chose the read, then the change, then this answer. Nothing was decided by me.'
      else if (/The participant ran your|The hive ran/.test(last)) text = table([{ id: 'c', kind: 'answer', label: 'Answer now' }, { id: 'v', kind: 'read', label: 'Verify the tile is there', line: 'list here' }])
      else if (/HIVE RESULTS/.test(last)) text = table([{ id: 'b', kind: 'do', label: 'Make the proof tile', lines: [doLine], why: 'the request asks for it' }, { id: 'c', kind: 'answer', label: 'Answer now' }])
      else text = table([
        { id: 'a', kind: 'read', label: 'See what is here', line: 'list here' },
        { id: 'b', kind: 'do', label: 'Make the proof tile', lines: [doLine], why: 'the request asks for it' },
        { id: 'c', kind: 'answer', label: 'Answer now' },
        { id: 'x', kind: 'do', label: 'A verb the hive lacks', lines: ['/frobnicate everything'] },
      ])
      return route.fulfill({ status: 200, headers: { ...headers, 'content-type': 'text/event-stream' }, body: sse(text) })
    }
    if (url.includes('/endpoints')) return route.fulfill({ status: 200, headers, body: JSON.stringify({ data: { id: JEV, name: 'TypeSafe: Jev Latest', architecture: { output_modalities: ['decisions'] } } }) })
    return route.fulfill({ status: 200, headers, body: JSON.stringify({ data: [] }) })
  })

  await page.goto(URL_, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!window.__hypercombEffectBus && !!window.ioc?.get('@diamondcoreprocessor.com/ChatThreads')
    && !!window.ioc?.get('@hypercomb.social/JevDecision') && !!window.ioc?.get('@diamondcoreprocessor.com/SlashBehaviourDrone'), null, { timeout: 90_000 })
  await sleep(3000)

  // The suite, as a participant would set it: a worker added through
  // OpenRouter, Jev added and enabled, OpenRouter granted to read the hive.
  const setup = await page.evaluate(([JEV, WORKER]) => {
    const ioc = window.ioc
    const choice = ioc.get('@hypercomb.social/LlmModelChoice')
    const activation = ioc.get('@diamondcoreprocessor.com/LlmActivationStore')
    const access = ioc.get('@hypercomb.social/LlmHiveAccess')
    choice.add('openrouter', WORKER, true)
    choice.add('openrouter', JEV, false)
    activation.setEnabled('openrouter', true)
    activation.setEnabled(`openrouter:${JEV}`, true)
    access.setMayRead('openrouter', true)
    const registry = ioc.get('@diamondcoreprocessor.com/LlmProviderRegistry')
    const ids = registry.all().map(p => p.id)
    for (const id of ids) if (id.includes('deepseek')) activation.setEnabled(id, true)
    const slash = ioc.get('@diamondcoreprocessor.com/SlashBehaviourDrone')
    const entries = slash.entries().filter(e => e.machine && e.machine.reach === 'additive' && (e.machine.examples?.length || e.examples?.length))
    const pick = entries[0]
    const raw = pick ? (pick.machine.examples?.[0] ?? pick.examples?.[0]) : ''
    const example = typeof raw === 'string' ? raw : String(raw?.grammar ?? raw?.line ?? raw?.input ?? raw?.text ?? raw?.command ?? JSON.stringify(raw))
    const jev = ioc.get('@hypercomb.social/JevDecision')
    return { ids: ids.filter(id => id.includes('deepseek') || id.includes('jev')), jevEnabled: jev.enabled(), additive: entries.map(e => e.name).slice(0, 6), example: String(example), rawExample: JSON.stringify(raw) }
  }, [JEV, WORKER])
  console.log('setup', JSON.stringify(setup))
  doLine = setup.example.replace(/^\//, '').replace(/<[^>]+>|\[[^\]]+\]/g, 'jev-proof').trim() || 'create jev-proof'
  console.log('do line for the table:', doLine)
  check('Jev is enabled through the picker + key', setup.jevEnabled)

  const ready = await waitFor(() => page.evaluate(() => {
    const router = window.ioc.get('@diamondcoreprocessor.com/LlmRouter')
    const need = { tier: 'balanced', streaming: true }
    const pid = router.designatedProviderId?.(need)
    return pid ? { pid, jevReady: window.ioc.get('@hypercomb.social/JevDecision').ready(pid) } : null
  }), 20_000, 500)
  console.log('designated', JSON.stringify(ready))
  check('the mediator designates the OpenRouter worker and Jev is ready for it', !!ready?.jevReady, JSON.stringify(ready))

  // Changes wait in Execution under the default policy (Auto + Reads); this
  // participant presses Run on the one change Jev chose.
  const decided = []
  const runner = setInterval(() => page.evaluate(() => {
    const queue = window.ioc.get('@hypercomb.social/ExecutionQueue')
    const waiting = queue.requests().filter(r => r.state === 'waiting')
    for (const r of waiting) queue.decide(r.id, 'run')
    return waiting.map(r => ({ kind: r.kind, lines: r.lines, forceReview: !!r.forceReview }))
  }).then(rows => rows.length && decided.push(...rows)).catch(() => {}), 400)

  await page.evaluate(() => window.__hypercombEffectBus.emit('chat:open', {}))
  await page.waitForFunction(() => !!document.querySelector('hc-chat-window .chat-input'), null, { timeout: 15_000 })
  await sleep(500)
  const input = page.locator('hc-chat-window .chat-input')
  await input.click()
  await page.keyboard.type('Make a jev-proof tile here and tell me when it is done.')
  await page.keyboard.press('Enter')

  const final = await waitFor(() => page.evaluate(async () => {
    // The stored turn is the truth, whatever the window is showing.
    const threads = window.ioc.get('@diamondcoreprocessor.com/ChatThreads')
    const convos = await threads.listConversations()
    for (const convo of convos) {
      const turns = await threads.readTurns(convo.id ?? convo.convoId ?? convo)
      const hit = turns.find(t => t.role === 'assistant' && /PROOF DONE/.test(t.text || ''))
      if (hit) return { text: hit.text, convo: convo.id ?? convo.convoId }
    }
    return null
  }), 120_000, 500)
  if (!final) console.log('THREAD TAIL:', await page.evaluate(() => [...document.querySelectorAll('.chat-msg')].map(e => e.className + ': ' + (e.textContent || '').slice(0, 300)).join(' || ')))
  const decline = final ? '' : await page.evaluate(() => (document.querySelector('.chat-thread')?.textContent || '').slice(-600))
  check('the turn ends with the worker\'s prose after Jev chose answer', !!final, final ? '' : decline)
  const text = final?.text ?? ''
  check('the hive\'s own receipt names the change that ran', /Ran in the hive:/.test(text) && text.includes(doLine.split(' ')[0]), text.slice(-200))
  check('the turn reports worker and Jev tokens separately', /Tokens — workers: 480 input, 120 output; Jev: 1200 input, 0 output/.test(text), text.match(/Tokens[^.]*./)?.[0] ?? text.slice(-200))
  check('no table fence leaked into the transcript', !/hypercomb-table/.test(text))

  check('every worker round carried JEV RUNS THE SHOW', workerCalls.length > 0 && workerCalls.every(c => /JEV RUNS THE SHOW/.test(c.system)), `${workerCalls.length} worker rounds`)
  check('the worker was asked four rounds: table, table, table, prose', workerCalls.length === 4, workerCalls.map(c => c.last.slice(0, 60)).join(' | '))
  check('three Jev decisions, one per table', jevCalls.length === 3, JSON.stringify(jevCalls.map(c => c.rows)))
  check('the unrunnable row never reached Jev', jevCalls.every(c => !c.rows.includes('do:x')))
  check('Jev saw the batched questions: fit for every row, rules+grounded for changes, next', jevCalls[0]?.questions.sort().join() === ['a_fit', 'b_fit', 'b_grounded', 'b_rules', 'c_fit', 'next'].sort().join(), JSON.stringify(jevCalls[0]?.questions))
  check('round 2 told the worker Jev chose the read, and fed HIVE RESULTS back', /Jev chose to read: See what is here/.test(workerCalls[1]?.last ?? '') && /HIVE RESULTS/.test(workerCalls[1]?.last ?? '') && /frobnicate|x \(/.test(workerCalls[1]?.last ?? ''), (workerCalls[1]?.last ?? '').slice(0, 220))
  check('round 3 told the worker Jev chose the change and that it ran', /Jev chose Make the proof tile/.test(workerCalls[2]?.last ?? '') && /The participant ran your/.test(workerCalls[2]?.last ?? ''), (workerCalls[2]?.last ?? '').slice(0, 220))
  check('round 4 told the worker to answer in prose', /Answer the participant now in prose/.test(workerCalls[3]?.last ?? ''))
  check('the change waited in Execution and ran without forced review', decided.some(d => d.kind !== 'read' && !d.forceReview), JSON.stringify(decided))


  // ── A BARE CHANGE BLOCK IN JEV MODE is judged as a one-row table ────────
  const newConvo = seed => page.evaluate(async seed => {
    const threads = window.ioc.get('@diamondcoreprocessor.com/ChatThreads')
    const id = threads.newConvoId()
    for (const [role, text] of seed) await threads.appendTurn(id, role, text)
    return id
  }, seed)
  const openAndSend = async (convoId, text) => {
    await page.evaluate(id => window.__hypercombEffectBus.emit('chat:open', { convoId: id }), convoId)
    await sleep(900)
    await page.locator('hc-chat-window .chat-input').click()
    await page.keyboard.type(text)
    await page.keyboard.press('Enter')
  }
  const storedAnswer = (convoId, marker) => waitFor(() => page.evaluate(async ([id, mark]) => {
    const turns = await window.ioc.get('@diamondcoreprocessor.com/ChatThreads').readTurns(id)
    return turns.find(t => t.role === 'assistant' && t.text.includes(mark))?.text ?? null
  }, [convoId, marker]), 60_000, 500)

  scenario = 'bare'
  const jevBefore = jevCalls.length
  const decidedBefore = decided.length
  const bareConvo = await newConvo([['assistant', 'Ready.']])
  await openAndSend(bareConvo, 'Copy the drafts.')
  const bareText = await storedAnswer(bareConvo, 'BARE DONE')
  const bareJev = jevCalls.slice(jevBefore)
  if (process.env.JEV_DEBUG) console.log('BARE DEBUG', JSON.stringify({ calls: workerCalls.filter(c => c.scenario === 'bare').map(c => c.last.slice(0, 300)), turns: await page.evaluate(async id => (await window.ioc.get('@diamondcoreprocessor.com/ChatThreads').readTurns(id)).map(t => t.role + ': ' + t.text.slice(0, 300)), bareConvo) }, null, 1))
  check('a bare change block in Jev mode is judged as a one-row table', bareJev.length === 1 && bareJev[0].rows.join() === 'do:action', JSON.stringify(bareJev.map(c => c.rows)))
  check('the judged block ran from Execution and the worker continued', !!bareText && /Ran in the hive:/.test(bareText) && decided.slice(decidedBefore).some(d => d.lines.join() === '/' + doLine), (bareText ?? '').slice(-160))

  // ── A PICKED SENTENCE runs as a behaviour, with no decision bought ──────
  scenario = 'pick'
  const pickJevBefore = jevCalls.length
  const pickDecidedBefore = decided.length
  const pickCallsBefore = workerCalls.length
  const question = 'The evidence was not clear enough.\n\n**Copy the drafts**\n`' + doLine + '`\n\n```hypercomb-question\n'
    + JSON.stringify({ prompt: 'Which step should the hive take?', options: [doLine, 'list /', 'Something else'] }) + '\n```'
  const pickConvo = await newConvo([['user', 'Copy the drafts.'], ['assistant', question]])
  await openAndSend(pickConvo, doLine)
  const pickText = await storedAnswer(pickConvo, 'PICK DONE')
  const pickCall = workerCalls.slice(pickCallsBefore)[0]
  check('a picked sentence runs through Execution before the worker is asked', decided.slice(pickDecidedBefore).some(d => d.lines.join() === '/' + doLine) && /The participant chose a sentence from your table and the hive ran it/.test(pickCall?.last ?? ''), (pickCall?.last ?? '').slice(0, 200))
  check('a picked sentence buys no Jev decision', jevCalls.length === pickJevBefore, String(jevCalls.length - pickJevBefore))
  check('the worker answers from the receipt', !!pickText, (pickText ?? '').slice(0, 120))
  clearInterval(runner)

  // WHAT THE HIVE COULD NOT DO is recorded, and the misses word reads it.
  const misses = await waitFor(() => page.evaluate(async () => {
    const list = await window.ioc.get('@diamondcoreprocessor.com/MachineMisses')?.list?.()
    return list?.find(row => row.verb === 'frobnicate') ? list : null
  }), 10_000, 400)
  check('the refused row is recorded as a miss', misses?.[0]?.verb === 'frobnicate' && misses[0].count === 1, JSON.stringify(misses))
  const toast = await page.evaluate(async () => {
    let said = ''
    const off = window.__hypercombEffectBus.on('toast:show', payload => { said = payload?.message ?? '' })
    await window.ioc.get('@diamondcoreprocessor.com/SlashBehaviourDrone').executePublicCanonical('misses', '')
    await new Promise(r => setTimeout(r, 300))
    off?.()
    return said
  })
  check('the misses word reports it', /frobnicate × 1/.test(toast), toast)
  await browser.close()
  const failed = results.filter(r => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} checks passed`)
  process.exit(failed ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
