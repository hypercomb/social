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
//               library, hostPackage, atoms, tree, conversations? }
//   package   { name: 'build', label, version, parent, package, tree,
//               atoms, conversations? }
//
// EVERY REVISION CARRIES ITS SOURCE AS ITS TILES (host/source-tree.mjs):
// `tree` is what was built, drawn on the living primitive. A host's: a tile
// per unit its build compiled (kernel, processor, core library, host bundle,
// console bee, the spots), naming what it produced, with the files it read
// beneath. A package's: a tile per folder, bound to the cell the package
// runs; under it each bee as a beehavior and each compiled dependency as an
// atom; under those the files they were built from. So the code travels
// with the tiles it belongs to, by signature, and a device that holds the
// pool can write it back out (`source`) and build it again — no forge in
// the middle. (Revisions before this carry a flat `source` layer instead;
// both are read.)
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
//   node host/builds.mjs package [--story <label>] [--dir <package>]
//                                                 stage a package, its source as its tiles
//   node host/builds.mjs source <version|sig|label> <dir>
//                                                 write a revision's source back out
//   node host/builds.mjs publish <version|sig> [--azure] [-- deploy args]
//   node host/builds.mjs sign <version|sig> --as author|reviewer|witness
//   node host/builds.mjs take <origin dir>        bring in a published revision
//   node host/builds.mjs push [host dir] | push --r2 [--dry-run]
//   node host/builds.mjs pull [host…]             bring in the hosts' pools
//   node host/builds.mjs backup <dir>             every pool + local state to a disk you own
//   node host/builds.mjs restore <dir>            bring a backup back (verified)
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
import { hostTree, packageTree, walkTree } from './source-tree.mjs'

export const BUILDS_MEANING = 'host:builds'
export const SIGNATURES_MEANING = 'host:build-signatures'
export const ROLES = ['author', 'reviewer', 'witness']
export const BUILD_SIGNATURE_KIND = 30567
export const DEFAULT_LABEL = 'host'
export const STAGED = 'staged'
/** runtime host-zones.ts DEFAULT_HOST_ZONES: where pools are pulled from. */
/** The hosts `pull` asks by default: the operator's seed hosts when set. */
export const DEFAULT_HOSTS = (process.env.HYPERCOMB_SEED_HOSTS ?? '').split(',').map(h => h.trim()).filter(Boolean).length
  ? (process.env.HYPERCOMB_SEED_HOSTS ?? '').split(',').map(h => h.trim()).filter(Boolean)
  : ['jwize.com', 'hypercomb.com']
const SIG = /^[a-f0-9]{64}$/
const HERE = dirname(fileURLToPath(import.meta.url))
/** Where source paths are named from — the spots name theirs the same way. */
const REPO_ROOT = resolve(HERE, '..', '..', '..')
const ESSENTIALS = resolve(HERE, '..', '..', 'hypercomb-essentials')
const OUTPUT_PARTS = ['install', 'host', 'library', 'hostPackage', 'package', 'atoms']
const PARTS = ['install', 'host', 'library', 'hostPackage', 'source', 'package', 'tree', 'workspace']

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
  const builds = [], stories = [], served = []
  const isBuild = Buffer.from('{"name":"build",'), isStory = Buffer.from('{"name":"story",'), isServed = Buffer.from('{"name":"served",')
  for (const name of await readdir(pool).catch(() => [])) {
    if (!SIG.test(name)) continue
    const handle = await open(resolve(pool, name))
    const head = Buffer.alloc(isServed.length)
    await handle.read(head, 0, head.length, 0).finally(() => handle.close())
    const kind = head.equals(isServed) ? 'served' : head.subarray(0, isBuild.length).equals(isBuild) ? 'build' : head.subarray(0, isStory.length).equals(isStory) ? 'story' : null
    if (!kind) continue
    // The first bytes only sort; a tile named "build" or "story" (a unit, a
    // folder) starts the same way, so a record must also be one.
    const record = await readJson(pool, name).catch(() => null)
    if (typeof record?.label !== 'string') continue
    if (kind === 'build' && typeof record.version === 'string') builds.push({ sig: name, record })
    else if (kind === 'story') stories.push({ sig: name, record })
    else if (kind === 'served' && typeof record.at === 'string' && SIG.test(record.files ?? '')) served.push({ sig: name, record })
  }
  return { builds, stories, served }
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
 * THE WORKSPACE TRAVELS. A copy restored from the pools must be able to
 * author the next revision — change anything, build, promote — with no
 * repository and no forge behind it. The trees carry what each build
 * compiled; the workspace carries everything else a build of the minimal
 * system reads: the tooling (build.mjs, the host scripts, the essentials
 * build), every package's manifest and the lockfile that pins npm, the
 * configs, the host's static assets, core's own entry, and the documentation
 * the anatomy is built from. Traced (strace) against a full build — core, runtime,
 * package, host — every tracked file read lies under these roots.
 *
 * Read from git (tracked files only), so generated and ignored files never
 * travel; the build regenerates them. npm dependencies travel as the
 * lockfile, which pins each one by its integrity hash. Kept file by file, so
 * an unchanged file costs nothing in the next revision.
 */
