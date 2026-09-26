#!/usr/bin/env node
// THE VERSION POOL. Every pure build is a revision: a signed record kept in the
// sign('host:builds') pool, so a release's history is held the hypercomb way,
// by signature, on any device that keeps the pool, with no forge in the middle.
//
//   { name: 'build', label, version, parent, install, host, library,
//     hostPackage, atoms, source }
//
// `label` is the revision's name, as for packages (documentation/
// publishing-a-revision.md): the line its revisions belong to, so naming a
// build anew starts a new heading. `version` is year.month.day.n (UTC), n
// counting the revisions this pool holds for that day. `parent` is the build before it. `install` and
// `source` are layers ({ name, files: { path: sig } }) of the origin's own
// files and of every source file the build read; `atoms` are the origin's
// signature-named files. Every file, layer and record is kept in the pool, so
// any revision can be written out and published again, exactly.
//
// PARTICIPANTS sign a revision with the nostr key their hive already uses
// (secp256k1 Schnorr, the key NostrSigner holds). A signature is a nostr event
// of kind 30567 kept in sign('host:build-signatures') at
// <buildSig>/<role>/<pubkey>; the record never carries its own signatures.
// Roles: author, reviewer, and witness — a witness signs only a build they
// reproduced: a revision of their own with the same install, atoms and parts.
//
//   node host/builds.mjs                          revisions by name, newest first
//   node host/builds.mjs show <version|sig>       what it changed, who signed it
//   node host/builds.mjs out <version|sig> <dir> [--with-source]
//   node host/builds.mjs publish <version|sig> [--azure] [-- deploy args]
//   node host/builds.mjs sign <version|sig> --as author|reviewer|witness
//   node host/builds.mjs take <origin dir>        bring in a published revision
//
// Pools live under HYPERCOMB_POOLS_DIR (default ~/.hypercomb). The signing key
// is read from HYPERCOMB_SIGNER_KEY (64 hex) or the file HYPERCOMB_SIGNER_KEY_FILE.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, open, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BUILDS_MEANING = 'host:builds'
export const SIGNATURES_MEANING = 'host:build-signatures'
export const ROLES = ['author', 'reviewer', 'witness']
export const BUILD_SIGNATURE_KIND = 30567
export const DEFAULT_LABEL = 'host'
const SIG = /^[a-f0-9]{64}$/
const OUTPUT_PARTS = ['install', 'host', 'library', 'hostPackage', 'atoms']
const PARTS = ['install', 'host', 'library', 'hostPackage', 'source']

export const sign = bytes => createHash('sha256').update(bytes).digest('hex')
export const poolDir = meaning =>
  resolve(process.env.HYPERCOMB_POOLS_DIR || resolve(homedir(), '.hypercomb'), sign(meaning))

/** A name is also a channel: lowercase letters, digits and hyphens, from a letter. */
export const foldLabel = asked => {
  const label = String(asked ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '')
  if (!label) return DEFAULT_LABEL
  if (!/^[a-z][a-z0-9-]*$/.test(label)) throw new Error(`"${asked}" is not a usable name — letters, digits and hyphens, starting with a letter`)
  return label
}

const keep = async (pool, bytes) => {
  const sig = sign(bytes)
  await writeFile(resolve(pool, sig), bytes, { flag: 'wx' }).catch(e => { if (e.code !== 'EEXIST') throw e })
  return sig
}
const readJson = async (pool, sig) => sig ? JSON.parse(await readFile(resolve(pool, sig), 'utf8')) : null
const headOf = async pool => (await readFile(resolve(pool, 'head'), 'utf8').catch(() => '')).trim() || null

/** A layer of files: each kept under its signature, the layer names them by path. */
const layer = async (pool, name, files) => {
  const named = {}
  for (const [path, bytes] of [...files].sort(([a], [b]) => a < b ? -1 : 1)) named[path] = await keep(pool, bytes)
  return keep(pool, Buffer.from(JSON.stringify({ name, files: named })))
}

/** The next version of the day: n counts every revision the pool holds for
 *  that day, taken ones included, so no two revisions here share a version. */
const nextVersion = async (pool, now) => {
  const day = `${now.getUTCFullYear()}.${now.getUTCMonth() + 1}.${now.getUTCDate()}`
  const n = (await revisions(pool))
    .filter(r => r.record.version.startsWith(day + '.'))
    .reduce((max, r) => Math.max(max, Number(r.record.version.slice(day.length + 1))), 0)
  return `${day}.${n + 1}`
}

/**
 * Record a build as a new revision. `install` and `source` map path → bytes;
 * `signed` holds the origin's signature-named atoms.
 */
