// replicate-public-host — the public install host takes a published revision.
//
//   npm run replicate:revision                    the root the followed publisher signs now
//   npm run replicate:revision -- --sig <root>    that root (the retry a publish prints)
//
// PART OF `publish:revision`, around the stamp, and runnable alone for a
// revision someone already published. A stamp moves the signed
// `install:<channel>` on the public install host at once, but the package's
// bytes lived only on the publisher's machine (jwize.com), so the host kept
// offering the previous package until someone redeployed its whole site from
// a checkout — twice in one night on 2026-10-11.
//
// THE BYTES GO FIRST, THE STAMP AFTER. A publish pulls the whole package onto
// the host (steps 1-3, `stage: 'pull'`) BEFORE it stamps, and only reads the
// pool back (step 4, `stage: 'confirm'`) after. A stamp that named bytes the
// host lacked would send every client that looked there into a 404 it
// remembers for good (core eggs.ts: a base that answered 'absent' is never
// asked for that root again) — so a pull that does not finish stops the
// publish before anything is announced.
//
// IT UPLOADS NOTHING. Bytes reach a reader by REPLICATION from a host
// (CLAUDE.md, "Module delivery pipeline"): this asks the host for every atom
// of the root's closure by its bare signature, and the host's worker answers
// from its heap or reads the atom from its farm — the publisher's machine,
// on while it publishes — keeping it only if it hashes to its name
// (blossom-worker/worker.js readThroughFarm). Nothing is built, so no working
// tree is ever shipped; only the signed root's closure is read, by signature.
//
//   1. walk the closure HERE, from the bytes this machine published (the
//      relay's content dir and dist), fetching nothing — a missing or wrong
//      atom stops the run before the host is asked anything;
//   2. ask the host for every atom but the root, everything an atom names
//      before it, six at a time; every answer is hashed here too. A miss is
//      asked once more after a minute (the farm remembers a miss that long);
//   3. ask for the root LAST, and only when every other atom is held there
//      (the order is tidiness, not the guarantee: the host's packages pool
//      names a root only once its heap holds the root's WHOLE package —
//      worker.js heapHoldsPackage checks every file — so a run cut short
//      leaves the host on its older, complete one whatever was pulled);
//   4. read the host the way a cold client does: its pool head must be the
//      root, and /content/<root> must hash to its name.
//
// The host gives a signature through its farm only when it is part of a
// package the publisher put out — the root its signed index names, or the
// newest member of the farm's own `host:packages` pool, which the publish's
// ship step has just appended to (worker.js farmMayCopy). So a pull before
// the stamp works, and nothing else the publisher's machine serves is copied.
//
// Idempotent — an atom the host already holds just answers — and it needs no
// credentials. It never touches the signed index. Run alone, a failure exits
// 3; inside a publish, a failed pull is "nothing was announced" (exit 1) and
// only a pool that has not moved after the stamp is exit 3.
//
// THE HOST IS NAMED ONCE, HERE (PUBLIC_INSTALL_HOST), and the environment can
// move it: HYPERCOMB_PUBLIC_INSTALL_HOST=<zone>, or empty / `none` to skip the
// step. hypercomb.com is a public host that may be retired; nothing else in
// the publish names it.

import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { HOST_PACKAGES_MEANING, markerIndices, parseMember, parsePoolListing, poolEntryName } from '../../hypercomb-runtime/src/host-pool.js'

const ESSENTIALS = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SIG_RE = /^[a-f0-9]{64}$/

/** The public install's one host — runtime host-zones.ts DEFAULT_HOST_ZONES
 *  (publish.spec.ts keeps the two in step). */
export const PUBLIC_INSTALL_HOST = 'hypercomb.com'

/** Moves the host for one run; empty or `none` skips replication. */
export const PUBLIC_INSTALL_HOST_ENV = 'HYPERCOMB_PUBLIC_INSTALL_HOST'

/** The command that replicates a revision, run from `src/`. */
export const REPLICATE_STEP = 'npm run replicate:revision'

