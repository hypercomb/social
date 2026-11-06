// The hypercomb.com mail server, as a Cloudflare Worker. It is always up, so mail never waits on a
// machine being on. Any zone can run the same file: who lives on it is the MAIL_CONFIG secret.
//
//   RECEIVE  Email Routing hands each message to email(). It is encrypted to the recipient's keys
//            (seal.js, envelope v2) and filed in a private R2 bucket. If it cannot be stored, a copy
//            address catches it; if there is none, the sender is told with a bounce — never lost silently.
//   WHO      GET    /mail/me                                    { addresses, names } — the signer's own only
//   READ     GET    /mail/{box,sent,drafts}/<address>[?limit=&cursor=]
//                                                               { items: [{ sig, at, v, meta, wraps?, marks }], cursor }
//            GET    /mail/{box,sent,drafts}/<address>/<sig>     the sealed envelope bytes
//   MARK     PUT    /mail/{box,sent}/<address>/<sig>/marks      { read?, hidden?, flagged?, deletable? } → merged marks
//   FORGET   DELETE /mail/{box,sent,drafts}/<address>/<sig>     204 only when hidden AND deletable (drafts: always); else 409.
//                                                               The object and its marks MOVE to trash/ — nothing is destroyed here.
//   DRAFT    PUT    /mail/drafts/<address>                      the draft JSON, sealed → { sig }
//   SEND     POST   /mail/send                                  send as an address → { messageId, sig }
//            Every route needs a signed request (NIP-98) from a key that owns the address; a request
//            with a body also commits to it (the `payload` tag), so the body cannot be swapped after signing.
//            A write (POST, PUT, DELETE) spends its event: the same signed request a second time answers 409.
//            Before the signer is known to own the address every refusal is the same `401 not authorized`,
//            reached by the same work, so a stranger cannot tell a real address from a ghost.
//
// The bucket holds, per pool = sha256('mail:<address>' | 'mail-sent:<address>' | 'mail-draft:<address>'):
//   <pool>/<sig>              the sealed envelope; customMetadata { at, v, wraps, meta } (meta sealed too)
//   marks/<pool>/<sig>        the owner's marks, PLAIN JSON (they say read/hidden/flagged, not what the mail says);
//                             the same JSON rides in its customMetadata.marks so a page of marks lists in one call
//   trash/<pool>/<sig>        a deleted envelope, as it was; trash/marks/<pool>/<sig> its marks + { deletedAt, by }.
//                             Purged by an R2 lifecycle rule on the trash/ prefix (wrangler.toml says how), never by code.
//   c/<pool>/<day>            the day's send count;  d/<inbox pool>/<day>  the address's delete count
//   n/<minute>/<event id>     a spent write event, kept a few minutes (past the signature's freshness), then swept
// The server can read none of the mail. It does see each message in the clear while email() or
// send() runs: that is inherent to receiving and sending mail at all. It never logs content or keys.
//
//   MAIL             R2 bucket binding
//   EMAIL            the send_email binding (Cloudflare Email Sending); no binding, no sending
//   MAIL_CONFIG      the one SECRET (wrangler secret put MAIL_CONFIG): JSON { keys, copyTo, names }
//     keys           { "<address>": KEY | [KEY, …] }, KEY = "<hex>" or { "key": "<hex>", "can": [ACT, …] } with ACT
//                    one of read, mark, draft, delete, send. A key with no `can` may do all of them (so a plain
//                    string is a full owner); a recovery key kept offline is { key, can: ["read"] }. Every listed key
//                    is sealed to, whatever it may do. At most 3 keys (R2's 2 KB metadata holds three wraps).
//                    An address with no valid key is not a mailbox here and cannot be sent as.
//     copyTo         optional { "<address>": "<verified address>" }; per recipient on purpose,
//                    so one person's mail is never copied to another person's inbox
//     names          optional { "<address>": "Display Name" } — sent as From: Name <address>
//   MAIL_KEYS / COPY_TO / MAIL_NAMES   the same three as plain vars, for a dev run; the secret wins
//   ALLOWED_ORIGINS  comma-separated origins the reader may call from (CORS); none means none
//   MAX_STORE_BYTES  the largest message stored (default 10 MiB; the Worker holds it in memory)
//   MAX_SEND_PER_DAY messages one address may send per UTC day (default 100)
//   MAX_DELETE_PER_DAY messages one address may delete per UTC day (default 200): a brake on a leaked key

