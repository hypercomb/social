// scripts/swarm-preflight.cjs — is the meeting point ready to host a meeting?
//
// WHERE A MEETING'S BYTES GO (documentation/swarm-host.md, 2026-10-07): each
// page's publish domains, else the participant's hosts pool — hypercomb.com on
// a fresh install — and, when neither can take them, the relay they meet at
// (wss://jwize.com means https://jwize.com/<sig>) if it was started with
// --allow-participants. So this checks both: the relay, and whether the pool's
// default host takes a fresh key's upload at all (WARN, not FAIL: a pool host
// that cannot is passed over for the relay). Run this an hour before a
// meeting, and after every relay restart or stamp. It is live and as light as a
// check can be: one throwaway key, one throwaway zone (beaconed, then left),
// one stored 16-byte atom. Every line is PASS / FAIL / SKIP; the exit code is
// non-zero when anything FAILs.
//
//   node scripts/swarm-preflight.cjs                         # wss://jwize.com + the hypercomb.com apex
//   node scripts/swarm-preflight.cjs --relay ws://localhost:7801 --no-apex
//
// Options:
//   --relay <ws(s) url>   the meeting point            (default wss://jwize.com)
//   --apex <origin>       the cold-install apex          (default https://hypercomb.com)
//   --no-apex             skip the package checks (a scratch relay has no package)
//   --known <sig>         a sig the swarm host must serve (default: the signed install:<channel> root)
//   --room / --secret     beacon in a real zone (for a relay that allows only listed zones)
//   --pool-host <zone>    the hosts pool's default host   (default hypercomb.com)
//   --no-pool-host        skip the pool-host checks
//
// Checks:
//   ws        the WebSocket upgrade answers 101
//   card      the first frame is the hc:host card; the relay's clock is near ours
//   policy    NIP-11 limitation.participant_uploads allows guests (and agrees with the card)
//   probe     the liveness probe (limit:0 REQ) answers EOSE at once
//   scan      a read that names no signature (kinds only, limit 1) is CLOSED restricted:, nothing replayed —
//             the relay's address gate; an open relay lists every room's events to anyone (FAIL)
//   unsigned  a PUT without NIP-98 is refused (401)
//   not-live  a signed PUT from a key the relay has not heard on its socket is refused (401 not-live)
//   beacon    a {alive} beacon on the throwaway zone is accepted
//   store     after the beacon, PUT /<sig> answers 2xx 'stored <sig>' — the receipt
//   serve     the stored atom is served back byte-for-byte (HEAD 200, GET equal)
//   reserved  a PUT at sign('hive:indexes') is refused (409)
//   no-store  a missing sig answers 404 with Cache-Control: no-store
//   known     HEAD on a known sig (the installed package root) answers 200
//   apex      the apex's sign('host:packages') head equals the signed install:<channel> root, and the apex serves it
//   pool-cors the pool host's CORS preflight allows a PUT carrying Authorization from a hive origin   (WARN)
//   pool-404  the pool host answers a missing sig with 404 — a heap, not a page where bytes should be (WARN)
//   pool-put  a signed PUT of one 16-byte atom answers 2xx 'stored <sig>' (or is served back)          (WARN)
'use strict'
const crypto = require('crypto')
const path = require('path')
const WebSocket = require('ws')
const { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } = require('nostr-tools/pure')

function arg(name, fallback = null) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback
}
const RELAY = arg('relay', 'wss://jwize.com')
const APEX = process.argv.includes('--no-apex') ? null : arg('apex', 'https://hypercomb.com').replace(/\/+$/, '')
const relayUrl = new URL(RELAY)
const HTTP = `${relayUrl.protocol === 'wss:' ? 'https:' : 'http:'}//${relayUrl.host}`
const ROOM = arg('room', 'preflight-' + crypto.randomBytes(4).toString('hex'))
const SECRET = arg('secret', crypto.randomBytes(6).toString('hex'))
const PUBLISHER = require(path.join(__dirname, '..', 'hypercomb-essentials', 'src', 'sharing', 'install-publisher.json'))