export const recordBuild = async ({ label, install, source, signed, host, library, hostPackage, now = new Date() }) => {
  const pool = poolDir(BUILDS_MEANING)
  await mkdir(pool, { recursive: true })
  const atoms = []
  for (const bytes of signed) atoms.push(await keep(pool, bytes))
  const parentSig = await headOf(pool)
  const parent = await readJson(pool, parentSig)
  const record = {
    name: 'build', label: foldLabel(label), version: await nextVersion(pool, now), parent: parentSig,
    install: await layer(pool, 'install', install), host, library, hostPackage,
    atoms: atoms.sort(), source: await layer(pool, 'source', source),
  }
  const bytes = Buffer.from(JSON.stringify(record))
  const sig = await keep(pool, bytes)
  await writeFile(resolve(pool, 'head'), sig + '\n', 'utf8')
  return { sig, record, bytes, pool, unchanged: !!parent && PARTS.every(k => same(parent[k], record[k])) }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** Every revision in the pool: records are found by their first bytes. */
export const revisions = async (pool = poolDir(BUILDS_MEANING)) => {
  const found = []
  const prefix = Buffer.from('{"name":"build",')
  for (const name of await readdir(pool).catch(() => [])) {
    if (!SIG.test(name)) continue
    const handle = await open(resolve(pool, name))
    const head = Buffer.alloc(prefix.length)
    await handle.read(head, 0, prefix.length, 0).finally(() => handle.close())
    if (head.equals(prefix)) found.push({ sig: name, record: await readJson(pool, name) })
  }
  return found.sort((a, b) => order(b.record.version) - order(a.record.version) || (a.sig < b.sig ? -1 : 1))
}
const order = version => version.split('.').map(Number).reduce((n, part, i) => n + part * [1e8, 1e6, 1e4, 1][i], 0)

export const findRevision = async ref => {
  const all = await revisions()
  const hit = all.filter(r => r.record.version === ref || (ref?.length >= 6 && r.sig.startsWith(ref)))
  if (hit.length !== 1) throw new Error(hit.length ? `"${ref}" names ${hit.length} revisions — give more of the signature` : `no revision "${ref}" in ${poolDir(BUILDS_MEANING)}`)
  return hit[0]
}

/** What a revision changed against the build before it: parts, and files by path. */
export const changesOf = async (pool, record) => {
  const parent = await readJson(pool, record.parent).catch(() => null)
  const parts = PARTS.filter(k => !same(record[k], parent?.[k]))
  const files = {}
  for (const k of ['install', 'source']) {
    if (!parts.includes(k)) continue
    const now = (await readJson(pool, record[k]).catch(() => ({ files: {} }))).files
    const was = parent ? (await readJson(pool, parent[k]).catch(() => ({ files: {} }))).files : {}
    files[k] = [...new Set([...Object.keys(now), ...Object.keys(was)])].sort()
      .filter(p => now[p] !== was[p])
      .map(p => (!was[p] ? '+ ' : !now[p] ? '- ' : '~ ') + p)
  }
  return { parts, files }
}

// ── participant signatures ───────────────────────────────────────────────────
export const signaturePreimage = (buildSig, version, role) => `hc:build:v1\n${buildSig}\n${version}\n${role}`

/** Verified signatures of a build: [{ role, pubkey, ok }]. */
export const signaturesOf = async (buildSig, version, root = poolDir(SIGNATURES_MEANING)) => {
  const roles = await readdir(resolve(root, buildSig)).catch(() => [])
  if (!roles.length) return []
  const { verifyEvent } = await import('nostr-tools/pure')
  const out = []
  for (const role of roles) {
    for (const pubkey of await readdir(resolve(root, buildSig, role)).catch(() => [])) {
      const event = JSON.parse(await readFile(resolve(root, buildSig, role, pubkey), 'utf8'))
      const ok = ROLES.includes(role) && event.pubkey === pubkey && event.kind === BUILD_SIGNATURE_KIND
        && event.content === signaturePreimage(buildSig, version, role) && verifyEvent(event)
      out.push({ role, pubkey, ok })
    }
  }
  return out
}

const signerKey = async () => {
  const file = process.env.HYPERCOMB_SIGNER_KEY_FILE
  const hex = (process.env.HYPERCOMB_SIGNER_KEY || (file ? await readFile(file, 'utf8') : '')).trim().toLowerCase()
  if (!SIG.test(hex)) {
    throw new Error('no signing key: set HYPERCOMB_SIGNER_KEY (64 hex) or HYPERCOMB_SIGNER_KEY_FILE to the secret your hive signs with')
  }
  return Uint8Array.from(Buffer.from(hex, 'hex'))
}

export const signRevision = async (ref, role, now = new Date()) => {
  if (!ROLES.includes(role)) throw new Error(`--as wants one of ${ROLES.join(', ')}`)
  const { sig, record } = await findRevision(ref)
  if (role === 'witness') {
    const reproduced = (await revisions()).find(r => r.sig !== sig && OUTPUT_PARTS.every(k => same(r.record[k], record[k])))
    if (!reproduced) throw new Error(`a witness reproduces ${record.version} first: build it here and get the same install, atoms and parts`)
  }
  const { finalizeEvent } = await import('nostr-tools/pure')
  const event = finalizeEvent({
    kind: BUILD_SIGNATURE_KIND, created_at: Math.floor(now.getTime() / 1000),
    tags: [['d', `${sig}:${role}`], ['b', sig], ['r', role], ['v', record.version]],
    content: signaturePreimage(sig, record.version, role),
  }, await signerKey())
  const dir = resolve(poolDir(SIGNATURES_MEANING), sig, role)
  await mkdir(dir, { recursive: true })
  await writeFile(resolve(dir, event.pubkey), JSON.stringify(event))
  return { sig, record, pubkey: event.pubkey }
}

// ── writing a revision out, and taking one in ────────────────────────────────
/** Write a revision's origin into `dir`, exactly as it was built, with its signatures. */
export const writeOut = async (ref, dir, { withSource = false } = {}) => {
  const pool = poolDir(BUILDS_MEANING)
  const { sig, record } = await findRevision(ref)
  if ((await readdir(dir).catch(() => [])).length) throw new Error(`${dir} is not empty`)
  const put = async (path, bytes) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes) }
  const install = await readJson(pool, record.install)
  for (const [path, fileSig] of Object.entries(install.files)) await put(resolve(dir, path), await readFile(resolve(pool, fileSig)))
  for (const atom of [...record.atoms, sig]) await put(resolve(dir, atom), await readFile(resolve(pool, atom)))
  await writeFile(resolve(dir, 'build'), sig + '\n', 'utf8')
  const signatures = resolve(poolDir(SIGNATURES_MEANING), sig)
  if ((await readdir(signatures).catch(() => [])).length) {
    await cpDir(signatures, resolve(dir, sign(SIGNATURES_MEANING), sig))
  }
  if (withSource) {
    const into = resolve(dir, sign(BUILDS_MEANING))
    const source = await readJson(pool, record.source)
    for (const s of [sig, record.install, record.source, ...Object.values(install.files), ...Object.values(source.files)]) {
      await put(resolve(into, s), await readFile(resolve(pool, s)))
    }
  }
  return { sig, record }
}

