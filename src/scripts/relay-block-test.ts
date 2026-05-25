// One-shot: connect to local relay, count layer events from each
// pubkey before and after sending HC_BLOCK for 551e08db. Confirms
// the relay-side block works without needing the browser at all.

import { WebSocket } from 'ws'

const RELAY = 'ws://localhost:7777'

interface LayerEvent {
  kind: number
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
}

function countByPubkey(relay: string, durationMs: number): Promise<Record<string, number>> {
  return new Promise((resolve) => {
    const ws = new WebSocket(relay)
    const byPk: Record<string, number> = {}
    ws.on('open', () => {
      ws.send(JSON.stringify(['REQ', 'count', { kinds: [30200] }]))
    })
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw))
        if (!Array.isArray(msg)) return
        if (msg[0] === 'EVENT') {
          const evt = msg[2] as LayerEvent
          if (evt?.kind !== 30200) return
          const pk = (evt.pubkey ?? '').slice(0, 8)
          byPk[pk] = (byPk[pk] || 0) + 1
        }
      } catch {}
    })
    setTimeout(() => { ws.close(); resolve(byPk) }, durationMs)
  })
}

function sendBlock(pubkey: string): Promise<string> {
  return new Promise((resolve) => {
    const ws = new WebSocket(RELAY)
    ws.on('open', () => {
      ws.send(JSON.stringify(['HC_BLOCK', pubkey]))
    })
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw))
        if (Array.isArray(msg) && msg[0] === 'NOTICE') {
          ws.close()
          resolve(String(msg[1]))
        }
      } catch {}
    })
    setTimeout(() => { ws.close(); resolve('(timeout)') }, 5000)
  })
}

;(async () => {
  console.log('[block-test] === BEFORE BLOCK ===')
  const before = await countByPubkey(RELAY, 6000)
  for (const [pk, n] of Object.entries(before)) console.log(`  ${pk}: ${n} events`)
  console.log(`  total pubkeys: ${Object.keys(before).length}`)

  console.log('\n[block-test] sending HC_BLOCK 551e08db...')
  const notice = await sendBlock('551e08db')
  console.log(`  relay said: ${notice}`)

  console.log('\n[block-test] === AFTER BLOCK (waiting 35s to confirm rejected republish) ===')
  const after = await countByPubkey(RELAY, 35000)
  for (const [pk, n] of Object.entries(after)) console.log(`  ${pk}: ${n} events`)
  console.log(`  total pubkeys: ${Object.keys(after).length}`)

  const blocked551 = (after['551e08db'] ?? 0)
  if (blocked551 === 0) {
    console.log('\n[block-test] PASS — 551e08db no longer appears in REQ response')
  } else {
    console.log(`\n[block-test] FAIL — 551e08db still has ${blocked551} event(s) after block`)
  }
  process.exit(0)
})()
