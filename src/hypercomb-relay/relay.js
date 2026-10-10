#!/usr/bin/env node
// hypercomb-relay — minimal Nostr relay AND HTTP content host for private swarm meetings
// usage: node relay.js [--port 7777] [--pubkeys hex1,hex2] [--max-event-size 65536] [--content-dir ./content] [--shell-dir ./host-shell] [--writers hex1,hex2] [--domain a.example,b.example] [--primary hex|npub] [--max-body-bytes 52428800] [--replication-origins https://a.example,https://b.example] [--allow-private-sources] [--allow-participants[=all|lifecycleSig,...]] [--access-codes <file>]
//        node relay.js --new-access-code <file>       (recycle: print a fresh code, keep only its hash)
//        node relay.js --destroy-access-codes <file>  (admit nobody new)
//
// env fallbacks (used when the matching --flag is absent):
//   ACCESS_CODES     → --access-codes: the file of sha256(code) lines; set, a
//                      WebSocket is admitted only with a current access code
//   PORT             → port to listen on (Azure App Service injects this)
//   ALLOW_PARTICIPANTS → --allow-participants: `all` (or 1/true), or a comma
//                      list of lifecycle sigs; unset/0/false: writers only
//   DOMAINS          → --domain: the hostnames /.well-known/nostr.json vouches
//                      for this relay's writers at (none: nobody, anywhere)
//   PRIMARY          → --primary: the writer answered as `_` (none: no `_`)
//   CONTENT_DIR      → directory to serve HTTP content from (sig-addressed
//                      content store). Defaults to ./content next to the
//                      script. Operators populate it however they want
//                      (rsync, symlink, manual copy); the relay just
//                      serves whatever's in there.
//
// HTTP file serving makes this a "host" in the domain-as-identity sense
// (per project_domain_as_identity.md). The relay endpoint (wss://) and
// the content endpoint (https://) share a hostname; askers learn the
// hostname via the { bytes, domains } primitive and HTTPS-GET against
// it for resources/bees/deps/layers.

import { createServer } from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, rmSync, writeFileSync, promises as fsp } from 'node:fs'
import { basename, dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { verifyEvent } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { requestIp, verifyNip98 } from './http-auth.js'
import { blockedSourcesReason } from './address-guard.js'
import { contentDirectoryIO, HOST_PACKAGES_POOL, PUBLIC_POOL_ADDRESSES, parseReplicationRequest, publishReplicatedPackage, resolvePackageClosure, resolveSignatureClosure, resolveSignatureInventory } from './replicate.js'
import { ReceiptIndex } from './receipt-index.js'
import { listedMeanings } from './host-listing.js'
import { nip05Name, nostrJson } from './nip05-names.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── cli ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const envPort = Number(process.env.PORT)
  const envContentDir = String(process.env.CONTENT_DIR ?? '').trim()
  const args = {
    port: Number.isFinite(envPort) && envPort > 0 ? envPort : 7777,
    pubkeys: null,
    // Must clear the swarm's resource pipeline: kind-30201 events inline
    // up to MAX_RESOURCE_BYTES (256 KB) of image bytes as base64 — ≈342 KB
    // of JSON before the envelope. At the old 64 KB cap every tile-image
    // event was rejected with NOTICE 'message too large' (silently ignored
    // by the mesh client), so peer tiles could never carry their images.
    maxEventSize: 524288,
    // Content dir for HTTP file serving. Default: ./content next to the
    // script. Operators populate it however they like (symlink to their
    // dist/, rsync from elsewhere, manual copy). The relay serves only
    // files inside this dir — directory traversal is blocked.
    contentDir: envContentDir || resolve(__dirname, 'content'),
    // Optional framework-free host shell. The relay's writable content heap
    // remains separate; the shell is a deployable, read-only payload.
    shellDir: String(process.env.HOST_SHELL_DIR ?? '').trim() || null,
    // Allowed-writer pubkeys for HTTP PUT (content backup). When unset
    // here, falls back to --pubkeys after parse; empty => writes disabled.
    // Each PUT carries a NIP-98 signed event whose pubkey must be in this set.
    writers: (() => { const e = String(process.env.WRITERS ?? '').trim(); return e ? e.split(',').map(normalizePubkey).filter(Boolean) : null })(),
    // NIP-05 (`/.well-known/nostr.json`, documentation/sealed-audiences.md,
    // Names). Both DECLARED, never inferred. `domains`: the hostnames this
    // relay vouches for its writers at — a relay cannot see which names point
    // at it, so every other Host it is reached by (content.<domain> included)
    // vouches for nobody, and with none declared, nobody anywhere. `primary`:
    // the writer that IS the domain (`_@<domain>`), which must also be a
    // writer — the writer list is unordered (one key per authoring browser
    // profile), so its order never ranks anyone. Undeclared: no `_`.
    domains: (() => { const e = String(process.env.DOMAINS ?? '').trim(); return e ? e.split(',').map(normalizeDomain).filter(Boolean) : null })(),
    primary: (() => { const e = String(process.env.PRIMARY ?? '').trim(); return e ? declaredPrimary(e) : null })(),
    // Hard cap on a single PUT body (default 50 MB) — prevents disk-fill abuse.
    maxBodyBytes: 52_428_800,
    // DEV ONLY: skip writer-authorization on PUT (sha256 content-integrity is
    // STILL enforced — bytes must hash to the sig). Lets a local browser stage
    // its own authored content on a dev relay without NIP-98 key setup. Never
    // use on a public host.
    devOpenWrites: false,
    // Replication destinations. `POST /replicate` asks THIS host to GET origins
    // the caller names, so the caller chooses where the host's socket goes.
    // Authorization answers who is asking, never where they pointed it.
    //
    // replicationOrigins: when non-empty, a source must match one of these
    // origins exactly (scheme + host + port). Empty means "any origin that
    // survives the address screen" — the same shape --writers uses, except an
    // empty set here widens rather than closes, because replication from the
    // open web is the ordinary case and an origin list is the operator's
    // tightening, not their opt-in.
    replicationOrigins: (() => {
      const value = String(process.env.REPLICATION_ORIGINS ?? '').trim()
      return value ? value.split(',').map(normalizeOrigin).filter(Boolean) : null
    })(),
    // DEV ONLY: let replication sources point into loopback / private / link-local
    // space. Off by default: otherwise an authorized writer can read the
    // operator's cloud metadata endpoint, admin ports and internal services
    // through a replication result. A dev relay pulling from 127.0.0.1 needs it;
    // a public host must never set it.
    allowPrivateSources: String(process.env.ALLOW_PRIVATE_SOURCES ?? '').trim() === '1',
    // THE MEETING POINT HOSTS ITS PARTICIPANTS (participantPolicyOf below).
    // Off unless the operator says so: `--allow-participants` alone (or `=all`)
    // admits any key live on this relay's WebSocket; `=<lifecycleSig,...>` only
    // keys whose {alive} beacon named one of those rooms. Writers are untouched.
    allowParticipants: String(process.env.ALLOW_PARTICIPANTS ?? '').trim() || null,
    // SPA serving REMOVED — the relay is a slim STORAGE/MESH host only.
    //
    // Under the full-split model, the installer's code-serving role is fixed
    // to the canonical project origin (diamondcoreprocessor.com). Any host
    // that ALSO serves installer code becomes a trust-surface because the
    // operator can swap that code silently between visits. Slim hosts CAN'T
    // do that — they serve `/<sig>` bytes (content-addressed, unforgeable)
    // and the WSS relay (passes messages). That's it.
    //
    // A request for `/` now returns a small landing page that names the host
    // and links the participant to the canonical installer. No SPA, no client
    // routing, no index.html fallback. If you want to develop on the
    // installer, run `npm start` from `diamond-core-processor/` separately
    // (it serves at localhost:2400). Don't conflate.
    //
    // swarm-temp REMOVED — there is no mesh file transfer and no TTL'd side
    // pool. A participant's bytes reach this host only as ordinary flat atoms
    // over PUT /<sig>, and only when --allow-participants says so.
    //
    // THE ACCESS CODE (the access gate, below): a file of sha256(code) lines.
    // Set, a WebSocket is admitted only with a current code; unset, the relay
    // is open as it always was. `accessCommand` is the operator's one-shot
    // recycle (`--new-access-code` / `--destroy-access-codes`), never a server.
    accessCodes: (() => { const e = String(process.env.ACCESS_CODES ?? '').trim(); return e ? resolve(e) : null })(),
    accessCommand: null,
  }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--memory') continue  // accepted for old launch lines; memory is the only mode now
    if (a === '--dev-open-writes') { args.devOpenWrites = true; continue }
    if (a === '--allow-private-sources') { args.allowPrivateSources = true; continue }
    if (a === '--allow-participants') { args.allowParticipants = 'all'; continue }
    if (a.startsWith('--allow-participants=')) { args.allowParticipants = a.slice('--allow-participants='.length); continue }
    const next = argv[i + 1]
    if (a === '--port' && next) { args.port = Number(next); i++ }
    else if (a === '--pubkeys' && next) { args.pubkeys = next.split(',').map(normalizePubkey).filter(Boolean); i++ }
    else if (a === '--max-event-size' && next) { args.maxEventSize = Number(next); i++ }
    else if (a === '--content-dir' && next) { args.contentDir = resolve(next); i++ }
    else if (a === '--shell-dir' && next) { args.shellDir = resolve(next); i++ }
    else if (a === '--writers' && next) { args.writers = next.split(',').map(normalizePubkey).filter(Boolean); i++ }
    else if (a === '--domain' && next) { args.domains = next.split(',').map(normalizeDomain).filter(Boolean); i++ }
    else if (a === '--primary' && next) { args.primary = declaredPrimary(next); i++ }
    else if (a === '--max-body-bytes' && next) { args.maxBodyBytes = Number(next); i++ }
    else if (a === '--replication-origins' && next) { args.replicationOrigins = next.split(',').map(normalizeOrigin).filter(Boolean); i++ }
    else if (a === '--access-codes' && next) { args.accessCodes = resolve(next); i++ }
    else if (a === '--new-access-code' && next) { args.accessCommand = { op: 'new', file: resolve(next) }; i++ }
    else if (a === '--destroy-access-codes' && next) { args.accessCommand = { op: 'destroy', file: resolve(next) }; i++ }
    else if (a === '--spa-dir' && next) {
      // Removed flag — surface a clear error so legacy startup scripts get
      // updated rather than silently changing behavior. The relay no longer
      // serves the SPA under any circumstances.
      console.error('[relay] --spa-dir was removed. The relay is a slim storage/mesh host.')
      console.error('[relay] Update your startup script to drop --spa-dir.')
      console.error('[relay] To develop on the installer, run `npm start` from diamond-core-processor/ separately (localhost:2400).')
      process.exit(2)
    }
    else if (a === '--swarm-temp' || a === '--swarm-temp-ttl' || a === '--swarm-temp-cap' || a === '--swarm-temp-total') {
      console.error(`[relay] ${a} was removed — swarm-temp no longer exists (no host-brokering; missing sigs are eggs). Drop it from your startup script.`)
      process.exit(2)
    }
  }
  return args
}

/** An allowed replication origin is scheme + host + port and nothing else —
 * a path would invite a caller to think a prefix was enforced when only the
 * ORIGIN can be. */
function normalizeOrigin(raw) {
  try {
    const url = new URL(String(raw).trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin
  } catch { return null }
}

/** A hostname as a Host header carries it: lowercase, no port, no trailing
 *  dot. A bracketed IPv6 literal keeps its brackets. Anything else is none. */
function normalizeDomain(raw) {
  let host = String(raw ?? '').trim().toLowerCase()
  if (host.startsWith('[')) host = host.slice(0, host.indexOf(']') + 1)
  else if (host.includes(':')) host = host.slice(0, host.indexOf(':'))
  if (host.endsWith('.')) host = host.slice(0, -1)
  return /^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])$/.test(host) ? host : null
}

/** The declared `_` key, or null — said out loud when it is no key at all. */
function declaredPrimary(raw) {
  const pubkey = normalizePubkey(raw)
  if (!pubkey) console.error('[relay] --primary / PRIMARY is not a 64-hex or npub key — /.well-known/nostr.json answers no _')
  return pubkey
}

function normalizePubkey(raw) {
  const s = raw.trim()
  if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase()
  try { const { type, data } = nip19.decode(s); if (type === 'npub') return data } catch {}
  return null
}

const cfg = parseArgs(process.argv)
if (cfg.shellDir && (!existsSync(join(cfg.shellDir, 'index.html')) || !existsSync(join(cfg.shellDir, 'pin')))) {
  throw new Error(`--shell-dir must contain index.html and pin: ${cfg.shellDir}`)
}

// Allowed-writer pubkeys for HTTP PUT. Defaults to the relay's event-auth
// whitelist (--pubkeys) when --writers is absent. Empty set => writes are
// rejected — an open relay does not accept content writes by default; the
// operator opts in by listing their own pubkey(s).
const writers = new Set(
  ((cfg.writers && cfg.writers.length ? cfg.writers : cfg.pubkeys) || []).map((p) => p.toLowerCase())
)

// NIP-05: the hostnames this relay vouches for its writers at, and the writer
// answered as `_` there — both declared (see parseArgs). A primary that is not
// a writer is not this relay's to vouch for, so it is refused out loud.
const nip05Domains = new Set(cfg.domains || [])
const nip05Primary = cfg.primary && writers.has(cfg.primary) ? cfg.primary : null
if (cfg.primary && !nip05Primary) console.error(`[relay] --primary ${cfg.primary.slice(0, 8)}… is not a writer — /.well-known/nostr.json answers no _`)

// Origins a replication source may name. Empty = unrestricted (the address
// screen still applies); non-empty = an exact-origin allowlist.
const replicationOrigins = new Set(cfg.replicationOrigins || [])

function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

// ── the access code: recycled by the operator, never kept ────────────────────
//
// jwize 2026-10-09: "Just allow an access code that can be recycled — we will
// set up servers for other people." A relay started with --access-codes <file>
// (or ACCESS_CODES) admits a WebSocket only when its dial carries the
// subprotocol `hc-access.<code>` and sha256(code) is a line of that file. The
// code rides the upgrade itself, so admission costs no round trip, and the
// relay keeps the HASH, never the code: secrets are never kept anywhere they
// could be read back.
//
// RECYCLED, NOT RESTARTED (documentation/becoming-a-host.md, "Keys are
// recycled"): the file is the one place the current code lives.
//   node relay.js --new-access-code <file>       a fresh code in, every old one out
//   node relay.js --destroy-access-codes <file>  nobody new gets in
// The running relay reads the change within a second and closes every
// connection that came in under a hash no longer listed, so the old code
// stops working the moment it is recycled: no restart, no redeploy. A missing
// or empty file admits nobody (fail closed). A refusal is close 4401 straight
// after the upgrade, before any frame — a browser cannot read the status of a
// refused upgrade, but it can read a close code. A relay without
// --access-codes echoes the subprotocol (ws's default) and ignores it.
const ACCESS_PROTOCOL_PREFIX = 'hc-access.'
const ACCESS_REFUSED_CLOSE = 4401

/** Write `hashes` as the access file, atomically (a reader never sees half). */
function writeAccessFile(file, hashes) {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, hashes.map((h) => h + '\n').join(''), { mode: 0o600 })
  renameSync(tmp, file)
}

if (cfg.accessCommand) {
  const { op, file } = cfg.accessCommand
  if (op === 'new') {
    // 128 random bits as base64url: 22 characters, every one valid in a
    // WebSocket subprotocol token and in a URL fragment.
    const code = randomBytes(16).toString('base64url')
    writeAccessFile(file, [sha256Hex(Buffer.from(code, 'utf8'))])
    console.log(code)
    console.error(`[relay] a new access code is current; every earlier one stopped working. ${file} holds only its hash — the code above is shown once: put it in the meeting link.`)
  } else {
    writeAccessFile(file, [])
    console.error(`[relay] every access code is destroyed: nobody new is admitted until --new-access-code ${file}`)
  }
  process.exit(0)
}

