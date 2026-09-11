#!/usr/bin/env node
// verify-chat-route — the chat window's response wizard and its right-hand
// workflow sidebar, proved end to end on an ISOLATED stack.
//
//   node scripts/verify-chat-route.cjs [--url http://localhost:4251] [--port 2411]
//                                      [--profile <dir>] [--only a,b,...]
//
// What it needs running, and never the participant's own:
//   - a dev shell on --url (default 4251; never 4250)
//   - a broker on --port (default 2411; never 2401): BRIDGE_PORT=2411 node scripts/bridge/run-bridge.cjs
//
// The page opens with ?claudeBridge=1&claudeBridgePort=<port>, so its renderer
// registers on the TEST broker. The browser is headless chromium on a scratch
// persistent profile (its own OPFS), deleted on exit. Every assertion is a DOM
// or record read — never a screenshot (the hive's Pixi canvas has no GPU here).
//
// The responder is played from this script: loop-run's openRun({ ask }) for
// the run's acts, then _chat-reply.cjs and _ask-drain.cjs as child processes
// with BRIDGE_URL pointed at the test broker. Design: documentation/chat-route.md.
//
// THE FLOW (§4.1): with no local model every exchange is a dormant stage, no
// message text is on the sidebar and the page never asks port 11434 (n). Then
// (o) a STUB machine-local provider (answered by page.route on 127.0.0.1:11998)
// returns a branching workflow: the open conversation's sidebar draws its nodes
// with their branch structure, a node lights every message it covers, ←/→ fold
// a branch, six seeded conversations are organized by the orchestrator's
// passive drain live-before-archived (a recent last exchange left alone), a new
// closed exchange re-derives the ONE slot in place with the previous flow in the
// prompt, and after a reload with no model the flow shows from the pool with no
// model call and no knock. Finally (p) this script asks 127.0.0.1:11434/v1/models
// ONCE from Node: if a model answers, a realistic back-and-forth conversation is
// organized by the REAL model and its flow is printed; if not, the report says so.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFile } = require('node:child_process')
const WebSocket = require('ws')
const { chromium } = require('playwright')
const { openRun, runIdForAsk } = require('./bridge/loop-run.cjs')

function arg(name, fallback) {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : true
}

const BASE = String(arg('url', 'http://localhost:4251'))
const PORT = Number(arg('port', 2411))
const BRIDGE = `ws://localhost:${PORT}`
const PROFILE = String(arg('profile', path.join(os.tmpdir(), `verify-chat-route-${process.pid}`)))
const ONLY = String(arg('only', '')).split(',').map(s => s.trim()).filter(Boolean)
if (/:4250\b/.test(BASE) || PORT === 2401) {
  console.error('refusing: 4250 and 2401 are the participant\'s own stack')
  process.exit(2)
}
const URL_ = `${BASE}/?claudeBridge=1&claudeBridgePort=${PORT}`

const MAIN = 'chat:tile:/::route-verify'
const PULL = 'chat:tile:/::route-pull'
const QUESTION = 'How should the site be laid out?'

