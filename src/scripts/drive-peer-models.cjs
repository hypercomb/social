#!/usr/bin/env node
// drive-peer-models — proves ONE PARTICIPANT'S MACHINE ANSWERING FOR ANOTHER.
//
// Two genuinely separate clients (own context, own OPFS, own pubkey) in one
// room on a real relay. A lends their local model to the swarm; B sees the
// offer as a provider and gets an answer generated on A's machine.
//
//   node scripts/drive-peer-models.cjs [--url http://localhost:4251]
//                                      [--relay ws://localhost:7777]
//                                      [--model-port 8799] [--out <dir>]
//
// A's "local model" is a stand-in Ollama on localhost: a tiny server speaking
// the OpenAI shape, which A's `local` provider is pointed at through the same
// endpoint override a participant would use. That makes the proof honest
// end-to-end — the text B receives is produced by a process only A can reach.
//
// Flow:
//   1. both clients join the same room+secret on the relay and go public
//   2. A points `local` at the stand-in and switches lending ON
//   3. B's console grows a peer row: no key, "another participant's machine"
//   4. B calls it — the request crosses the relay, A generates, B gets text
//      that only A's process could have produced
//   5. A switches lending OFF; the offer stops being renewed
//
// Requires the local relay (scripts/local-relay.ts, port 7777) and a dev
// shell. `--engine chrome` required: headless chromium cannot init Pixi.

const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { chromium, firefox, webkit } = require('playwright')

function arg(name, fallback) {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : true
}

function launcherFor(name) {
  switch (String(name)) {
    case 'firefox': return { type: firefox, opts: {} }
    case 'webkit': return { type: webkit, opts: {} }
    case 'msedge': return { type: chromium, opts: { channel: 'msedge' } }
    case 'chromium': return { type: chromium, opts: {} }
    default: return { type: chromium, opts: { channel: 'chrome' } }
  }
}

const results = []
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail })
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''))
}

// One zone per run: a shared relay's stored history can never leak in.
const ROOM = 'peers-' + Math.random().toString(36).slice(2, 8)
const SECRET = 'secret-' + Math.random().toString(36).slice(2, 10)
// The phrase only A's stand-in model can produce — proof of WHERE the text
// came from, not merely that some text came back.
const SHIBBOLETH = 'answered-on-peer-a-' + Math.random().toString(36).slice(2, 8)

async function poll(fn, ms = 45_000, every = 1000) {
  const until = Date.now() + ms
  for (;;) {
    const value = await fn()
    if (value) return { ok: true, value }
    if (Date.now() > until) return { ok: false, value: null }
    await new Promise(r => setTimeout(r, every))
  }
}

