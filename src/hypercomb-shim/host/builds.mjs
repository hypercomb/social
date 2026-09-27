#!/usr/bin/env node
// THE VERSION POOL, IN STORIES. Work is told as stories: a story is a named
// layer of work with a description, inside a larger story, so each layer
// holds its part of the bigger picture. A story's revisions are signed
// records in the sign('host:builds') pool, chained build to build, so a
// release's history is held by signature on any device that keeps the pool,
// with no forge in the middle.
//
//   story     { name: 'story', label, description, within, at }
//   revision  { name: 'build', label, version, parent, install, host,
//               library, hostPackage, atoms, source, conversations? }
//
// STAGE, THEN PROMOTE. A build STAGES: it rewrites its story's one staged
// revision (version 'staged'), local and unsigned, so work in progress never
// piles up in the lineage. `promote` is the one act that appends: the staged
// revision becomes the story's next version (year.month.day.n, UTC), chained
// to the last promoted build, signed by its author when a key is at hand,
// and carried to every subscribed host. What only a replaced stage named is
// collected; nothing promoted is ever removed.
//
// THE CONVERSATIONS that did the work ride with it: `attach` keeps a
// transcript in the pool and the promoted revision names it. Attached files
// are published with the revision.
//
// PARTICIPANTS sign a revision with the nostr key their hive already uses
// (secp256k1 Schnorr, the key NostrSigner holds): a nostr event of kind 30567
// kept in sign('host:build-signatures') under the signature of its own bytes.
// Roles: author, reviewer, and witness — a witness signs only a build they
// reproduced: a revision of their own with the same outputs.
//
// THE POOLS TRAVEL, promoted work only. `/<sign(meaning)>/` lists a pool's
// members and `/<sign(meaning)>/<sig>` is one, on any host. `push` carries
// them to a host directory or R2, `subscribe` makes every promotion carry
// them there by itself (`sync` retries), and `pull` brings in what the hosts
// hold, hashing each file once, as it arrives.
//
//   node host/builds.mjs                          stories, their stage and revisions
//   node host/builds.mjs story <label> "<what it is>" [--within <label>]
//   node host/builds.mjs attach <label> <file>    a conversation behind the work
//   node host/builds.mjs promote <label> [--no-sync]
//   node host/builds.mjs show <version|sig|label> what it changed, who signed it
//   node host/builds.mjs subscribe <dir|r2[:bucket]> / unsubscribe / sync
//   node host/builds.mjs out <version|sig> <dir>  write one revision's origin
//   node host/builds.mjs publish <version|sig> [--azure] [-- deploy args]
//   node host/builds.mjs sign <version|sig> --as author|reviewer|witness
//   node host/builds.mjs take <origin dir>        bring in a published revision
//   node host/builds.mjs push [host dir] | push --r2 [--dry-run]
//   node host/builds.mjs pull [host…]             bring in the hosts' pools
//
// Pools live under HYPERCOMB_POOLS_DIR (default ~/.hypercomb); the stage and
// the subscriptions in its `local/`, which never travels. The signing key is
// read from HYPERCOMB_SIGNER_KEY (64 hex) or the file HYPERCOMB_SIGNER_KEY_FILE.
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, open, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BUILDS_MEANING = 'host:builds'
export const SIGNATURES_MEANING = 'host:build-signatures'
export const ROLES = ['author', 'reviewer', 'witness']
export const BUILD_SIGNATURE_KIND = 30567
export const DEFAULT_LABEL = 'host'
export const STAGED = 'staged'
/** runtime host-zones.ts DEFAULT_HOST_ZONES: where pools are pulled from. */
export const DEFAULT_HOSTS = ['jwize.com', 'hypercomb.com']
const SIG = /^[a-f0-9]{64}$/
const OUTPUT_PARTS = ['install', 'host', 'library', 'hostPackage', 'atoms']
const PARTS = ['install', 'host', 'library', 'hostPackage', 'source']

export const sign = bytes => createHash('sha256').update(bytes).digest('hex')
const poolsRoot = () => resolve(process.env.HYPERCOMB_POOLS_DIR || resolve(homedir(), '.hypercomb'))
export const poolDir = meaning => resolve(poolsRoot(), sign(meaning))
const localFile = name => resolve(poolsRoot(), 'local', name)