import { normalizeAddress, poolMeaning } from '../mail-address.js'
import { MAX_RECIPIENT_KEYS, sealMessage, sha256Hex } from './seal.js'
import { verifyNip98 } from './nip98.js'

// The Worker holds a whole message in memory several times over (the bytes, the ciphertext, the framed
// envelope; on a send also the JSON text and the parsed body), and Workers count ArrayBuffers toward their
// 128 MB. Measured in Node, 15 MiB in and 10 MiB of attachments out came to 171-193 MB RSS, so the caps stay
// lower until someone measures the largest receive and send under `wrangler dev` (R1 #14).
const DEFAULT_MAX_STORE = 10 * 1024 * 1024
const DEFAULT_SEND_PER_DAY = 100
const DEFAULT_DELETE_PER_DAY = 200
const MAX_SEND_BODY = 10 * 1024 * 1024 // 6 MiB of attachments is 8 MiB of base64, with room for the text
const MAX_DRAFT_BODY = 1024 * 1024
const MAX_MARKS_BODY = 1024
const MAX_RECIPIENTS = 20 // Cloudflare takes 50; a person writing mail does not need that many
const MAX_ATTACHMENTS = 10
const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024 // decoded, all attachments together
const SPENT_MINUTES = 3 // a spent event outlives the ±60 s freshness window, then is swept
const ACTS = ['read', 'mark', 'draft', 'delete', 'send']
const SCAN_BYTES = 64 * 1024 // a received message is never parsed past this, whatever its size
const PREVIEW_SOURCE_BYTES = 4096
const PREVIEW_CHARS = 120
const KEY_RE = /^[a-f0-9]{64}$/
const MESSAGE_ID_RE = /^<[^<>\s]{1,200}>$/
const MIME_TYPE_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/
const MARK_FIELDS = ['read', 'hidden', 'flagged', 'deletable']

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

// Said once per address per isolate, so a misconfiguration is visible without filling the log.
const warnedTooMany = new Set()

// What one listed key may do. No `can` is everything, so today's plain strings keep every power; a `can`
// that is not a list is read-only — a typo in the config must not hand out more than was meant.
const canOf = item => {
  if (typeof item === 'string' || !item || !('can' in item)) return new Set(ACTS)
  return new Set(Array.isArray(item.can) ? item.can.filter(act => ACTS.includes(act)) : ['read'])
}

// The keys that own an address, as [{ key, can }]: one entry or a list, invalid entries skipped, a key
// listed twice counted once (its first entry stands), at most three.
const ownersOf = (env, address) => {
  const listed = keysOf(env)[address]
  const seen = new Map()
  for (const item of Array.isArray(listed) ? listed : [listed]) {
    const key = String((item && typeof item === 'object' ? item.key : item) ?? '').trim().toLowerCase()
    if (KEY_RE.test(key) && !seen.has(key)) seen.set(key, { key, can: canOf(item) })
  }
  const owners = [...seen.values()]
  if (owners.length > MAX_RECIPIENT_KEYS && !warnedTooMany.has(address)) {
    warnedTooMany.add(address)
    console.warn(`${address} lists ${owners.length} keys; only the first ${MAX_RECIPIENT_KEYS} own it`)
  }
  return owners.slice(0, MAX_RECIPIENT_KEYS)
}

const keysFor = owners => owners.map(owner => owner.key)

const copyFor = (env, address) => mapOf(settingsOf(env).copyTo)[address] || null

const clip = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)

