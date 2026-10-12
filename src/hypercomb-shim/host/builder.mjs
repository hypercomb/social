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
// THE BUILDER AT WORK, by itself (watchAsks):
//
//   node host/builder.mjs watch <host> [--once] [--interval <seconds>] [--test]
//   (or: node host/builds.mjs builder <host> …)
//
// Each pass lists the asks the host holds for this builder (listAsks), builds
// those from authors it trusts, and ANSWERS each one, signed: built (naming
// the revisions it promoted), refused (it will not build it as asked) or
// failed (it could not) — a kind-30569 event the host notes for the ask's
// author (hypercomb-relay/build-asks.js). A built revision is carried to this
// builder's own subscriptions (sync) and, whatever the host does not already
// list, to the host the ask was sent to, by signature, under this builder's
// grant — so the author can take it from where they asked. An ask from an
// author it does not trust is held, unanswered: trusting them later builds it.
// Answers are kept in this builder's own pool, so each ask is answered once.
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

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { link, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AUTHOR_SCRIPTS, BUILDS_MEANING, GENERATED_FILES, INSTALL_WORKSPACES, SIGNATURES_MEANING,
  adoptStaged, carryPools, checkout, closureOf, collect, draftsLabel, findRevision, isDraftsLabel, localFile, poolDir, promote, pullPools,
  readSignatures, readTrusted, revisions, sign as signOf, signerKey, sync, workspaceOf,
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
/** A builder's word on an ask (hypercomb-relay/build-asks.js answerShape). */
export const ANSWER_KIND = 30569
export const ANSWERS_MEANING = 'host:answers'
export const answerPreimage = (ask, state) => `hc:answer:v1\n${ask}\n${state}`
/** One short line: a host notes no longer `why`. */
const MAX_WHY = 280
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

/** WHAT AN ASK COMES TO. A refusal is this builder's word on the ask itself
 *  — it will not build it as asked (a draft that is not one, a path out of
 *  the tree, a draft not over the newest revision) — and is answered
 *  `refused`. A transient trouble (a host that did not answer, a registry out
 *  of reach, this builder stopping) is no answer at all: the next pass tries
 *  again. An author this builder no longer trusts is held, unanswered, as
 *  any untrusted author is. Anything else thrown while building is answered
 *  `failed`. (An ask that does not read as a signed ask for this host is
 *  never taken at all: listAsks says so, and nothing is answered.) */
const refusal = message => Object.assign(new Error(message), { refused: true })
const transient = message => Object.assign(new Error(message), { transient: true })
const held = message => Object.assign(new Error(message), { held: true })

/** The bytes a host serves under `sig`, or an error: refused when they do
 *  not hash to the name, or when every place asked says it does not hold
 *  them (404, 410); anything less certain — no answer, a failure, a rate
 *  limit, a refusal to this machine — is transient. */
const fetchSig = async (host, sig, get = fetch) => {
  const origin = originOf(host)
  let answered = true
  for (const url of [`${origin}/${sig}`, `${origin}/content/${sig}`]) {
    const response = await get(url).catch(() => null)
    if (!response || (response.status !== 404 && response.status !== 410 && !response.ok)) answered = false
    if (!response?.ok) continue
    // A body cut off on the way is no answer, not a wrong one.
    const bytes = await response.arrayBuffer().then(b => Buffer.from(b), () => null)
    if (!bytes) { answered = false; continue }
    if (sha(bytes) === sig) return bytes
    throw refusal(`${host} served bytes for ${sig.slice(0, 12)} that are not what it is named`)
  }
  throw answered ? refusal(`${host} does not serve ${sig.slice(0, 12)}`) : transient(`${host} did not answer for ${sig.slice(0, 12)}`)
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
  try { event = JSON.parse(askBytes.toString('utf8')) } catch { throw refusal('the ask is not an event') }
  const { verifyEvent } = await import('nostr-tools/pure')
  const draft = tag(event, 'd')
  if (event?.kind !== ASK_KIND || !SIG.test(draft ?? '') || event.content !== askPreimage(draft) || !verifyEvent(event)) {
    throw refusal('the ask does not verify: it is not a signed ask for one draft')
  }
  // FOR THIS HOST, AND RECENT. An ask names the host it was sent to; one
  // carried to another host, or kept past its time, is not built.
  if (originOf(String(tag(event, 'h') ?? '')) !== originOf(host)) {
    throw refusal(`the ask was sent to ${tag(event, 'h') || 'no host'}, not ${originOf(host)}`)
  }
  const at = Number(event.created_at) * 1000
  if (!(at > now.getTime() - ASK_TTL_DAYS * 86_400_000) || at > now.getTime() + 600_000) {
    throw refusal(`the ask is from ${new Date(at).toISOString().slice(0, 10)}: older than ${ASK_TTL_DAYS} days (or from the future) — ask again`)
  }
  return { event, askBytes, draft, author: String(event.pubkey) }
}

/** Read and verify what an ask names: the author, the draft, its files. */
export const takeAsk = async (host, ask, { get = fetch, now = new Date() } = {}) => {
  const { event, askBytes, draft } = await readAsk(host, ask, { get, now })
  const parsed = bytes => { try { return JSON.parse(bytes.toString('utf8')) } catch { return null } }
  const draftBytes = await fetchSig(host, draft, get)
  const record = parsed(draftBytes)
  if (record?.name !== 'draft' || !SIG.test(record.base ?? '') || !SIG.test(record.files ?? '')) throw refusal('the ask names something that is not a draft')
  const layerBytes = await fetchSig(host, record.files, get)
  const layer = parsed(layerBytes)
  if (layer?.name !== 'draft-files' || !layer.files || typeof layer.files !== 'object') throw refusal('the draft\'s files are not a files layer')
  const files = new Map()
  for (const [path, sig] of Object.entries(layer.files)) {
    const refused = draftPathRefusal(path)
    if (refused) throw refusal(refused)
    if (sig === null) { files.set(path, null); continue }
    if (!SIG.test(sig)) throw refusal(`${path} names no file`)
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
const nip98 = async (url, method, key, payload) => {
  const { finalizeEvent } = await import('nostr-tools/pure')
  const tags = [['u', url], ['method', method], ...(payload ? [['payload', payload]] : [])]
  const event = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags, content: '' }, key)
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

/** npm's words for a network it could not reach. */
const NETWORK_TROUBLE = /\b(ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|socket hang up|network (?:request|timeout))\b/i
/** How long one step of a draft's build may run before it is stopped and
 *  answered failed: a script in watch mode never ends on its own. */
export const STEP_MINUTES = 30
/** Files that change where an install fetches from. */
const INSTALL_FILES = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|package\.json|\.npmrc)$/

/**
 * ONE STEP OF A DRAFT'S BUILD, run as its own process group: a stop (this
 * builder's signal) or the time limit ends the whole group — npm and
 * everything it started — and a terminal's Ctrl-C reaches only this builder,
 * which decides. Resolves to `{ code, signal, said, timedOut, stopped }`;
 * `said` is the tail of what it printed.
 */
export const buildStep = (command, args, { cwd, env, signal, minutes = STEP_MINUTES } = {}) => new Promise(done => {
  let said = ''
  const keep = chunk => { said = (said + chunk).slice(-(1 << 20)) }
  let timedOut = false
  let child
  try {
    child = spawn(command, args, { cwd, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) { done({ code: null, signal: null, said: String(error?.message ?? error), error, timedOut, stopped: false }); return }
  child.stdout.on('data', keep)
  child.stderr.on('data', keep)
  const end = () => {
    try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
    // Whatever ignores the first word is ended.
    setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } }, 10_000).unref()
  }
  const timer = setTimeout(() => { timedOut = true; end() }, minutes * 60_000)
  const stop = () => end()
  signal?.addEventListener?.('abort', stop, { once: true })
  let error = null
  child.on('error', e => { error = e })
  child.on('close', (code, killedBy) => {
    clearTimeout(timer)
    signal?.removeEventListener?.('abort', stop)
    done({ code, signal: killedBy, said, error, timedOut, stopped: !!signal?.aborted })
  })
})

