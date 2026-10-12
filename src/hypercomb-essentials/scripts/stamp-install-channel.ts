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
// the build reaches followers; with it closed the stamp is recorded as OWED
// (scripts/bridge/owed-stamps.cjs) and the broker pays it the next time a hive
// attaches. The DEPLOY passes --require, so a deploy whose sentinel did not
// advance exits non-zero instead of reporting success.
//
// A successful stamp also names WHO builds follow: the signing pubkey and its
// index host land in `src/sharing/install-publisher.json`, which the update
// scout bundles into its own verified bytes (update-scout.service.ts). The
// package stamped now predates the file; the next build carries it.
//
// AND WHOM A COLD SHELL FOLLOWS. A shell with nothing installed has no scout
// yet, so the web shell carries the same record
// (`hypercomb-web/src/setup/install-publisher.json`) and its first install
// follows that publisher's signed `install:<channel>`. Both copies are written
// here, together, byte-identical — and install-follow.spec.ts fails the suite
// if they ever differ.
//
// ONLY WHEN ASKED (`--adopt-publisher`). A stamp answered by a hive holding a
// DIFFERENT key than the file names is refused and left owed, exactly as the
// broker refuses an owed stamp (run-bridge.cjs). Observed 2026-09-22: a stamp
// signed by a second key flipped the file, the next build baked that key in,
// the usual key then stamped that build and flipped the file back — and every
// hypercomb.io instance bounced between two builds that each named the other
// as the update, forever. The signer is a fact about which tab answered the
// bridge, never a decision about who builds follow.
//
// The stamp is idempotent (an unchanged root no-ops), so the printed retry is
// always safe to run — and a HAND invocation stays best-effort (exit 0) so
// re-running it while the hive is closed is a nudge, not a failure.

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
const SIG_RE = /^[a-f0-9]{64}$/
/** Every copy of the publisher record, scout's first: the package's (bundled
 *  into the update scout) and the web shell's (read by a cold install). */
export const PUBLISHER_FILES: readonly string[] = [
  resolve(__dirname, '..', 'src', 'sharing', 'install-publisher.json'),
  resolve(__dirname, '..', '..', 'hypercomb-web', 'src', 'setup', 'install-publisher.json'),
]
const DIST = resolve(__dirname, '..', 'dist')
const owedStamps = createRequire(import.meta.url)('../../scripts/bridge/owed-stamps.cjs') as {
  recordOwed(channel: string, sig: string, host?: string): boolean
  settleOwed(channel: string, sig: string): boolean
  followedPubkey(): string | null
}

/** The package this build made, read from dist's own `host:packages` member —
 *  the same thing a host publishes and a client reads, rather than a document
 *  about it (documentation/host-packages-pool.md). An explicit `--sig` wins. */
export function packageSigFromDist(explicit?: string, distDir: string = DIST): string | null {
  const named = String(explicit ?? '').trim().toLowerCase()
  if (named) return SIG_RE.test(named) ? named : null
  try {
    const pool = createHash('sha256').update('host:packages', 'utf8').digest('hex')
    const entry = readFileSync(resolve(distDir, pool, '00000000'), 'utf8')
    const sig = (entry.split('\n')[0] ?? '').trim().toLowerCase()
    return SIG_RE.test(sig) ? sig : null
  } catch { return null }
}

