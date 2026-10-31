// hive-say.cjs — say the hive's language over HTTP.
//
//   node scripts/hive-say.cjs [--url http://localhost:4250] [--port 4262]
//                             [--attach [http://127.0.0.1:9222]]
//                             [--browser msedge|chrome|chromium] [--profile <dir>]
//                             [--headless] [--chrome <browser path>]
//                             [--participant]
//
// Opens the hive in a browser this script drives (Playwright) — Microsoft
// Edge unless --browser names another — and answers HTTP on this machine
// only:
//
//   POST /say   a sentence as plain text, or JSON { "text": "…" } or
//               { "sentences": ["…", "…"], "from": "…" }
//   GET  /      { ready, url } — whether the hive is open and listening
//
// A REQUEST IS A CALL FROM OUTSIDE, AND THE PARTICIPANT ANSWERS IT. All the
// sentences of one request are one call (`external:call`), named by `from`
// or the X-Hive-Caller header. The hive's command line shows it in its `$`
// stance with who sent it, and nothing runs until the participant presses
// Enter there; Escape declines. On Enter a new conversation opens on the
// layer they stand in, and every sentence is said through the machine door
// (`command-line:remote-submit`), judged against their grants as any
// machine's line is, with each verdict written into that conversation. The
// reply waits for all of that: { outcome: { kind: "ran", convoId, results:
// [{ text, verdict }] } }, or kind "declined", or "refused" with a reason.
//
// --participant speaks as the participant instead, through the door Enter
// uses (`command:submit`), with no gate: for a hive you drive alone. The
// reply is then what the hive showed while each sentence ran:
// { said: [{ text, heard }] }.
//
// Because it can reach the participant's own door, this listens on 127.0.0.1
// only and refuses a request that names a web origin other than localhost:
// no web page may drive it (the bridge's rule).
//
// Two ways to reach the hive:
//   • --attach joins a browser you started yourself with remote debugging
//     (msedge --remote-debugging-port=9222) and speaks into its tab at --url,
//     opening one if none is there. Your browser is never closed by this.
//   • otherwise the browser is launched with its own profile (--profile, by
//     default .hive-profile in your home folder), a hive of its own that stays
//     between runs.
// Chromium-based browsers (Chrome since 136, and Edge on the same engine)
// may refuse remote debugging on your everyday profile; then --attach cannot
// connect, and it says so. See documentation/hive-say.md.

const http = require('http')
const os = require('os')
const path = require('path')

const args = process.argv.slice(2)
const valueOf = (flag, fallback) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] ? args[i + 1] : fallback }
const URL_ = valueOf('--url', 'http://localhost:4250')
const PORT = Number(valueOf('--port', '4262'))
const PROFILE = valueOf('--profile', path.join(os.homedir(), '.hive-profile'))
const HEADLESS = args.includes('--headless')
const BROWSER = valueOf('--browser', 'msedge')
const ATTACH = args.includes('--attach')
  ? (() => { const v = valueOf('--attach', ''); return /^https?:/.test(v) ? v : 'http://127.0.0.1:9222' })()
  : ''
// A browser of your own (Chrome, Edge), when Playwright's is not installed.
const CHROME = valueOf('--chrome', '')
// How long the hive is listened to after a sentence before the next one: a
// commit lands well inside this, and `go` waits for the page to settle.
const SETTLE_MS = Number(valueOf('--settle', '900'))
// Speak as the participant, ungated, instead of as a call from outside.
const PARTICIPANT = args.includes('--participant')
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** In the page: keep what the hive says (toasts and the activity log) until
 *  it is read. Installed again after a reload, which drops it. */
const listen = () => {
  const bus = globalThis.__hypercombEffectBus
  if (!bus || window.__hiveSayHeard) return !!bus
  window.__hiveSayHeard = []
  window.__hiveSayReady = false
  const keep = text => { if (window.__hiveSayReady && text) window.__hiveSayHeard.push(String(text)) }
  bus.on('toast:show', toast => keep(toast?.message ?? toast?.title))
  bus.on('activity:log', entry => keep(entry?.message))
  // The bus replays the last value to a new listener; that is old news.
  setTimeout(() => { window.__hiveSayHeard.length = 0; window.__hiveSayReady = true }, 0)
  return true
}

const sayInPage = text => {
  window.__hiveSayHeard.length = 0
  globalThis.__hypercombEffectBus.emit('command:submit', { text })
}

const readHeard = () => window.__hiveSayHeard.splice(0)

/** In the page: hand the lines to the hive as one call from outside, and wait
 *  for the participant's answer and the run it starts. */
