// scripts/drive-sync-test.cjs
//
// Drive 4250 (hypercomb-dev) and 4260 (hypercomb-web) with Playwright,
// configure room + secret, navigate both to /dolphin, fire an expose on
// 4250, then watch 4260 for the receive-side [sync] trace. Dumps every
// [sync] line from both pages on exit so we can see where the flow
// breaks.
//
// Usage: node scripts/drive-sync-test.cjs [--headed]

const { chromium } = require('playwright')

const URL_A = 'http://localhost:4250/'
const URL_B = 'http://localhost:4260/'
const ROOM = 'sync-test-room'
const SECRET = 'sync-test-secret'
const LOCAL_LOCATION = '/dolphin'  // legacy key — set both for safety
const TILE_NAME = `bot-${Date.now().toString(36)}`

const HEADED = process.argv.includes('--headed')

function logTimestamped(tag, ...args) {
  const t = new Date().toISOString().slice(11, 23)
  console.log(`[${t}] [${tag}]`, ...args)
}

async function pageWithLogs(browser, label, url) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const logs = []

  page.on('console', (msg) => {
    const text = msg.text()
    // Capture everything but only echo [sync] lines to keep output focused.
    logs.push({ kind: 'console', level: msg.type(), text })
    if (text.includes('[sync]') || text.includes('[paired-channel]')) {
      logTimestamped(label, text)
    }
  })
  page.on('pageerror', (err) => {
    logs.push({ kind: 'error', text: String(err) })
    logTimestamped(label, 'PAGE ERROR:', String(err))
  })

  await page.goto(url, { waitUntil: 'domcontentloaded' })
  return { page, ctx, logs }
}

async function configure(page) {
  // Set BOTH the canonical mesh stores AND the legacy paired-channel
  // localStorage keys, since I'm not sure which the current build is
  // reading. Belt and suspenders. ALSO flip the master mesh-public
  // switch so the mesh actually connects to relays — without this
  // every publish silently no-ops (`networkEnabled: false`).
  await page.evaluate(({ room, secret, location }) => {
    try {
      localStorage.setItem('hc:room', room)
      localStorage.setItem('hc:secret', secret)
      localStorage.setItem('hypercomb.paired-channel.location', location)
      localStorage.setItem('hypercomb.paired-channel.secret', secret)
      // Master mesh-network switch — defaults to OFF (private). Need it
      // ON for actual network traffic.
      localStorage.setItem('hc:mesh-public', 'true')
      localStorage.setItem('hc:nostrmesh:network', '1')
    } catch (e) {
      console.warn('[driver] localStorage write failed', e)
    }
  }, { room: ROOM, secret: SECRET, location: LOCAL_LOCATION })
}

async function probeState(page) {
  return page.evaluate(async () => {
    const win = window
    try {
      const ioc = win.ioc
      if (!ioc) return { err: 'no ioc' }
      const drone = ioc.get('@diamondcoreprocessor.com/PairedChannelDrone')
      const signer = ioc.get('@diamondcoreprocessor.com/NostrSigner')
      const mesh = ioc.get('@diamondcoreprocessor.com/NostrMeshDrone')
      const lineage = ioc.get('@hypercomb.social/Lineage')
      const room = ioc.get('@hypercomb.social/RoomStore')?.value
      const secret = ioc.get('@hypercomb.social/SecretStore')?.value
      const channels = drone?.joinedChannels?.() ?? []
      const ch = channels[0] || null
      const machine = ch ? drone.stateOf(ch) : null
      // Mesh internal state — probe via the snapshot helper or peek
      // private fields (mesh is registered so we have a handle).
      let meshSnapshot = null
      try {
        if (typeof mesh?.snapshot === 'function') meshSnapshot = mesh.snapshot()
        else meshSnapshot = {
          relays: mesh?.relays,
          networkEnabled: mesh?.networkEnabled,
          started: mesh?.started,
          socketCount: mesh?.sockets?.size,
          stats: mesh?.stats,
        }
      } catch { /* ignore */ }
      return {
        meshRegistered: !!mesh,
        droneRegistered: !!drone,
        signerRegistered: !!signer,
        pubkey: signer ? await signer.getPublicKeyHex() : null,
        room,
        secret: secret ? `(set ${secret.length}ch)` : null,
        segments: lineage?.explorerSegments?.() ?? null,
        channelCount: channels.length,
        channelId: ch,
        hostPubkey: machine?.state?.hostPubkey ?? null,
        sharesCount: machine?.state?.shares?.size ?? 0,
        layersBuffered: machine?.state?.layers?.size ?? 0,
        meshEventsForChannel: ch ? mesh?.getNonExpired?.(ch)?.length ?? null : null,
        mesh: meshSnapshot,
      }
    } catch (e) {
      return { err: String(e) }
    }
  })
}

