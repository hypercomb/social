// hive-harness — what the hive end-to-end harnesses share: a fresh profile
// running this machine's build, saying a word on the command line, reading
// toasts, and having a (scripted) model write a module section through the
// real chat, judged by a (scripted) Jev and run through Execution.
//
// Used by scripts/verify-hive-publish.cjs and scripts/verify-module-sandbox.cjs.
// Only openrouter.ai is answered here; everything else the page does is real.
const fs = require('fs')
const path = require('path')

const JEV = '~typesafe/jev-latest'
const WORKER = 'deepseek/deepseek-v4-flash-0731'
const KEY = `sk-or-v1-${'b2'.repeat(32)}` // synthetic; scratch profiles only
const LOCAL_ROOT = () => JSON.parse(fs.readFileSync(path.join(__dirname, '../hypercomb-essentials/.build-cache.json'), 'utf8')).rootLayerSig

const sleep = ms => new Promise(r => setTimeout(r, ms))
const waitFor = async (fn, timeoutMs = 20_000, stepMs = 400) => {
  const until = Date.now() + timeoutMs
  let last
  while (Date.now() < until) { try { last = await fn(); if (last) return last } catch { /* poll */ } await sleep(stepMs) }
  return last
}
const checker = () => {
  const results = []
  const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`) }
  const finish = () => {
    const passed = results.filter(r => r.ok).length
    console.log(`\n${passed}/${results.length} checks passed`)
    return passed === results.length
  }
  return { check, finish }
}

/** A fresh profile context. The Vite dev client's socket is stubbed: a proxied
 *  or remote origin has no HMR server behind it. */
const freshContext = async browser => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } })
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
  return context
}

const logPage = (page, who) => {
  page.on('pageerror', e => console.log(`[${who} pageerror]`, String(e).slice(0, 160)))
  page.on('console', m => { const t = m.text(); if (m.type() === 'error' || /jev|draft|module|selection|refus|ensure-install/i.test(t)) console.log(`[${who} ${m.type()}]`, t.slice(0, 220)) })
}

const installedOf = page => page.evaluate(() => window.ioc?.get('@hypercomb.social/Install')?.installedSig?.() ?? null)

/** A fresh profile on the web shell, running this machine's build. */
const openHive = async (browser, who, web) => {
  const context = await freshContext(browser)
  const page = await context.newPage()
  logPage(page, who)
  await page.goto(web, { waitUntil: 'domcontentloaded', timeout: 180_000 })
  await waitFor(() => installedOf(page), 180_000, 1000)
  const root = LOCAL_ROOT()
  if (await installedOf(page) !== root) {
    const taken = await page.evaluate(([sig, zone]) => window.ioc.get('@hypercomb.social/Install').acquire(sig, [zone]), [root, new URL(web).host])
    if (!taken.ok) throw new Error(`${who} could not take this machine's build: ${taken.error}`)
    await page.reload({ waitUntil: 'domcontentloaded' })
  }
  await waitFor(() => page.evaluate(() => !!window.ioc?.get('@diamondcoreprocessor.com/ModuleQueenBee')
    && !!window.ioc?.get('@diamondcoreprocessor.com/HostSyncService')?.publishAtoms), 120_000, 1000)
  return { context, page, installed: () => installedOf(page) }
}

/** Say a word on the command line, as the participant would. */
const say = (page, text) => page.evaluate(line => new Promise(resolve => {
  let accepted = false
  globalThis.__hypercombEffectBus.emitTransient('command-line:remote-submit', {
    text: line, accept: () => { accepted = true }, complete: outcome => resolve({ accepted, outcome }),
  })
  setTimeout(() => resolve({ accepted, outcome: 'no completion within 60s' }), 60_000)
}), text)

/** Every toast the page shows from now on. */
const watchToasts = page => page.evaluate(() => {
  window.__toasts = []
  if (window.__toastsWatched) return
  window.__toastsWatched = true
  globalThis.__hypercombEffectBus.on('toast:show', toast => { window.__toasts.push(String(toast?.message ?? '')) })
})
const toasts = page => page.evaluate(() => window.__toasts ?? [])
const toastsUntil = (page, pattern, timeoutMs = 90_000) =>
  waitFor(async () => { const all = await toasts(page); return all.some(m => pattern.test(m)) ? all : null }, timeoutMs, 800)

/** The smallest module that carries a source section. */
const smallestModule = page => page.evaluate(async () => {
  const sel = await window.ioc.get('@hypercomb.social/Install').selection()
  const store = window.ioc.get('@hypercomb.social/Store')
  const found = []
  for (const node of sel.nodes) for (const bee of node.bees) {
    const bytes = await store.getBeeBytes(bee)
    if (!bytes) continue
    const text = new TextDecoder().decode(bytes)
    const heads = [...text.matchAll(/^\/\/ (src\/[^\s]+)$/gm)]
    if (!heads.length) continue
    const last = heads[heads.length - 1]
    const from = last.index + last[0].length + 1
    found.push({ path: node.path, bee, size: bytes.length, section: last[1], body: text.slice(from).replace(/\s+$/, '') })
  }
  found.sort((a, b) => a.size - b.size)
  return found[0] ?? null
})

/**
 * A MODEL WRITES THE MODULE, through the real chat: the scripted worker sends
 * the write block, the scripted Jev judges its write row, Execution runs it,
 * the draft door drafts it. Returns what a harness asserts on.
 */