const cpDir = async (from, to) => {
  await mkdir(to, { recursive: true })
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (entry.isDirectory()) await cpDir(resolve(from, entry.name), resolve(to, entry.name))
    else await writeFile(resolve(to, entry.name), await readFile(resolve(from, entry.name)))
  }
}

/** The origin's install files as a layer's `files`, the way check-pure and recordBuild see them. */
export const installFilesOf = async dist => {
  const files = new Map()
  const skip = new Set([sign(BUILDS_MEANING), sign(SIGNATURES_MEANING)])
  const walk = async dir => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name)
      const rel = relative(dist, path).split(sep).join('/')
      if (dir === dist && (SIG.test(entry.name) || skip.has(entry.name) || entry.name === 'build')) continue
      if (entry.isDirectory()) await walk(path)
      else files.set(rel, await readFile(path))
    }
  }
  await walk(dist)
  return files
}

/** Bring a published revision in: every file hashed once, as it arrives. */
export const takeIn = async dir => {
  const pool = poolDir(BUILDS_MEANING)
  await mkdir(pool, { recursive: true })
  const sig = (await readFile(resolve(dir, 'build'), 'utf8')).trim()
  const admit = async (bytes, want) => {
    if (sign(bytes) !== want) throw new Error(`${want.slice(0, 12)} does not hash to its name`)
    return keep(pool, bytes)
  }
  const recordBytes = await readFile(resolve(dir, sig))
  await admit(recordBytes, sig)
  const record = JSON.parse(recordBytes)
  for (const atom of record.atoms) await admit(await readFile(resolve(dir, atom)), atom)
  const install = await layer(pool, 'install', await installFilesOf(dir))
  if (install !== record.install) throw new Error(`the origin's files are not the install ${record.version} recorded`)
  const carried = resolve(dir, sign(BUILDS_MEANING))
  for (const name of await readdir(carried).catch(() => [])) if (SIG.test(name)) await admit(await readFile(resolve(carried, name)), name)
  const signatures = resolve(dir, sign(SIGNATURES_MEANING), sig)
  const held = await signaturesOf(sig, record.version, resolve(dir, sign(SIGNATURES_MEANING)))
  for (const { role, pubkey, ok } of held) {
    if (!ok) continue
    const to = resolve(poolDir(SIGNATURES_MEANING), sig, role)
    await mkdir(to, { recursive: true })
    await writeFile(resolve(to, pubkey), await readFile(resolve(signatures, role, pubkey)))
  }
  // A pool with no builds of its own continues from what it took.
  if (!await headOf(pool)) await writeFile(resolve(pool, 'head'), sig + '\n', 'utf8')
  return { sig, record, signatures: held }
}

