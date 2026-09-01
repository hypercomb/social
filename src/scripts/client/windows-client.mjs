#!/usr/bin/env node
// Keep the installed Windows client level with the newest green CI build, then
// launch it.
//
// Why this exists: Smart App Control refuses to execute a freshly compiled
// unsigned binary, so this machine cannot build the client at all — CI is the
// only builder, and the bundled package is not a fallback on the desktop, it
// IS the installed version of the app. Every refresh was therefore a manual
// download-and-run, and an app nobody remembers to update is an app that
// silently drifts (measured once at 248 commits behind, which read as "the
// feature is broken on Windows" for weeks).
//
// The rule this script keeps: launching is never blocked by updating. Every
// failure path here — no gh, no network, no artifact, a red run — falls
// through to starting whatever is already installed. An updater that can
// stop you opening your own hive is worse than a stale build.
//
//   node scripts/client/windows-client.mjs            # update if a newer build exists
//   node scripts/client/windows-client.mjs --launch   # update, then start the app
//   node scripts/client/windows-client.mjs --force    # reinstall the newest build
//
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')
const WORKFLOW = 'build-client-windows.yml'
const ARTIFACT = 'hypercomb-client-windows-x64'

// cargo names the binary after the CRATE; `productName` only applies inside the
// bundle, so searching the install dir for "Hypercomb.exe" finds nothing.
const BINARY = 'hypercomb-client.exe'

const args = new Set(process.argv.slice(2))
const wantLaunch = args.has('--launch')
const force = args.has('--force')
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const branch = arg('branch') ?? 'development'

// Where the app actually lives is not a constant, and assuming it is installs a
// SECOND copy that nothing launches.
//
// A Claude Code session runs inside the desktop app's MSIX container, where
// AppData\Local is redirected into Packages\<pkg>\LocalCache — so an
// install done from a session lands there, while the scheduled task, running
// outside the container, sees the real AppData\Local and finds nothing.
// Both must update the SAME directory or the shortcut goes stale while the
// updater reports success.
//
// So: look for the binary rather than assume a path, and say which one won.
function resolveInstallDir() {
  const local = process.env.LOCALAPPDATA ?? ''
  const explicit = arg('dir') ?? process.env.HYPERCOMB_CLIENT_DIR
  if (explicit) return { dir: explicit, how: 'explicit' }

  const plain = join(local, 'hypercomb')
  if (existsSync(join(plain, BINARY))) return { dir: plain, how: 'LOCALAPPDATA' }

  // Any packaged container's redirected LocalAppData. Matched by shape, not by
  // package name — this is not specific to one host application.
  const packages = join(local, 'Packages')
  const found = []
  if (existsSync(packages)) {
    for (const pkg of readdirSync(packages, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue
      const candidate = join(packages, pkg.name, 'LocalCache', 'Local', 'hypercomb')
      const exe = join(candidate, BINARY)
      if (existsSync(exe)) found.push({ dir: candidate, at: statSync(exe).mtimeMs })
    }
  }
  if (found.length) {
    found.sort((a, b) => b.at - a.at)
    return { dir: found[0].dir, how: 'container' }
  }

  return { dir: plain, how: 'fresh' }
}

const { dir: INSTALL_DIR, how: FOUND_BY } = resolveInstallDir()
const EXE = join(INSTALL_DIR, BINARY)

// Beside the exe rather than inside the hive: this records which BUILD is
// installed, which is a fact about the machine, not about anyone's content.
const STAMP = join(INSTALL_DIR, 'installed-build.json')

// A scheduled run has nobody watching it, so the only way it can report is in
// writing. Beside the exe: if the app is gone the log is moot anyway.
const LOG = join(INSTALL_DIR, 'update.log')
const say = (m) => {
  console.log(`[client] ${m}`)
  try {
    appendFileSync(LOG, `${new Date().toISOString()} ${m}
`)
  } catch {
    // An unwritable log must never be the reason an update or a launch fails.
  }
}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

function gh(argv, opts = {}) {
  return spawnSync('gh', argv, { cwd: REPO, encoding: 'utf8', shell: false, ...opts })
}

function newestGreenBuild() {
  const r = gh([
    'run', 'list', '--workflow', WORKFLOW, '--branch', branch,
    '--status', 'success', '--limit', '1',
    '--json', 'databaseId,headSha,displayTitle,updatedAt',
  ])
  if (r.status !== 0) throw new Error(`gh run list failed: ${(r.stderr || '').trim() || r.status}`)
  const [run] = JSON.parse(r.stdout || '[]')
  if (!run) throw new Error(`no successful ${WORKFLOW} run on ${branch}`)
  return run
}

function installedSha() {
  try {
    return JSON.parse(readFileSync(STAMP, 'utf8')).headSha ?? null
  } catch {
    return null
  }
}

function appIsRunning() {
  const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq hypercomb-client.exe', '/NH'], { encoding: 'utf8' })
  return (r.stdout ?? '').includes('hypercomb-client.exe')
}

// The artifact carries both bundles; the NSIS one installs per-user with /S and
// needs no elevation, so it is the one to run unattended. (The .msi would
// prompt, which defeats the whole point of a passive update.)
function findSetup(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      const hit = findSetup(path)
      if (hit) return hit
    } else if (entry.name.toLowerCase().endsWith('.exe')) {
      return path
    }
  }
  return null
}