// ── the swarm's host: participants ───────────────────────────────────────────
//
// THE RELAY YOU MEET AT IS YOUR SWARM'S HOST. wss://<host> means
// https://<host>/<sig>: every joined tab derives its upload target from the
// relay it dials, so a meeting needs no host pick, no /publish and nothing
// stored. This relay's HTTP half is that host for the participants its
// operator allows (--allow-participants); the mesh half is unchanged — events
// stay memory-only, a meeting point and never a store. Bytes that land here
// are ordinary flat atoms: sha-verified, at /<sig> only, never over a pool or
// a bag, and they outlive both the sharer and a relay restart.
//
// WHO: any key that has sent a verified EVENT on this relay's WebSocket in the
// last 30 minutes — joining is the consent, and a key nobody has seen in the
// room cannot upload. In zones mode, only keys whose {alive} beacon (kind
// 30206) named one of the listed lifecycle sigs. The memory of who is live is
// this process's alone: a restart wipes it, and the reconnect beacon refills it.
//
// HOW MUCH (participants only; writers stay uncapped): one atom at most 8 MB;
// per key 256 MB and per venue IP 2 GB a day; 4 GB a day across every
// participant; and nothing once the disk is under 10 GB free. Only NEW bytes
// count — re-storing an atom already held costs nothing. No record of who
// stored what is kept: the receipt index stays the writers', and the only
// trace a participant leaves in the log is a count in the minute line.

/** off | { mode: 'all' } | { mode: 'zones', zones }. A list naming no valid
 *  lifecycle sig fails CLOSED, out loud: a typo must not open the disk. */
function participantPolicyOf(raw) {
  if (raw === null || raw === undefined) return { mode: false }
  const value = String(raw).trim().toLowerCase()
  if (['0', 'false', 'off', 'no'].includes(value)) return { mode: false }
  if (['all', '1', 'true', 'on', 'yes'].includes(value)) return { mode: 'all' }
  const named = value.split(',').map(s => s.trim()).filter(Boolean)
  const zones = new Set(named.filter(s => /^[0-9a-f]{64}$/.test(s)))
  if (zones.size !== named.length || zones.size === 0) {
    console.error(`[relay] --allow-participants / ALLOW_PARTICIPANTS takes \`all\` or a comma list of 64-hex lifecycle sigs — ${zones.size === 0 ? 'participants stay closed' : `${named.length - zones.size} entr${named.length - zones.size === 1 ? 'y' : 'ies'} ignored`}`)
    if (zones.size === 0) return { mode: false }
  }
  return { mode: 'zones', zones }
}

const participantPolicy = participantPolicyOf(cfg.allowParticipants)
const participantMode = participantPolicy.mode  // 'all' | 'zones' | false — what NIP-11 and the hc:host card say

// Past its live window an entry admits nothing, so it is forgotten then: a key
// that speaks again is entered again, and its next beacon names its room.
const PARTICIPANT_LIVE_MS = 30 * 60_000
const QUOTA_WINDOW_MS = 24 * 60 * 60_000
// An atom PUT can only ever re-store the bytes its address names, so a replayed
// token buys nothing; ±10 min lets a device whose clock is off by minutes
// still upload. Every other signed route keeps the ±60 s default.
const ATOM_AUTH_SKEW_SECS = 600
const MB = 1024 * 1024
const participantCaps = {
  blob: 8 * MB,
  key: 256 * MB,
  ip: 2048 * MB,
  total: 4096 * MB,
  floor: 10240 * MB,
  // HARNESS ONLY: the same rules at sizes a test can reach (bytes, partial).
  ...(() => { try { return JSON.parse(process.env.DIAG_PARTICIPANT_CAPS || '{}') } catch { return {} } })(),
}

const participants = new Map()  // pubkey → { seenAt, xs: Set<lifecycle x> } — only while the policy is on
const keyQuota = new Map()      // pubkey → { at, bytes } over QUOTA_WINDOW_MS
const ipQuota = new Map()       // ip → { at, bytes }
let totalQuota = { at: Date.now(), bytes: 0 }
let diskFree = null             // bytes free under the content dir, refreshed off the hot path

function markLive(pubkey) {
  if (!participantPolicy.mode) return
  const held = participants.get(pubkey)
  if (held) held.seenAt = Date.now()
  else participants.set(pubkey, { seenAt: Date.now(), xs: new Set() })
}

function isLive(pubkey) {
  const held = participants.get(pubkey)
  return !!held && Date.now() - held.seenAt <= PARTICIPANT_LIVE_MS
}

function participantAllowed(pubkey) {
  if (!participantPolicy.mode || !isLive(pubkey)) return false
  if (participantPolicy.mode === 'all') return true
  for (const x of participants.get(pubkey).xs) if (participantPolicy.zones.has(x)) return true
  return false
}

function quotaOf(map, id, now) {
  let held = map.get(id)
  if (!held || now - held.at >= QUOTA_WINDOW_MS) { held = { at: now, bytes: 0 }; map.set(id, held) }
  return held
}

const retryAfter = (window, now) => String(Math.max(1, Math.ceil((window.at + QUOTA_WINDOW_MS - now) / 1000)))

/** [status, body, retryAfter?] when this many NEW bytes would cross a cap, else null. */
function participantRefusal(pubkey, ip, bytes, now) {
  if (bytes > participantCaps.blob) return [413, `too large: a participant atom is at most ${participantCaps.blob} bytes`]
  const key = quotaOf(keyQuota, pubkey, now)
  if (key.bytes + bytes > participantCaps.key) return [429, 'quota: this key has stored its share for today', retryAfter(key, now)]
  const venue = quotaOf(ipQuota, ip, now)
  if (venue.bytes + bytes > participantCaps.ip) return [429, 'quota: this network has stored its share for today', retryAfter(venue, now)]
  if (now - totalQuota.at >= QUOTA_WINDOW_MS) totalQuota = { at: now, bytes: 0 }
  if (totalQuota.bytes + bytes > participantCaps.total) return [507, 'host full', retryAfter(totalQuota, now)]
  if (diskFree !== null && diskFree - bytes < participantCaps.floor) return [507, 'host full', '3600']
  return null
}

function chargeParticipant(pubkey, ip, bytes, now) {
  quotaOf(keyQuota, pubkey, now).bytes += bytes
  quotaOf(ipQuota, ip, now).bytes += bytes
  totalQuota.bytes += bytes
  if (diskFree !== null) diskFree -= bytes
}

/** Free bytes under the content dir (its nearest existing ancestor before the
 *  first write makes it). Never awaited by a request — the check reads the
 *  last answer, and every participant write lowers it until the next one. */
async function refreshDiskFree() {
  let dir = resolve(cfg.contentDir)
  for (;;) {
    try { const s = await fsp.statfs(dir); diskFree = Number(s.bavail) * Number(s.bsize); return } catch {}
    const up = dirname(dir)
    if (up === dir) return
    dir = up
  }
}

function sweepParticipants() {
  const now = Date.now()
  for (const [pubkey, held] of participants) if (now - held.seenAt > PARTICIPANT_LIVE_MS) participants.delete(pubkey)
  for (const map of [keyQuota, ipQuota]) for (const [id, held] of map) if (now - held.at >= QUOTA_WINDOW_MS) map.delete(id)
  if (participantPolicy.mode) void refreshDiskFree()
}

// ── permissions-policy ───────────────────────────────────────────────────────
//
// Sent on every HTTP response. Tells the browser, structurally, which Web APIs
// this site uses and which it explicitly DOES NOT use. The `=()` form disables
// the feature for THIS origin and any embedded frames; `=(self)` allows it for
// our own origin only (no third-party iframes get it).
//
// This is what closes the "Edge auto-prompts for window-management because it
// saw a multi-monitor setup" class of bug: with the policy header set, the
// browser knows the API isn't in use and skips the prompt entirely. Same
// principle for every other prompting Web API — explicitly closing the door
// for APIs we don't use, opening it only for the camera/mic/clipboard/etc.
// surfaces the meeting + recording + tile-editor features actually need.
const PERMISSIONS_POLICY = [
  // ── explicitly DENIED (we do not use these — no prompt should ever fire) ──
  'accelerometer=()',
  'ambient-light-sensor=()',
  'battery=()',
  'bluetooth=()',
  'browsing-topics=()',
  'compute-pressure=()',
  'display-capture=()',
  'document-domain=()',
  'gamepad=()',
  'geolocation=()',
  'gyroscope=()',
  'hid=()',
  'idle-detection=()',
  'local-fonts=()',
  'magnetometer=()',
  'midi=()',
  'otp-credentials=()',
  'payment=()',
  'publickey-credentials-create=()',
  'publickey-credentials-get=()',
  'screen-wake-lock=()',
  'serial=()',
  'speaker-selection=()',
  'storage-access=()',
  'usb=()',
  'web-share=()',
  'window-management=()',   // ← the one that produced the Edge "access other apps and services" prompt
  'xr-spatial-tracking=()',
  // ── allowed for OUR ORIGIN only (features the site actually uses) ──
  'autoplay=(self)',
  'camera=(self)',
  'clipboard-read=(self)',
  'clipboard-write=(self)',
  'encrypted-media=(self)',
  'fullscreen=(self)',
  'microphone=(self)',
  'picture-in-picture=(self)',
].join(', ')

// ── event store (memory only) ────────────────────────────────────────────────
//
// The relay is a MEETING POINT, not a store. Participants meet at a
// signature address; the bytes behind a signature travel between a HOST
// and a participant by replication, never through here. So the relay
// remembers only what rendezvous needs: replaceable slots (one per
// publisher + kind + d-tag, the newest wins) and expiring beacons — in
// process memory, gone on restart, nothing on disk. Every event the swarm
// publishes is one or the other. Ephemeral kinds (20000–29999) are
// broadcast to live subscribers and never kept at all.

const events = new Map()  // id → event
const slots = new Map()   // pubkey\0kind\0d → id of the replaceable event held

// THE STORE IS READ BY ADDRESS ONLY (the address gate, below). So it is
// indexed by the addresses an event names — each 64-hex `x` tag — and, for
// the HTTP index route, by publisher + kind. A read costs the matches at the
// address it names, never a walk over every room's events. storeEvent and
// dropEvent are the only writers of `events`, so the indexes cannot drift.
const HEX64 = /^[0-9a-f]{64}$/
const idsByX = new Map()          // 64-hex x value → Set<event id>
const idsByAuthorKind = new Map() // pubkey\0kind → Set<event id>

function indexAdd(map, key, id) {
  let set = map.get(key)
  if (!set) { set = new Set(); map.set(key, set) }
  set.add(id)
}

function indexDrop(map, key, id) {
  const set = map.get(key)
  if (!set) return
  set.delete(id)
  if (set.size === 0) map.delete(key)
}

/** The signature addresses an event names: its 64-hex `x` tag values. */
function addressesOf(evt) {
  const xs = new Set()
  for (const tag of evt.tags || []) if (Array.isArray(tag) && tag[0] === 'x' && HEX64.test(String(tag[1]))) xs.add(String(tag[1]))
  return xs
}

function storeEvent(rec) {
  events.set(rec.id, rec)
  for (const x of addressesOf(rec)) indexAdd(idsByX, x, rec.id)
  indexAdd(idsByAuthorKind, `${rec.pubkey}\0${rec.kind}`, rec.id)
}

function dropEvent(id) {
  const rec = events.get(id)
  if (!rec) return
  events.delete(id)
  for (const x of addressesOf(rec)) indexDrop(idsByX, x, id)
  indexDrop(idsByAuthorKind, `${rec.pubkey}\0${rec.kind}`, id)
}

// Bumped whenever a WRITER's hive index enters or leaves the store, so what
// the writers' indexes say (/.well-known/nostr.json) is re-read only when one
// of them moved — never per request, since parsing every index costs a read per writer.
let writerIndexMoves = 0
const movesWriterIndex = (evt) => Number(evt.kind) === HIVE_INDEX_KIND && writers.has(evt.pubkey)

const isEphemeralKind = (kind) => kind >= 20000 && kind < 30000
const isAddressableKind = (kind) => kind >= 30000 && kind < 40000                       // one per pubkey+kind+d
const isReplaceableKind = (kind) => kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000)  // one per pubkey+kind
const tagValue = (evt, name) => (evt.tags || []).find((t) => Array.isArray(t) && t[0] === name)?.[1]
const dTagOf = (evt) => String(tagValue(evt, 'd') ?? '')
const expirationOf = (evt) => { const n = Number(tagValue(evt, 'expiration')); return Number.isFinite(n) && n > 0 ? n : 0 }
const slotKey = (evt, kind) => `${evt.pubkey}\0${kind}\0${isAddressableKind(kind) ? dTagOf(evt) : ''}`

// Returns the NIP-01 verdict: 'stored' | 'duplicate' | 'stale' | 'ephemeral'.
function insertEvent(evt) {
  const kind = Number(evt.kind)
  if (isEphemeralKind(kind)) return 'ephemeral'
  if (events.has(evt.id)) return 'duplicate'
  if (isAddressableKind(kind) || isReplaceableKind(kind)) {
    // NIP-01: exactly ONE event per slot — the newest; on equal created_at
    // the lowest id wins. The whole swarm wire model assumes this. A stale
    // republish never displaces the held slot.
    const key = slotKey(evt, kind)
    const heldId = slots.get(key)
    const held = heldId ? events.get(heldId) : undefined
    if (held && (held.created_at > evt.created_at || (held.created_at === evt.created_at && held.id < evt.id))) return 'stale'
    if (heldId) dropEvent(heldId)
    slots.set(key, evt.id)
  }
  storeEvent({ id: evt.id, pubkey: evt.pubkey, created_at: Number(evt.created_at), kind, tags: evt.tags, content: evt.content, sig: evt.sig })
  if (movesWriterIndex(evt)) writerIndexMoves++
  return 'stored'
}

// NIP-01 event shape, checked before the (expensive) signature. Every
// refusal is an OK false with a machine-readable prefix.
const HEX128 = /^[0-9a-f]{128}$/
const FUTURE_SKEW_SECS = 15 * 60
function eventShapeError(evt) {
  if (!evt || typeof evt !== 'object') return 'invalid: event is not an object'
  if (!HEX64.test(String(evt.id))) return 'invalid: id must be 64 lowercase hex'
  if (!HEX64.test(String(evt.pubkey))) return 'invalid: pubkey must be 64 lowercase hex'
  if (!HEX128.test(String(evt.sig))) return 'invalid: sig must be 128 lowercase hex'
  if (!Number.isInteger(evt.kind) || evt.kind < 0 || evt.kind > 65535) return 'invalid: kind must be an integer 0–65535'
  if (!Number.isInteger(evt.created_at)) return 'invalid: created_at must be an integer'
  if (evt.created_at > Math.floor(Date.now() / 1000) + FUTURE_SKEW_SECS) return 'invalid: created_at is too far in the future'
  if (!Array.isArray(evt.tags) || !evt.tags.every((tag) => Array.isArray(tag) && tag.every((v) => typeof v === 'string'))) return 'invalid: tags must be an array of string arrays'
  if (typeof evt.content !== 'string') return 'invalid: content must be a string'
  return null
}

function newestEvent(pubkey, kind) {
  let best
  for (const id of idsByAuthorKind.get(`${pubkey}\0${kind}`) ?? []) {
    const evt = events.get(id)
    if (evt && (!best || evt.created_at > best.created_at)) best = evt
  }
  return best
}

/** The ids a filter can match, from the index: exact ids, else every event
 *  held at one of its `#x` addresses. The address gate has already refused
 *  any filter that names neither. */
function candidatesOf(f) {
  if (Array.isArray(f.ids) && f.ids.length) return f.ids
  const out = new Set()
  for (const x of f['#x'] || []) for (const id of idsByX.get(x) ?? []) out.add(id)
  return out
}

