// The hypercomb.com mail server, as a Cloudflare Worker. It is always up, so mail never waits on a
// machine being on.
//
//   RECEIVE  Email Routing hands each message to email(). It is encrypted to the recipient's key
//            (seal.js) and filed in a private R2 bucket. If it cannot be stored, a copy address
//            catches it; if there is none, the sender is told with a bounce — never lost silently.
//   WHO      GET  /mail/me                        the addresses the signing key owns (only its own)
//   READ     GET  /mail/box/<address>[/<sig>]    the inbox list / one sealed message
//            GET  /mail/sent/<address>[/<sig>]   the same for what was sent
//   SEND     POST /mail/send                      send as an address, through Cloudflare Email Sending
//            Every route needs a signed request (NIP-98) from the key that owns the address; a send
//            also commits to its body, so the body cannot be swapped after signing.
//
// The bucket holds, per pool = sha256('mail:<address>') or sha256('mail-sent:<address>'):
//   <pool>/<sig>   the sealed envelope; customMetadata { at, meta } where meta is sealed too.
//   c/<pool>/<day> the day's send count (a plain number: the only thing here that is not sealed)
// The server can read none of the mail. It does see each message in the clear while email() or
// send() runs: that is inherent to receiving and sending mail at all.
//
//   MAIL             R2 bucket binding
//   EMAIL            the send_email binding (Cloudflare Email Sending); no binding, no sending
//   MAIL_CONFIG      the one SECRET (wrangler secret put MAIL_CONFIG): JSON { keys, copyTo, names }
//     keys           { "<address>": "<hex nostr pubkey that owns it>" }; an address with no key
//                    is not a mailbox here and cannot be sent as
//     copyTo         optional { "<address>": "<verified address>" }; per recipient on purpose,
//                    so one person's mail is never copied to another person's inbox
//   MAIL_KEYS / COPY_TO / MAIL_NAMES   the same three as plain vars, for a dev run; the secret wins
//   ALLOWED_ORIGINS  comma-separated origins the reader may call from (CORS); none means none
//   MAX_STORE_BYTES  the largest message stored (default 15 MiB; the Worker holds it in memory)
//   MAX_SEND_PER_DAY messages one address may send per UTC day (default 100)

import { normalizeAddress, poolMeaning } from '../mail-address.js'
import { sealMessage, sha256Hex } from './seal.js'
import { verifyNip98 } from './nip98.js'

const DEFAULT_MAX_STORE = 15 * 1024 * 1024
const DEFAULT_SEND_PER_DAY = 100
const MAX_SEND_BODY = 1024 * 1024
const MAX_RECIPIENTS = 20 // Cloudflare takes 50; a person writing mail does not need that many
const KEY_RE = /^[a-f0-9]{64}$/
const MESSAGE_ID_RE = /^<[^<>\s]{1,200}>$/

const enc = new TextEncoder()
const dec = new TextDecoder()

// WHO LIVES HERE is a per-deployment setting, not code: an operator's addresses, the keys that own them and
// where copies go sit in ONE secret, MAIL_CONFIG (JSON { keys, copyTo, names }), so they never enter the
// repository and survive every deploy. The plain vars MAIL_KEYS / COPY_TO / MAIL_NAMES still work for a dev
// run; the secret wins when both are set.
const settingsOf = env => {
  try {
    const parsed = JSON.parse(env.MAIL_CONFIG || '')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { keys: parsed.keys, copyTo: parsed.copyTo, names: parsed.names }
  } catch { /* no secret, or not JSON: the vars decide */ }
  return { keys: env.MAIL_KEYS, copyTo: env.COPY_TO, names: env.MAIL_NAMES }
}

const mapOf = value => {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value || '{}') : (value ?? {})
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [String(k).trim().toLowerCase(), v]))
  } catch { return {} }
}

const keysOf = env => mapOf(settingsOf(env).keys)

const ownerOf = (env, address) => {
  const key = String(keysOf(env)[address] || '').toLowerCase()
  return KEY_RE.test(key) ? key : null
}

const copyFor = (env, address) => mapOf(settingsOf(env).copyTo)[address] || null

const poolOf = (address, folder) => sha256Hex(enc.encode(poolMeaning(address, folder)))

const clip = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)

// The Subject line, unfolded, read straight from the bytes (it may be RFC 2047 encoded; the reader decodes).
function subjectOf(bytes) {
  let head = ''
  const end = Math.min(bytes.length, 16384)
  for (let i = 0; i < end; i++) head += String.fromCharCode(bytes[i])
  const stop = head.search(/\r?\n\r?\n/)
  const block = (stop < 0 ? head : head.slice(0, stop)).replace(/\r?\n[ \t]+/g, ' ')
  return clip(/^subject:[ \t]*(.*)$/im.exec(block)?.[1] || '', 120)
}

