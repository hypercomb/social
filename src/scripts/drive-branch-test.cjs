// scripts/drive-branch-test.cjs
//
// Demonstrate moving a whole HIERARCHY from 4250 to 4260:
//
//   1. On A, build a tree under a tile "tree-root":
//        tree-root/
//          team/
//            alice
//            bob
//          notes
//
//   2. A is at root. The cell:added for "tree-root" fires expose,
//      which walks the WHOLE subtree (buildSubtreeLayers), publishes
//      a layer event for every layer in the tree, and one share-
//      request for the root. B's drone, also at root, receives all
//      layer events and buffers them in `machine.state.layers`.
//
//   3. Auto-share installs ONLY THE SURFACE on B: a facade for
//      "tree-root" with `facade: true`. None of the descendants
//      land yet — they're sealed but buffered.
//
//   4. B clicks adopt on the facade tile.
//      `materialiseFromSig` walks branchSig recursively from the
//      machine's layer buffer with maxDepth=Infinity. Every cached
//      layer becomes a real cell on B. Facade marker is cleared.
//
//   5. Result: B has the full hierarchy on disk.
//
// Usage: node scripts/drive-branch-test.cjs [--headed]

const { chromium } = require('playwright')

const URL_A = 'http://localhost:4250/'
const URL_B = 'http://localhost:4260/'
const ROOM = 'sync-test-room'
const SECRET = 'sync-test-secret'

const HEADED = process.argv.includes('--headed')

function tStamp() { return new Date().toISOString().slice(11, 23) }
function log(label, ...args) { console.log(`[${tStamp()}] [${label}]`, ...args) }

async function pageWithLogs(browser, label, url) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  page.on('console', (msg) => {
    const text = msg.text()
    if (text.includes('[sync]') || text.includes('[paired-channel]')) log(label, text)
  })
  page.on('pageerror', err => log(label, 'PAGE ERROR:', String(err)))
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  return { page, ctx }
}

async function configure(page) {
  await page.evaluate(({ room, secret }) => {
    localStorage.setItem('hc:room', room)
    localStorage.setItem('hc:secret', secret)
    localStorage.setItem('hypercomb.paired-channel.secret', secret)
    localStorage.setItem('hc:mesh-public', 'true')
    localStorage.setItem('hc:nostrmesh:network', '1')
  }, { room: ROOM, secret: SECRET })
}

/**
 * Build a tree DIRECTLY in OPFS (faster than driving the UI for every
 * cell). After this returns, the tree exists locally but no sync events
 * have been emitted yet. The next cell:added → expose path will walk
 * the tree and publish all its layers.
 */
async function buildTreeOnDisk(page, rootName) {
  return page.evaluate(async (root) => {
    const lineage = window.ioc?.get('@hypercomb.social/Lineage')
    const r = await lineage?.explorerDir?.()
    if (!r) return { ok: false, why: 'no root dir' }

    const write0000 = async (dir, props) => {
      const fh = await dir.getFileHandle('0000', { create: true })
      const w = await fh.createWritable()
      await w.write(JSON.stringify(props))
      await w.close()
    }

    const treeRoot = await r.getDirectoryHandle(root, { create: true })
    await write0000(treeRoot, { text: 'root tile', index: 0 })

    const team = await treeRoot.getDirectoryHandle('team', { create: true })
    await write0000(team, { text: 'the team', index: 0 })

    const alice = await team.getDirectoryHandle('alice', { create: true })
    await write0000(alice, { text: 'alice', index: 0 })

    const bob = await team.getDirectoryHandle('bob', { create: true })
    await write0000(bob, { text: 'bob', index: 1 })

    const notes = await treeRoot.getDirectoryHandle('notes', { create: true })
    await write0000(notes, { text: 'design notes', index: 1 })

    return { ok: true }
  }, rootName)
}

/**
 * Trigger expose on the tree-root via the canonical UI command-line.
 * The drone's cell:added listener AND expose.drone's tile:action
 * listener will both run. expose.drone walks the subtree, publishes
 * every layer + a share-request for the root.
 *
 * We type a unique tile name to ensure cell:added fires fresh —
 * typing the same name as the pre-built tile-root would create a
 * sibling vs replacing.
 */