const SIG = /^[0-9a-f]{64}$/
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex')
const sign = (meaning) => sha256(Buffer.from(meaning, 'utf8'))
const now = () => Math.floor(Date.now() / 1000)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const results = []
const line = (verdict, id, text) => { results.push(verdict); console.log(`${verdict.padEnd(4)}  ${id.padEnd(8)} ${text}`) }
const pass = (id, text) => line('PASS', id, text)
const fail = (id, text) => line('FAIL', id, text)
const warn = (id, text) => line('WARN', id, text)
const POOL_HOST = process.argv.includes('--no-pool-host') ? null : String(arg('pool-host', 'hypercomb.com')).replace(/^https?:\/\//, '').replace(/\/+$/, '')
const POOL_HTTP = POOL_HOST ? `${/^(localhost|127\.)/.test(POOL_HOST) ? 'http' : 'https'}://${POOL_HOST}` : null
const skip = (id, text) => line('SKIP', id, text)

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const lifecycleSig = sign(`lifecycle\u0000${ROOM}\u0000${SECRET}`)

function nip98(url, method, body) {
  const tags = [['u', url], ['method', method]]
  if (body) tags.push(['payload', sha256(body)])
  const evt = finalizeEvent({ kind: 27235, created_at: now(), tags, content: '' }, sk)
  return 'Nostr ' + Buffer.from(JSON.stringify(evt)).toString('base64')
}
async function http(method, url, { body, headers = {}, timeoutMs = 10000 } = {}) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { method, body, headers, signal: ctl.signal, cache: 'no-store' })
    const bytes = method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await r.arrayBuffer())
    return { status: r.status, text: bytes.toString('utf8'), bytes, headers: r.headers }
  } catch (e) { return { status: 0, text: String(e?.cause?.code ?? e?.message ?? e), bytes: Buffer.alloc(0), headers: new Headers() } }
  finally { clearTimeout(t) }
}

/** One socket, with the first frame and a waiter. */
function openSocket() {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const inbox = []
    const waiters = []
    let upgrade = null
    const ws = new WebSocket(RELAY, { handshakeTimeout: 10000 })
    ws.on('upgrade', (res) => { upgrade = res.statusCode })
    ws.on('unexpected-response', (_req, res) => resolve({ ok: false, status: res.statusCode, ms: Date.now() - t0 }))
    ws.on('error', (e) => resolve({ ok: false, status: upgrade, err: e.message, ms: Date.now() - t0 }))
    ws.on('message', (d) => {
      let m; try { m = JSON.parse(String(d)) } catch { return }
      inbox.push({ at: Date.now(), m })
      for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m) }
    })
    ws.on('open', () => resolve({
      ok: true, status: upgrade ?? 101, ms: Date.now() - t0, ws, inbox, openedAt: Date.now(),
      send: (m) => ws.send(JSON.stringify(m)),
      wait: (pred, ms = 3000) => new Promise(res => {
        const hit = inbox.find(x => pred(x.m)); if (hit) return res(hit.m)
        const w = { pred, res }; waiters.push(w)
        setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); res(null) } }, ms)
      }),
    }))
  })
}

/** The publisher's signed index — the install:<channel> root it names. */
async function signedInstallRoot() {
  const pubkey = String(PUBLISHER.pubkey ?? '').toLowerCase()
  const channel = String(PUBLISHER.channel ?? 'essentials')
  const hosts = [...new Set(['pluginthematrix.com', ...(PUBLISHER.hosts ?? []), 'content.hypercomb.com'])]
  for (const host of hosts) {
    for (const url of [`https://${host}/hive/${pubkey}`, `https://${host}/${sign('hive:indexes')}/${pubkey}`]) {
      const r = await http('GET', url)
      if (r.status !== 200) continue
      let event
      try { event = JSON.parse(r.text) } catch { continue }
      if (event?.kind !== 30564 || event?.pubkey !== pubkey || !verifyEvent(event)) return { err: `${host} serves an index that is not ${pubkey.slice(0, 12)}…'s` }
      const root = String(JSON.parse(event.content)?.roots?.[`install:${channel}`] ?? '').toLowerCase()
      if (SIG.test(root)) return { root, host, channel, createdAt: event.created_at }
    }
  }
  return { err: `no host served a verified index naming install:${channel}` }
}