export const WORKSPACE = [
  '.gitignore', 'tsconfig.base.json', 'src/.gitignore', 'src/package.json', 'src/package-lock.json', 'src/.npmrc', 'src/tsconfig*.json', 'src/vitest.config.ts', 'src/*/package.json',
  'src/hypercomb-core', 'src/hypercomb-runtime', 'src/hypercomb-shim', 'src/hypercomb-essentials',
  'src/hypercomb-shared/core', 'src/hypercomb-shared/styles', 'src/hypercomb-shared/package.json', 'src/hypercomb-shared/.gitignore', 'src/hypercomb-shared/tsconfig*.json',
  'src/scripts/pixi-vendor.mjs', 'src/documentation',
]

/** The workspaces a checkout installs: the ones WORKSPACE carries. The rest
 *  of the repository's workspaces (the Angular apps, the relay) do not travel. */
export const INSTALL_WORKSPACES = ['hypercomb-core', 'hypercomb-runtime', 'hypercomb-essentials', 'hypercomb-shim', 'hypercomb-shared']

/** How a checkout builds, in order, by the repository's own scripts: what the
 *  host imports (core, runtime), the package, then the host itself. */
export const AUTHOR_SCRIPTS = ['build:core', 'build:runtime', 'build:module', 'build:shim:pure']

/** The workspace's files, path → bytes, as the checkout at `repoRoot` holds them now. */
export const workspaceFiles = async (repoRoot = REPO_ROOT) => {
  // What the author has in the tree under the roots: tracked, and new files
  // not yet added (never what .gitignore hides). A restored copy is a fresh
  // repository, and a file created there is part of the next revision
  // whether or not git was told — the pools are the source control.
  const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...WORKSPACE], { cwd: repoRoot, maxBuffer: 256 << 20 })
  if (listed.status !== 0) throw new Error(`the workspace is read from git, and ${repoRoot} is not a checkout (builds.mjs checkout <dir> makes one)`)
  const files = new Map()
  for (const path of listed.stdout.toString('utf8').split('\0').filter(Boolean).sort()) {
    const bytes = await readFile(resolve(repoRoot, path)).catch(() => null)   // tracked but deleted here: not part of this build
    if (bytes) files.set(path, bytes)
  }
  return files
}

/**
 * Stage a build: it becomes its story's one staged revision, replacing the
 * last. `install` maps path → bytes; `units` are what the build compiled,
 * each with the files it read (source-tree.mjs hostTree); `signed` holds the
 * origin's signature-named atoms; `workspace` (workspaceFiles) is everything
 * else a rebuild reads.
 */
export const recordBuild = async ({ label, install, units, signed, host, library, hostPackage, workspace }) => {
  const pool = poolDir(BUILDS_MEANING)
  await mkdir(pool, { recursive: true })
  const story = foldLabel(label)
  const atoms = []
  // The atoms first: a spot's beehaviors are among them, and the tree names them.
  for (const bytes of signed) atoms.push(await keep(pool, bytes))
  const parentSig = await headOf(pool)
  const parent = await readJson(pool, parentSig)
  const { root } = await hostTree({ units, host, library, hostPackage, keep: bytes => keep(pool, bytes) })
  const record = {
    name: 'build', label: story, version: STAGED, parent: parentSig,
    install: await layer(pool, 'install', install), host, library, hostPackage,
    atoms: atoms.sort(), tree: root,
    ...(workspace ? { workspace: await layer(pool, 'workspace', workspace) } : {}),
  }
  return stageRecord(pool, story, record, parent)
}

