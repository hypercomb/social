// check-running.mjs
//
// IS THE RELAY RUNNING THE CODE ON DISK? (code-stamp.js)
//
//   node hypercomb-relay/check-running.mjs [base] [--warn]
//
// Asks the relay at `base` (default http://localhost:7777) for its NIP-11
// document and compares the code it started from with the code here. Says
// which, and exits 1 when the relay is behind — or 0 with `--warn`, which is
// how the build runs it: a build must not fail because a relay wants a
// restart, but it must say so, every time, until someone does it.
// No relay answering is not a failure: there is nothing to be stale.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codeStamp } from './code-stamp.js'

const args = process.argv.slice(2)
const warnOnly = args.includes('--warn')
const base = (args.find(arg => !arg.startsWith('--')) ?? 'http://localhost:7777').replace(/\/+$/, '')
const here = codeStamp(join(dirname(fileURLToPath(import.meta.url)), 'relay.js'))

let info = null
try {
  const res = await fetch(base, { headers: { Accept: 'application/nostr+json' }, signal: AbortSignal.timeout(4_000) })
  if (res.ok) info = await res.json()
} catch { /* nothing answering */ }

if (!info || info.name !== 'hypercomb-relay') {
  console.log(`[relay-check] no hypercomb relay answering at ${base} — nothing to check`)
  process.exit(0)
}

const running = typeof info.code === 'string' ? info.code : ''
if (running === here) {
  console.log(`[relay-check] ${base} is running the code on disk (${here.slice(0, 12)})`)
  process.exit(0)
}

const since = info.started_at ? ` since ${new Date(info.started_at * 1000).toLocaleString()}` : ''
console.warn('')
console.warn(`[relay-check] ⚠ THE RELAY AT ${base} IS RUNNING OLD CODE${since}.`)
console.warn(running
  ? `[relay-check]   running ${running.slice(0, 12)}, on disk ${here.slice(0, 12)}`
  : `[relay-check]   it predates the code stamp; on disk ${here.slice(0, 12)}`)
console.warn('[relay-check]   Every hive that follows it gets the old answers until it is restarted.')
console.warn('[relay-check]   Restart it (the service: hypercomb-relay/restart-relay-elevated.ps1),')
console.warn('[relay-check]   or start it with --restart-when-stale so it restarts itself.')
console.warn('')
process.exit(warnOnly ? 0 : 1)