/** The farm remembers a miss for 60 s (worker.js FARM_MISS_MS). */
export const RETRY_AFTER_MS = 65_000
const CONCURRENCY = 6
const POOL_SETTLE_TRIES = 3
const POOL_SETTLE_MS = 6_000

/** The host this run replicates to, or null to skip. */
export function publicInstallHost(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env[PUBLIC_INSTALL_HOST_ENV]
  if (raw === undefined) return PUBLIC_INSTALL_HOST
  const zone = raw.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0]!.replace(/\.+$/, '')
  return !zone || zone === 'none' ? null : zone
}

/** Where this machine's published bytes are: the relay's content dir (the
 *  same rule copy-content ships by) and the build's dist. */
export function localContentDirs(env: Record<string, string | undefined> = process.env): string[] {
  return [
    env['HYPERCOMB_RELAY_CONTENT_DIR'] || resolve(ESSENTIALS, '..', 'hypercomb-relay', 'content'),
    resolve(ESSENTIALS, 'dist'),
  ]
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const short = (sig: string): string => `${sig.slice(0, 12)}…`

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

/**
 * The head of a host's packages pool, read the way a cold client reads it
 * (runtime host-packages.ts): the zone's own bases, flat then `/content`, the
 * listing first and the newest marker under it. `answered` is false only when
 * no base gave an HTTP response at all.
 */
export async function hostPoolHead(
  zone: string,
  fetchImpl: (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'text'>> = fetch,
): Promise<{ answered: boolean; head: string | null }> {
  const pool = createHash('sha256').update(HOST_PACKAGES_MEANING, 'utf8').digest('hex')
  let answered = false
  for (const base of [`https://${zone}`, `https://${zone}/content`]) {
    let listing: string[] | null
    try {
      const res = await fetchImpl(`${base}/${pool}/`, { cache: 'no-store' })
      answered = true
      listing = res.ok ? parsePoolListing(await res.text()) : null
    } catch { continue }
    if (!listing) continue
    const indices = markerIndices(listing)
    if (!indices.length) return { answered, head: null }
    try {
      const res = await fetchImpl(`${base}/${pool}/${poolEntryName(indices[indices.length - 1]!)}`, { cache: 'no-store' })
      return { answered, head: res.ok ? parseMember(await res.text())?.packageSig ?? null : null }
    } catch { return { answered, head: null } }
  }
  return { answered, head: null }
}

/** Reads atoms from local content dirs; a sig-named DIRECTORY (a pool, a
 *  bag) is never an atom. */
export function localAtoms(dirs: readonly string[]): (sig: string) => Promise<Uint8Array | null> {
  return async (sig) => {
    for (const dir of dirs) {
      const path = join(dir, sig)
      try { if (statSync(path).isFile()) return readFileSync(path) } catch { /* the next dir */ }
    }
    return null
  }
}

/**
 * Pure: the closure in the order the host takes it — every atom after every
 * atom of the closure it names, so the root comes last. References are the
 * literal signatures in an atom's text, the rule every byte walker uses.
 */
export function replicationOrder(root: string, held: readonly string[], bytesOf: (sig: string) => Uint8Array | undefined): string[] {
  const closure = new Set(held)
  const decoder = new TextDecoder()
  const named = (sig: string): string[] => {
    const bytes = bytesOf(sig)
    if (!bytes) return []
    const text = decoder.decode(bytes)
    if (text.includes('\uFFFD')) return []
    return [...new Set(text.match(/[a-f0-9]{64}/g) ?? [])].filter(ref => ref !== sig && closure.has(ref))
  }
  const order: string[] = []
  const entered = new Set<string>()
  const visit = (sig: string): void => {
    if (entered.has(sig)) return
    entered.add(sig)
    for (const ref of named(sig)) visit(ref)
    order.push(sig)
  }
  visit(root)
  // Whatever the walk held that no literal reaches still goes before the root.
  const rest = held.filter(sig => !entered.has(sig))
  return [...order.slice(0, -1), ...rest, root]
}

/** What one atom came back as from the host. */
type Answer = { sig: string; ok: boolean; copied: boolean; bytes: number; why: string }

async function askHost(host: string, sig: string, fetchImpl: Fetch): Promise<Answer> {
  try {
    const res = await fetchImpl(`https://${host}/${sig}`, { cache: 'no-store' })
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined)
      return { sig, ok: false, copied: false, bytes: 0, why: `HTTP ${res.status}` }
    }
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (sha256(bytes) !== sig) return { sig, ok: false, copied: false, bytes: 0, why: 'bytes that are not its name' }
    return { sig, ok: true, copied: res.headers.get('x-read-through') === 'farm', bytes: bytes.byteLength, why: '' }
  } catch (error) {
    return { sig, ok: false, copied: false, bytes: 0, why: error instanceof Error ? error.message || 'unreachable' : 'unreachable' }
  }
}

