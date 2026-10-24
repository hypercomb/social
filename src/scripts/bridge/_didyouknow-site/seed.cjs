// seed.cjs -- put the Did You Know how-to-play page's first draft into the hive.
//
//   node scripts/bridge/_didyouknow-site/seed.cjs --dry              reads only; prints what it would say
//   node scripts/bridge/_didyouknow-site/seed.cjs                    makes /didyouknow and files its notes
//   node scripts/bridge/_didyouknow-site/seed.cjs --replace [--dry]  the draft changed: takes the notes the draft no
//                                                                    longer matches off the tile (from the first
//                                                                    difference to the end), then files the draft's
//
// Then build the page from those notes and say it into the hive:
//
//   MSYS_NO_PATHCONV=1 node scripts/bridge/_hosting-site/generate.cjs --root /didyouknow --dry
//   MSYS_NO_PATHCONV=1 node scripts/bridge/_hosting-site/generate.cjs --root /didyouknow
//
// THE COPY LIVES IN THE HIVE once it is filed (documentation/hosting-pages.md:
// "The copy lives in the hive, not here"). notes.json beside this file is only
// the first draft the notes grew from. This script therefore never edits a
// note: it makes the tile when it is missing, files the draft's notes when the
// tile holds none, and files the rest when the tile holds a strict prefix of
// the draft. Anything else (a note changed, removed or added in the hive) means
// the hive has moved on, and it stops and says so, unless --replace says the
// draft is the newer truth: then the notes from the first difference to the end
// are unfiled (a list change: the note's bytes stay, history keeps the list it
// left, undo puts it back) and the draft's are filed in order. Notes only
// append, so the tail is what can be replaced. To change a page, change its
// note in the hive (unfile + file), then run generate.cjs.
//
// Every write is a sentence through scripts/bridge/say.cjs, the words a person
// types (`create`, `file on /route: text`, `go`); every check is a read. The
// hive's tab must be on the bridge (?claudeBridge=1). Nothing here opens one.
// The hive is returned to the page it stood on.

'use strict'
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const HERE = __dirname
const ROUTE = '/didyouknow'
const NAME = ROUTE.slice(1)
const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
const TOKEN = String(process.env.HYPERCOMB_BRIDGE_TOKEN || '').trim()
const SAY = path.resolve(HERE, '..', 'say.cjs')
const DRY = process.argv.includes('--dry')
const REPLACE = process.argv.includes('--replace')
const DRAFT = JSON.parse(fs.readFileSync(path.join(HERE, 'notes.json'), 'utf8'))[ROUTE]

class Refusal extends Error {}
const segmentsOf = (route) => route.split('/').filter(Boolean)
const routeOf = (segments) => '/' + segments.join('/')

// -- the bridge: reads only ------------------------------------------------

let socket = null
const pending = new Map()
let seq = 0
function connect() {
  if (socket) return socket
  const WebSocket = require(require.resolve('ws', { paths: [HERE, process.cwd()] }))
  socket = new Promise((resolve, reject) => {
    const ws = new WebSocket(BRIDGE, { maxPayload: 128 * 1024 * 1024, ...(TOKEN ? { headers: { Authorization: `Bearer ${TOKEN}` } } : {}) })
    ws.on('open', () => resolve(ws))
    ws.on('error', (e) => reject(new Error(`cannot reach the bridge at ${BRIDGE}: ${e.code || e.message || 'refused'} (start it with node scripts/bridge/run-bridge.cjs)`)))
    ws.on('close', () => { socket = null; for (const [, p] of pending) p.reject(new Error('the bridge closed')); pending.clear() })
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(String(raw)) } catch { return }
      const p = pending.get(m.id)
      if (p) { pending.delete(m.id); clearTimeout(p.timer); p.resolve(m) }
    })
  })
  return socket
}
async function call(request, timeoutMs = 60_000) {
  const ws = await connect()
  const id = `dyk-seed-${Date.now()}-${++seq}`
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`the bridge did not answer ${request.op}`)) }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    ws.send(JSON.stringify({ ...request, id }))
  })
}
async function read(request) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const answer = await call(request)
    if (answer.ok || !/no renderer connected/.test(String(answer.error))) return answer
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error('no renderer connected: open the hive with ?claudeBridge=1 (one tab)')
}
const noteText = (n) => typeof n === 'string' ? n : String(n?.text ?? '')

async function standing() {
  const r = await read({ op: 'ui-state' })
  if (!r.ok || !Array.isArray(r.data?.segments)) throw new Error(`ui-state: ${r.error}`)
  return r.data.segments.map(String)
}
async function tilesAt(route) {
  const r = await read({ op: 'list-at', segments: segmentsOf(route) })
  if (!r.ok || !Array.isArray(r.data)) throw new Error(`list-at ${route}: ${r.error}`)
  return r.data.map(String)
}
async function notesAt(route) {
  const r = await read({ op: 'note-list', segments: segmentsOf(route) })
  if (!r.ok || !Array.isArray(r.data)) throw new Error(`note-list ${route}: ${r.error}`)
  return r.data.map((n) => noteText(n).trim()).filter(Boolean)
}

// -- the hive's own words ---------------------------------------------------

function say(sentence) {
  const r = spawnSync(process.execPath, [SAY, sentence], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } })
  const out = `${r.stdout || ''}${r.stderr || ''}`.trimEnd()
  console.log(`  > say "${sentence.length > 90 ? sentence.slice(0, 87) + '...' : sentence}"`)
  for (const line of out.split('\n')) if (line.trim()) console.log(`    ${line.slice(0, 200)}`)
  if (r.status !== 0) throw new Error(`the hive did not take "${sentence.slice(0, 60)}" (say.cjs exit ${r.status}); nothing more is said`)
  return out
}

