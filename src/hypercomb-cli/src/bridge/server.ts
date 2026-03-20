import { WebSocketServer, WebSocket } from 'ws'
import { BRIDGE_PORT } from '@hypercomb/sdk'

export function runBridge(): void {
  const wss = new WebSocketServer({ port: BRIDGE_PORT })

  let renderer: WebSocket | null = null
  const pending = new Map<string, WebSocket>()

  wss.on('connection', (ws) => {
    let identified = false

    ws.on('message', (raw) => {
      let msg: any
      try {
        msg = JSON.parse(String(raw))
      } catch {
        return
      }

      // renderer identifies itself on connect
      if (msg.type === 'renderer') {
        renderer = ws
        identified = true
        console.log('[bridge] renderer connected')
        return
      }

      // CLI request — forward to renderer, track by id
      if (msg.id && !identified) {
        pending.set(msg.id, ws)
        if (renderer && renderer.readyState === WebSocket.OPEN) {
          renderer.send(JSON.stringify(msg))
        } else {
          ws.send(JSON.stringify({ id: msg.id, ok: false, error: 'no renderer connected' }))
          pending.delete(msg.id)
        }
        return
      }

      // response from renderer — route back to CLI client
      if (msg.id && identified) {
        const cli = pending.get(msg.id)
        if (cli && cli.readyState === WebSocket.OPEN) {
          cli.send(JSON.stringify(msg))
        }
        pending.delete(msg.id)
        return
      }
    })

    ws.on('close', () => {
      if (ws === renderer) {
        renderer = null
        console.log('[bridge] renderer disconnected')
      }
    })
  })

  console.log(`[bridge] listening on ws://localhost:${BRIDGE_PORT}`)
}