async function eachLimited<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const at = next++
      out[at] = await run(items[at]!)
    }
  }))
  return out
}

export type ReplicationReport = {
  host: string
  root: string
  /** Where the run stopped: the local walk, the atoms, every atom taken (a
   *  pull-only run's end), the pool, or done. */
  stage: 'local' | 'atoms' | 'pulled' | 'pool' | 'done'
  /** The closure as walked here. */
  local: { atoms: number; holes: string[]; refused: string[]; limited: boolean }
  /** Atoms the host read from its farm during this run. */
  copied: string[]
  /** Atoms the host already held. */
  held: number
  /** Bytes the host copied. */
  copiedBytes: number
  /** Atoms the host could not give back, hashed. */
  failed: { sig: string; why: string }[]
  /** The host's pool head afterwards, and whether it answered at all. */
  head: string | null
  answered: boolean
  /** /content/<root> came back as the root. */
  rootServed: boolean
  ok: boolean
  /** A fault on this machine that stopped the run (the walker would not load…). */
  error?: string
}

type ClosureResult = { held: string[]; holes: string[]; refused: string[]; limited: boolean }
type AtomStore = {
  read(sig: string): Promise<Uint8Array | null>
  fetch(sig: string): Promise<Uint8Array | null>
  write(sig: string, bytes: Uint8Array): Promise<void>
}
/** The relay's package walker (hypercomb-relay/replicate.js) — the Node twin
 *  of the runtime's, and the one stage-signed-package.mjs uses. */
const packageClosure = async (root: string, io: AtomStore): Promise<ClosureResult> => {
  const relay = await import(pathToFileURL(resolve(ESSENTIALS, '..', 'hypercomb-relay', 'replicate.js')).href) as {
    resolvePackageClosure(root: string, io: AtomStore): Promise<ClosureResult>
  }
  return relay.resolvePackageClosure(root, io)
}

export type ReplicateOptions = {
  root: string
  host: string
  /** Local bytes; defaults to the dirs this machine published into. */
  readLocal?: (sig: string) => Promise<Uint8Array | null>
  fetchImpl?: Fetch
  sleep?: (ms: number) => Promise<void>
  log?: (line: string) => void
  retryAfterMs?: number
  /** 'pull' takes the package (steps 1-3, before a stamp); 'confirm' only
   *  reads the pool back (step 4, after it); 'all' — the default — both. */
  stage?: 'pull' | 'confirm' | 'all'
}

/** Replicate one root to one host, and say what happened. Never throws for
 *  a host's answer; a fault on this machine is a report too. */
export async function replicateRevision(options: ReplicateOptions): Promise<ReplicationReport> {
  const { root, host } = options
  const report: ReplicationReport = {
    host, root, stage: 'local',
    local: { atoms: 0, holes: [], refused: [], limited: false },
    copied: [], held: 0, copiedBytes: 0, failed: [], head: null, answered: false, rootServed: false, ok: false,
  }
  try { await replicateInto(report, options) } catch (error) {
    report.ok = false
    report.error = error instanceof Error ? error.message || String(error) : String(error)
  }
  return report
}