/** A story's label is also a channel: lowercase letters, digits and hyphens, from a letter. */
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const readLocal = async (name, fallback) => { try { return JSON.parse(await readFile(localFile(name), 'utf8')) } catch { return fallback } }
const writeLocal = async (name, value) => { await mkdir(dirname(localFile(name)), { recursive: true }); await writeFile(localFile(name), JSON.stringify(value, null, 2) + '\n') }

/** The stage: label → { record, conversations }. Local, never carried. */
export const readStage = () => readLocal('stage.json', {})
const writeStage = stage => writeLocal('stage.json', stage)

/** A layer of files: each kept under its signature, the layer names them by path. */
const layer = async (pool, name, files) => {
  const named = {}
  for (const [path, bytes] of [...files].sort(([a], [b]) => a < b ? -1 : 1)) named[path] = await keep(pool, bytes)
  return keep(pool, Buffer.from(JSON.stringify({ name, files: named })))
}

/** Every record the pool holds, found by its first bytes: revisions and stories. */
const scan = async (pool = poolDir(BUILDS_MEANING)) => {
  const builds = [], stories = []
  const isBuild = Buffer.from('{"name":"build",'), isStory = Buffer.from('{"name":"story",')
  for (const name of await readdir(pool).catch(() => [])) {
    if (!SIG.test(name)) continue
    const handle = await open(resolve(pool, name))
    const head = Buffer.alloc(isBuild.length)
    await handle.read(head, 0, head.length, 0).finally(() => handle.close())
    if (head.equals(isBuild)) builds.push({ sig: name, record: await readJson(pool, name) })
    else if (head.equals(isStory)) stories.push({ sig: name, record: await readJson(pool, name) })
  }
  return { builds, stories }
}
const order = version => version.split('.').map(Number).reduce((n, part, i) => n + part * [1e8, 1e6, 1e4, 1][i], 0)

/** Promoted revisions, newest first; with `staged`, each story's current stage too. */
export const revisions = async (pool = poolDir(BUILDS_MEANING), { staged = false } = {}) => {
  const { builds } = await scan(pool)
  const promoted = builds.filter(r => r.record.version !== STAGED)
    .sort((a, b) => order(b.record.version) - order(a.record.version) || (a.sig < b.sig ? -1 : 1))
  if (!staged) return promoted
  const current = new Set(Object.values(await readStage()).map(e => e.record).filter(Boolean))
  return [...builds.filter(r => r.record.version === STAGED && current.has(r.sig)), ...promoted]
}

/** Each story as last told: label → { description, within, sig }. */
export const stories = async (pool = poolDir(BUILDS_MEANING)) => {
  const latest = new Map()
  for (const { sig, record } of (await scan(pool)).stories) {
    const held = latest.get(record.label)
    if (!held || record.at > held.at || (record.at === held.at && sig > held.sig)) latest.set(record.label, { ...record, sig })
  }
  return latest
}

/** Tell (or retell) a story. A retelling is a new record; the newest is the story. */
export const tellStory = async (label, description, { within = null, now = new Date() } = {}) => {
  const pool = poolDir(BUILDS_MEANING)
  await mkdir(pool, { recursive: true })
  const record = { name: 'story', label: foldLabel(label), description: String(description ?? '').trim(), within: within ? foldLabel(within) : null, at: now.toISOString() }
  if (record.within === record.label) throw new Error('a story cannot be within itself')
  return { sig: await keep(pool, Buffer.from(JSON.stringify(record))), record }
}

/** The next version of the day: n counts the promoted revisions the pool
 *  holds for that day, taken ones included, so no two share a version. */
const nextVersion = async (pool, now) => {
  const day = `${now.getUTCFullYear()}.${now.getUTCMonth() + 1}.${now.getUTCDate()}`
  const n = (await revisions(pool))
    .filter(r => r.record.version.startsWith(day + '.'))
    .reduce((max, r) => Math.max(max, Number(r.record.version.slice(day.length + 1))), 0)
  return `${day}.${n + 1}`
}

/**
 * Stage a build: it becomes its story's one staged revision, replacing the
 * last. `install` and `source` map path → bytes; `signed` holds the origin's
 * signature-named atoms.
 */