/**
 * WHAT A FINISHED STEP COMES TO: nothing (it passed), or the error watchAsks
 * answers by. This builder stopping, or npm missing here, is transient. An
 * install that could not reach a registry is transient too — counted
 * (`network`) only when the draft changed what an install fetches from, since
 * its own lockfile can name a registry nobody reaches; otherwise it is this
 * builder's trouble, and waits for as long as it lasts. A step over its time,
 * or ended by a signal this builder did not send, is the draft's: failed.
 */
export const stepTrouble = (label, args, result, { touchesInstall = false } = {}) => {
  if (result.code === 0 && !result.timedOut && !result.stopped) return null
  const tail = String(result.said ?? '').split('\n').slice(-25).join('\n')
  const said = `${label} failed:\n${tail}`
  if (result.stopped) return transient('this builder is stopping')
  if (result.error && result.code === null && !result.signal) return transient(`${label} could not start: ${result.error.message}`)
  if (result.timedOut) return new Error(`${label} ran past ${STEP_MINUTES} minutes and was stopped`)
  if (result.signal) return new Error(`${label} was ended by ${result.signal}:\n${tail}`)
  if (args[0] === 'ci' && NETWORK_TROUBLE.test(said)) return Object.assign(transient(said), { network: touchesInstall })
  return new Error(said)
}

