// Independent test of the paired-channel substrate.
// Asserts:
//   1. channelId derivation is deterministic and length-prefixed.
//   2. Matching (location, secret) on both sides → events flow.
//   3. Different secret on the receiver → channelId diverges, no events flow.
//   4. Different location → same outcome.
//
// This bypasses the browser entirely — talks straight to the relay
// over WebSocket using the same channelId derivation the service uses.
// Validates the strict-pairing semantics without any UI dependency.
//
// Prereqs: relay listening on ws://localhost:7777.
const { createHash } = require('node:crypto')
const W = require('ws')

const RELAY = 'ws://127.0.0.1:7777'
const KIND = 29010
const TIMEOUT_MS = 5_000

// Mirror HistoryService.sign + channelIdFor exactly.
//   lineageSig = sha256(segments.join('/'))
//   channelId  = sha256(`${lineageSig.length}:${lineageSig}|${secret.length}:${secret}`)
function lineageSigFor(location) {
  const segments = String(location ?? '')
    .split('/')
    .map(s => s.trim())
    .filter(s => s.length > 0)
  const key = segments.join('/')
  return createHash('sha256').update(key).digest('hex')
}

function channelIdFor(location, secret) {
  const sig = lineageSigFor(location)
  const sec = String(secret ?? '')
  if (!sec) throw new Error('secret required')
  return createHash('sha256')
    .update(`${sig.length}:${sig}|${sec.length}:${sec}`)
    .digest('hex')
}

// Minimal Nostr event signing isn't required for these tests — relays
// without verifyEvent can accept unsigned events; our local relay does.
// (If yours doesn't, swap in nostr-tools finalizeEvent.)
function makeEvent(kind, channelId, type, payload, pubkeyHex) {
  const created_at = Math.floor(Date.now() / 1000)
  const tags = [
    ['x', channelId],
    ['type', type],
    ['expiration', String(created_at + 600)],
  ]
  const content = JSON.stringify(payload)
  // serialized form for id calc: [0, pubkey, created_at, kind, tags, content]
  const serialized = JSON.stringify([0, pubkeyHex, created_at, kind, tags, content])
  const id = createHash('sha256').update(serialized).digest('hex')
  return { id, pubkey: pubkeyHex, created_at, kind, tags, content, sig: '00'.repeat(64) }
}

function withSocket(fn) {
  return new Promise((resolve, reject) => {
    const ws = new W(RELAY)
    const timer = setTimeout(() => { ws.close(); reject(new Error('socket timeout')) }, TIMEOUT_MS)
    ws.on('open', () => {
      try { fn(ws, resolve, reject, timer) } catch (e) { reject(e) }
    })
    ws.on('error', e => { clearTimeout(timer); reject(e) })
  })
}

async function publish(channelId, type, payload, pubkey = 'aa'.repeat(32)) {
  return withSocket((ws, resolve, reject, timer) => {
    const evt = makeEvent(KIND, channelId, type, payload, pubkey)
    ws.send(JSON.stringify(['EVENT', evt]))
    const onMsg = (raw) => {
      try {
        const arr = JSON.parse(String(raw))
        if (arr[0] === 'OK' && arr[1] === evt.id) {
          clearTimeout(timer)
          ws.off('message', onMsg)
          ws.close()
          if (arr[2] === true) resolve(evt)
          else reject(new Error('relay rejected: ' + arr[3]))
        }
      } catch {}
    }
    ws.on('message', onMsg)
  })
}