async function ensureOpfsReady(page, timeoutMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await page.evaluate(async () => {
      try {
        const win = window
        const lineage = win.ioc?.get('@hypercomb.social/Lineage')
        if (!lineage?.explorerDir) return false
        const dir = await lineage.explorerDir()
        return !!dir
      } catch { return false }
    })
    if (ok) return true
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}

async function addTileAt(page, name) {
  // Drive the REAL UI — type the tile name into the command-line
  // input and press Enter. Mirrors a user adding a cell exactly.
  try {
    // Find the command-line input. Selector falls back through a few
    // shapes so we tolerate minor template variants.
    const inputHandle = await page.evaluateHandle(() => {
      const candidates = [
        'hc-command-line input',
        'app-command-line input',
        'input[placeholder*="command" i]',
        'input[placeholder*="cell" i]',
        'input[type="text"]',
      ]
      for (const sel of candidates) {
        const el = document.querySelector(sel)
        if (el) return el
      }
      return null
    })
    const el = inputHandle.asElement()
    if (!el) return { ok: false, why: 'no command-line input found in DOM' }
    // Focus + type + Enter.
    await el.click({ delay: 50 })
    await el.fill('')
    await el.type(name, { delay: 20 })
    await page.keyboard.press('Enter')
    return { ok: true, via: 'UI command-line type+enter', name }
  } catch (e) {
    return { ok: false, why: String(e?.message ?? e) }
  }
}

async function dumpInputs(page, label) {
  const inputs = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('input, textarea, [contenteditable]'))
    return els.slice(0, 8).map(el => ({
      tag: el.tagName,
      type: el.getAttribute('type'),
      placeholder: el.getAttribute('placeholder'),
      ariaLabel: el.getAttribute('aria-label'),
      classes: el.className,
      visible: !!(el.offsetWidth || el.offsetHeight),
    }))
  })
  console.log(`[driver] [${label}] inputs found:`, JSON.stringify(inputs, null, 2))
}

async function waitForChannel(page, label, timeoutMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ch = await page.evaluate(() => {
      try {
        const drone = window.ioc?.get('@diamondcoreprocessor.com/PairedChannelDrone')
        const channels = drone?.joinedChannels?.() ?? []
        return channels[0] ?? null
      } catch { return null }
    })
    if (ch) return ch
    await new Promise(r => setTimeout(r, 500))
  }
  return null
}