/** The apex's host:packages head: the max member's first line. */
async function apexHead() {
  const pool = sign('host:packages')
  let names = []
  for (const u of [`${APEX}/content/${pool}/listing.txt`, `${APEX}/content/${pool}/`]) {
    const r = await http('GET', u)
    if (r.status !== 200) continue
    names = r.text.split(/\r?\n/).map(s => s.trim()).filter(s => /^[0-9]{8}$/.test(s)).sort()
    if (names.length) break
  }
  if (!names.length) return { err: `${APEX}/content/<sign('host:packages')>/ lists no member` }
  const max = names[names.length - 1]
  const r = await http('GET', `${APEX}/content/${pool}/${max}`)
  const head = r.status === 200 ? r.text.split(/\r?\n/)[0].trim().toLowerCase() : ''
  return SIG.test(head) ? { head, max, members: names.length } : { err: `member ${max} answered ${r.status} without a sig` }
}

;(async () => {
  console.log(`swarm preflight — relay ${RELAY} (host ${HTTP})${APEX ? ` · apex ${APEX}` : ''} · throwaway key ${pk.slice(0, 8)}… · zone ${ROOM}\n`)

  // ws + card
  const sock = await openSocket()
  if (!sock.ok) { fail('ws', `the upgrade failed (${sock.status ?? 'no answer'}${sock.err ? ' · ' + sock.err : ''}) after ${sock.ms} ms`) }
  else pass('ws', `101 Switching Protocols in ${sock.ms} ms`)
  let card = null
  if (sock.ok) {
    const first = await sock.wait(() => true, 2000)
    try { if (first?.[0] === 'NOTICE' && String(first[1]).startsWith('hc:host ')) card = JSON.parse(String(first[1]).slice(8)) } catch { /* not a card */ }
    if (!card) fail('card', `first frame is not the hc:host card: ${first ? JSON.stringify(first).slice(0, 100) : 'nothing within 2 s'}`)
    else {
      const skew = card.time - Date.now() / 1000
      const ok = card.v === 1 && Math.abs(skew) <= 5
      ;(ok ? pass : fail)('card', `hc:host v${card.v} participants=${JSON.stringify(card.participants)} · relay clock ${skew >= 0 ? '+' : ''}${skew.toFixed(1)} s vs ours`)
    }
  }

  // policy (NIP-11)
  const info = await http('GET', HTTP + '/', { headers: { Accept: 'application/nostr+json' } })
  let policy
  try { policy = JSON.parse(info.text)?.limitation?.participant_uploads } catch { policy = undefined }
  if (policy === 'all' || policy === 'zones') {
    const agrees = !card || card.participants === policy
    ;(agrees ? pass : fail)('policy', `NIP-11 participant_uploads=${JSON.stringify(policy)}${agrees ? '' : ` but the card says ${JSON.stringify(card.participants)}`}${policy === 'zones' ? ' — only listed rooms upload (pass --room/--secret of one)' : ''}`)
  } else fail('policy', `NIP-11 participant_uploads=${JSON.stringify(policy)} (HTTP ${info.status}) — guests' tiles stay names-only; start the relay with --allow-participants`)

  // probe
  if (sock.ok) {
    const t0 = Date.now()
    sock.send(['REQ', 'hc-live', { '#x': ['hc:live'], limit: 0 }])
    const eose = await sock.wait(m => (m[0] === 'EOSE' || m[0] === 'CLOSED') && m[1] === 'hc-live', 4000)
    const evs = sock.inbox.filter(x => x.m[0] === 'EVENT' && x.m[1] === 'hc-live').length
    ;(eose?.[0] === 'EOSE' && evs === 0 ? pass : fail)('probe', eose ? `${eose[0]} in ${Date.now() - t0} ms, ${evs} EVENT(s)` : 'no answer within 4 s')
    sock.send(['CLOSE', 'hc-live'])
  } else skip('probe', 'no socket')

  // scan — counts only; nothing a replay carries is printed
  if (sock.ok) {
    sock.send(['REQ', 'hc-scan', { kinds: [30206], limit: 1 }])
    const answer = await sock.wait(m => (m[0] === 'EOSE' || m[0] === 'CLOSED') && m[1] === 'hc-scan', 4000)
    const evs = sock.inbox.filter(x => x.m[0] === 'EVENT' && x.m[1] === 'hc-scan').length
    const gated = answer?.[0] === 'CLOSED' && /^restricted:/.test(String(answer[2])) && evs === 0
    ;(gated ? pass : fail)('scan', gated
      ? 'a read naming no signature is CLOSED restricted: — nothing listed'
      : `a read naming no signature answered ${answer ? answer[0] : 'nothing'} with ${evs} event(s) — this relay lists rooms to anyone (deploy the address gate)`)
    sock.send(['CLOSE', 'hc-scan'])
  } else skip('scan', 'no socket')

  // the atom
  const atom = crypto.randomBytes(16)
  const sig = sha256(atom)
  const url = `${HTTP}/${sig}`
  const unsigned = await http('PUT', url, { body: atom })
  ;(unsigned.status === 401 ? pass : fail)('unsigned', `PUT without NIP-98 → ${unsigned.status} ${unsigned.text.slice(0, 60)}`)
  const early = await http('PUT', url, { body: atom, headers: { Authorization: nip98(url, 'PUT', atom) } })
  ;(early.status === 401 && /^not-live/.test(early.text) ? pass : fail)('not-live', `a key the relay has not heard → ${early.status} ${early.text.slice(0, 70)}`)

  let beaconOk = false
  if (sock.ok) {
    const beacon = finalizeEvent({ kind: 30206, created_at: now(), tags: [['x', lifecycleSig], ['d', pk], ['expiration', String(now() + 120)]], content: JSON.stringify({ alive: true }) }, sk)
    sock.send(['EVENT', beacon])
    const ok = await sock.wait(m => m[0] === 'OK' && m[1] === beacon.id, 4000)
    beaconOk = ok?.[2] === true
    ;(beaconOk ? pass : fail)('beacon', `{alive} on the throwaway zone → ${ok ? JSON.stringify(ok.slice(2)) : 'no OK within 4 s'}`)
  } else skip('beacon', 'no socket')

  if (beaconOk) {
    await sleep(200)
    const put = await http('PUT', url, { body: atom, headers: { Authorization: nip98(url, 'PUT', atom) } })
    const receipt = put.status >= 200 && put.status < 300 && put.text.trim() === `stored ${sig}`
    if (receipt) pass('store', `PUT /${sig.slice(0, 12)}… → ${put.status} 'stored <sig>'`)
    else if (policy === 'zones' && put.status === 401 && !arg('room')) skip('store', `→ ${put.status} ${put.text.slice(0, 60)} (zones policy; the throwaway zone is not listed)`)
    else fail('store', `PUT after the beacon → ${put.status} ${put.text.slice(0, 80)}`)
    if (receipt) {
      const head = await http('HEAD', url)
      const get = await http('GET', url)
      const same = get.status === 200 && sha256(get.bytes) === sig
      ;(head.status === 200 && same ? pass : fail)('serve', `HEAD ${head.status} · GET ${get.status}${same ? ' · bytes hash to the sig' : ' · BYTES DIFFER'} · cache-control ${head.headers.get('cache-control') ?? '—'}`)
    } else skip('serve', 'nothing stored')
  } else { skip('store', 'no beacon'); skip('serve', 'nothing stored') }

  const indexes = sign('hive:indexes')
  const reserved = await http('PUT', `${HTTP}/${indexes}`, { body: Buffer.from('preflight') })
  ;(reserved.status === 409 ? pass : fail)('reserved', `PUT at sign('hive:indexes') → ${reserved.status} ${reserved.text.slice(0, 60)}`)

  const missing = await http('HEAD', `${HTTP}/${sha256(crypto.randomBytes(16))}`)
  const cc = missing.headers.get('cache-control') ?? ''
  ;(missing.status === 404 && /no-store/.test(cc) ? pass : fail)('no-store', `a missing sig → ${missing.status} cache-control '${cc || '—'}'`)

  // the package
  let installed = null
  if (APEX || arg('known')) installed = arg('known') ? { root: arg('known').toLowerCase() } : await signedInstallRoot()
  if (installed?.root) {
    const h = await http('HEAD', `${HTTP}/${installed.root}`)
    ;(h.status === 200 ? pass : fail)('known', `HEAD ${installed.root.slice(0, 12)}…${installed.channel ? ` (install:${installed.channel})` : ''} on the swarm host → ${h.status}`)
  } else skip('known', installed?.err ?? 'no known sig (pass --known <sig>, or drop --no-apex)')
  if (APEX) {
    const head = await apexHead()
    if (!installed?.root || head.err) fail('apex', head.err ?? installed?.err ?? 'no signed install root')
    else {
      const served = await http('HEAD', `${APEX}/content/${installed.root}`)
      const same = head.head === installed.root
      ;(same && served.status === 200 ? pass : fail)('apex', `apex host:packages head ${head.head.slice(0, 12)}… (member ${head.max} of ${head.members}) ${same ? '=' : '≠'} signed install:${installed.channel} ${installed.root.slice(0, 12)}… (index from ${installed.host}) · apex serves the root: ${served.status}`)
    }
  } else skip('apex', '--no-apex')

  // the hosts pool's default host — where a fresh install offers its uploads
  // first. WARN only: one that cannot take them is passed over for the relay.
  if (POOL_HTTP) {
    const probeSig = sha256(crypto.randomBytes(16))
    const pre = await http('OPTIONS', `${POOL_HTTP}/${probeSig}`, {
      headers: { Origin: 'https://hypercomb.io', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization' },
    })
    const methods = String(pre.headers.get('access-control-allow-methods') ?? '').toUpperCase()
    const allowHeaders = String(pre.headers.get('access-control-allow-headers') ?? '').toLowerCase()
    const corsOk = pre.status >= 200 && pre.status < 300 && (methods.includes('PUT') || methods === '*') && (allowHeaders.includes('authorization') || allowHeaders === '*')
    ;(corsOk ? pass : warn)('pool-cors', `OPTIONS ${POOL_HOST}/<sig> (PUT + authorization) → ${pre.status} · allow-methods '${methods || '—'}' · allow-headers '${allowHeaders || '—'}'${corsOk ? '' : ' — a browser cannot upload there'}`)
    const head = await http('HEAD', `${POOL_HTTP}/${probeSig}`)
    const type = String(head.headers.get('content-type') ?? '')
    const heap = head.status === 404
    ;(heap ? pass : warn)('pool-404', `a missing sig → ${head.status}${type ? ` ${type}` : ''}${heap ? '' : /text\/html/i.test(type) ? ' — a page where a heap should be: not an upload host' : ''}`)
    const poolAtom = crypto.randomBytes(16)
    const poolSig = sha256(poolAtom)
    const poolUrl = `${POOL_HTTP}/${poolSig}`
    const put = await http('PUT', poolUrl, { body: poolAtom, headers: { Authorization: nip98(poolUrl, 'PUT', poolAtom) } })
    let stored = put.status >= 200 && put.status < 300 && put.text.trim() === `stored ${poolSig}`
    if (!stored && put.status >= 200 && put.status < 300) {
      const back = await http('GET', poolUrl)
      stored = back.status === 200 && sha256(back.bytes) === poolSig
    }
    ;(stored ? pass : warn)('pool-put', `signed PUT of a fresh key's atom → ${put.status} ${put.text.slice(0, 60)}${stored ? '' : ` — fresh installs' tiles fall to the relay${policy === 'all' || policy === 'zones' ? '' : ', which takes nobody: names only'}`}`)
  } else skip('pool-cors', '--no-pool-host')

  // leave the throwaway zone politely
  if (sock.ok) {
    if (beaconOk) {
      const left = finalizeEvent({ kind: 30206, created_at: now() + 1, tags: [['x', lifecycleSig], ['d', pk], ['expiration', String(now() + 120)]], content: JSON.stringify({ left: true }) }, sk)
      sock.send(['EVENT', left])
      await sock.wait(m => m[0] === 'OK' && m[1] === left.id, 3000)
    }
    sock.ws.close()
  }
  const failed = results.filter(r => r === 'FAIL').length
  const warned = results.filter(r => r === 'WARN').length
  console.log(`\n${results.filter(r => r === 'PASS').length} PASS · ${failed} FAIL · ${warned} WARN · ${results.filter(r => r === 'SKIP').length} SKIP — ${failed ? 'NOT READY' : warned ? `ready — but ${POOL_HOST} cannot take uploads, so the relay hosts the meeting` : 'ready to host a meeting'}`)
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error('[fatal]', e); process.exit(2) })
