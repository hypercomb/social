// stamp-install-channel — advance the signed install sentinel after a build.
//
//   tsx ./scripts/stamp-install-channel.ts [channel] [--sig <64-hex>] [--host <domain>] [--require]
//
// The LAST step of `build:module` and `build:module:deploy`
// (install-by-replication.md, steps 2+6): reads the freshly built package sig
// from dist's `host:packages` member and asks the AUTHORING BROWSER — over the
// Claude bridge (ws:2401) — to merge `install:<channel>` → packageSig into the
// publisher's signed hive index (bridge op `hive-root-set`). Custody:
// browser-over-bridge — the key never leaves the browser's NostrSigner; this
// script holds no secrets.
//
// EVERY BUILD STAMPS. copy-content has already published the bytes to every
// target (the relay's content dir is the jwize.com route) by the time this
// runs, and consumers resolve `current` through the signed sentinel, not
// through what a domain serves — so a build that is not stamped is a build
// nobody is offered. `build:module` runs this best-effort: with the hive open
// the build reaches followers; with it closed the owed box prints and the
// build still succeeds. The DEPLOY passes --require, so a deploy whose
// sentinel did not advance exits non-zero instead of reporting success.
//
// A successful stamp also names WHO builds follow: the signing pubkey and its
// index host land in `src/sharing/install-publisher.json`, which the update
// scout bundles into its own verified bytes (update-scout.service.ts). The
// package stamped now predates the file; the next build carries it.
//
// The stamp is idempotent (an unchanged root no-ops), so the printed retry is
// always safe to run — and a HAND invocation stays best-effort (exit 0) so
// re-running it while the hive is closed is a nudge, not a failure.

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
const SIG_RE = /^[a-f0-9]{64}$/
const PUBLISHER_FILE = resolve(__dirname, '..', 'src', 'sharing', 'install-publisher.json')

const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const channel = argv.find(a => !a.startsWith('--') && a !== flag('--sig') && a !== flag('--host')) || 'essentials'
const require_ = argv.includes('--require')

/** The package this build made, read from dist's own `host:packages` member —
 *  the same thing a host publishes and a client reads, rather than a document
 *  about it (documentation/host-packages-pool.md). */
function packageSigFromDist(): string | null {
  const explicit = String(flag('--sig') ?? '').trim().toLowerCase()
  if (explicit) return SIG_RE.test(explicit) ? explicit : null
  try {
    const pool = createHash('sha256').update('host:packages', 'utf8').digest('hex')
    const entry = readFileSync(resolve(__dirname, '..', 'dist', pool, '00000000'), 'utf8')
    const sig = (entry.split('\n')[0] ?? '').trim().toLowerCase()
    return SIG_RE.test(sig) ? sig : null
  } catch { return null }
}

function stamp(sig: string): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(BRIDGE, {
      ...(process.env.HYPERCOMB_BRIDGE_TOKEN
        ? { headers: { Authorization: `Bearer ${String(process.env.HYPERCOMB_BRIDGE_TOKEN).trim()}` } }
        : {}),
    })
    const timer = setTimeout(() => { try { ws.close() } catch { /* closing */ } reject(new Error('bridge timeout')) }, 30_000)
    const id = `stamp-${Date.now()}`
    ws.on('open', () => ws.send(JSON.stringify({
      op: 'hive-root-set',
      id,
      key: `install:${channel}`,
      sig,
      ...(flag('--host') ? { host: flag('--host') } : {}),
    })))
    ws.on('message', (raw: Buffer) => {
      let res: { id?: string; ok?: boolean; data?: Record<string, unknown>; error?: string }
      try { res = JSON.parse(String(raw)) } catch { return }
      if (res.id !== id) return
      clearTimeout(timer)
      try { ws.close() } catch { /* closing */ }
      if (res.ok) resolvePromise(res.data ?? {})
      else reject(new Error(res.error || 'hive-root-set failed'))
    })
    ws.on('error', (err: Error) => { clearTimeout(timer); reject(err) })
  })
}

/** Name the key that just signed as the one this channel's builds follow.
 *  Only the channel the scout reads, and only when something changed — an
 *  ordinary stamp leaves the source tree alone. */
function recordPublisher(data: Record<string, unknown>): void {
  if (channel !== 'essentials') return
  const pubkey = String(data['pubkey'] ?? '').trim().toLowerCase()
  if (!SIG_RE.test(pubkey)) return
  const host = String(data['host'] ?? '').trim().toLowerCase()
  const next = { pubkey, hosts: host ? [host] : [], channel }
  try {
    const current = JSON.parse(readFileSync(PUBLISHER_FILE, 'utf8')) as typeof next
    if (current.pubkey === next.pubkey && current.channel === next.channel
      && JSON.stringify(current.hosts) === JSON.stringify(next.hosts)) return
  } catch { /* absent or unreadable — write it */ }
  writeFileSync(PUBLISHER_FILE, JSON.stringify(next, null, 2) + '\n')
  console.log(`[stamp-install-channel] builds now follow pubkey ${pubkey.slice(0, 12)}… (src/sharing/install-publisher.json) — the next build carries it`)
}

const sig = packageSigFromDist()
if (!sig) {
  console.error('[stamp-install-channel] no package sig — dist carries no host:packages member, or --sig is malformed')
  process.exit(1)
}

try {
  const data = await stamp(sig)
  if (data['unchanged']) {
    console.log(`[stamp-install-channel] install:${channel} already at ${sig.slice(0, 12)}… — sentinel current`)
  } else {
    console.log(`[stamp-install-channel] SENTINEL ADVANCED: install:${channel} → ${sig.slice(0, 12)}… on ${String(data['host'])} (pubkey ${String(data['pubkey']).slice(0, 12)}…)`)
  }
  recordPublisher(data)
} catch (err) {
  const retry = `npx tsx hypercomb-essentials/scripts/stamp-install-channel.ts ${channel} --sig ${sig}`
  console.error('')
  console.error('  ┌─────────────────────────────────────────────────────────────┐')
  console.error(`  │  SENTINEL STAMP OWED — install:${channel} not advanced`)
  const reason = err instanceof Error
    ? (err.message || (err as { code?: string }).code || 'connection failed')
    : String(err)
  console.error(`  │  reason: ${reason}`)
  console.error('  │  Bytes ARE published; consumers see the OLD root until')
  console.error('  │  stamped. With the hive open, run:')
  console.error(`  │    ${retry}`)
  console.error('  └─────────────────────────────────────────────────────────────┘')
  console.error('')
  process.exit(require_ ? 1 : 0)
}