async function navigateTo(page, segments) {
  return page.evaluate((segs) => {
    const ioc = window.ioc
    const lineage = ioc?.get('@hypercomb.social/Lineage')
    if (!lineage) return { ok: false, why: 'no lineage' }
    try {
      if (typeof lineage.showDomainRoot === 'function') lineage.showDomainRoot()
      for (const s of segs) {
        if (typeof lineage.explorerEnter === 'function') lineage.explorerEnter(s)
      }
      return { ok: true, segments: lineage.explorerSegments() }
    } catch (e) {
      return { ok: false, why: String(e) }
    }
  }, segments)
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  console.log('[driver] launching browsers …')
  const browser = await chromium.launch({ headless: !HEADED })

  console.log('[driver] opening A @', URL_A)
  const A = await pageWithLogs(browser, 'A', URL_A)
  console.log('[driver] opening B @', URL_B)
  const B = await pageWithLogs(browser, 'B', URL_B)

  // Wait for both to settle
  await sleep(2000)

  // Configure both
  console.log('[driver] configuring localStorage on both …')
  await configure(A.page)
  await configure(B.page)

  // Reload so drone heartbeat picks up the new credentials
  await A.page.reload({ waitUntil: 'domcontentloaded' })
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  await sleep(3000)

  // Wait for OPFS to be available on both before any nav / writes.
  console.log('[driver] waiting for OPFS root on both …')
  const opfsA = await ensureOpfsReady(A.page)
  const opfsB = await ensureOpfsReady(B.page)
  console.log('[driver] OPFS ready', { A: opfsA, B: opfsB })

  // With constructor-wired listeners, the drone should auto-join on
  // page boot — the Lineage 'change' event fires during initialisation
  // and triggers reEvaluateChannel. No manual heartbeat poke needed.
  await sleep(3000)
  console.log('[driver] checking channel state on both …')
  let chA = await waitForChannel(A.page, 'A', 10000)
  let chB = await waitForChannel(B.page, 'B', 10000)
  console.log('[driver] channels (constructor-wired auto-join)', { A: chA?.slice(0,12), B: chB?.slice(0,12) })

  // Probe state on both
  const stateA = await probeState(A.page)
  const stateB = await probeState(B.page)
  console.log('[driver] state A:', JSON.stringify(stateA, null, 2))
  console.log('[driver] state B:', JSON.stringify(stateB, null, 2))

  // Same channel?
  if (stateA.channelId && stateB.channelId) {
    console.log('[driver] channel match?', stateA.channelId === stateB.channelId, '|', stateA.channelId?.slice(0,12), 'vs', stateB.channelId?.slice(0,12))
  }
  // Different pubkeys?
  if (stateA.pubkey && stateB.pubkey) {
    console.log('[driver] pubkeys distinct?', stateA.pubkey !== stateB.pubkey)
  }

  // Show what inputs we can see on both pages.
  await dumpInputs(A.page, 'A')
  await dumpInputs(B.page, 'B')

  // ── A → B direction ───────────────────────────────────────────────
  const tileAtoB = `a2b-${Date.now().toString(36)}`
  console.log(`[driver] (A→B) adding "${tileAtoB}" on A`)
  const addResult = await addTileAt(A.page, tileAtoB)
  console.log('[driver] (A→B) add result:', addResult)
  await sleep(4000)
  const installedOnB = await checkInstalled(B.page, tileAtoB)
  console.log(`[driver] (A→B) "${tileAtoB}" on B?`, installedOnB)

  // ── B → A direction ───────────────────────────────────────────────
  // This is the symmetric path — B is NOT the host, so this exercises
  // self-attest. If only A→B works, the receiver direction is
  // gated on host approval.
  const tileBtoA = `b2a-${Date.now().toString(36)}`
  console.log(`[driver] (B→A) adding "${tileBtoA}" on B`)
  const addResultB = await addTileAt(B.page, tileBtoA)
  console.log('[driver] (B→A) add result:', addResultB)
  await sleep(4000)
  const installedOnA = await checkInstalled(A.page, tileBtoA)
  console.log(`[driver] (B→A) "${tileBtoA}" on A?`, installedOnA)

  const bothWorked = installedOnB.exists && installedOnA.exists
  console.log('[driver] === SUMMARY ===')
  console.log('[driver]   A → B:', installedOnB.exists ? 'OK' : 'FAILED')
  console.log('[driver]   B → A:', installedOnA.exists ? 'OK' : 'FAILED')

  if (HEADED) {
    console.log('[driver] --headed: holding open 30s for manual inspection')
    await sleep(30000)
  }

  await browser.close()
  process.exit(bothWorked ? 0 : 1)
}

async function checkInstalled(page, name) {
  return page.evaluate(async (n) => {
    try {
      const ioc = window.ioc
      const lineage = ioc?.get('@hypercomb.social/Lineage')
      const dir = await lineage?.explorerDir?.()
      if (!dir) return { exists: false, why: 'no dir' }
      try { await dir.getDirectoryHandle(n, { create: false }); return { exists: true } }
      catch { return { exists: false } }
    } catch (e) { return { exists: false, why: String(e) } }
  }, name)
}

main().catch(err => {
  console.error('[driver] crashed:', err)
  process.exit(2)
})