/** Make a record its story's one staged revision. */
const stageRecord = async (pool, story, record, parent) => {
  const bytes = Buffer.from(JSON.stringify(record))
  const sig = await keep(pool, bytes)
  const stage = await readStage()
  stage[story] = { ...(stage[story] ?? { conversations: [] }), record: sig }
  await writeStage(stage)
  await collect()
  return { sig, record, bytes, pool, unchanged: !!parent && PARTS.every(k => same(parent[k], record[k])) }
}

/**
 * Stage a package (default: hypercomb-essentials, as last built) in its story
 * (default: its folder's name): the package it runs, every atom of it, and
 * its source as its tiles. Refused if a source changed since the build.
 */
export const recordPackage = async ({ label, packageDir = ESSENTIALS, repoRoot = REPO_ROOT } = {}) => {
  const pool = poolDir(BUILDS_MEANING)
  await mkdir(pool, { recursive: true })
  const story = foldLabel(label ?? packageDir.split(sep).pop())
  const { root, packageSig, atoms, files } = await packageTree({ packageDir, repoRoot, keep: bytes => keep(pool, bytes) })
  for (const atom of atoms) {
    const bytes = await readFile(resolve(packageDir, 'dist', atom))
    if (sign(bytes) !== atom) throw new Error(`package file ${short(atom)} does not hash to its name — rebuild the package`)
    await keep(pool, bytes)
  }
  const parent = await previousOf(pool, { label: story, version: STAGED })
  const record = { name: 'build', label: story, version: STAGED, parent: await headOf(pool), package: packageSig, tree: root, atoms }
  return { ...await stageRecord(pool, story, record, parent), files }
}

/** The revision a story had before this one: its newest promotion for a
 *  stage, the promotion before it for a promoted version. */
const previousOf = async (pool, record) => (await revisions(pool)).find(r => r.record.label === record.label
  && (record.version === STAGED || order(r.record.version) < order(record.version)))?.record ?? null

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
    for (const part of ['install', 'source', 'workspace']) {
      if (!record[part]) continue
      reach.add(record[part])
      const files = (await readJson(pool, record[part]).catch(() => null))?.files ?? {}
      for (const file of Object.values(files)) reach.add(file)
    }
    for (const sig of [...(record.atoms ?? []), ...(record.conversations ?? [])]) reach.add(sig)
    if (record.tree) for (const sig of (await walkTree(record.tree, s => readJson(pool, s).catch(() => null))).reach) reach.add(sig)
  }
  return reach
}

/**
 * NOTHING TRAVELS UNLESS ITS AUTHOR SIGNED IT. A follower keeps what it is
 * given as history, so an unsigned revision reaching one is history nobody
 * vouched for — and indistinguishable, there, from a forgery. A promotion with
 * no key at hand still promotes HERE; it stays home until `builds.mjs sign
 * <version> --as author` vouches for it, and the next sync carries it. A
 * served snapshot is held to the same rule. (A signed revision whose parent is
 * still unsigned travels without that parent: the unsigned link stays home.)
 */
const vouched = async (records, held, versionOf = r => r.record.version) => {
  const out = []
  for (const r of records) {
    if ((await signaturesOf(r.sig, versionOf(r), held)).some(s => s.role === 'author' && s.ok)) out.push(r)
  }
  return out
}

/** Promoted revisions that will not travel: no verifying author signature. */
export const unvouched = async () => {
  const { builds } = await scan(poolDir(BUILDS_MEANING))
  const promoted = builds.filter(r => r.record.version !== STAGED)
  const ok = new Set((await vouched(promoted, await readSignatures())).map(r => r.sig))
  return promoted.filter(r => !ok.has(r.sig))
}

/** What may travel: author-signed promoted revisions and what they name, every
 *  story, signed served snapshots, and their signatures. Staged work never
 *  leaves the device. */