function queryEvents(filters) {
  const results = []
  const now = Math.floor(Date.now() / 1000)
  for (const f of filters) {
    const hits = []
    for (const id of candidatesOf(f)) {
      const evt = events.get(id)
      if (!evt) continue
      const exp = expirationOf(evt)
      if (exp && exp < now) continue  // NIP-40: never replay an expired beacon, even before the sweep
      if (matchFilter(f, evt)) hits.push(evt)
    }
    hits.sort((a, b) => b.created_at - a.created_at)
    results.push(...hits.slice(0, Math.min(f.limit ?? 500, MAX_LIMIT)))
  }
  return results
}

function deleteExpired() {
  const now = Math.floor(Date.now() / 1000)
  for (const [id, evt] of events) {
    const exp = expirationOf(evt)
    if (exp && exp < now) {
      dropEvent(id)
      if (movesWriterIndex(evt)) writerIndexMoves++
      if ((isAddressableKind(evt.kind) || isReplaceableKind(evt.kind)) && slots.get(slotKey(evt, evt.kind)) === id) slots.delete(slotKey(evt, evt.kind))
    }
  }
}

// ── rate limiting ────────────────────────────────────────────────────────────

// AN IP IS NOT ONE PARTICIPANT. A venue is one public IPv4 address for the
// whole room, and through the tunnel every socket's peer is cloudflared, so a
// budget keyed on the IP alone was the whole meeting's: one fixed 1200/min
// window, and crossing it muted everyone until it reset. The budget is now a
// token bucket PER CONNECTION — burst 400, refilled at 10/s (600/min against
// measured clients at 9–150/min; a full reconnect reassert is under 100
// frames) — under a per-IP ceiling that exists only to stop a flood: burst
// 12000, 200/s. The IP is CF-Connecting-IP when the peer is loopback, never
// the client-written first X-Forwarded-For hop (requestIp, http-auth.js).
// EVENT and REQ cost one token; CLOSE and AUTH cost nothing and are never
// refused — a refused CLOSE leaked a subscription the client had forgotten.
// HARNESS ONLY: DIAG_RATE_LIMIT (frames/min) scales the per-connection bucket.
const CONN_SCALE = Number(process.env.DIAG_RATE_LIMIT) > 0 ? Number(process.env.DIAG_RATE_LIMIT) / 600 : 1
const CONN_BURST = 400 * CONN_SCALE
const CONN_REFILL_PER_SEC = 10 * CONN_SCALE
const IP_BURST = 12_000
const IP_REFILL_PER_SEC = 200
const ipBuckets = new Map() // ip → { tokens, at }

const freshBucket = (burst, now) => ({ tokens: burst, at: now })
function refill(bucket, burst, perSec, now) {
  bucket.tokens = Math.min(burst, bucket.tokens + (now - bucket.at) * perSec / 1000)
  bucket.at = now
}

/** One token from this connection AND its IP, or none from either. */
function takeToken(client) {
  const now = Date.now()
  let venue = ipBuckets.get(client.ip)
  if (!venue) { venue = freshBucket(IP_BURST, now); ipBuckets.set(client.ip, venue) }
  refill(client.bucket, CONN_BURST, CONN_REFILL_PER_SEC, now)
  refill(venue, IP_BURST, IP_REFILL_PER_SEC, now)
  if (client.bucket.tokens < 1 || venue.tokens < 1) return false
  client.bucket.tokens--
  venue.tokens--
  return true
}

// A bucket untouched for a full refill is full again: forgetting it changes nothing.
function sweepBuckets() {
  const idle = Date.now() - (IP_BURST / IP_REFILL_PER_SEC) * 1000
  for (const [ip, bucket] of ipBuckets) if (bucket.at < idle) ipBuckets.delete(ip)
}

// ── the minute line (counts only) ────────────────────────────────────────────
//
// What an operator needs to see during a meeting, and nothing that names
// anyone: open connections, what was refused, wills fired and cancelled,
// participant uploads, and how many participants are alive in each room (a
// room is the first 6 hex of its lifecycle sig). Never an IP, never a key.
// Printed once a minute, and only when there is something to say.
const census = { refusedEvents: 0, refusedReqs: 0, refusedSubs: 0, unaddressed: 0, accessRefused: 0, handlerErrors: 0, willsFired: 0, willsCancelled: 0, puts: 0, putBytes: 0, putsRefused: 0 }

function printCensus() {
  const rooms = new Map()  // x prefix → Set of pubkeys (counted, never printed)
  for (const c of clients) for (const { x, pubkey } of c.lifecycle.values()) {
    const room = x.slice(0, 6)
    if (!rooms.has(room)) rooms.set(room, new Set())
    rooms.get(room).add(pubkey)
  }
  const c = census
  const said = clients.size + c.refusedEvents + c.refusedReqs + c.refusedSubs + c.unaddressed + c.accessRefused + c.handlerErrors + c.willsFired + c.willsCancelled + c.puts + c.putsRefused
  if (said > 0) {
    const zones = [...rooms].map(([room, keys]) => `${room}:${keys.size}`).join(' ') || 'none'
    // `unaddressed`: reads or writes that named no signature (a scan) — refused, see the address gate.
    // `access`: dials refused for want of the current access code (the access gate).
    console.log(`[minute] open ${clients.size} · refused event ${c.refusedEvents} req ${c.refusedReqs}${c.refusedSubs ? ` subs ${c.refusedSubs}` : ''}${c.unaddressed ? ` unaddressed ${c.unaddressed}` : ''}${c.accessRefused ? ` access ${c.accessRefused}` : ''}${c.handlerErrors ? ` · handler errors ${c.handlerErrors}` : ''} · wills fired ${c.willsFired} cancelled ${c.willsCancelled} · participant puts ${c.puts} (${c.putBytes} bytes) refused ${c.putsRefused} · zones ${zones}`)
  }
  for (const k of Object.keys(c)) c[k] = 0
}

// ── filter matching (for live broadcast) ─────────────────────────────────────

function matchFilter(filter, evt) {
  if (filter.ids && !filter.ids.includes(evt.id)) return false
  if (filter.authors && !filter.authors.includes(evt.pubkey)) return false
  if (filter.kinds && !filter.kinds.includes(evt.kind)) return false
  if (filter.since != null && evt.created_at < filter.since) return false
  if (filter.until != null && evt.created_at > filter.until) return false

  for (const [key, values] of Object.entries(filter)) {
    if (!key.startsWith('#') || key.length !== 2 || !Array.isArray(values)) continue
    const tagName = key[1]
    const evtValues = evt.tags.filter(t => t[0] === tagName).map(t => t[1])
    if (!values.some(v => evtValues.includes(v))) return false
  }
  return true
}

function matchesAny(filters, evt) {
  return filters.some(f => matchFilter(f, evt))
}

// ── nip-42 auth ──────────────────────────────────────────────────────────────

const authRequired = Array.isArray(cfg.pubkeys)

function makeChallenge() { return randomBytes(32).toString('hex') }

function verifyAuth(evt, challenge) {
  if (!evt || evt.kind !== 22242) return false
  try { if (!verifyEvent(evt)) return false } catch { return false }

  const challengeTag = evt.tags.find(t => t[0] === 'challenge')
  if (!challengeTag || challengeTag[1] !== challenge) return false
  // NIP-42: the auth event must be fresh (±10 minutes). The relay tag is
  // not checked — behind a tunnel this process cannot know its public URL.
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(evt.created_at)) > 600) return false

  if (!cfg.pubkeys.includes(evt.pubkey)) return false
  return true
}

// ── connections ──────────────────────────────────────────────────────────────

const clients = new Set()
// A joined shell holds ~14 long-lived subscriptions (lifecycle, location,
// presence, follow, channels, broker broadcast, peer models, avatars,
// meeting, feedback) before a single image is requested — and every image
// a peer's layer references that isn't local yet opens one more. At 20 the
// cap was reached in ordinary use; the refusal was a NOTICE the client
// ignored, so the NEXT location a participant walked into was silently
// deaf until reload. 200 leaves an order of magnitude of headroom while
// still bounding one connection's share of the broadcast loop.
const MAX_SUBS_PER_CLIENT = 200
const MAX_SUBID_LENGTH = 64  // NIP-01

// ── the address gate ─────────────────────────────────────────────────────────
//
// THE SIGNATURES ARE THE ONLY THING THAT CAN BE QUERIED (jwize 2026-09-25;
// 2026-10-07: "the directory can not be scanned on the mesh … that would be
// making our private information public"). A room meets at addresses only
// its members can derive — sign(<label>\0room\0secret) — so what the relay
// holds stays the room's exactly as long as every read must NAME one. A
// filter that named none (kinds only, authors only, `{}`) used to replay up to
// 5000 events from every room, then receive every live event the relay saw,
// and it cost a walk over the whole store per REQ. Now each filter names its
// addresses — `#x` signatures, or exact event `ids` — and anything else is
// CLOSED `restricted:`: nothing replayed, nothing routed, the store untouched.
// A read costs the matches at its addresses (idsByX), never the store.
//
// Two words predate signatures naming everything. Each is decided here:
//   'hc:live'      the liveness probe (nostr-mesh PROBE_FRAME). Not a channel:
//                  answered EOSE and never stored or routed, so nothing can
//                  ever be heard on it.
//   'broker:fetch' the content broker's ask channel on builds before the
//                  room-scoped one (content-broker ASK_LABEL). An ask names the
//                  bytes — or a room's location — it wants, so a channel anyone
//                  can hear is a directory of every room's addresses. Kept for
//                  the drain ONLY room-scoped: an event on it reaches a
//                  subscriber only when both connections are in one lifecycle
//                  zone (zonesOf), and nothing on it is ever replayed. A
//                  scanner that knows no room's lifecycle sig hears nothing.
//                  Only the broker's ask and cancel (DRAIN_KINDS) may be
//                  published there. Retire it with the last build that asks
//                  there.
//
// WRITES NAME A SIGNATURE TOO. An event's `x` is the address it is filed and
// fanned out under, so an `x` that is not 64-hex (bar the drained word's own
// two kinds) is refused `restricted:` — before this, a word address was
// stored where no read could ever reach it but an exact id.
//
// Limits: 10 filters and 16 addresses per REQ, and 256 live addresses per
// connection — a joined tab holds at most one address per subscription (its
// 200-subscription cap), so the ceiling only stops one socket from parking
// thousands of guessed room addresses at once.
const LIVENESS_WORD = 'hc:live'
const ROOM_SCOPED_WORDS = new Set(['broker:fetch'])
const DRAIN_KINDS = new Set([20400, 20402])  // the broker's ask and its cancel
const MAX_FILTERS_PER_REQ = 10
const MAX_ADDRESSES_PER_REQ = 16
const MAX_ADDRESSES_PER_CONNECTION = 256
const MAX_LIMIT = 5000

const isStringArray = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string')
const isCount = (v) => v === undefined || v === null || (typeof v === 'number' && Number.isFinite(v))

/** The `ids` or the `#x` values a filter names, or null when it names none. */
function namedAddresses(f) {
  if (Array.isArray(f.ids) && f.ids.length) return f.ids
  if (Array.isArray(f['#x']) && f['#x'].length) return f['#x']
  return null
}

/** The CLOSED reason for a REQ whose filters are malformed or name no
 *  signature address, else null. Shape first: a `kinds` that was not an array
 *  used to throw inside matchFilter and take the whole process down. */
function filterRefusal(filters) {
  if (filters.length > MAX_FILTERS_PER_REQ) return `invalid: at most ${MAX_FILTERS_PER_REQ} filters in one REQ`
  let named = 0
  for (const f of filters) {
    for (const field of ['ids', 'authors']) if (f[field] !== undefined && !isStringArray(f[field])) return `invalid: ${field} must be an array of strings`
    if (f.kinds !== undefined && !(Array.isArray(f.kinds) && f.kinds.every(Number.isInteger))) return 'invalid: kinds must be an array of integers'
    for (const field of ['since', 'until', 'limit']) if (!isCount(f[field])) return `invalid: ${field} must be a number`
    if (typeof f.limit === 'number' && f.limit < 0) return 'invalid: limit must not be negative'
    for (const key of Object.keys(f)) if (key[0] === '#' && !isStringArray(f[key])) return `invalid: ${key} must be an array of strings`
    const addresses = namedAddresses(f)
    if (!addresses) return 'restricted: name a signature address (#x) or exact ids — this relay lists nothing'
    if (addresses === f.ids ? !addresses.every((id) => HEX64.test(id)) : !addresses.every((x) => HEX64.test(x) || ROOM_SCOPED_WORDS.has(x))) {
      return `restricted: ${addresses === f.ids ? 'ids' : '#x'} must be 64-hex signatures`
    }
    named += addresses.length
  }
  return named > MAX_ADDRESSES_PER_REQ ? `invalid: at most ${MAX_ADDRESSES_PER_REQ} addresses in one REQ` : null
}

/** The liveness probe: every filter's `#x` is the probe word and nothing else. */
const isLivenessProbe = (filters) => filters.every((f) => !f.ids && Array.isArray(f['#x']) && f['#x'].length > 0 && f['#x'].every((x) => x === LIVENESS_WORD))

/** The OK-false reason for an event filed under an address that is not a
 *  signature, else null. The drained word takes only the broker's ask and
 *  cancel, which are ephemeral: never stored, only routed in-zone. */
function addressRefusal(evt) {
  for (const tag of evt.tags) {
    if (tag[0] !== 'x') continue
    const x = String(tag[1] ?? '')
    if (HEX64.test(x)) continue
    if (ROOM_SCOPED_WORDS.has(x) && DRAIN_KINDS.has(evt.kind)) continue
    return 'restricted: an event is filed under a 64-hex signature (x)'
  }
  return null
}

/** How many addresses a connection's live subscriptions name, but `subId`'s. */
function liveAddressCount(client, subId) {
  let n = 0
  for (const [id, route] of client.routes) if (id !== subId) n += route.xs.size + route.ids.size
  return n
}

// ── who is in which room, for the drained word ──────────────────────────────
//
// A connection is in the zone of its own newest {alive} beacon, published ON
// THAT CONNECTION, while that beacon is unexpired — ONE zone, the newest
// replacing the last, so a client that moved rooms and lost its {left} is
// never in both. Nothing else places a connection in a room: not the keys
// that have spoken on it (any signed event can be REPLAYED by anyone, so a
// stranger replaying a member's public note would have joined that member's
// room), and never its subscriptions (anyone can subscribe anywhere). Only a
// signed {alive} at the room's lifecycle sig, which needs room + secret.
//
// An ask on the word from a connection in no zone yet is HELD — at most 16
// per connection, for at most 3 s — and routed the moment that connection
// beacons. That covers both a first join (the ask is signed a moment before
// the beacon) and an older build's reopen (it flushes its queued asks before
// it beacons again). Nothing waits on the hold: the asker's own timeout runs
// as before.
const LIFECYCLE_DEFAULT_TTL = 120  // seconds an {alive} with no expiration counts
const HELD_ASKS_MAX = 16
const HELD_ASK_MS = 3_000

/** The lifecycle zones a connection is in (see above): its own beacon's, or none. */
function zonesOf(client, nowSec) {
  const own = client.drainZone
  return own && own.exp > nowSec ? [own.x] : []
}

const isDrainAsk = (evt) => DRAIN_KINDS.has(evt.kind) && evt.tags.some((t) => t[0] === 'x' && ROOM_SCOPED_WORDS.has(t[1]))

/** Hold an ask until its connection beacons (oldest dropped past the cap). */
function holdAsk(client, evt) {
  client.heldAsks.push({ evt, at: Date.now() })
  if (client.heldAsks.length > HELD_ASKS_MAX) client.heldAsks.shift()
}

/** The connection is in a zone now: route what it asked meanwhile. */
function releaseHeldAsks(client) {
  if (client.heldAsks.length === 0) return
  const held = client.heldAsks
  client.heldAsks = []
  const cutoff = Date.now() - HELD_ASK_MS
  for (const { evt, at } of held) if (at >= cutoff) broadcast(evt, client)
}