async function typeIntoCommandLine(page, name) {
  const sel = 'hc-command-line input, app-command-line input, input[placeholder*="cell" i], input[type="text"]'
  const handle = await page.$(sel)
  if (!handle) throw new Error('command-line input not found')
  await handle.click({ delay: 50 })
  await handle.fill('')
  await handle.type(name, { delay: 20 })
  await page.keyboard.press('Enter')
}

async function fireExpose(page, label) {
  // Skip the UI dance — we just want expose to walk our pre-built
  // tile. The drone's cell:added → expose listener routes through
  // tile:action.
  return page.evaluate((n) => {
    const bus = window.__hypercombEffectBus
    if (!bus?.emit) return { ok: false }
    bus.emit('tile:action', { action: 'expose', label: n, q: 0, r: 0, index: 0 })
    return { ok: true }
  }, label)
}

async function adoptOnB(page, label) {
  // Production adopt via the canonical tile:action route. Goes
  // through tile-actions.drone → paired-channel:adopt-request →
  // expose.drone.#adoptEphemeral → materialiseFromSig (depth=∞).
  return page.evaluate((n) => {
    const bus = window.__hypercombEffectBus
    if (!bus?.emit) return { ok: false, why: 'no EffectBus' }
    bus.emit('tile:action', { action: 'adopt', label: n, q: 0, r: 0, index: 0 })
    return { ok: true, via: 'tile:action adopt → adopt-request' }
  }, label)
}

async function probeEphemeral(page, location) {
  return page.evaluate((loc) => {
    const drone = window.ioc?.get('@diamondcoreprocessor.com/PairedChannelDrone')
    if (!drone?.ephemeralSharesAt) return null
    return drone.ephemeralSharesAt(loc)
  }, location)
}

async function probeOpfsCellExists(page, name) {
  return page.evaluate(async (n) => {
    const lineage = window.ioc?.get('@hypercomb.social/Lineage')
    const dir = await lineage?.explorerDir?.()
    if (!dir) return false
    try { await dir.getDirectoryHandle(n, { create: false }); return true }
    catch { return false }
  }, name)
}

async function probeTree(page, root) {
  return page.evaluate(async (rootName) => {
    const lineage = window.ioc?.get('@hypercomb.social/Lineage')
    const r = await lineage?.explorerDir?.()
    if (!r) return null

    const walk = async (dir, name, depth) => {
      const out = { name, depth, children: [] }
      try {
        // Read 0000 for inspection (does this cell have facade markers?).
        try {
          const fh = await dir.getFileHandle('0000', { create: false })
          const f = await fh.getFile()
          const text = await f.text()
          const props = JSON.parse(text)
          out.facade = props.facade === true
          out.text = typeof props.text === 'string' ? props.text : undefined
          if (props.branchSig) out.branchSig = props.branchSig.slice(0, 8)
        } catch { /* no 0000 */ }
        for await (const [childName, handle] of dir.entries()) {
          if (handle.kind !== 'directory') continue
          if (childName.startsWith('__')) continue
          out.children.push(await walk(handle, childName, depth + 1))
        }
      } catch (e) { out.err = String(e) }
      return out
    }

    try {
      const dir = await r.getDirectoryHandle(rootName, { create: false })
      return await walk(dir, rootName, 0)
    } catch { return null }
  }, root)
}

