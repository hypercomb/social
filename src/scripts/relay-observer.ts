// One-shot diagnostic: connect to local relay, subscribe widely for 15s,
// dump every kind-30200 event grouped by pubkey + last 8-char sig. Used
// to identify which browsers/profiles are actively heartbeating tiles
// onto the mesh without polluting the observed cache with our own
// publishes.
//
// Usage: npx tsx scripts/relay-observer.ts [seconds]

import { WebSocket } from 'ws'

const RELAY = 'ws://localhost:7777'
const DURATION_MS = (Number(process.argv[2]) || 15) * 1000

type LayerEvent = {
  kind: number
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
}

const byPubkey = new Map<string, {
  layerEvts: number
  freshestAgeSec: number
  tilesBySig: Map<string, string[]>
}>()

const start = Date.now()
const ws = new WebSocket(RELAY)

ws.on('open', () => {
  console.log(`[observer] connected to ${RELAY}, listening ${DURATION_MS / 1000}s`)
  // Subscribe widely — every kind 30200 (layer) and 30201 (resource).
  // No filter on d-tag so we catch all rooms / sigs.
  ws.send(JSON.stringify(['REQ', 'observer', { kinds: [30200] }]))
})

ws.on('message', (raw) => {
  try {
    const msg = JSON.parse(String(raw))
    if (!Array.isArray(msg)) return
    if (msg[0] === 'EVENT') {
      const evt = msg[2] as LayerEvent
      if (evt?.kind !== 30200) return
      const pk = (evt.pubkey ?? '').slice(0, 8)
      const dTag = (evt.tags ?? []).find(t => t[0] === 'd')?.[1]?.slice(0, 12) ?? '?'
      const ageSec = Math.floor(Date.now() / 1000) - evt.created_at
      let children: string[] = []
      try { children = (JSON.parse(evt.content ?? '{}').children ?? []).map((c: any) => c?.name).filter(Boolean) } catch {}
      const entry = byPubkey.get(pk) ?? { layerEvts: 0, freshestAgeSec: 999999, tilesBySig: new Map() }
      entry.layerEvts++
      entry.freshestAgeSec = Math.min(entry.freshestAgeSec, ageSec)
      entry.tilesBySig.set(dTag, children)
      byPubkey.set(pk, entry)
    } else if (msg[0] === 'EOSE') {
      console.log(`[observer] EOSE — initial cache delivered, now watching for live publishes`)
    }
  } catch { /* ignore parse fails */ }
})

ws.on('error', (e) => console.error('[observer] error:', e.message))

setTimeout(() => {
  console.log(`\n[observer] === DONE after ${(Date.now() - start) / 1000}s — pubkeys observed: ${byPubkey.size} ===\n`)
  const sorted = [...byPubkey.entries()].sort((a, b) => b[1].layerEvts - a[1].layerEvts)
  for (const [pk, info] of sorted) {
    console.log(`pubkey ${pk}  evts=${info.layerEvts}  freshest=${info.freshestAgeSec}s ago  sigs=${info.tilesBySig.size}`)
    for (const [sig, tiles] of info.tilesBySig) {
      console.log(`  sig ${sig}  tiles[${tiles.length}]: ${tiles.join(', ') || '(empty - soft leave)'}`)
    }
  }
  ws.close()
  process.exit(0)
}, DURATION_MS)
