// hive-say.cjs — say the hive's language over HTTP.
//
//   node scripts/hive-say.cjs [--url http://localhost:4250] [--port 4262]
//                             [--profile <dir>] [--headless] [--chrome <browser path>]
//
// Opens the hive in a browser this script drives (Playwright), and answers
// HTTP on this machine only:
//
//   POST /say   a sentence as plain text, or JSON { "text": "…" } or
//               { "sentences": ["…", "…"] }; each is said on the hive's
//               command line, one at a time, and the reply is JSON of what
//               the hive said back while it ran: { said: [{ text, heard }] }
//   GET  /      { ready, url } — whether the hive is open and listening
//
// Each sentence goes through the same door Enter uses (`command:submit`), so
// it is the participant speaking: the same admission, undo and consent as
// typing it, and a publish still asks in the page. That is also why this
// listens on 127.0.0.1 only and refuses a request that names a web origin
// other than localhost: no web page may drive it (the bridge's rule).
//
// The browser keeps its own profile (--profile, by default .hive-profile in
// your home folder), so the hive it opens is a hive of its own and stays
// between runs. Chrome no longer lets a script drive your everyday profile,
// so this is a separate hive; it is visible, and you can use it like any
// other. See documentation/hive-say.md.

const http = require('http')
const os = require('os')
const path = require('path')

const args = process.argv.slice(2)
const valueOf = (flag, fallback) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] ? args[i + 1] : fallback }
const URL_ = valueOf('--url', 'http://localhost:4250')
const PORT = Number(valueOf('--port', '4262'))
const PROFILE = valueOf('--profile', path.join(os.homedir(), '.hive-profile'))
const HEADLESS = args.includes('--headless')
// A browser of your own (Chrome, Edge), when Playwright's is not installed.
const CHROME = valueOf('--chrome', '')
// How long the hive is listened to after a sentence before the next one: a
// commit lands well inside this, and `go` waits for the page to settle.
const SETTLE_MS = Number(valueOf('--settle', '900'))
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

;(async () => {
  const { chromium } = require('playwright')
  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: HEADLESS,
    viewport: null,
    ...(CHROME ? { executablePath: CHROME } : {}),
  })
  const page = context.pages()[0] ?? await context.newPage()
  await page.goto(URL_, { waitUntil: 'domcontentloaded' })

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
      let sentences
      try {
        const json = body.trim().startsWith('{') ? JSON.parse(body) : null
        sentences = json ? (Array.isArray(json.sentences) ? json.sentences : [json.text]) : body.split(/\r?\n/)
      } catch { reply(400, { error: 'send a sentence as text, or JSON { text } or { sentences }' }); return }
      sentences = sentences.map(s => String(s ?? '').trim()).filter(Boolean)
      if (!sentences.length) { reply(400, { error: 'no sentence to say' }); return }
      queue = queue.then(async () => {
        const said = []
        for (const sentence of sentences) said.push(await say(sentence))
        reply(200, { said })
      }).catch(error => reply(500, { error: String(error?.message ?? error) }))
    })
  })
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`The hive at ${URL_} is listening on http://127.0.0.1:${PORT}/say`)
    console.log(`Try: curl -s -X POST http://127.0.0.1:${PORT}/say --data "read /"`)
  })

  const close = async () => { server.close(); await context.close().catch(() => {}); process.exit(0) }
  process.on('SIGINT', close)
  process.on('SIGTERM', close)
  context.on('close', () => process.exit(0))
})().catch(error => { console.error(error?.message ?? error); process.exit(1) })