function summariseTree(node, indent = '  ') {
  if (!node) return '(absent)'
  const facadeTag = node.facade ? ' [FACADE]' : ''
  const sigTag = node.branchSig ? ` sig=${node.branchSig}` : ''
  let s = `${indent}${node.name}${facadeTag}${sigTag}` + (node.text ? `  "${node.text}"` : '')
  for (const c of node.children) s += '\n' + summariseTree(c, indent + '  ')
  return s
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  log('driver', 'launching browsers')
  const browser = await chromium.launch({ headless: !HEADED })

  log('driver', 'open A and B')
  const A = await pageWithLogs(browser, 'A', URL_A)
  const B = await pageWithLogs(browser, 'B', URL_B)
  await sleep(2000)

  log('driver', 'configure credentials')
  await configure(A.page)
  await configure(B.page)
  await A.page.reload({ waitUntil: 'domcontentloaded' })
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  await sleep(4000)

  // Use a unique root name per run so retained relay events / OPFS
  // state from prior runs don't pollute this test.
  const ROOT = `branch-${Date.now().toString(36)}`

  log('driver', `building tree on A under "${ROOT}"`)
  const built = await buildTreeOnDisk(A.page, ROOT)
  log('driver', 'tree built:', built)
  await sleep(500)

  log('driver', `firing expose for ${ROOT} on A`)
  await fireExpose(A.page, ROOT)
  await sleep(4000)

  // ── Phase 1 verification: ephemeral preview, NO OPFS write ──
  log('driver', '--- B Phase 1: ephemeral preview ---')
  const ephAtRoot = await probeEphemeral(B.page, '/')
  log('driver', 'ephemeral shares at / on B:', JSON.stringify(ephAtRoot, null, 2))
  const opfsExistsBefore = await probeOpfsCellExists(B.page, ROOT)
  log('driver', `OPFS has ${ROOT} on B before adopt?`, opfsExistsBefore)
  const layerCount = await B.page.evaluate(() => {
    const drone = window.ioc?.get('@diamondcoreprocessor.com/PairedChannelDrone')
    const cid = drone?.joinedChannels?.()[0]
    if (!cid) return null
    return drone.stateOf(cid)?.state?.layers?.size ?? null
  })
  log('driver', `B has ${layerCount} layers buffered (for adopt)`)

  // ── Phase 2: adopt → real OPFS layers ──
  log('driver', `adopt ${ROOT} on B`)
  const adoptResult = await adoptOnB(B.page, ROOT)
  log('driver', 'adopt result:', adoptResult)
  await sleep(2500)

  log('driver', '--- B Phase 2: imported as real layers ---')
  const afterAdopt = await probeTree(B.page, ROOT)
  console.log(summariseTree(afterAdopt))
  const opfsExistsAfter = await probeOpfsCellExists(B.page, ROOT)
  log('driver', `OPFS has ${ROOT} on B after adopt?`, opfsExistsAfter)
  const ephAfter = await probeEphemeral(B.page, '/')
  log('driver', 'ephemeral shares at / after adopt:', JSON.stringify(ephAfter, null, 2))

  const expected = [ROOT, 'team', 'alice', 'bob', 'notes']
  const found = []
  const collect = (n) => { if (!n) return; found.push(n.name); for (const c of n.children) collect(c) }
  collect(afterAdopt)
  const allPresent = expected.every(name => found.includes(name))

  // Phase 1 checks
  const phase1Ephemeral = Array.isArray(ephAtRoot) && ephAtRoot.some(e => e.branchName === ROOT)
  const phase1NoOpfs = !opfsExistsBefore
  // Phase 2 checks
  const phase2RealOpfs = opfsExistsAfter
  const phase2EphemeralCleared = Array.isArray(ephAfter) && !ephAfter.some(e => e.branchName === ROOT)

  log('driver', '=== SUMMARY ===')
  log('driver', `  Phase 1 (ephemeral preview):`)
  log('driver', `    ephemeral entry recorded?    ${phase1Ephemeral ? 'YES' : 'NO'}`)
  log('driver', `    OPFS untouched on B?         ${phase1NoOpfs ? 'YES' : 'NO (already on disk!)'}`)
  log('driver', `  Phase 2 (import → real layers):`)
  log('driver', `    OPFS has ${ROOT} after adopt? ${phase2RealOpfs ? 'YES' : 'NO'}`)
  log('driver', `    full hierarchy installed?    ${allPresent ? 'YES' : 'NO'}`)
  log('driver', `    ephemeral entry cleared?     ${phase2EphemeralCleared ? 'YES' : 'NO'}`)
  log('driver', `    found on B:                  ${found.join(', ') || '(none)'}`)
  const overall = phase1Ephemeral && phase1NoOpfs && phase2RealOpfs && allPresent && phase2EphemeralCleared

  if (HEADED) {
    log('driver', 'holding open 30s for inspection')
    await sleep(30000)
  }
  await browser.close()
  process.exit(overall ? 0 : 1)
}

main().catch(err => { console.error('[driver] crashed:', err); process.exit(2) })
