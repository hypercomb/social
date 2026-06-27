#!/usr/bin/env node
// Build the "AI Inside" hive: root → ai-inside → [company] → {strategy,
// differentiation, roadmap, rationale, references}. Two phases:
//   1) structure  — `add` ai-inside at root (non-destructive), then `update`
//      each parent's children list.
//   2) notes       — overview note on each company tile + one rich note per
//      sub-tile, via `note-add`.
//
// Persistent WebSocket to the broker (ws://localhost:2401); requests are sent
// sequentially (await each response) so layer commits stay ordered.
//
// Usage:
//   node scripts/ai-inside/build-ai-inside.cjs              # full build
//   node scripts/ai-inside/build-ai-inside.cjs --structure  # phase 1 only
//   node scripts/ai-inside/build-ai-inside.cjs --notes      # phase 2 only

const fs = require('fs')
const path = require('path')
const WebSocket = require('ws')

const BRIDGE = 'ws://localhost:2401'
const ROOT = 'ai-inside'
const SECTIONS = ['strategy', 'differentiation', 'roadmap', 'rationale', 'references']

const args = process.argv.slice(2)
const doStructure = args.includes('--structure') || !args.includes('--notes')
const doNotes = args.includes('--notes') || !args.includes('--structure')

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '_merged.json'), 'utf8'))

// ---- persistent bridge client -------------------------------------------
let ws
let counter = 0
const pending = new Map()

function connect() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(BRIDGE)
    ws.on('open', () => resolve())
    ws.on('error', e => reject(e))
    ws.on('message', raw => {
      let m; try { m = JSON.parse(String(raw)) } catch { return }
      const cb = pending.get(m.id)
      if (cb) { pending.delete(m.id); cb(m) }
    })
    ws.on('close', () => { for (const cb of pending.values()) cb({ ok: false, error: 'socket closed' }); pending.clear() })
  })
}

function rpc(req, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const id = `aii-${Date.now()}-${++counter}`
    const t = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: 'timeout' }) }, timeoutMs)
    pending.set(id, m => { clearTimeout(t); resolve(m) })
    ws.send(JSON.stringify({ ...req, id }))
  })
}

// send with a couple retries on transient failure
async function send(req, label) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await rpc(req)
    if (r.ok) return r
    if (attempt === 3) { console.log(`   FAIL ${label}: ${r.error}`); return r }
    await new Promise(s => setTimeout(s, 400 * attempt))
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ---- build ---------------------------------------------------------------
async function buildStructure() {
  console.log(`\n=== PHASE 1: structure (${data.length} companies) ===`)

  // 1a. ai-inside under root (delta add — never wipes existing root tiles)
  let r = await send({ op: 'add', segments: [], cells: [ROOT] }, 'add ai-inside')
  console.log(`[root] + ${ROOT}  ${r && r.ok ? 'ok' : 'FAIL'}`)

  // 1b. ai-inside children = all company slugs
  const slugs = data.map(c => c.slug)
  r = await send({ op: 'update', segments: [ROOT], layer: { name: ROOT, children: slugs } }, 'update ai-inside children')
  console.log(`[${ROOT}] children = ${slugs.length}  ${r && r.ok ? 'ok' : 'FAIL'}`)

  // 1c. each company → its 5 sub-tiles
  let ok = 0, fail = 0
  for (let i = 0; i < data.length; i++) {
    const c = data[i]
    r = await send({ op: 'update', segments: [ROOT, c.slug], layer: { name: c.slug, children: SECTIONS } }, `update ${c.slug}`)
    if (r && r.ok) ok++; else fail++
    process.stdout.write(`\r[company ${i + 1}/${data.length}] ${c.slug.padEnd(22)} (${ok} ok, ${fail} fail)   `)
  }
  console.log(`\n[structure] done: ${ok} companies ok, ${fail} fail`)
}

async function buildNotes() {
  console.log(`\n=== PHASE 2: notes ===`)

  // 2a. intro note on ai-inside itself
  const intro = 'AI Inside — a map of the companies building artificial intelligence. Each company opens into five deep-dives: its strategy, what sets it apart, its roadmap, the rationale behind its approach, and references. Built to actually understand WHY each player is doing it the way they are.'
  let r = await send({ op: 'note-add', segments: [], cell: ROOT, text: intro }, 'note ai-inside')
  console.log(`[${ROOT}] intro note  ${r && r.ok ? 'ok' : 'FAIL'}`)

  let ok = 0, fail = 0, total = data.length * (1 + SECTIONS.length)
  let n = 0
  for (const c of data) {
    // 2b. overview note on the company tile
    r = await send({ op: 'note-add', segments: [ROOT], cell: c.slug, text: `${c.name} — ${c.overview}` }, `overview ${c.slug}`)
    n++; if (r && r.ok) ok++; else fail++

    // 2c. one rich note per sub-tile
    for (const sec of SECTIONS) {
      const text = c[sec] || ''
      r = await send({ op: 'note-add', segments: [ROOT, c.slug], cell: sec, text }, `${c.slug}/${sec}`)
      n++; if (r && r.ok) ok++; else fail++
      process.stdout.write(`\r[note ${n}/${total}] ${(c.slug + '/' + sec).padEnd(34)} (${ok} ok, ${fail} fail)   `)
    }
  }
  console.log(`\n[notes] done: ${ok} ok, ${fail} fail`)
}

async function main() {
  await connect()
  // sanity: renderer present?
  const probe = await rpc({ op: 'list-at', segments: [] })
  if (!probe.ok) { console.error('No live renderer:', probe.error); process.exit(2) }
  console.log('Renderer live. Root children:', JSON.stringify(probe.data))

  const t0 = Date.now()
  if (doStructure) await buildStructure()
  if (doNotes) await buildNotes()
  console.log(`\nDONE in ${((Date.now() - t0) / 1000).toFixed(1)}s`)

  // quick verify
  const top = await rpc({ op: 'list-at', segments: [ROOT] })
  console.log(`Verify — ${ROOT} now has ${top.ok ? top.data.length : '?'} companies`)
  const sample = await rpc({ op: 'list-at', segments: [ROOT, 'openai'] })
  console.log(`Verify — openai sub-tiles: ${sample.ok ? JSON.stringify(sample.data) : sample.error}`)

  ws.close()
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
