// hypercomb-shim/host/builder.mjs
//
// THE BUILDER — a participant with the tooling, building what someone else
// wrote. A browser holds the version pools and can author a change, but it
// carries no compiler (that would be a dependency the hive carries). So it
// stages a DRAFT — the revision it starts from and the files it changes —
// and sends it, with a signed ASK, to a host under its grant (essentials
// sharing/version-drafts.ts). This takes it from there:
//
//   node host/builder.mjs <host> <ask sig> [--to <dir>] [--test] [--keep]
//   (or: node host/builds.mjs build-draft <host> <ask sig> …)
//
//   1. the ask: fetched by its signature, kept only if it hashes to it, a
//      nostr event that verifies, naming one draft (`hc:ask:v1\n<draft>`).
//      Its signer is the draft's author.
//   2. the draft: its record, its files layer and every file, each verified
//      against its name and kept in this builder's pools.
//   3. the base: the revision the draft starts from, from this builder's own
//      pools (pulled from the host when it is not held yet).
//   4. checkout, the draft's files laid over it, then `npm ci` and the build
//      scripts of the tree as the draft leaves it — the same process an
//      author on their own machine runs (builds.mjs checkout). `--test` runs
//      the checked-out tree's tests before anything is promoted.
//   5. promote: the package and the host, signed by this builder's key, each
//      naming the draft and the author's ask (builds.mjs promote `from`).
//      `--to <dir>` carries the result to a host directory for followers.
//
// BUILDING A DRAFT RUNS THE AUTHOR'S CODE. The draft's files are laid over
// the base before anything runs, so `npm ci` installs from the DRAFT's
// lockfile and the build runs the draft's scripts and configs (and its tests
// with --test), as this machine's user. A builder is lending its tooling: a
// builder that does not trust an author does not take the ask. What the
// build is never handed is this builder's key — every step runs with an
// environment of its own (buildEnv), and the key is read only afterwards, by
// promote, outside the build. A key kept in a FILE is still a file this user
// can read: until the build runs as another user or in a container, run a
// builder only for authors you would let run code on this machine.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AUTHOR_SCRIPTS, BUILDS_MEANING, GENERATED_FILES, INSTALL_WORKSPACES, SIGNATURES_MEANING,
  adoptStaged, carryPools, checkout, collect, draftsLabel, findRevision, isDraftsLabel, poolDir, promote, pullPools, readTrusted, revisions,
  sign as signOf, signerKey, workspaceOf,
} from './builds.mjs'

export const ASK_KIND = 30568
/** How long an ask stays good: an old ask is never built (a replay could
 *  roll a channel back to the base it started from). */
export const ASK_TTL_DAYS = 7
/** The labels a draft's build stages, the package before the host. */
const BUILT_LABELS = ['hypercomb-essentials', 'host']
/** Where a host lists the asks it holds for its builders
 *  (hypercomb-relay/build-asks.js): to a builder's signed request only. */
export const ASKS_MEANING = 'host:asks'
export const askPreimage = draft => `hc:ask:v1\n${draft}`
const SIG = /^[a-f0-9]{64}$/
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const tag = (event, name) => event?.tags?.find?.(t => t[0] === name)?.[1]
/** A host's origin, normalized (lowercase, no default port, no path): https
 *  unless it is loopback — the same comparison a host makes when it notes an
 *  ask (hypercomb-relay/build-asks.js originOf). */