async function replicateInto(report: ReplicationReport, options: ReplicateOptions): Promise<void> {
  const { root, host } = options
  const fetchImpl = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(done => setTimeout(done, ms)))
  const log = options.log ?? ((line: string) => console.log(line))
  const retryAfter = options.retryAfterMs ?? RETRY_AFTER_MS
  const stage = options.stage ?? 'all'
  if (!SIG_RE.test(root)) { report.local.refused.push(root); return }
  if (stage === 'confirm') return confirmInto(report, host, fetchImpl, sleep)

  // 1. The closure, from this machine's own bytes. Nothing is fetched.
  const readLocal = options.readLocal ?? localAtoms(localContentDirs())
  const bytes = new Map<string, Uint8Array>()
  const closure = await packageClosure(root, {
    read: async (sig) => {
      const found = await readLocal(sig)
      if (found) bytes.set(sig, found)
      return found
    },
    fetch: async () => null,
    write: async () => { throw new Error('the local walk writes nothing') },
  })
  report.local = { atoms: closure.held.length, holes: closure.holes, refused: closure.refused, limited: closure.limited }
  if (closure.holes.length || closure.refused.length || closure.limited || !closure.held.includes(root)) {
    log(`[replicate] this machine does not hold ${short(root)}'s whole package — ${closure.holes.length} missing, ${closure.refused.length} refused${closure.limited ? ', walk cut short' : ''}; ${host} was asked nothing`)
    return
  }
  log(`[replicate] ${short(root)} — ${closure.held.length} atoms, verified here; asking ${host} for each`)

  // 2. Every atom but the root, then 3. the root — each with one retry.
  report.stage = 'atoms'
  const take = async (atoms: readonly string[]): Promise<void> => {
    let answers = await eachLimited(atoms, CONCURRENCY, sig => askHost(host, sig, fetchImpl))
    const missed = answers.filter(answer => !answer.ok)
    if (missed.length) {
      log(`[replicate] ${missed.length} not taken yet (first: ${short(missed[0]!.sig)} — ${missed[0]!.why}); asking again in ${Math.round(retryAfter / 1000)} s`)
      await sleep(retryAfter)
      const again = new Map((await eachLimited(missed, CONCURRENCY, answer => askHost(host, answer.sig, fetchImpl))).map(answer => [answer.sig, answer]))
      answers = answers.map(answer => again.get(answer.sig) ?? answer)
    }
    for (const answer of answers) {
      if (!answer.ok) report.failed.push({ sig: answer.sig, why: answer.why })
      else if (answer.copied) { report.copied.push(answer.sig); report.copiedBytes += answer.bytes }
      else report.held++
    }
  }
  const order = replicationOrder(root, closure.held, sig => bytes.get(sig))
  await take(order.slice(0, -1))
  if (!report.failed.length) await take([root])
  if (report.copied.length) {
    log(`[replicate] ${host} copied ${report.copied.length} atom(s), ${kb(report.copiedBytes)}, from its farm:`)
    for (let at = 0; at < report.copied.length; at += 6) log(`[replicate]   ${report.copied.slice(at, at + 6).map(short).join(' ')}`)
  }
  if (report.held) log(`[replicate] ${host} already held ${report.held} atom(s)`)
  if (report.failed.length) return
  if (stage === 'pull') {
    report.stage = 'pulled'
    report.ok = true
    return
  }
  await confirmInto(report, host, fetchImpl, sleep)
}

/** 4. The host, read as a cold client reads it. */
async function confirmInto(report: ReplicationReport, host: string, fetchImpl: Fetch, sleep: (ms: number) => Promise<void>): Promise<void> {
  const { root } = report
  report.stage = 'pool'
  for (let attempt = 1; attempt <= POOL_SETTLE_TRIES; attempt++) {
    const read = await hostPoolHead(host, fetchImpl)
    report.head = read.head
    report.answered = read.answered
    if (read.head === root || attempt === POOL_SETTLE_TRIES) break
    // The signed index is edge-cached for a few seconds per colo.
    await sleep(POOL_SETTLE_MS)
  }
  const served = await askHostAt(`https://${host}/content/${root}`, fetchImpl)
  report.rootServed = served === root
  if (report.head !== root || !report.rootServed) return
  report.stage = 'done'
  report.ok = true
}

async function askHostAt(url: string, fetchImpl: Fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(url, { cache: 'no-store' })
    if (!res.ok) return null
    return sha256(new Uint8Array(await res.arrayBuffer()))
  } catch { return null }
}

