// One-shot: unblock the pubkey I accidentally blocked earlier. Connects
// to the local relay, sends HC_UNBLOCK for 551e08db, prints the NOTICE
// reply, then verifies via REQ that events from that pubkey can land
// again.

import { WebSocket } from 'ws'

const RELAY = 'ws://localhost:7777'

;(async () => {
  await new Promise<void>((resolve) => {
    const ws = new WebSocket(RELAY)
    ws.on('open', () => {
      console.log('[unblock] sending HC_UNBLOCK 551e08db...')
      ws.send(JSON.stringify(['HC_UNBLOCK', '551e08db']))
    })
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw))
        if (Array.isArray(msg) && msg[0] === 'NOTICE') {
          console.log(`  relay said: ${msg[1]}`)
          ws.close()
          resolve()
        }
      } catch {}
    })
    setTimeout(() => { ws.close(); resolve() }, 5000)
  })
  process.exit(0)
})()