// ── subscription routing ─────────────────────────────────────────────────────
//
// Every subscription names its addresses (the gate above), so live fan-out is
// routed by them: an event is offered only to the subscriptions that named one
// of its `x` values or its id, never to every subscription of every
// connection. Cost per event is the number of listeners at that address, not
// the number of listeners on the relay. There is no catch-all.

const subsByX = new Map()   // x value → Set<{ client, subId }>
const subsById = new Map()  // event id → Set<{ client, subId }>

/** The routing keys of a filter set: each filter's exact ids, else its `#x`. */
function routesOf(filters) {
  const xs = new Set()
  const ids = new Set()
  for (const f of filters) {
    if (Array.isArray(f.ids) && f.ids.length) for (const id of f.ids) ids.add(id)
    else for (const x of f['#x']) xs.add(x)
  }
  return { xs, ids }
}

function routeSubscription(client, subId, filters) {
  unrouteSubscription(client, subId)
  const entry = { client, subId }
  const { xs, ids } = routesOf(filters)
  for (const x of xs) indexAdd(subsByX, x, entry)
  for (const id of ids) indexAdd(subsById, id, entry)
  client.routes.set(subId, { entry, xs, ids })
}

function unrouteSubscription(client, subId) {
  const route = client.routes.get(subId)
  if (!route) return
  client.routes.delete(subId)
  for (const x of route.xs) indexDrop(subsByX, x, route.entry)
  for (const id of route.ids) indexDrop(subsById, id, route.entry)
}

/** Fan an event out to the subscriptions at its addresses. `source` is the
 *  connection it came from (never echoed), or null for one the relay made. A
 *  room-scoped word reaches only subscribers in a zone `source` is in. */
function broadcast(evt, source) {
  const candidates = new Set()
  let sourceZones = null
  const nowSec = Math.floor(Date.now() / 1000)
  for (const tag of evt.tags || []) {
    if (!Array.isArray(tag) || tag[0] !== 'x') continue
    const value = String(tag[1])
    const set = subsByX.get(value)
    if (!set) continue
    if (!ROOM_SCOPED_WORDS.has(value)) { for (const entry of set) candidates.add(entry); continue }
    sourceZones ??= source ? zonesOf(source, nowSec) : []
    if (sourceZones.length === 0) continue
    for (const entry of set) if (zonesOf(entry.client, nowSec).some((x) => sourceZones.includes(x))) candidates.add(entry)
  }
  for (const entry of subsById.get(evt.id) ?? []) candidates.add(entry)
  for (const { client: c, subId } of candidates) {
    if (c === source) continue
    if (c.ws.readyState !== 1) continue
    if (authRequired && !c.authed) continue
    const filters = c.subs.get(subId)
    if (filters && matchesAny(filters, evt)) {
      try { c.ws.send(JSON.stringify(['EVENT', subId, evt])) } catch {}
    }
  }
}

function send(ws, msg) {
  if (ws.readyState === 1) try { ws.send(JSON.stringify(msg)) } catch {}
}

// ── swarm lifecycle last-will (server-side LWT) ───────────────────────────────
//
// The swarm's presence protocol publishes a parameterized-replaceable
// "lifecycle" event (kind 30206) on a shared per-zone channel:
//   { alive: true }  — a periodic liveness beacon (NIP-40 expiry)
//   { left:  true }  — an explicit tombstone on graceful leave
// Receivers drop ALL of a participant's witnessed tiles on {left:true}.
//
// A tab that crashes / is killed can't send its own tombstone (a WebSocket
// send during unload usually doesn't flush). This is the classic MQTT
// Last-Will case, and the fix is the same: the SERVER emits the tombstone
// when the socket dies. We remember the last {alive} beacon each connection
// published (x-tag = zone channel sig, d-tag = pubkey) and, on disconnect,
// synthesize + store + broadcast a {left:true} tombstone with created_at =
// now — guaranteed newer than the beacon, so NIP-33 eviction replaces it
// and every member drops the departed peer instantly instead of waiting out
// the ~90s beacon expiry.
//
// The synthesized event is UNSIGNED: the relay can't sign as the user, and a
// fresh created_at is required for correct eviction (a pre-signed will would
// carry a stale timestamp and lose to its own newer beacon). The swarm mesh
// client trusts relay delivery and does not re-verify; a lifecycle tombstone
// can only REMOVE a peer's tiles (never inject content), and a relay can
// already drop a peer's events, so this grants it no new power. If a client
// is ever hardened to verify signatures on receive, switch to a client-
// registered pre-signed WILL that is re-signed on every beacon.
//
// A DEAD SOCKET IS NOT A DEPARTED PARTICIPANT. A reload, a wifi→cellular
// hop, a NAT rebind or a tunnel blip all kill a socket while the person is
// still there, and a will fired at once took their tiles from the whole room
// for the length of their reconnect. So a will WAITS (WILL_GRACE_MS) and is
// cancelled by an {alive}/{left} on the same slot, or by any verified EVENT
// on a connection that has itself beaconed that slot. A will belongs to the
// connections that announced themselves alive IN THAT SLOT, never to every
// connection the key has spoken on: a second tab that shares the key but
// never joined (it may hold a socket for other features) is not the
// participant, and taking its word as theirs kept a closed joined tab's will
// from ever firing. Another open connection that beaconed the slot inherits
// the will instead (willHeir): it fires when that one dies. The grace delays
// only eviction, never seeing.
const LIFECYCLE_KIND = 30206
const LIFECYCLE_WILL_TTL = 300  // seconds the synthesized tombstone lingers for late joiners
const WILL_GRACE_MS = 15_000
const pendingWills = new Map()  // x\0d → { x, d, pubkey, timer }

function lifecycleInfo(evt) {
  const tags = Array.isArray(evt.tags) ? evt.tags : []
  const x = tags.find((t) => Array.isArray(t) && t[0] === 'x')?.[1]
  const d = tags.find((t) => Array.isArray(t) && t[0] === 'd')?.[1]
  if (!x || !d) return null
  let left = false
  try { const c = JSON.parse(evt.content || '{}'); left = !!(c && c.left === true) } catch {}
  return { x: String(x), d: String(d), pubkey: String(evt.pubkey || ''), left }
}

// Arm (or disarm) a connection's last-will from its lifecycle events.
// {alive} arms the will; an explicit {left} disarms it (the client left
// gracefully — no need for the server to fire a duplicate on close).
function trackLifecycle(client, evt) {
  const info = lifecycleInfo(evt)
  if (!info || !info.pubkey) return
  const key = info.x + '\0' + info.d
  cancelWill(key)
  const live = participants.get(info.pubkey)
  if (info.left) {
    client.lifecycle.delete(key); client.beaconed.delete(key); live?.xs.delete(info.x)
    if (client.drainZone?.x === info.x) client.drainZone = null
    return
  }
  client.beaconed.add(key)
  live?.xs.add(info.x)
  client.lifecycle.set(key, { x: info.x, d: info.d, pubkey: info.pubkey })
  // The drained word's zone: this connection's newest {alive}, and only it.
  if (HEX64.test(info.x)) {
    client.drainZone = { x: info.x, exp: expirationOf(evt) || (Number(evt.created_at) + LIFECYCLE_DEFAULT_TTL) }
    releaseHeldAsks(client)
  }
  // The participant is alive on THIS connection, so any will another
  // connection still holds for the same slot is stale — a refreshed tab
  // whose old socket hasn't been reaped yet. Left armed, it fires up to a
  // ping cycle later with created_at = now, newer than the returner's
  // fresh beacon and layers, and every member drops them as departed.
  for (const other of clients) if (other !== client) other.lifecycle?.delete(key)
}

function computeEventId(evt) {
  // NIP-01 id: sha256 of the canonical serialization.
  const serial = JSON.stringify([0, evt.pubkey, evt.created_at, evt.kind, evt.tags, evt.content])
  return sha256Hex(Buffer.from(serial, 'utf8'))
}

function synthTombstone(xSig, dTag, pubkey, nowSec) {
  const tags = [['x', xSig], ['d', dTag], ['expiration', String(nowSec + LIFECYCLE_WILL_TTL)]]
  const content = JSON.stringify({ left: true })
  const evt = { pubkey, created_at: nowSec, kind: LIFECYCLE_KIND, tags, content }
  evt.id = computeEventId(evt)
  evt.sig = ''  // relay-synthesized last-will (see comment above)
  return evt
}

/** An open connection other than `except` that beaconed this slot (x\0d). */
function willHeir(key, except) {
  for (const c of clients) if (c !== except && !c.closed && c.ws.readyState === 1 && c.beaconed.has(key)) return c
  return null
}

// A dying connection's wills, one per zone it beaconed in: each goes to an
// heir if another open connection beaconed the same slot, otherwise it waits
// out the grace.
function armWills(client) {
  if (!client.lifecycle || client.lifecycle.size === 0) return
  for (const [key, will] of client.lifecycle) {
    const heir = willHeir(key, client)
    if (heir) { if (!heir.lifecycle.has(key)) heir.lifecycle.set(key, will); continue }
    const held = pendingWills.get(key)
    if (held) clearTimeout(held.timer)
    pendingWills.set(key, { ...will, timer: setTimeout(() => fireWill(key), WILL_GRACE_MS) })
  }
  client.lifecycle.clear()
}

// The grace ran out with no word from the key: tombstone it for everyone.
// created_at is the FIRING time — newer than any beacon the key sent.
function fireWill(key) {
  const will = pendingWills.get(key)
  if (!will) return
  pendingWills.delete(key)
  const heir = willHeir(key, null)
  if (heir) { if (!heir.lifecycle.has(key)) heir.lifecycle.set(key, { x: will.x, d: will.d, pubkey: will.pubkey }); return }
  const tomb = synthTombstone(will.x, will.d, will.pubkey, Math.floor(Date.now() / 1000))
  try { insertEvent(tomb) } catch {}
  broadcast(tomb, null)
  census.willsFired++
}

function cancelWill(key) {
  const will = pendingWills.get(key)
  if (!will) return
  clearTimeout(will.timer)
  pendingWills.delete(key)
  census.willsCancelled++
}

// One disconnect path for both 'close' and 'error' — guarded so the will
// is armed at most once.
function handleDisconnect(client) {
  if (client.closed) return
  client.closed = true
  for (const subId of [...client.routes.keys()]) unrouteSubscription(client, subId)
  try { armWills(client) } catch {}
  clients.delete(client)
}

// NIP-01: every EVENT gets an OK, every refused REQ gets a CLOSED, and a
// NOTICE is only for what cannot be tied to either. Reasons carry the
// standard machine-readable prefix (duplicate:, rate-limited:, invalid:,
// error:, auth-required:) so clients act on them instead of reading prose.
function handleMessage(client, raw) {
  if (typeof raw !== 'string') return
  if (Buffer.byteLength(raw, 'utf8') > cfg.maxEventSize) {
    // Too big to parse in good conscience — but an EVENT still deserves its
    // OK, so pull the id out of the raw text when it is one.
    const id = raw.startsWith('["EVENT"') ? raw.match(/"id"\s*:\s*"([0-9a-f]{64})"/)?.[1] : undefined
    if (id) send(client.ws, ['OK', id, false, `invalid: message exceeds ${cfg.maxEventSize} bytes`])
    else send(client.ws, ['NOTICE', `error: message exceeds ${cfg.maxEventSize} bytes`])
    return
  }

  let msg
  try { msg = JSON.parse(raw) } catch { send(client.ws, ['NOTICE', 'error: invalid JSON']); return }
  if (!Array.isArray(msg) || msg.length < 1) { send(client.ws, ['NOTICE', 'error: invalid message']); return }

  const type = msg[0]

  // Never charged, never refused: a CLOSE the relay drops is a subscription
  // the client has already forgotten, still costing the broadcast loop.
  if (type === 'CLOSE') {
    client.subs.delete(msg[1])
    unrouteSubscription(client, String(msg[1] ?? ''))
    return
  }

  if (type === 'EVENT' || type === 'REQ') {
    if (!takeToken(client)) {
      if (type === 'EVENT') { census.refusedEvents++; send(client.ws, ['OK', msg[1]?.id ?? '', false, 'rate-limited: slow down']) }
      else { census.refusedReqs++; send(client.ws, ['CLOSED', String(msg[1] ?? ''), 'rate-limited: slow down']) }
      return
    }
  }

  if (type === 'AUTH') {
    if (!authRequired) return
    const ok = verifyAuth(msg[1], client.challenge)
    if (ok) {
      client.authed = true
      client.pubkey = msg[1].pubkey
      send(client.ws, ['OK', msg[1].id, true, ''])
    } else {
      send(client.ws, ['OK', msg[1]?.id ?? '', false, 'auth-required: verification failed'])
    }
    return
  }

  if (authRequired && !client.authed) {
    if (type === 'EVENT') { send(client.ws, ['OK', msg[1]?.id ?? '', false, 'auth-required: please authenticate']); return }
    if (type === 'REQ') { send(client.ws, ['CLOSED', String(msg[1] ?? ''), 'auth-required: please authenticate']); return }
  }

  if (type === 'EVENT') {
    const evt = msg[1]
    const shape = eventShapeError(evt)
    if (shape) { send(client.ws, ['OK', HEX64.test(String(evt?.id)) ? evt.id : '', false, shape]); return }
    const unaddressed = addressRefusal(evt)
    if (unaddressed) { census.unaddressed++; send(client.ws, ['OK', evt.id, false, unaddressed]); return }
    try { if (!verifyEvent(evt)) { send(client.ws, ['OK', evt.id, false, 'invalid: bad signature']); return } }
    catch { send(client.ws, ['OK', evt.id, false, 'invalid: verification error']); return }
    // A verified EVENT is the key speaking, live, on this relay: it may upload
    // to the swarm's host (markLive). It speaks for a slot's pending will only
    // on a connection that beaconed that slot — the participant, still here on
    // a socket that announced it (see WILL_GRACE_MS).
    markLive(evt.pubkey)
    if (pendingWills.size) for (const key of client.beaconed) cancelWill(key)

    const verdict = insertEvent(evt)
    // Arm/disarm this connection's last-will from lifecycle beacons so we
    // can tombstone it server-side if the socket dies without a graceful
    // {left} (tab crash / kill — see armWills). A duplicate counts too: the
    // same beacon from a NEW connection (a refresh inside the same second)
    // still says the participant lives here now.
    if (Number(evt.kind) === LIFECYCLE_KIND) trackLifecycle(client, evt)
    if (verdict === 'duplicate') { send(client.ws, ['OK', evt.id, true, 'duplicate: already have this event']); return }
    send(client.ws, ['OK', evt.id, true, ''])
    // A stale replaceable is accepted (the publisher did nothing wrong) but
    // not fanned out: subscribers already hold the newer slot. An ask on the
    // drained word from a connection in no room yet waits for its beacon.
    if (verdict === 'stale') return
    if (isDrainAsk(evt) && zonesOf(client, Math.floor(Date.now() / 1000)).length === 0) holdAsk(client, evt)
    else broadcast(evt, client)
    return
  }

  if (type === 'REQ') {
    const subId = msg[1]
    if (typeof subId !== 'string' || !subId || subId.length > MAX_SUBID_LENGTH) { send(client.ws, ['CLOSED', String(subId ?? ''), `invalid: subscription id must be 1–${MAX_SUBID_LENGTH} characters`]); return }

    const filters = msg.slice(2)
    if (filters.length === 0 || !filters.every((f) => f && typeof f === 'object' && !Array.isArray(f))) { send(client.ws, ['CLOSED', subId, 'invalid: a REQ needs at least one filter object']); return }

    // A REQ replaces any subscription of the same id (NIP-01), so a refused
    // or probing REQ also ends whatever that id was listening to.
    const probe = isLivenessProbe(filters)
    const refusal = probe ? null : filterRefusal(filters)
    if (probe || refusal) {
      client.subs.delete(subId)
      unrouteSubscription(client, subId)
      if (probe) { send(client.ws, ['EOSE', subId]); return }
      census.unaddressed++
      send(client.ws, ['CLOSED', subId, refusal])
      return
    }

    if (client.subs.size >= MAX_SUBS_PER_CLIENT && !client.subs.has(subId)) {
      // Counted in the minute line — a silent refusal here is a deaf
      // participant who cannot tell why.
      census.refusedSubs++
      send(client.ws, ['CLOSED', subId, `error: too many subscriptions (max ${MAX_SUBS_PER_CLIENT})`]); return
    }
    const { xs: wantXs, ids: wantIds } = routesOf(filters)
    if (liveAddressCount(client, subId) + wantXs.size + wantIds.size > MAX_ADDRESSES_PER_CONNECTION) {
      census.refusedSubs++
      client.subs.delete(subId)
      unrouteSubscription(client, subId)
      send(client.ws, ['CLOSED', subId, `error: too many addresses (max ${MAX_ADDRESSES_PER_CONNECTION} live on one connection)`]); return
    }
    client.subs.set(subId, filters)
    routeSubscription(client, subId, filters)

    // limit:0 asks for nothing stored — a live-only listen. Answer EOSE
    // without reading the store.
    if (filters.every((f) => f.limit === 0)) { send(client.ws, ['EOSE', subId]); return }

    const events = queryEvents(filters)
    for (const evt of events) send(client.ws, ['EVENT', subId, evt])
    send(client.ws, ['EOSE', subId])
    return
  }
}

