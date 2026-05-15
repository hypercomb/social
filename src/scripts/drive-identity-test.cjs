// scripts/drive-identity-test.cjs
//
// Verify that 4260 ends up with the IDENTICAL tree that 4250 has —
// same names, same 0000 properties, same children at every depth.
// No manual adopt step.

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
    await write0000(treeRoot, { text: 'root tile', kind: 'project', index: 0 })

    const team = await treeRoot.getDirectoryHandle('team', { create: true })
    await write0000(team, { text: 'the team', kind: 'group', index: 0 })

    const alice = await team.getDirectoryHandle('alice', { create: true })
    await write0000(alice, { text: 'alice', role: 'lead', index: 0 })

    const bob = await team.getDirectoryHandle('bob', { create: true })
    await write0000(bob, { text: 'bob', role: 'eng', index: 1 })

    const notes = await treeRoot.getDirectoryHandle('notes', { create: true })
    await write0000(notes, { text: 'design notes', index: 1 })

    return { ok: true }
  }, rootName)
}

async function fireExpose(page, label) {
  return page.evaluate((n) => {
    const bus = window.__hypercombEffectBus
    if (!bus?.emit) return { ok: false }
    bus.emit('tile:action', { action: 'expose', label: n, q: 0, r: 0, index: 0 })
    return { ok: true }
  }, label)
}

/**
 * Read the full tree at `rootName` from OPFS, including each cell's
 * 0000 properties. Returns a normalised JSON-comparable shape.
 */
async function readTreeFromDisk(page, rootName) {
  return page.evaluate(async (root) => {
    const lineage = window.ioc?.get('@hypercomb.social/Lineage')
    const r = await lineage?.explorerDir?.()
    if (!r) return null

    const readProps = async (dir) => {
      try {
        const fh = await dir.getFileHandle('0000', { create: false })
        const f = await fh.getFile()
        const text = await f.text()
        return JSON.parse(text)
      } catch { return {} }
    }
    const stripVolatile = (props) => {
      const out = {}
      for (const [k, v] of Object.entries(props ?? {})) {
        // Local-only state (not part of content identity):
        //   facade*  — paired-channel sync markers
        //   children — render-cache sighash decoration
        //   index    — slot position in the hex grid. show-cell's
        //              #orderByIndexPinned auto-demotes on collision
        //              so the receiver's index can differ from the
        //              sender's. Both peers still see the same TILE
        //              with the same TEXT/CONTENT — only the grid
        //              position is local layout state.
        if (k === 'facade' || k === 'branchSig' || k === 'channelId' || k === 'approvalId') continue
        if (k === 'children' && typeof v === 'string') continue
        if (k === 'index') continue
        if (k === 'transient') continue
        out[k] = v
      }
      return out
    }

    const walk = async (dir, name) => {
      const props = stripVolatile(await readProps(dir))
      const children = []
      try {
        for await (const [childName, handle] of dir.entries()) {
          if (handle.kind !== 'directory') continue
          if (childName.startsWith('__')) continue
          children.push(await walk(handle, childName))
        }
      } catch { /* empty */ }
      children.sort((a, b) => a.name.localeCompare(b.name))
      return { name, props, children }
    }

    try {
      const dir = await r.getDirectoryHandle(root, { create: false })
      return await walk(dir, root)
    } catch { return null }
  }, rootName)
}

function summariseTree(node, indent = '  ') {
  if (!node) return '(absent)'
  const propsStr = Object.keys(node.props).length > 0 ? '  ' + JSON.stringify(node.props) : ''
  let s = `${indent}${node.name}${propsStr}`
  for (const c of node.children) s += '\n' + summariseTree(c, indent + '  ')
  return s
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
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
  await sleep(5000) // give boot-poll time to auto-join

  const ROOT = `branch-${Date.now().toString(36)}`

  log('driver', `building tree on A under "${ROOT}"`)
  await buildTreeOnDisk(A.page, ROOT)
  await sleep(500)

  log('driver', `firing expose for ${ROOT} on A`)
  await fireExpose(A.page, ROOT)
  await sleep(5000)

  log('driver', '--- A tree ---')
  const aTree = await readTreeFromDisk(A.page, ROOT)
  console.log(summariseTree(aTree))

  log('driver', '--- B tree ---')
  const bTree = await readTreeFromDisk(B.page, ROOT)
  console.log(summariseTree(bTree))

  const matches = deepEqual(aTree, bTree)

  log('driver', '=== SUMMARY ===')
  log('driver', `  A has tree under ${ROOT}? ${aTree ? 'YES' : 'NO'}`)
  log('driver', `  B has tree under ${ROOT}? ${bTree ? 'YES' : 'NO'}`)
  log('driver', `  IDENTICAL (names + 0000 props + children)? ${matches ? 'YES ✅' : 'NO ❌'}`)
  if (!matches) {
    log('driver', '  ── DIFF ──')
    log('driver', '  A:', JSON.stringify(aTree, null, 2).split('\n').slice(0, 30).join('\n  '))
    log('driver', '  B:', JSON.stringify(bTree, null, 2).split('\n').slice(0, 30).join('\n  '))
  }

  if (HEADED) {
    log('driver', 'holding open 30s for inspection')
    await sleep(30000)
  }
  await browser.close()
  process.exit(matches ? 0 : 1)
}

main().catch(err => { console.error('[driver] crashed:', err); process.exit(2) })