export const published = async () => {
  const pool = poolDir(BUILDS_MEANING)
  const { builds, stories: told, served } = await scan(pool)
  const held = await readSignatures()
  const promoted = (await vouched(builds.filter(r => r.record.version !== STAGED), held)).map(r => r.sig)
  const buildsSet = await closureOf(pool, promoted)
  for (const { sig } of told) buildsSet.add(sig)
  const signedServed = await vouched(served, held, r => r.record.at)
  for (const { sig, record } of signedServed) {
    buildsSet.add(sig)
    buildsSet.add(record.files)
    for (const file of Object.values((await readJson(pool, record.files).catch(() => null))?.files ?? {})) buildsSet.add(file)
  }
  const promotedSet = new Set([...promoted, ...signedServed.map(r => r.sig)])
  const signatures = new Set(held.filter(({ event }) => promotedSet.has(tag(event, 'b'))).map(({ file }) => file))
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
  // What a host served is history too: snapshots and every file they name.
  for (const name of (await published())[BUILDS_MEANING]) reach.add(name)
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
  // A story's name is its stage, else its newest promotion.
  const byLabel = ref && stage[ref]?.record ? all.filter(r => r.sig === stage[ref].record)
    : all.filter(r => r.record.label === ref && r.record.version !== STAGED).slice(0, 1)
  const hit = byLabel.length ? byLabel : all.filter(r => (r.record.version === ref && ref !== STAGED) || (ref?.length >= 6 && r.sig.startsWith(ref)))
  if (hit.length !== 1) throw new Error(hit.length ? `"${ref}" names ${hit.length} revisions — give more of the signature` : `no revision "${ref}" in ${poolDir(BUILDS_MEANING)}`)
  return hit[0]
}

/** What a revision changed against the build before it: parts, and files by path. */
export const changesOf = async (pool, record) => {
  // A host build is measured against the build before it; a package against
  // its own story's revision before it.
  const parent = record.package ? await previousOf(pool, record) : await readJson(pool, record.parent).catch(() => null)
  const parts = PARTS.filter(k => !same(record[k], parent?.[k]))
  const files = {}
  const diff = (now, was) => [...new Set([...Object.keys(now), ...Object.keys(was)])].sort()
    .filter(p => now[p] !== was[p])
    .map(p => (!was[p] ? '+ ' : !now[p] ? '- ' : '~ ') + p)
  if (parts.includes('install') && record.install) files.install = diff(await filesOf(pool, record, 'install'), parent ? await filesOf(pool, parent, 'install') : {})
  // Source by path, whichever shape each side keeps it in (a tree, or the
  // flat layer revisions before trees carry).
  if (parts.includes('tree') || parts.includes('source')) {
    const lines = diff(await sourceOf(pool, record), parent ? await sourceOf(pool, parent) : {})
    if (lines.length) files.source = lines
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
  return { record, ...await signRecord(sig, record.version, role, now) }
}

/** Sign a record (a revision, or a served snapshot by its date) in `role`. */
const signRecord = async (sig, version, role, now = new Date()) => {
  const { finalizeEvent } = await import('nostr-tools/pure')
  const event = finalizeEvent({
    kind: BUILD_SIGNATURE_KIND, created_at: Math.floor(now.getTime() / 1000),
    tags: [['d', `${sig}:${role}`], ['b', sig], ['r', role], ['v', version]],
    content: signaturePreimage(sig, version, role),
  }, await signerKey())
  const pool = poolDir(SIGNATURES_MEANING)
  await mkdir(pool, { recursive: true })
  const file = await keep(pool, Buffer.from(JSON.stringify(event)))
  return { sig, pubkey: event.pubkey, file }
}

// ── writing a revision out, and taking one in ────────────────────────────────
const put = async (path, bytes) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes) }

/** A revision's files of one part, path → signature: a layer's, or a tree's. */
const filesOf = async (pool, record, part) => {
  if (!record?.[part]) return {}
  if (part === 'tree') return Object.fromEntries((await walkTree(record.tree, s => readJson(pool, s).catch(() => null))).files)
  return (await readJson(pool, record[part]).catch(() => ({ files: {} }))).files
}

/** A revision's source files, path → signature: its tree's, or its flat layer's. */
const sourceOf = (pool, record) => filesOf(pool, record, record.tree ? 'tree' : 'source')