// ── http + websocket server ──────────────────────────────────────────────────

const relayInfo = {
  name: 'hypercomb-relay',
  description: 'Minimal Nostr relay for Hypercomb swarms',
  supported_nips: [1, 11, 33, 40, ...(authRequired ? [42] : [])],
  software: 'https://github.com/nicepkg/hypercomb',
  version: '0.1.0',
  limitation: {
    max_message_length: cfg.maxEventSize,
    max_subscriptions: MAX_SUBS_PER_CLIENT,
    max_subid_length: MAX_SUBID_LENGTH,
    max_limit: MAX_LIMIT,
    max_filters: MAX_FILTERS_PER_REQ,
    // Every read names a signature address (`#x`) or exact ids; any other
    // filter is CLOSED `restricted:` (the address gate). Nothing is listed.
    addressed_reads: true,
    max_addresses: MAX_ADDRESSES_PER_REQ,
    restricted_writes: true,
    // Whether a WebSocket needs the current access code (`hc-access.<code>`).
    access_code: !!cfg.accessCodes,
    auth_required: authRequired,
    // Whether PUT /<sig> takes a live participant's bytes: 'all', 'zones', or
    // false (writers only). A pre-meeting curl reads it; clients never
    // pre-check — the first PUT's answer is the policy.
    participant_uploads: participantMode,
  }
}

// ── content-host (HTTP file serving) ─────────────────────────────────────────
//
// Per the "host is a verb" doctrine (project_domain_as_identity.md):
// a host captures + packages + SERVES. This is the serve half — the
// relay's http handler also returns sig-addressed content blobs at
// well-known paths so peers can HTTPS-GET them directly without
// going through the mesh broker.
//
// Path validation:
//  - Accepted paths: anything that resolves inside cfg.contentDir
//  - Rejected: ../, absolute paths, anything escaping the content root
//  - This is a content store, not a filesystem — only files matching
//    the standard hypercomb layout (__bees__/, __dependencies__/,
//    __layers__/, __resources__/, manifest.json) are intended targets,
//    but the resolution check below is generic — anything inside the
//    contentDir is fair game. Operators control what's there.

function getContentType(path) {
  const ext = extname(path).toLowerCase()
  if (ext === '.js')   return 'application/javascript; charset=utf-8'
  if (ext === '.json') return 'application/json; charset=utf-8'
  if (ext === '.css')  return 'text/css; charset=utf-8'
  if (ext === '.html') return 'text/html; charset=utf-8'
  if (ext === '.svg')  return 'image/svg+xml'
  if (ext === '.png')  return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.ico')  return 'image/x-icon'
  if (ext === '.woff2') return 'font/woff2'
  if (ext === '.woff') return 'font/woff'
  if (ext === '.ttf')  return 'font/ttf'
  if (ext === '.wasm') return 'application/wasm'
  if (ext === '.map')  return 'application/json; charset=utf-8'
  return 'application/octet-stream'
}

// Flat sig resolution (protocol-spec §21.10): a bare `/<64-hex>` resolves
// to whichever pool holds it — no type prefix, no extension. The pool the
// sig is found in supplies the Content-Type. This is the canonical read
// endpoint: `https://<host>/<sig>`. Knowing the address is decoupled from
// knowing the type — the consumer already knows the type from the
// referring layer; the host resolves the bytes by probing its pools.
//
// Probe order is the membership oracle; first hit wins. A sig lives in
// exactly one pool (its bytes are one thing), so order only decides which
// stat lands first. Returns { path, contentType } or null (→ 404).
function resolveFlatSig(sig) {
  const root = resolve(cfg.contentDir)
  const probes = [
    // Flat heap — canonical. One bucket, sig-named files at the content
    // root, no extensions: the consumer knows the type (it holds the
    // referring layer), so the wire type is opaque bytes. New writes
    // (PUT /<sig>) land here; the typed pools below are the legacy
    // layout, kept as fallback during the migration.
    [join(root, sig), 'application/octet-stream'],
    [join(root, '__layers__', sig + '.json'), 'application/json; charset=utf-8'],
    [join(root, '__bees__', sig + '.js'), 'application/javascript; charset=utf-8'],
    [join(root, '__dependencies__', sig + '.js'), 'application/javascript; charset=utf-8'],
    [join(root, '__resources__', sig), 'application/octet-stream'],
  ]
  for (const [p, ct] of probes) {
    try { if (statSync(p).isFile()) return { path: p, contentType: ct } } catch { /* not in this pool */ }
  }
  return null
}

const receiptIndex = new ReceiptIndex(cfg.contentDir, resolveFlatSig)

// ── GET/PUT /<sign('hive:indexes')>/<pubkey> — the signed index a publisher owns here
//
// Addressed by signature only (jwize 2026-09-25): the index is the member of
// the pool sign('hive:indexes') named by its publisher's key. No named route.
//
// A HOST THAT CARRIES BYTES BUT CANNOT SAY WHO SIGNED THEM IS NOT A HOST.
// Every atom on this machine is content-addressed and verifiable, but the one
// question replication cannot answer from bytes alone is "whose build is
// this" — and that answer lives in a publisher's signed index (kind 30564).
// Until now only the Cloudflare worker served it, so a participant carrying
// this relay alone could fetch every byte of a package and still be refused
// at the activation gate with nowhere to look (observed 2026-09-20:
// `jwize.com/hive/<pubkey>` 404 while `jwize.com/<sig>` answered 200).
//
// The index is an ordinary parameterized-replaceable event, so the relay
// already knows how to keep exactly one per publisher — `insertEvent` does the
// eviction and the staleness compare. This route is only the HTTP face of it.
//
// Auth mirrors the worker's: NIP-98 proves the CALLER, the body event proves
// the OWNER, and a PUT is admitted only when both are the SAME key. A relay
// operator's `--writers` list does not enter into it — a publisher's own index
// is theirs, and nobody else may move it.
const HIVE_INDEX_KIND = 30564

const HIVE_INDEXES_POOL = sha256Hex(Buffer.from('hive:indexes', 'utf8'))

// Addresses no atom may take (tryWriteContent): the floor's pools, the host's
// packages and this pool of indexes. Each one's preimage is public.
const RESERVED_ADDRESSES = new Set([...PUBLIC_POOL_ADDRESSES, HOST_PACKAGES_POOL, HIVE_INDEXES_POOL])

function tryServeHiveIndex(req, res) {
  const path = (req.url || '').split('?')[0]
  const match = path.match(/^\/([0-9a-f]{64})\/([0-9a-f]{64})$/)
  // DRAIN ROUTE: /hive/<pubkey>, the retired name, answers the same index —
  // installs already in use still read and publish through it. Retire it once
  // nothing in use calls it (jwize 2026-09-25).
  const drain = path.match(/^\/hive\/([0-9a-f]{64})$/)
  if (!drain && (!match || match[1] !== HIVE_INDEXES_POOL)) return false
  const pubkey = drain ? drain[1] : match[2]

  if (req.method === 'GET' || req.method === 'HEAD') {
    const row = newestEvent(pubkey, HIVE_INDEX_KIND)
    if (!row) { respondText(res, 404, 'no index for this publisher'); return true }
    const body = JSON.stringify({
      kind: row.kind,
      created_at: row.created_at,
      tags: row.tags,
      content: row.content,
      pubkey: row.pubkey,
      id: row.id,
      sig: row.sig,
    })
    // NEVER CACHED. The whole point of an index is that it moves; a reader
    // holding a stale one is told about a build that is no longer offered.
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    })
    res.end(req.method === 'HEAD' ? undefined : body)
    return true
  }

  if (req.method !== 'PUT') return false

  readRequestBody(req, res, 64 * 1024, body => {
    // THE ONLY AUTHORIZED WRITER OF AN INDEX IS ITS OWNER. Passing the
    // address's own key as the writer set says precisely that, and reuses
    // every other NIP-98 check (freshness window, method, url and payload
    // hash) rather than re-implementing them here. The operator's --writers
    // list governs the content heap; it has no say over whose index this is.
    const auth = verifyNip98(req, new Set([pubkey]), { devOpen: false, payload: body })
    if (!auth.ok) { respondText(res, 401, auth.reason); return }
    let evt
    try { evt = JSON.parse(body.toString('utf8')) } catch { respondText(res, 400, 'not an event'); return }
    if (Number(evt?.kind) !== HIVE_INDEX_KIND) { respondText(res, 400, 'not a hive index'); return }
    // An index is read here, by its publisher's key, and nowhere else: one
    // that names a mesh address (`x`) would be filed under it and replayed to
    // that room's REQs, a way onto the mesh past every WebSocket rule.
    if (Array.isArray(evt.tags) && evt.tags.some((t) => Array.isArray(t) && t[0] === 'x')) { respondText(res, 400, 'an index carries no x tag'); return }
    const owner = String(evt?.pubkey ?? '').toLowerCase()
    // The caller, the body and the address must be one key. Any disagreement
    // is somebody moving an index that is not theirs.
    if (owner !== pubkey || auth.pubkey !== pubkey) { respondText(res, 403, 'an index is moved only by its own publisher'); return }
    if (!verifyEvent(evt)) { respondText(res, 400, 'signature does not verify'); return }
    try { insertEvent(evt) } catch (error) { respondText(res, 500, String(error?.message || error)); return }
    // insertEvent keeps the NEWER of the two, so read back what is actually
    // served rather than claiming the write landed.
    const now = newestEvent(pubkey, HIVE_INDEX_KIND)
    console.log(`[hive] index for ${pubkey.slice(0, 8)}… now at ${now?.created_at ?? 0}`)
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ ok: true, pubkey, created_at: now?.created_at ?? 0 }))
  })
  return true
}

/** Is this pool LISTED here? The floor always is (replicate.js
 *  PUBLIC_POOL_ADDRESSES); any other meaning only while an operator's signed
 *  index declares it in `listed` (host-listing.js). The floor answers without
 *  reading an index, so the addresses every follower asks cost nothing. The
 *  declared ones are read once per move of a writer's index (as profileSigs
 *  is) — every PUT asks this too, and each writer's index is parsed once per move. */
let declaredPools = { moves: -1, sigs: new Set() }
function listedPool(sig) {
  if (PUBLIC_POOL_ADDRESSES.has(sig)) return true
  if (declaredPools.moves !== writerIndexMoves) {
    const sigs = new Set()
    for (const pubkey of writers) {
      const row = newestEvent(pubkey, HIVE_INDEX_KIND)
      if (!row) continue
      let content
      try { content = JSON.parse(row.content) } catch { continue }
      for (const meaning of listedMeanings(content)) sigs.add(sha256Hex(Buffer.from(meaning, 'utf8')))
    }
    declaredPools = { moves: writerIndexMoves, sigs }
  }
  return declaredPools.sigs.has(sig)
}

// ── GET /.well-known/nostr.json — who each writer IS, at this host (NIP-05)
//
// The one standards-fixed named route: every Nostr client asks exactly this
// path, so it is not ours to retire (documentation/sealed-audiences.md, Names).
// Derived from the keys this relay already serves — its writers — and never a
// second list to keep. A writer's name is the one its own signed profile
// carries: its index names the profile atom as roots['nostr:profile'], and the
// atom is the complete signed kind-0 event. `_` is the writer the operator
// DECLARED (--primary); the writer list is unordered, so none is `_` otherwise.
//
// WRITERS ONLY. Any key may PUT its own index here, so the held indexes are
// never enumerated: a stranger's profile is theirs to sign, not this host's to
// vouch for.
//
// PER REQUEST HOST. Only a declared --domain vouches; any other name that
// reaches this relay (content.<domain>, a name somebody pointed here) answers
// `{ names: {} }`, as the worker's relay face and unbound hosts do.

const PROFILE_ROOT = 'nostr:profile'
const PROFILE_MAX_BYTES = 64 * 1024
// atom sig → { pubkey, name } of an atom whose bytes hashed to its sig. Those
// bytes can never change, so neither can the verdict on them. A miss (not held
// yet) is never remembered — the atom may still arrive.
const profileVerdicts = new Map()

function profileVerdict(sig) {
  const held = profileVerdicts.get(sig)
  if (held) return held
  const hit = resolveFlatSig(sig)
  if (!hit) return null
  let bytes
  try {
    if (statSync(hit.path).size > PROFILE_MAX_BYTES) return null
    bytes = readFileSync(hit.path)
  } catch { return null }
  if (sha256Hex(bytes) !== sig) return null
  let verdict = { pubkey: null, name: null }
  try {
    const event = JSON.parse(bytes.toString('utf8'))
    if (event && typeof event === 'object' && event.kind === 0 && verifyEvent(event)) {
      let profile = null
      try { profile = JSON.parse(event.content) } catch { /* a profile with no readable content names nobody */ }
      verdict = { pubkey: event.pubkey, name: profile && typeof profile === 'object' ? nip05Name(profile.name) : null }
    }
  } catch { /* not an event: names nobody */ }
  if (profileVerdicts.size >= 1024) profileVerdicts.clear()
  profileVerdicts.set(sig, verdict)
  return verdict
}

/** The profile atom sig a writer's newest index names, or null. */
function profileRootOf(pubkey) {
  try {
    const row = newestEvent(pubkey, HIVE_INDEX_KIND)
    if (!row || typeof row.content !== 'string') return null
    let content
    try { content = JSON.parse(row.content) } catch { return null }
    const roots = content && typeof content === 'object' ? content.roots : null
    const sig = roots && typeof roots === 'object' ? roots[PROFILE_ROOT] : null
    return typeof sig === 'string' && HEX64.test(sig) ? sig : null
  } catch { return null }
}

// writer → the profile sig its index names, as of `writerIndexMoves`. The
// store scan and the index parse run once per move of a writer's index, never
// per request: this route is public, uncached and asked by every NIP-05 client.
let profileRoots = { moves: -1, sigs: new Map() }

function profileSigs() {
  if (profileRoots.moves !== writerIndexMoves) {
    const sigs = new Map()
    for (const pubkey of writers) sigs.set(pubkey, profileRootOf(pubkey))
    profileRoots = { moves: writerIndexMoves, sigs }
  }
  return profileRoots.sigs
}

/** The name a writer's own signed profile carries, or undefined. */
function profileName(pubkey, sig) {
  if (!sig) return undefined
  const verdict = profileVerdict(sig)
  // Signed by the key whose index named it, or it names nobody.
  return verdict && verdict.pubkey === pubkey && verdict.name ? verdict.name : undefined
}