export const recordBuild = async ({ label, install, source, signed, host, library, hostPackage }) => {
  const pool = poolDir(BUILDS_MEANING)
  await mkdir(pool, { recursive: true })
  const story = foldLabel(label)
  const atoms = []
  for (const bytes of signed) atoms.push(await keep(pool, bytes))
  const parentSig = await headOf(pool)
  const parent = await readJson(pool, parentSig)
  const record = {
    name: 'build', label: story, version: STAGED, parent: parentSig,
    install: await layer(pool, 'install', install), host, library, hostPackage,
    atoms: atoms.sort(), source: await layer(pool, 'source', source),
  }
  const bytes = Buffer.from(JSON.stringify(record))
  const sig = await keep(pool, bytes)
  const stage = await readStage()
  stage[story] = { ...(stage[story] ?? { conversations: [] }), record: sig }
  await writeStage(stage)
  await collect()
  return { sig, record, bytes, pool, unchanged: !!parent && PARTS.every(k => same(parent[k], record[k])) }
}

/** Keep a conversation that did a story's work; its promotion will name it. */
export const attachConversation = async (label, file) => {
  const pool = poolDir(BUILDS_MEANING)
  await mkdir(pool, { recursive: true })
  const story = foldLabel(label)
  const sig = await keep(pool, await readFile(file))
  const stage = await readStage()
  const entry = stage[story] ?? { record: null, conversations: [] }
  if (!entry.conversations.includes(sig)) entry.conversations.push(sig)
  stage[story] = entry
  await writeStage(stage)
  return { sig, story }
}

/**
 * Promote a story's staged revision: it becomes the next version, chained to
 * the last promoted build, signed by its author when a key is at hand, and
 * carried to every subscribed host unless `sync` is false.
 */
export const promote = async (label, { now = new Date(), sync: carry = true, put, sign: signIt = true } = {}) => {
  const pool = poolDir(BUILDS_MEANING)
  const story = foldLabel(label)
  const stage = await readStage()
  const entry = stage[story]
  if (!entry?.record) throw new Error(`nothing staged for "${story}" — build with --story ${story} first`)
  const staged = await readJson(pool, entry.record)
  const record = {
    ...staged,
    version: await nextVersion(pool, now),
    parent: await headOf(pool),
    ...(entry.conversations?.length ? { conversations: [...entry.conversations] } : {}),
  }
  const sig = await keep(pool, Buffer.from(JSON.stringify(record)))
  await writeFile(resolve(pool, 'head'), sig + '\n', 'utf8')
  delete stage[story]
  await writeStage(stage)
  await collect()
  let signed = false
  if (signIt) try { await signRevision(sig, 'author', now); signed = true } catch { /* no key at hand: sign later */ }
  const synced = carry ? await sync({ put }) : []
  return { sig, record, signed, synced }
}

/** Everything a set of records needs: themselves, their layers, files, atoms, conversations. */
const closureOf = async (pool, sigs) => {
  const reach = new Set()
  for (const sig of sigs) {
    reach.add(sig)
    const record = await readJson(pool, sig).catch(() => null)
    if (!record) continue
    for (const part of ['install', 'source']) {
      if (!record[part]) continue
      reach.add(record[part])
      const files = (await readJson(pool, record[part]).catch(() => null))?.files ?? {}
      for (const file of Object.values(files)) reach.add(file)
    }
    for (const sig of [...(record.atoms ?? []), ...(record.conversations ?? [])]) reach.add(sig)
  }
  return reach
}

/** What may travel: promoted revisions and what they name, every story, and
 *  the signatures of promoted revisions. Staged work never leaves the device. */
export const published = async () => {
  const pool = poolDir(BUILDS_MEANING)
  const { builds, stories: told } = await scan(pool)
  const promoted = builds.filter(r => r.record.version !== STAGED).map(r => r.sig)
  const buildsSet = await closureOf(pool, promoted)
  for (const { sig } of told) buildsSet.add(sig)
  const promotedSet = new Set(promoted)
  const signatures = new Set((await readSignatures()).filter(({ event }) => promotedSet.has(tag(event, 'b'))).map(({ file }) => file))
  return { [BUILDS_MEANING]: buildsSet, [SIGNATURES_MEANING]: signatures }
}

/** Remove what only a replaced stage named. Promoted work, stories and the
 *  current stage are never touched. */