async function goTo(route) {
  const want = segmentsOf(route).join('/')
  if ((await standing()).join('/') === want) return
  say(`go ${route}`)
  const now = await standing()
  if (now.join('/') !== want) throw new Refusal(`said "go ${route}" but the hive stands on ${routeOf(now)}; nothing more is said`)
}

const folded = (text) => text.replace(/\s+/g, ' ').trim().toLowerCase()

/** How a note starts, with enough words that no other note on the tile starts
 *  the same way: `unfile` takes a note named by its beginning, and only when
 *  the words fit exactly one. */
function startOf(text, all) {
  const norm = text.replace(/\s+/g, ' ').trim()
  for (let n = Math.min(40, norm.length); n <= norm.length; n += 8) {
    const words = norm.slice(0, Math.min(n, norm.length))
    if (all.filter((other) => folded(other).startsWith(folded(words))).length === 1) return words
  }
  throw new Refusal(`two notes on ${ROUTE} are the same, so neither can be named by how it starts: "${norm.slice(0, 60)}"`)
}

async function waitFor(test, what) {
  for (let i = 0; i < 20; i++) {
    if (await test()) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Refusal(`the sentence ran but ${what}; nothing more is said`)
}

// -- the run ---------------------------------------------------------------

async function main() {
  if (!Array.isArray(DRAFT) || !DRAFT.length) throw new Refusal(`notes.json holds no notes for ${ROUTE}`)
  const stood = await standing()
  console.log(`the hive stands on ${routeOf(stood)}; it is returned there at the end`)

  const rootTiles = await tilesAt('/')
  const exists = rootTiles.some((t) => t.toLowerCase() === NAME)
  const held = exists ? await notesAt(ROUTE) : []

  // The tile continues the draft up to its first difference. Notes from there
  // to the end are the tail: the hive's own, which only --replace may take off.
  let keep = held.findIndex((t, i) => i >= DRAFT.length || t !== DRAFT[i].trim())
  if (keep < 0) keep = held.length
  const tail = held.slice(keep)
  if (tail.length && !REPLACE) {
    throw new Refusal(`${ROUTE} already holds notes that are not the draft (the first difference is note ${keep + 1}); the hive has moved on, so nothing is filed. If the draft is the newer truth, say --replace (add --dry to see what it would take off); otherwise change a page by changing its note in the hive (unfile + file), then run generate.cjs --root ${ROUTE}.`)
  }
  const todo = DRAFT.slice(keep).map((t) => t.trim())
  const takeOff = [...tail].reverse().map((t) => ({ text: t, words: startOf(t, held) }))

  console.log(`${ROUTE}: ${exists ? 'exists' : 'does not exist'}; holds ${held.length} notes, ${keep} of them the draft's own; ${takeOff.length} to unfile, ${todo.length} to file`)
  if (DRY) {
    if (!exists) console.log(`would say   go /   (if the hive does not stand there)\nwould say   create ${NAME}`)
    takeOff.forEach((n) => console.log(`would say   unfile on ${ROUTE}: ${n.words}`))
    todo.forEach((t, i) => console.log(`would say   file on ${ROUTE}: ${t.slice(0, 70)}${t.length > 70 ? '...' : ''}   (note ${keep + i + 1})`))
    console.log('\ndry: nothing was said')
    return 0
  }
  if (!todo.length && !takeOff.length && exists) { console.log('nothing to say: the tile holds the whole draft'); return 0 }

  let moved = false
  try {
    if (!exists) {
      moved = true
      await goTo('/')
      say(`create ${NAME}`)
      await waitFor(async () => (await tilesAt('/')).some((t) => t.toLowerCase() === NAME), `/${NAME} is not on the hive's top page`)
      console.log(`made   ${ROUTE}`)
    }
    for (const [i, n] of takeOff.entries()) {
      say(`unfile on ${ROUTE}: ${n.words}`)
      const want = held.length - i - 1
      await waitFor(async () => (await notesAt(ROUTE)).length <= want, `${ROUTE} still shows note ${want + 1}`)
    }
    for (const [i, text] of todo.entries()) {
      say(`file on ${ROUTE}: ${text}`)
      const want = keep + i + 1
      await waitFor(async () => (await notesAt(ROUTE)).length >= want, `${ROUTE} does not show note ${want}`)
    }
    const after = await notesAt(ROUTE)
    const same = after.length === DRAFT.length && after.every((t, i) => t === DRAFT[i].trim())
    console.log(`\n${ROUTE} now holds ${after.length} notes${same ? ', the whole draft, in order' : ', NOT identical to the draft: read them back before building'}`)
    if (!same) return 3
  } finally {
    if (moved) {
      try {
        say(`go ${routeOf(stood)}`)
        const now = await standing()
        console.log(now.join('/') === stood.join('/') ? `returned to ${routeOf(stood)}` : `MISS the hive stands on ${routeOf(now)}, not ${routeOf(stood)}`)
      } catch (e) { console.error(`MISS could not return the hive to ${routeOf(stood)}: ${e.message}`) }
    }
  }
  return 0
}

main().then((code) => { process.exitCode = code }, (e) => {
  console.error(e instanceof Refusal ? `REFUSED ${e.message}` : e.stack || e.message)
  process.exitCode = e instanceof Refusal ? 2 : 1
}).finally(() => { if (socket) socket.then((ws) => ws.close(), () => {}) })
