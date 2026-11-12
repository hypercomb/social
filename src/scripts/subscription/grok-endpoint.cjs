// grok-endpoint.cjs — YOUR GROK SUBSCRIPTION, AS AN ENDPOINT THE HIVE CAN CALL.
//
//   npm run grok                      (from src/) start it on 127.0.0.1:11435
//   node scripts/subscription/grok-endpoint.cjs --spec   print the provider spec
//
// The Grok CLI (`grok`, signed in with grok.com) answers on a plan already
// paid for. The hive cannot spawn a CLI, but it can call a local model server
// — the Ollama door — so this is that door with Grok behind it: the OpenAI
// `/v1/chat/completions` shape every openai-family provider already speaks,
// each request one headless `grok` turn. No API key exists anywhere.
//
// GROK HERE IS A CHAT MODEL, NOT AN AGENT. Every tool is removed, web search
// and subagents are off, permissions deny whatever is left, and it runs in an
// empty working folder of its own — a prompt from the hive can make Grok
// talk, never touch this machine. (The agent that reads and writes the hive
// is the bridge tier: scripts/bridge/agent-bridges.json.)
//
// WHO MAY CALL IT. It binds loopback only, and a browser page is judged by
// its Origin: the hive's own pages (any loopback origin, hypercomb.io,
// hypercomb.com) and nothing else, so a random site you visit cannot spend
// your plan. A caller with no Origin is this machine's own tooling.
// GROK_ORIGINS adds origins (comma-separated).
//
// TO USE IT IN THE HIVE: open /providers, paste what `--spec` prints (or what
// GET /provider.json serves) into Add provider. The row lands on the
// Subscription tab — the spec names its account, so the policy treats it as a
// bill already signed, not as "this machine, nothing leaves".
//
// Env: GROK_PORT (11435) · GROK_BIN (grok on PATH, else ~/.grok/bin/grok)
//      GROK_EFFORT (reasoning effort when a request names none)
//      GROK_CONCURRENCY (2 turns at once; the rest wait) · GROK_ORIGINS

const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')

const PORT = Number(process.env.GROK_PORT || 11435)
const HOST = '127.0.0.1'
const EFFORT = String(process.env.GROK_EFFORT || '').trim()
const CONCURRENCY = Math.max(1, Number(process.env.GROK_CONCURRENCY || 2))
const WORK_DIR = path.join(os.tmpdir(), 'hypercomb-grok-endpoint')
const ENDPOINT = `http://${HOST}:${PORT}/v1`

// Every built-in tool the CLI lists (its `available_commands` frame). Removing
// them is what keeps a chat turn a chat turn; dontAsk refuses any it adds later.
const TOOLS = [
  'run_terminal_command', 'read_file', 'search_replace', 'list_dir', 'grep', 'write',
  'kill_command_or_subagent', 'todo_write', 'get_command_or_subagent_output',
  'scheduler_create', 'scheduler_delete', 'scheduler_list', 'monitor', 'search_tool',
  'use_tool', 'workflow', 'enter_plan_mode', 'exit_plan_mode', 'ask_user_question',
  'send_feedback', 'image_gen', 'image_edit', 'image_to_video', 'reference_to_video',
]

const HIVE_ORIGINS = new Set(['https://hypercomb.io', 'https://hypercomb.com'])
for (const entry of String(process.env.GROK_ORIGINS || '').split(/[\s,]+/).filter(Boolean)) {
  try { HIVE_ORIGINS.add(new URL(entry).origin) } catch { /* not an origin */ }
}
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

function originAllowed(origin) {
  if (origin === undefined) return true
  try {
    const url = new URL(String(origin))
    return LOOPBACK.has(url.hostname) || HIVE_ORIGINS.has(url.origin)
  } catch { return false }
}

// ── the CLI ───────────────────────────────────────────────────────────────

function resolveGrok() {
  if (process.env.GROK_BIN) return process.env.GROK_BIN
  const exts = process.platform === 'win32' ? ['.exe', ''] : ['']
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean)
  dirs.push(path.join(os.homedir(), '.grok', 'bin'))
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, `grok${ext}`)
      try { if (fs.statSync(candidate).isFile()) return candidate } catch { /* not here */ }
    }
  }
  return ''
}

/** `grok models` — the default first. A failure leaves the one model we know. */
function listModels(bin) {
  const out = spawnSync(bin, ['models'], { encoding: 'utf8', timeout: 30_000, windowsHide: true })
  const ids = []
  let fallback = 'grok-4.7'
  for (const line of String(out.stdout || '').split(/\r?\n/)) {
    const m = /^\s*([*-])\s+([A-Za-z0-9._:-]+)/.exec(line)
    if (!m) continue
    if (m[1] === '*') fallback = m[2]
    ids.push(m[2])
  }
  const models = ids.length ? ids : [fallback]
  return { defaultModel: fallback, models: [fallback, ...models.filter(id => id !== fallback)] }
}

