// stamp-install-channel — advance the signed install sentinel after a deploy.
//
//   tsx ./scripts/stamp-install-channel.ts [channel] [--sig <64-hex>] [--host <domain>]
//
// The LAST step of `build:module:deploy` (install-by-replication.md, steps
// 2+6): reads the freshly built package sig from dist/manifest.json and asks
// the AUTHORING BROWSER — over the Claude bridge (ws:2401) — to merge
// `install:<channel>` → packageSig into the publisher's signed hive index
// (bridge op `hive-root-set`). Custody: browser-over-bridge — the key never
// leaves the browser's NostrSigner; this script holds no secrets.
//
// Best-effort by design: uploads to Azure have already succeeded when this
// runs, and the stamp is idempotent (an unchanged root no-ops). When the
// bridge is unreachable the script exits 0 but prints an UNMISSABLE owed
// line with the paste-ready retry — the sentinel simply lags until stamped.
// Pass --require to make a failed stamp fail the whole command instead.

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
const SIG_RE = /^[a-f0-9]{64}$/

const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const channel = argv.find(a => !a.startsWith('--') && a !== flag('--sig') && a !== flag('--host')) || 'essentials'
const require_ = argv.includes('--require')

function packageSigFromDist(): string | null {
  const explicit = String(flag('--sig') ?? '').trim().toLowerCase()
  if (explicit) return SIG_RE.test(explicit) ? explicit : null
  try {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '..', 'dist', 'manifest.json'), 'utf8')) as { packages?: Record<string, unknown> }
    const sigs = Object.keys(manifest.packages ?? {}).filter(s => SIG_RE.test(s))
    if (sigs.length > 1) console.warn(`[stamp-install-channel] manifest holds ${sigs.length} packages — stamping the first`)
    return sigs[0] ?? null
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

const sig = packageSigFromDist()
if (!sig) {
  console.error('[stamp-install-channel] no package sig — dist/manifest.json missing or --sig malformed')
  process.exit(1)
}

try {
  const data = await stamp(sig)
  if (data['unchanged']) {
    console.log(`[stamp-install-channel] install:${channel} already at ${sig.slice(0, 12)}… — sentinel current`)
  } else {
    console.log(`[stamp-install-channel] SENTINEL ADVANCED: install:${channel} → ${sig.slice(0, 12)}… on ${String(data['host'])} (pubkey ${String(data['pubkey']).slice(0, 12)}…)`)
  }
} catch (err) {
  const retry = `npx tsx hypercomb-essentials/scripts/stamp-install-channel.ts ${channel} --sig ${sig}`
  console.error('')
  console.error('  ┌─────────────────────────────────────────────────────────────┐')
  console.error(`  │  SENTINEL STAMP OWED — install:${channel} not advanced`)
  const reason = err instanceof Error
    ? (err.message || (err as { code?: string }).code || 'connection failed')
    : String(err)
  console.error(`  │  reason: ${reason}`)
  console.error('  │  The deploy itself succeeded; consumers see the OLD root')
  console.error('  │  until stamped. With the hive open, run:')
  console.error(`  │    ${retry}`)
  console.error('  └─────────────────────────────────────────────────────────────┘')
  console.error('')
  process.exit(require_ ? 1 : 0)
}
