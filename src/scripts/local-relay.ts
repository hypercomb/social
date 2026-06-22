// Minimal NIP-01 nostr relay for local development.
// Starts on port 7777, stores events in-memory, no persistence.
// Launched automatically by the dev server prestart script.

import { WebSocketServer, WebSocket } from 'ws'
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = 7777

// Persistent dev content store, HTTP-served alongside the WS mesh on the SAME
// port. A witnessing tab — or the installer, which fetches over HTTP and never
// joins the mesh — pulls layers/resources the author pushed via write-through.
// Kept OUT of public/content so `build:essentials` (which overwrites that dir)
// can't wipe pushed swarm content. Fills via dev-open PUTs; sha256 self-
// authenticates every write, so an open relay is still content-safe.
const CONTENT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.dev-relay-content')
const POOL_RE = /^\/(__layers__|__resources__|__bees__|__dependencies__)\/([a-f0-9]{64})(\.json|\.js)?$/i
// Canonical flat endpoint: `/<sig>` — extensionless, type-agnostic (§21.10),
// mirroring hypercomb-relay/relay.js. The dev relay used to be typed-only, so
// the client's flat PUT/GET 404'd and pushed content never landed here — the
// gap that stranded website resources (chrome.css) on the authoring machine.
const SIG_PATH_RE = /^\/([a-f0-9]{64})$/i

// Auto-expire window for ephemeral-range (20000-29999) events. Long
// enough that a receiver who reloads / joins shortly after a publisher
// shares can still see the bundle (share-approved + layer-received +
// resource-pull) and complete an adopt — short enough that test-session
// debris doesn't accumulate across hours of dev work. 5 minutes is a
// comfortable middle ground for the local dev relay; tighten in
// production hosting where the relay can be authoritatively cleared.
const EPHEMERAL_TTL_SECS = 300

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

// Per-pubkey blocklist. Dev-only — there's no authn on this relay, so
// any connected client can block any pubkey. The block has three
// effects: (a) drop every cached event from that pubkey immediately,
// (b) refuse to store new EVENT messages from that pubkey going
// forward, (c) skip events from that pubkey on REQ even if they
// somehow landed (defence-in-depth in case (b) regresses). Persists
// only for the lifetime of the relay process — restart wipes the
// blocklist along with the in-memory event store.
const blockedPubkeys = new Set<string>()

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