// Files one sealed message in a pool, once: a replay never rewrites it, so the first time stands.
async function file(env, pool, ownerPub, plain, meta) {
  const sig = await sha256Hex(plain)
  const key = `${pool}/${sig}`
  if (await env.MAIL.head(key)) return sig
  const at = Date.now()
  const { envelope, metaToken } = await sealMessage(plain, ownerPub, { ...meta, size: plain.length, at })
  await env.MAIL.put(key, envelope, { customMetadata: { at: String(at), meta: metaToken } })
  return sig
}

function corsFor(request, env) {
  const origin = request.headers.get('Origin')
  if (!origin) return null
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
  if (!allowed.includes(origin)) return null
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
  }
}

// What Cloudflare's error codes mean to the caller. Only the code is passed on, never a message.
const sendStatus = code =>
  /^E_(RATE_LIMIT|DAILY_LIMIT)/.test(code) ? 429
    : /^E_(VALIDATION|FIELD|TOO_MANY|CONTENT|SENDER|RECIPIENT|HEADER)/.test(code) ? 422
      : 502

async function send(request, env, respond) {
  if (!env.EMAIL) return respond(503, 'sending is not configured')
  if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) return respond(415, 'send JSON')
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_SEND_BODY) return respond(413, 'message too large')
  const raw = new Uint8Array(await request.arrayBuffer())
  if (raw.length > MAX_SEND_BODY) return respond(413, 'message too large')

  let body
  try { body = JSON.parse(dec.decode(raw)) } catch { return respond(400, 'bad JSON') }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return respond(400, 'bad JSON')

  // Who is sending: the key that owns the From address, and nobody else.
  const from = normalizeAddress(body.from)
  const owner = from ? ownerOf(env, from) : null
  const auth = owner ? await verifyNip98(request, { owner, payload: await sha256Hex(raw) }) : { ok: false, reason: 'not authorized' }
  if (!auth.ok) return respond(401, auth.reason)

  const list = value => (value === undefined ? [] : (Array.isArray(value) ? value : [value]).map(normalizeAddress))
  const to = list(body.to)
  const cc = list(body.cc)
  const bcc = list(body.bcc)
  const all = [...to, ...cc, ...bcc]
  if (!to.length || all.includes(null) || all.length > MAX_RECIPIENTS) return respond(422, 'bad recipients')

  const subject = String(body.subject ?? '')
  if (!subject.trim() || subject.length > 998 || /[\r\n]/.test(subject)) return respond(422, 'bad subject')
  const text = body.text === undefined ? '' : String(body.text)
  const html = body.html === undefined ? '' : String(body.html)
  if (!text && !html) return respond(422, 'no body')

  const replyTo = body.replyTo === undefined ? undefined : normalizeAddress(body.replyTo)
  if (body.replyTo !== undefined && !replyTo) return respond(422, 'bad reply-to')

  const threading = {}
  if (body.inReplyTo !== undefined) {
    if (!MESSAGE_ID_RE.test(String(body.inReplyTo))) return respond(422, 'bad in-reply-to')
    threading['In-Reply-To'] = String(body.inReplyTo)
  }
  if (body.references !== undefined) {
    const references = String(body.references).trim()
    if (references.length > 1000 || !references.split(/\s+/).every(id => MESSAGE_ID_RE.test(id))) return respond(422, 'bad references')
    threading['References'] = references
  }

  // The day's cap, counted before the send so a burst cannot all pass. Not atomic: it is a brake on a
  // leaked key, not an accounting system, and Cloudflare's own daily limit stands behind it.
  const cap = Number(env.MAX_SEND_PER_DAY) > 0 ? Number(env.MAX_SEND_PER_DAY) : DEFAULT_SEND_PER_DAY
  const sentPool = await poolOf(from, 'sent')
  const counterKey = `c/${sentPool}/${new Date().toISOString().slice(0, 10)}`
  try {
    const counter = await env.MAIL.get(counterKey)
    let used = 0
    if (counter) { try { used = Number((await counter.json()).n) || 0 } catch { used = 0 } }
    if (used >= cap) return respond(429, 'daily send limit reached')
    await env.MAIL.put(counterKey, JSON.stringify({ n: used + 1 }))
  } catch (error) {
    // Cannot count, so cannot keep the brake: nothing is sent rather than sent uncounted.
    console.error('send counter unavailable: ' + (error?.message || error))
    return respond(503, 'mailbox storage unavailable')
  }

  const message = { from, to, subject }
  if (text) message.text = text
  if (html) message.html = html
  if (cc.length) message.cc = cc
  if (bcc.length) message.bcc = bcc
  if (replyTo) message.replyTo = replyTo

  const refuse = error => {
    const code = String(error?.code || 'E_SEND_FAILED')
    console.error('send failed: ' + code)
    return respond(sendStatus(code), JSON.stringify({ error: code }), 'application/json')
  }

  let result
  try {
    result = await env.EMAIL.send(Object.keys(threading).length ? { ...message, headers: threading } : message)
  } catch (error) {
    // Threading headers are a nicety: if Cloudflare will not carry them, the mail still goes.
    if (Object.keys(threading).length && /^E_HEADER/.test(String(error?.code || ''))) {
      try { result = await env.EMAIL.send(message) } catch (second) { return refuse(second) }
    } else {
      return refuse(error)
    }
  }

  // The sender's own sealed copy, in the Sent folder. If it cannot be filed the mail has still gone.
  const id = result?.messageId ?? null
  let sig = null
  try {
    const record = JSON.stringify({
      id, from, to, cc, bcc, subject, text, html,
      inReplyTo: threading['In-Reply-To'] ?? null, references: threading['References'] ?? null, at: Date.now(),
    })
    sig = await file(env, sentPool, owner, enc.encode(record), { to: clip(to.join(', '), 100), subject: clip(subject, 120), id })
  } catch (error) {
    console.error('could not file the sent copy: ' + (error?.message || error))
  }
  return respond(200, JSON.stringify({ messageId: id, sig }), 'application/json')
}