function tryServeNip05(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  const url = String(req.url || '')
  const at = url.indexOf('?')
  if ((at < 0 ? url : url.slice(0, at)) !== '/.well-known/nostr.json') return false
  let asked = null
  try { asked = new URLSearchParams(at < 0 ? '' : url.slice(at + 1)).get('name') } catch { /* no filter */ }
  const host = normalizeDomain(req.headers.host)
  const sigs = host !== null && nip05Domains.has(host) ? profileSigs() : null
  const entries = sigs ? [...writers].map(pubkey => ({ pubkey, primary: pubkey === nip05Primary, names: [profileName(pubkey, sigs.get(pubkey))] })) : []
  const body = Buffer.from(JSON.stringify(nostrJson(entries, asked)), 'utf8')
  // NEVER CACHED: a writer's profile moves with its index.
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': String(body.length),
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  })
  res.end(req.method === 'HEAD' ? undefined : body)
  return true
}

function tryServeContent(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') return false

  // CORS preflight — relays serve from <op>.domain, askers come from
  // other origins (hypercomb.io, alice.dev, etc.); blanket-permit — but a
  // door is told only the reads it may make, since every write refuses it.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': fromSandboxDoor(req) ? 'GET, HEAD, OPTIONS' : 'GET, HEAD, PUT, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, If-None-Match',
      'Access-Control-Max-Age': '86400',
    })
    res.end()
    return true
  }

  // Strip query string + decode
  let urlPath
  try { urlPath = decodeURIComponent((req.url || '').split('?')[0]) } catch { return false }
  if (!urlPath || urlPath === '/') return false
  // The pure host uses /content/<address>; older relay clients use /<address>.
  // Both names read the same heap and the same public pool membership.
  if (urlPath.startsWith('/content/')) urlPath = urlPath.slice('/content'.length)
  // Receipt documents contain private, capability-like signatures. They are
  // reachable only through authenticated /receipts, never through the legacy
  // generic content-directory fallback below.
  if (urlPath === '/.receipts' || urlPath.startsWith('/.receipts/')) return false
  // ONE SPELLING PER PATH. Every gate below reads the path as written, while
  // the file is opened by the OS — which drops '.', resolves '..', collapses
  // '//' and, on Windows, ignores case. So /./.receipts/<pk>.json, //<bag>/…
  // and /<BAG>/00000001 used to walk past the gates to the very bytes they
  // guard. Only the canonical spelling is read; any other answers exactly as
  // an absent path does.
  if (!isCanonicalPath(urlPath) && !/^\/[0-9a-f]{64}\/$/.test(urlPath)) return false

  // ── the directory branch (documentation/pools-across-hosts.md) ──────────
  //
  // A POOL IS A DIRECTORY, AND A DIRECTORY IS A SET. `/<sig>` names a file —
  // one closure, forever, cacheable for a year. `/<sig>/` names a set, and
  // sets grow. Without this branch a host cannot answer "what do you carry
  // under this meaning" at all, which is why discovery kept reaching for a
  // named index file next to the content instead: `packages.json` was never a
  // second dialect, only a relay that could not readdir.
  //
  // The listing is entry NAMES and nothing else — never sizes, never
  // contents, nothing that could decide what a client installs. It is
  // `readdir` on the wire, not a document: newline-separated, so a static
  // host's ship can write byte-identical bytes at the same address.
  const dirMatch = urlPath.match(/^\/([0-9a-f]{64})\/$/)
  if (dirMatch) {
    // Only a LISTED pool is listed (listedPool). Any other directory, such as
    // a history bag or a molecule pool, answers "not held", the exact answer
    // an absent pool gets, so the 404 reveals nothing.
    if (!listedPool(dirMatch[1])) { respondText(res, 404, 'pool not held'); return true }
    const dir = join(resolve(cfg.contentDir), dirMatch[1])
    let names
    try {
      if (!statSync(dir).isDirectory()) return false
      // `index.html` is the STATIC ship's rendering of this very listing —
      // the directory describing itself so a bucket with no readdir can answer
      // the same URL. It is not a member, on either host shape.
      names = readdirSync(dir).filter(n => n !== 'index.html' && !n.startsWith('.')).sort()
    } catch {
      // A PUBLIC pool this relay holds nothing under is an EMPTY listing, not
      // a 404: every follower derives the address and asks it, and a browser
      // prints every 404 to the console. The empty set is the true answer.
      names = []
    }
    const body = Buffer.from(names.join('\n'), 'utf8')
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': String(body.length),
      'Access-Control-Allow-Origin': '*',
      // A SET GROWS. The members are immutable; the membership is not.
      'Cache-Control': 'no-store',
      'Permissions-Policy': PERMISSIONS_POLICY,
    })
    if (req.method === 'HEAD') { res.end(); return true }
    res.end(body)
    return true
  }

  let resolved
  let contentType
  const sigMatch = urlPath.match(/^\/([0-9a-f]{64})$/)
  if (sigMatch) {
    // Flat sig endpoint: /<sig> → probe the pools (§21.10). A miss is a
    // clean 404 (NOT the liveness fallthrough) so an adopting client can
    // tell "host doesn't have it" from real content and try another host
    // / treat it as an egg. Never cached at all — the sig may arrive a
    // second later, and an edge that pinned the miss would hide it.
    const hit = resolveFlatSig(sigMatch[1])
    if (!hit) {
      // The framework-free bootstrap is signature-named too, but it belongs
      // to the shell payload rather than the writable participant heap.
      if (cfg.shellDir && existsSync(join(cfg.shellDir, sigMatch[1]))) return false
      respondText(res, 404, 'sig not held', { 'Cache-Control': 'no-store' })
      return true
    }
    resolved = hit.path
    contentType = hit.contentType
  } else {
    // Legacy typed path (/__bees__/<sig>.js, /__layers__/<sig>.json, …),
    // kept during the migration to bare-sig URLs. Resolve under
    // contentDir, then verify the result is still inside it.
    //
    // ANYTHING UNDER a directory that is not a listed pool (a history bag's
    // 00000000 marker, a molecule pool's entry, at any depth) is read exactly
    // as a path that does not exist — decided by the address alone, never by
    // looking: answering differently when the directory is there told anyone
    // which bags and pools this host holds. The listing is gated above, and a
    // guessable member name must not be a second way in.
    const head = urlPath.match(/^\/([0-9a-f]{64})\//)
    if (head && !listedPool(head[1])) return false
    resolved = resolve(cfg.contentDir, '.' + urlPath)
    const rootDir = resolve(cfg.contentDir)
    if (!resolved.startsWith(rootDir + sep) && resolved !== rootDir) return false
    let typedHit = false
    if (existsSync(resolved)) {
      try { typedHit = statSync(resolved).isFile() } catch { typedHit = false }
    }
    // THE FILE OPENED IS THE FILE NAMED. Windows also opens a file by its
    // 8.3 short name (RECEIP~1), by a stream suffix (<dir>::$INDEX_ALLOCATION),
    // in any case, and with trailing dots or spaces dropped — each a spelling
    // the gates above never saw. isCanonicalPath refuses the ones it can
    // name; this refuses the rest: the OS's own long, case-exact path for
    // what it opened must be exactly the path that was asked for.
    if (typedHit && !opensAsNamed(rootDir, urlPath, resolved)) return false
    if (typedHit) {
      contentType = getContentType(resolved)
    } else {
      // Typed-shape MISS → probe the flat heap by the basename's sig.
      // Host-sync pushes land flat at `/<sig>`, but deployed clients
      // still running pre-flat brokers ask `/__resources__/<sig>` etc.
      // The URL carries identity only — serve the bytes from whichever
      // layout holds them (the mirror of resolveFlatSig's typed
      // fallback). Non-sig paths keep falling through (landing page). Only
      // the legacy typed dirs and listed pools fall back — never an
      // arbitrary prefix, which would answer for any directory name at all.
      if (!/^\/__[a-z]+__\//.test(urlPath) && !head) return false
      const base = urlPath.split('/').pop() || ''
      const m = base.match(/^([0-9a-f]{64})(?:\.(?:js|json))?$/i)
      if (!m) return false
      const hit = resolveFlatSig(m[1].toLowerCase())
      if (!hit) return false
      resolved = hit.path
      contentType = hit.contentType
    }
  }

  try {
    // NEVER READ WHOLE ON THE LOOP. This loop also carries the meeting —
    // every EVENT's fan-out, every probe's EOSE — and the meeting's pictures
    // (up to 8 MB each, no edge cache on /<sig>) are served from here: a room
    // of phones fetching a sharer's four photos at once was 76 synchronous
    // multi-megabyte reads and every Buffer held until the slowest phone
    // drained it. A stat answers HEAD and the headers; the body streams.
    const st = statSync(resolved)
    if (!st.isFile()) return false
    // WHEN A HOST RECEIVED IT, from the filesystem rather than from anything
    // anyone published. A pool entry carries the package signature and nothing
    // about time; the fact that this file arrived on Tuesday is the transport's
    // own, not a claim in a document, and every static host (S3, Pages, nginx)
    // already answers with it. It is the last thing the manifest was carrying
    // for the browse list.
    const lastModified = st.mtime.toUTCString()
    // IMMUTABLE MEANS SIG-ADDRESSED, AND NOTHING ELSE. A signature names one
    // closure forever, so those bytes can be pinned for a year. A NAMED file
    // — manifest.json, packages.json — is the domain's mutable voice: the one
    // thing on this wire that changes at the same URL. Serving those with the
    // sig header (which is what the typed-path branch used to do to
    // everything) invites any intermediary to pin a year-old view of what a
    // host publishes, which reads exactly like a host that stopped shipping.
    const sigAddressed = /[a-f0-9]{64}/i.test(urlPath)
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': String(st.size),
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': sigAddressed ? 'public, max-age=31536000, immutable' : 'no-store',
      ...(lastModified ? { 'Last-Modified': lastModified } : {}),
      'Access-Control-Expose-Headers': 'Last-Modified',
      'Permissions-Policy': PERMISSIONS_POLICY,
    })
    if (req.method === 'HEAD') { res.end(); return true }
    createReadStream(resolved).on('error', () => res.destroy()).pipe(res)
    return true
  } catch {
    return false
  }
}

/** Is this decoded path in its one canonical spelling? No empty, '.' or '..'
 *  segment, no dot-file at any depth, no backslash or NUL, a signature
 *  segment only in lowercase (the OS folds case on Windows), and none of
 *  Windows' other ways to spell a name: ':' (a stream, `<dir>::$INDEX_ALLOCATION`),
 *  '~' (an 8.3 short name, `RECEIP~1`), or a trailing '.' or space (dropped
 *  by the OS, so `<bag>./00000001` opens `<bag>/00000001`). */
function isCanonicalPath(urlPath) {
  if (!urlPath.startsWith('/') || /[\\\0:~]/.test(urlPath)) return false
  for (const segment of urlPath.slice(1).split('/')) {
    if (segment === '' || segment.startsWith('.') || /[. ]$/.test(segment)) return false
    if (/^[0-9a-f]{64}$/i.test(segment) && segment !== segment.toLowerCase()) return false
  }
  return true
}

/** Does the file the OS opened for `urlPath` carry exactly that name? Its
 *  real path (long names, the case on disk, links followed) must be the
 *  content root's real path plus the asked segments, verbatim. Anything
 *  else — a short name, another case, a stream, a link out — is absent. */
function opensAsNamed(rootDir, urlPath, resolved) {
  try {
    const expected = join(realpathSync.native(rootDir), ...urlPath.slice(1).split('/'))
    return realpathSync.native(resolved) === expected
  } catch {
    return false
  }
}

function respondText(res, code, msg, headers = {}) {
  if (res.headersSent) return  // answered already (a stream error after the answer) — never a throw
  res.writeHead(code, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*', ...headers })
  res.end(msg)
}

// ── doors write nothing (documentation/module-sandbox.md) ───────────────────
//
// A sandbox door — `try-<change>.<zone>` — runs its publisher's package with
// full page power, so a request whose Origin is a door never writes here: a
// signed PUT or POST from it (the visitor's own key through NIP-07, or one the
// package minted) would move this host as if the visitor's hive had. Reads
// stay open. The label is the content worker's SANDBOX_LABEL_RE
// (blossom-worker/worker.js), on any zone.
const SANDBOX_LABEL_RE = /^try-[a-z0-9](?:[a-z0-9-]{0,55}[a-z0-9])?$/

// An opaque origin (`Origin: null` — a sandboxed frame or data: worker the
// package opens) counts as a door too; no writer of ours sends it. Writes made
// from the browser stop here; a signature replayed from elsewhere is the
// extension prompt's to refuse (see the content worker's fromSandboxDoor).
function fromSandboxDoor(req) {
  const origin = req.headers.origin
  if (origin === 'null') return true
  try { return SANDBOX_LABEL_RE.test(new URL(String(origin)).hostname.split('.')[0]) } catch { return false }
}

// ── content-host (HTTP write — the backup/push side) ─────────────────────────
//
// The push counterpart to tryServeContent. A PUT lands content into the
// sig pool so the host can serve it (and others adopt it). Two guards,
// independent (protocol-spec §21.12):
//   1. content-integrity — the target must be sig-addressed, and
//      sha256(body) MUST equal that sig. Bytes authenticate themselves;
//      a forged sig is computationally impossible. Idempotent: same sig
//      == same bytes.
//   2. writer-authorization — a NIP-98 signed event (Authorization:
//      Nostr <base64-event>) whose pubkey is in the allowed-writers set,
//      or — with --allow-participants — a participant live on this relay's
//      WebSocket (participantAllowed). Proves WHO without ever sending a
//      secret; the host holds only public keys.
//
// Reads stay open (tryServeContent); only writes are gated.

function verifyWriteAuth(req) {
  // DEV ONLY: bypass writer-auth (sha256(body)===sig is still enforced by the
  // caller, so content can't be forged — only the WHO check is skipped).
  return verifyNip98(req, writers, {
    devOpen: cfg.devOpenWrites,
    allow: pubkey => writers.has(pubkey) || participantAllowed(pubkey),
    skewSecs: ATOM_AUTH_SKEW_SECS,
  })
}

/** Land an atom so no reader ever sees part of it: staged beside its final
 *  name, then renamed over it in one step (a held atom is replaced by the
 *  same bytes, never removed first). Asynchronous end to end — the loop that
 *  carries the meeting's frames never waits on the disk. */
async function writeAtom(finalPath, bytes) {
  const partPath = join(dirname(finalPath), `.part-${basename(finalPath)}-${randomBytes(6).toString('hex')}`)
  await fsp.mkdir(dirname(finalPath), { recursive: true })
  try {
    await fsp.writeFile(partPath, bytes, { flag: 'wx' })
    await fsp.rename(partPath, finalPath)
  } finally {
    await fsp.rm(partPath, { force: true }).catch(() => {})
  }
}

const replicationJobs = new Map()
const replicationResults = new Map()
function setReplicationResult(key, value) {
  replicationResults.delete(key)
  replicationResults.set(key, value)
  while (replicationResults.size > 1000) replicationResults.delete(replicationResults.keys().next().value)
}

function readRequestBody(req, res, maxBytes, done) {
  const chunks = []
  let size = 0
  let ended = false
  req.on('data', chunk => {
    if (ended) return
    size += chunk.length
    if (size > maxBytes) { ended = true; respondText(res, 413, 'body too large'); req.destroy(); return }
    chunks.push(chunk)
  })
  req.on('end', () => { if (!ended) done(Buffer.concat(chunks)) })
  req.on('error', () => { if (!ended) { ended = true; respondText(res, 400, 'request stream error') } })
}

function tryReplicate(req, res) {
  if (req.method !== 'POST' || (req.url || '').split('?')[0] !== '/replicate') return false
  readRequestBody(req, res, 64 * 1024, body => {
    const auth = verifyNip98(req, writers, { devOpen: cfg.devOpenWrites, payload: body })
    if (!auth.ok) { respondText(res, 401, auth.reason); return }
    let request
    try {
      request = parseReplicationRequest(JSON.parse(body.toString('utf8')), {
        allowedOrigins: replicationOrigins,
        allowPrivate: cfg.allowPrivateSources,
      })
    } catch (error) {
      respondText(res, 400, error?.message || 'invalid replication request'); return
    }
    // The caller names the destinations, so the host screens them before it
    // opens a socket: a source resolving into loopback, link-local, private or
    // CGNAT space is refused HERE, where the caller learns why, rather than
    // becoming an empty job whose holes read like an unreachable peer. A source
    // that does not resolve at all is NOT refused here — the answer is unknown
    // and `guardedLookup` screens it again at connect time, so a DNS blip stays
    // a retry instead of a rejection.
    blockedSourcesReason(request.sources, cfg.allowPrivateSources, replicationOrigins).then(blocked => {
      if (blocked) { respondText(res, 400, blocked); return }
      const key = `${auth.pubkey}:${request.signature}`
      const existing = replicationJobs.get(key)
      // Preserve one job per status identity. If a package request arrives
      // behind a generic/inventory walk, queue its FULL request (sources and
      // limit included) as a second delta pass. That avoids both status races
      // and a false 202 whose package intent inherited insufficient inputs.
      if (existing && request.package && !existing.packageRequest) existing.packageRequest = request
      if (!existing) {
        const entry = { packageRequest: request.package ? request : null, promise: null }
        setReplicationResult(key, { state: 'running', signature: request.signature, startedAt: new Date().toISOString() })
        const resolveRequest = async jobRequest => {
          const resolver = jobRequest.package
            ? resolvePackageClosure
            : jobRequest.inventory ? resolveSignatureInventory : resolveSignatureClosure
          const io = contentDirectoryIO(cfg.contentDir, jobRequest.sources, resolveFlatSig, {
            allowPrivate: cfg.allowPrivateSources,
            allowedOrigins: replicationOrigins,
          })
          return await resolver(jobRequest.signature, io, { limit: jobRequest.limit })
        }
        const job = (async () => {
          const receipted = new Set()
          let result = await resolveRequest(request)
          for (const signature of result.held) receipted.add(signature)

          // A package request attached to an earlier non-package job gets its
          // own structural walk with its own inputs. Atoms already landed make
          // this an inexpensive delta pass in the successful common case.
          const packageRequest = entry.packageRequest
          if (packageRequest && packageRequest !== request) {
            result = await resolveRequest(packageRequest)
            for (const signature of result.held) receipted.add(signature)
          }

          receiptIndex.add(auth.pubkey, receipted)
          const publication = publishReplicatedPackage(cfg.contentDir, packageRequest, result)
          setReplicationResult(key, {
            state: 'complete', completedAt: new Date().toISOString(), ...result,
            ...(packageRequest ? {
              package: {
                label: packageRequest.package.label,
                published: publication !== null,
                ...(publication ?? {}),
              },
            } : {}),
          })
          console.log(`[replicate] ${auth.pubkey.slice(0, 8)}… ${request.signature.slice(0, 12)}… fetched=${result.fetched} present=${result.present} holes=${result.holes.length} refused=${result.refused.length}${result.limited ? ' limited' : ''}${publication ? ` package=${publication.appended ? 'appended' : 'held'}:${publication.name}` : ''}`)
        })()
          .catch(error => {
            setReplicationResult(key, { state: 'failed', signature: request.signature, completedAt: new Date().toISOString(), error: String(error?.message || error) })
            console.error('[replicate] job failed:', error?.message || error)
          })
          .finally(() => replicationJobs.delete(key))
        entry.promise = job
        replicationJobs.set(key, entry)
      }
      res.writeHead(202, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ accepted: true, signature: request.signature, running: !!existing }))
    }).catch(error => respondText(res, 500, `source screening failed: ${error?.message || error}`))
  })
  return true
}