// Block-check that handles both full-key matches and short-prefix
// matches. HC_BLOCK stores either:
//   - the FULL 64-hex pubkey (for every pubkey that matched the
//     block call's prefix at the time of the call), AND
//   - the short prefix itself (when a prefix was passed) so future
//     EVENT messages from never-seen-before pubkeys matching the
//     prefix still get rejected.
// This function iterates the blocklist and prefix-matches.
function isBlocked(pubkey: string): boolean {
  if (blockedPubkeys.has(pubkey)) return true
  // Short-prefix entries: any blocklist entry whose length < 64 is
  // treated as a prefix. Match if this pubkey starts with it.
  for (const entry of blockedPubkeys) {
    if (entry.length < 64 && pubkey.startsWith(entry)) return true
  }
  return false
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

// Flat sig resolution (mirrors hypercomb-relay/relay.js resolveFlatSig): a bare
// `/<sig>` resolves to whichever pool holds it — flat heap first (canonical:
// CONTENT_DIR/<sig>, no extension), then the legacy typed pools as fallback.
// The pool supplies the Content-Type; the SW re-wraps bytes by guessed type on
// the page side, so octet-stream from the flat heap is fine. Returns
// { filePath, contentType } or null (→ 404).
async function resolveFlatSig(sig: string): Promise<{ filePath: string; contentType: string } | null> {
  const probes: Array<[string, string]> = [
    [join(CONTENT_DIR, sig), 'application/octet-stream'],
    [join(CONTENT_DIR, '__layers__', sig + '.json'), 'application/json; charset=utf-8'],
    [join(CONTENT_DIR, '__bees__', sig + '.js'), 'application/javascript; charset=utf-8'],
    [join(CONTENT_DIR, '__dependencies__', sig + '.js'), 'application/javascript; charset=utf-8'],
    [join(CONTENT_DIR, '__resources__', sig), 'application/octet-stream'],
  ]
  for (const [p, ct] of probes) {
    try { if ((await stat(p)).isFile()) return { filePath: p, contentType: ct } } catch { /* not in this pool */ }
  }
  return null
}

// HTTP content server (GET/PUT) + WS mesh share ONE port: the installer and
// witnessing tabs fetch bytes over HTTP, the mesh rides the same port as an
// upgrade. Without the HTTP half a witness gets the visuals but never the
// bytes — the "nothing renders" gap.
const httpServer = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, HEAD, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', '*')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  const path = (req.url || '').split('?')[0]
  // Health root — the DCP relay-panel probes GET / on an interval; answer 200
  // so it reads "up" instead of logging a 404 every tick.
  if (path === '/' || path === '/health') { res.writeHead(200); res.end('local-relay ok'); return }
  // Empty package manifest — the installer's default-baseline seed fetches
  // /manifest.json; the dev relay hosts no packages (the baseline ships
  // bundled in the DCP), so return an empty one (200) rather than 404.
  if (path === '/manifest.json') {
    res.setHeader('Content-Type', 'application/json')
    res.writeHead(200); res.end('{"packages":{}}'); return
  }

  // Flat sig endpoint — canonical `host/<sig>`. New writes land flat at
  // CONTENT_DIR/<sig>; reads probe the flat heap first, then typed pools.
  const flat = path.match(SIG_PATH_RE)
  if (flat) {
    const sig = flat[1].toLowerCase()
    if (req.method === 'GET' || req.method === 'HEAD') {
      const hit = await resolveFlatSig(sig)
      if (!hit) { res.writeHead(404); res.end('sig not held'); return }
      try {
        const bytes = await readFile(hit.filePath)
        res.setHeader('Content-Type', hit.contentType)
        res.setHeader('Cache-Control', 'immutable, max-age=31536000')
        res.writeHead(200)
        res.end(req.method === 'HEAD' ? undefined : bytes)
      } catch { res.writeHead(404); res.end('not found') }
      return
    }
    if (req.method === 'PUT') {
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      const body = Buffer.concat(chunks)
      const actual = createHash('sha256').update(body).digest('hex')
      if (actual !== sig) { res.writeHead(422); res.end('sig mismatch'); return }
      await mkdir(CONTENT_DIR, { recursive: true })
      await writeFile(join(CONTENT_DIR, sig), body)
      res.writeHead(201); res.end('stored ' + actual)
      return
    }
    res.writeHead(405); res.end('method not allowed'); return
  }

  const m = path.match(POOL_RE)
  if (!m) { res.writeHead(404); res.end('not found'); return }
  const filePath = join(CONTENT_DIR, m[1], m[2].toLowerCase() + (m[3] || ''))
  if (req.method === 'GET' || req.method === 'HEAD') {
    try {
      const bytes = await readFile(filePath)
      res.setHeader('Cache-Control', 'immutable, max-age=31536000')
      res.writeHead(200)
      res.end(req.method === 'HEAD' ? undefined : bytes)
    } catch {
      // Typed-shape MISS → probe the flat heap by sig: clients that PUT flat
      // (`/<sig>`) but ask typed (`/__resources__/<sig>`) still resolve.
      const hit = await resolveFlatSig(m[2].toLowerCase())
      if (hit) {
        try {
          const bytes = await readFile(hit.filePath)
          res.setHeader('Content-Type', hit.contentType)
          res.setHeader('Cache-Control', 'immutable, max-age=31536000')
          res.writeHead(200)
          res.end(req.method === 'HEAD' ? undefined : bytes)
          return
        } catch { /* fall through to 404 */ }
      }
      res.writeHead(404); res.end('not found')
    }
    return
  }
  if (req.method === 'PUT') {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const body = Buffer.concat(chunks)
    const actual = createHash('sha256').update(body).digest('hex')
    if (actual !== m[2].toLowerCase()) { res.writeHead(422); res.end('sig mismatch'); return }
    await mkdir(join(CONTENT_DIR, m[1]), { recursive: true })
    await writeFile(filePath, body)
    res.writeHead(201); res.end('stored ' + actual)
    return
  }
  res.writeHead(405); res.end('method not allowed')
})