// A display name goes into a From header: no control characters, no quotes or angle brackets to break out of it.
const nameFor = (env, address) => {
  const name = clip(String(mapOf(settingsOf(env).names)[address] ?? '').replace(/["<>\\]/g, ''), 64)
  return name || null
}

const poolOf = (address, folder) => sha256Hex(enc.encode(poolMeaning(address, folder)))

// ── reading a received message, cheaply ──────────────────────────────────────────────────────────

const latin1Of = (bytes, max) => {
  let s = ''
  const end = Math.min(bytes.length, max)
  for (let i = 0; i < end; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, Math.min(end, i + 0x8000)))
  return s
}

// A header block → Map of lowercase name → first value, unfolded.
function headersOf(block) {
  const map = new Map()
  for (const line of block.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon < 1) continue
    const name = line.slice(0, colon).trim().toLowerCase()
    if (!map.has(name)) map.set(name, line.slice(colon + 1).trim())
  }
  return map
}

const splitPart = text => {
  const stop = /\r?\n\r?\n/.exec(text)
  return stop ? { head: text.slice(0, stop.index), body: text.slice(stop.index + stop[0].length) } : { head: text, body: '' }
}

const paramOf = (value, name) => {
  const m = new RegExp(`;\\s*${name}\\*?=\\s*(?:"([^"]*)"|([^;\\s]+))`, 'i').exec(value || '')
  return m ? (m[1] ?? m[2]) : null
}

const decodeQuotedPrintable = text => {
  const soft = text.replace(/=\r?\n/g, '')
  const bytes = []
  for (let i = 0; i < soft.length; i++) {
    if (soft[i] === '=' && /^[0-9a-f]{2}$/i.test(soft.slice(i + 1, i + 3))) { bytes.push(parseInt(soft.slice(i + 1, i + 3), 16)); i += 2 } else bytes.push(soft.charCodeAt(i) & 0xff)
  }
  return new Uint8Array(bytes)
}

const decodeBase64Loose = text => {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '')
  try { return Uint8Array.from(atob(clean.slice(0, clean.length - (clean.length % 4))), c => c.charCodeAt(0)) } catch { return new Uint8Array(0) }
}

const charsetText = (bytes, charset) => {
  try { return new TextDecoder(String(charset || 'utf-8').toLowerCase()).decode(bytes) } catch { return dec.decode(bytes) }
}

const collapse = text => text.replace(/\s+/g, ' ').trim()

// The first text/plain part (not an attachment) gives the preview; any part named or disposed as an
// attachment sets hasAttachments. Only what lies inside the scanned window is seen, and a part that runs
// past it previews from what is there — a glance, never a promise.
function scanParts(headers, body, found, depth = 0) {
  const type = (headers.get('content-type') || 'text/plain').toLowerCase()
  const disposition = (headers.get('content-disposition') || '').toLowerCase()
  if (/^\s*attachment/.test(disposition) || paramOf(disposition, 'filename') || (!type.startsWith('multipart/') && paramOf(type, 'name'))) {
    found.hasAttachments = true
    return
  }
  if (type.startsWith('multipart/')) {
    const boundary = paramOf(headers.get('content-type'), 'boundary')
    if (!boundary || depth > 3) return
    const pieces = body.split(`--${boundary}`)
    for (const piece of pieces.slice(1)) {
      if (piece.startsWith('--')) break
      const { head, body: inner } = splitPart(piece.replace(/^[ \t]*\r?\n/, ''))
      scanParts(headersOf(head), inner, found, depth + 1)
    }
    return
  }
  if (found.preview !== undefined || !type.startsWith('text/plain')) return
  const source = body.slice(0, PREVIEW_SOURCE_BYTES)
  const encoding = (headers.get('content-transfer-encoding') || '').toLowerCase().trim()
  const bytes = encoding === 'quoted-printable' ? decodeQuotedPrintable(source)
    : encoding === 'base64' ? decodeBase64Loose(source)
      : Uint8Array.from(source, c => c.charCodeAt(0) & 0xff)
  const preview = collapse(charsetText(bytes, paramOf(headers.get('content-type'), 'charset'))).slice(0, PREVIEW_CHARS)
  if (preview) found.preview = preview
}

const messageIdsIn = value => (String(value || '').match(/<[^<>\s]+>/g) || []).filter(id => MESSAGE_ID_RE.test(id))