export default {
  async email(message, env) {
    const to = normalizeAddress(message.to)
    const owner = to ? ownerOf(env, to) : null
    const copy = to ? copyFor(env, to) : null
    const limit = Number(env.MAX_STORE_BYTES) > 0 ? Number(env.MAX_STORE_BYTES) : DEFAULT_MAX_STORE

    let stored = false
    let reason = owner ? 'mailbox temporarily unavailable' : 'no such mailbox'
    if (owner && Number(message.rawSize) > limit) {
      reason = 'message too large'
    } else if (owner) {
      try {
        const plain = new Uint8Array(await new Response(message.raw).arrayBuffer())
        await file(env, await poolOf(to, 'box'), owner, plain, { from: clip(message.from, 100), to: clip(to, 100), subject: subjectOf(plain) })
        stored = true
      } catch (error) {
        console.error('could not store mail: ' + (error?.message || error))
      }
    }

    let copied = false
    if (copy) {
      try { await message.forward(copy); copied = true } catch (error) { console.error('copy failed: ' + (error?.message || error)) }
    }

    if (!stored && !copied) message.setReject(reason)
  },

  async fetch(request, env) {
    const cors = corsFor(request, env)
    const respond = (status, body, type = 'text/plain') => new Response(body, {
      status,
      headers: { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(cors || {}) },
    })

    if (request.method === 'OPTIONS') return cors ? new Response(null, { status: 204, headers: cors }) : new Response(null, { status: 403 })

    const url = new URL(request.url)
    if (url.pathname === '/mail/send') return request.method === 'POST' ? send(request, env, respond) : respond(405, 'POST only')

    // Which addresses does the signing key own? Any valid signature may ask, and it is told only about its own
    // addresses — never another key's — so a stranger learns nothing.
    if (url.pathname === '/mail/me') {
      if (request.method !== 'GET') return respond(405, 'GET only')
      const who = await verifyNip98(request, { anyKey: true })
      if (!who.ok) return respond(401, who.reason)
      const mine = Object.entries(keysOf(env))
        .filter(([address, key]) => normalizeAddress(address) === address && KEY_RE.test(String(key).toLowerCase()) && String(key).toLowerCase() === String(who.pubkey).toLowerCase())
        .map(([address]) => address)
        .sort()
      return respond(200, JSON.stringify({ addresses: mine }), 'application/json')
    }

    const match = /^\/mail\/(box|sent)\/([^/]+)(?:\/([a-f0-9]{64}))?$/.exec(url.pathname)
    if (!match) return respond(404, 'not found')
    if (request.method !== 'GET') return respond(405, 'GET only')

    let address = null
    try { address = normalizeAddress(decodeURIComponent(match[2])) } catch { /* malformed */ }
    if (!address) return respond(422, 'bad address')

    // An unknown mailbox and a wrong key answer alike, so the answer never says which addresses exist.
    const owner = ownerOf(env, address)
    const auth = owner ? await verifyNip98(request, { owner }) : { ok: false, reason: 'not authorized' }
    if (!auth.ok) return respond(401, auth.reason)

    const pool = await poolOf(address, match[1] === 'sent' ? 'sent' : 'box')
    if (match[3]) {
      const object = await env.MAIL.get(`${pool}/${match[3]}`)
      if (!object) return respond(404, 'not found')
      return respond(200, object.body, 'application/octet-stream')
    }

    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 100))
    const page = await env.MAIL.list({ prefix: `${pool}/`, limit, cursor: url.searchParams.get('cursor') || undefined, include: ['customMetadata'] })
    const items = page.objects.map(object => ({
      sig: object.key.slice(pool.length + 1),
      at: Number(object.customMetadata?.at) || 0,
      meta: object.customMetadata?.meta || '',
    }))
    return respond(200, JSON.stringify({ items, cursor: page.truncated ? page.cursor : null }), 'application/json')
  },
}