export const buildDraft = async (host, ask, { to = null, test = false, keepWork = false, untrusted = false, log = console.log, get = fetch, now = new Date(), signal, me } = {}) => {
  const taken = await takeAsk(host, ask, { get, now })
  log(`[builder] ask ${ask.slice(0, 12)} from ${taken.author.slice(0, 12)}: ${taken.files.size} file(s) over ${taken.record.base.slice(0, 12)}`)
  // WHOSE CODE RUNS HERE. Building runs the draft's code on this machine:
  // only an author the operator trusts (builds.mjs trust <pubkey>), or one
  // named for this build alone (--untrusted).
  if (!untrusted && !(await readTrusted()).includes(taken.author)) {
    throw held(`${taken.author} is not an author this builder trusts — builds.mjs trust ${taken.author}, or --untrusted for this one build`)
  }
  // FROM THE HEAD. What the host holds now — all of it: judged against part
  // of the history, a base is not known, or an older head passes for the
  // newest, and a draft over an older revision would roll back everything
  // after it.
  const [pulled] = await pullPools([host], { fetch: get })
  if (pulled?.failed) throw transient(`${originOf(host)} did not give all of its version pools (${pulled.failed} unanswered)`)
  // ONCE. An ask built before is not built again — this builder's build, or
  // one the host already holds from another (theirs to answer: this builder
  // holds the ask). Built means its host revision, promoted last, so a build
  // that stopped after the package can be run again.
  const built = (await revisions()).find(r => r.record.ask === ask && r.record.label === draftsLabel('host'))
  if (built) {
    const mine = !me || (await readSignatures()).some(({ event }) => event?.pubkey === me && tag(event, 'b') === built.sig && tag(event, 'r') === 'builder')
    throw (mine ? refusal : held)(`that ask was built already: ${built.record.label} ${built.record.version} ${built.sig.slice(0, 12)}`)
  }
  const base = await findRevision(taken.record.base).catch(() => null)
  if (!base) throw refusal(`the draft starts from ${taken.record.base.slice(0, 12)}, which neither this builder nor ${host} holds`)
  const head = (await revisions()).find(r => r.record.label === base.record.label && !isDraftsLabel(r.record.label))
  if (head && head.sig !== base.sig) {
    throw refusal(`the draft starts from ${base.record.label} ${base.record.version}, but the newest is ${head.record.version} — draft again over it`)
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
    const env = buildEnv(work, process.env, { pools })
    const touchesInstall = [...taken.files.keys()].some(path => INSTALL_FILES.test(path))
    const run = async (args, label) => {
      if (signal?.aborted) throw transient('this builder is stopping')
      log(`[builder] ${label}`)
      const trouble = stepTrouble(label, args, await buildStep('npm', args, { cwd: src, env, signal }), { touchesInstall })
      if (trouble) throw trouble
    }
    await run(['ci', ...INSTALL_WORKSPACES.flatMap(w => ['-w', w]), '--include-workspace-root', '--no-audit', '--no-fund'], 'npm ci from the draft\'s tree (its lockfile, if it changed one)')
    for (const script of AUTHOR_SCRIPTS) await run(['run', script], `npm run ${script}`)
    if (test) {
      log('[builder] the draft\'s tests')
      const r = await buildStep('npx', ['vitest', 'run'], { cwd: src, env, signal })
      if (r.code !== 0 || r.timedOut || r.stopped) {
        const trouble = stepTrouble('the draft\'s tests', ['test'], r)
        throw r.code !== null && !r.timedOut && !r.stopped
          ? new Error(`the draft's tests fail:\n${r.said.split('\n').filter(l => /×|FAIL|Test Files|Tests /.test(l)).slice(-20).join('\n')}`)
          : trouble
      }
      log(`[builder] tests: ${(r.said.match(/Test Files .*/) ?? ['pass'])[0].trim()}`)
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
      promoted.push({ label: made.record.label, version: made.record.version, sig: made.sig })
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

// ── answering: the builder's word on each ask ───────────────────────────────

/**
 * A SIGNED ANSWER to one ask (hypercomb-relay/build-asks.js answerShape): its
 * state; why, for refused and failed; and for built, the revisions it
 * promoted (`b`: sig, label, version) and its own signatures on them (`g`),
 * each readable from the host by signature. `d` is the ask, so each builder
 * has one word per ask.
 */
export const answerEvent = async ({ ask, author, origin, state, why = '', built = [], signatures = [] }, key, now = new Date()) => {
  const { finalizeEvent } = await import('nostr-tools/pure')
  const tags = [['d', ask], ['p', author], ['h', originOf(origin)], ['s', state]]
  if (state !== 'built') tags.push(['why', clip(why) || 'no reason was given'])
  for (const b of built) tags.push(['b', b.sig, b.label, b.version])
  if (state === 'built') for (const g of signatures) tags.push(['g', g])
  return finalizeEvent({ kind: ANSWER_KIND, created_at: Math.floor(now.getTime() / 1000), tags, content: answerPreimage(ask, state) }, key)
}

/** One line of at most MAX_WHY, cut between characters, never inside one. */
const clip = text => {
  const line = String(text ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
  if (line.length <= MAX_WHY) return line
  let cut = ''
  for (const character of line) { if (cut.length + character.length > MAX_WHY - 1) break; cut += character }
  return `${cut}…`
}

const escaped = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** A path of this machine, in either separator. */
const pathPattern = path => escaped(path).replace(/\\\\|\//g, '[\\\\/]')

/** WHY, IN ONE LINE THE AUTHOR CAN READ — and none of this machine's own
 *  places: the build's directories, the pools, the temporary directory, the
 *  directory it runs in and this user's home are named, never shown, and a
 *  URL's credentials are dropped. */
export const whyOf = error => {
  const lines = String(error?.message ?? error ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  let text = lines.length > 1 ? `${lines[0]} ${lines.at(-1)}` : lines[0] ?? 'the build stopped'
  const places = [
    [`${pathPattern(tmpdir())}[\\\\/]hc-builder-pools-[^\\\\/\\s]+`, '<pools>'],
    [`${pathPattern(tmpdir())}[\\\\/]hc-builder-[^\\\\/\\s]+`, '<build>'],
    // The most specific place first; one too short to be a place (the root,
    // a drive) would eat every path.
    ...[
      [poolDir(BUILDS_MEANING).replace(/[\\/][^\\/]+$/, ''), '<pools>'],
      [tmpdir(), '<tmp>'],
      [process.cwd(), '<here>'],
      [homedir(), '~'],
    ].filter(([path]) => path.replace(/[\\/]+$/, '').length > 3)
      .sort((a, b) => b[0].length - a[0].length)
      .map(([path, name]) => [pathPattern(path), name]),
  ]
  for (const [pattern, name] of places) text = text.replace(new RegExp(pattern, 'gi'), name)
  return clip(text.replace(/(\w+:\/\/)[^\s/@]+@/g, '$1'))
}

/** PUT bytes at /<sig> on a host, under this builder's grant (NIP-98). */
const putTo = async (origin, bytes, key, send = fetch) => {
  const sig = sha(bytes)
  const url = `${originOf(origin)}/${sig}`
  const type = bytes[0] === 0x7b || bytes[0] === 0x5b ? 'application/json' : 'application/octet-stream'
  const response = await send(url, { method: 'PUT', headers: { Authorization: await nip98(url, 'PUT', key, sig), 'Content-Type': type }, body: bytes }).catch(() => null)
  if (!response) throw transient(`${originOf(origin)} did not answer`)
  if (!response.ok) throw transient(`${originOf(origin)} refused ${sig.slice(0, 12)}: ${response.status} ${String(await response.text().catch(() => '')).trim().slice(0, 120)}`)
  return sig
}

/** The names a host lists in one pool, at its root or its /content. A
 *  listing that went unanswered is no answer: what the host holds is not
 *  known, and carrying everything would spend the builder's grant on it. */
const listedOn = async (origin, meaning, get = fetch) => {
  const names = new Set()
  for (const base of [originOf(origin), `${originOf(origin)}/content`]) {
    const response = await get(`${base}/${sha(meaning)}/`, { cache: 'no-store' }).catch(() => null)
    if (!response || response.status >= 500 || response.status === 429 || response.status === 408) throw transient(`${originOf(origin)} did not list ${meaning}`)
    if (!response.ok || !String(response.headers?.get?.('content-type') ?? 'text/plain').startsWith('text/plain')) continue
    const text = await response.text().catch(() => null)
    if (text === null) throw transient(`${originOf(origin)} did not list ${meaning}`)
    for (const name of text.split(/\r?\n/)) if (SIG.test(name.trim())) names.add(name.trim())
  }
  return names
}

/** This builder's own signatures (kind 30567, role builder) on revisions:
 *  the newest for each, as a replaceable event stands. */
const builderSignaturesOn = async (sigs, pubkey) => {
  const newest = new Map()
  for (const { file, event } of await readSignatures()) {
    if (event?.pubkey !== pubkey || !sigs.includes(tag(event, 'b')) || tag(event, 'r') !== 'builder') continue
    const held = newest.get(tag(event, 'b'))
    if (!held || held.event.created_at < event.created_at || (held.event.created_at === event.created_at && held.file < file)) newest.set(tag(event, 'b'), { file, event })
  }
  return [...newest.values()].map(({ file }) => file).sort()
}

/**
 * CARRY A BUILD TO THE HOST IT WAS ASKED OF: every file the promoted revisions
 * reach, and this builder's signatures on them, each at /<sig> under this
 * builder's grant — except what the host already lists in its version pools,
 * where a reader finds it at /<pool>/<sig>. The answer names the revisions
 * and the signatures; the author takes the rest from there by signature.
 */
export const deliverBuilt = async (origin, sigs, { get = fetch, send = fetch, key } = {}) => {
  const secret = key ?? await signerKey()
  const { getPublicKey } = await import('nostr-tools/pure')
  const signatures = await builderSignaturesOn(sigs, getPublicKey(secret))
  const wanted = new Map()
  for (const sig of await closureOf(poolDir(BUILDS_MEANING), sigs)) wanted.set(sig, resolve(poolDir(BUILDS_MEANING), sig))
  for (const file of signatures) wanted.set(file, resolve(poolDir(SIGNATURES_MEANING), file))
  const held = new Set([...await listedOn(origin, BUILDS_MEANING, get), ...await listedOn(origin, SIGNATURES_MEANING, get)])
  const report = { sent: 0, present: 0, signatures }
  for (const [sig, path] of wanted) {
    if (held.has(sig)) { report.present++; continue }
    const bytes = await readFile(path).catch(() => null)
    if (!bytes) throw new Error(`${sig.slice(0, 12)} is not held here, so the build cannot be carried`)
    await putTo(origin, bytes, secret, send)
    report.sent++
  }
  return report
}

/** This builder's answers, by the ask each answers: the newest of each. */
export const myAnswers = async pubkey => {
  const pool = poolDir(ANSWERS_MEANING)
  const out = new Map()
  for (const file of await readdir(pool).catch(() => [])) {
    if (!SIG.test(file)) continue
    const bytes = await readFile(resolve(pool, file)).catch(() => null)
    let event
    try { event = JSON.parse(bytes.toString('utf8')) } catch { continue }
    if (event?.kind !== ANSWER_KIND || event.pubkey !== pubkey) continue
    const ask = tag(event, 'd')
    if (!SIG.test(ask ?? '') || (out.get(ask)?.event.created_at ?? -1) > event.created_at) continue
    out.set(ask, { sig: file, bytes, event, state: tag(event, 's') })
  }
  return out
}

/** What a host lists of answers to this key (its own builds' zones). */
const answersListed = async (host, key, get = fetch) => {
  const url = `${originOf(host)}/${sha(ANSWERS_MEANING)}/`
  const response = await get(url, { headers: { Authorization: await nip98(url, 'GET', key) }, cache: 'no-store' }).catch(() => null)
  if (!response?.ok || !String(response.headers?.get?.('content-type') ?? 'text/plain').startsWith('text/plain')) return null
  const text = await response.text().catch(() => null)
  return text === null ? null : new Set(text.split(/\r?\n/).map(line => line.trim().split(/\s+/)[0]).filter(name => SIG.test(name ?? '')))
}

/** ONE BUILDER AT A TIME per pools: two would build the same ask twice. The
 *  lock is taken whole or not at all (written aside, then linked into place);
 *  one its holder left behind — gone, or never fully written — is moved aside
 *  and taken, and moved back if another builder took it first. */
export const builderLock = async what => {
  const file = localFile('builder.lock')
  await mkdir(dirname(file), { recursive: true })
  const mine = JSON.stringify({ pid: process.pid, what, at: new Date().toISOString() })
  const readLock = async path => { try { return JSON.parse(await readFile(path, 'utf8')) } catch { return {} } }
  const alive = pid => { try { if (pid && pid !== process.pid) { process.kill(pid, 0); return true } } catch (e) { return e.code === 'EPERM' } return false }
  const take = async () => {
    const aside = `${file}.${process.pid}.new`
    await writeFile(aside, mine)
    try { await link(aside, file) } finally { await rm(aside, { force: true }) }
  }
  const busy = lock => new Error(`another builder is at work here (pid ${lock.pid}, ${lock.what ?? 'building'}) — one at a time; if none is, remove ${file}`)
  try { await take() } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const lock = await readLock(file)
    if (alive(lock.pid)) throw busy(lock)
    const stale = `${file}.${process.pid}.stale`
    try { await rename(file, stale) } catch (e) { if (e.code !== 'ENOENT') throw e }
    const moved = await readLock(stale)
    // Moved someone's fresh lock rather than the stale one: put it back.
    if (moved.pid && moved.pid !== lock.pid && alive(moved.pid)) {
      await rename(stale, file).catch(() => {})
      throw busy(moved)
    }
    await rm(stale, { force: true })
    try { await take() } catch (e) { if (e.code === 'EEXIST') throw busy(await readLock(file)); throw e }
  }
  return async () => { if ((await readLock(file)).pid === process.pid) await rm(file, { force: true }) }
}

const pause = (ms, signal) => new Promise(done => {
  const finish = () => { clearTimeout(timer); signal?.removeEventListener?.('abort', finish); done() }
  const timer = setTimeout(finish, ms)
  signal?.addEventListener?.('abort', finish, { once: true })
})

/** How many times a draft's install may find the registry out of reach
 *  before it is answered failed: its own lockfile can name one nobody reaches. */
const NETWORK_TRIES = 3

/**
 * WATCH A HOST'S ASKS AND ANSWER EACH ONE. Every `interval` seconds (or
 * `once`): list the asks the host holds for this builder; hold those from
 * authors it does not trust; build the rest — or pick up a build of its own
 * that finished without its answer — carry what was built to the host, and
 * answer, signed. An answer the host has never listed is sent again; one it
 * listed once and dropped since (swept, or withdrawn) stays dropped.
 */
export const watchAsks = async (host, {
  interval = 60, once = false, test = false, log = console.log, get = fetch, send = fetch,
  now = () => new Date(), signal, key, build = buildDraft, carry = sync,
} = {}) => {
  const secret = key ?? await signerKey()
  const { getPublicKey } = await import('nostr-tools/pure')
  const me = getPublicKey(secret)
  const release = await builderLock(`watching ${originOf(host)}`)
  const told = new Set()
  const tell = (ask, line) => { if (!told.has(`${ask}\n${line}`)) { told.add(`${ask}\n${line}`); log(line) } }
  // Installs that found the registry out of reach, by ask — kept, so a
  // builder run once a pass (cron, --once) counts them too.
  const triesFile = localFile('install-tries.json')
  const networkTries = new Map(Object.entries(await readFile(triesFile, 'utf8').then(text => JSON.parse(text), () => ({})).catch(() => ({}))))
  const keepTries = async () => { await mkdir(dirname(triesFile), { recursive: true }); await writeFile(triesFile, JSON.stringify(Object.fromEntries(networkTries))) }
  // Answers a host has listed at least once: never sent again.
  const seenFile = localFile('answers-listed.json')
  const seen = new Set(await readFile(seenFile, 'utf8').then(text => JSON.parse(text), () => []).catch(() => []))
  const remember = async (sigs, keep) => {
    let changed = false
    for (const sig of sigs) if (!seen.has(sig)) { seen.add(sig); changed = true }
    for (const sig of [...seen]) if (!keep.has(sig)) { seen.delete(sig); changed = true }
    if (changed) { await mkdir(dirname(seenFile), { recursive: true }); await writeFile(seenFile, JSON.stringify([...seen].sort())) }
  }
  const sendAnswer = async (origin, answer) => {
    try { await putTo(origin, answer.bytes, secret, send) }
    catch (error) { tell(answer.sig, `[builder] the answer ${answer.sig.slice(0, 12)} did not reach ${originOf(origin)} yet: ${error.message}`); return }
    // Listed now, it is seen: dropped later (withdrawn, or swept), it stays dropped.
    const listedNow = await answersListed(origin, secret, get)
    if (listedNow?.has(answer.sig)) await remember([answer.sig], new Set([...seen, answer.sig]))
  }
  const answer = async (listed, state, { why = '', built = [], signatures = [] } = {}) => {
    const event = await answerEvent({ ask: listed.ask, author: listed.author, origin: listed.origin, state, why, built, signatures }, secret, now())
    const bytes = Buffer.from(JSON.stringify(event))
    await keepIn(ANSWERS_MEANING, sha(bytes), bytes)
    log(`[builder] answered ${listed.ask.slice(0, 12)} for ${listed.author.slice(0, 12)}: ${state}${tag(event, 'why') ? ` — ${tag(event, 'why')}` : ''}`)
    await sendAnswer(listed.origin, { sig: sha(bytes), bytes })
  }
  /** This builder's own revisions, by ask: the newest per channel. */
  const ownBuilds = async () => {
    const signed = new Set((await readSignatures()).filter(({ event }) => event?.pubkey === me && tag(event, 'r') === 'builder').map(({ event }) => tag(event, 'b')))
    const byAsk = new Map()
    for (const r of await revisions()) {
      if (!r.record.ask || !isDraftsLabel(r.record.label) || !signed.has(r.sig)) continue
      if (!byAsk.has(r.record.ask)) byAsk.set(r.record.ask, new Map())
      const channels = byAsk.get(r.record.ask)
      if (!channels.has(r.record.label)) channels.set(r.record.label, { label: r.record.label, version: r.record.version, sig: r.sig })
    }
    return byAsk
  }
  const take = async (listed, said, own) => {
    if (said) {
      // Answered: sent again only while the host has never listed it.
      if (!seen.has(said.sig)) await sendAnswer(listed.origin, said)
      return
    }
    // A build of its own that stopped before its answer is answered, whoever
    // is trusted now: the build happened.
    let promoted = [...(own.get(listed.ask)?.values() ?? [])]
    if (!promoted.some(p => p.label === draftsLabel('host'))) {
      if (!listed.trusted) {
        tell(listed.ask, `[builder] held: ${listed.ask.slice(0, 12)} from ${listed.author.slice(0, 12)}, an author this builder does not trust (builds.mjs trust ${listed.author})`)
        return
      }
      try {
        promoted = (await build(listed.origin, listed.ask, { test, log, get, now: now(), signal, me })).promoted
      } catch (error) {
        if (error.held) { tell(listed.ask, `[builder] held: ${whyOf(error)}`); return }
        const tries = error.network ? (networkTries.get(listed.ask) ?? 0) + 1 : 0
        if (error.network) { networkTries.set(listed.ask, tries); await keepTries() }
        if ((error.transient && !(error.network && tries >= NETWORK_TRIES)) || signal?.aborted) {
          log(`[builder] ${listed.ask.slice(0, 12)} waits: ${whyOf(error)}`)
          return
        }
        await answer(listed, error.refused ? 'refused' : 'failed', { why: whyOf(error) })
        return
      }
    }
    // Carried first, answered after: an answer names only what the host can give.
    try {
      for (const r of await carry()) if (!r.ok) log(`[builder] sync to ${r.to}: ${r.detail}`)
    } catch (error) { log(`[builder] sync: ${error.message}`) }
    let carried
    try {
      carried = await deliverBuilt(listed.origin, promoted.map(p => p.sig), { get, send, key: secret })
      log(`[builder] carried ${carried.sent} file(s) to ${originOf(listed.origin)} (${carried.present} already there)`)
    } catch (error) {
      log(`[builder] ${listed.ask.slice(0, 12)} is built, and waits to be carried: ${error.message}`)
      return
    }
    await answer(listed, 'built', { built: promoted, signatures: carried.signatures })
  }
  const pass = async () => {
    let asks
    try { asks = await listAsks(host, { get, now: now(), key: secret }) } catch (error) {
      if (once) throw error
      log(`[builder] ${error.message}`)
      return
    }
    const mine = await myAnswers(me)
    if (asks.some(listed => mine.has(listed.ask) && !seen.has(mine.get(listed.ask).sig))) {
      const listedNow = await answersListed(host, secret, get)
      if (listedNow) await remember([...mine.values()].map(a => a.sig).filter(sig => listedNow.has(sig)), new Set([...mine.values()].map(a => a.sig)))
    }
    const own = asks.some(listed => !mine.has(listed.ask)) ? await ownBuilds() : new Map()
    // Counts for asks no longer listed are done with.
    if ([...networkTries.keys()].some(ask => !asks.some(listed => listed.ask === ask))) {
      for (const ask of [...networkTries.keys()]) if (!asks.some(listed => listed.ask === ask)) networkTries.delete(ask)
      await keepTries()
    }
    for (const listed of asks) {
      if (signal?.aborted) return
      if (listed.refused) { tell(listed.ask, `[builder] ${listed.ask.slice(0, 12)} cannot be read: ${listed.refused}`); continue }
      // One ask's trouble is that ask's: the watch goes on.
      try { await take(listed, mine.get(listed.ask), own) }
      catch (error) { log(`[builder] ${listed.ask.slice(0, 12)}: ${error.message}`) }
    }
  }
  try {
    for (;;) {
      try { await pass() } catch (error) {
        if (once) throw error
        log(`[builder] ${error.message}`)
      }
      if (once || signal?.aborted) break
      await pause(interval * 1000, signal)
      if (signal?.aborted) break
    }
  } finally { await release() }
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
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === 'watch') {
  const args = process.argv.slice(3)
  const host = args.find((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--interval')
  const at = args.indexOf('--interval')
  const interval = at >= 0 ? Number(args[at + 1]) : 60
  if (!host || !(interval >= 5)) { console.error('usage: node host/builder.mjs watch <host> [--once] [--interval <seconds, at least 5>] [--test]'); process.exit(2) }
  const stop = new AbortController()
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { if (!stop.signal.aborted) console.log('[builder] stopping after this step'); stop.abort() })
  console.log(`[builder] watching ${originOf(host)}${args.includes('--once') ? ' once' : ` every ${interval}s`} — trusted authors: builds.mjs trust <pubkey>`)
  watchAsks(host, { once: args.includes('--once'), interval, test: args.includes('--test'), signal: stop.signal })
    .catch(e => { console.error(`[builder] ${e.message}`); process.exit(1) })
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--to')
  const [host, ask] = process.argv.slice(2).filter((a, i) => !a.startsWith('--') && !(at >= 0 && i + 2 === at + 1))
  if (!host || !ask) {
    console.error('usage: node host/builder.mjs <host> <ask sig> [--to <dir>] [--test] [--keep] [--untrusted]')
    process.exit(2)
  }
  builderLock(`building ${ask.slice(0, 12)}`).then(async release => {
    try { await buildDraft(host, ask, { to: at >= 0 ? process.argv[at + 1] : null, test: process.argv.includes('--test'), keepWork: process.argv.includes('--keep'), untrusted: process.argv.includes('--untrusted') }) }
    finally { await release() }
  }).catch(e => { console.error(`[builder] ${e.message}`); process.exit(1) })
}
