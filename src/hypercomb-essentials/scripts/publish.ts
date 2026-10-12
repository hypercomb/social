// publish — the ONE act that makes a revision.
//
//   npm run publish:revision                  → a new revision under the default name ("essentials")
//   npm run publish:revision -- <name>        → a new revision under <name>; a name that has
//                                      not been used yet starts a new named head
//   npm run publish:revision -- <name> --no-build   ship what dist already holds
//
// A build is not a revision. `build:module` copies bytes for local work and
// stamps nothing; a revision exists only because this ran. It builds (the cache
// makes an unchanged tree free), appends the package to the host's
// `host:packages` pool under the name — the member's label is the name, its
// file date is the revision's date — and stamps the signed `install:<name>`
// root through the authoring browser, so followers of that name are told.
// The stamp is REQUIRED: a publish nobody was offered exits non-zero.
//
// THEN IT CHECKS THE PUBLIC INSTALL HOST. A cold install follows the signed
// root, but takes its BYTES from hypercomb.com — and hypercomb.com's packages
// pool moves only when the host is restaged (scripts/presentation/
// deploy-azure.cjs stages the signed root). From 2026-09-30 to 10-09 that pool
// lagged the channel and every fresh install ran a Sep 30 build. So a publish
// of the channel the host stages reads hypercomb.com's pool head, and when it
// is not the root just stamped it prints the exact restage step it owes.
// It deploys nothing: the restage is the owner's act (az login, one command).
//
// Unnamed always means the default name, never "whatever was published last" —
// so the same command means the same thing every time it is run.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOST_PACKAGES_MEANING, markerIndices, parseMember, parsePoolListing, poolEntryName } from '../../hypercomb-runtime/src/host-pool.js'
import { PUBLISHER_FILES, packageSigFromDist } from './stamp-install-channel.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_NAME = 'essentials'
const MAX_NAME = 48

/** The public install's one host — runtime host-zones.ts DEFAULT_HOST_ZONES
 *  (publish.spec.ts keeps the two in step). */
export const PUBLIC_INSTALL_HOST = 'hypercomb.com'

/** The command that restages it, run from `src/` after `az login`. */
export const RESTAGE_STEP = 'npm run deploy:hypercomb.com'

type Fetch = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'text'>>

/**
 * The head of a host's packages pool, read the way a cold client reads it
 * (runtime host-packages.ts): the zone's own bases, flat then `/content`, the
 * listing first and the newest marker under it. `answered` is false only when
 * no base gave an HTTP response at all.
 */
export async function hostPoolHead(zone: string, fetchImpl: Fetch = fetch): Promise<{ answered: boolean; head: string | null }> {
  const pool = createHash('sha256').update(HOST_PACKAGES_MEANING, 'utf8').digest('hex')
  let answered = false
  for (const base of [`https://${zone}`, `https://${zone}/content`]) {
    let listing: string[] | null
    try {
      const res = await fetchImpl(`${base}/${pool}/`, { cache: 'no-store' })
      answered = true
      listing = res.ok ? parsePoolListing(await res.text()) : null
    } catch { continue }
    if (!listing) continue
    const indices = markerIndices(listing)
    if (!indices.length) return { answered, head: null }
    try {
      const res = await fetchImpl(`${base}/${pool}/${poolEntryName(indices[indices.length - 1]!)}`, { cache: 'no-store' })
      return { answered, head: res.ok ? parseMember(await res.text())?.packageSig ?? null : null }
    } catch { return { answered, head: null } }
  }
  return { answered, head: null }
}

export type SeedVerdict = { state: 'current' | 'behind' | 'unknown'; lines: string[] }

/** Pure: what the public install host offers against the root just stamped,
 *  and — unless it is current — the step owed. */
export function seedVerdict(stamped: string, read: { answered: boolean; head: string | null }, channel = DEFAULT_NAME): SeedVerdict {
  const short = (sig: string): string => `${sig.slice(0, 12)}…`
  if (read.head === stamped) {
    return { state: 'current', lines: [`[publish] ${PUBLIC_INSTALL_HOST} offers ${short(stamped)} to cold installs — current`] }
  }
  const offered = read.head
    ? `${PUBLIC_INSTALL_HOST} still offers ${short(read.head)} to cold installs`
    : read.answered
      ? `${PUBLIC_INSTALL_HOST} lists no package to cold installs`
      : `${PUBLIC_INSTALL_HOST}'s packages pool could not be read (offline?)`
  return {
    state: read.answered ? 'behind' : 'unknown',
    lines: [
      '',
      '  ┌─────────────────────────────────────────────────────────────┐',
      `  │  RESTAGE ${read.answered ? 'OWED' : 'UNCONFIRMED'} — ${offered}`,
      `  │  install:${channel} is now ${short(stamped)}. A first install follows`,
      `  │  that root but takes its bytes from ${PUBLIC_INSTALL_HOST}; until the host`,
      '  │  holds it, a cold install falls back to the older build there.',
      '  │  From src/ (az login first) — stages the signed root from jwize.com:',
      `  │    ${RESTAGE_STEP}`,
      '  └─────────────────────────────────────────────────────────────┘',
      '',
    ],
  }
}

function main(): Promise<void> | void {
  const args = process.argv.slice(2)
  const skipBuild = args.includes('--no-build')
  const asked = args.find(arg => !arg.startsWith('--')) ?? ''

  // A name is also an install channel (`install:<name>`), so it must be one:
  // lowercase, digits and hyphens, starting with a letter.
  const name = asked
    ? asked.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, MAX_NAME).replace(/-+$/, '')
    : DEFAULT_NAME

  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    console.error(`[publish] "${asked}" is not a usable name — use letters, digits and hyphens, starting with a letter`)
    process.exit(1)
  }

  const run = (label: string, script: string, scriptArgs: string[] = []): void => {
    console.log(`\n[publish] ${label}`)
    const result = spawnSync('npx', ['tsx', `./scripts/${script}`, ...scriptArgs], { cwd: ROOT, stdio: 'inherit', shell: true })
    if (result.status !== 0) {
      console.error(`\n[publish] STOPPED at "${label}" — nothing was announced`)
      process.exit(result.status ?? 1)
    }
  }

  console.log(`[publish] revision under "${name}"${name === DEFAULT_NAME ? ' (the default name)' : asked !== name ? ` (from "${asked}")` : ''}`)

  if (!skipBuild) run('build', 'build-module.ts')
  run('ship', 'copy-content.ts', ['--publish', '--name', name])
  run('announce', 'stamp-install-channel.ts', [name, '--require'])

  return (async () => {
    // The host stages the channel the publisher record names; any other name
    // is offered to its followers only, never to a cold install.
    let staged = DEFAULT_NAME
    try { staged = String(JSON.parse(readFileSync(PUBLISHER_FILES[0]!, 'utf8'))?.channel ?? DEFAULT_NAME) } catch { /* the default */ }
    const stamped = packageSigFromDist()
    if (name === staged && stamped) {
      console.log(`\n[publish] public install host`)
      for (const line of seedVerdict(stamped, await hostPoolHead(PUBLIC_INSTALL_HOST), name).lines) console.log(line)
    }
    console.log(`\n[publish] PUBLISHED under "${name}" — ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`)
  })()
}

/** Run only as a script — a spec imports the helpers above without publishing. */
const invokedDirectly = (): boolean => {
  const entry = process.argv[1]
  if (!entry) return false
  const [a, b] = [resolve(entry), fileURLToPath(import.meta.url)]
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}
if (invokedDirectly()) await main()