function tryServeReplicationStatus(req, res) {
  if (req.method !== 'GET') return false
  const match = (req.url || '').split('?')[0].match(/^\/replicate\/([a-f0-9]{64})$/)
  if (!match) return false
  const auth = verifyNip98(req, writers, { devOpen: cfg.devOpenWrites })
  if (!auth.ok) { respondText(res, 401, auth.reason); return true }
  const result = replicationResults.get(`${auth.pubkey}:${match[1]}`)
  if (!result) { respondText(res, 404, 'replication job not found'); return true }
  const body = JSON.stringify(result)
  res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)), 'Cache-Control': 'private, no-store', 'Access-Control-Allow-Origin': '*', Vary: 'Authorization' })
  res.end(body)
  return true
}

// POST /forget — SECURE DELETE (documentation/remove-from-my-hosts.md). An
// authorized writer names sigs this host should stop holding. This relay has
// one owner, so ownership is not the question; what it must never lose is
// what its PUBLISHED PACKAGES need — every sig in the closure of a
// host:packages member is kept. Only flat atoms are removed (never a pool or
// a history bag), and their receipts go with them. Deleting is this host
// forgetting: anyone who already holds the bytes keeps them.
const FORGET_MAX = 1000

function tryForget(req, res) {
  if (req.method !== 'POST' || (req.url || '').split('?')[0] !== '/forget') return false
  const auth = verifyNip98(req, writers, { devOpen: cfg.devOpenWrites })
  if (!auth.ok) { respondText(res, 401, auth.reason); return true }
  const chunks = []
  let size = 0
  let aborted = false
  req.on('data', (c) => {
    if (aborted) return
    size += c.length
    if (size > 256 * 1024) { aborted = true; respondText(res, 413, 'body too large'); req.destroy(); return }
    chunks.push(c)
  })
  req.on('end', async () => {
    if (aborted) return
    let body
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { respondText(res, 400, 'body is not JSON'); return }
    const sigs = [...new Set((Array.isArray(body?.sigs) ? body.sigs : []).map(s => String(s || '').toLowerCase()))]
      .filter(s => /^[0-9a-f]{64}$/.test(s))
    if (sigs.length === 0) { respondText(res, 400, 'no sigs named'); return }
    if (sigs.length > FORGET_MAX) { respondText(res, 413, `at most ${FORGET_MAX} sigs per call`); return }

    const root = resolve(cfg.contentDir)
    const localIO = {
      read: async (sig) => { try { return readFileSync(join(root, sig)) } catch { return null } },
      fetch: async () => null,
      write: async () => { throw new Error('read-only walk') },
    }
    // What the published packages need is never forgotten.
    const keep = new Set()
    try {
      const poolDir = join(root, HOST_PACKAGES_POOL)
      for (const name of readdirSync(poolDir)) {
        if (!/^\d{8}$/.test(name)) continue
        const pkg = readFileSync(join(poolDir, name), 'utf8').split('\n')[0].trim().toLowerCase()
        if (!/^[0-9a-f]{64}$/.test(pkg)) continue
        const closure = await resolvePackageClosure(pkg, localIO)
        for (const sig of closure.held) keep.add(sig)
        keep.add(pkg)
      }
    } catch { /* no packages pool — nothing to protect */ }

    const removed = []
    const kept = {}
    for (const sig of sigs) {
      if (keep.has(sig)) { kept[sig] = 'package'; continue }
      const path = join(root, sig)
      let isFile = false
      try { isFile = statSync(path).isFile() } catch { /* absent */ }
      if (!isFile) { kept[sig] = 'not-held'; continue }
      try { rmSync(path); removed.push(sig) } catch { kept[sig] = 'locked' }
    }
    if (removed.length > 0) receiptIndex.forget(removed)
    const out = JSON.stringify({ removed, kept })
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(out)), 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' })
    res.end(out)
  })
  return true
}

function tryServeReceipts(req, res) {
  if (req.method !== 'GET' || (req.url || '').split('?')[0] !== '/receipts') return false
  const auth = verifyNip98(req, writers, { devOpen: cfg.devOpenWrites })
  if (!auth.ok) { respondText(res, 401, auth.reason); return true }
  const etag = receiptIndex.etag(auth.pubkey)
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': 'private, no-cache', 'Access-Control-Allow-Origin': '*' }); res.end(); return true
  }
  const body = JSON.stringify(receiptIndex.document(auth.pubkey))
  res.writeHead(200, {
    'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)), ETag: etag,
    'Cache-Control': 'private, no-cache', 'Access-Control-Allow-Origin': '*', Vary: 'Authorization',
  })
  res.end(body)
  return true
}