const draftThroughChat = async (page, target, newBody) => {
  const workerCalls = [], jevCalls = []
  const sse = text => [
    { choices: [{ delta: { content: text } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20 } },
  ].map(f => `data: ${JSON.stringify(f)}\n\n`).join('') + 'data: [DONE]\n\n'
  await page.route('https://openrouter.ai/**', route => {
    const url = route.request().url()
    const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' }
    const body = JSON.parse(route.request().postData() || '{}')
    if (url.includes('/api/alpha/decisions')) {
      const questions = Object.keys(body.questions ?? {})
      jevCalls.push({ questions, rows: (body.state?.rows ?? []).map(r => `${r.kind}:${r.id}:${(r.lines ?? [])[0] ?? ''}`) })
      const answers = {}
      for (const key of questions) {
        const q = body.questions[key]
        if (q.type === 'choice') {
          const keys = Object.keys(q.criteria ?? {})
          const pick = key === 'next' ? (keys.find(k => k === 'write') ?? keys[0]) : keys.includes('none') ? 'none' : keys[keys.length - 1]
          answers[key] = { type: 'choice', choice: pick, confidence: key === 'next' ? 0.95 : 0.4 }
          continue
        }
        const negative = /_(beyond|known)$|_rule\d+$/.test(key) || key === 'single'
        answers[key] = { type: 'noul', noul: key === 'hive' ? 0.97 : negative ? 0.02 : 0.97 }
      }
      return route.fulfill({ status: 200, headers, body: JSON.stringify({ model: 'typesafe/jev-fake', answers, usage: { input_tokens: 300, output_tokens: 0, cost: 0.00001 } }) })
    }
    if (url.includes('/chat/completions')) {
      const system = JSON.stringify(body)
      if (!body.stream) return route.fulfill({ status: 200, headers, body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: '{"nodes":[]}' } }] }) })
      const last = String(body.messages?.[body.messages.length - 1]?.content ?? '')
      workerCalls.push({ last: last.slice(0, 160), jev: /JEV RUNS THE SHOW/.test(system), writing: /WRITING CODE/.test(system) })
      const text = /The participant ran your hypercomb-write block/.test(last)
        ? 'WRITE DONE: the module is drafted; reload to run it.'
        : ['```hypercomb-write', `${target.bee} ${target.section}`, newBody, '```'].join('\n')
      return route.fulfill({ status: 200, headers: { ...headers, 'content-type': 'text/event-stream' }, body: sse(text) })
    }
    if (url.includes('/endpoints')) return route.fulfill({ status: 200, headers, body: JSON.stringify({ data: { id: JEV, endpoints: [] } }) })
    return route.fulfill({ status: 200, headers, body: JSON.stringify({ data: [] }) })
  })
  await page.evaluate(([jev, worker]) => {
    const ioc = window.ioc
    ioc.get('@hypercomb.social/LlmModelChoice').add('openrouter', worker, true)
    ioc.get('@hypercomb.social/LlmModelChoice').add('openrouter', jev, false)
    const activation = ioc.get('@diamondcoreprocessor.com/LlmActivationStore')
    activation.setEnabled('openrouter', true)
    activation.setEnabled(`openrouter:${jev}`, true)
    ioc.get('@hypercomb.social/LlmHiveAccess').setMayRead('openrouter', true)
    for (const p of ioc.get('@diamondcoreprocessor.com/LlmProviderRegistry').all()) if (p.id.includes('deepseek')) activation.setEnabled(p.id, true)
  }, [JEV, WORKER])
  const decided = []
  const runner = setInterval(() => page.evaluate(() => {
    const queue = window.ioc.get('@hypercomb.social/ExecutionQueue')
    const waiting = queue.requests().filter(r => r.state === 'waiting')
    for (const r of waiting) queue.decide(r.id, 'run')
    return waiting.map(r => ({ kind: r.kind, lines: r.lines, forceReview: !!r.forceReview }))
  }).then(rows => rows.length && decided.push(...rows)).catch(() => {}), 400)
  try {
    await page.evaluate(() => globalThis.__hypercombEffectBus.emit('chat:open', {}))
    await page.waitForSelector('hc-chat-window .chat-input', { timeout: 30_000 })
    await sleep(600)
    await page.locator('hc-chat-window .chat-input').click()
    await page.keyboard.type(`Make ${target.path} record a proof marker when it loads.`)
    await page.keyboard.press('Enter')
    const drafted = await waitFor(() => page.evaluate(() => window.ioc.get('@hypercomb.social/ModuleDrafts').list()).then(list => list.length ? list : null), 90_000, 800)
    const reply = await waitFor(() => page.evaluate(async () => {
      const threads = window.ioc.get('@diamondcoreprocessor.com/ChatThreads')
      for (const convo of await threads.listConversations()) {
        const turns = await threads.readTurns(convo.id ?? convo.convoId ?? convo)
        const hit = turns.find(t => t.role === 'assistant' && /WRITE DONE/.test(t.text || ''))
        if (hit) return hit.text
      }
      return null
    }), 60_000, 800)
    return { drafted, reply, workerCalls, jevCalls, decided }
  } finally {
    clearInterval(runner)
  }
}

module.exports = {
  JEV, WORKER, LOCAL_ROOT, sleep, waitFor, checker, freshContext, logPage, installedOf, openHive,
  say, watchToasts, toasts, toastsUntil, smallestModule, draftThroughChat,
}
