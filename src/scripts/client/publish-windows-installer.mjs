#!/usr/bin/env node
// publish-windows-installer — put a Windows setup into the `hypercomb:windows`
// pool of this machine's host, so anyone can download it BY SIGNATURE.
//
//   node scripts/client/publish-windows-installer.mjs              # newest green development build
//   node scripts/client/publish-windows-installer.mjs --run=<id>   # one CI run
//   node scripts/client/publish-windows-installer.mjs --file=<setup.exe> [--commit=<sha>]
//   node scripts/client/publish-windows-installer.mjs --dry        # say what would be written
//
// THE SHAPE (documentation/windows-installer-pool.md). The setup is broken
// apart into PARTS under a static host's per-file cap, each part a sig-named
// file standing alone. One small RECORD names the parts, their order, the
// file name and the signature of the whole, so the reassembled file checks
// itself. The pool member is `<recordSig>\n<name>` at the next 8-digit index —
// the same shape as `host:packages`: the MAX INDEX IS THE HEAD, the member's
// file date IS the release date, and the pool only grows.
//
//   <content>/<partSig>                 each part, byte-for-byte
//   <content>/<recordSig>               { kind, file, size, sig, parts, commit, run }
//   <content>/<sign('hypercomb:windows')>/00000000   `<recordSig>\n<name>`
//   <content>/<sign('hypercomb:windows')>/index.html  the listing a static host serves
//
// The content root is the additive host this machine serves (jwize.com serves
// hypercomb-relay/content straight off this disk), or HYPERCOMB_RELAY_CONTENT_DIR.
// Every write is skip-if-exists: bytes are named by their own hash, so a second
// run of the same build writes nothing and appends nothing.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const REPO = join(SRC, '..')
const WORKFLOW = 'build-client-windows.yml'
const ARTIFACT = 'hypercomb-client-windows-x64'
const MEANING = 'hypercomb:windows'
const RECORD_KIND = 'hypercomb:windows@1'

// Cloudflare Pages refuses a file over 25 MiB; a part stays well under it so
// any static host can carry every piece.
const PART_BYTES = 16 * 1024 * 1024

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const dry = process.argv.includes('--dry')
const branch = arg('branch') ?? 'development'
const name = (arg('name') ?? branch).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
const contentDir = process.env.HYPERCOMB_RELAY_CONTENT_DIR ?? join(SRC, 'hypercomb-relay', 'content')

const sign = (bytes) => createHash('sha256').update(bytes).digest('hex')
const poolEntryName = (index) => String(index).padStart(8, '0')
const ENTRY = /^[0-9]{8}$/

function gh(argv) {
  const r = spawnSync('gh', argv, { cwd: REPO, encoding: 'utf8', shell: false, maxBuffer: 1 << 26 })
  if (r.status !== 0) throw new Error(`gh ${argv.slice(0, 2).join(' ')} failed: ${(r.stderr || '').trim() || r.status}`)
  return r.stdout
}

function findSetup(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      const hit = findSetup(path)
      if (hit) return hit
    } else if (entry.name.toLowerCase().endsWith('-setup.exe')) {
      return path
    }
  }
  return null
}

