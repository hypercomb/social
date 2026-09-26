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
// of kind 30567, kept in sign('host:build-signatures') under the signature of
// its own bytes, like everything else; the record never carries its own
// signatures. Roles: author, reviewer, and witness — a witness signs only a
// build they reproduced: a revision of their own with the same outputs.
//
// THE POOLS TRAVEL. Both pools are flat directories of signature-named files,
// so a host serves them as it serves any pool: `/<sign(meaning)>/` lists the
// members, `/<sign(meaning)>/<sig>` is one. `push` carries them into a host's
// directory (the relay's content dir for jwize.com; the Azure deploy of
// hypercomb.com carries them itself); `pull` brings in what the hosts hold,
// hashing each file once, as it arrives. Nothing is ever removed.
//
//   node host/builds.mjs                          revisions by name, newest first
//   node host/builds.mjs show <version|sig>       what it changed, who signed it
//   node host/builds.mjs out <version|sig> <dir>  write one revision's origin
//   node host/builds.mjs publish <version|sig> [--azure] [-- deploy args]
//   node host/builds.mjs sign <version|sig> --as author|reviewer|witness
//   node host/builds.mjs take <origin dir>        bring in a published revision
//   node host/builds.mjs push [host dir]          carry the pools to a host
//   node host/builds.mjs push --r2 [--dry-run]    …to R2, for the subdomain worker
//   node host/builds.mjs pull [host…]             bring in the hosts' pools
//
// Pools live under HYPERCOMB_POOLS_DIR (default ~/.hypercomb). The signing key
// is read from HYPERCOMB_SIGNER_KEY (64 hex) or the file HYPERCOMB_SIGNER_KEY_FILE.
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, open, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BUILDS_MEANING = 'host:builds'
export const SIGNATURES_MEANING = 'host:build-signatures'
export const ROLES = ['author', 'reviewer', 'witness']
export const BUILD_SIGNATURE_KIND = 30567
export const DEFAULT_LABEL = 'host'
/** runtime host-zones.ts DEFAULT_HOST_ZONES: where pools are pulled from. */
export const DEFAULT_HOSTS = ['jwize.com', 'hypercomb.com']
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
const tag = (event, name) => event?.tags?.find?.(t => t[0] === name)?.[1]

/** Every signature event a pool directory holds: [{ file, event }]. */
export const readSignatures = async (root = poolDir(SIGNATURES_MEANING)) => {
  const out = []
  for (const file of await readdir(root).catch(() => [])) {
    if (!SIG.test(file)) continue
    try { out.push({ file, event: JSON.parse(await readFile(resolve(root, file), 'utf8')) }) } catch { /* not an event */ }
  }
  return out
}

/** A build's signatures, each checked: [{ role, pubkey, ok }], one per signer and role. */
export const signaturesOf = async (buildSig, version, held) => {
  const mine = (held ?? await readSignatures()).filter(({ event }) => tag(event, 'b') === buildSig)
  if (!mine.length) return []
  const { verifyEvent } = await import('nostr-tools/pure')
  const seen = new Map()
  for (const { event } of mine) {
    const role = tag(event, 'r')
    const ok = ROLES.includes(role) && event.kind === BUILD_SIGNATURE_KIND
      && event.content === signaturePreimage(buildSig, version, role) && verifyEvent(event)
    const key = `${role}\n${event.pubkey}`
    seen.set(key, { role, pubkey: event.pubkey, ok: ok || seen.get(key)?.ok === true })
  }
  return [...seen.values()].sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || (a.pubkey < b.pubkey ? -1 : 1))
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
  const pool = poolDir(SIGNATURES_MEANING)
  await mkdir(pool, { recursive: true })
  const file = await keep(pool, Buffer.from(JSON.stringify(event)))
  return { sig, record, pubkey: event.pubkey, file }
}

// ── writing a revision out, and taking one in ────────────────────────────────
const put = async (path, bytes) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes) }

