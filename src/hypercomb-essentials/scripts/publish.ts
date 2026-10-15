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
// THE PUBLIC INSTALL HOST TAKES IT FIRST. A cold install follows the signed
// root but takes its BYTES from the public install host (hypercomb.com), whose
// packages pool used to move only when someone redeployed its whole site from
// a checkout — it lagged the channel from 2026-09-30 to 10-09, and twice more
// on 10-11. So a publish of the channel the host installs, once it has
// shipped and BEFORE it stamps, asks that host for every atom of the new root
// by signature; its worker reads each from its farm (this machine, as
// jwize.com) and keeps it (replicate-public-host.ts). Only then is the stamp
// made, and the host's pool — derived from the signed index, once its heap
// holds the whole package — names the new root the moment the index does. A
// pull that does not finish stops the publish: nothing is announced (exit 1),
// because a stamp naming bytes the host lacks would leave every client that
// looked there sure, for good, that the host has no such build. Nothing is
// uploaded and nothing is built for it; this machine is not needed after.
// A pool that has not moved after the stamp is exit 3, with the retry.
//
// Unnamed always means the default name, never "whatever was published last" —
// so the same command means the same thing every time it is run.

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PUBLIC_INSTALL_HOST_ENV, publicInstallHost, replicateRevision, replicationVerdict } from './replicate-public-host.js'
import { PUBLISHER_FILES, packageSigFromDist } from './stamp-install-channel.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_NAME = 'essentials'
const MAX_NAME = 48

/** A publish that announced, but whose public install host is not current. */
export const EXIT_HOST_BEHIND = 3

type HostDeps = { host?: string | null; replicate?: typeof replicateRevision; log?: (line: string) => void }

/**
 * BEFORE THE STAMP: the public install host takes the revision's whole
 * package — only for the channel it installs (the publisher record's); any
 * other name is offered to its followers only. `host` is null when there is
 * nothing to take (another name, no root, the host configured away); `ok`
 * false means the stamp must not be made.
 */
export async function pullToPublicHost(
  input: { name: string; channel: string; root: string | null },
  deps: HostDeps = {},
): Promise<{ host: string | null; ok: boolean }> {
  const log = deps.log ?? ((line: string) => console.log(line))
  if (input.name !== input.channel || !input.root) return { host: null, ok: true }
  const host = 'host' in deps ? deps.host ?? null : publicInstallHost()
  log('\n[publish] public install host')
  if (!host) {
    log(`[publish] ${PUBLIC_INSTALL_HOST_ENV} names no host — nothing replicated`)
    return { host: null, ok: true }
  }
  const report = await (deps.replicate ?? replicateRevision)({ root: input.root, host, stage: 'pull' })
  for (const line of replicationVerdict(report, input.channel, false).lines) log(line)
  return { host, ok: report.ok }
}

/**
 * AFTER THE STAMP: the host's pool must now name the root, read as a cold
 * client reads it. Returns the exit code the publish owes: 0, or
 * EXIT_HOST_BEHIND when it does not. The stamp stands either way.
 */
export async function confirmOnPublicHost(
  input: { host: string | null; root: string | null; channel: string },
  deps: HostDeps = {},
): Promise<number> {
  const log = deps.log ?? ((line: string) => console.log(line))
  if (!input.host || !input.root) return 0
  const report = await (deps.replicate ?? replicateRevision)({ root: input.root, host: input.host, stage: 'confirm' })
  for (const line of replicationVerdict(report, input.channel).lines) log(line)
  return report.ok ? 0 : EXIT_HOST_BEHIND
}

async function main(): Promise<void> {
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

  // The channel the public host installs is the publisher record's.
  let channel = DEFAULT_NAME
  try { channel = String(JSON.parse(readFileSync(PUBLISHER_FILES[0]!, 'utf8'))?.channel ?? DEFAULT_NAME) } catch { /* the default */ }
  const root = packageSigFromDist()
  const pulled = await pullToPublicHost({ name, channel, root })
  if (!pulled.ok) {
    console.error(`\n[publish] STOPPED at "public install host" — nothing was announced`)
    process.exit(1)
  }

  run('announce', 'stamp-install-channel.ts', [name, '--require'])

  const owed = await confirmOnPublicHost({ host: pulled.host, root, channel })
  console.log(`\n[publish] PUBLISHED under "${name}" — ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`)
  if (owed) {
    console.error(`[publish] the public install host is not current — exit ${owed}; the stamp stands`)
    process.exitCode = owed
  }
}

/** Run only as a script — a spec imports the helpers above without publishing. */
const invokedDirectly = (): boolean => {
  const entry = process.argv[1]
  if (!entry) return false
  const [a, b] = [resolve(entry), fileURLToPath(import.meta.url)]
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}
if (invokedDirectly()) await main()