// The sealed list metadata of a received message, from its first 64 KB. Subject stays as written
// (it may be RFC 2047 encoded; the reader decodes).
function describeReceived(bytes) {
  const window = latin1Of(bytes, SCAN_BYTES)
  const { head, body } = splitPart(window)
  const headers = headersOf(head)
  const meta = { subject: clip(headers.get('subject') || '', 120) }
  const messageId = messageIdsIn(headers.get('message-id'))[0]
  if (messageId) meta.messageId = messageId
  const inReplyTo = messageIdsIn(headers.get('in-reply-to'))[0]
  if (inReplyTo) meta.inReplyTo = inReplyTo
  const references = messageIdsIn(headers.get('references')).slice(-3)
  if (references.length) meta.references = references
  const date = clip(headers.get('date') || '', 64)
  if (date) meta.date = date
  const found = { hasAttachments: false }
  try { scanParts(headers, body, found) } catch { /* a malformed message still files; it just has no preview */ }
  meta.hasAttachments = found.hasAttachments
  if (found.preview) meta.preview = found.preview
  return meta
}

// ── storage ──────────────────────────────────────────────────────────────────────────────────────

// Files one sealed message in a pool, once: a replay never rewrites it, so the first time stands.
async function file(env, pool, owners, plain, meta) {
  const sig = await sha256Hex(plain)
  const key = `${pool}/${sig}`
  if (await env.MAIL.head(key)) return sig
  const at = Date.now()
  const { envelope, customMetadata } = await sealMessage(plain, owners, { ...meta, size: plain.length, at })
  await env.MAIL.put(key, envelope, { customMetadata })
  return sig
}

const marksKey = (pool, sig) => `marks/${pool}/${sig}`

async function readMarks(env, pool, sig) {
  const object = await env.MAIL.get(marksKey(pool, sig))
  if (!object) return null
  try { return await object.json() } catch { return null }
}

// The marks of one page of a list, in as few calls as the page needs: marks sort by sig exactly as the
// page does, so one list from just before the page's first sig to its last covers it.
async function marksForPage(env, pool, sigs) {
  const out = new Map()
  if (!sigs.length) return out
  const wanted = new Set(sigs)
  const sorted = [...sigs].sort()
  const prefix = `marks/${pool}/`
  const last = sorted[sorted.length - 1]
  let options = { prefix, startAfter: prefix + sorted[0].slice(0, 63), limit: 1000, include: ['customMetadata'] }
  for (let calls = 0; calls < 20; calls++) {
    const page = await env.MAIL.list(options)
    let past = false
    for (const object of page.objects) {
      const sig = object.key.slice(prefix.length)
      if (sig > last) { past = true; break }
      if (!wanted.has(sig)) continue
      try { out.set(sig, JSON.parse(object.customMetadata?.marks ?? 'null')) } catch { /* unreadable marks are no marks */ }
    }
    if (past || !page.truncated) break
    options = { prefix, cursor: page.cursor, limit: 1000, include: ['customMetadata'] }
  }
  return out
}

// ── who is asking, once ──────────────────────────────────────────────────────────────────────────

const NOT_AUTHORIZED = [401, 'not authorized']

// Every signature is checked in full (any key accepted), and only then held against the owners — so a
// ghost address (no owners) and a real one do the same work and give the same answer to a stranger. The
// precise reason (stale, wrong url, …) is kept for a key that IS an owner; everyone else is told only
// "not authorized". Answers { owner, event } or { refuse }.
async function authorize(request, owners, act) {
  const who = await verifyNip98(request, { anyKey: true })
  const owner = owners.find(entry => entry.key === String(who.pubkey || '').toLowerCase())
  if (!owner) return { refuse: NOT_AUTHORIZED }
  if (!who.ok) return { refuse: [401, who.reason] }
  if (act && !owner.can.has(act)) return { refuse: [403, `this key may not ${act}`] }
  return { owner, event: who }
}

// A write's event is spent once: a conditional put under the event's own minute, refused when the key is
// already there. The same signed request again (a logging proxy, an extension, a page on an allowed origin)
// answers 409 and does nothing. The minute is the event's created_at, so a replay finds the same key; spent
// records older than the freshness window are swept on the way out. Answers null, or [status, reason].
async function spend(env, event) {
  const minute = Math.floor(Number(event.at) / 60)
  const key = `n/${String(minute).padStart(10, '0')}/${event.id}`
  let stored
  try {
    stored = await env.MAIL.put(key, '', { onlyIf: new Headers({ 'If-None-Match': '*' }) })
  } catch (error) {
    // Cannot remember it, so cannot refuse a replay: nothing is done rather than done twice.
    console.error('replay record unavailable: ' + (error?.message || error))
    return [503, 'mailbox storage unavailable']
  }
  if (stored === null) return [409, 'this signed request was already used']
  try {
    const old = await env.MAIL.list({ prefix: 'n/', limit: 100 })
    const stale = old.objects.map(o => o.key).filter(k => Number(k.slice(2, 12)) < Math.floor(Date.now() / 60000) - SPENT_MINUTES)
    if (stale.length) await env.MAIL.delete(stale)
  } catch { /* a sweep that fails now runs again on the next write */ }
  return null
}