/** Write a revision's origin into `dir`, exactly as it was built, with its signatures. */
export const writeOut = async (ref, dir) => {
  const pool = poolDir(BUILDS_MEANING)
  const { sig, record } = await findRevision(ref)
  if ((await readdir(dir).catch(() => [])).length) throw new Error(`${dir} is not empty`)
  const install = await readJson(pool, record.install)
  for (const [path, fileSig] of Object.entries(install.files)) await put(resolve(dir, path), await readFile(resolve(pool, fileSig)))
  for (const atom of [...record.atoms, sig]) await put(resolve(dir, atom), await readFile(resolve(pool, atom)))
  await writeFile(resolve(dir, 'build'), sig + '\n', 'utf8')
  for (const { file, event } of await readSignatures()) {
    if (tag(event, 'b') === sig) await put(resolve(dir, sign(SIGNATURES_MEANING), file), await readFile(resolve(poolDir(SIGNATURES_MEANING), file)))
  }
  return { sig, record }
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

/** Admit a file into a pool: it must hash to its name. The one hash it gets. */
const admit = async (pool, name, bytes) => {
  if (sign(bytes) !== name) throw new Error(`${name.slice(0, 12)} does not hash to its name`)
  await mkdir(pool, { recursive: true })
  return keep(pool, bytes)
}

/** Bring a published revision in, with every pool the directory carries. */
export const takeIn = async dir => {
  const pool = poolDir(BUILDS_MEANING)
  await mkdir(pool, { recursive: true })
  const sig = (await readFile(resolve(dir, 'build'), 'utf8')).trim()
  await admit(pool, sig, await readFile(resolve(dir, sig)))
  const record = await readJson(pool, sig)
  for (const atom of record.atoms) await admit(pool, atom, await readFile(resolve(dir, atom)))
  const install = await layer(pool, 'install', await installFilesOf(dir))
  if (install !== record.install) throw new Error(`the origin's files are not the install ${record.version} recorded`)
  await takePools(dir)
  if (!await headOf(pool)) await writeFile(resolve(pool, 'head'), sig + '\n', 'utf8')
  return { sig, record, signatures: await signaturesOf(sig, record.version) }
}

/** Admit every member of the two pools a host directory carries. */
const takePools = async dir => {
  let taken = 0
  for (const meaning of [BUILDS_MEANING, SIGNATURES_MEANING]) {
    const from = resolve(dir, sign(meaning))
    const into = poolDir(meaning)
    const held = new Set(await readdir(into).catch(() => []))
    for (const name of await readdir(from).catch(() => [])) {
      if (!SIG.test(name) || held.has(name)) continue
      await admit(into, name, await readFile(resolve(from, name)))
      taken++
    }
  }
  return taken
}

// ── the pools on hosts ───────────────────────────────────────────────────────
/**
 * Carry both pools into a host directory: `<dir>/<sign(meaning)>/<sig>`, and
 * the pool's listing as its `index.html` (names, one per line — what a static
 * host serves at `/<sign(meaning)>/`). Additive: what the host holds stays.
 */
export const carryPools = async dir => {
  let carried = 0
  for (const meaning of [BUILDS_MEANING, SIGNATURES_MEANING]) {
    const from = poolDir(meaning)
    const into = resolve(dir, sign(meaning))
    await mkdir(into, { recursive: true })
    const held = new Set(await readdir(into))
    for (const name of await readdir(from).catch(() => [])) {
      if (!SIG.test(name) || held.has(name)) continue
      await writeFile(resolve(into, name), await readFile(resolve(from, name)))
      carried++
    }
    const members = (await readdir(into)).filter(name => SIG.test(name)).sort()
    await writeFile(resolve(into, 'index.html'), members.join('\n'), 'utf8')
  }
  return carried
}

/**
 * Carry both pools into R2 (the bucket behind content.jwize.com and the
 * *.jwize.com / *.hypercomb.com worker) at `<pool>/<member>`, where the worker
 * serves a listed pool's members. What `via` already lists is skipped.
 */
export const pushToR2 = async ({ bucket = 'hypercomb-content', via = 'https://content.jwize.com', put, fetch: get = fetch, dryRun = false } = {}) => {
  const report = { uploaded: 0, present: 0, failed: 0 }
  for (const meaning of [BUILDS_MEANING, SIGNATURES_MEANING]) {
    const pool = sign(meaning)
    const from = poolDir(meaning)
    const listing = await get(`${via}/${pool}/`, { cache: 'no-store' }).catch(() => null)
    const present = new Set(listing?.ok ? (await listing.text()).split(/\r?\n/).map(n => n.trim()) : [])
    for (const name of await readdir(from).catch(() => [])) {
      if (!SIG.test(name)) continue
      if (present.has(name)) { report.present++; continue }
      const path = resolve(from, name)
      const first = (await readFile(path)).subarray(0, 1).toString()
      const type = first === '{' || first === '[' ? 'application/json' : 'application/octet-stream'
      try {
        if (!dryRun) await put(`${bucket}/${pool}/${name}`, path, type)
        report.uploaded++
      } catch (e) {
        report.failed++
        if (report.failed <= 3) console.warn(`[builds] r2 put failed: ${name.slice(0, 12)} — ${String(e.message).slice(0, 120)}`)
      }
    }
  }
  return report
}

// Wrangler as the relay's worker installs it, entered directly (Node will not
// spawn npx.cmd on Windows). It reads the operator's Cloudflare login.
const WORKER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'hypercomb-relay', 'blossom-worker')
const wranglerPut = async (key, file, type) => {
  const wrangler = resolve(WORKER_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
  await access(wrangler).catch(() => { throw new Error(`wrangler is not installed — npm install in ${WORKER_DIR}`) })
  execFileSync(process.execPath, [wrangler, 'r2', 'object', 'put', key, '--file', file, '--content-type', type, '--remote'],
    { cwd: WORKER_DIR, stdio: 'pipe', timeout: 60_000 })
}

/** Where a host's pools are read: its root, then its /content. */
const basesOf = host => {
  const base = /^https?:\/\//.test(host) ? host.replace(/\/+$/, '') : `https://${host}`
  return [base, `${base}/content`]
}

/** Bring in what the hosts hold of both pools, each file hashed once on arrival. */
export const pullPools = async (hosts = DEFAULT_HOSTS, { fetch: get = fetch } = {}) => {
  const report = []
  for (const host of hosts) {
    let taken = 0
    let refused = 0
    let answered = false
    for (const base of basesOf(host)) {
      for (const meaning of [BUILDS_MEANING, SIGNATURES_MEANING]) {
        const pool = sign(meaning)
        const listing = await get(`${base}/${pool}/`, { cache: 'no-store' }).catch(() => null)
        if (!listing?.ok) continue
        answered = true
        const names = (await listing.text()).split(/\r?\n/).map(n => n.trim()).filter(n => SIG.test(n))
        const into = poolDir(meaning)
        const held = new Set(await readdir(into).catch(() => []))
        const wanted = names.filter(n => !held.has(n))
        for (let i = 0; i < wanted.length; i += 8) {
          await Promise.all(wanted.slice(i, i + 8).map(async name => {
            const response = await get(`${base}/${pool}/${name}`).catch(() => null)
            if (!response?.ok) return
            // A file that does not hash to its name is refused, not kept.
            if (sign(Buffer.from(await response.clone().arrayBuffer())) !== name) { refused++; return }
            await admit(into, name, Buffer.from(await response.arrayBuffer()))
            taken++
          }))
        }
      }
      if (answered) break
    }
    report.push({ host, answered, taken, refused })
  }
  const pool = poolDir(BUILDS_MEANING)
  if (!await headOf(pool)) {
    const newest = (await revisions(pool))[0]
    if (newest) await writeFile(resolve(pool, 'head'), newest.sig + '\n', 'utf8')
  }
  return report
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
  const held = await readSignatures()
  // One heading per name; the name with the newest revision leads.
  const byLabel = new Map()
  for (const r of all) byLabel.set(r.record.label, [...(byLabel.get(r.record.label) ?? []), r])
  for (const [label, rows] of byLabel) {
    console.log(label)
    for (const { sig, record } of rows) {
      const { parts, files } = await changesOf(pool, record)
      const count = Object.values(files).reduce((n, f) => n + f.length, 0)
      const what = parts.length ? parts.join(' ') + (count ? ` · ${count} files` : '') : 'no change'
      console.log(`   ${record.version.padEnd(13)} ${short(sig)}  ${what}${signersLine(await signaturesOf(sig, record.version, held))}`)
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
    await carryPools(dir)
    const env = { ...process.env, HYPERCOMB_HOST_OUT_DIR: dir }
    const run = script => {
      const result = spawnSync(process.execPath, [resolve(here, script), ...args.filter(a => a !== '--azure')], { env, stdio: 'inherit' })
      if (result.status !== 0) throw new Error(`${script} failed`)
    }
    run('check-pure.mjs')
    console.log(`[builds] publishing ${record.label} ${record.version} with the version pools`)
    run(args.includes('--azure') ? 'deploy-azure.mjs' : 'deploy-cloudflare.mjs')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// The machine relay behind jwize.com serves this directory (hypercomb-relay).
const RELAY_CONTENT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'hypercomb-relay', 'content')

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ref, ...rest] = process.argv.slice(2)
  const flag = name => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined }
  try {
    if (!command) await list()
    else if (command === 'show') await show(ref)
    else if (command === 'out') {
      if (!rest[0]) throw new Error('out wants a directory')
      const dir = resolve(rest[0])
      const { sig, record } = await writeOut(ref, dir)
      console.log(`${record.label} ${record.version} ${short(sig)} → ${dir}`)
    } else if (command === 'publish') await publish(ref, rest.filter(a => a !== '--'))
    else if (command === 'sign') {
      const { record, pubkey } = await signRevision(ref, flag('--as'))
      console.log(`${record.label} ${record.version} signed as ${flag('--as')} by ${pubkey}`)
    } else if (command === 'take') {
      const { record, sig, signatures } = await takeIn(resolve(ref))
      console.log(`took ${record.label} ${record.version} ${short(sig)}${signersLine(signatures)}`)
    } else if (command === 'push') {
      const args = [ref, ...rest].filter(Boolean)
      if (args.includes('--r2')) {
        const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
        const dryRun = args.includes('--dry-run')
        const { uploaded, present, failed } = await pushToR2({ bucket: option('--bucket'), via: option('--via'), put: wranglerPut, dryRun })
        console.log(`r2: ${dryRun ? 'would upload' : 'uploaded'} ${uploaded}, already there ${present}, failed ${failed}`)
        if (failed) process.exitCode = 1
      } else {
        const dir = resolve(args[0] ?? RELAY_CONTENT)
        await access(dir).catch(() => { throw new Error(`${dir} does not exist — name the host's content directory`) })
        const carried = await carryPools(dir)
        console.log(`carried ${carried} new file(s) into ${dir}`)
      }
      console.log(`a host lists a pool only when its operator declares it; once, in the hive:\n  hosts list ${BUILDS_MEANING} @<host>\n  hosts list ${SIGNATURES_MEANING} @<host>`)
    } else if (command === 'pull') {
      for (const { host, answered, taken, refused } of await pullPools([ref, ...rest].filter(Boolean).length ? [ref, ...rest].filter(Boolean) : DEFAULT_HOSTS)) {
        console.log(`${host.padEnd(24)} ${answered ? `${taken} new file(s)${refused ? `, ${refused} refused (not what they are named)` : ''}` : 'holds no version pools'}`)
      }
    } else throw new Error(`unknown command "${command}"`)
  } catch (e) {
    console.error(`[builds] ${e.message}`)
    process.exit(1)
  }
}