/** A publish's pull that did not finish: nothing was announced, and why. */
function notAnnounced(report: ReplicationReport, channel: string): string[] {
  const { host } = report
  const first = report.failed[0]
  const why = report.error ? report.error
    : report.stage === 'local' ? `this machine does not hold the whole package (${report.local.holes.length} missing, ${report.local.refused.length} refused)`
      : `${host} could not take ${report.failed.length} atom(s)${first ? ` (first: ${short(first.sig)} — ${first.why})` : ''}`
  const none = report.stage === 'atoms' && !report.copied.length && !report.held
  return [
    '',
    '  ┌─────────────────────────────────────────────────────────────┐',
    `  │  NOTHING WAS ANNOUNCED — ${host} could not take the package first`,
    `  │  ${why}`,
    `  │  install:${channel} still names the previous package; nobody is offered`,
    `  │  a build ${host} cannot serve.`,
    ...(none ? [`  │  It took none — is its worker deployed with a farm? (blossom-worker`,
      `  │  wrangler.pluginthematrix.toml: "farm" + "installs" on ${host}'s binding)`] : []),
    '  │  Fix that and publish again (the build cache makes it quick), or',
    `  │  publish without the public host: ${PUBLIC_INSTALL_HOST_ENV}=none`,
    '  └─────────────────────────────────────────────────────────────┘',
    '',
  ]
}

const kb = (bytes: number): string => bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`

export type ReplicationVerdict = { state: 'current' | 'behind' | 'unknown'; lines: string[] }

/** Pure: what a run means, and — unless the host is current — the step owed.
 *  `announced` is false for a publish's pull before its stamp: then a failure
 *  means nothing was announced, and the step owed is the publish itself.
 *  After a stamp, the stamp always stands; this never says otherwise. */
export function replicationVerdict(report: ReplicationReport, channel = 'essentials', announced = true): ReplicationVerdict {
  const { host, root } = report
  if (report.ok && report.stage === 'pulled') {
    return { state: 'current', lines: [`[replicate] ${host} holds ${short(root)}'s whole package — the stamp may name it`] }
  }
  if (report.ok) {
    return { state: 'current', lines: [`[replicate] ${host} offers ${short(root)} to cold installs — current`] }
  }
  if (!announced) return { state: report.stage === 'local' ? 'unknown' : 'behind', lines: notAnnounced(report, channel) }
  const retry = `${REPLICATE_STEP} -- --sig ${root}`
  const box = (title: string, why: string[]): string[] => [
    '',
    '  ┌─────────────────────────────────────────────────────────────┐',
    `  │  ${title}`,
    `  │  The stamp stands: install:${channel} is ${short(root)}.`,
    ...why.map(line => `  │  ${line}`),
    '  │  From src/, with this machine on (idempotent — safe to rerun):',
    `  │    ${retry}`,
    '  └─────────────────────────────────────────────────────────────┘',
    '',
  ]
  if (report.error) {
    return { state: 'unknown', lines: box(`REPLICATION STOPPED — ${report.error}`, [
      `Until ${host} holds it, a cold install there gets the older build.`,
    ]) }
  }
  if (report.stage === 'local') {
    return { state: 'unknown', lines: box(`REPLICATION NOT STARTED — ${host} was asked nothing`, [
      `This machine does not hold the whole package (${report.local.holes.length} missing, ${report.local.refused.length} refused).`,
      `Until ${host} holds it, a cold install there gets the older build.`,
    ]) }
  }
  if (report.stage === 'atoms') {
    const first = report.failed[0]
    const nothing = !report.copied.length && !report.held
    return { state: nothing ? 'unknown' : 'behind', lines: box(`REPLICATION OWED — ${host} could not take ${report.failed.length} atom(s)`, [
      ...(first ? [`first: ${short(first.sig)} — ${first.why}`] : []),
      `Its pool keeps offering the older build until the whole package is there.`,
      ...(nothing ? [`It took none — is its worker deployed with a farm? (blossom-worker`, `wrangler.pluginthematrix.toml: "farm" on ${host}'s binding)`] : []),
    ]) }
  }
  const offered = report.head
    ? `its pool still offers ${short(report.head)}`
    : report.answered ? 'its pool lists no package' : 'its pool could not be read (offline?)'
  return { state: report.answered ? 'behind' : 'unknown', lines: box(`REPLICATION UNCONFIRMED — ${host} holds the package, but ${offered}`, [
    ...(report.rootServed ? [] : [`/content/${short(root)} did not come back as the root.`]),
    `Its worker derives the pool from the signed index only when its binding`,
    `names the channel ("installs": "${channel}" — wrangler.pluginthematrix.toml).`,
  ]) }
}