const callInPage = ({ from, lines }) => new Promise(resolve => {
  let taken = false
  let settled = false
  const complete = outcome => { if (!settled) { settled = true; resolve(outcome) } }
  globalThis.__hypercombEffectBus.emitTransient('external:call', { from, lines, accept: () => { taken = true }, complete })
  if (!taken && !settled) complete({ kind: 'refused', reason: 'this hive does not take calls from outside: its modules are older than the say door' })
})

;(async () => {
  const { chromium } = require('playwright')
  let context, page
  if (ATTACH) {
    const browser = await chromium.connectOverCDP(ATTACH).catch(error => {
      throw new Error(`Could not attach to ${ATTACH}. Start the browser with --remote-debugging-port=9222 first; if it is already running that way and still refuses, it does not allow remote debugging on that profile. (${error?.message ?? error})`)
    })
    context = browser.contexts()[0] ?? await browser.newContext()
    page = context.pages().find(p => p.url().startsWith(URL_))
    if (!page) { page = await context.newPage(); await page.goto(URL_, { waitUntil: 'domcontentloaded' }) }
    console.log(`Attached to ${ATTACH}, speaking into ${page.url()}`)
  } else {
    context = await chromium.launchPersistentContext(PROFILE, {
      headless: HEADLESS,
      viewport: null,
      ...(CHROME ? { executablePath: CHROME } : BROWSER === 'chromium' ? {} : { channel: BROWSER }),
    })
    page = context.pages()[0] ?? await context.newPage()
    await page.goto(URL_, { waitUntil: 'domcontentloaded' })
  }

  const ready = async () => {
    try { return await page.evaluate(listen) } catch { return false }
  }
  // The shell may reload itself once while it installs; wait until a command
  // line answers.
  for (let i = 0; i < 180 && !(await ready()); i++) await sleep(1000)
  await sleep(50)

  // One sentence at a time, in order, whoever asks.
  let queue = Promise.resolve()
  const say = async text => {
    const line = text.trim().startsWith('/') ? text.trim() : `/${text.trim()}`
    await ready()
    await page.evaluate(sayInPage, line)
    await sleep(line.startsWith('/go ') ? SETTLE_MS + 300 : SETTLE_MS)
    await ready()
    const heard = await page.evaluate(readHeard).catch(() => [])
    return { text: line, heard }
  }

  const server = http.createServer((req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(body))
    }
    const origin = req.headers.origin
    if (origin && !LOCAL_ORIGIN.test(origin)) { reply(403, { error: 'only this machine may speak to the hive' }); return }
    if (req.method === 'GET' && req.url === '/') { void ready().then(ok => reply(200, { ready: ok, url: URL_ })); return }
    if (req.method !== 'POST' || req.url !== '/say') { reply(404, { error: 'POST /say, or GET /' }); return }

    let body = ''
    req.setEncoding('utf8')
    req.on('data', chunk => { body += chunk; if (body.length > 1_000_000) req.destroy() })
    req.on('end', () => {
      let sentences, from
      try {
        const json = body.trim().startsWith('{') ? JSON.parse(body) : null
        sentences = json ? (Array.isArray(json.sentences) ? json.sentences : [json.text]) : body.split(/\r?\n/)
        from = String(json?.from ?? req.headers['x-hive-caller'] ?? '').trim() || 'an agent'
      } catch { reply(400, { error: 'send a sentence as text, or JSON { text } or { sentences }' }); return }
      sentences = sentences.map(s => String(s ?? '').trim()).filter(Boolean)
      if (!sentences.length) { reply(400, { error: 'no sentence to say' }); return }
      if (!PARTICIPANT) {
        // The hive queues calls itself, and each waits for the participant:
        // nothing here holds one request behind another.
        // Said as given: a plain line the hive's reader understands reports
        // each action it ran; a canonical /line can only answer unknown.
        void ready()
          .then(() => page.evaluate(callInPage, { from, lines: sentences }))
          .then(outcome => reply(200, { outcome }))
          .catch(error => reply(500, { error: String(error?.message ?? error) }))
        return
      }
      queue = queue.then(async () => {
        const said = []
        for (const sentence of sentences) said.push(await say(sentence))
        reply(200, { said })
      }).catch(error => reply(500, { error: String(error?.message ?? error) }))
    })
  })
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`The hive at ${URL_} is listening on http://127.0.0.1:${PORT}/say${PARTICIPANT ? ', speaking as the participant' : ', every call waiting for your Enter'}`)
    console.log(`Try: curl -s -X POST http://127.0.0.1:${PORT}/say --data "read /"`)
  })

  // An attached browser is yours: leave it open, only stop speaking into it.
  const close = async () => { server.close(); if (!ATTACH) await context.close().catch(() => {}); process.exit(0) }
  process.on('SIGINT', close)
  process.on('SIGTERM', close)
  context.on('close', () => process.exit(0))
})().catch(error => { console.error(error?.message ?? error); process.exit(1) })