// A per-day count, checked before the act so a burst cannot all pass. Not atomic: a brake on a leaked key,
// not an accounting system. Answers null, or [status, reason]; a bucket that cannot count refuses (fail closed).
async function countToday(env, key, cap, over) {
  try {
    const counter = await env.MAIL.get(key)
    let used = 0
    if (counter) { try { used = Number((await counter.json()).n) || 0 } catch { used = 0 } }
    if (used >= cap) return [429, over]
    await env.MAIL.put(key, JSON.stringify({ n: used + 1 }))
    return null
  } catch (error) {
    console.error('counter unavailable: ' + (error?.message || error))
    return [503, 'mailbox storage unavailable']
  }
}

const today = () => new Date().toISOString().slice(0, 10)

// ── the HTTP side ────────────────────────────────────────────────────────────────────────────────

function corsFor(request, env) {
  const origin = request.headers.get('Origin')
  if (!origin) return null
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
  if (!allowed.includes(origin)) return null
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
  }
}

// A JSON body, size-capped before and after reading. Answers { raw } or { refuse: [status, reason] }.
async function readJsonBody(request, max) {
  if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) return { refuse: [415, 'send JSON'] }
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > max) return { refuse: [413, 'message too large'] }
  const raw = new Uint8Array(await request.arrayBuffer())
  if (raw.length > max) return { refuse: [413, 'message too large'] }
  let body
  try { body = JSON.parse(dec.decode(raw)) } catch { return { refuse: [400, 'bad JSON'] } }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { refuse: [400, 'bad JSON'] }
  return { raw, body }
}

// What Cloudflare's error codes mean to the caller. Only the code is passed on, never a message.
const sendStatus = code =>
  /^E_(RATE_LIMIT|DAILY_LIMIT)/.test(code) ? 429
    : /^E_(VALIDATION|FIELD|TOO_MANY|CONTENT|SENDER|RECIPIENT|HEADER|ATTACHMENT)/.test(code) ? 422
      : 502

// A filename is a name, never a path: separators become `_`; control characters (C0, DEL, C1) and the
// bidirectional controls go entirely — `invoice‮fdp.exe` would otherwise show as "invoiceexe.pdf" (R1 #7);
// a long one keeps its extension.
const INVISIBLE_RE = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g
function cleanFilename(value) {
  let name = String(value ?? '').replace(INVISIBLE_RE, '').replace(/[/\\:]/g, '_').replace(/^[.\s]+/, '').trim()
  if (!name) name = 'attachment'
  if (name.length > 120) {
    const dot = name.lastIndexOf('.')
    const ext = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : ''
    name = name.slice(0, 120 - ext.length) + ext
  }
  return name
}

// Attachments as the caller sent them, checked: { list } or { refuse: [status, reason] }.
function attachmentsOf(value) {
  if (value === undefined) return { list: [] }
  if (!Array.isArray(value)) return { refuse: [422, 'bad attachments'] }
  if (value.length > MAX_ATTACHMENTS) return { refuse: [422, 'too many attachments'] }
  const list = []
  let total = 0
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof item.content !== 'string') return { refuse: [422, 'bad attachment'] }
    const type = String(item.type ?? '').trim().toLowerCase()
    if (!MIME_TYPE_RE.test(type)) return { refuse: [422, 'bad attachment type'] }
    const content = item.content.replace(/\s+/g, '')
    if (content.length % 4 !== 0 || !BASE64_RE.test(content)) return { refuse: [422, 'bad attachment content'] }
    total += content.length / 4 * 3 - (content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0)
    if (total > MAX_ATTACHMENT_BYTES) return { refuse: [413, 'attachments too large'] }
    list.push({ filename: cleanFilename(item.filename), type, content })
  }
  return { list }
}