function update() {
  const run = newestGreenBuild()
  const have = installedSha()
  if (!force && have === run.headSha && existsSync(EXE)) {
    say(`up to date — ${run.headSha.slice(0, 9)} "${run.displayTitle}"`)
    return false
  }
  if (existsSync(EXE) && appIsRunning()) {
    say(`a newer build is ready (${run.headSha.slice(0, 9)}) but the app is running — it will install next launch`)
    return false
  }

  const staging = mkdtempSync(join(tmpdir(), 'hypercomb-client-'))
  try {
    say(`fetching ${run.headSha.slice(0, 9)} "${run.displayTitle}" (run ${run.databaseId})`)
    // Fetched through gh, the installer carries no Mark-of-the-Web, which is
    // what lets an unsigned CI build run on a machine with SAC enforced.
    const dl = gh(['run', 'download', String(run.databaseId), '-n', ARTIFACT, '-D', staging], { stdio: 'inherit' })
    if (dl.status !== 0) throw new Error(`gh run download failed (${dl.status})`)

    const setup = findSetup(staging)
    if (!setup) throw new Error(`no installer inside ${ARTIFACT}`)

    const before = existsSync(EXE) ? statSync(EXE).mtimeMs : 0
    say(`installing ${setup.split(/[\/]/).pop()} (silent, per-user)`)
    // /D must be last and unquoted; it pins NSIS to the install we resolved.
    const install = spawnSync(setup, ['/S', `/D=${INSTALL_DIR}`], { stdio: 'inherit' })
    if (install.error) throw install.error

    // NSIS /S returns before it has finished writing, so the exit code is not
    // the witness — the exe landing is.
    const deadline = Date.now() + 180_000
    while (Date.now() < deadline) {
      if (existsSync(EXE) && statSync(EXE).mtimeMs > before) break
      sleep(1000)
    }
    if (!existsSync(EXE) || statSync(EXE).mtimeMs <= before) throw new Error('installer finished but the exe did not change')

    writeFileSync(STAMP, JSON.stringify({ ...run, installedAt: new Date().toISOString() }, null, 2))
    say(`installed ${run.headSha.slice(0, 9)}`)
    return true
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

say(`install dir ${INSTALL_DIR} (${FOUND_BY})`)

try {
  update()
} catch (err) {
  // Never fatal. Say what went wrong and go on to launch what is there.
  say(`update skipped — ${err.message}`)
}

if (wantLaunch) {
  if (!existsSync(EXE)) {
    say(`nothing installed at ${EXE}`)
    process.exit(1)
  }
  say('launching')
  spawn(EXE, [], { detached: true, stdio: 'ignore' }).unref()
}