function stamp(sig: string, channel: string, host?: string): Promise<Record<string, unknown>> {
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
      ...(host ? { host } : {}),
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

/** Name the key that just signed as the one this channel's builds — and a
 *  cold shell — follow. Only the channel the scout reads, and only when
 *  something changed: an ordinary stamp leaves the source tree alone.
 *
 *  The FIRST file is the record; every other file is made byte-identical to
 *  it, so a copy that drifted (edited by hand, or written before the shell
 *  carried one) is healed by the next stamp. Returns the files written. */
export function recordPublisher(
  data: Record<string, unknown>,
  channel: string,
  files: readonly string[] = PUBLISHER_FILES,
  log: (line: string) => void = line => console.log(line),
): string[] {
  if (channel !== 'essentials' || !files.length) return []
  const pubkey = String(data['pubkey'] ?? '').trim().toLowerCase()
  if (!SIG_RE.test(pubkey)) return []
  const host = String(data['host'] ?? '').trim().toLowerCase()
  // THE HOSTS ARE THE OWNER'S. The host a stamp landed on is only where this
  // tab's hive happened to sign; writing it over the list made every stamp
  // from 4250 swap content.hypercomb.com for pluginthematrix.com (jwize,
  // 2026-10-05: "keep hypercomb.com default"). A host is recorded only when
  // the file names none.
  const [record, ...copies] = files
  let current: { pubkey?: string; hosts?: string[]; channel?: string } | null = null
  try { current = JSON.parse(readFileSync(record!, 'utf8')) } catch { /* absent or unreadable — write it */ }
  const hosts = Array.isArray(current?.hosts) && current!.hosts.length ? current!.hosts : host ? [host] : []
  const next = { pubkey, hosts, channel }
  const text = JSON.stringify(next, null, 2) + '\n'
  const unchanged = !!current && current.pubkey === next.pubkey && current.channel === next.channel
    && JSON.stringify(current.hosts) === JSON.stringify(next.hosts)
  const recordText = unchanged ? readFileSync(record!, 'utf8') : text
  const written: string[] = []
  if (!unchanged) { writeFileSync(record!, text); written.push(record!) }
  for (const copy of copies) {
    let held: string | null = null
    try { held = readFileSync(copy, 'utf8') } catch { /* absent — write it */ }
    if (held === recordText) continue
    writeFileSync(copy, recordText)
    written.push(copy)
  }
  if (!unchanged) log(`[stamp-install-channel] builds and cold installs now follow pubkey ${pubkey.slice(0, 12)}… — the next build carries it`)
  else if (written.length) log(`[stamp-install-channel] the shell's copy of the publisher record matched to the package's`)
  return written
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const channel = argv.find(a => !a.startsWith('--') && a !== flag('--sig') && a !== flag('--host')) || 'essentials'
  const require_ = argv.includes('--require')
  const adoptPublisher = argv.includes('--adopt-publisher')

  const sig = packageSigFromDist(flag('--sig'))
  if (!sig) {
    console.error('[stamp-install-channel] no package sig — dist carries no host:packages member, or --sig is malformed')
    process.exit(1)
  }

  try {
    const data = await stamp(sig, channel, flag('--host'))
    const signer = String(data['pubkey'] ?? '').trim().toLowerCase()
    const followed = channel === 'essentials' ? owedStamps.followedPubkey() : null
    if (followed && signer !== followed && !adoptPublisher) {
      throw new Error(
        `signed by ${signer.slice(0, 12) || 'an unknown key'}…, but builds follow ${followed.slice(0, 12)}… — ` +
        `the index that moved is one no build reads. Attach the hive holding ${followed.slice(0, 12)}… and retry, ` +
        `or pass --adopt-publisher to move every future build onto the signing key`,
      )
    }
    if (data['unchanged']) {
      console.log(`[stamp-install-channel] install:${channel} already at ${sig.slice(0, 12)}… — sentinel current`)
    } else {
      console.log(`[stamp-install-channel] SENTINEL ADVANCED: install:${channel} → ${sig.slice(0, 12)}… on ${String(data['host'])} (pubkey ${String(data['pubkey']).slice(0, 12)}…)`)
    }
    recordPublisher(data, channel)
    owedStamps.settleOwed(channel, sig)
  } catch (err) {
    owedStamps.recordOwed(channel, sig, flag('--host'))
    const retry = `npx tsx hypercomb-essentials/scripts/stamp-install-channel.ts ${channel} --sig ${sig}`
    console.error('')
    console.error('  ┌─────────────────────────────────────────────────────────────┐')
    console.error(`  │  SENTINEL STAMP OWED — install:${channel} not advanced`)
    const reason = err instanceof Error
      ? (err.message || (err as { code?: string }).code || 'connection failed')
      : String(err)
    console.error(`  │  reason: ${reason}`)
    console.error('  │  Bytes ARE published; consumers see the OLD root until')
    console.error('  │  stamped. The debt is recorded: the bridge pays it the')
    console.error('  │  next time a hive attaches (?claudeBridge=1). Or run:')
    console.error(`  │    ${retry}`)
    console.error('  └─────────────────────────────────────────────────────────────┘')
    console.error('')
    process.exit(require_ ? 1 : 0)
  }
}

/** Run only as a script — a spec imports the helpers above without stamping. */
const invokedDirectly = (): boolean => {
  const entry = process.argv[1]
  if (!entry) return false
  const [a, b] = [resolve(entry), fileURLToPath(import.meta.url)]
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}
if (invokedDirectly()) await main()