/** Write a revision's source into `dir`, each file at its repo path and
 *  checked against its signature: a package's from its tiles, a host's from
 *  its source layer. */
export const writeSource = async (ref, dir) => {
  const pool = poolDir(BUILDS_MEANING)
  const { sig, record } = await findRevision(ref)
  if ((await readdir(dir).catch(() => [])).length) throw new Error(`${dir} is not empty`)
  const files = await sourceOf(pool, record)
  for (const [path, fileSig] of Object.entries(files)) {
    if (path.split('/').includes('..')) throw new Error(`${path} leaves the directory`)
    const bytes = await readFile(resolve(pool, fileSig))
    if (sign(bytes) !== fileSig) throw new Error(`${path} does not hash to ${short(fileSig)}`)
    await put(resolve(dir, path), bytes)
  }
  return { sig, record, files: Object.keys(files).length }
}

/**
 * A WORKSPACE TO AUTHOR IN, from the pools alone: the tree as it stood at a
 * version (the newest, when none is named). That is the newest host revision
 * up to it — its workspace — with the newest package up to it laid over when
 * that package was promoted later, and a local git repository so the build
 * reads it as it reads any checkout. Then: npm ci, change anything, build,
 * promote.
 */
export const checkout = async (ref, dir) => {
  const pool = poolDir(BUILDS_MEANING)
  const all = await revisions()
  const target = ref ? await findRevision(ref) : all[0]
  const upTo = !target || target.record.version === STAGED ? Infinity : order(target.record.version)
  const host = target?.record.workspace ? target : all.find(r => r.record.workspace && order(r.record.version) <= upTo)
  if (!host) throw new Error(`no revision${ref ? ` up to ${ref}` : ''} here carries a workspace — it was built before the workspace travelled`)
  if ((await readdir(dir).catch(() => [])).length) throw new Error(`${dir} is not empty`)
  const files = { ...(await readJson(pool, host.record.workspace)).files }
  const later = r => r.record.package && r.record.tree && (r === target || (order(r.record.version) > order(host.record.version) && order(r.record.version) <= upTo))
  const pkg = target && later(target) ? target : all.find(later)
  if (pkg) Object.assign(files, await sourceOf(pool, pkg.record))
  for (const [path, fileSig] of Object.entries(files)) {
    if (path.split('/').includes('..') || path.startsWith('/')) throw new Error(`${path} leaves the directory`)
    const bytes = await readFile(resolve(pool, fileSig))
    if (sign(bytes) !== fileSig) throw new Error(`${path} does not hash to ${short(fileSig)}`)
    await put(resolve(dir, path), bytes)
  }
  const git = (...args) => {
    const r = spawnSync('git', ['-c', 'user.name=hypercomb', '-c', 'user.email=checkout@hypercomb.invalid', ...args], { cwd: dir, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`git ${args[0]}: ${(r.stderr || r.stdout).trim()}`)
  }
  git('init', '-q', '-b', host.record.label)
  // Every file the workspace carries is tracked, even one an ignore rule
  // matches (tracked by force where it was built): the next build reads it.
  git('add', '-A', '-f')
  git('commit', '-q', '-m', `checkout ${host.record.label} ${host.record.version}${pkg ? ` with ${pkg.record.label} ${pkg.record.version}` : ''}`)
  return { host, pkg, files: Object.keys(files).length }
}

/** Write a revision's origin into `dir`, exactly as it was built, with its signatures. */
export const writeOut = async (ref, dir) => {
  const pool = poolDir(BUILDS_MEANING)
  const { sig, record } = await findRevision(ref)
  if (!record.install) throw new Error(`${record.label} ${record.version} is a package, not an origin — its source: builds.mjs source ${record.version} <dir>`)
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

// ── what a host serves ───────────────────────────────────────────────────────
/**
 * A FOLLOWER MUST BE ABLE TO STAND IN FOR ITS HOST. The version pools carry
 * the history — every revision, its source and its atoms — but a host serves
 * more than its history: the package laid out the way an install reads it
 * (the host:packages pool, the bags, the transfer pack), the minimal host's
 * own front files. None of that is a revision, so none of it travelled, and a
 * follower could rebuild the code but not serve it (host/drill.mjs).
 *
 * So a host names the directory it serves (`serves <dir>`), and every sync
 * records what that directory holds: a snapshot, `{ name: 'served', label,
 * at, files }`, whose `files` layer names each file by path and signature, the
 * bytes kept in the pool beside everything else. Snapshots are appended,
 * never edited, and travel like revisions, so a follower — or any device that
 * pulled one — serves exactly what the host served with one command
 * (`host <dir>`). Hosting your own domain and following someone else's are
 * the same process: the tools write into the directory you serve, and the
 * pool carries it. The version pools are left out of a snapshot; they travel
 * on their own and `host` writes them beside it.
 */
export const serves = async dir => {
  if (dir) await writeLocal('serves.json', { dir: resolve(dir) })
  return (await readLocal('serves.json', null))?.dir ?? null
}

const SNAPSHOT_LAYER = 'served-files'
const servedSnapshots = async (pool = poolDir(BUILDS_MEANING)) =>
  (await scan(pool)).served.sort((a, b) => a.record.at < b.record.at ? 1 : a.record.at > b.record.at ? -1 : (a.sig < b.sig ? -1 : 1))

/** Record what the served directory holds now; appended only when it changed. */
export const snapshotServed = async ({ now = new Date() } = {}) => {
  const dir = await serves()
  if (!dir) return null
  const pool = poolDir(BUILDS_MEANING)
  await mkdir(pool, { recursive: true })
  const skip = new Set([sign(BUILDS_MEANING), sign(SIGNATURES_MEANING)])
  const named = {}
  const walk = async from => {
    for (const entry of await readdir(from, { withFileTypes: true })) {
      const path = resolve(from, entry.name)
      if (from === dir && skip.has(entry.name)) continue
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) named[relative(dir, path).split(sep).join('/')] = await keep(pool, await readFile(path))
    }
  }
  await walk(dir)
  const ordered = Object.fromEntries(Object.entries(named).sort(([a], [b]) => a < b ? -1 : 1))
  const files = await keep(pool, Buffer.from(JSON.stringify({ name: SNAPSHOT_LAYER, files: ordered })))
  const [last] = await servedSnapshots(pool)
  const snapshot = last?.record.files === files ? last : await (async () => {
    const record = { name: 'served', label: 'host', at: now.toISOString(), files }
    return { sig: await keep(pool, Buffer.from(JSON.stringify(record))), record }
  })()
  // Vouched for like a revision, or it does not travel (see `vouched`).
  if (!(await signaturesOf(snapshot.sig, snapshot.record.at)).some(s => s.role === 'author' && s.ok)) {
    try { await signRecord(snapshot.sig, snapshot.record.at, 'author', now) } catch { /* no key at hand: it stays home */ }
  }
  return snapshot
}

/** Serve what the newest snapshot names into `dir`, each file checked
 *  against its signature, with the version pools beside it. Additive: a file
 *  already holding the right bytes is left alone; nothing else is removed. */
export const writeServed = async dir => {
  const pool = poolDir(BUILDS_MEANING)
  const [newest] = await servedSnapshots(pool)
  if (!newest) throw new Error('this pool holds no served snapshot — the host it came from never declared what it serves (builds.mjs serves <dir>)')
  const { files } = await readJson(pool, newest.record.files)
  let written = 0
  for (const [path, fileSig] of Object.entries(files)) {
    if (path.split('/').includes('..') || path.startsWith('/')) throw new Error(`${path} leaves the directory`)
    const bytes = await readFile(resolve(pool, fileSig))
    if (sign(bytes) !== fileSig) throw new Error(`${path} does not hash to ${short(fileSig)}`)
    const to = resolve(dir, path)
    const have = await readFile(to).catch(() => null)
    if (have && sign(have) === fileSig) continue
    await put(to, bytes)
    written++
  }
  const carried = await carryPools(dir, { atoms: true })
  return { ...newest, files: Object.keys(files).length, written, carried }
}

// ── the pools on hosts ───────────────────────────────────────────────────────
/**
 * THE ATOMS A KERNEL ASKS FOR. A pure install whose origin lacks its host
 * bundle, core library or host package asks the default hosts for them at
 * `/<sig>` (kernel.ts, host-package.ts). Every promoted revision's atoms, so
 * a kernel baked by any released build still finds its host in the wild.
 */
export const releaseAtoms = async () => {
  const ok = new Set((await published())[BUILDS_MEANING])
  return [...new Set((await revisions()).filter(r => ok.has(r.sig)).flatMap(r => r.record.atoms))].sort()
}

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
export const pushToR2 = async ({ bucket = process.env.HYPERCOMB_R2_BUCKET || 'hypercomb-content', via = process.env.HYPERCOMB_R2_VIA || 'https://content.jwize.com', put, fetch: get = fetch, dryRun = false } = {}) => {
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
  if (subs.length) await snapshotServed({ now })
  const unsigned = subs.length ? await unvouched() : []
  // The host's own directory lists its pools as its followers will.
  const own = await serves()
  if (own) await carryPools(own, { atoms: true })
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
        const carried = await carryPools(sub.to, { atoms: true })
        const [snapshot] = await servedSnapshots()
        detail = `${carried} new file(s)`
        if (snapshot) detail += ` · serves ${(await writeServed(sub.to)).files} file(s) as the host does`
      }
      sub.synced = head; sub.at = now.toISOString()
      if (unsigned.length) detail += ` · held back, unsigned: ${unsigned.map(r => r.record.version).join(', ')} (builds.mjs sign <version> --as author)`
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

// ── the offline copy ─────────────────────────────────────────────────────────
// Leaving GitHub means this pool IS the history, so it needs a copy that does
// not depend on any host: a folder on a disk you own. `backup` mirrors every
// pool this device keeps (promoted and STAGED work, stories, signatures, the
// conversations) plus the local stage and subscriptions. Every file is named
// by its hash, so each is verified on the way out and on the way back, and a
// second backup into the same folder copies only what is new. The signing key
// is never copied: it stays wherever you keep it.

const verifiedCopy = async (from, into) => {
  const counts = { copied: 0, present: 0, refused: [] }
  await mkdir(into, { recursive: true })
  const held = new Set(await readdir(into).catch(() => []))
  for (const name of await readdir(from).catch(() => [])) {
    if (!SIG.test(name)) continue
    if (held.has(name)) { counts.present++; continue }
    const bytes = await readFile(resolve(from, name))
    if (sign(bytes) !== name) { counts.refused.push(name); continue }
    await writeFile(resolve(into, name), bytes)
    counts.copied++
  }
  return counts
}

const poolNames = async root => (await readdir(root, { withFileTypes: true }).catch(() => []))
  .filter(entry => entry.isDirectory() && SIG.test(entry.name)).map(entry => entry.name)

const LOCAL_FILES = ['stage.json', 'subscriptions.json']

/** Mirror every pool and the local state into `dir`. */
export const backup = async dir => {
  const root = poolsRoot()
  const pools = await poolNames(root)
  const result = { pools: pools.length, copied: 0, present: 0, refused: [] }
  for (const pool of pools) {
    const counts = await verifiedCopy(resolve(root, pool), resolve(dir, pool))
    result.copied += counts.copied; result.present += counts.present
    result.refused.push(...counts.refused.map(name => `${pool.slice(0, 12)}/${name}`))
  }
  for (const name of LOCAL_FILES) {
    const bytes = await readFile(localFile(name)).catch(() => null)
    if (bytes) await put(resolve(dir, 'local', name), bytes)
  }
  await writeFile(resolve(dir, 'backup.json'), JSON.stringify({
    at: new Date().toISOString(), from: root,
    pools: Object.fromEntries(await Promise.all(pools.map(async pool => [pool, (await readdir(resolve(dir, pool))).filter(n => SIG.test(n)).length]))),
  }, null, 2) + '\n')
  return result
}

/** Bring a backup back: every pool file verified against its name, and the
 *  local stage and subscriptions only where this device has none (newer local
 *  state is never overwritten). */
export const restore = async dir => {
  const root = poolsRoot()
  const pools = await poolNames(dir)
  if (!pools.length) throw new Error(`${dir} holds no pools — is it a backup folder?`)
  const result = { pools: pools.length, copied: 0, present: 0, refused: [], local: [] }
  for (const pool of pools) {
    const counts = await verifiedCopy(resolve(dir, pool), resolve(root, pool))
    result.copied += counts.copied; result.present += counts.present
    result.refused.push(...counts.refused.map(name => `${pool.slice(0, 12)}/${name}`))
  }
  for (const name of LOCAL_FILES) {
    const bytes = await readFile(resolve(dir, 'local', name)).catch(() => null)
    if (!bytes) continue
    if (await readFile(localFile(name)).catch(() => null)) { result.local.push(`${name} kept (this device has its own)`); continue }
    await put(localFile(name), bytes)
    result.local.push(`${name} restored`)
  }
  return result
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
      console.log(`${record.label} ${record.version} ${short(sig)} promoted${signed ? ', signed as author' : ' — UNSIGNED: it stays on this device until you vouch for it (builds.mjs sign ' + record.version + ' --as author), then sync carries it'}`)
      printSync(synced)
    } else if (command === 'subscribe') console.log(`subscribed: ${await subscribe(ref)} — every promotion is carried there`)
    else if (command === 'unsubscribe') console.log(`unsubscribed: ${await unsubscribe(ref)}`)
    else if (command === 'sync') printSync(await sync())
    else if (command === 'serves') {
      const dir = await serves(ref)
      console.log(dir ? `serves ${dir} — every sync records what it holds, so followers serve it too` : 'serves nothing yet: builds.mjs serves <the directory this host serves>')
    } else if (command === 'host') {
      if (!ref) throw new Error('host wants a directory')
      const r = await writeServed(resolve(ref))
      console.log(`serving the host's snapshot of ${r.record.at} in ${resolve(ref)}: ${r.files} file(s), ${r.written} written, ${r.carried} pool file(s) carried`)
    }
    else if (command === 'show') await show(ref)
    else if (command === 'out') {
      if (!rest[0]) throw new Error('out wants a directory')
      const dir = resolve(rest[0])
      const { sig, record } = await writeOut(ref, dir)
      console.log(`${record.label} ${record.version} ${short(sig)} → ${dir}`)
    } else if (command === 'package') {
      const args = [ref, ...rest].filter(Boolean)
      const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
      const made = await recordPackage({ label: option('--story'), ...(option('--dir') ? { packageDir: resolve(option('--dir')) } : {}) })
      console.log(`staged ${made.record.label} ${short(made.sig)}…${made.unchanged ? ' (no change from the last promotion)' : ''} · package ${short(made.record.package)} · ${made.files} source files as its tiles · ${made.record.atoms.length} atoms · promote: node host/builds.mjs promote ${made.record.label}`)
    } else if (command === 'checkout') {
      const [version, target] = rest[0] ? [ref, rest[0]] : [undefined, ref]
      if (!target) throw new Error('checkout wants a directory: builds.mjs checkout [version] <dir>')
      const { host, pkg, files } = await checkout(version, resolve(target))
      console.log(`${host.record.label} ${host.record.version}${pkg ? ` + ${pkg.record.label} ${pkg.record.version}` : ''} → ${resolve(target)} · ${files} files, a local git repository`)
      console.log(`next:  cd ${resolve(target)}/src && npm ci ${INSTALL_WORKSPACES.map(w => `-w ${w}`).join(' ')} --include-workspace-root`)
      console.log(`       then change anything: ${AUTHOR_SCRIPTS.map(script => `npm run ${script}`).join(' && ')} && node hypercomb-shim/host/builds.mjs promote host`)
    } else if (command === 'source') {
      if (!rest[0]) throw new Error('source wants a directory')
      const dir = resolve(rest[0])
      const { sig, record, files } = await writeSource(ref, dir)
      console.log(`${record.label} ${record.version} ${short(sig)} → ${dir} · ${files} source files`)
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
    } else if (command === 'backup' || command === 'restore') {
      if (!ref) throw new Error(`${command} wants a directory`)
      const dir = resolve(ref)
      const r = command === 'backup' ? await backup(dir) : await restore(dir)
      console.log(`${command}: ${r.pools} pool(s), ${r.copied} file(s) copied, ${r.present} already there${r.refused.length ? `, ${r.refused.length} REFUSED (not what they are named): ${r.refused.join(', ')}` : ''}`)
      for (const line of r.local ?? []) console.log(`  ${line}`)
      if (r.refused.length) process.exitCode = 1
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
