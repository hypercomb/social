import WebSocket from 'ws'
import { BRIDGE_PORT } from '@hypercomb/sdk'
import type { BridgeRequest, BridgeResponse } from '@hypercomb/sdk'

const TIMEOUT = 10_000

let counter = 0
function nextId(): string {
  return `cli-${Date.now()}-${++counter}`
}

export function send(request: Omit<BridgeRequest, 'id'>): Promise<BridgeResponse> {
  return new Promise((resolve, reject) => {
    const id = nextId()
    const msg: BridgeRequest = { ...request, id }

    const ws = new WebSocket(`ws://localhost:${BRIDGE_PORT}`)
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error('bridge timeout'))
    }, TIMEOUT)

    ws.on('open', () => {
      ws.send(JSON.stringify(msg))
    })

    ws.on('message', (raw) => {
      clearTimeout(timer)
      try {
        const res = JSON.parse(String(raw)) as BridgeResponse
        resolve(res)
      } catch {
        reject(new Error('invalid response'))
      }
      ws.close()
    })

    ws.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`bridge connection failed: ${err.message}`))
    })
  })
}