async function send(request, env, respond) {
  if (!env.EMAIL) return respond(503, 'sending is not configured')

  // A signature before the body: an unsigned (or badly signed) 10 MiB POST is refused without being read
  // (R1 #12). The From address is in the body, so who may send is settled after reading it.
  const signer = await verifyNip98(request, { anyKey: true })
  if (!signer.ok) return respond(...NOT_AUTHORIZED)
  const read = await readJsonBody(request, MAX_SEND_BODY)
  if (read.refuse) return respond(...read.refuse)
  const { raw, body } = read

  // Who is sending: a key that owns the From address and may send, and nobody else.
  const from = normalizeAddress(body.from)
  const owners = from ? ownersOf(env, from) : []
  const sender = owners.find(entry => entry.key === String(signer.pubkey).toLowerCase())
  if (!sender) return respond(...NOT_AUTHORIZED)
  if (signer.payloadTag !== await sha256Hex(raw)) return respond(401, 'auth payload tag mismatch')
  if (!sender.can.has('send')) return respond(403, 'this key may not send')
  const spent = await spend(env, signer)
  if (spent) return respond(...spent)

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

  const attachments = attachmentsOf(body.attachments)
  if (attachments.refuse) return respond(...attachments.refuse)

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
  // Cannot count, so cannot keep the brake: nothing is sent rather than sent uncounted.
  const capped = await countToday(env, `c/${sentPool}/${today()}`, cap, 'daily send limit reached')
  if (capped) return respond(...capped)

  const name = nameFor(env, from)
  const message = { from: name ? { email: from, name } : from, to, subject }
  if (text) message.text = text
  if (html) message.html = html
  if (cc.length) message.cc = cc
  if (bcc.length) message.bcc = bcc
  if (replyTo) message.replyTo = replyTo
  // Cloudflare takes base64 strings as attachment content (and they survive `wrangler dev`, binary does not).
  if (attachments.list.length) message.attachments = attachments.list.map(a => ({ content: a.content, filename: a.filename, type: a.type, disposition: 'attachment' }))

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

  // The sender's own sealed copy, in the Sent folder, attachments and all. If it cannot be filed the
  // mail has still gone.
  const id = result?.messageId ?? null
  let sig = null
  try {
    const record = JSON.stringify({
      id, from, name, to, cc, bcc, subject, text, html,
      inReplyTo: threading['In-Reply-To'] ?? null, references: threading['References'] ?? null,
      attachments: attachments.list, at: Date.now(),
    })
    const meta = { to: clip(to.join(', '), 100), subject: clip(subject, 120), id, hasAttachments: attachments.list.length > 0 }
    if (id && MESSAGE_ID_RE.test(String(id))) meta.messageId = String(id)
    if (threading['In-Reply-To']) meta.inReplyTo = threading['In-Reply-To']
    if (threading['References']) meta.references = threading['References'].split(/\s+/).slice(-3)
    const preview = collapse(text).slice(0, PREVIEW_CHARS)
    if (preview) meta.preview = preview
    sig = await file(env, sentPool, keysFor(owners), enc.encode(record), meta)
  } catch (error) {
    console.error('could not file the sent copy: ' + (error?.message || error))
  }
  return respond(200, JSON.stringify({ messageId: id, sig }), 'application/json')
}

// The marks route: booleans only, merged over what was there, stamped with when.
// The body it signed for, not another; then the event is spent, so the same request cannot land twice.
async function bodyFor(request, env, event, max) {
  const read = await readJsonBody(request, max)
  if (read.refuse) return read
  if (event.payloadTag !== await sha256Hex(read.raw)) return { refuse: [401, 'auth payload tag mismatch'] }
  const spent = await spend(env, event)
  return spent ? { refuse: spent } : read
}

async function putMarks(request, env, respond, { pool, sig, event }) {
  const read = await bodyFor(request, env, event, MAX_MARKS_BODY)
  if (read.refuse) return respond(...read.refuse)
  const fields = Object.entries(read.body)
  if (fields.some(([key, value]) => !MARK_FIELDS.includes(key) || typeof value !== 'boolean')) return respond(422, 'marks are read, hidden, flagged and deletable, each true or false')
  if (!(await env.MAIL.head(`${pool}/${sig}`))) return respond(404, 'not found')
  const merged = { ...((await readMarks(env, pool, sig)) || {}), ...Object.fromEntries(fields), at: Date.now() }
  const json = JSON.stringify(merged)
  await env.MAIL.put(marksKey(pool, sig), json, { customMetadata: { marks: json } })
  return respond(200, json, 'application/json')
}