export const originOf = host => {
  const text = String(host ?? '').trim()
  if (!text) return ''
  const loopback = /^(localhost|127\.|\[::1\])/i.test(text) || /^[^/:]+\.localhost(?::\d+)?(?:\/|$)/i.test(text)
  try { return new URL(/^https?:\/\//i.test(text) ? text : `${loopback ? 'http' : 'https'}://${text}`).origin } catch { return '' }
}

/** The bytes a host serves under `sig`, or an error: refused unless they
 *  hash to the name. */
const fetchSig = async (host, sig, get = fetch) => {
  const origin = originOf(host)
  for (const url of [`${origin}/${sig}`, `${origin}/content/${sig}`]) {
    const response = await get(url).catch(() => null)
    if (!response?.ok) continue
    const bytes = Buffer.from(await response.arrayBuffer())
    if (sha(bytes) === sig) return bytes
    throw new Error(`${host} served bytes for ${sig.slice(0, 12)} that are not what it is named`)
  }
  throw new Error(`${host} does not serve ${sig.slice(0, 12)}`)
}

/** WHAT A DRAFT'S BUILD MAY SEE of this machine's environment: enough to
 *  find its tools and its own output directories, never a signing key or
 *  any other secret the operator keeps in the environment. */
const BUILD_ENV_KEPT = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'TERM', 'CI',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'npm_config_cache', 'NPM_CONFIG_CACHE', 'npm_config_registry',
  'PLAYWRIGHT_BROWSERS_PATH', 'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD', 'NODE_OPTIONS', 'HYPERCOMB_SEED_HOSTS', 'SYSTEMROOT', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'PATHEXT', 'COMSPEC']
export const buildEnv = (work, from = process.env, { pools } = {}) => ({
  ...Object.fromEntries(BUILD_ENV_KEPT.filter(name => from[name] !== undefined).map(name => [name, from[name]])),
  // The build stages into pools of its OWN (buildDraft): the draft's code
  // never writes the operator's stage or pools, so it cannot choose what
  // this builder signs.
  ...(pools ? { HYPERCOMB_POOLS_DIR: pools } : from.HYPERCOMB_POOLS_DIR ? { HYPERCOMB_POOLS_DIR: from.HYPERCOMB_POOLS_DIR } : {}),
  HYPERCOMB_HOST_OUT_DIR: resolve(work, 'out'),
  HYPERCOMB_WEB_CONTENT_DIR: resolve(work, 'web-content'),
  HYPERCOMB_RELAY_CONTENT_DIR: resolve(work, 'relay-content'),
})

/** A path a draft may write: inside the tree, plain, and never into the
 *  repository's own machinery or installed dependencies — the same rule as
 *  core work-words.ts `draftPathRefusal`, which the browser stages under. */
export const draftPathRefusal = path => {
  const text = String(path ?? '')
  if (!text || text.length > 300 || /[\\:\u0000-\u001f\u007f]/.test(text)) return `${text || '(empty)'} is not a plain path`
  const parts = text.split('/')
  if (text.startsWith('/') || parts.some(part => part === '' || part === '.' || part === '..')) return `${text} is not a path inside the tree`
  if (parts.some(part => part === '.git' || part === 'node_modules')) return `${text} writes into .git or node_modules, which a draft never does`
  return null
}

const keepIn = async (meaning, sig, bytes) => {
  const pool = poolDir(meaning)
  await mkdir(pool, { recursive: true })
  await writeFile(resolve(pool, sig), bytes, { flag: 'wx' }).catch(e => { if (e.code !== 'EEXIST') throw e })
}

/** Read and verify one ask, and nothing it names: a signed ask for one
 *  draft, sent to this host, recent. Returns its event, bytes and author. */
export const readAsk = async (host, ask, { get = fetch, now = new Date() } = {}) => {
  if (!SIG.test(ask)) throw new Error('an ask is named by its signature (64 hex)')
  const askBytes = await fetchSig(host, ask, get)
  let event
  try { event = JSON.parse(askBytes.toString('utf8')) } catch { throw new Error('the ask is not an event') }
  const { verifyEvent } = await import('nostr-tools/pure')
  const draft = tag(event, 'd')
  if (event.kind !== ASK_KIND || !SIG.test(draft ?? '') || event.content !== askPreimage(draft) || !verifyEvent(event)) {
    throw new Error('the ask does not verify: it is not a signed ask for one draft')
  }
  // FOR THIS HOST, AND RECENT. An ask names the host it was sent to; one
  // carried to another host, or kept past its time, is not built.
  if (originOf(String(tag(event, 'h') ?? '')) !== originOf(host)) {
    throw new Error(`the ask was sent to ${tag(event, 'h') || 'no host'}, not ${originOf(host)}`)
  }
  const at = Number(event.created_at) * 1000
  if (!(at > now.getTime() - ASK_TTL_DAYS * 86_400_000) || at > now.getTime() + 600_000) {
    throw new Error(`the ask is from ${new Date(at).toISOString().slice(0, 10)}: older than ${ASK_TTL_DAYS} days (or from the future) — ask again`)
  }
  return { event, askBytes, draft, author: String(event.pubkey) }
}

/** Read and verify what an ask names: the author, the draft, its files. */
export const takeAsk = async (host, ask, { get = fetch, now = new Date() } = {}) => {
  const { event, askBytes, draft } = await readAsk(host, ask, { get, now })
  const draftBytes = await fetchSig(host, draft, get)
  const record = JSON.parse(draftBytes.toString('utf8'))
  if (record?.name !== 'draft' || !SIG.test(record.base ?? '') || !SIG.test(record.files ?? '')) throw new Error('the ask names something that is not a draft')
  const layerBytes = await fetchSig(host, record.files, get)
  const layer = JSON.parse(layerBytes.toString('utf8'))
  if (layer?.name !== 'draft-files' || typeof layer.files !== 'object') throw new Error('the draft\'s files are not a files layer')
  const files = new Map()
  for (const [path, sig] of Object.entries(layer.files)) {
    const refusal = draftPathRefusal(path)
    if (refusal) throw new Error(refusal)
    if (sig === null) { files.set(path, null); continue }
    if (!SIG.test(sig)) throw new Error(`${path} names no file`)
    files.set(path, await fetchSig(host, sig, get))
  }
  // Kept here, so the revision built from it carries its provenance.
  await keepIn(SIGNATURES_MEANING, ask, askBytes)
  await keepIn(BUILDS_MEANING, draft, draftBytes)
  await keepIn(BUILDS_MEANING, record.files, layerBytes)
  for (const [path, bytes] of files) if (bytes) await keepIn(BUILDS_MEANING, layer.files[path], bytes)
  return { ask, draft, author: event.pubkey, record, files }
}

/** A NIP-98 Authorization header for one request (kind 27235: the URL and
 *  the method), signed with this builder's key. */
const nip98 = async (url, method, key) => {
  const { finalizeEvent } = await import('nostr-tools/pure')
  const event = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', url], ['method', method]], content: '' }, key)
  return `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64')}`
}

/**
 * THE ASKS A HOST HOLDS FOR THIS BUILDER (hypercomb-relay/build-asks.js): its
 * listing, asked for under this builder's key — a host answers it only to
 * its operators and the builders their signed index names — and each ask
 * read and verified. What the draft would change is not fetched; whether it
 * is built is the builder's next act (buildDraft).
 */
export const listAsks = async (host, { get = fetch, now = new Date(), key } = {}) => {
  const secret = key ?? await signerKey()
  const origin = originOf(host)
  const pool = sha(ASKS_MEANING)
  // The listing is served at /<pool>/ on every face of the host, and only
  // there: a page some face answers elsewhere is never read as one.
  const url = `${origin}/${pool}/`
  const response = await get(url, { headers: { Authorization: await nip98(url, 'GET', secret) }, cache: 'no-store' }).catch(() => null)
  if (!response) throw new Error(`${origin} did not answer`)
  if (response.status === 404) throw new Error(`${origin} lists no asks to this key: its operator names builders with hosts builders add <your pubkey> @${new URL(origin).host}`)
  const type = String(response.headers?.get?.('content-type') ?? 'text/plain')
  if (!response.ok || !type.startsWith('text/plain')) throw new Error(`${origin} answered ${response.status} ${type}, not a listing of asks`)
  // One ask per line, `<signature> <origin it was sent to>`: an ask sent to
  // another face of the zone is read, and built, at the origin it names.
  const names = (await response.text()).split(/\r?\n/).map(line => line.trim().split(/\s+/))
    .filter(([name]) => SIG.test(name ?? ''))
    .map(([name, sentTo]) => ({ name, origin: originOf(sentTo) || origin }))
  const trusted = new Set(await readTrusted())
  const built = new Set((await revisions()).filter(r => r.record.ask && r.record.label === draftsLabel('host')).map(r => r.record.ask))
  const out = []
  for (const { name: ask, origin: sentTo } of names) {
    try {
      const { event, draft, author } = await readAsk(sentTo, ask, { get, now })
      out.push({ ask, origin: sentTo, author, draft, at: Number(event.created_at), trusted: trusted.has(author), built: built.has(ask) })
    } catch (error) {
      out.push({ ask, origin: sentTo, refused: error instanceof Error ? error.message : String(error) })
    }
  }
  return out
}

/** Build a draft into revisions and promote them. Returns what was promoted. */
export const buildDraft = async (host, ask, { to = null, test = false, keepWork = false, untrusted = false, log = console.log, get = fetch, now = new Date() } = {}) => {
  const taken = await takeAsk(host, ask, { get, now })
  log(`[builder] ask ${ask.slice(0, 12)} from ${taken.author.slice(0, 12)}: ${taken.files.size} file(s) over ${taken.record.base.slice(0, 12)}`)
  // WHOSE CODE RUNS HERE. Building runs the draft's code on this machine:
  // only an author the operator trusts (builds.mjs trust <pubkey>), or one
  // named for this build alone (--untrusted).
  if (!untrusted && !(await readTrusted()).includes(taken.author)) {
    throw new Error(`${taken.author} is not an author this builder trusts — builds.mjs trust ${taken.author}, or --untrusted for this one build`)
  }
  // ONCE. An ask built before is not built again: built means its host
  // revision, promoted last, so a build that stopped after the package can
  // be run again.
  const built = (await revisions()).find(r => r.record.ask === ask && r.record.label === draftsLabel('host'))
  if (built) throw new Error(`that ask was built already: ${built.record.label} ${built.record.version} ${built.sig.slice(0, 12)}`)
  // FROM THE HEAD. What the host holds now, so the base is judged against
  // the newest history; a draft over an older revision would roll back
  // everything after it.
  await pullPools([host], { fetch: get })
  const base = await findRevision(taken.record.base).catch(() => null)
  if (!base) throw new Error(`the draft starts from ${taken.record.base.slice(0, 12)}, which neither this builder nor ${host} holds`)
  const head = (await revisions()).find(r => r.record.label === base.record.label && !isDraftsLabel(r.record.label))
  if (head && head.sig !== base.sig) {
    throw new Error(`the draft starts from ${base.record.label} ${base.record.version}, but the newest is ${head.record.version} — draft again over it`)
  }
  // What the build must leave: the base's tree with the draft's files over it.
  const expected = { ...await workspaceOf(base.sig) }
  for (const [path, bytes] of taken.files) {
    if (bytes === null) delete expected[path]
    else expected[path] = sha(bytes)
  }

  const work = await mkdtemp(resolve(tmpdir(), 'hc-builder-'))
  const pools = await mkdtemp(resolve(tmpdir(), 'hc-builder-pools-'))
  try {
    await rm(work, { recursive: true, force: true })
    await checkout(base.sig, work)
    for (const [path, bytes] of taken.files) {
      const at = resolve(work, path)
      if (bytes === null) await rm(at, { force: true })
      else { await mkdir(dirname(at), { recursive: true }); await writeFile(at, bytes) }
    }
    const src = resolve(work, 'src')
    const run = (args, label) => {
      log(`[builder] ${label}`)
      const r = spawnSync('npm', args, { cwd: src, encoding: 'utf8', env: buildEnv(work, process.env, { pools }), maxBuffer: 256 << 20 })
      if (r.status !== 0) throw new Error(`${label} failed:\n${(r.stderr || r.stdout || '').split('\n').slice(-25).join('\n')}`)
      return r.stdout
    }
    run(['ci', ...INSTALL_WORKSPACES.flatMap(w => ['-w', w]), '--include-workspace-root', '--no-audit', '--no-fund'], 'npm ci from the draft\'s tree (its lockfile, if it changed one)')
    for (const script of AUTHOR_SCRIPTS) run(['run', script], `npm run ${script}`)
    if (test) {
      const r = spawnSync('npx', ['vitest', 'run'], { cwd: src, encoding: 'utf8', env: buildEnv(work, process.env, { pools }), maxBuffer: 256 << 20 })
      if (r.status !== 0) throw new Error(`the draft's tests fail:\n${(r.stdout || '').split('\n').filter(l => /×|FAIL|Test Files|Tests /.test(l)).slice(-20).join('\n')}`)
      log(`[builder] tests: ${(r.stdout.match(/Test Files .*/) ?? ['pass'])[0].trim()}`)
    }
    // VERIFY, THEN SIGN. The build's own pools hold what it staged; nothing
    // is taken from them, let alone signed, unless the host revision's tree
    // is the draft over its base (and the files a build writes itself).
    const stagedIn = JSON.parse(await readFile(resolve(pools, 'local', 'stage.json'), 'utf8').catch(() => '{}'))
    if (!stagedIn.host?.record) throw new Error('the build staged no host revision')
    const builtTree = await workspaceOf(stagedIn.host.record, resolve(pools, signOf(BUILDS_MEANING)))
    const differs = [...new Set([...Object.keys(expected), ...Object.keys(builtTree)])]
      .filter(path => expected[path] !== builtTree[path] && !GENERATED_FILES.includes(path)).sort()
    if (differs.length) {
      throw new Error(`the build's tree is not the draft over its base: ${differs.slice(0, 6).join(', ')}${differs.length > 6 ? ` and ${differs.length - 6} more` : ''}`)
    }
    const stagedSigs = await adoptStaged(pools, BUILT_LABELS)
    const promoted = []
    // The package first, then the host, each in its drafts channel.
    for (const label of BUILT_LABELS) {
      if (!stagedSigs[label]) continue
      const made = await promote(label, { sync: false, staged: stagedSigs[label], from: { draft: taken.draft, ask, base: base.sig } })
      if (!made.signed) throw new Error(`${label} ${made.record.version} was promoted but not signed: set HYPERCOMB_SIGNER_KEY to this builder's key`)
      promoted.push({ label, version: made.record.version, sig: made.sig })
      log(`[builder] promoted ${made.record.label} ${made.record.version} ${made.sig.slice(0, 12)} — from ${taken.author.slice(0, 12)}'s draft, signed as its builder`)
    }
    await collect()
    if (to) log(`[builder] carried ${await carryPools(resolve(to), { atoms: true })} file(s) into ${to}`)
    return { ...taken, promoted, work: keepWork ? work : null }
  } finally {
    if (!keepWork) await rm(work, { recursive: true, force: true })
    await rm(pools, { recursive: true, force: true })
  }
}

const age = seconds => {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - seconds)
  return s < 3600 ? `${Math.floor(s / 60)}m` : s < 86_400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86_400)}d`
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === 'asks') {
  const host = process.argv[3]
  if (!host) { console.error('usage: node host/builder.mjs asks <host>'); process.exit(2) }
  listAsks(host).then(asks => {
    if (!asks.length) { console.log(`${originOf(host)} holds no open asks`); return }
    for (const a of asks) {
      console.log(a.refused
        ? `  ${a.ask.slice(0, 12)}  refused: ${a.refused}`
        : `  ${a.ask.slice(0, 12)}  from ${a.author.slice(0, 12)} ${a.trusted ? '(trusted) ' : '(not trusted)'} ${age(a.at).padStart(4)} ago · draft ${a.draft.slice(0, 12)} · sent to ${a.origin}${a.built ? ' · built' : ''}`)
    }
    console.log('build one: node host/builds.mjs build-draft <its origin> <ask>   (an author you do not trust: builds.mjs trust <pubkey>, or --untrusted)')
  }).catch(e => { console.error(`[builder] ${e.message}`); process.exit(1) })
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--to')
  const [host, ask] = process.argv.slice(2).filter((a, i) => !a.startsWith('--') && !(at >= 0 && i + 2 === at + 1))
  if (!host || !ask) {
    console.error('usage: node host/builder.mjs <host> <ask sig> [--to <dir>] [--test] [--keep] [--untrusted]')
    process.exit(2)
  }
  buildDraft(host, ask, { to: at >= 0 ? process.argv[at + 1] : null, test: process.argv.includes('--test'), keepWork: process.argv.includes('--keep'), untrusted: process.argv.includes('--untrusted') })
    .catch(e => { console.error(`[builder] ${e.message}`); process.exit(1) })
}