function tryWriteContent(req, res) {
  if (req.method !== 'PUT') return false

  let urlPath
  try { urlPath = decodeURIComponent((req.url || '').split('?')[0]) } catch { respondText(res, 400, 'bad path'); return true }
  if (!urlPath || urlPath === '/') { respondText(res, 400, 'no target path'); return true }

  // traversal defense — identical to the read path
  const resolved = resolve(cfg.contentDir, '.' + urlPath)
  const root = resolve(cfg.contentDir)
  if (!resolved.startsWith(root + sep) && resolved !== root) { respondText(res, 403, 'target outside content root'); return true }

  // writes land FLAT. The sig check below pins the BYTES; it says nothing about
  // the PLACE, and `mkdirSync(dirname(resolved), { recursive: true })` let an
  // authorised writer choose any directory under the content root — including
  // a pool's, whose members it could then shadow. An atom has one address:
  // `/<sig>`. A second segment is refused before auth is even consulted.
  const segments = urlPath.split('/').filter(Boolean)
  if (segments.length !== 1) { respondText(res, 400, 'an atom is written at /<sig> — no directory may be chosen'); return true }

  // writes must be sig-addressed: basename (minus .js/.json) must be a 64-hex sig
  const base = urlPath.split('/').pop() || ''
  const sig = base.replace(/\.(js|json)$/i, '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(sig)) { respondText(res, 400, 'target is not sig-addressed'); return true }
  // POOL ADDRESSES ARE NOT ATOMS. A pool's address is sign(meaning), and its
  // preimage — the meaning — is public, so a valid PUT of those bytes would
  // occupy the path and permanently prevent the pool. Refused for everyone,
  // before auth: the reserved set is public knowledge, so the answer reveals
  // nothing. (host:packages is reserved on the replication path too.)
  if (RESERVED_ADDRESSES.has(sig) || listedPool(sig)) {
    respondText(res, 409, sig === HOST_PACKAGES_POOL ? 'target is reserved for the host:packages pool' : 'target is reserved for a pool')
    return true
  }

  const auth = verifyWriteAuth(req)
  if (!auth.ok) {
    if (!auth.denied) { respondText(res, 401, auth.reason); return true }
    census.putsRefused++
    if (!participantMode) { respondText(res, 403, 'participants-closed'); return true }
    // Live and beaconed — but only in rooms this host does not take. That is
    // a standing answer, not a race with the beacon: 403, so the client
    // pauses (10 min) instead of retrying every second for good. A live key
    // with no room yet is the race (its PUT beat its beacon): 401 not-live.
    if (participantMode === 'zones' && isLive(auth.pubkey) && participants.get(auth.pubkey).xs.size > 0) {
      respondText(res, 403, 'participants-closed: this room is not hosted here')
      return true
    }
    respondText(res, 401, participantMode === 'zones' && isLive(auth.pubkey)
      ? 'not-live: join a room this relay hosts first'
      : 'not-live: join a swarm on this relay first')
    return true
  }
  const participant = auth.role === 'participant'
  // A participant's atom lands at the one address its receipt names, /<sig>
  // (a writer's legacy /<sig>.js keeps its own name).
  const target = participant ? join(root, sig) : resolved

  // A directory at the address is a pool or a history bag: never replaced by
  // an atom. That is answered only once the body hashes to the address (land):
  // with --allow-participants any key that has spoken once is admitted, so an
  // answer given before the hash told anyone which bags and pools this host
  // holds, at any address they cared to name. Now only a caller holding the
  // address's own preimage can learn it.
  let held = false
  try { held = statSync(target).isFile() } catch { /* not held */ }

  const ip = participant ? requestIp(req) : null
  const limit = participant ? participantCaps.blob : cfg.maxBodyBytes
  const declared = Number(req.headers['content-length'])
  if (participant && Number.isFinite(declared)) {
    // Refused on the declared length before a byte is read. A re-store of an
    // atom already held is never refused by a cap: only new bytes count.
    const refusal = declared > limit || !held ? participantRefusal(auth.pubkey, ip, declared, Date.now()) : null
    if (refusal) { refuseParticipant(req, res, refusal, declared); return true }
  }

  // Hashed as it arrives, so no 8–50 MB digest ever runs in one piece on the
  // loop that carries the meeting's frames.
  const hash = createHash('sha256')
  const chunks = []
  let size = 0
  let aborted = false
  req.on('data', (c) => {
    if (aborted) return
    size += c.length
    if (size > limit) {
      aborted = true
      if (participant) census.putsRefused++
      respondText(res, 413, participant ? `too large: a participant atom is at most ${limit} bytes` : 'body too large')
      req.destroy()
      return
    }
    hash.update(c)
    chunks.push(c)
  })
  const land = async () => {
    const actual = hash.digest('hex')
    if (actual !== sig) { respondText(res, 422, `hash mismatch: sha256(body)=${actual.slice(0, 12)} != ${sig.slice(0, 12)}`); return }
    if (await isDirectoryAt(target)) { respondText(res, 409, 'target is a directory — an atom never replaces a pool or a bag'); return }
    const now = Date.now()
    if (participant) {
      // Held already (or landed while this one uploaded): the receipt is true
      // as it stands, and nothing is written or counted.
      if (held || await isHeldAtom(target)) { stored(res, sig); return }
      // Checked and charged in one step, so racing uploads cannot pass a cap
      // together.
      const refusal = participantRefusal(auth.pubkey, ip, size, now)
      if (refusal) { refuseParticipant(req, res, refusal, size); return }
      chargeParticipant(auth.pubkey, ip, size, now)
    }
    try {
      await writeAtom(target, Buffer.concat(chunks, size))
      if (!participant) receiptIndex.add(auth.pubkey, [sig])
    } catch (e) {
      if (participant) chargeParticipant(auth.pubkey, ip, -size, now)
      respondText(res, 500, 'write failed: ' + (e?.message || 'unknown'))
      return
    }
    stored(res, sig)
    // A participant's write is a count in the minute line, never a line of
    // its own: the log names no key that is not the operator's.
    if (participant) { census.puts++; census.putBytes += size }
    else console.log(`[write] ${auth.pubkey.slice(0, 8)}… PUT ${urlPath} (${size} bytes)`)
  }
  req.on('end', () => {
    if (aborted) return
    land().catch(e => respondText(res, 500, 'write failed: ' + (e?.message || 'unknown')))
  })
  req.on('error', () => { if (!aborted) respondText(res, 400, 'request stream error') })
  return true
}

// The receipt: a 2xx whose body is exactly `stored <sig>`, readable from any
// origin. A swarm client counts it as the host serving the atom — no read-back.
function stored(res, sig) {
  res.writeHead(201, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' })
  res.end(`stored ${sig}`)
}

async function isHeldAtom(path) {
  try { return (await fsp.stat(path)).isFile() } catch { return false }
}

async function isDirectoryAt(path) {
  try { return (await fsp.stat(path)).isDirectory() } catch { return false }
}

// A cap's refusal, with Retry-After where waiting helps — exposed, or a
// browser on another origin cannot read it. Refused on the declared length,
// the body is left unread: Node discards it and the uploader still reads the
// answer, unless it claims more than this host takes from anyone.
function refuseParticipant(req, res, [status, body, wait], declared) {
  census.putsRefused++
  const headers = wait ? { 'Retry-After': wait, 'Access-Control-Expose-Headers': 'Retry-After' } : {}
  if (declared > cfg.maxBodyBytes) headers.Connection = 'close'
  respondText(res, status, body, headers)
  if (declared > cfg.maxBodyBytes) req.destroy()
}

// ── landing page (slim storage-host identity announcement) ───────────────────
//
// Without --shell-dir the relay is a storage + mesh host only. It serves
// `/<sig>` content and WSS. A bare GET / uses this small landing page; with
// --shell-dir the framework-free host shell takes that place. The relay does
// not serve the separate platform installer.
//
// Why HTML instead of a plain text liveness message: the URL is in the
// participant's browser, not a curl pipe. Telling them "open the canonical
// installer at <link>" with the host's domain visible defends against
// "I forgot which host I'm at" / typosquatting / phishing. It's a 1KB
// HTML response, no scripts, no external resources.

function tryServeShell(req, res) {
  if (!cfg.shellDir || (req.method !== 'GET' && req.method !== 'HEAD')) return false
  let urlPath
  try { urlPath = decodeURIComponent((req.url || '').split('?')[0]) } catch { return false }
  const root = resolve(cfg.shellDir)
  const target = resolve(root, '.' + (urlPath === '/' ? '/index.html' : urlPath))
  if (target !== root && !target.startsWith(root + sep)) {
    respondText(res, 403, 'outside shell root')
    return true
  }
  let held = false
  try { held = statSync(target).isFile() } catch { /* no static asset */ }

  // A missing address is absence, never the shell's HTML. Markers inside a
  // signed location have the same rule even though the marker is not hashed.
  const isAddress = urlPath.split('/').filter(Boolean).some(segment => /^[0-9a-f]{64}$/.test(segment))
  if (!held && (isAddress || urlPath.startsWith('/content/'))) {
    respondText(res, 404, 'not held', { 'Cache-Control': 'no-store' })
    return true
  }
  const file = held ? target : join(root, 'index.html')
  const name = file.split(/[\\/]/).pop() || ''
  const signed = /^[0-9a-f]{64}$/.test(name)
  const mutable = urlPath === '/pin' || name === 'main.js' || name === 'env.js' || name === 'hypercomb.worker.js'
  const headers = {
    'Content-Type': held ? getContentType(file) : 'text/html; charset=utf-8',
    'Content-Length': String(statSync(file).size),
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': signed ? 'public, max-age=31536000, immutable' : mutable ? 'no-cache, no-store, must-revalidate' : 'public, max-age=0, must-revalidate',
    'Permissions-Policy': PERMISSIONS_POLICY,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  }
  if (signed) headers.ETag = `"${name}"`
  res.writeHead(200, headers)
  if (req.method === 'HEAD') res.end()
  else createReadStream(file).on('error', () => res.destroy()).pipe(res)
  return true
}

const CANONICAL_INSTALLER_URL = 'https://diamondcoreprocessor.com'

function renderLandingHtml() {
  // Best-effort host identity — falls back to "this storage host" if we
  // can't resolve. Pure server-side, no JS, no tracking, no CSS that
  // pulls externally.
  const hostHint = ''  // intentionally left blank — host is in the URL bar
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>hypercomb storage host</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    max-width: 32rem; margin: 4rem auto; padding: 0 1.5rem;
    line-height: 1.55;
  }
  h1 { font-size: 1.1rem; font-weight: 600; letter-spacing: 0.06em;
       text-transform: uppercase; opacity: 0.7; margin: 0 0 1.5rem; }
  p { margin: 0 0 1rem; opacity: 0.9; }
  .cta { display: inline-block; margin-top: 0.5rem; padding: 0.5rem 1rem;
         border: 1px solid currentColor; border-radius: 4px;
         text-decoration: none; font-weight: 600; }
  .small { font-size: 0.85rem; opacity: 0.6; margin-top: 2rem; }
  code { background: rgba(127,127,127,0.15); padding: 0.1rem 0.35rem;
         border-radius: 3px; font-size: 0.9em; }
</style>
</head>
<body>
<h1>hypercomb · storage host</h1>
<p>This domain is a <strong>storage and mesh host</strong> in the hypercomb network. It serves signature-addressed content and relays peer messages.</p>
<p>It does <strong>not</strong> run the installer. To use the network, open the installer:</p>
<p><a class="cta" href="${CANONICAL_INSTALLER_URL}" rel="noopener">${CANONICAL_INSTALLER_URL}</a></p>
<p class="small">Storage endpoint: <code>GET /&lt;sig&gt;</code> &nbsp;·&nbsp; Mesh endpoint: <code>wss://</code>${hostHint}</p>
</body>
</html>`
}

function tryLanding(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  let urlPath
  try { urlPath = decodeURIComponent((req.url || '').split('?')[0]) } catch { return false }
  // Only the root path serves the landing page. Anything else is 404 (the
  // request already failed the /<sig> + swarm-temp routes that come before).
  if (urlPath !== '/' && urlPath !== '/index.html') return false

  const html = renderLandingHtml()
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(html, 'utf8')),
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=3600',
    'Permissions-Policy': PERMISSIONS_POLICY,
    // CSP belt-and-suspenders: no inline scripts can run, no external
    // resources can load. The landing is pure static text.
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  })
  if (req.method === 'HEAD') { res.end(); return true }
  res.end(html)
  return true
}

// ── (removed: trySPA) ────────────────────────────────────────────────────────
//
// The web half of the one-app node: besides the mesh (WS), the content read
// (GET /<sig>) and the content write (PUT /<sig>), the host serves a built
// SPA — the DCP installer and/or the front end — so you can VISIT the
// installer on your own relay. Static files come from cfg.spaDir; any path
// that isn't a real file falls back to index.html (client-side routing).
// Opt-in: only active when --spa-dir / SPA_DIR is set.
//
// Routing precedence (see createServer): NIP-05 → NIP-11 → /<sig> content → PUT →
// SPA. So sig URLs and the typed pools always win; the SPA only catches
// what's left (/, /index.html, hashed assets, app routes).

// trySPA was removed in the full-split refactor. The relay no longer serves
// installer code under any circumstances. See the landing handler above.

const server = createServer((req, res) => {
  // Doors write nothing — refused before any write route can run.
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS' && fromSandboxDoor(req)) {
    respondText(res, 403, 'a sandbox door writes nothing — do this from your own hive\n')
    return
  }

  // NIP-05 names — before NIP-11 (a client may send the nostr Accept header
  // here too), and before the content heap and the shell, so neither a file
  // placed by hand nor the shell's index.html can answer for this host's keys.
  if (tryServeNip05(req, res)) return

  // NIP-11 relay metadata (Accept: application/nostr+json)
  if (req.headers.accept?.includes('application/nostr+json')) {
    res.writeHead(200, { 'Content-Type': 'application/nostr+json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify(relayInfo))
    return
  }

  // Authenticated job status must precede the generic typed-path fallback.
  if (tryServeReplicationStatus(req, res)) return

  // The publisher's signed index — must precede the generic content branch,
  // which would otherwise treat /<sign('hive:indexes')>/<pubkey> as a pool member in the heap.
  if (tryServeHiveIndex(req, res)) return

  // Read side: GET/HEAD/OPTIONS content serving (returns true if handled)
  if (tryServeContent(req, res)) return

  if (tryServeReceipts(req, res)) return

  if (tryForget(req, res)) return

  if (tryReplicate(req, res)) return

  // Write side: PUT content into the sig pool (gated). Returns true if handled.
  if (tryWriteContent(req, res)) return

  // The shell is a read-only payload beside the live content and mesh routes.
  if (tryServeShell(req, res)) return

  // Landing page: bare GET / shows a small "this is a storage host, go to
  // the canonical installer" page. Returns true if handled (any GET on `/`
  // or `/index.html`). Falls through for other paths to the 404 below.
  if (tryLanding(req, res)) return

  // Anything else hitting this far is unrecognized — return 404 (don't
  // help fingerprinting beyond the absolute minimum).
  res.writeHead(404, {
    'Content-Type': 'text/plain',
    'Access-Control-Allow-Origin': '*',
    'Permissions-Policy': PERMISSIONS_POLICY,
  })
  res.end('not found')
})

const wss = new WebSocketServer({ server })

// The current access hashes (null: no --access-codes, everyone admitted), and
// the file's stamp they were read at — re-read on every upgrade and every
// second, so a recycle is in force before anyone could use the old code.
let accessHashes = null
let accessStamp = ''

function refreshAccessHashes() {
  if (!cfg.accessCodes) return
  let stamp = 'absent'
  try { const st = statSync(cfg.accessCodes); stamp = `${st.mtimeMs}:${st.size}:${st.ino}` } catch { /* fail closed */ }
  if (accessHashes && stamp === accessStamp) return
  accessStamp = stamp
  const next = new Set()
  try {
    for (const line of readFileSync(cfg.accessCodes, 'utf8').split(/\r?\n/)) {
      const hash = line.trim().toLowerCase()
      if (HEX64.test(hash)) next.add(hash)
    }
  } catch { /* missing: nobody is admitted */ }
  accessHashes = next
  // THE OLD OUT: whoever came in on a hash no longer listed leaves now.
  for (const c of clients) {
    if (c.accessHash && !next.has(c.accessHash)) { try { c.ws.close(ACCESS_REFUSED_CLOSE, 'access: the access code was recycled') } catch {} }
  }
}

/** sha256 of the access code a dial offered as `hc-access.<code>`, or null. */
function offeredAccessHash(req) {
  for (const offer of String(req.headers['sec-websocket-protocol'] ?? '').split(',')) {
    const protocol = offer.trim()
    if (protocol.startsWith(ACCESS_PROTOCOL_PREFIX) && protocol.length > ACCESS_PROTOCOL_PREFIX.length) {
      return sha256Hex(Buffer.from(protocol.slice(ACCESS_PROTOCOL_PREFIX.length), 'utf8'))
    }
  }
  return null
}

if (cfg.accessCodes) {
  refreshAccessHashes()
  setInterval(refreshAccessHashes, 1_000).unref?.()
}

wss.on('connection', (ws, req) => {
  // THE ACCESS GATE, before anything is said: a dial without the current code
  // is closed 4401 with no frame, never counted as a participant.
  let accessHash = null
  if (cfg.accessCodes) {
    refreshAccessHashes()
    accessHash = offeredAccessHash(req)
    if (!accessHash || !accessHashes.has(accessHash)) {
      census.accessRefused++
      ws.on('error', () => {})
      try { ws.close(ACCESS_REFUSED_CLOSE, 'access: this meeting point needs its current access code') } catch {}
      return
    }
  }

  const client = {
    ws, ip: requestIp(req), authed: !authRequired, pubkey: null, challenge: null,
    subs: new Map(), routes: new Map(), lifecycle: new Map(), closed: false,
    bucket: freshBucket(CONN_BURST, Date.now()), beaconed: new Set(),
    // the drained word's zone (trackLifecycle: this connection's own newest
    // {alive}) and asks waiting for its beacon (holdAsk)
    drainZone: null, heldAsks: [],
    accessHash,
  }

  // THE HOST CARD, first frame, before anything is asked: the relay's clock
  // (a client corrects its created_at by it — no round trip), whether this
  // host takes participants' bytes, and that its reads are addressed — the
  // drained word reaches only the asker's own room here, so a client may
  // still ask there for an older build without telling any other room.
  // An older client notes an unknown NOTICE.
  send(ws, ['NOTICE', 'hc:host ' + JSON.stringify({ v: 1, time: Math.floor(Date.now() / 1000), participants: participantMode, addressed: true })])

  if (authRequired) {
    client.challenge = makeChallenge()
    send(ws, ['AUTH', client.challenge])
  }

  clients.add(client)

  client.alive = true
  ws.on('pong', () => { client.alive = true })
  // One frame can never take the meeting point down: a throw is this frame's
  // NOTICE and a count in the minute line, and the process carries on.
  ws.on('message', (data) => {
    client.alive = true
    try { handleMessage(client, String(data)) } catch { census.handlerErrors++; send(ws, ['NOTICE', 'error: could not handle that message']) }
  })
  ws.on('close', () => handleDisconnect(client))
  ws.on('error', () => handleDisconnect(client))
})

// Keepalive. A connection whose TCP path died without a FIN (NAT expiry,
// a laptop lid, a tunnel that went away) stays readyState OPEN here
// forever: its subscriptions keep costing the broadcast loop and its
// lifecycle will never fires, so peers keep seeing a ghost. Ping every
// 30 s; a socket that answered nothing in a full interval is terminated,
// which runs the ordinary disconnect path.
// HARNESS ONLY: DIAG_KEEPALIVE_MS shortens the interval (a lock drill that
// must see the reap inside its window).
const KEEPALIVE_MS = Number(process.env.DIAG_KEEPALIVE_MS) > 0 ? Number(process.env.DIAG_KEEPALIVE_MS) : 30_000
setInterval(() => {
  for (const c of clients) {
    if (c.ws.readyState !== 1) continue
    if (!c.alive) { try { c.ws.terminate() } catch {} ; handleDisconnect(c); continue }
    c.alive = false
    try { c.ws.ping() } catch {}
  }
}, KEEPALIVE_MS)

// periodic cleanup
setInterval(() => { deleteExpired(); sweepBuckets(); sweepParticipants() }, 60_000)
// HARNESS ONLY: DIAG_CENSUS_MS shortens the minute.
setInterval(printCensus, Number(process.env.DIAG_CENSUS_MS) > 0 ? Number(process.env.DIAG_CENSUS_MS) : 60_000)
if (participantMode) void refreshDiskFree()

// graceful shutdown
function shutdown() {
  console.log('\nshutting down...')
  for (const c of clients) try { c.ws.close() } catch {}
  wss.close()
  server.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// start
server.listen(cfg.port, () => {
  console.log(`hypercomb-relay listening on ws://0.0.0.0:${cfg.port} (WebSocket relay + HTTP content host)`)
  if (authRequired) console.log(`auth required — ${cfg.pubkeys.length} pubkey(s) whitelisted`)
  console.log('events: memory only — a meeting point, not a store')
  const contentReady = existsSync(cfg.contentDir)
  console.log(`content-dir: ${cfg.contentDir} ${contentReady ? '(ready)' : '(empty — host will 404 until populated)'}`)
  if (cfg.devOpenWrites) console.log('writes: OPEN (--dev-open-writes — sha256 verify only, NEVER use on a public host)')
  else if (writers.size > 0) console.log(`writes: enabled — ${writers.size} authorized writer pubkey(s) (NIP-98 + sha256 verify)`)
  else console.log('writes: disabled (no --writers / --pubkeys configured)')
  if (nip05Domains.size === 0) console.log('names: /.well-known/nostr.json vouches for nobody (no --domain declared)')
  else console.log(`names: /.well-known/nostr.json vouches for ${writers.size} writer(s) at ${[...nip05Domains].join(', ')}; _ ${nip05Primary ? `is ${nip05Primary.slice(0, 8)}…` : 'unanswered (no --primary)'}`)
  const mb = bytes => `${Math.round(bytes / MB)} MB`
  console.log(participantMode
    ? `participants: ${participantMode === 'all' ? 'any swarm meeting here' : `${participantPolicy.zones.size} listed room(s)`} may upload (live key; ${mb(participantCaps.blob)}/atom, ${mb(participantCaps.key)}/key and ${mb(participantCaps.ip)}/IP a day, ${mb(participantCaps.total)} a day in all, none under ${mb(participantCaps.floor)} free)`
    : 'participants: closed (writers only — --allow-participants opens the swarm host)')
  console.log(`replication sources: ${replicationOrigins.size ? `${replicationOrigins.size} allowed origin(s)` : 'any public origin'}`)
  if (cfg.allowPrivateSources) console.log('replication sources: PRIVATE ADDRESSES ALLOWED (--allow-private-sources — dev only, NEVER use on a public host)')
  // Banner: slim storage-host announcement (no SPA — full-split model).
  // Visitors hitting `/` see the landing page → linked to canonical installer.
  console.log(cfg.shellDir
    ? `role: storage + mesh + pure host shell (${cfg.shellDir})`
    : `role: storage + mesh (installer code is canonical at ${CANONICAL_INSTALLER_URL})`)
})