// Hide first, delete second (H4): a message goes only once its owner hid it and said it may go.
// A draft is the owner's own unfinished writing and goes on request.
//
// Even then nothing is destroyed here: the envelope and its marks MOVE to trash/, so a leaked or recovery
// key that hides, marks and deletes everything has emptied the mailbox, not the bucket (R1 #6). Purging trash
// is an R2 lifecycle rule on the trash/ prefix, set by the operator — not code that a key could reach. A daily
// cap per address stands behind it, like the send cap.
async function forget(env, respond, { folder, address, pool, sig, event }) {
  const object = await env.MAIL.get(`${pool}/${sig}`)
  if (!object) return respond(404, 'not found')
  const marks = await readMarks(env, pool, sig)
  if (folder !== 'drafts' && !(marks?.hidden === true && marks?.deletable === true)) return respond(409, 'hide it and mark it deletable first')
  const spent = await spend(env, event)
  if (spent) return respond(...spent)
  const cap = Number(env.MAX_DELETE_PER_DAY) > 0 ? Number(env.MAX_DELETE_PER_DAY) : DEFAULT_DELETE_PER_DAY
  const capped = await countToday(env, `d/${await poolOf(address, 'box')}/${today()}`, cap, 'daily delete limit reached')
  if (capped) return respond(...capped)
  try {
    await env.MAIL.put(`trash/${pool}/${sig}`, await object.arrayBuffer(), { customMetadata: object.customMetadata || {} })
    const record = JSON.stringify({ ...(marks || {}), deletedAt: Date.now(), by: event.pubkey })
    await env.MAIL.put(`trash/${marksKey(pool, sig)}`, record, { customMetadata: { marks: record } })
  } catch (error) {
    // The copy did not land, so the original stays: a delete never loses what it could not keep.
    console.error('could not move to trash: ' + (error?.message || error))
    return respond(503, 'mailbox storage unavailable')
  }
  await env.MAIL.delete([`${pool}/${sig}`, marksKey(pool, sig)])
  return respond(204, null)
}

async function putDraft(request, env, respond, { pool, owners, event }) {
  const read = await bodyFor(request, env, event, MAX_DRAFT_BODY)
  if (read.refuse) return respond(...read.refuse)
  const to = read.body.to === undefined ? '' : (Array.isArray(read.body.to) ? read.body.to.map(String).join(', ') : String(read.body.to))
  try {
    const sig = await file(env, pool, keysFor(owners), read.raw, { to: clip(to, 100), subject: clip(read.body.subject, 120) })
    return respond(200, JSON.stringify({ sig }), 'application/json')
  } catch (error) {
    console.error('could not file the draft: ' + (error?.message || error))
    return respond(503, 'mailbox storage unavailable')
  }
}

async function listFolder(url, env, respond, { folder, pool }) {
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 100))
  const page = await env.MAIL.list({ prefix: `${pool}/`, limit, cursor: url.searchParams.get('cursor') || undefined, include: ['customMetadata'] })
  const sigs = page.objects.map(object => object.key.slice(pool.length + 1))
  const marks = folder === 'drafts' ? new Map() : await marksForPage(env, pool, sigs)
  const items = page.objects.map((object, i) => {
    const custom = object.customMetadata || {}
    const v = Number(custom.v) === 2 ? 2 : 1
    const item = { sig: sigs[i], at: Number(custom.at) || 0, v, meta: custom.meta || '' }
    if (v === 2) { try { item.wraps = JSON.parse(custom.wraps) } catch { /* a v2 item without readable wraps cannot open; the client says so */ } }
    item.marks = marks.get(sigs[i]) ?? null
    return item
  })
  return respond(200, JSON.stringify({ items, cursor: page.truncated ? page.cursor : null }), 'application/json')
}