async function main() {
  const url = String(arg('url', 'http://localhost:4251'))
  const relay = String(arg('relay', 'ws://localhost:7777'))
  const modelPort = Number(arg('model-port', 8799))
  const out = path.resolve(String(arg('out', 'test-results/peer-models')))
  fs.mkdirSync(out, { recursive: true })

  // ── A's local model: a stand-in Ollama nobody else can reach ─────────
  let served = 0
  const model = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', '*')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => {
      served++
      const asked = (() => {
        try { return JSON.parse(body)?.messages?.slice(-1)[0]?.content ?? '' } catch { return '' }
      })()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      // The MODEL NAME carries the shibboleth so the proof lands in B's own
      // UI: the console's Test button prints the model that answered, and
      // only A's process can produce this string.
      res.end(JSON.stringify({
        model: SHIBBOLETH,
        choices: [{ message: { content: `${SHIBBOLETH} :: ${String(asked).slice(0, 40)}` }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 7, completion_tokens: 11 },
      }))
    })
  })
  await new Promise(r => model.listen(modelPort, '127.0.0.1', r))
  console.log(`  info  stand-in local model on 127.0.0.1:${modelPort}, room ${ROOM}`)

  const { type, opts } = launcherFor(arg('engine', 'chrome'))
  const browser = await type.launch({ headless: true, ...opts })

  const makeClient = async (label, extra = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } })
    await ctx.addInitScript(({ room, secret, relayUrl, extras }) => {
      localStorage.setItem('hc:room', room)
      localStorage.setItem('hc:secret', secret)
      localStorage.setItem('hc:nostrmesh:relays', JSON.stringify([relayUrl]))
      for (const [k, v] of Object.entries(extras)) localStorage.setItem(k, String(v))
    }, { room: ROOM, secret: SECRET, relayUrl: relay, extras: extra })
    const page = await ctx.newPage()
    page.on('pageerror', e => console.log(`  ${label} pageerror`, String(e).slice(0, 120)))
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(9000)
    const startEmpty = page.getByText('Start empty', { exact: true })
    if (await startEmpty.count()) { await startEmpty.first().click(); await page.waitForTimeout(2500) }
    // Joining is a per-session GESTURE (a refresh always lands private), so
    // perform the same keymap command the swarm control emits.
    await page.evaluate(() => {
      const bus = window.__hypercombEffectBus
      bus.emit('keymap:invoke', { cmd: 'mesh.togglePublic', binding: null, event: null })
    })
    await page.waitForTimeout(4000)
    return page
  }

  try {
    // A lends; its `local` provider points at the stand-in.
    const A = await makeClient('A', {
      'hc:llm:local:host': `http://127.0.0.1:${modelPort}`,
      'hc:llm:peer-offer': 'true',
      'hc:display-name': 'Peer A',
    })
    const B = await makeClient('B')

    // "Joined" means a relay socket is OPEN — getDebug reports sockets, not a
    // public flag (the flag lives in the swarm control's own state).
    const openSockets = async (page) => page.evaluate(() =>
      (window.ioc?.get?.('@diamondcoreprocessor.com/NostrMeshDrone')?.getDebug?.()?.sockets ?? [])
        .filter(s => s.readyState === 1).length)
    const socketsA = await poll(async () => (await openSockets(A)) || null, 30_000)
    const socketsB = await poll(async () => (await openSockets(B)) || null, 30_000)
    check('both clients hold an open relay socket', socketsA.ok && socketsB.ok,
      `A=${socketsA.value ?? 0} B=${socketsB.value ?? 0}`)

    // A re-publishes its offer now that the mesh is up.
    await A.evaluate(() => window.__hypercombEffectBus.emit('peer-models:lend', { on: true }))

    // ── B sees the offer as an ordinary provider ─────────────────────────
    const seen = await poll(async () => B.evaluate(() => {
      const reg = window.ioc?.get?.('@diamondcoreprocessor.com/LlmProviderRegistry')
      const peer = (reg?.all?.() ?? []).find(p => p.transport === 'peer-swarm')
      return peer ? { id: peer.id, label: peer.label, models: peer.models.map(m => m.id), peer: peer.peer } : null
    }), 60_000)
    check('B sees A’s offer as a provider', seen.ok, JSON.stringify(seen.value))
    check('the offered provider needs no key and reads no hive',
      !!seen.value && (await B.evaluate(id => {
        const p = window.ioc?.get?.('@diamondcoreprocessor.com/LlmProviderRegistry')?.get?.(id)
        return p?.requiresKey === false && !p?.readsHive
      }, seen.value?.id)))

    await B.evaluate(() => window.__hypercombEffectBus.emit('providers:open', {}))
    await B.waitForTimeout(800)
    const row = B.locator('.hc-providers .hc-provider', { hasText: 'Peer A' }).first()
    check('it is a row in B’s providers console', (await row.count()) === 1)
    if (await row.count()) {
      await row.locator('.hc-provider-head').click()
      await B.waitForTimeout(300)
      check('badged as another participant’s machine',
        (await row.locator('.hc-provider-badge', { hasText: 'another participant' }).count()) === 1)
      check('and asks B for no key', (await row.locator('input[type="password"]').count()) === 0)
    }
    await B.screenshot({ path: path.join(out, '01-peer-offer.png') })

    // ── the actual call: B asks, A's machine answers ─────────────────────
    //
    // Through the console's own Test button — the same path a participant
    // uses, rather than a hook invented for the harness. It calls the
    // dispatch, which routes a peer provider over the mesh, and prints the
    // model that answered.
    const before = served
    await row.locator('.hc-provider-btn', { hasText: 'Test' }).first().click()
    const status = await poll(async () => {
      const text = await row.locator('.hc-provider-status').innerText().catch(() => '')
      return text && !/Testing/i.test(text) ? text : null
    }, 90_000)

    check('B’s call reached A and came back', status.ok && String(status.value).startsWith('✓'),
      String(status.value ?? '(no reply)').slice(0, 140))
    check('the answer was generated on A’s machine, not B’s',
      String(status.value ?? '').includes(SHIBBOLETH), String(status.value ?? '').slice(0, 80))
    check('A’s local model actually ran once', served === before + 1, `calls=${served - before}`)
    await B.screenshot({ path: path.join(out, '02-answered.png') })

    // ── switching lending off stops the offer ────────────────────────────
    await A.evaluate(() => window.__hypercombEffectBus.emit('peer-models:lend', { on: false }))
    const stillLending = await A.evaluate(() =>
      localStorage.getItem('hc:llm:peer-offer'))
    check('A can stop lending', stillLending === 'false', String(stillLending))
  } finally {
    await browser.close()
    await new Promise(r => model.close(r))
  }

  const failed = results.filter(r => !r.ok)
  console.log(`\n  ${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
