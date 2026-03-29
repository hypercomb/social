// Minimal NIP-01 nostr relay for local development.
// Starts on port 7777, stores events in-memory, no persistence.
// Launched automatically by the dev server prestart script.

import { WebSocketServer, WebSocket } from 'ws'

const PORT = 7777

type NostrEvent = {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

type Sub = { ws: WebSocket; filters: Filter[] }
type Filter = {
  ids?: string[]
  authors?: string[]
  kinds?: number[]
  since?: number
  until?: number
  limit?: number
  [tagFilter: `#${string}`]: string[] | undefined
}

const events = new Map<string, NostrEvent>()
const subs = new Map<string, Sub[]>()

function matchesFilter(e: NostrEvent, f: Filter): boolean {
  if (f.ids?.length && !f.ids.includes(e.id)) return false
  if (f.authors?.length && !f.authors.includes(e.pubkey)) return false
  if (f.kinds?.length && !f.kinds.includes(e.kind)) return false
  if (f.since && e.created_at < f.since) return false
  if (f.until && e.created_at > f.until) return false
  // generic single-letter tag filters (#e, #p, #x, #t, etc.)
  for (const [key, values] of Object.entries(f)) {
    if (!key.startsWith('#') || key.length !== 2 || !Array.isArray(values)) continue
    const tagName = key[1]
    const tagValues = e.tags.filter(t => t[0] === tagName).map(t => t[1])
    if (!values.some(v => tagValues.includes(v))) return false
  }
  return true
}

function send(ws: WebSocket, msg: unknown[]): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

const wss = new WebSocketServer({ port: PORT })

wss.on('connection', (ws) => {
  const clientSubs = new Set<string>()

  ws.on('message', (raw) => {
    let msg: unknown[]
    try {
      msg = JSON.parse(String(raw))
    } catch {
      return
    }
    if (!Array.isArray(msg) || msg.length < 2) return

    const type = msg[0]

    if (type === 'EVENT') {
      const event = msg[1] as NostrEvent
      if (!event?.id) return

      // No signature verification for local dev relay
      const existed = events.has(event.id)
      events.set(event.id, event)
      send(ws, ['OK', event.id, true, ''])

      if (!existed) {
        // Fan out to matching subscriptions
        for (const [subId, subList] of subs) {
          for (const sub of subList) {
            if (sub.filters.some(f => matchesFilter(event, f))) {
              send(sub.ws, ['EVENT', subId, event])
            }
          }
        }
      }
    } else if (type === 'REQ') {
      const subId = msg[1] as string
      const filters = msg.slice(2) as Filter[]
      if (!subId) return

      // Store subscription
      const entry: Sub = { ws, filters }
      if (!subs.has(subId)) subs.set(subId, [])
      subs.get(subId)!.push(entry)
      clientSubs.add(subId)

      // Send matching stored events
      let sent = 0
      const limit = filters.reduce((min, f) => Math.min(min, f.limit ?? Infinity), Infinity)
      for (const event of events.values()) {
        if (filters.some(f => matchesFilter(event, f))) {
          send(ws, ['EVENT', subId, event])
          sent++
          if (sent >= limit) break
        }
      }
      send(ws, ['EOSE', subId])
    } else if (type === 'CLOSE') {
      const subId = msg[1] as string
      if (!subId) return
      clientSubs.delete(subId)
      const list = subs.get(subId)
      if (list) {
        const filtered = list.filter(s => s.ws !== ws)
        if (filtered.length) subs.set(subId, filtered)
        else subs.delete(subId)
      }
    }
  })

  ws.on('close', () => {
    for (const subId of clientSubs) {
      const list = subs.get(subId)
      if (list) {
        const filtered = list.filter(s => s.ws !== ws)
        if (filtered.length) subs.set(subId, filtered)
        else subs.delete(subId)
      }
    }
  })
})

console.log(`[local-relay] nostr relay listening on ws://localhost:${PORT}`)