/** The `llm-provider@1` spec the hive imports. */
function providerSpec(roster) {
  return {
    format: 'llm-provider@1',
    id: 'grok-subscription',
    label: 'Grok (subscription)',
    vendor: 'xai',
    shape: 'openai',
    endpoint: ENDPOINT,
    requiresKey: false,
    account: 'Grok subscription (grok.com)',
    models: roster.models.map(id => ({
      name: id === roster.defaultModel ? 'grok' : id,
      id,
      tier: /fast/.test(id) ? 'fast' : id === roster.defaultModel ? 'deep' : 'balanced',
    })),
    defaultModel: roster.defaultModel,
    docsUrl: 'https://x.ai',
  }
}

// ── one chat turn ─────────────────────────────────────────────────────────

const textOf = content => {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(part => (typeof part === 'string' ? part : part?.type === 'text' ? String(part.text ?? '') : '')).join('')
  }
  return ''
}

/** OpenAI messages → one prompt. The CLI takes a single turn, so the
 *  conversation is handed over whole and Grok answers its last line. */
function promptOf(messages) {
  const system = []
  const turns = []
  for (const message of Array.isArray(messages) ? messages : []) {
    const text = textOf(message?.content).trim()
    if (!text) continue
    if (message.role === 'system' || message.role === 'developer') system.push(text)
    else turns.push({ role: message.role === 'assistant' ? 'Assistant' : 'User', text })
  }
  const parts = []
  if (system.length) parts.push(`<instructions>\n${system.join('\n\n')}\n</instructions>`)
  if (turns.length === 1 && turns[0].role === 'User') {
    parts.push(turns[0].text)
  } else {
    parts.push('<conversation>')
    for (const turn of turns) parts.push(`${turn.role}: ${turn.text}`)
    parts.push('</conversation>', 'Reply as the Assistant to the last User message. Give only the reply.')
  }
  parts.push('You are answering through a chat API: you have no tools and no files. Answer directly.')
  return parts.join('\n\n')
}

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh'])

/** Run one turn; `onText` gets each delta. Resolves { text, usage, stopReason }. */
function runTurn(bin, body, onText, signal) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(WORK_DIR, { recursive: true })
    const promptFile = path.join(WORK_DIR, `${randomUUID()}.txt`)
    fs.writeFileSync(promptFile, promptOf(body.messages), 'utf8')
    const args = [
      '--prompt-file', promptFile,
      '--output-format', 'streaming-json',
      '--cwd', WORK_DIR,
      '--permission-mode', 'dontAsk',
      '--disallowed-tools', TOOLS.join(','),
      '--disable-web-search', '--no-subagents', '--no-plan',
      '--max-turns', '1',
    ]
    if (body.model) args.push('-m', String(body.model))
    const effort = typeof body.reasoning_effort === 'string' ? body.reasoning_effort : EFFORT
    if (EFFORTS.has(effort)) args.push('--reasoning-effort', effort)
    const schema = body.response_format?.type === 'json_schema' ? body.response_format.json_schema?.schema : undefined
    if (schema) args.push('--json-schema', JSON.stringify(schema))

    const child = spawn(bin, args, { cwd: WORK_DIR, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const cleanup = () => { try { fs.unlinkSync(promptFile) } catch { /* gone */ } }
    const abort = () => { try { child.kill() } catch { /* gone */ } }
    signal.addEventListener('abort', abort, { once: true })

    let text = ''
    let usage = { input_tokens: 0, output_tokens: 0 }
    let stopReason = 'end_turn'
    let error = ''
    let stderr = ''
    let buffer = ''
    child.stdout.on('data', chunk => {
      buffer += String(chunk)
      let newline
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line) continue
        let frame
        try { frame = JSON.parse(line) } catch { continue }
        if (frame.type === 'text' && typeof frame.data === 'string') {
          text += frame.data
          onText(frame.data)
        } else if (frame.type === 'usage' && frame.usage) {
          usage = frame.usage
        } else if (frame.type === 'end') {
          if (frame.usage) usage = frame.usage
          if (frame.stopReason) stopReason = frame.stopReason
        } else if (frame.type === 'error') {
          error = String(frame.message || 'grok failed')
        }
      }
    })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('error', err => { cleanup(); reject(err) })
    child.on('close', code => {
      cleanup()
      signal.removeEventListener('abort', abort)
      if (signal.aborted) return reject(new Error('client went away'))
      if (error || (code !== 0 && !text)) return reject(new Error(error || stderr.trim() || `grok exited ${code}`))
      resolve({ text, usage, stopReason })
    })
  })
}

// One turn per slot; the rest wait their turn.
let running = 0
const waiting = []
const acquire = () => new Promise(resolve => {
  if (running < CONCURRENCY) { running++; resolve() } else waiting.push(resolve)
})
const release = () => {
  const next = waiting.shift()
  if (next) next(); else running--
}

// ── HTTP ──────────────────────────────────────────────────────────────────

const finishReason = stop => (stop === 'max_tokens' ? 'length' : 'stop')
const usageOf = u => ({
  prompt_tokens: Number(u.input_tokens || 0),
  completion_tokens: Number(u.output_tokens || 0),
  total_tokens: Number(u.input_tokens || 0) + Number(u.output_tokens || 0),
})

