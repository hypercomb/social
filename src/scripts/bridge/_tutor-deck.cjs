// Write a generated STUDY DECK onto a hive cell through the Claude Bridge.
//
//   node scripts/bridge/_tutor-deck.cjs <cell-path> <deck.json>
//
// Every study item becomes a FIRST-CLASS, content-addressed layer citizen —
// the same shape as notes:
//
//   1. put-resource  — mint EACH item as its own resource      -> itemSig[]
//   2. bag-set        — set the cell's `tutor` slot to the item-sig array
//   3. read-back      — verify the slot + a resource round-trip (never by eye)
//
// No decoration is written: ViewBee lights the study toggle straight from the
// non-empty `tutor` slot. The deck.json input is a StudyDeck bundle:
// { version, items: [ { id, prompt, answer, hint?, alternates?, tags?,
// sourceSegments?, sourceCell?, difficulty? }, ... ] }. Give each item a
// STABLE id (hash of prompt+answer) so participant-local progress survives
// regeneration.
//
// RAW-signing footgun: <cell-path> is signed RAW (no normalizeCell). Pass a
// path from the enumerator (already normalized) — never reconstruct one from
// a human label. Run from the monorepo root so `ws` resolves.

const fs = require('fs')
const WebSocket = require('ws')
const BRIDGE = 'ws://localhost:2401'
const SIG_RE = /^[0-9a-f]{64}$/

let counter = 0
const nextId = () => `tutor-${Date.now()}-${++counter}`

function send(req) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BRIDGE)
    const t = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, 15_000)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id: nextId() })))
    ws.on('message', raw => {
      clearTimeout(t)
      try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) }
      ws.close()
    })
    ws.on('error', e => { clearTimeout(t); reject(e) })
  })
}

async function withRenderer(req, attempts = 4) {
  let last
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await send(req)
      if (r.ok || r.error !== 'no renderer connected') return r
      last = r
    } catch (e) { last = { ok: false, error: e.message }; if (i === attempts - 1) throw e }
    await new Promise(r => setTimeout(r, 1500))
  }
  return last || { ok: false, error: 'renderer never connected' }
}

const parseSegments = arg => String(arg ?? '').split(/[\\/]/).map(s => s.trim()).filter(Boolean)

async function main() {
  const [cellPath, deckFile] = process.argv.slice(2)
  if (!cellPath || !deckFile) {
    console.error('Usage: node scripts/bridge/_tutor-deck.cjs <cell-path> <deck.json>')
    process.exit(1)
  }
  const segments = parseSegments(cellPath)

  let deck
  try { deck = JSON.parse(fs.readFileSync(deckFile, 'utf8')) }
  catch (e) { console.error('cannot read/parse deck file:', e.message); process.exit(1) }
  if (!deck || !Array.isArray(deck.items) || deck.items.length === 0) {
    console.error('deck must be { version, items: [...] } with at least one item'); process.exit(1)
  }

  // 1. Mint each item as its own content-addressed resource.
  const itemSigs = []
  for (const item of deck.items) {
    if (!item || typeof item.prompt !== 'string' || typeof item.answer !== 'string') {
      console.error('each item needs at least { prompt, answer }; got:', JSON.stringify(item)); process.exit(1)
    }
    const put = await withRenderer({ op: 'put-resource', text: JSON.stringify(item) })
    if (!put.ok || !SIG_RE.test(put.data?.sig || '')) { console.error('put-resource failed:', put.error); process.exit(1) }
    itemSigs.push(put.data.sig)
  }
  console.log(`[tutor-deck] minted ${itemSigs.length} item resource(s)`)

  // 2. Set the `tutor` slot to the item-sig array (preserves sibling slots).
  const bag = await withRenderer({ op: 'bag-set', segments, slot: 'tutor', cells: itemSigs })
  if (!bag.ok) { console.error('bag-set (tutor slot) failed:', bag.error); process.exit(1) }
  console.log(`[tutor-deck] tutor slot set on /${segments.join('/')} (${itemSigs.length} items)`)

  // 3. Verify by read-back.
  const la = await withRenderer({ op: 'layer-at', segments })
  const slot = Array.isArray(la.data?.tutor) ? la.data.tutor : []
  const allPresent = itemSigs.every(s => slot.includes(s))
  const back = await withRenderer({ op: 'get-resource', sig: itemSigs[0] })
  let firstPrompt = null
  try { firstPrompt = JSON.parse(back.data.text).prompt } catch {}
  console.log(`[tutor-deck] verify: tutor-slot=${allPresent ? 'ok' : 'MISSING'} first-item-prompt=${JSON.stringify(firstPrompt)}`)
  if (!allPresent) { console.error('read-back failed: not all item sigs are in the tutor slot'); process.exit(1) }
  console.log(`[tutor-deck] done. Toggle /tutor (or the study toggle) on /${segments.join('/')} to play.`)
}

main().catch(err => { console.error(err); process.exit(1) })
