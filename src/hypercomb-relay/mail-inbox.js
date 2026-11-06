// mail-inbox.js — the host's private mailbox.
//
// Mail reaches here from a Cloudflare Email Worker (mail-worker/), which POSTs the
// raw message. It is stored content-addressed in a directory that is NOT the content
// root: relay.js serves the content root to anyone who holds a signature, with open
// CORS, and a message is not public.
//
//   <dir>/<sig>            the raw message; sig = sha256 of its bytes
//   <dir>/<pool>/<sig>     one member per message for a recipient. The file is a small
//                          JSON record { from, to, at, size }; the set is unordered and
//                          the order lives in `at`.
//   pool = sha256('mail:<address>')   a pool of meaning, derived, never a typed folder
//
// Routes, all under /mail/ (the handler returns false for any other path):
//   POST /mail/inbound            Worker -> host. Headers X-Mail-Secret, X-Mail-To, X-Mail-From.
//   GET  /mail/box/<address>      the list for one address, newest first. Authorized.
//   GET  /mail/message/<sig>      the raw message bytes. Authorized.
//
// Off unless configured: no secret means inbound answers 503, no authorize means reads
// answer 403. Mail routes send no CORS headers; the reader decides that when it exists.

import { createHash, timingSafeEqual } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { normalizeAddress, poolMeaning } from './mail-address.js'

export { normalizeAddress }

const SIG_RE = /^[a-f0-9]{64}$/
// Cloudflare Email Routing refuses a message over 25 MiB, so this is the real ceiling.
export const DEFAULT_MAX_BYTES = 25 * 1024 * 1024

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

/** The pool a recipient's messages are members of. */
export const mailPool = address => sha256(Buffer.from(poolMeaning(address), 'utf8'))

const clean = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 320)

// Compared as digests, so the length of the secret is not a timing signal.
function sameSecret(offered, secret) {
  const a = createHash('sha256').update(String(offered ?? '')).digest()
  const b = createHash('sha256').update(String(secret)).digest()
  return timingSafeEqual(a, b)
}

function reply(res, code, body, type = 'text/plain') {
  if (res.headersSent) return
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(body)
}

// Written once: a message that is already here is never rewritten, so the first arrival
// time stands and a replayed post is harmless.
async function writeOnce(path, bytes) {
  try { await fsp.access(path); return false } catch { /* absent */ }
  const part = `${path}.part-${process.pid}-${Math.random().toString(16).slice(2)}`
  await fsp.mkdir(dirname(path), { recursive: true })
  try {
    await fsp.writeFile(part, bytes, { flag: 'wx' })
    await fsp.rename(part, path)
  } finally {
    await fsp.rm(part, { force: true }).catch(() => {})
  }
  return true
}

/**
 * options.dir        where messages live (never the content root)
 * options.secret     the shared secret the Worker presents; empty keeps inbound off
 * options.domains    recipient domains this host accepts; empty accepts any
 * options.authorize  (req) => { ok, reason? } for reads; absent keeps reads off
 * options.maxBytes   the largest message taken
 */
export function createMailInbox({ dir, secret = '', domains = [], authorize = null, maxBytes = DEFAULT_MAX_BYTES, log = console.log }) {
  const root = resolve(dir)
  const accepted = new Set(domains.map(d => String(d).trim().toLowerCase()).filter(Boolean))

  async function land(bytes, to, from) {
    const sig = sha256(bytes)
    await writeOnce(join(root, sig), bytes)
    const record = JSON.stringify({ from, to, at: Date.now(), size: bytes.length })
    const fresh = await writeOnce(join(root, mailPool(to), sig), record)
    if (fresh) log(`[mail] ${sig.slice(0, 12)}… for ${to} (${bytes.length} bytes)`)
    return sig
  }

  function inbound(req, res) {
    if (!secret) { reply(res, 503, 'inbound mail is not enabled on this host'); req.resume(); return }
    if (!sameSecret(req.headers['x-mail-secret'], secret)) { reply(res, 401, 'bad secret'); req.resume(); return }
    const to = normalizeAddress(req.headers['x-mail-to'])
    if (!to) { reply(res, 422, 'bad recipient'); req.resume(); return }
    if (accepted.size && !accepted.has(to.split('@')[1])) { reply(res, 422, 'recipient domain not accepted'); req.resume(); return }
    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > maxBytes) { reply(res, 413, 'message too large'); req.destroy(); return }

    const from = clean(req.headers['x-mail-from'])
    const chunks = []
    let size = 0
    let aborted = false
    req.on('data', chunk => {
      if (aborted) return
      size += chunk.length
      if (size > maxBytes) { aborted = true; reply(res, 413, 'message too large'); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('error', () => { if (!aborted) { aborted = true; reply(res, 400, 'request stream error') } })
    req.on('end', () => {
      if (aborted) return
      if (!size) { reply(res, 400, 'empty message'); return }
      land(Buffer.concat(chunks, size), to, from).then(
        sig => reply(res, 201, `stored ${sig}`),
        error => reply(res, 500, 'write failed: ' + (error?.message || 'unknown')),
      )
    })
  }

  async function read(req, res, boxMatch, messageMatch) {
    try {
      if (!authorize) { reply(res, 403, 'reading mail is not enabled on this host'); return }
      const who = authorize(req)
      if (!who?.ok) { reply(res, 401, who?.reason || 'not authorized'); return }

      if (messageMatch) {
        const bytes = await fsp.readFile(join(root, messageMatch[1])).catch(() => null)
        if (!bytes) { reply(res, 404, 'not found'); return }
        reply(res, 200, bytes, 'message/rfc822')
        return
      }

      let address = null
      try { address = normalizeAddress(decodeURIComponent(boxMatch[1])) } catch { /* malformed */ }
      if (!address) { reply(res, 422, 'bad address'); return }
      const poolDir = join(root, mailPool(address))
      const names = (await fsp.readdir(poolDir).catch(() => [])).filter(name => SIG_RE.test(name))
      const items = []
      for (const sig of names) {
        try { items.push({ sig, ...JSON.parse(await fsp.readFile(join(poolDir, sig), 'utf8')) }) } catch { /* unreadable member: skipped */ }
      }
      items.sort((a, b) => b.at - a.at)
      reply(res, 200, JSON.stringify(items), 'application/json')
    } catch (error) {
      reply(res, 500, 'read failed')
    }
  }

  return function handle(req, res) {
    const path = (req.url || '').split('?')[0]
    if (!path.startsWith('/mail/')) return false
    if (path === '/mail/inbound') {
      if (req.method !== 'POST') reply(res, 405, 'POST only')
      else inbound(req, res)
      return true
    }
    const boxMatch = /^\/mail\/box\/([^/]+)$/.exec(path)
    const messageMatch = /^\/mail\/message\/([a-f0-9]{64})$/.exec(path)
    if ((boxMatch || messageMatch) && req.method === 'GET') { read(req, res, boxMatch, messageMatch); return true }
    reply(res, 404, 'not found')
    return true
  }
}