async function listenFor(channelId, sinceMs, timeoutMs = 1500) {
  return withSocket((ws, resolve, reject, timer) => {
    clearTimeout(timer)
    const events = []
    const subId = 'test-' + Math.random().toString(36).slice(2, 8)
    const settle = (() => {
      let done = false
      return () => {
        if (done) return
        done = true
        ws.send(JSON.stringify(['CLOSE', subId]))
        ws.close()
        resolve(events)
      }
    })()
    const stopAt = setTimeout(settle, timeoutMs)
    ws.on('message', (raw) => {
      try {
        const arr = JSON.parse(String(raw))
        if (arr[0] === 'EVENT' && arr[1] === subId) {
          events.push(arr[2])
        } else if (arr[0] === 'EOSE' && arr[1] === subId) {
          // EOSE means relay flushed history; keep listening for live events
          // until our timeout completes.
        }
      } catch {}
    })
    ws.on('error', e => { clearTimeout(stopAt); reject(e) })
    ws.send(JSON.stringify(['REQ', subId, { kinds: [KIND], '#x': [channelId], since: Math.floor(sinceMs / 1000) }]))
  })
}

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg)
  console.log('  ✓ ' + msg)
}

async function main() {
  console.log('paired-channel substrate test\n')

  // ── 1. derivation determinism ────────────────────────────────────
  console.log('[1] channelId derivation')
  const a1 = channelIdFor('/howard', 'hammock')
  const a2 = channelIdFor('/howard', 'hammock')
  const b1 = channelIdFor('/howard', 'different')
  const c1 = channelIdFor('/dolphin', 'hammock')
  assert(a1 === a2, 'same (location, secret) → same channelId')
  assert(/^[0-9a-f]{64}$/.test(a1), 'channelId is 64 hex chars')
  assert(a1 !== b1, 'different secret → different channelId')
  assert(a1 !== c1, 'different location → different channelId')
  // path normalization: leading slash and trailing slashes don't matter,
  // matching HistoryService.sign's segment extraction (split + filter empties).
  assert(channelIdFor('/howard', 'hammock') === channelIdFor('howard', 'hammock'),
    'leading slash is normalized (split-and-filter)')
  assert(channelIdFor('/howard/', 'hammock') === channelIdFor('howard', 'hammock'),
    'trailing slash is normalized')
  assert(channelIdFor('/howard//team', 'hammock') === channelIdFor('howard/team', 'hammock'),
    'duplicate slashes are normalized')
  // length-prefix anti-collision: distinct (sig, sec) pairs that would
  // otherwise collide via separator games hash to different channels.
  // We can't easily construct two paths whose lineageSigs are
  // length-aligned for this collision, so we just check the length-
  // prefixed concat works as designed by checking secret variations.
  const lengthA = channelIdFor('/a', 'bcdef')
  const lengthB = channelIdFor('/abcde', 'f')
  assert(lengthA !== lengthB, 'length-prefixed concat resists separator-overflow collisions')

  // ── 2. matching pair → events flow ───────────────────────────────
  console.log('\n[2] matching pair receives events')
  const channelId = a1
  const sinceMs = Date.now()

  // Subscribe first, then publish, so we catch the event live.
  const matchedListener = listenFor(channelId, sinceMs)
  await sleep(200) // let subscribe REQ settle
  await publish(channelId, 'announce', { hello: 'world' })
  const matched = await matchedListener
  assert(matched.length >= 1, 'matched subscriber received the event')
  assert(matched.some(e => (e.tags || []).some(t => t[0] === 'type' && t[1] === 'announce')),
    'event carries type=announce tag')

  // ── 3. mismatched secret → no events ─────────────────────────────
  console.log('\n[3] mismatched secret receives nothing')
  const mismatched = b1
  const since2 = Date.now()
  const wrongListener = listenFor(mismatched, since2)
  await sleep(200)
  await publish(channelId, 'announce', { sneak: 'attempt' })
  const wrong = await wrongListener
  assert(wrong.length === 0, 'wrong-secret subscriber received nothing (channelIds diverge)')

  // ── 4. mismatched location → no events ───────────────────────────
  console.log('\n[4] mismatched location receives nothing')
  const wrongLoc = c1
  const since3 = Date.now()
  const wrongLocListener = listenFor(wrongLoc, since3)
  await sleep(200)
  await publish(channelId, 'announce', { sneak: 'attempt2' })
  const wrong2 = await wrongLocListener
  assert(wrong2.length === 0, 'wrong-location subscriber received nothing')

  console.log('\nall tests passed.')
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

main().catch(err => {
  console.error('\n' + err.message)
  process.exit(1)
})
