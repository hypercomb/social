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

// NIP-40 — events carrying an `expiration` tag past the current unix
// time MUST NOT be delivered to subscribers. Returning true here means
// the event is dead-on-arrival from the subscriber's perspective and
// the relay should treat it as if it never existed for REQ purposes.
// A periodic sweep below also evicts expired entries from the storage
// map so memory doesn't grow unboundedly with one-shot publishes.
function isExpired(e: NostrEvent, nowSecs: number): boolean {
  const tag = (e.tags || []).find(t => t[0] === 'expiration')
  if (!tag) return false
  const exp = Number(tag[1])
  if (!Number.isFinite(exp)) return false
  return exp <= nowSecs
}

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

      // NIP-01 / NIP-33 replaceability — without this the dev relay
      // accumulates one stored event per publish, so a peer that
      // republishes its layer ten times leaves ten ghost copies that
      // late subscribers all see. Real public relays enforce these
      // ranges by spec; the local one was the outlier.
      //
      //   30000–39999  parameterized replaceable: one event per
      //                (pubkey, kind, d-tag). New publish overwrites
      //                the prior event with the matching triple.
      //   10000–19999  plain replaceable: one event per (pubkey, kind).
      //   20000–29999  ephemeral: never stored, fan-out only (the
      //                outer flow still stores them — keep current
      //                behaviour for now since paired-channel relies
      //                on the cache for late delivery).
      if (event.kind >= 30000 && event.kind < 40000) {
        const dTag = (event.tags || []).find(t => t[0] === 'd')?.[1] ?? ''
        for (const [id, stored] of events) {
          if (stored.kind !== event.kind) continue
          if (stored.pubkey !== event.pubkey) continue
          const storedD = (stored.tags || []).find(t => t[0] === 'd')?.[1] ?? ''
          if (storedD !== dTag) continue
          events.delete(id)
        }
      } else if (event.kind >= 10000 && event.kind < 20000) {
        for (const [id, stored] of events) {
          if (stored.kind !== event.kind) continue
          if (stored.pubkey !== event.pubkey) continue
          events.delete(id)
        }
      }

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

      // Send matching stored events. Expired events (NIP-40) are
      // skipped — same effect as if they'd already been swept from
      // storage, just with finer-grained timing so subscribers never
      // receive past-its-TTL data even between sweep ticks.
      let sent = 0
      const limit = filters.reduce((min, f) => Math.min(min, f.limit ?? Infinity), Infinity)
      const nowSecs = Math.floor(Date.now() / 1000)
      for (const event of events.values()) {
        if (isExpired(event, nowSecs)) continue
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

// Periodic NIP-40 sweep — evict expired events from storage so memory
// stays bounded as one-shot publishes accumulate. REQ delivery already
// guards against expired events; this just reclaims the slots.
setInterval(() => {
  const nowSecs = Math.floor(Date.now() / 1000)
  let removed = 0
  for (const [id, event] of events) {
    if (isExpired(event, nowSecs)) {
      events.delete(id)
      removed++
    }
  }
  if (removed > 0) console.log(`[local-relay] swept ${removed} expired event(s)`)
}, 30_000)

console.log(`[local-relay] nostr relay listening on ws://localhost:${PORT}`)