function cors(req, res) {
  const origin = req.headers.origin
  if (origin !== undefined) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    // A public page (hypercomb.io) reaching 127.0.0.1 is Chromium's
    // local-network access; the preflight must say this server agrees.
    res.setHeader('Access-Control-Allow-Private-Network', 'true')
  }
}

const sendJson = (res, status, value) => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(value))
}

const readBody = req => new Promise((resolve, reject) => {
  let size = 0
  const chunks = []
  req.on('data', chunk => {
    size += chunk.length
    if (size > 4 * 1024 * 1024) { reject(new Error('request too large')); req.destroy(); return }
    chunks.push(chunk)
  })
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  req.on('error', reject)
})

async function chat(bin, roster, req, res) {
  let body
  try { body = JSON.parse(await readBody(req)) } catch (err) {
    return sendJson(res, 400, { error: { message: `bad request: ${err.message}` } })
  }
  if (!roster.models.includes(body.model)) body.model = roster.defaultModel
  const id = `chatcmpl-${randomUUID()}`
  const created = Math.floor(Date.now() / 1000)
  const controller = new AbortController()
  res.on('close', () => { if (!res.writableFinished) controller.abort() })

  await acquire()
  const started = Date.now()
  try {
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      const chunk = (delta, extra = {}) => res.write(`data: ${JSON.stringify({
        id, object: 'chat.completion.chunk', created, model: body.model,
        choices: [{ index: 0, delta, finish_reason: null }], ...extra,
      })}\n\n`)
      chunk({ role: 'assistant', content: '' })
      try {
        const result = await runTurn(bin, body, delta => chunk({ content: delta }), controller.signal)
        res.write(`data: ${JSON.stringify({
          id, object: 'chat.completion.chunk', created, model: body.model,
          choices: [{ index: 0, delta: {}, finish_reason: finishReason(result.stopReason) }],
          usage: usageOf(result.usage),
        })}\n\n`)
        log(body.model, started, result)
      } catch (err) {
        if (!controller.signal.aborted) {
          res.write(`data: ${JSON.stringify({ error: { message: err.message } })}\n\n`)
          console.error(`  ✗ ${err.message}`)
        }
      }
      res.end('data: [DONE]\n\n')
      return
    }
    const result = await runTurn(bin, body, () => {}, controller.signal)
    log(body.model, started, result)
    sendJson(res, 200, {
      id, object: 'chat.completion', created, model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: result.text }, finish_reason: finishReason(result.stopReason) }],
      usage: usageOf(result.usage),
    })
  } catch (err) {
    if (!controller.signal.aborted) {
      console.error(`  ✗ ${err.message}`)
      sendJson(res, 502, { error: { message: err.message } })
    }
  } finally {
    release()
  }
}

function log(model, started, result) {
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`  ✓ ${model} ${seconds}s · ${result.usage.output_tokens ?? 0} tokens out`)
}

function main() {
  const bin = resolveGrok()
  if (!bin) {
    console.error('  grok is not installed (or not on PATH). Install the Grok CLI and run `grok login`, or set GROK_BIN.')
    process.exit(1)
  }
  const roster = listModels(bin)
  const spec = providerSpec(roster)

  if (process.argv.includes('--spec')) {
    console.log(JSON.stringify(spec, null, 2))
    return
  }

  const server = http.createServer((req, res) => {
    if (!originAllowed(req.headers.origin)) {
      return sendJson(res, 403, { error: { message: `origin ${req.headers.origin} may not use this subscription (GROK_ORIGINS adds one)` } })
    }
    cors(req, res)
    const url = new URL(req.url, ENDPOINT)
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      return sendJson(res, 200, { object: 'list', data: roster.models.map(id => ({ id, object: 'model', owned_by: 'xai' })) })
    }
    if (req.method === 'GET' && url.pathname === '/provider.json') return sendJson(res, 200, spec)
    if (req.method === 'POST' && (url.pathname === '/v1/chat/completions' || url.pathname === '/chat/completions')) {
      return void chat(bin, roster, req, res)
    }
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end(`Grok subscription endpoint — ${ENDPOINT}\nGET /provider.json for the spec to paste into /providers.\n`)
    }
    sendJson(res, 404, { error: { message: 'not found' } })
  })
  server.on('error', err => {
    console.error(err.code === 'EADDRINUSE' ? `  port ${PORT} is taken — is it already running? (GROK_PORT moves it)` : String(err))
    process.exit(1)
  })
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`\n  GROK SUBSCRIPTION ENDPOINT  ${ENDPOINT}`)
    console.log(`  cli     ${bin}`)
    console.log(`  models  ${roster.models.join(', ')}  (default ${roster.defaultModel})`)
    console.log(`  in the hive: /providers → Add provider → paste http://${HOST}:${PORT}/provider.json's JSON`)
    console.log(`  (or: node scripts/subscription/grok-endpoint.cjs --spec)\n`)
  })
}

module.exports = { promptOf, originAllowed, providerSpec }

if (require.main === module) main()