const wss = new WebSocketServer({ noServer: true })
httpServer.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
})

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

      // Drop EVENTs from blocked pubkeys before storage / fanout. The
      // OK frame's accepted bit is false so the publisher sees the
      // rejection; the reason string mentions the policy so a future
      // UI could show it. Existing cached events from this pubkey
      // were already evicted at block time, so there's nothing to
      // unsubscribe — just don't accept the new one.
      if (event.pubkey && isBlocked(event.pubkey)) {
        send(ws, ['OK', event.id, false, `blocked: pubkey ${event.pubkey.slice(0,8)} is on this relay's blocklist`])
        return
      }

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
      } else if (event.kind >= 20000 && event.kind < 30000) {
        // NIP-01 says ephemeral range MUST NOT be stored. We deliberately
        // violate that for paired-channel (kind 29010) because the adopt
        // flow REQUIRES the share-approved + layer-received bundle to
        // arrive in the receiver's session BEFORE the user clicks adopt.
        // A purely-fan-out relay misses every receiver that joined after
        // the publisher's burst — adopt then has nothing to look up.
        //
        // Compromise: store but auto-expire fast (EPHEMERAL_TTL_SECS).
        // The periodic sweep below evicts entries older than that, so
        // past-session events don't pollute fresh subscribers, but
        // late joiners within the TTL window still get the bundle they
        // need to materialise the facade + adopt.
        //
        // We piggyback the sweep on the existing isExpired helper by
        // stamping a synthetic `expiration` tag on the event before
        // storage. Forging the tag is a relay-local concern (clients
        // never re-publish what they receive from us) so the stamp
        // doesn't leak.
        const stampedTags = (event.tags || []).slice()
        const hasExpiration = stampedTags.some(t => t[0] === 'expiration')
        if (!hasExpiration) {
          const expireAtSec = Math.floor(Date.now() / 1000) + EPHEMERAL_TTL_SECS
          stampedTags.push(['expiration', String(expireAtSec)])
        }
        const stampedEvent: NostrEvent = { ...event, tags: stampedTags }

        const existed = events.has(stampedEvent.id)
        events.set(stampedEvent.id, stampedEvent)
        send(ws, ['OK', stampedEvent.id, true, ''])

        if (!existed) {
          for (const [subId, subList] of subs) {
            for (const sub of subList) {
              if (sub.filters.some(f => matchesFilter(stampedEvent, f))) {
                send(sub.ws, ['EVENT', subId, stampedEvent])
              }
            }
          }
        }
        return
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
      // receive past-its-TTL data even between sweep ticks. Blocked
      // pubkeys are also skipped (defence-in-depth — the EVENT path
      // already refuses to store them, but if storage gets seeded
      // some other way the REQ pass catches it).
      let sent = 0
      const limit = filters.reduce((min, f) => Math.min(min, f.limit ?? Infinity), Infinity)
      const nowSecs = Math.floor(Date.now() / 1000)
      for (const event of events.values()) {
        if (isExpired(event, nowSecs)) continue
        if (event.pubkey && isBlocked(event.pubkey)) continue
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
    } else if (type === 'HC_BLOCK') {
      // Custom: add a pubkey to the blocklist. Drops every cached
      // event from that pubkey immediately so subscribers see the
      // change on their next render, and refuses future EVENT
      // messages from the pubkey (returns OK false with a reason
      // string). No auth — dev-only relay, loopback only.
      const pubkey = String(msg[1] ?? '').toLowerCase()
      if (!/^[0-9a-f]{64}$/.test(pubkey) && !/^[0-9a-f]{8,16}$/.test(pubkey)) {
        send(ws, ['NOTICE', `HC_BLOCK: invalid pubkey "${pubkey}"`])
        return
      }
      // Accept both full 64-hex and short prefixes (8-16 hex) because
      // the host-side UI only carries truncated forms in many code
      // paths. Match by prefix when shorter than 64.
      const matcher = pubkey.length === 64
        ? (pk: string) => pk === pubkey
        : (pk: string) => pk.startsWith(pubkey)
      // Find every matching FULL pubkey from the current event store
      // and add ALL of them to the block set, so a short-prefix block
      // catches every pubkey that prefix matches.
      const fullKeysHit = new Set<string>()
      for (const e of events.values()) {
        if (e.pubkey && matcher(e.pubkey)) fullKeysHit.add(e.pubkey)
      }
      for (const pk of fullKeysHit) blockedPubkeys.add(pk)
      // Also store the prefix itself so future EVENT from a pubkey
      // we've never seen before (but matching the prefix) still gets
      // rejected. The EVENT path needs a check that handles prefixes.
      if (pubkey.length < 64) blockedPubkeys.add(pubkey)
      // Wipe cached events.
      let removed = 0
      for (const [id, e] of events) {
        if (e.pubkey && matcher(e.pubkey)) { events.delete(id); removed++ }
      }
      send(ws, ['NOTICE', `HC_BLOCK: blocked ${fullKeysHit.size} full pubkey(s) matching "${pubkey}", wiped ${removed} event(s)`])
      console.log(`[local-relay] HC_BLOCK "${pubkey}" — full pubkeys: ${[...fullKeysHit].join(',') || '(none)'}, wiped ${removed} event(s)`)
    } else if (type === 'HC_UNBLOCK') {
      const pubkey = String(msg[1] ?? '').toLowerCase()
      let removed = 0
      // Remove every matching entry from the block set (handles both
      // full keys and the prefix entry that HC_BLOCK may have added).
      for (const pk of [...blockedPubkeys]) {
        if (pk === pubkey || pk.startsWith(pubkey) || (pubkey.length < 64 && pk.startsWith(pubkey))) {
          blockedPubkeys.delete(pk); removed++
        }
      }
      send(ws, ['NOTICE', `HC_UNBLOCK: removed ${removed} blocklist entr${removed === 1 ? 'y' : 'ies'} matching "${pubkey}"`])
      console.log(`[local-relay] HC_UNBLOCK "${pubkey}" — removed ${removed} entr${removed === 1 ? 'y' : 'ies'}`)
    } else if (type === 'HC_CLEAR') {
      // Custom: wipe every stored event. Dev-only convenience for the
      // host to nuke stale-session ghosts without restarting the relay
      // process. Not a Nostr standard — this relay is dev-only and the
      // ws is loopback, so there's no auth required.
      //
      // After clearing, broadcast a per-sig empty-children "EVENT" to
      // every subscriber so their swarm caches drop the previous bag
      // immediately instead of waiting for PEER_STALE_MS. We can't
      // forge signatures, so we send a kind-1 NOTICE-shaped marker and
      // let the client side handle it as a hint to clear local peer
      // caches. The receiving swarm code looks for kind 30200 events
      // with `content: { children: [] }` from each pubkey it has cached
      // — sending nothing here is fine, the periodic sweep will catch
      // it. We just nuke our storage.
      const before = events.size
      events.clear()
      send(ws, ['NOTICE', `HC_CLEAR: wiped ${before} event(s)`])
      // Notify ALL connected subscribers via OK frame so their UIs can
      // optionally repaint. Use the conventional NOTICE channel.
      for (const sub of subs.values()) {
        for (const s of sub) {
          if (s.ws !== ws && s.ws.readyState === WebSocket.OPEN) {
            send(s.ws, ['NOTICE', `HC_CLEAR: peer cleared the relay (${before} event(s) wiped)`])
          }
        }
      }
      console.log(`[local-relay] HC_CLEAR — wiped ${before} event(s)`)
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

httpServer.listen(PORT, () => {
  console.log(`[local-relay] listening on :${PORT} — ws:// (mesh) + http:// (content @ ${CONTENT_DIR})`)
})