export const collect = async () => {
  const pool = poolDir(BUILDS_MEANING)
  const { builds, stories: told } = await scan(pool)
  const stage = await readStage()
  const live = [
    ...builds.filter(r => r.record.version !== STAGED).map(r => r.sig),
    ...Object.values(stage).map(e => e.record).filter(Boolean),
  ]
  const reach = await closureOf(pool, live)
  for (const { sig } of told) reach.add(sig)
  for (const entry of Object.values(stage)) for (const sig of entry.conversations ?? []) reach.add(sig)
  let removed = 0
  for (const name of await readdir(pool).catch(() => [])) {
    if (SIG.test(name) && !reach.has(name)) { await unlink(resolve(pool, name)).catch(() => {}); removed++ }
  }
  return removed
}

export const findRevision = async ref => {
  const all = await revisions(undefined, { staged: true })
  const stage = await readStage()
  const byLabel = ref && stage[ref]?.record ? all.filter(r => r.sig === stage[ref].record) : []
  const hit = byLabel.length ? byLabel : all.filter(r => (r.record.version === ref && ref !== STAGED) || (ref?.length >= 6 && r.sig.startsWith(ref)))
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
    // Their own build of it stages, so the stage counts as a reproduction.
    const reproduced = (await revisions(undefined, { staged: true })).find(r => r.sig !== sig && OUTPUT_PARTS.every(k => same(r.record[k], record[k])))
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
      // Signed files are atoms, and the version pools travel on their own; a
      // spot's pool of meaning (a signature-named directory) is part of the origin.
      if (dir === dist && ((SIG.test(entry.name) && !entry.isDirectory()) || skip.has(entry.name) || entry.name === 'build')) continue
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
  // A pool with no builds of its own continues from a promoted revision it took.
  if (!await headOf(pool) && record.version !== STAGED) await writeFile(resolve(pool, 'head'), sig + '\n', 'utf8')
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
 * THE ATOMS A KERNEL ASKS FOR. A pure install whose origin lacks its host
 * bundle, core library or host package asks the default hosts for them at
 * `/<sig>` (kernel.ts, host-package.ts). Every promoted revision's atoms, so
 * a kernel baked by any released build still finds its host in the wild.
 */
export const releaseAtoms = async () => [...new Set((await revisions()).flatMap(r => r.record.atoms))].sort()

/**
 * Carry both pools, promoted work only, into a host directory:
 * `<dir>/<sign(meaning)>/<sig>`, and the pool's listing as its `index.html`
 * (names, one per line — what a static host serves at `/<sign(meaning)>/`).
 * With `atoms`, every promoted revision's atoms too, flat at `<dir>/<sig>`.
 * Additive: what the host holds stays.
 */
export const carryPools = async (dir, { atoms = false } = {}) => {
  let carried = 0
  await mkdir(dir, { recursive: true })
  if (atoms) {
    const from = poolDir(BUILDS_MEANING)
    const held = new Set(await readdir(dir))
    for (const atom of await releaseAtoms()) {
      if (held.has(atom)) continue
      await writeFile(resolve(dir, atom), await readFile(resolve(from, atom)))
      carried++
    }
  }
  const travels = await published()
  for (const meaning of [BUILDS_MEANING, SIGNATURES_MEANING]) {
    const from = poolDir(meaning)
    const into = resolve(dir, sign(meaning))
    await mkdir(into, { recursive: true })
    const held = new Set(await readdir(into))
    for (const name of travels[meaning]) {
      if (held.has(name)) continue
      await writeFile(resolve(into, name), await readFile(resolve(from, name)))
      carried++
    }
    const members = (await readdir(into)).filter(name => SIG.test(name)).sort()
    await writeFile(resolve(into, 'index.html'), members.join('\n'), 'utf8')
  }
  return carried
}

/**
 * Carry both pools, promoted work only, into R2 (the bucket behind
 * content.jwize.com and the *.jwize.com / *.hypercomb.com worker) at
 * `<pool>/<member>`, and the atoms flat at `<sig>`. What `via` already
 * answers is skipped.
 */
export const pushToR2 = async ({ bucket = 'hypercomb-content', via = 'https://content.jwize.com', put, fetch: get = fetch, dryRun = false } = {}) => {
  const report = { uploaded: 0, present: 0, failed: 0 }
  const upload = async (key, path, name) => {
    const first = (await readFile(path)).subarray(0, 1).toString()
    const type = first === '{' || first === '[' ? 'application/json' : 'text/javascript'
    try {
      if (!dryRun) await put(key, path, type)
      report.uploaded++
    } catch (e) {
      report.failed++
      if (report.failed <= 3) console.warn(`[builds] r2 put failed: ${name.slice(0, 12)} — ${String(e.message).slice(0, 120)}`)
    }
  }
  for (const atom of await releaseAtoms()) {
    const there = await get(`${via}/${atom}`, { method: 'HEAD' }).catch(() => null)
    if (there?.ok) { report.present++; continue }
    await upload(`${bucket}/${atom}`, resolve(poolDir(BUILDS_MEANING), atom), atom)
  }
  const travels = await published()
  for (const meaning of [BUILDS_MEANING, SIGNATURES_MEANING]) {
    const pool = sign(meaning)
    const from = poolDir(meaning)
    const listing = await get(`${via}/${pool}/`, { cache: 'no-store' }).catch(() => null)
    const present = new Set(listing?.ok ? (await listing.text()).split(/\r?\n/).map(n => n.trim()) : [])
    for (const name of [...travels[meaning]].sort()) {
      if (present.has(name)) { report.present++; continue }
      await upload(`${bucket}/${pool}/${name}`, resolve(from, name), name)
    }
  }
  return report
}

// ── subscriptions: every promotion reaches the hosts by itself ───────────────
/** Where promoted work is carried: a host directory (the jwize.com relay's
 *  content dir) or R2 (`r2` or `r2:<bucket>`). Each remembers the head it last
 *  received, so a promotion that did not arrive is visible and `sync` retries. */
export const readSubscriptions = () => readLocal('subscriptions.json', [])
const writeSubscriptions = subs => writeLocal('subscriptions.json', subs)
const subscriptionKey = to => /^r2(:|$)/.test(to) ? to : resolve(to)

export const subscribe = async to => {
  const subs = await readSubscriptions()
  const key = subscriptionKey(to)
  if (!subs.some(s => s.to === key)) subs.push({ to: key, synced: null, at: null })
  await writeSubscriptions(subs)
  return key
}
export const unsubscribe = async to => {
  const key = subscriptionKey(to)
  await writeSubscriptions((await readSubscriptions()).filter(s => s.to !== key))
  return key
}

/** Carry promoted work to every subscription: [{ to, ok, detail }]. */
export const sync = async ({ put = wranglerPut, now = new Date() } = {}) => {
  const subs = await readSubscriptions()
  const head = await headOf(poolDir(BUILDS_MEANING))
  const report = []
  for (const sub of subs) {
    try {
      let detail
      if (sub.to.startsWith('r2')) {
        const bucket = sub.to.split(':')[1] || undefined
        const r = await pushToR2({ bucket, put })
        if (r.failed) throw new Error(`${r.failed} upload(s) failed`)
        detail = `${r.uploaded} uploaded, ${r.present} already there`
      } else {
        await access(sub.to).catch(() => { throw new Error('the directory is not there') })
        detail = `${await carryPools(sub.to, { atoms: true })} new file(s)`
      }
      sub.synced = head; sub.at = now.toISOString()
      report.push({ to: sub.to, ok: true, detail })
    } catch (e) {
      report.push({ to: sub.to, ok: false, detail: e.message })
    }
  }
  await writeSubscriptions(subs)
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
const whatChanged = async (pool, record) => {
  const { parts, files } = await changesOf(pool, record)
  const count = Object.values(files).reduce((n, f) => n + f.length, 0)
  return parts.length ? parts.join(' ') + (count ? ` · ${count} files` : '') : 'no change'
}

/** Stories as a tree: each with its description, its stage, then its
 *  revisions newest first, then the stories within it. */
const list = async () => {
  const pool = poolDir(BUILDS_MEANING)
  const [all, told, stage, held] = await Promise.all([revisions(pool), stories(pool), readStage(), readSignatures()])
  const labels = new Set([...told.keys(), ...all.map(r => r.record.label), ...Object.keys(stage)])
  if (!labels.size) return console.log(`no stories in ${pool}`)
  const within = label => told.get(label)?.within ?? null
  const newest = label => all.find(r => r.record.label === label)?.record.version ?? ''
  const children = label => [...labels].filter(l => within(l) === label).sort((a, b) => order(newest(b) || '0') - order(newest(a) || '0') || (a < b ? -1 : 1))
  const print = async (label, depth) => {
    const pad = '   '.repeat(depth)
    const description = told.get(label)?.description
    console.log(`${pad}${label}${description ? ` — ${description}` : '   (untold: builds.mjs story ' + label + ' "…")'}`)
    const entry = stage[label]
    if (entry?.record) {
      const record = await readJson(pool, entry.record).catch(() => null)
      if (record) console.log(`${pad}   ${'staged'.padEnd(13)} ${short(entry.record)}  ${await whatChanged(pool, record)}${entry.conversations?.length ? ` · ${entry.conversations.length} conversation(s)` : ''}`)
    }
    for (const { sig, record } of all.filter(r => r.record.label === label)) {
      console.log(`${pad}   ${record.version.padEnd(13)} ${short(sig)}  ${await whatChanged(pool, record)}${record.conversations?.length ? ` · ${record.conversations.length} conversation(s)` : ''}${signersLine(await signaturesOf(sig, record.version, held))}`)
    }
    for (const child of children(label)) await print(child, depth + 1)
  }
  for (const label of [...labels].filter(l => !within(l) || !labels.has(within(l)))) await print(label, 0)
  const head = await headOf(pool)
  for (const sub of await readSubscriptions()) {
    if (sub.synced !== head) console.log(`\n⚠ ${sub.to} has not received the latest promotion — builds.mjs sync`)
  }
}

const show = async ref => {
  const pool = poolDir(BUILDS_MEANING)
  const { sig, record } = await findRevision(ref)
  const { parts, files } = await changesOf(pool, record)
  const story = (await stories(pool)).get(record.label)
  console.log(`${record.label} ${record.version}  ${sig}`)
  if (story?.description) console.log(`  story   ${story.description}`)
  console.log(`  parent  ${record.parent ?? '(none)'}`)
  console.log(`  changed ${parts.join(' ') || 'nothing'}`)
  for (const [k, lines] of Object.entries(files)) for (const line of lines) console.log(`  ${k.padEnd(7)} ${line}`)
  const conversations = record.version === STAGED ? (await readStage())[record.label]?.conversations ?? [] : record.conversations ?? []
  for (const c of conversations) console.log(`  conversation ${c}`)
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

const printSync = report => {
  for (const { to, ok, detail } of report) console.log(`  ${ok ? 'synced ' : 'NOT SYNCED'} ${to} — ${detail}`)
  if (report.some(r => !r.ok)) { console.log('  the promotion is kept here; builds.mjs sync carries it when the host is back'); process.exitCode = 1 }
}

// The machine relay behind jwize.com serves this directory (hypercomb-relay).
const RELAY_CONTENT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'hypercomb-relay', 'content')

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ref, ...rest] = process.argv.slice(2)
  const flag = name => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined }
  try {
    if (!command) await list()
    else if (command === 'story') {
      const words = rest.filter((a, i) => a !== '--within' && rest[i - 1] !== '--within')
      const { record } = await tellStory(ref, words.join(' '), { within: flag('--within') })
      console.log(`${record.label}${record.within ? ` (within ${record.within})` : ''} — ${record.description || '(no description)'}`)
    } else if (command === 'attach') {
      const { sig, story } = await attachConversation(ref, resolve(rest[0] ?? ''))
      console.log(`${story}: conversation ${short(sig)} attached — it is published with the promotion`)
    } else if (command === 'promote') {
      const { sig, record, signed, synced } = await promote(ref, { sync: !rest.includes('--no-sync') })
      console.log(`${record.label} ${record.version} ${short(sig)} promoted${signed ? ', signed as author' : ' (no signing key: builds.mjs sign ' + record.version + ' --as author)'}`)
      printSync(synced)
    } else if (command === 'subscribe') console.log(`subscribed: ${await subscribe(ref)} — every promotion is carried there`)
    else if (command === 'unsubscribe') console.log(`unsubscribed: ${await unsubscribe(ref)}`)
    else if (command === 'sync') printSync(await sync())
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
        const carried = await carryPools(dir, { atoms: true })
        console.log(`carried ${carried} new file(s) into ${dir} — promoted work and its atoms`)
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