// ── standalone ──────────────────────────────────────────────────────────────

/** Whom builds follow (stamp-install-channel.ts writes it). */
const PUBLISHER_FILE = resolve(ESSENTIALS, 'src', 'sharing', 'install-publisher.json')
const INDEX_KIND = 30564

type Publisher = { pubkey: string; hosts: string[]; channel: string }
const publisherRecord = (): Publisher => {
  const raw = JSON.parse(readFileSync(PUBLISHER_FILE, 'utf8')) as { pubkey?: string; hosts?: string[]; channel?: string }
  return { pubkey: String(raw.pubkey ?? '').toLowerCase(), hosts: Array.isArray(raw.hosts) ? raw.hosts : [], channel: String(raw.channel ?? 'essentials') }
}

/** The root the followed publisher signs now, read from its index on the
 *  host (or the hosts the publisher record names) and verified against the
 *  key the record pins. */
async function signedRoot(host: string, publisher: Publisher): Promise<string | null> {
  const { pubkey, channel } = publisher
  if (!SIG_RE.test(pubkey)) return null
  const { verifyEvent } = await import('nostr-tools/pure') as { verifyEvent(event: unknown): boolean }
  const indexes = createHash('sha256').update('hive:indexes', 'utf8').digest('hex')
  for (const zone of [...new Set([host, ...publisher.hosts])]) {
    let event: { kind?: number; pubkey?: string; content?: string }
    try {
      const res = await fetch(`https://${zone}/${indexes}/${pubkey}`, { cache: 'no-store' })
      if (!res.ok) continue
      event = await res.json() as typeof event
    } catch { continue }
    if (event?.kind !== INDEX_KIND || event.pubkey !== pubkey || !verifyEvent(event)) {
      throw new Error(`${zone} serves an index that is not ${short(pubkey)}'s — refusing to replicate`)
    }
    const named = String((JSON.parse(String(event.content)) as { roots?: Record<string, string> })?.roots?.[`install:${channel}`] ?? '').toLowerCase()
    if (SIG_RE.test(named)) return named
  }
  return null
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const at = argv.indexOf('--sig')
  const asked = at >= 0 ? String(argv[at + 1] ?? '').trim().toLowerCase() : ''
  const host = publicInstallHost()
  if (!host) {
    console.log(`[replicate] ${PUBLIC_INSTALL_HOST_ENV} names no host — nothing to replicate`)
    return
  }
  if (at >= 0 && !SIG_RE.test(asked)) {
    console.error('[replicate] --sig takes a 64-hex package signature')
    process.exit(1)
  }
  const publisher = publisherRecord()
  const channel = publisher.channel
  let root = asked
  if (!root) {
    const signed = await signedRoot(host, publisher).catch((error: unknown) => {
      console.error(`[replicate] ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    })
    if (!signed) {
      console.error(`[replicate] no verified index on ${host} names install:${channel} — pass --sig <root>`)
      process.exit(1)
    }
    root = signed
    console.log(`[replicate] the signed install:${channel} is ${short(root)}`)
  }
  const report = await replicateRevision({ root, host })
  for (const line of replicationVerdict(report, channel).lines) console.log(line)
  if (!report.ok) process.exitCode = 3
}

/** Run only as a script — a spec imports the helpers above without replicating. */
const invokedDirectly = (): boolean => {
  const entry = process.argv[1]
  if (!entry) return false
  const [a, b] = [resolve(entry), fileURLToPath(import.meta.url)]
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}
if (invokedDirectly()) await main()