/** The setup to publish, and where it came from. */
function source() {
  const file = arg('file')
  if (file) return { path: file, commit: arg('commit') ?? null, run: null, cleanup: () => {} }

  const run = arg('run')
    ? JSON.parse(gh(['run', 'view', arg('run'), '--json', 'databaseId,headSha,conclusion,workflowName']))
    : JSON.parse(gh([
        'run', 'list', '--workflow', WORKFLOW, '--branch', branch,
        '--status', 'success', '--limit', '1', '--json', 'databaseId,headSha',
      ]))[0]
  if (!run) throw new Error(`no successful ${WORKFLOW} run on ${branch}`)
  if (run.conclusion && run.conclusion !== 'success') throw new Error(`run ${run.databaseId} is ${run.conclusion}, not success`)

  const dir = mkdtempSync(join(tmpdir(), 'hc-windows-installer-'))
  console.log(`downloading ${ARTIFACT} from run ${run.databaseId} (${run.headSha.slice(0, 9)})…`)
  gh(['run', 'download', String(run.databaseId), '-n', ARTIFACT, '-D', dir])
  const path = findSetup(dir)
  if (!path) throw new Error(`run ${run.databaseId} carries no *-setup.exe`)
  return { path, commit: run.headSha, run: run.databaseId, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** Content-addressed, so an existing file with this name already IS these bytes. */
function put(sig, bytes) {
  const target = join(contentDir, sig)
  if (existsSync(target)) return false
  if (!dry) writeFileSync(target, bytes, { flag: 'wx' })
  return true
}

function readMember(poolDir, entry) {
  const text = readFileSync(join(poolDir, entry), 'utf8')
  const [sig, label = ''] = text.split('\n')
  return { sig, label }
}

/** Appends `<recordSig>\n<name>` unless the head already says exactly that. */
function append(poolSig, recordSig) {
  const poolDir = join(contentDir, poolSig)
  if (!dry) mkdirSync(poolDir, { recursive: true })
  const entries = existsSync(poolDir) ? readdirSync(poolDir).filter((n) => ENTRY.test(n)).sort() : []
  const head = entries.at(-1)
  if (head) {
    const member = readMember(poolDir, head)
    if (member.sig === recordSig && member.label === name) return { index: Number(head), appended: false }
  }
  const bytes = `${recordSig}\n${name}`
  if (dry) return { index: entries.length, appended: true }

  // Staged complete, then made visible by a hard link — an exclusive create,
  // so a racing writer that claimed the same index sends this one round again.
  const staged = join(poolDir, `.part-windows-${process.pid}`)
  writeFileSync(staged, bytes, { flag: 'w' })
  try {
    for (let index = entries.length; ; index++) {
      try {
        linkSync(staged, join(poolDir, poolEntryName(index)))
        writeIndex(poolDir)
        return { index, appended: true }
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
      }
    }
  } finally {
    unlinkSync(staged)
  }
}

/** A static host has no readdir, so the pool describes itself at its own address. */
function writeIndex(poolDir) {
  const names = readdirSync(poolDir).filter((n) => ENTRY.test(n)).sort()
  writeFileSync(join(poolDir, 'index.html'), names.join('\n'))
}

function main() {
  if (!existsSync(contentDir) || !statSync(contentDir).isDirectory()) {
    throw new Error(`no host content directory at ${contentDir} — set HYPERCOMB_RELAY_CONTENT_DIR`)
  }
  const from = source()
  try {
    const bytes = readFileSync(from.path)
    // A setup is a PE image; anything else in the pool would be offered to
    // every visitor as the Windows app.
    if (bytes.length < 1024 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
      throw new Error(`${from.path} is not a Windows setup executable`)
    }
    const whole = sign(bytes)
    const parts = []
    let wrote = 0
    for (let offset = 0; offset < bytes.length; offset += PART_BYTES) {
      const part = bytes.subarray(offset, Math.min(offset + PART_BYTES, bytes.length))
      const sig = sign(part)
      parts.push(sig)
      if (put(sig, part)) wrote++
    }

    const record = Buffer.from(JSON.stringify({
      kind: RECORD_KIND,
      file: basename(from.path),
      size: bytes.length,
      sig: whole,
      parts,
      commit: from.commit,
      run: from.run,
    }), 'utf8')
    const recordSig = sign(record)
    if (put(recordSig, record)) wrote++

    const poolSig = sign(Buffer.from(MEANING, 'utf8'))
    const { index, appended } = append(poolSig, recordSig)

    const verb = dry ? 'would write' : 'wrote'
    console.log(`${basename(from.path)}  ${(bytes.length / 1048576).toFixed(1)} MiB  sha256 ${whole}`)
    console.log(`  ${parts.length} part(s), record ${recordSig.slice(0, 12)}…  (${verb} ${wrote} new file(s))`)
    console.log(appended
      ? `  ${dry ? 'would append' : 'appended'} ${MEANING} #${poolEntryName(index)} as "${name}"`
      : `  ${MEANING} head #${poolEntryName(index)} already is this build — nothing appended`)
    console.log(`  pool ${poolSig}  in ${contentDir}`)
  } finally {
    from.cleanup()
  }
}

try {
  main()
} catch (error) {
  console.error(`publish-windows-installer: ${error.message}`)
  process.exit(1)
}