// ── the command line ─────────────────────────────────────────────────────────
const short = s => s.slice(0, 12)
const signersLine = list => {
  const counts = {}
  for (const { role, ok } of list) if (ok) counts[role] = (counts[role] ?? 0) + 1
  const text = ROLES.filter(r => counts[r]).map(r => counts[r] > 1 ? `${r}×${counts[r]}` : r).join(', ')
  return text ? ` · signed: ${text}` : ''
}

const list = async () => {
  const pool = poolDir(BUILDS_MEANING)
  const all = await revisions(pool)
  if (!all.length) return console.log(`no revisions in ${pool}`)
  // One heading per name; the name with the newest revision leads.
  const byLabel = new Map()
  for (const r of all) byLabel.set(r.record.label, [...(byLabel.get(r.record.label) ?? []), r])
  for (const [label, rows] of byLabel) {
    console.log(label)
    for (const { sig, record } of rows) {
      const { parts, files } = await changesOf(pool, record)
      const count = Object.values(files).reduce((n, f) => n + f.length, 0)
      const what = parts.length ? parts.join(' ') + (count ? ` · ${count} files` : '') : 'no change'
      console.log(`   ${record.version.padEnd(13)} ${short(sig)}  ${what}${signersLine(await signaturesOf(sig, record.version))}`)
    }
  }
}

const show = async ref => {
  const pool = poolDir(BUILDS_MEANING)
  const { sig, record } = await findRevision(ref)
  const { parts, files } = await changesOf(pool, record)
  console.log(`${record.label} ${record.version}  ${sig}`)
  console.log(`  parent  ${record.parent ?? '(none)'}`)
  console.log(`  changed ${parts.join(' ') || 'nothing'}`)
  for (const [k, lines] of Object.entries(files)) for (const line of lines) console.log(`  ${k.padEnd(7)} ${line}`)
  for (const { role, pubkey, ok } of await signaturesOf(sig, record.version)) {
    console.log(`  ${ok ? 'signed ' : 'FORGED '} ${role.padEnd(8)} ${pubkey}`)
  }
}

const publish = async (ref, args) => {
  const here = dirname(fileURLToPath(import.meta.url))
  const dir = await mkdtemp(resolve(tmpdir(), 'hypercomb-revision-'))
  try {
    const { record } = await writeOut(ref, dir)
    const env = { ...process.env, HYPERCOMB_HOST_OUT_DIR: dir }
    const run = script => {
      const result = spawnSync(process.execPath, [resolve(here, script), ...args.filter(a => a !== '--azure')], { env, stdio: 'inherit' })
      if (result.status !== 0) throw new Error(`${script} failed`)
    }
    run('check-pure.mjs')
    console.log(`[builds] publishing ${record.label} ${record.version}`)
    run(args.includes('--azure') ? 'deploy-azure.mjs' : 'deploy-cloudflare.mjs')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ref, ...rest] = process.argv.slice(2)
  const flag = name => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined }
  try {
    if (!command) await list()
    else if (command === 'show') await show(ref)
    else if (command === 'out') {
      const dir = resolve(rest.find(a => !a.startsWith('--')) ?? '')
      if (!rest.length) throw new Error('out wants a directory')
      const { sig, record } = await writeOut(ref, dir, { withSource: rest.includes('--with-source') })
      console.log(`${record.label} ${record.version} ${short(sig)} → ${dir}`)
    } else if (command === 'publish') await publish(ref, rest.filter(a => a !== '--'))
    else if (command === 'sign') {
      const { record, pubkey } = await signRevision(ref, flag('--as'))
      console.log(`${record.label} ${record.version} signed as ${flag('--as')} by ${pubkey}`)
    } else if (command === 'take') {
      const { record, sig, signatures } = await takeIn(resolve(ref))
      console.log(`took ${record.label} ${record.version} ${short(sig)}${signersLine(signatures)}`)
    } else throw new Error(`unknown command "${command}"`)
  } catch (e) {
    console.error(`[builds] ${e.message}`)
    process.exit(1)
  }
}