export default {
  async email(message, env) {
    const to = normalizeAddress(message.to)
    const owners = to ? ownersOf(env, to) : []
    const copy = to ? copyFor(env, to) : null
    const limit = Number(env.MAX_STORE_BYTES) > 0 ? Number(env.MAX_STORE_BYTES) : DEFAULT_MAX_STORE

    let stored = false
    let reason = owners.length ? 'mailbox temporarily unavailable' : 'no such mailbox'
    if (owners.length && Number(message.rawSize) > limit) {
      reason = 'message too large'
    } else if (owners.length) {
      try {
        const plain = new Uint8Array(await new Response(message.raw).arrayBuffer())
        await file(env, await poolOf(to, 'box'), keysFor(owners), plain, { from: clip(message.from, 100), to: clip(to, 100), ...describeReceived(plain) })
        stored = true
      } catch (error) {
        console.error('could not store mail: ' + (error?.message || error))
      }
    }

    let copied = false
    if (copy) {
      try { await message.forward(copy); copied = true } catch (error) { console.error('copy failed: ' + (error?.message || error)) }
    }

    // A storage outage with no copy address is still a reject, though a reject is permanent and the sender
    // will not retry (R1 #13). Throwing instead would be right only if Email Routing answers a thrown
    // handler with a temporary (4xx) failure, and Cloudflare's docs do not say so: checked 2026-11-06,
    // developers.cloudflare.com/email-routing/email-workers/runtime-api/ ("Reject emails with a permanent
    // SMTP error"), …/email-routing/email-workers/, …/email-routing/limits/ and …/email-routing/postmaster/
    // — none states what a thrown or failed handler returns. A bounce the sender is told about beats a
    // silent drop; change this to `throw` once a test on a real zone shows a throw is retried.
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
      const signer = String(who.pubkey).toLowerCase()
      const names = {}
      const can = {}
      for (const address of Object.keys(keysOf(env)).sort()) {
        if (normalizeAddress(address) !== address) continue
        const mine = ownersOf(env, address).find(entry => entry.key === signer)
        if (!mine) continue
        can[address] = ACTS.filter(act => mine.can.has(act))
        const name = nameFor(env, address)
        if (name) names[address] = name
      }
      // `can` says what this key may do per address, so a reader can leave out what would be refused.
      return respond(200, JSON.stringify({ addresses: Object.keys(can), names, can }), 'application/json')
    }

    const match = /^\/mail\/(box|sent|drafts)\/([^/]+)(?:\/([a-f0-9]{64})(\/marks)?)?$/.exec(url.pathname)
    if (!match) return respond(404, 'not found')
    const [, folder, encoded, sig, marksPath] = match
    const method = request.method
    const allowed = marksPath ? (folder === 'drafts' ? [] : ['PUT'])
      : sig ? ['GET', 'DELETE']
        : folder === 'drafts' ? ['GET', 'PUT'] : ['GET']
    if (!allowed.includes(method)) return respond(405, allowed.length ? `${allowed.join(' or ')} only` : 'drafts carry no marks')

    let address = null
    try { address = normalizeAddress(decodeURIComponent(encoded)) } catch { /* malformed */ }
    if (!address) return respond(422, 'bad address')

    // An unknown mailbox and a wrong key answer alike, by the same work (authorize() checks every signature
    // in full before it looks at who owns the address), so the answer never says which addresses exist.
    // Who is asking also comes before anything about the body: a stranger's PUT answered 415 or 413 where
    // a ghost gets 401 would say the same. A PUT is then held to the exact body it carries.
    const owners = ownersOf(env, address)
    const pool = await poolOf(address, folder)
    const act = method === 'GET' ? 'read' : method === 'DELETE' ? 'delete' : marksPath ? 'mark' : 'draft'
    const auth = await authorize(request, owners, act)
    if (auth.refuse) return respond(...auth.refuse)
    const context = { folder, address, pool, sig, owners, event: auth.event }
    if (method === 'PUT') return marksPath ? putMarks(request, env, respond, context) : putDraft(request, env, respond, context)

    if (method === 'DELETE') return forget(env, respond, context)
    if (sig) {
      const object = await env.MAIL.get(`${pool}/${sig}`)
      if (!object) return respond(404, 'not found')
      return respond(200, object.body, 'application/octet-stream')
    }
    return listFolder(url, env, respond, context)
  },
}
