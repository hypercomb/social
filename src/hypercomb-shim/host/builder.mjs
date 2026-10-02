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
//   4. checkout, the draft's files laid over it, `npm ci` from the base's own
//      lockfile, the base's own build scripts — the same process an author on
//      their own machine runs (builds.mjs checkout). `--test` runs the
//      checked-out tree's tests before anything is promoted.
//   5. promote: the package and the host, signed by this builder's key, each
//      naming the draft and the author's ask (builds.mjs promote `from`).
//      `--to <dir>` carries the result to a host directory for followers.
//
// Nothing the draft brings runs on this machine except through the build and
// the tests it asked for: a builder is lending its tooling, so a builder that
// does not trust an author does not take the ask.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AUTHOR_SCRIPTS, BUILDS_MEANING, INSTALL_WORKSPACES, SIGNATURES_MEANING,
  carryPools, checkout, findRevision, poolDir, promote, pullPools, readStage,
} from './builds.mjs'

export const ASK_KIND = 30568
export const askPreimage = draft => `hc:ask:v1\n${draft}`
const SIG = /^[a-f0-9]{64}$/
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const tag = (event, name) => event?.tags?.find?.(t => t[0] === name)?.[1]
const originOf = host => (/^https?:\/\//.test(host) ? host : /^(localhost|127\.)/.test(host) ? `http://${host}` : `https://${host}`).replace(/\/+$/, '')

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

const keepIn = async (meaning, sig, bytes) => {
  const pool = poolDir(meaning)
  await mkdir(pool, { recursive: true })
  await writeFile(resolve(pool, sig), bytes, { flag: 'wx' }).catch(e => { if (e.code !== 'EEXIST') throw e })
}

/** Read and verify what an ask names: the author, the draft, its files. */
export const takeAsk = async (host, ask, { get = fetch } = {}) => {
  if (!SIG.test(ask)) throw new Error('an ask is named by its signature (64 hex)')
  const askBytes = await fetchSig(host, ask, get)
  let event
  try { event = JSON.parse(askBytes.toString('utf8')) } catch { throw new Error('the ask is not an event') }
  const { verifyEvent } = await import('nostr-tools/pure')
  const draft = tag(event, 'd')
  if (event.kind !== ASK_KIND || !SIG.test(draft ?? '') || event.content !== askPreimage(draft) || !verifyEvent(event)) {
    throw new Error('the ask does not verify: it is not a signed ask for one draft')
  }
  const draftBytes = await fetchSig(host, draft, get)
  const record = JSON.parse(draftBytes.toString('utf8'))
  if (record?.name !== 'draft' || !SIG.test(record.base ?? '') || !SIG.test(record.files ?? '')) throw new Error('the ask names something that is not a draft')
  const layerBytes = await fetchSig(host, record.files, get)
  const layer = JSON.parse(layerBytes.toString('utf8'))
  if (layer?.name !== 'draft-files' || typeof layer.files !== 'object') throw new Error('the draft\'s files are not a files layer')
  const files = new Map()
  for (const [path, sig] of Object.entries(layer.files)) {
    if (path.startsWith('/') || path.split('/').includes('..')) throw new Error(`${path} is not a path inside the tree`)
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

/** Build a draft into revisions and promote them. Returns what was promoted. */
export const buildDraft = async (host, ask, { to = null, test = false, keepWork = false, log = console.log, get = fetch } = {}) => {
  const taken = await takeAsk(host, ask, { get })
  log(`[builder] ask ${ask.slice(0, 12)} from ${taken.author.slice(0, 12)}: ${taken.files.size} file(s) over ${taken.record.base.slice(0, 12)}`)
  let base = await findRevision(taken.record.base).catch(() => null)
  if (!base) {
    await pullPools([host], { fetch: get })
    base = await findRevision(taken.record.base).catch(() => null)
  }
  if (!base) throw new Error(`the draft starts from ${taken.record.base.slice(0, 12)}, which neither this builder nor ${host} holds`)

  const work = await mkdtemp(resolve(tmpdir(), 'hc-builder-'))
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
      const r = spawnSync('npm', args, { cwd: src, encoding: 'utf8', env: { ...process.env, HYPERCOMB_HOST_OUT_DIR: resolve(work, 'out'),
        HYPERCOMB_WEB_CONTENT_DIR: resolve(work, 'web-content'), HYPERCOMB_RELAY_CONTENT_DIR: resolve(work, 'relay-content') }, maxBuffer: 256 << 20 })
      if (r.status !== 0) throw new Error(`${label} failed:\n${(r.stderr || r.stdout || '').split('\n').slice(-25).join('\n')}`)
      return r.stdout
    }
    run(['ci', ...INSTALL_WORKSPACES.flatMap(w => ['-w', w]), '--include-workspace-root', '--no-audit', '--no-fund'], 'npm ci from the base\'s lockfile')
    for (const script of AUTHOR_SCRIPTS) run(['run', script], `npm run ${script}`)
    if (test) {
      const r = spawnSync('npx', ['vitest', 'run'], { cwd: src, encoding: 'utf8', maxBuffer: 256 << 20 })
      if (r.status !== 0) throw new Error(`the draft's tests fail:\n${(r.stdout || '').split('\n').filter(l => /×|FAIL|Test Files|Tests /.test(l)).slice(-20).join('\n')}`)
      log(`[builder] tests: ${(r.stdout.match(/Test Files .*/) ?? ['pass'])[0].trim()}`)
    }
    const stage = await readStage()
    const promoted = []
    // The package first, then the host: one history, each parent the head before it.
    for (const label of ['hypercomb-essentials', 'host']) {
      if (!stage[label]?.record) continue
      const made = await promote(label, { sync: false, from: { draft: taken.draft, ask } })
      if (!made.signed) throw new Error(`${label} ${made.record.version} was promoted but not signed: set HYPERCOMB_SIGNER_KEY to this builder's key`)
      promoted.push({ label, version: made.record.version, sig: made.sig })
      log(`[builder] promoted ${label} ${made.record.version} ${made.sig.slice(0, 12)} — from ${taken.author.slice(0, 12)}'s draft`)
    }
    if (to) log(`[builder] carried ${await carryPools(resolve(to), { atoms: true })} file(s) into ${to}`)
    return { ...taken, promoted, work: keepWork ? work : null }
  } finally {
    if (!keepWork) await rm(work, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--to')
  const [host, ask] = process.argv.slice(2).filter((a, i) => !a.startsWith('--') && !(at >= 0 && i + 2 === at + 1))
  if (!host || !ask) {
    console.error('usage: node host/builder.mjs <host> <ask sig> [--to <dir>] [--test] [--keep]')
    process.exit(2)
  }
  buildDraft(host, ask, { to: at >= 0 ? process.argv[at + 1] : null, test: process.argv.includes('--test'), keepWork: process.argv.includes('--keep') })
    .catch(e => { console.error(`[builder] ${e.message}`); process.exit(1) })
}