const results = []
const check = (id, name, ok, detail) => {
  results.push({ id, name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${name}${detail !== undefined && detail !== '' ? ' — ' + detail : ''}`)
  return !!ok
}
const want = id => !ONLY.length || ONLY.includes(id)
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ── the broker, as a responder sees it ──────────────────────────────────────

let counter = 0
function bridge(req, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BRIDGE)
    const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, timeoutMs)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id: `verify-${Date.now()}-${++counter}` })))
    ws.on('message', raw => { clearTimeout(timer); try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) } ws.close() })
    ws.on('error', e => { clearTimeout(timer); reject(e) })
  })
}

function node(script, args) {
  return new Promise(resolve => {
    execFile(process.execPath, [path.join(__dirname, 'bridge', script), ...args],
      { env: { ...process.env, BRIDGE_URL: BRIDGE }, timeout: 30_000 },
      (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) }))
  })
}

async function chatAsks(convoId) {
  const res = await bridge({ op: 'optimization-list', kind: 'ask' })
  if (!res.ok) throw new Error('optimization-list: ' + res.error)
  return (res.data?.items ?? []).filter(item => item?.payload?.mode === 'chat' && item?.payload?.convoId === convoId)
}

async function waitFor(fn, timeoutMs = 10_000, stepMs = 150) {
  const until = Date.now() + timeoutMs
  let last
  while (Date.now() < until) {
    try { last = await fn(); if (last) return last } catch { /* keep polling */ }
    await sleep(stepMs)
  }
  return last
}

// ── the page ────────────────────────────────────────────────────────────────

const threads = (page, method, ...args) => page.evaluate(([m, a]) => {
  const svc = window.ioc?.get('@diamondcoreprocessor.com/ChatThreads')
  return svc ? svc[m](...a) : null
}, [method, args])

const emit = (page, name, payload) => page.evaluate(([n, p]) => window.__hypercombEffectBus.emit(n, p), [name, payload])

/** Every card on the sidebar, top to bottom. */
const side = page => page.evaluate(() => {
  const nav = document.querySelector('nav.chat-route-side')
  if (!nav) return null
  return [...nav.querySelectorAll('.chat-route-item')].map(el => ({
    kind: el.dataset.routeKind,
    key: el.dataset.routeKey,
    row: el.dataset.routeRow,
    cls: el.className,
    dormant: el.classList.contains('chat-route-dormant'),
    aria: el.getAttribute('aria-label') ?? '',
    tab: el.getAttribute('tabindex'),
    caption: (el.querySelector('.chat-route-caption')?.textContent ?? '').trim(),
    count: el.querySelector('.chat-route-count')?.textContent?.trim() ?? null,
    error: !!el.querySelector('.chat-route-error'),
    node: el.dataset.routeNode ?? null,
    parent: el.dataset.routeParent ?? null,
    depth: el.dataset.routeDepth ?? null,
    state: el.dataset.routeState ?? null,
    turns: el.dataset.routeTurns ?? null,
    expanded: el.getAttribute('aria-expanded'),
    title: (el.querySelector('.chat-route-title')?.textContent ?? '').trim(),
    hidden: (el.querySelector('.chat-route-hidden')?.textContent ?? '').trim(),
    rails: el.querySelectorAll(':scope > .chat-route-rail').length,
    stem: !!el.querySelector(':scope > .chat-route-stem'),
    minis: el.querySelectorAll('.chat-route-mini').length,
  }))
})

/** A conversation's slot in the flows pool, read straight from this scratch
 *  profile's OPFS: how many conversation slots the pool holds, how many files
 *  THIS conversation's slot holds, and its record. */
const readFlowSlot = (page, convoId) => page.evaluate(async id => {
  const store = window.ioc.get('@hypercomb.social/Store')
  const pool = await store.openPool('chat:route-flows')
  if (!pool) return { pool: false, slots: 0, files: 0, record: null }
  let slots = 0, files = 0, record = null
  for await (const [, dir] of pool.entries()) {
    if (dir.kind !== 'directory') continue
    slots++
    const held = []
    for await (const [, file] of dir.entries()) {
      if (file.kind !== 'file') continue
      try { held.push(JSON.parse(await (await file.getFile()).text())) } catch { held.push(null) }
    }
    if (held.some(r => r?.convoId === id)) { files = held.length; record = held.find(r => r?.convoId === id) }
  }
  return { pool: true, slots, files, record }
}, convoId)

/** A turn written the way chat-thread writes one — resource, then manifest
 *  named by its hash in the conversation's bucket — but at a chosen time, so a
 *  seeded conversation can be long quiet. Only ever this scratch profile. */
const seedTurn = (page, convoId, role, text, at) => page.evaluate(async ([id, r, t, when]) => {
  const store = window.ioc.get('@hypercomb.social/Store')
  const hex = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(b => b.toString(16).padStart(2, '0')).join('')
  const pool = await store.getPool('threads')
  const bucket = await pool.getDirectoryHandle(await hex(new TextEncoder().encode(id)), { create: true })
  const contentSig = await store.putResource(new Blob([t], { type: 'text/plain' }))
  const bytes = new TextEncoder().encode(JSON.stringify({ kind: 'chat-turn', convoId: id, role: r, at: when, contentSig }))
  const handle = await bucket.getFileHandle(await hex(bytes), { create: true })
  const writable = await handle.createWritable()
  try { await writable.write(bytes) } finally { await writable.close() }
  return true
}, [convoId, role, text, at])

async function boot(page) {
  await page.goto(URL_, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!window.__hypercombEffectBus && !!window.ioc?.get('@diamondcoreprocessor.com/ChatThreads'), null, { timeout: 60_000 })
  await page.waitForFunction(() => !!window.ioc?.get('@diamondcoreprocessor.com/ClaudeBridgeWorker')?.connected, null, { timeout: 30_000 })
}

async function openConvo(page, convoId) {
  await emit(page, 'chat:open', { convoId })
  await page.waitForFunction(() => !!document.querySelector('hc-chat-window .chat-input'), null, { timeout: 15_000 })
  await sleep(400)
}

/** Every scratch context starts the same way. A co-session's edit makes ng
 *  serve push a reload to every page it serves; that socket is the only one
 *  asking for `vite-hmr`, so only it is neutered (the renderer's bridge socket
 *  goes through). */
async function prepareContext(context) {
  await context.addInitScript(() => {
    localStorage.setItem('hc:chat-visible', '1')
    localStorage.setItem('hc:bridge-setup-done', '1')
    localStorage.setItem('hc:bridge-setup-tools', '1')
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
  })
}

// ── p. the REAL local model, on a profile of its own ─────────────────────────
//
// Its own fresh profile, holding ONE conversation: on the main profile the
// passive drain is organizing every conversation the earlier sections made,
// through a server that answers one request at a time, and a realistic thread
// would wait in that queue for minutes. Here the attended call and the drain
// both see only this conversation, and the flow is read off the sidebar.
async function realPath() {
  const profile = path.join(os.tmpdir(), `verify-chat-route-real-${process.pid}`)
  fs.mkdirSync(profile, { recursive: true })
  const context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1280, height: 820 } })
  const pageErrors = []
  try {
    await prepareContext(context)
    for (const extra of context.pages().slice(1)) await extra.close()
    const page = context.pages()[0] ?? await context.newPage()
    page.on('pageerror', e => pageErrors.push(String(e && e.message || e)))
    const requests = []
    const answers = []
    page.on('request', r => requests.push({ url: r.url(), at: Date.now() }))
    page.on('response', async r => {
      if (!/\/v1\/chat\/completions/.test(r.url())) return
      try {
        const json = JSON.parse(await r.text())
        answers.push({ status: r.status(), model: json?.model, content: json?.choices?.[0]?.message?.content ?? '' })
      } catch (e) { answers.push({ status: r.status(), content: `(unreadable: ${e.message})` }) }
    })
    await boot(page)

    const REAL = 'chat:tile:/::route-real'
    const at = Date.now() - 30 * 60_000
    const realTurns = [
      ['user', 'I want a landing page for my pottery studio, with a gallery and a contact form.'],
      ['assistant', 'Sounds good. Where should the gallery pictures come from?\n\n```hypercomb-question\n{"prompt":"Where should the gallery come from?","options":["My existing tiles","A new folder"]}\n```'],
      ['user', 'My existing tiles'],
      ['assistant', 'I laid out the gallery from your tiles and added a header banner.'],
      ['user', 'Before we go on with the gallery, the contact tile shows an error. Can you fix that first?'],
      ['assistant', 'The contact tile was missing its note; I recreated it and the error is gone.'],
      ['user', 'Back to the gallery: make the thumbnails larger, and drop the header banner idea.'],
      ['assistant', 'Thumbnails are larger now and the header banner is removed.'],
      ['user', 'Let us also add opening hours to the contact section.'],
      ['assistant', 'Added opening hours under the contact form.'],
    ]
    for (const [i, [role, text]] of realTurns.entries()) await seedTurn(page, REAL, role, text, at + i * 60_000)

    const pStart = Date.now()
    // A fresh profile has never heard from this server, and the no-knock gate
    // keeps it that way until something says a server answered here. (The
    // providers console's Swarm row does not probe — verified: it reads "not
    // running" with zero requests.) So this sets the marker a successful probe
    // writes, exactly as the stub path does, and the router's own read then
    // probes the real server.
    await page.evaluate(() => localStorage.setItem('hc:llm:local:answered', '1'))
    const up = await waitFor(() => page.evaluate(() =>
      window.ioc?.get?.('@diamondcoreprocessor.com/LlmRouter')?.ready?.({ providerId: 'local' }) === true), 45_000, 500)
    check('p', 'the router finds the real local model awake', !!up)

    await openConvo(page, REAL)
    const realNodes = await waitFor(async () => {
      const nodes = ((await side(page)) ?? []).filter(r => r.kind === 'node')
      return nodes.length ? nodes : null
    }, 240_000, 1_000)
    const record = (await readFlowSlot(page, REAL)).record
    const depthOf = (nodes, node) => { let d = 1, p = node.parent; while (p) { d++; p = nodes.find(n => n.id === p)?.parent } return d }
    check('p', 'the real local model organized a realistic back-and-forth conversation into a valid flow, drawn on the sidebar',
      !!realNodes && record?.v === 1 && record.nodes.length <= 16 && realNodes.length === record.nodes.length
        && record.nodes.every(n => depthOf(record.nodes, n) <= 3 && n.title.split(/\s+/).length <= 8
          && n.turns.every(t => t >= 0 && t < record.upToTurnCount)),
      record ? `${record.nodes.length} node(s), up to turn ${record.upToTurnCount}, ${Math.round((Date.now() - pStart) / 1000)}s` : `no record; answers: ${JSON.stringify(answers).slice(0, 600)}`)
    const realCalls = requests.filter(r => r.at >= pStart && /\/v1\/chat\/completions/.test(r.url))
    check('p', 'its completions went to 127.0.0.1:11434 and nowhere else',
      realCalls.length >= 1 && realCalls.every(r => /127\.0\.0\.1:11434\/v1\/chat\/completions/.test(r.url)),
      `${realCalls.length} call(s): ${[...new Set(realCalls.map(r => r.url))].join(' ')}; model ${[...new Set(answers.map(a => a.model))].join(', ')}`)
    if (record) {
      console.log('      THE REAL FLOW:')
      for (const n of record.nodes) {
        console.log(`        ${'  '.repeat(depthOf(record.nodes, n) - 1)}- [${n.state}] ${n.title}  (turns ${n.turns.join(',')})${n.detail ? ' — ' + n.detail : ''}`)
      }
    }
    console.log(`      (real-path page errors: ${pageErrors.length})`)
  } catch (err) {
    check('p', 'real path', false, String(err && err.stack || err))
  } finally {
    await context.close().catch(() => {})
    try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* reported below */ }
    console.log(`real-path scratch profile ${fs.existsSync(profile) ? 'NOT removed' : 'removed'}: ${profile}`)
  }
}

async function main() {
  // THE ONE KNOCK FROM NODE: is a real local model answering on this machine?
  const models = await fetch('http://127.0.0.1:11434/v1/models', { signal: AbortSignal.timeout(2_500) })
    .then(r => (r.ok ? r.json() : null)).catch(() => null)
  const realModel = Array.isArray(models?.data) && models.data.length > 0
  console.log(realModel
    ? `a real local model answers at 127.0.0.1:11434: ${models.data.map(m => m.id).join(', ')}`
    : 'no real local model answers at 127.0.0.1:11434')

  fs.mkdirSync(PROFILE, { recursive: true })
  const context = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1280, height: 820 } })
  const errors = []
  let exitCode = 0
  try {
    await prepareContext(context)
    for (const extra of context.pages().slice(1)) await extra.close()
    const page = context.pages()[0] ?? await context.newPage()
    page.on('pageerror', e => errors.push(String(e && e.message || e)))
    // Every request the page makes, for the "never a knock" checks.
    const requests = []
    page.on('request', r => requests.push({ url: r.url(), at: Date.now() }))
    const since = (at, pattern) => requests.filter(r => r.at >= at && pattern.test(r.url))

    await boot(page)
    console.log(`booted ${URL_}, renderer on ${BRIDGE}`)

    // ── a. seed, ask, wait row, the ask record ────────────────────────────
    await threads(page, 'appendTurn', MAIN, 'user', 'seed: what is this hive?')
    await threads(page, 'appendTurn', MAIN, 'assistant', 'seed: a scratch hive for the route verifier.')
    await openConvo(page, MAIN)
    await page.waitForFunction(() => !!document.querySelector('nav.chat-route-side'), null, { timeout: 10_000 }).catch(() => {})

    const input = page.locator('hc-chat-window .chat-input')
    await input.click()
    await page.keyboard.type(QUESTION)
    await page.keyboard.press('Enter')

    const waited = await waitFor(async () => {
      const rows = await side(page)
      const waitRow = await page.$('.chat-thread .chat-wait')
      const stages = rows?.filter(r => r.kind === 'stage') ?? []
      const stage = stages[stages.length - 1]
      // The asked exchange is a stage — dormant, and never the question's words.
      return waitRow && stages.length >= 2 && stage?.dormant && stage.caption === '' && rows.some(r => r.kind === 'wait') ? rows : null
    }, 10_000)
    check('a', 'the wait row appears and the sidebar shows the new (dormant, captionless) stage plus a [data-route-kind=wait] row', !!waited,
      waited ? waited.map(r => r.kind).join(' > ') : JSON.stringify(await side(page)))

    const asks = await waitFor(async () => { const a = await chatAsks(MAIN); return a.length ? a : null }, 10_000)
    const sig = asks && asks.length === 1 ? asks[0].sig : ''
    check('a', "optimization-list kind:'ask' returns one mode:'chat' ask for the convoId", asks && asks.length === 1,
      asks ? `${asks.length} ask(s)${sig ? ', sig ' + sig.slice(0, 12) + '…' : ''}` : 'none')
    if (!sig) throw new Error('no ask to answer — the rest depends on it')

    // ── b. the responder's run, live on the sidebar ───────────────────────
    const run = openRun({ ask: sig, bridge: BRIDGE })
    const put = await run.act('put-resource', { text: `route verifier probe ${Date.now()}` })
    check('b', 'act put-resource succeeds', put.ok, put.ok ? 'sig ' + String(put.data?.sig).slice(0, 12) + '…' : put.error)
    const live1 = await waitFor(async () => (await side(page))?.find(r => r.kind === 'live'), 6_000)
    check('b', 'while no reply has landed, the sidebar has a [data-route-kind=live] row', !!live1,
      JSON.stringify((await side(page))?.map(r => r.kind)))
    const count1 = live1 ? Number(live1.count ?? 1) : 0

    const missing = await run.act('note-add', { segments: [], cell: 'no-such-tile-route-verify', text: 'route verifier probe' })
    let failed = missing
    let failNote = `note-add on a missing tile answered ok:${missing.ok}${missing.error ? ' (' + missing.error + ')' : ''}`
    if (missing.ok) {
      // NotesService.addAtSegments upserts; a missing tile is not refused. The
      // failing attempt the leak needs is then a note-add the worker refuses.
      failed = await run.act('note-add', { segments: [], cell: 'no-such-tile-route-verify' })
      failNote += `; fallback note-add with no text answered ok:${failed.ok} (${failed.error})`
    }
    check('b', 'one act fails', !failed.ok, failNote)
    const live2 = await waitFor(async () => {
      const row = (await side(page))?.find(r => r.kind === 'live')
      return row && Number(row.count ?? 1) > count1 ? row : null
    }, 6_000)
    check('b', 'the live row\'s .chat-route-count grows as steps land', !!live2,
      `count ${count1} → ${live2 ? live2.count : JSON.stringify((await side(page))?.find(r => r.kind === 'live'))}`)

    const reply = await node('_chat-reply.cjs', [MAIN, 'Two ways.', '--ask', sig,
      '--question', 'How many pages?', '--option', 'One long page', '--option', 'Several pages'])
    check('b', '_chat-reply.cjs with a question delivers', reply.code === 0, (reply.stdout + reply.stderr).trim())
    const retire = await node('_ask-drain.cjs', ['retire', sig])
    check('b', '_ask-drain.cjs retire succeeds', retire.code === 0, (retire.stdout + retire.stderr).trim())

    // ── c. the thread ─────────────────────────────────────────────────────
    const thread = await waitFor(() => page.evaluate(() => {
      const group = document.querySelector('.chat-thread [role=radiogroup]')
      if (!group) return null
      const codes = [...document.querySelectorAll('.chat-thread pre, .chat-thread code')].map(e => e.textContent || '')
      const ai = [...document.querySelectorAll('.chat-thread .chat-msg.ai .chat-msg-text')].map(e => e.textContent || '')
      return {
        radios: group.querySelectorAll('[role=radio]').length,
        fence: codes.some(t => t.includes('hypercomb-question')),
        twoWays: ai.some(t => t.includes('Two ways.')),
      }
    }), 10_000)
    check('c', 'the thread shows a [role=radiogroup] with two [role=radio]', thread?.radios === 2, JSON.stringify(thread))
    check('c', "no code block contains 'hypercomb-question'", thread && !thread.fence)
    check('c', "'Two ways.' is rendered", thread?.twoWays)

    // ── d. the sidebar, top to bottom ─────────────────────────────────────
    const tailOf = rows => rows.slice(rows.map(r => r.kind).lastIndexOf('stage'))
    const settledRows = await waitFor(async () => {
      const rows = await side(page)
      const tail = rows ? tailOf(rows).map(r => r.kind).join(',') : ''
      return tail === 'stage,work,reply,junction,end' ? rows : null
    }, 10_000)
    const dRows = settledRows ?? await side(page) ?? []
    const tail = tailOf(dRows)
    check('d', 'from the asked stage: stage, work, reply, junction, end', !!settledRows, dRows.map(r => r.kind).join(' > '))
    const junction = tail.find(r => r.kind === 'junction')
    check('d', 'the junction is open (.chat-route-junction-open)', /chat-route-junction-open/.test(junction?.cls ?? ''), junction?.cls)
    const end = dRows[dRows.length - 1]
    check('d', 'end is the last row and dashed after the open junction', end?.kind === 'end' && /chat-route-dashed/.test(end.cls), end?.cls)
    const work = tail.find(r => r.kind === 'work')
    check('d', 'the work row is a leak (.chat-route-leak containing .chat-route-error)', /chat-route-leak/.test(work?.cls ?? '') && work?.error, work && `${work.cls} error:${work.error} count:${work.count}`)
    check('d', 'exactly one row has tabindex=0', dRows.filter(r => r.tab === '0').length === 1, `${dRows.filter(r => r.tab === '0').length} stops`)

    const read = await bridge({ op: 'thread-read', cell: MAIN, steps: true })
    const runId = runIdForAsk(sig)
    const steps = (read.data?.steps ?? []).filter(s => s.runId === runId)
    const agentRead = await bridge({ op: 'thread-read', cell: 'agent:' + sig, steps: true })
    const agentSteps = agentRead.data?.steps ?? []
    check('d', 'thread-read {steps:true} shows the run in the CHAT bucket (none under agent:<sig>)',
      read.ok && steps.length >= 3 && agentSteps.length === 0,
      `chat bucket: ${steps.map(s => `${s.seq}:${s.verb}:${s.outcome}`).join(' ')}; agent bucket: ${agentSteps.length}`)
    const turns = await threads(page, 'readTurns', MAIN)
    const replyTurn = [...(turns ?? [])].reverse().find(t => t.role === 'assistant' && String(t.text).startsWith('Two ways.'))
    const replyStep = steps.find(s => s.verb === 'chat-reply')
    check('d', "the chat-reply step's sigs include the reply turn's sig",
      !!replyTurn?.sig && (replyStep?.sigs ?? []).includes(replyTurn.sig),
      `turn ${String(replyTurn?.sig).slice(0, 12)}… in [${(replyStep?.sigs ?? []).map(s => s.slice(0, 12)).join(', ')}]`)

    // ── e. keyboard in the thread ─────────────────────────────────────────
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur() })
    await sleep(80)
    await page.evaluate(() => {
      window.__keylog = []
      const bus = window.__hypercombEffectBus
      const inGroup = () => !!document.activeElement?.closest?.('.chat-question')
      window.__keyOff = [
        bus.on('keymap:suppress', p => window.__keylog.push({ ev: 'suppress', reason: p?.reason, inGroup: inGroup() })),
        bus.on('keymap:unsuppress', p => window.__keylog.push({ ev: 'unsuppress', reason: p?.reason, inGroup: inGroup() })),
      ]
    })
    await sleep(80)
    await page.evaluate(() => { window.__keymark = window.__keylog.length })
    await page.locator('.chat-thread .chat-question-option').first().focus()
    await page.keyboard.press('ArrowDown')
    const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '')
    check('e', 'ArrowDown moves the roving focus to the second option', /Several pages/.test(focused), focused)
    await page.keyboard.press('Enter')

    const picked = await waitFor(async () => {
      const dom = await page.evaluate(() => ({
        user: [...document.querySelectorAll('.chat-thread .chat-msg.user .chat-msg-text')].map(e => (e.textContent || '').trim()),
        group: !!document.querySelector('.chat-thread [role=radiogroup]'),
        line: [...document.querySelectorAll('.chat-thread .chat-question-line')].map(e => (e.textContent || '').trim()),
      }))
      const rows = await side(page)
      const stages = rows?.filter(r => r.kind === 'stage') ?? []
      return dom.user.includes('Several pages') && !dom.group && stages.length >= 3 && stages[stages.length - 1].caption === '' && rows.some(r => r.kind === 'wait')
        ? { dom, rows } : null
    }, 10_000)
    const eDom = picked?.dom ?? await page.evaluate(() => ({
      user: [...document.querySelectorAll('.chat-thread .chat-msg.user .chat-msg-text')].map(e => (e.textContent || '').trim()),
      group: !!document.querySelector('.chat-thread [role=radiogroup]'),
      line: [...document.querySelectorAll('.chat-thread .chat-question-line')].map(e => (e.textContent || '').trim()),
    }))
    check('e', "a user turn 'Several pages' appears", eDom.user.includes('Several pages'), JSON.stringify(eDom.user.slice(-2)))
    check('e', 'the radiogroup becomes the one-line settled text',
      !eDom.group && eDom.line.some(l => l.includes('How many pages?') && l.includes('Several pages')), JSON.stringify(eDom.line))
    const eRows = picked?.rows ?? await side(page)
    check('e', 'a new stage row plus a wait row appear in the sidebar', !!picked, eRows?.map(r => r.kind).join(' > '))
    const keylog = await page.evaluate(() => { const log = window.__keylog.slice(window.__keymark); window.__keyOff.forEach(f => f()); return log })
    const sIdx = keylog.findIndex(k => k.ev === 'suppress' && k.reason === 'chat-question' && k.inGroup)
    const uIdx = keylog.findIndex((k, i) => i > sIdx && k.ev === 'unsuppress' && k.reason === 'chat-question')
    check('e', 'keymap:suppress {reason:chat-question} emitted while focus was in the group, keymap:unsuppress afterwards',
      sIdx >= 0 && uIdx > sIdx, JSON.stringify(keylog))

    // ── f. the second ask, answered plainly ───────────────────────────────
    const second = await waitFor(async () => (await chatAsks(MAIN)).find(a => a.sig !== sig), 10_000)
    check('f', 'the pick minted a second chat ask', !!second, second ? second.sig.slice(0, 12) + '…' : 'none')
    if (second) {
      const plain = await node('_chat-reply.cjs', [MAIN, 'Several pages it is.', '--ask', second.sig])
      const gone = await node('_ask-drain.cjs', ['retire', second.sig])
      check('f', 'plain reply delivered and the ask retired', plain.code === 0 && gone.code === 0, (plain.stdout + plain.stderr + gone.stdout + gone.stderr).trim())
    }
    const fRows = await waitFor(async () => {
      const rows = await side(page)
      if (!rows) return null
      const last = rows[rows.length - 1]
      const replies = rows.filter(r => r.kind === 'reply').length
      return replies >= 3 && !rows.some(r => /chat-route-junction-open/.test(r.cls)) && last.kind === 'end' && !/chat-route-dashed/.test(last.cls) && !rows.some(r => r.kind === 'wait' || r.kind === 'live')
        ? rows : null
    }, 10_000)
    const fNow = fRows ?? await side(page) ?? []
    check('f', 'the junction row is no longer open', !fNow.some(r => /chat-route-junction-open/.test(r.cls)), fNow.map(r => r.kind).join(' > '))
    const fEnd = fNow[fNow.length - 1]
    check('f', 'the end row is last and no longer dashed', fEnd?.kind === 'end' && !/chat-route-dashed/.test(fEnd.cls), fEnd?.cls)
    await sleep(600)
    const before = (await side(page)).map(r => `${r.kind}:${r.key}`)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await boot(page)
    await openConvo(page, MAIN)
    const after = await waitFor(async () => {
      const rows = (await side(page))?.map(r => `${r.kind}:${r.key}`)
      return rows && rows.join('|') === before.join('|') ? rows : null
    }, 10_000) ?? (await side(page))?.map(r => `${r.kind}:${r.key}`)
    check('f', 'after a reload the sidebar rows (kinds, keys, order) are identical', after && after.join('|') === before.join('|'),
      `before ${before.join(' > ')}${after && after.join('|') !== before.join('|') ? ' | after ' + after.join(' > ') : ''}`)

    // ── n. dormant: no local model, no message text, no knock ─────────────
    const nRows = await side(page) ?? []
    const nStages = nRows.filter(r => r.kind === 'stage')
    check('n', 'with no local model every stage is dormant: .chat-route-dormant, no caption text, aria-label "not organized yet"',
      nStages.length >= 3 && nStages.every(s => s.dormant && s.caption === '' && s.aria === 'not organized yet'),
      JSON.stringify(nStages.map(s => ({ key: s.key, dormant: s.dormant, caption: s.caption, aria: s.aria }))))
    const nReplies = nRows.filter(r => r.kind === 'reply')
    const sideText = await page.evaluate(() => document.querySelector('nav.chat-route-side')?.textContent ?? '')
    const messageTexts = ['seed: what is this hive?', 'seed: a scratch hive', QUESTION, 'Two ways.', 'Several pages it is.']
    check('n', 'no message text anywhere on the sidebar; every reply piece is captioned "Replied" only',
      !messageTexts.some(t => sideText.includes(t)) && nReplies.length >= 3 && nReplies.every(r => r.caption === 'Replied'),
      JSON.stringify({ leaked: messageTexts.filter(t => sideText.includes(t)), replies: nReplies.map(r => r.caption) }))
    const cardText = async kind => {
      await page.mouse.move(5, 5)
      await sleep(120)
      await page.locator(`nav.chat-route-side .chat-route-item[data-route-kind=${kind}]`).first().hover()
      return waitFor(() => page.evaluate(k => {
        const c = document.querySelector(`.chat-route-card[role=tooltip][data-route-kind=${k}]`)
        if (!c) return null
        // Glyphs are ligature words (`person`, `chat_bubble`), not text.
        const copy = c.cloneNode(true)
        copy.querySelectorAll('.mat-sym').forEach(glyph => glyph.remove())
        return copy.textContent.replace(/\s+/g, ' ').trim()
      }, kind), 3_000)
    }
    const stageCard = await cardText('stage')
    const replyCard = await cardText('reply')
    await page.mouse.move(5, 5)
    check('n', 'the detail cards carry no excerpts: the stage card says "not organized yet", the reply card says "Replied"',
      !!stageCard && stageCard.includes('not organized yet') && !messageTexts.some(t => stageCard.includes(t))
        && replyCard === 'Replied',
      JSON.stringify({ stageCard, replyCard }))
    const knocks = since(0, /:11434\b/)
    check('n', 'no request to port 11434 appears in the page network log', knocks.length === 0,
      knocks.length ? knocks.slice(0, 4).map(r => r.url).join(' ') : `${requests.length} requests, none to :11434`)

    // ── g. press a stage, hover a work row ────────────────────────────────
    await page.evaluate(() => { const s = document.querySelector('.chat-thread'); if (s) s.scrollTop = s.scrollHeight })
    const stage0 = page.locator('nav.chat-route-side .chat-route-item[data-route-kind=stage]').first()
    const stageRow = await stage0.getAttribute('data-route-row')
    await stage0.click()
    const lit = await waitFor(() => page.evaluate(row => {
      const msg = document.querySelector(`.chat-msg[data-route-row="${row}"]`)
      const scroller = document.querySelector('.chat-thread')
      if (!msg || !scroller || !msg.classList.contains('chat-route-lit')) return null
      const m = msg.getBoundingClientRect(), s = scroller.getBoundingClientRect()
      return { inView: m.top >= s.top - 1 && m.top < s.bottom, msgTop: Math.round(m.top), scrollerTop: Math.round(s.top), overflow: scroller.scrollHeight > scroller.clientHeight }
    }, stageRow), 4_000)
    check('g', `clicking stage row ${stageRow} brings its message into view and lights .chat-msg[data-route-row=${stageRow}].chat-route-lit`, lit?.inView, JSON.stringify(lit))
    await page.locator('nav.chat-route-side .chat-route-item[data-route-kind=work]').first().hover()
    const card = await waitFor(() => page.evaluate(() => {
      const c = document.querySelector('.chat-route-card[role=tooltip]')
      const nav = document.querySelector('nav.chat-route-side')
      if (!c || !nav) return null
      const cr = c.getBoundingClientRect(), nr = nav.getBoundingClientRect()
      const cs = getComputedStyle(c)
      return { kind: c.dataset.routeKind, visible: cr.width > 0 && cr.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none', cardRight: Math.round(cr.right), cardLeft: Math.round(cr.left), sideLeft: Math.round(nr.left) }
    }), 4_000)
    check('g', 'hovering a work row shows .chat-route-card[role=tooltip] left of the sidebar',
      card?.visible && card.kind === 'work' && card.cardRight <= card.sideLeft + 1 && card.cardLeft >= 0, JSON.stringify(card))

    // ── h. the pull ───────────────────────────────────────────────────────
    for (let i = 0; i < 14; i++) {
      await threads(page, 'appendTurn', PULL, 'user', `pull question ${i + 1}`)
      await threads(page, 'appendTurn', PULL, 'assistant', `pull answer ${i + 1}`)
    }
    await page.mouse.move(5, 5)
    await openConvo(page, PULL)
    const pullReady = await waitFor(() => page.evaluate(() => {
      const nav = document.querySelector('nav.chat-route-side')
      return nav && nav.querySelectorAll('.chat-route-item').length >= 29 && nav.scrollHeight > nav.clientHeight + 40
        ? { items: nav.querySelectorAll('.chat-route-item').length, scrollHeight: nav.scrollHeight, clientHeight: nav.clientHeight, top: nav.scrollTop } : null
    }), 10_000)
    check('h', 'the seeded conversation overflows the sidebar', !!pullReady, JSON.stringify(pullReady))
    await sleep(300)
    const box = await page.locator('nav.chat-route-side').boundingBox()
    const topBefore = await page.evaluate(() => document.querySelector('nav.chat-route-side').scrollTop)
    const x = box.x + box.width * 0.6
    const y = box.y + box.height * 0.35
    await page.mouse.move(x, y)
    await page.mouse.down()
    for (let i = 1; i <= 8; i++) { await page.mouse.move(x, y + i * 12); await sleep(16) }
    await page.mouse.up()
    const topAfter = await page.evaluate(() => document.querySelector('nav.chat-route-side').scrollTop)
    check('h', 'a pointer drag on the sidebar changes its scrollTop', Math.abs(topAfter - topBefore) >= 40, `${Math.round(topBefore)} → ${Math.round(topAfter)}`)
    await sleep(100)
    const target = await page.evaluate(() => {
      const nav = document.querySelector('nav.chat-route-side')
      const nr = nav.getBoundingClientRect()
      const rows = [...nav.querySelectorAll('.chat-route-item[data-route-kind=stage]')].filter(el => {
        const r = el.getBoundingClientRect(); return r.top > nr.top + 10 && r.bottom < nr.bottom - 10
      })
      const el = rows[Math.floor(rows.length / 2)]
      if (!el) return null
      const r = el.querySelector('.chat-route-piece').getBoundingClientRect()
      return { key: el.dataset.routeKey, row: el.dataset.routeRow, x: r.left + r.width / 2, y: r.top + r.height / 2, tab: el.getAttribute('tabindex') }
    })
    if (target) {
      const scrollBefore = await page.evaluate(() => document.querySelector('nav.chat-route-side').scrollTop)
      // Put the thread at its top, so the pressed stage's message starts OUT of
      // view and "scrolled into view" is something the press has to do.
      const startedOut = await page.evaluate(row => {
        const scroller = document.querySelector('.chat-thread')
        scroller.scrollTop = 0
        const m = document.querySelector(`.chat-msg[data-route-row="${row}"]`).getBoundingClientRect()
        const s = scroller.getBoundingClientRect()
        return !(m.bottom > s.top && m.top < s.bottom)
      }, target.row)
      console.log(`      (stage ${target.key}'s message out of view before the press: ${startedOut})`)
      await sleep(150)
      await page.mouse.move(target.x, target.y)
      await page.mouse.down()
      await page.mouse.move(target.x, target.y + 2)
      await page.mouse.up()
      const clicked = await waitFor(() => page.evaluate(t => {
        const el = document.querySelector(`nav.chat-route-side .chat-route-item[data-route-key="${t.key}"]`)
        const msg = document.querySelector(`.chat-msg[data-route-row="${t.row}"]`)
        const scroller = document.querySelector('.chat-thread')
        if (!(el?.getAttribute('tabindex') === '0' && msg?.classList.contains('chat-route-lit') && scroller)) return null
        const m = msg.getBoundingClientRect(), s = scroller.getBoundingClientRect()
        return {
          tab: '0', lit: true, scrollTop: document.querySelector('nav.chat-route-side').scrollTop,
          threadOverflows: scroller.scrollHeight > scroller.clientHeight,
          msgInView: m.bottom > s.top && m.top < s.bottom,
        }
      }, target), 3_000)
      check('h', 'a 2px press-move-release still acts as a click (roving stop moves, its message lights and is scrolled into the overflowing thread)',
        !!clicked && Math.abs(clicked.scrollTop - scrollBefore) < 1 && clicked.threadOverflows && clicked.msgInView,
        JSON.stringify({ target: target.key, clicked, scrollBefore }))
    } else {
      check('h', 'a 2px press-move-release still acts as a click', false, 'no stage row in view to click')
    }

    // ── i. a store fault ──────────────────────────────────────────────────
    await page.mouse.move(5, 5)
    await openConvo(page, MAIN)
    await waitFor(async () => (await side(page))?.some(r => r.kind === 'work'), 8_000)
    const errorsBefore = errors.length
    await page.evaluate(() => {
      const store = window.ioc.get('@hypercomb.social/Store')
      window.__hadOwnGetPool = Object.prototype.hasOwnProperty.call(store, 'getPool')
      window.__origGetPool = store.getPool
      store.getPool = () => Promise.reject(new Error('verify-chat-route: stubbed getPool fault'))
    })
    await emit(page, 'chat:threads-changed', { convoId: MAIN })
    const fault = await waitFor(() => page.evaluate(() => {
      const notices = [...document.querySelectorAll('.chat-route-notice')]
      if (!notices.length) return null
      const nav = document.querySelector('nav.chat-route-side')
      const kinds = nav ? [...nav.querySelectorAll('.chat-route-item')].map(el => el.dataset.routeKind) : null
      return { notices: notices.length, text: notices.map(n => n.textContent.trim()), kinds }
    }), 5_000)
    check('i', "the single 'route could not be read' notice appears",
      fault?.notices === 1 && fault.text[0] === 'the route could not be read', JSON.stringify(fault && { notices: fault.notices, text: fault.text }))
    check('i', 'no empty pipe is drawn in its place (the sidebar keeps its stages, no pieces invented)',
      !!fault?.kinds && fault.kinds.filter(k => k === 'stage').length >= 3 && !fault.kinds.includes('work') && fault.kinds[fault.kinds.length - 1] === 'end',
      fault?.kinds?.join(' > '))
    await page.evaluate(() => {
      const store = window.ioc.get('@hypercomb.social/Store')
      if (window.__hadOwnGetPool) store.getPool = window.__origGetPool
      else delete store.getPool
    })
    await emit(page, 'chat:threads-changed', { convoId: MAIN })
    const restored = await waitFor(async () => {
      const notice = await page.$('.chat-route-notice')
      const rows = await side(page)
      return !notice && rows?.some(r => r.kind === 'work') ? rows : null
    }, 6_000)
    check('i', 'restoring the store takes the notice away and the work returns', !!restored)
    const faultErrors = errors.slice(errorsBefore)
    if (faultErrors.length) console.log(`      (page errors during the stub: ${faultErrors.slice(0, 3).join(' | ')})`)

    // ── k. reduced motion ─────────────────────────────────────────────────
    const motionProbe = () => page.evaluate(() => {
      const nav = document.querySelector('nav.chat-route-side')
      const item = nav?.querySelector('.chat-route-item[data-route-kind=stage]')
      if (!item) return null
      const pieces = [...nav.querySelectorAll('.chat-route-piece, .chat-route-caption, .chat-route-junction line, .chat-route-junction rect')]
      const resting = pieces.reduce((n, el) => n + el.getAnimations().length, 0)
      const piece = item.querySelector('.chat-route-piece')
      const caption = item.querySelector('.chat-route-caption')
      getComputedStyle(piece).color; getComputedStyle(caption).color
      item.classList.add('chat-route-leak')
      getComputedStyle(piece).color; getComputedStyle(caption).color
      const changed = piece.getAnimations().length + caption.getAnimations().length
      item.classList.remove('chat-route-leak')
      getComputedStyle(piece).color
      return { resting, changed }
    })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await sleep(300)
    const control = await motionProbe()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await sleep(300)
    const reduced = await motionProbe()
    check('k', 'under reducedMotion reduce, sidebar pieces have getAnimations().length === 0 (at rest and across a state change)',
      reduced && reduced.resting === 0 && reduced.changed === 0,
      `reduce ${JSON.stringify(reduced)}; control without reduce ${JSON.stringify(control)}`)
    await page.emulateMedia({ reducedMotion: null })

    // ── l. the fixes riding along ─────────────────────────────────────────
    const readFold = () => page.evaluate(() => {
      const el = document.querySelector('.hc-rail-chats')
      const hive = document.querySelector('.hc-rail-hive')
      return el
        ? { maxHeight: getComputedStyle(el).maxHeight, overflowY: getComputedStyle(el).overflowY, rows: el.children.length }
        : { absent: true, hive: !!hive, hiveCurrent: !!hive?.classList.contains('current') }
    })
    let fold = await readFold()
    // The hive row carries no arrow: its main button enters the hive's chat
    // when it is not current, and toggles the fold when it is. Up to two presses.
    for (let press = 0; fold.absent && press < 2; press++) {
      console.log(`      (rail fold absent: ${JSON.stringify(fold)} — pressing the hive row)`)
      await page.locator('.hc-rail-hive .hc-rail-main').first().click().catch(() => {})
      await sleep(900)
      fold = await readFold()
    }
    check('l', '.hc-rail-chats computes max-height 328px (40vh at 820) with overflow-y auto',
      fold?.maxHeight === '328px' && fold.overflowY === 'auto', JSON.stringify(fold))
    await openConvo(page, MAIN)
    const icons = await page.evaluate(() => {
      const measure = el => {
        const r = el.getBoundingClientRect()
        const glyph = el.querySelector('.mat-sym')
        return { w: +r.width.toFixed(2), h: +r.height.toFixed(2), glyph: glyph ? getComputedStyle(glyph).fontSize : null }
      }
      const bar = [...document.querySelectorAll('hc-chat-window .chat-bar button')].filter(b => b.querySelector('.mat-sym') && b.getBoundingClientRect().width > 0)
      const gear = document.querySelector('hc-chat-window .chat-panel [data-hc-panel-settings]')
      return { bar: bar.map(b => ({ cls: b.className.split(/\s+/).filter(c => c.startsWith('chat-') && c !== 'chat-tool').join('.'), ...measure(b) })), gear: gear ? measure(gear) : null }
    })
    const barOk = icons.bar.length >= 3 && icons.bar.every(b => b.w === 28 && b.h === 28 && b.glyph === '17px')
    check('l', 'chat-bar icon buttons compute a 28px box and a 17px glyph', barOk, JSON.stringify(icons.bar))
    check('l', 'and equal the tool-window header gear\'s box and glyph',
      !!icons.gear && icons.bar.every(b => b.w === icons.gear.w && b.h === icons.gear.h && b.glyph === icons.gear.glyph), JSON.stringify(icons.gear))

    // ── m. contrast ───────────────────────────────────────────────────────
    await threads(page, 'appendTurn', MAIN, 'assistant',
      'One more direction.\n\n```hypercomb-question\n{"prompt":"Which colour?","options":["Warm","Cool"]}\n```')
    await emit(page, 'chat:threads-changed', { convoId: MAIN })
    await page.waitForFunction(() => !!document.querySelector('.chat-thread [role=radiogroup]'), null, { timeout: 8_000 }).catch(() => {})
    const measureContrast = () => page.evaluate(() => {
      const parse = c => {
        let m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/i.exec(c || '')
        if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]]
        m = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/i.exec(c || '')
        if (!m) return null
        return [+m[1] * 255, +m[2] * 255, +m[3] * 255, m[4] === undefined ? 1 : +m[4]]
      }
      const over = (fg, bg) => { const a = fg[3]; return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1] }
      const lum = c => { const f = v => { v /= 255; return v > 0.03928 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
      const ratio = (a, b) => { const p = [lum(a), lum(b)].sort((x, y) => y - x); return (p[0] + 0.05) / (p[1] + 0.05) }
      const groundOf = el => {
        const stack = []
        for (let n = el; n; n = n.parentElement) {
          const bg = parse(getComputedStyle(n).backgroundColor)
          if (bg && bg[3] > 0) { stack.unshift(bg); if (bg[3] >= 0.999) break }
          if (n === document.documentElement) break
        }
        let base = [255, 255, 255, 1]
        for (const layer of stack) base = over(layer, base)
        return base
      }
      const SEL = '.chat-route-caption, .chat-question-prompt, .chat-question-mark, .chat-question-n, .chat-question-label, .chat-question-hint, .chat-question-line'
      const rows = []
      const seen = new Set()
      const panel = document.querySelector('hc-chat-window .chat-panel')
      const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!(node.nodeValue || '').trim()) continue
        const el = node.parentElement
        if (!el || seen.has(el) || !el.closest(SEL)) continue
        seen.add(el)
        const cs = getComputedStyle(el)
        const b = el.getBoundingClientRect()
        if (cs.visibility === 'hidden' || cs.display === 'none' || b.width < 1 || b.height < 1) continue
        const fg = parse(cs.color)
        if (!fg) continue
        const ground = groundOf(el)
        const r = ratio(over(fg, ground), ground)
        rows.push({ cls: String(el.closest(SEL).className).split(/\s+/)[0], text: node.nodeValue.trim().slice(0, 24), ratio: +r.toFixed(2), color: cs.color })
      }
      return { theme: document.documentElement.getAttribute('data-theme'), rows }
    })
    const contrastIn = async (id, label) => {
      for (const theme of ['light', 'dark']) {
        await page.evaluate(t => {
          const svc = window.ioc?.get?.('@hypercomb.social/Theme')
          if (svc?.setTheme) svc.setTheme(t)
          document.documentElement.setAttribute('data-theme', t)
        }, theme)
        await sleep(500)
        const measured = await measureContrast()
        const classes = new Set(measured.rows.map(r => r.cls))
        const low = measured.rows.filter(r => r.ratio < 4.5)
        const worst = measured.rows.length ? Math.min(...measured.rows.map(r => r.ratio)) : null
        check(id, `${theme}: ${label} clears 4.5:1`,
          measured.theme === theme && classes.has('chat-route-caption') && low.length === 0,
          `${measured.rows.length} runs over [${[...classes].join(', ')}], worst ${worst}:1${low.length ? '; under: ' + low.slice(0, 6).map(r => `${r.cls} "${r.text}" ${r.ratio} ${r.color}`).join(' | ') : ''}`)
      }
      await page.evaluate(() => {
        const svc = window.ioc?.get?.('@hypercomb.social/Theme')
        if (svc?.setTheme) svc.setTheme('dark')
      })
    }
    await contrastIn('m', '.chat-route-caption and .chat-question-* text')

    // ── j. narrow ─────────────────────────────────────────────────────────
    await page.setViewportSize({ width: 640, height: 800 })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await boot(page)
    await openConvo(page, MAIN)
    const narrow = await waitFor(() => page.evaluate(() => {
      const group = document.querySelector('.chat-thread [role=radiogroup]')
      const lines = [...document.querySelectorAll('.chat-thread .chat-question-line')].map(e => e.textContent.trim())
      return lines.length || group ? { nav: !!document.querySelector('nav.chat-route-side'), lines, group: !!group, width: innerWidth } : null
    }), 10_000)
    check('j', 'at 640x800 there is no nav.chat-route-side', narrow && !narrow.nav, JSON.stringify(narrow && { nav: narrow.nav, width: narrow.width }))
    check('j', 'the settled line is still in the thread', narrow?.lines?.some(l => l.includes('How many pages?') && l.includes('Several pages')), JSON.stringify(narrow?.lines))
    const asksBefore = new Set((await chatAsks(MAIN)).map(a => a.sig))
    if (narrow?.group) {
      await page.locator('.chat-thread .chat-question-option').first().click()
    }
    const answered = await waitFor(() => page.evaluate(() => {
      const users = [...document.querySelectorAll('.chat-thread .chat-msg.user .chat-msg-text')].map(e => e.textContent.trim())
      return users[users.length - 1] === 'Warm' && !document.querySelector('.chat-thread [role=radiogroup]') ? users.slice(-1) : null
    }), 8_000)
    check('j', 'a new open question is still answerable at that width', narrow?.group && !!answered, JSON.stringify({ group: narrow?.group, answered }))
    const narrowAsk = await waitFor(async () => (await chatAsks(MAIN)).find(a => !asksBefore.has(a.sig)), 8_000)
    if (narrowAsk) {
      await node('_chat-reply.cjs', [MAIN, 'Warm it is.', '--ask', narrowAsk.sig])
      await node('_ask-drain.cjs', ['retire', narrowAsk.sig])
    }
    await page.setViewportSize({ width: 1280, height: 820 })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await boot(page)

    // ── o. THE FLOW — a stub machine-local model organizes every conversation ──
    const STUB_ID = 'route-verify-stub'
    const STUB_HOST = 'http://127.0.0.1:11998'
    const STUB_NODES = [
      { id: 'setup', title: 'Set up the verifier hive', detail: 'A scratch conversation to prove the route.', turns: [0, 1], state: 'done' },
      { id: 'layout', title: 'Decide the site layout', detail: 'Chose the structure of the pages.', turns: [2, 3, 4, 5], state: 'decided' },
      { id: 'pages', parent: 'layout', title: 'Settle the page count', turns: [3, 4], state: 'decided' },
      { id: 'pick', parent: 'pages', title: 'Take the multi-page option', turns: [4], state: 'decided' },
      { id: 'probe', parent: 'layout', title: 'Probe a missing tile', turns: [3], state: 'dropped' },
      { id: 'colour', title: 'Choose a colour direction', turns: [6], state: 'open' },
    ]
    const stubLog = []
    await page.route(`${STUB_HOST}/**`, route => {
      const url = route.request().url()
      const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' }
      if (url.endsWith('/v1/models')) return route.fulfill({ status: 200, headers, body: JSON.stringify({ data: [{ id: 'stub-organizer:1b' }] }) })
      if (url.endsWith('/v1/chat/completions')) {
        const body = route.request().postData() ?? ''
        stubLog.push({ at: Date.now(), body })
        const update = /PREVIOUS WORKFLOW/.test(body)
        const last = Number((/NEW TURNS \d+–(\d+)/.exec(body) ?? /TURNS 0–(\d+)/.exec(body) ?? [])[1] ?? 1)
        const nodes = update
          ? [...STUB_NODES, { id: 'carry-on', title: 'Carry the conversation on', turns: [last - 1, last], state: 'open' }]
          : STUB_NODES
        // Wrapped the way a small model often answers: a reasoning block and a fence.
        const content = `<think>grouping by the work</think>\n\`\`\`json\n${JSON.stringify({ nodes })}\n\`\`\``
        return route.fulfill({ status: 200, headers, body: JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }) })
      }
      return route.fulfill({ status: 404, headers, body: '{}' })
    })
    const registerStub = () => page.evaluate(([id, host]) => {
      const registry = window.ioc?.get?.('@diamondcoreprocessor.com/LlmProviderRegistry')
      if (!registry) return 'no provider registry on ioc'
      if (!registry.get(id)) {
        registry.register({
          id, label: 'Route verify stub', vendor: 'local', transport: 'browser-http', endpoint: host, requiresKey: false,
          models: [{ name: 'stub-organizer', id: 'stub-organizer:1b', tier: 'fast' }], defaultModel: 'stub-organizer:1b',
          docsUrl: 'https://example.test',
          // text/plain body: a simple request, no preflight for page.route to miss.
          toRequest: request => ({ url: `${host}/v1/chat/completions`, init: { method: 'POST', body: JSON.stringify({ model: request.model, system: request.system, messages: request.messages }) } }),
          fromResponse: (json, request) => ({ text: json?.choices?.[0]?.message?.content ?? '', stopReason: 'stop', inputTokens: 0, outputTokens: 0, model: request.model }),
        })
      }
      // "A server answered here before" — what lets the router's own read probe it.
      localStorage.setItem(`hc:llm:${id}:answered`, '1')
      return 'ok'
    }, [STUB_ID, STUB_HOST])
    const ROUTER = '@diamondcoreprocessor.com/LlmRouter'
    const awake = id => waitFor(() => page.evaluate(([key, pid]) => window.ioc?.get?.(key)?.ready?.({ providerId: pid }) === true, [ROUTER, id]), 45_000, 500)

    // Six conversations nobody has opened, seeded while NO model is up: live and
    // archived, old and new, one whose last exchange is seconds old.
    const minutesAgo = m => Date.now() - m * 60_000
    const DRAIN = {
      liveNewer: 'chat:tile:/::drain-live-newer',
      liveOlder: 'chat:tile:/::drain-live-older',
      archivedNewer: 'chat:tile:/::drain-archived-newer',
      archivedOlder: 'chat:tile:/::drain-archived-older',
      recent: 'chat:tile:/::drain-recent',
      fresh: 'chat:tile:/::drain-fresh',
    }
    const twoExchangesAt = async (convoId, marker, at) => {
      await seedTurn(page, convoId, 'user', `${marker} first question about the garden plan`, at)
      await seedTurn(page, convoId, 'assistant', 'Drafted a first plan for the beds.', at + 1_000)
      await seedTurn(page, convoId, 'user', `${marker} second question about watering`, at + 2_000)
      await seedTurn(page, convoId, 'assistant', 'Added a watering schedule.', at + 3_000)
    }
    await twoExchangesAt(DRAIN.archivedOlder, 'DRAIN-ARCHIVED-OLDER', minutesAgo(50))
    await twoExchangesAt(DRAIN.liveOlder, 'DRAIN-LIVE-OLDER', minutesAgo(40))
    await twoExchangesAt(DRAIN.archivedNewer, 'DRAIN-ARCHIVED-NEWER', minutesAgo(30))
    await twoExchangesAt(DRAIN.liveNewer, 'DRAIN-LIVE-NEWER', minutesAgo(20))
    await seedTurn(page, DRAIN.recent, 'user', 'DRAIN-RECENT first question about the garden plan', minutesAgo(30))
    await seedTurn(page, DRAIN.recent, 'assistant', 'Drafted a first plan for the beds.', minutesAgo(29))
    await seedTurn(page, DRAIN.recent, 'user', 'DRAIN-RECENT second question about watering', Date.now() - 6_000)
    await seedTurn(page, DRAIN.recent, 'assistant', 'Added a watering schedule.', Date.now() - 5_000)
    await seedTurn(page, DRAIN.fresh, 'user', 'DRAIN-FRESH question about compost', Date.now() - 4_000)
    await seedTurn(page, DRAIN.fresh, 'assistant', 'Started a compost note.', Date.now() - 3_000)
    await threads(page, 'setConversationArchived', DRAIN.archivedOlder, true)
    await threads(page, 'setConversationArchived', DRAIN.archivedNewer, true)
    await openConvo(page, MAIN)
    await sleep(3_000)

    const beforeStub = await readFlowSlot(page, MAIN)
    check('o', 'with no model up (the drain woke and ran), nothing was organized: no flows pool, no model request, no :11434',
      !beforeStub.pool && stubLog.length === 0 && since(0, /:11434\b|:11998\b/).length === 0,
      JSON.stringify({ pool: beforeStub.pool, stubCalls: stubLog.length, knocks: since(0, /:11434\b|:11998\b/).length }))

    const registered = await registerStub()
    check('o', 'a stub machine-local provider registers through the provider registry', registered === 'ok', registered)
    check('o', 'the router finds the stub awake (its own liveness probe, answered by page.route)', !!(await awake(STUB_ID)))
    await emit(page, 'chat:threads-changed', { convoId: MAIN })

    const mainFlow = await waitFor(async () => {
      const nodes = ((await side(page)) ?? []).filter(r => r.kind === 'node')
      return nodes.length >= STUB_NODES.length ? nodes : null
    }, 30_000, 300)
    const oRows = await side(page) ?? []
    const oNodes = oRows.filter(r => r.kind === 'node')
    check('o', 'the open conversation\'s sidebar draws the flow\'s nodes in record order',
      !!mainFlow && oNodes.map(r => r.node).join(',') === STUB_NODES.map(n => n.id).join(','),
      oRows.map(r => r.kind === 'node' ? `node:${r.node}` : r.kind).join(' > '))
    const byNode = new Map(oNodes.map(r => [r.node, r]))
    const structureOk = oNodes.every((r, at) => {
      const want = STUB_NODES.find(n => n.id === r.node)
      if (!want) return false
      const parentRow = want.parent ? byNode.get(want.parent) : undefined
      const parentAt = want.parent ? oNodes.findIndex(p => p.node === want.parent) : -1
      const depth = Number(r.depth)
      return (r.parent ?? undefined) === want.parent
        && (!want.parent || (parentAt >= 0 && parentAt < at && depth === Number(parentRow.depth) + 1))
        && (!!want.parent === /chat-route-branch/.test(r.cls))
        && r.state === want.state
    })
    check('o', 'branch structure: data-route-parent names an EARLIER node, data-route-depth is the parent\'s + 1, .chat-route-branch on every child, data-route-state as recorded',
      structureOk, JSON.stringify(oNodes.map(r => ({ node: r.node, parent: r.parent, depth: r.depth, state: r.state, branch: /chat-route-branch/.test(r.cls) }))))
    check('o', 'the lines are drawn: a branch passing a deeper row leaves a rail, a parent with a child below has a stem, a parent is aria-expanded',
      byNode.get('pick')?.rails >= 1 && byNode.get('layout')?.stem && byNode.get('pages')?.stem
        && byNode.get('layout')?.expanded === 'true' && byNode.get('pages')?.expanded === 'true' && byNode.get('setup')?.expanded === null,
      JSON.stringify(oNodes.map(r => ({ node: r.node, rails: r.rails, stem: r.stem, expanded: r.expanded }))))
    check('o', 'node titles are the flow\'s words (never a message), and a node carries the pieces of its turns',
      oNodes.every(r => r.title === STUB_NODES.find(n => n.id === r.node)?.title) && byNode.get('layout')?.minis >= 1,
      JSON.stringify(oNodes.map(r => ({ node: r.node, title: r.title, minis: r.minis }))))
    const oSlot = await readFlowSlot(page, MAIN)
    check('o', 'the slot holds ONE record at v1 for the conversation; its turn lists are what the sidebar carries',
      oSlot.files === 1 && oSlot.record?.kind === 'chat:route-flow' && oSlot.record.v === 1
        && oNodes.every(r => r.turns === (oSlot.record.nodes.find(n => n.id === r.node)?.turns ?? []).join(',')),
      JSON.stringify({ files: oSlot.files, upTo: oSlot.record?.upToTurnCount, nodes: oSlot.record?.nodes?.map(n => `${n.id}[${n.turns}]`) }))
    const lastNodeAt = oRows.map(r => r.kind).lastIndexOf('node')
    const tailStages = oRows.slice(lastNodeAt + 1).filter(r => r.kind === 'stage')
    const oTurns = (await threads(page, 'readTurns', MAIN)) ?? []
    check('o', 'the exchanges past the flow follow it as DORMANT stages with no text',
      oSlot.record && oSlot.record.upToTurnCount < oTurns.length && tailStages.length >= 1 && tailStages.every(s => s.dormant && s.caption === '')
        && oRows.slice(0, lastNodeAt).every(r => r.kind === 'node'),
      JSON.stringify({ upTo: oSlot.record?.upToTurnCount, turns: oTurns.length, tail: oRows.slice(lastNodeAt + 1).map(r => `${r.kind}${r.dormant ? '(dormant)' : ''}:${r.caption}`) }))
    const oSideText = await page.evaluate(() => document.querySelector('nav.chat-route-side')?.textContent ?? '')
    const allMessages = [...messageTexts, 'Warm it is.', 'One more direction.']
    check('o', 'still no message text anywhere on the sidebar', !allMessages.some(t => oSideText.includes(t)),
      JSON.stringify(allMessages.filter(t => oSideText.includes(t))))

    // Click a node: every message it covers lights, and the first is brought into view.
    await page.evaluate(() => { const s = document.querySelector('.chat-thread'); if (s) s.scrollTop = s.scrollHeight })
    await page.mouse.move(5, 5)
    await page.locator('nav.chat-route-side .chat-route-item[data-route-node="layout"] .chat-route-piece').click()
    const layoutRows = String(byNode.get('layout')?.turns ?? '').split(',').filter(Boolean)
    const nodeLit = await waitFor(() => page.evaluate(rows => {
      const scroller = document.querySelector('.chat-thread')
      const msgs = rows.map(row => document.querySelector(`.chat-msg[data-route-row="${row}"]`))
      if (!scroller || msgs.some(m => !m?.classList.contains('chat-route-lit'))) return null
      const first = msgs[0].getBoundingClientRect(), s = scroller.getBoundingClientRect()
      const litElsewhere = [...document.querySelectorAll('.chat-msg.chat-route-lit')].map(m => m.dataset.routeRow).filter(r => !rows.includes(r))
      return { lit: rows, litElsewhere, firstInView: first.bottom > s.top && first.top < s.bottom }
    }, layoutRows), 4_000)
    check('o', `clicking node "layout" lights ALL its covered messages [${layoutRows}] and scrolls the first into view`,
      !!nodeLit && nodeLit.firstInView && nodeLit.litElsewhere.length === 0, JSON.stringify(nodeLit))

    // The detail card names the node, its state, and its turns as numbers.
    await page.locator('nav.chat-route-side .chat-route-item[data-route-node="layout"]').hover()
    const nodeCard = await waitFor(() => page.evaluate(() => {
      const c = document.querySelector('.chat-route-card[role=tooltip][data-route-kind=node]')
      if (!c) return null
      const copy = c.cloneNode(true)
      copy.querySelectorAll('.mat-sym').forEach(glyph => glyph.remove())
      return copy.textContent.replace(/\s+/g, ' ').trim()
    }), 3_000)
    check('o', 'the node\'s detail card shows its title, detail, state and covered turns as numbers',
      !!nodeCard && nodeCard.includes('Decide the site layout') && nodeCard.includes('Chose the structure of the pages.')
        && nodeCard.includes('decided') && nodeCard.includes('messages 3–6'),
      JSON.stringify(nodeCard))
    await page.mouse.move(5, 5)

    // ←/→ fold and unfold a branch, and walk into it.
    await page.locator('nav.chat-route-side .chat-route-item[data-route-node="layout"]').focus()
    await page.keyboard.press('ArrowLeft')
    const folded = await waitFor(async () => {
      const nodes = ((await side(page)) ?? []).filter(r => r.kind === 'node')
      const layout = nodes.find(r => r.node === 'layout')
      return layout?.expanded === 'false' && !nodes.some(r => ['pages', 'pick', 'probe'].includes(r.node)) ? { nodes, layout } : null
    }, 3_000)
    check('o', '← on a node with a branch folds it: its descendants leave the pipe, aria-expanded=false, the folded count shows',
      !!folded && folded.layout.hidden === '+3', JSON.stringify(folded ? { nodes: folded.nodes.map(r => r.node), hidden: folded.layout.hidden } : await side(page)))
    await page.keyboard.press('ArrowRight')
    const unfolded = await waitFor(async () => {
      const nodes = ((await side(page)) ?? []).filter(r => r.kind === 'node')
      return nodes.map(r => r.node).join(',') === STUB_NODES.map(n => n.id).join(',') && nodes.find(r => r.node === 'layout')?.expanded === 'true' ? nodes : null
    }, 3_000)
    check('o', '→ unfolds it again, in place', !!unfolded)
    const focusedKey = () => page.evaluate(() => document.activeElement?.dataset?.routeKey ?? '')
    await page.keyboard.press('ArrowRight')
    const intoChild = await waitFor(async () => (await focusedKey()) === 'n:pages' ? 'n:pages' : null, 2_000) ?? await focusedKey()
    // Two presses back to back, as a quick hand makes them: the first folds
    // the child, the second must see the fold and walk to the parent.
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    const backToParent = await waitFor(async () => (await focusedKey()) === 'n:layout' ? 'n:layout' : null, 2_000) ?? await focusedKey()
    const pagesFolded = await waitFor(async () => {
      const row = ((await side(page)) ?? []).find(r => r.node === 'pages')
      return row?.expanded === 'false' ? row : null
    }, 2_000) ?? ((await side(page)) ?? []).find(r => r.node === 'pages')
    check('o', '→ on an open branch walks to its first child; ← folds that child, a second quick ← returns to the parent',
      intoChild === 'n:pages' && pagesFolded?.expanded === 'false' && backToParent === 'n:layout',
      JSON.stringify({ intoChild, pagesExpanded: pagesFolded?.expanded, backToParent }))
    // Put it back: → from the parent walks in, → on the folded child unfolds it.
    await page.keyboard.press('ArrowRight')
    await waitFor(async () => (await focusedKey()) === 'n:pages', 2_000)
    await page.keyboard.press('ArrowRight')
    const restoredFold = await waitFor(async () => ((await side(page)) ?? []).some(r => r.node === 'pick'), 2_000)
    check('o', 'and → on the folded child unfolds it again', !!restoredFold)
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur() })

    // The passive drain: every seeded conversation, live newest first, then archived.
    const seedMarkers = ['DRAIN-RECENT', 'DRAIN-LIVE-NEWER', 'DRAIN-LIVE-OLDER', 'DRAIN-ARCHIVED-NEWER', 'DRAIN-ARCHIVED-OLDER']
    const markerOf = body => (/(DRAIN-[A-Z-]+?) (?:first|second|question)/.exec(body) ?? [])[1] ?? null
    const drained = await waitFor(() => {
      const seen = stubLog.map(entry => markerOf(entry.body)).filter(Boolean)
      return seedMarkers.every(m => seen.includes(m)) ? seen : null
    }, 90_000, 500)
    const seenOrder = stubLog.map(entry => markerOf(entry.body)).filter(Boolean)
    const firstSeen = [...new Set(seenOrder)]
    check('o', 'the orchestrator\'s passive drain organizes the unopened conversations: live newest first, then archived newest first',
      !!drained && firstSeen.filter(m => seedMarkers.includes(m)).join(',') === seedMarkers.join(','),
      JSON.stringify(firstSeen))
    const recentBody = stubLog.find(entry => markerOf(entry.body) === 'DRAIN-RECENT')?.body ?? ''
    const recentSlot = await readFlowSlot(page, DRAIN.recent)
    check('o', 'it leaves the recently touched conversation\'s last exchange alone (organized up to turn 2 of 4)',
      recentBody.includes('DRAIN-RECENT first question') && !recentBody.includes('DRAIN-RECENT second question')
        && recentSlot.record?.upToTurnCount === 2,
      JSON.stringify({ upTo: recentSlot.record?.upToTurnCount, sawSecond: recentBody.includes('DRAIN-RECENT second question') }))
    const olderSlot = await readFlowSlot(page, DRAIN.liveOlder)
    const archivedSlot = await readFlowSlot(page, DRAIN.archivedOlder)
    check('o', 'a long-quiet conversation is organized whole, archived ones too, each into one slot',
      olderSlot.record?.upToTurnCount === 4 && olderSlot.files === 1 && archivedSlot.record?.upToTurnCount === 4 && archivedSlot.files === 1,
      JSON.stringify({ liveOlder: [olderSlot.record?.upToTurnCount, olderSlot.files], archivedOlder: [archivedSlot.record?.upToTurnCount, archivedSlot.files] }))
    const mainMints = stubLog.filter(entry => entry.body.includes('seed: what is this hive?'))
    const perSeed = seedMarkers.map(m => seenOrder.filter(s => s === m).length)
    check('o', 'no double mint: the open conversation (attended AND drained) was organized once, each seed once',
      mainMints.length === 1 && perSeed.every(n => n === 1),
      JSON.stringify({ main: mainMints.length, perSeed: Object.fromEntries(seedMarkers.map((m, i) => [m, perSeed[i]])) }))

    // A new closed exchange re-derives the ONE slot in place, from the previous flow.
    const beforeRederive = stubLog.length
    await threads(page, 'appendTurn', MAIN, 'user', 'FLOW-NEXT: add a contact section')
    await threads(page, 'appendTurn', MAIN, 'assistant', 'FLOW-NEXT: added a contact section.')
    await threads(page, 'appendTurn', MAIN, 'user', 'FLOW-LAST: and a map?')
    await emit(page, 'chat:threads-changed', { convoId: MAIN })
    const rederived = await waitFor(async () => {
      const update = stubLog.slice(beforeRederive).find(entry => entry.body.includes('FLOW-NEXT'))
      const nodes = ((await side(page)) ?? []).filter(r => r.kind === 'node')
      return update && nodes.some(r => r.node === 'carry-on') ? { update, nodes } : null
    }, 30_000, 300)
    const reSlot = await readFlowSlot(page, MAIN)
    const reTurns = (await threads(page, 'readTurns', MAIN)) ?? []
    check('o', 'a new closed exchange re-derives the flow with the PREVIOUS flow in the prompt',
      !!rederived && /PREVIOUS WORKFLOW \(organizes turns 0–\d+\):/.test(rederived.update.body) && rederived.update.body.includes('Decide the site layout')
        && rederived.update.body.includes('UPDATE it'),
      rederived ? rederived.update.body.slice(0, 160).replace(/\s+/g, ' ') + '…' : 'no update call')
    check('o', 'in place: still ONE file in the slot, further along, and the new node is drawn',
      reSlot.files === 1 && reSlot.record?.upToTurnCount > (oSlot.record?.upToTurnCount ?? 0) && reSlot.record.upToTurnCount === reTurns.length - 1,
      JSON.stringify({ files: reSlot.files, upTo: [oSlot.record?.upToTurnCount, reSlot.record?.upToTurnCount], turns: reTurns.length }))
    const reRows = await side(page) ?? []
    const reTail = reRows.slice(reRows.map(r => r.kind).lastIndexOf('node') + 1).filter(r => r.kind === 'stage')
    check('o', 'the unanswered last exchange stays a dormant tail stage with no text',
      reTail.length === 1 && reTail[0].dormant && reTail[0].caption === '' && Number(reTail[0].row) === reTurns.length - 1,
      JSON.stringify(reTail.map(r => ({ row: r.row, dormant: r.dormant, caption: r.caption }))))

    await contrastIn('o', 'with a flow drawn, .chat-route-caption (node titles) and .chat-question-* text')

    // Reload with NO model: the flow shows from the pool; nothing is called, nothing knocked.
    // What the POOL holds — folds are how the participant was looking, not a
    // record, so a reload draws every node.
    const nodesBefore = (reSlot.record?.nodes ?? []).map(n => `${n.id}:${n.title}`)
    const slotsBefore = (await readFlowSlot(page, MAIN)).slots
    const reloadAt = Date.now()
    const callsBeforeReload = stubLog.length
    await page.reload({ waitUntil: 'domcontentloaded' })
    await boot(page)
    await openConvo(page, MAIN)
    const fromPool = await waitFor(async () => {
      const rows = ((await side(page)) ?? []).filter(r => r.kind === 'node').map(r => `${r.node}:${r.title}`)
      return rows.join('|') === nodesBefore.join('|') ? rows : null
    }, 15_000, 300)
    await sleep(8_000)
    check('o', 'after a reload with no model the same flow shows, read from the pool',
      !!fromPool, JSON.stringify({ before: nodesBefore, after: ((await side(page)) ?? []).filter(r => r.kind === 'node').map(r => `${r.node}:${r.title}`) }))
    check('o', 'and with the gate closed the page made zero model calls and zero requests to :11434 or the stub',
      stubLog.length === callsBeforeReload && since(reloadAt, /:11434\b|:11998\b/).length === 0 && (await readFlowSlot(page, MAIN)).slots === slotsBefore,
      JSON.stringify({ calls: stubLog.length - callsBeforeReload, requests: since(reloadAt, /:11434\b|:11998\b/).map(r => r.url) }))
    await page.unroute(`${STUB_HOST}/**`)

    // ── p. the REAL local model runs after this context closes (realPath) ──

    console.log(`\npage errors: ${errors.length}${errors.length ? ' — ' + [...new Set(errors)].slice(0, 5).join(' | ') : ''}`)
  } catch (err) {
    check('!', 'driver', false, String(err && err.stack || err))
    exitCode = 1
  } finally {
    await context.close().catch(() => {})
    try { fs.rmSync(PROFILE, { recursive: true, force: true }) } catch { /* reported below */ }
    console.log(`scratch profile ${fs.existsSync(PROFILE) ? 'NOT removed' : 'removed'}: ${PROFILE}`)
  }
  if (realModel) await realPath()
  else console.log('      (no local model answered at 127.0.0.1:11434 — the REAL model is NOT exercised)')
  const failed = results.filter(r => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  process.exit(failed || exitCode ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(1) })
