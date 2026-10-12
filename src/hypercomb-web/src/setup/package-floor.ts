// hypercomb-web/src/setup/package-floor.ts
//
// THE FLOOR: a package too old to update itself is updated by the shell.
//
// Updating lives in the package. Its update scout announces a new build, the
// shell's pill emits `packages:open`, and its Packages window takes the build.
// That works only while the package speaks the shell's current door. A package
// from before 2026-09-12 does not: its window never answers `packages:open`,
// its scout follows no publisher (the key landed 2026-09-11), and its own
// update button fires `hypercomb:apply-update`, which the shell stopped
// listening to. Observed 2026-09-21 on a Mac running an Aug 31 package:
// nothing it offered could move it, and nothing the shell offered reached it.
//
// So once per boot, after the page settles, the shell asks one derived
// question: does anything answer the door the pill emits? If nothing does, the
// live package is below the floor, and the shell takes the ONE named seed's
// head for it:
//
//   - trust: activation-authority's FLOOR door (seed only), genesis spent again
//   - integrity: every atom is sha256-verified and the core surface is checked
//   - complete-or-absent: a failed move activates nothing, and the old
//     package keeps running and is asked again next boot
//   - nothing is deleted: the old package's bytes stay, and the move is
//     recorded under FLOOR_RECORD_KEY
//   - one move per session: once this session has moved, the floor never acts
//     again in it — not to the same target, and not to the other one (there
//     can be two: the signed root and the seed's pool head, and a guard that
//     remembered only the last would alternate between them forever)
//
// A package that answers the door is never touched here. Updating it stays the
// participant's choice (the Packages window), exactly as before.
//
// Except when the install is known only by the bundled install's old stamp.
// That package went live before the shared stamp existed (2026-08-31), so it
// predates the door (2026-09-12), and whatever answers the door on it came
// from the pool, not from the package: an install that old has no dependency
// bag, so its import map loads every dependency the pool holds. Observed
// 2026-09-22 on hypercomb.io: a reload landed mid-move, the head's atoms stayed
// in the pool, the next boot loaded the head's Packages window beside the old
// package — listening on the door, with no hosts drone to open it — and the
// floor stood aside for good. For such an install the bus is not asked.
//
// AND A PACKAGE THAT KEEPS SWARM MEMBERSHIP IN THE ORIGIN-WIDE FLAG. Answering
// the door is not enough. A package from before per-tab membership (2026-10-03)
// gates every swarm heartbeat, beacon and publish on `hc:mesh-public`, the one
// flag every tab shares — and the shell rewrites it from THIS tab's session at
// every boot, so opening a second hypercomb.io tab silenced the joined one
// mid-meeting while it still looked joined (reproduced 2026-10-09 on the Sep 30
// package, which still answers the door). Its bytes say so: it reads
// `hc:mesh-public` and never `hc:mesh-session`. Such a package is below the
// floor too. A package with no swarm in it reads neither and is left alone.
//
// AND A PACKAGE THAT MEETS ON THE HOME MACHINE. On 2026-10-11 the shipped
// meeting point moved from the owner's home PC to wss://hypercomb.com, which
// never sleeps. A package from before that still dials the home PC by
// default, so with the same room and the same secret it sits in a different
// meeting from every updated device (observed that day: a phone on the new
// package and a desktop on the old one never met), and only while that PC is
// on. Its bytes say so: they carry the mesh's relay anchor and never name
// wss://hypercomb.com. Such a package is below the floor. One that names it is
// never moved for this, whatever else it names; one with no mesh is left
// alone. A move made for the meeting point alone must reach it: the target's
// bytes are read once held, before anything runs, and a target that still
// dials the home machine is refused (acquire `refuse`), complete-or-absent.
//
// THE FLOOR MOVES THE TRUNK, NEVER A PICK. What runs is the trunk with the
// participant's picks and drafts laid over it, and a move carries every pick
// across. So a byte rule condemns a package only for modules the TRUNK put
// there: an old module that a pick brought would survive any move, and the
// floor would trade one head for the other at every boot without ever
// changing what runs.
//
// WHERE IT GOES: the root the followed publisher SIGNED (the index the update
// scout reads), then the seed's pool head when that root cannot be had from
// the seed yet. The pool alone lagged the channel for ten days.

import { EffectBus } from '@hypercomb/core'
import { acquire, headPackage, layersIoFor } from '@hypercomb/runtime/acquire'
import { INSTALLED_KEY, installedPackageSig } from '@hypercomb/runtime/installed-package'
import { readPicks, walkTree } from '@hypercomb/runtime/package-tree'
import { DEFAULT_HOST_ZONES, listHostZones } from '@hypercomb/runtime/host-zones'
import { installCandidates, readInstallChannel, type ChannelRead } from '@hypercomb/runtime/host-packages'
import { cacheImportMap } from './resolve-import-map'
import { shellInstallFollow, verifyIndexEvent } from './install-follow'

/** What the shell's update pill emits (upgrade-indicator.component.ts). */
export const UPDATE_DOOR = 'packages:open'
/** `{ from, to, zone, at }` of the last floor move. */
export const FLOOR_RECORD_KEY = 'hc:install:floor'
/** sessionStorage: the sig this session already reloaded onto. Its presence
 *  alone ends the floor for the session (planFloor). */
const FLOOR_RELOADED_KEY = 'hc:install:floor-reloaded'
/** After first paint, the surfaces mounting, and the package's own scout. */
const SETTLE_MS = 15_000
/** Quiet time before the reload, so it never lands mid-gesture. */
const IDLE_MS = 3_000

/** Per-tab membership's key — a package that reads it keeps the join per tab.
 *  MIRRORED: hypercomb-shared/core/mesh-session.ts, essentials
 *  sharing/membership.ts. */
const TAB_MEMBERSHIP_KEY = 'hc:mesh-session'
/** The origin-wide flag a package from before per-tab membership gates on. */
const ORIGIN_MEMBERSHIP_KEY = 'hc:mesh-public'
/** The meeting point every package since 2026-10-11 dials by default.
 *  MIRRORED: essentials sharing/nostr-mesh.drone.ts LIVE_RELAY (doctrine.spec
 *  keeps the two one host). */
export const MEETING_POINT = 'wss://hypercomb.com'
/** The mesh's global relay anchor (`{ local, live }`), written by every mesh
 *  since 2026-06-01 so its default relay is never tree-shaken out. A package
 *  that carries it and never names MEETING_POINT still dials the home machine.
 *  MIRRORED: essentials sharing/nostr-mesh.drone.ts. */
const MESH_RELAYS_ANCHOR = '__HYPERCOMB_RELAYS__'
/** Where an activation leaves its module sets (acquire.ts, ensure-install.ts). */
const INSTALL_MANIFEST_KEY = 'core-adapter.installed-manifest'

export type FloorPlan =
  | { act: false; why: string }
  | { act: true; from: string; to: string; zone: string }

/** Pure: should the shell move the live package, and to what? */
export const planFloor = (q: {
  installed: string | null
  /** The install is known only by the old bundled stamp — older than the
   *  door, so the door's answer is not its own. */
  legacyRecord?: boolean
  /** Does anything answer the update door? null when the bus cannot say. */
  doorAnswered: boolean | null
  /** Does the live package keep swarm membership per tab? false when its
   *  bytes read only the origin-wide flag; null when they cannot say (or it
   *  has no swarm at all). */
  perTabMembership?: boolean | null
  /** Does the live package dial MEETING_POINT by default? false when its
   *  bytes carry the mesh and never name it; null when they cannot say (or it
   *  has no mesh at all). */
  currentMeetingPoint?: boolean | null
  head: { packageSig: string; zone: string } | null
  reloadedFor: string | null
}): FloorPlan => {
  if (!q.installed) return { act: false, why: 'nothing installed' }
  const below = q.legacyRecord === true || q.perTabMembership === false || q.currentMeetingPoint === false
  if (!below && q.doorAnswered === null) return { act: false, why: 'the bus cannot say who listens' }
  if (!below && q.doorAnswered) return { act: false, why: 'the package answers the update door' }
  if (!q.head) return { act: false, why: 'the seed offered no head' }
  if (q.head.packageSig === q.installed) return { act: false, why: 'already on the seed head' }
  if (q.reloadedFor) return { act: false, why: 'this session already moved once — a move that did not stick is not retried' }
  return { act: true, from: q.installed, to: q.head.packageSig, zone: q.head.zone }
}

const doorAnswered = (): boolean | null => {
  const bus = EffectBus as { listens?: (effect: string) => boolean }
  return typeof bus.listens === 'function' ? bus.listens(UPDATE_DOOR) : null
}

/** Is the live package on the shared stamp, or only on the old one? */
const stamped = (): boolean => {
  try { return /^[a-f0-9]{64}$/.test(localStorage.getItem(INSTALLED_KEY) ?? '') } catch { return false }
}

/** One question a package's bytes answer: `current` clears it, `old` without
 *  `current` condemns it, and a package naming neither has nothing to say. */
type ByteRule = { readonly current: string; readonly old: string }
type ByteVerdict = 'current' | 'old' | 'none' | null

const MEMBERSHIP_RULE: ByteRule = { current: TAB_MEMBERSHIP_KEY, old: ORIGIN_MEMBERSHIP_KEY }
const MEETING_POINT_RULE: ByteRule = { current: MEETING_POINT, old: MESH_RELAYS_ANCHOR }

/**
 * What a package's modules say, rule by rule, in ONE read of each module —
 * pure over a reader.
 *
 * 'current' as soon as any module names the rule's current marker; 'old' when
 * modules name its old marker and none names the current one; 'none' when
 * neither appears. null when a module could not be read and the current
 * marker was not found — the missing one might have named it. Reading stops
 * once every rule is 'current' (a current package usually answers within its
 * first few modules).
 */
const scanBytes = async (
  sigs: readonly string[],
  read: (sig: string) => Promise<string | null>,
  rules: readonly ByteRule[],
): Promise<ByteVerdict[]> => {
  const current = rules.map(() => false)
  const old = rules.map(() => false)
  let unread = false
  for (const sig of sigs) {
    if (current.every(Boolean)) break
    const text = await read(sig)
    if (text === null) { unread = true; continue }
    rules.forEach((rule, i) => {
      if (text.includes(rule.current)) current[i] = true
      else if (text.includes(rule.old)) old[i] = true
    })
  }
  return rules.map((_, i) => current[i] ? 'current' : unread ? null : old[i] ? 'old' : 'none')
}

/**
 * What a package's modules say about swarm membership: 'tab' as soon as any
 * module reads the per-tab key, 'origin' when modules read only the
 * origin-wide flag, 'none' when neither appears (no swarm), null when a module
 * could not be read and no per-tab reader was found.
 */
export const scanMembership = async (
  sigs: readonly string[],
  read: (sig: string) => Promise<string | null>,
): Promise<'tab' | 'origin' | 'none' | null> => {
  const [verdict] = await scanBytes(sigs, read, [MEMBERSHIP_RULE])
  return verdict === 'current' ? 'tab' : verdict === 'old' ? 'origin' : verdict ?? null
}

/**
 * Which meeting point a package dials by default: 'current' as soon as any
 * module names MEETING_POINT (whatever else it names), 'old' when a module
 * carries the mesh's relay anchor and none names it, 'none' when there is no
 * mesh, null when a module could not be read and none named it.
 */
export const scanMeetingPoint = async (
  sigs: readonly string[],
  read: (sig: string) => Promise<string | null>,
): Promise<ByteVerdict> => (await scanBytes(sigs, read, [MEETING_POINT_RULE]))[0] ?? null

/**
 * The floor's last word over a TARGET's bytes, asked by acquire once every
 * module is held and verified and before anything runs (InstallOptions
 * `refuse`): a move made for the meeting point never lands on a package that
 * still dials the home machine. Only bytes that say so refuse.
 */
export const refuseOldMeetingPoint = async (
  modules: readonly string[],
  read: (sig: string) => Promise<Uint8Array | null>,
): Promise<string | null> => {
  const decoder = new TextDecoder()
  const verdict = await scanMeetingPoint(modules, async sig => {
    const bytes = await read(sig)
    return bytes ? decoder.decode(bytes) : null
  })
  return verdict === 'old' ? `the target still dials the home machine, not ${MEETING_POINT}` : null
}

type ModuleDirs = {
  readonly bees?: FileSystemDirectoryHandle
  readonly dependencies?: FileSystemDirectoryHandle
  readonly legacyBees?: FileSystemDirectoryHandle
  readonly legacyDependencies?: FileSystemDirectoryHandle
}

const readText = (dirs: (FileSystemDirectoryHandle | undefined)[]) => async (sig: string): Promise<string | null> => {
  for (const dir of dirs) {
    if (!dir) continue
    for (const name of [`${sig}.js`, sig]) {
      try { return await (await (await dir.getFileHandle(name, { create: false })).getFile()).text() } catch { /* next */ }
    }
  }
  return null
}

/** What a package's bytes say, as the floor asks it: true current, false
 *  below, null cannot say (or the package has nothing to say). */
export type PackageBytes = {
  readonly perTabMembership: boolean | null
  readonly currentMeetingPoint: boolean | null
}
const UNSAID: PackageBytes = { perTabMembership: null, currentMeetingPoint: null }
const said = (verdict: ByteVerdict): boolean | null => verdict === 'current' ? true : verdict === 'old' ? false : null

/** What a package's bytes said, kept for this page's life. A pure derivation
 *  of the package signature when nothing is picked over it, so nothing is
 *  written for it: the next boot reads the modules again (a current package
 *  answers within its first few). */
const packageVerdicts = new Map<string, PackageBytes>()

/** Every module the trunk's own tree names, picks aside — read from held
 *  layers only, never fetched. null when the tree cannot be walked here. */
const trunkModules = async (trunk: string): Promise<Set<string> | null> => {
  const io = await layersIoFor([]).catch(() => null)
  if (!io) return null
  const walk = await walkTree(trunk, { ...io, fetch: async () => null }).catch(() => null)
  if (!walk?.complete) return null
  return new Set([...walk.rootDependencies, ...walk.rootBees, ...walk.nodes.flatMap(node => node.bees)])
}

/** What the live package's own modules say — membership and meeting point in
 *  one read of each module (dependencies first — that is where a current build
 *  keeps membership), at most once per package per page. UNSAID when the
 *  store or the manifest cannot say; a rule is null when a module could not be
 *  read before it was answered.
 *
 *  'current' is read off everything that runs: a pick that brings the current
 *  marker clears the package. 'old' must come from the trunk: with a live pick
 *  over it, an old marker that no running trunk module carries says nothing
 *  (the floor moves the trunk, never a pick). */
export const packageBytes = async (installed: string): Promise<PackageBytes> => {
  // A pick from the trunk itself is no pick: the trunk already names it (acquire applySelection).
  const picked = Object.values(readPicks()).some(pick => pick.root !== installed)
  const known = picked ? undefined : packageVerdicts.get(installed)
  if (known !== undefined) return known
  let manifest: { bees?: unknown; dependencies?: unknown } | null = null
  try { manifest = JSON.parse(localStorage.getItem(INSTALL_MANIFEST_KEY) ?? 'null') } catch { return UNSAID }
  const sigsOf = (value: unknown): string[] => Array.isArray(value) ? value.filter((sig): sig is string => typeof sig === 'string') : []
  const dependencies = sigsOf(manifest?.dependencies)
  const bees = sigsOf(manifest?.bees)
  if (!bees.length) return UNSAID
  const store = (globalThis as { ioc?: { get?: (key: string) => unknown } }).ioc?.get?.('@hypercomb.social/Store') as ModuleDirs | undefined
  if (!store) return UNSAID
  const dependencyText = readText([store.dependencies, store.legacyDependencies])
  const beeText = readText([store.bees, store.legacyBees])
  const beeSet = new Set(bees)
  const texts = new Map<string, Promise<string | null>>()
  const read = (sig: string): Promise<string | null> => {
    let text = texts.get(sig)
    if (!text) { text = beeSet.has(sig) ? beeText(sig) : dependencyText(sig); texts.set(sig, text) }
    return text
  }
  const rules = [MEMBERSHIP_RULE, MEETING_POINT_RULE] as const
  const running = [...dependencies, ...bees]
  let [membership = null, meeting = null] = await scanBytes(running, read, rules)
  if (picked && (membership === 'old' || meeting === 'old')) {
    const trunk = await trunkModules(installed)
    const [ownMembership = null, ownMeeting = null] = trunk
      ? await scanBytes(running.filter(sig => trunk.has(sig)), read, rules)
      : [null, null]
    if (membership === 'old' && ownMembership !== 'old') membership = null
    if (meeting === 'old' && ownMeeting !== 'old') meeting = null
  }
  const verdict: PackageBytes = { perTabMembership: said(membership), currentMeetingPoint: said(meeting) }
  // Kept only when both rules were answered (an unread module might change
  // it) and nothing is picked (a pick changes what runs, not the signature).
  if (!picked && membership !== null && meeting !== null) packageVerdicts.set(installed, verdict)
  return verdict
}

/** Does the live package keep membership per tab? (packageBytes) */
export const perTabMembership = async (installed: string): Promise<boolean | null> =>
  (await packageBytes(installed)).perTabMembership

const seedHead = async (): Promise<{ packageSig: string; zone: string } | null> => {
  for (const zone of DEFAULT_HOST_ZONES) {
    try {
      const head = await headPackage(zone)
      if (head) return head
    } catch { /* next seed */ }
  }
  return null
}

/** Where a package below the floor goes, in order: the signed install root,
 *  then the seed's pool head when it differs (runtime installCandidates). */
const floorHeads = async (): Promise<{ packageSig: string; zone: string }[]> => {
  const unreachable: ChannelRead = { state: 'unreachable' }
  const [channel, pool] = await Promise.all([
    readInstallChannel(shellInstallFollow(), verifyIndexEvent).catch(() => unreachable),
    seedHead(),
  ])
  const { candidates, refused } = installCandidates(channel, pool)
  if (refused) console.warn(`[package-floor] ${refused}`)
  return candidates
}

const readSession = (key: string): string | null => {
  try { return sessionStorage.getItem(key) } catch { return null }
}

const quiet = (): Promise<void> => new Promise(resolve => {
  const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
  let last = Date.now()
  const bump = (): void => { last = Date.now() }
  for (const name of events) window.addEventListener(name, bump, { passive: true, capture: true })
  const tick = (): void => {
    if (!document.hidden && Date.now() - last < IDLE_MS) { setTimeout(tick, 500); return }
    for (const name of events) window.removeEventListener(name, bump, { capture: true })
    resolve()
  }
  tick()
})

/** One check. Moves the live package and reloads when it is below the floor. */
export const checkPackageFloor = async (): Promise<FloorPlan> => {
  const installed = installedPackageSig()
  const legacyRecord = !!installed && !stamped()
  const answered = doorAnswered()
  // Only asked when nothing has already put it below the floor. A local read
  // of the package's own modules, once per package — never a network call.
  const bytes = installed && !legacyRecord && answered !== false
    ? await packageBytes(installed).catch(() => UNSAID)
    : UNSAID
  const perTab = bytes.perTabMembership
  const meetingPoint = bytes.currentMeetingPoint
  const reason = legacyRecord || answered === false ? 'door'
    : perTab === false ? 'membership'
    : meetingPoint === false ? 'meeting point'
    : null
  const below = reason !== null
  // Only a package below the floor costs a network call.
  const heads = installed && below ? await floorHeads() : []
  const reloadedFor = readSession(FLOOR_RELOADED_KEY)
  const ask = (head: { packageSig: string; zone: string } | null): FloorPlan =>
    planFloor({ installed, legacyRecord, doorAnswered: answered, perTabMembership: perTab, currentMeetingPoint: meetingPoint, head, reloadedFor })

  let last = ask(heads[0] ?? null)
  let carried: string[] | null = null
  for (const head of heads) {
    const plan = ask(head)
    if (!plan.act) { last = plan; continue }

    const why = reason === 'door' ? 'cannot answer the update door on this shell'
      : reason === 'membership' ? 'keeps swarm membership in the flag every tab shares'
      : `still dials the home machine, never ${MEETING_POINT}`
    console.warn(`[package-floor] ${plan.from.slice(0, 12)}… ${why} — taking ${plan.to.slice(0, 12)}… from ${plan.zone}`)
    carried ??= await listHostZones().catch(() => [] as string[])
    // A move the meeting point alone justifies must reach it; one the door or
    // membership justifies already mends what they found, and the meeting
    // point moves it again, next session, once a head that reaches it exists.
    const outcome = await acquire(
      plan.to,
      [plan.zone, ...carried.filter(zone => zone !== plan.zone)],
      reason === 'meeting point' ? { floor: true, refuse: refuseOldMeetingPoint } : { floor: true },
    )
    if (!outcome.ok) {
      console.warn(`[package-floor] move to ${plan.to.slice(0, 12)}… failed:`, outcome.error ?? `${outcome.holes.length} hole(s)`)
      last = { act: false, why: outcome.error ?? 'incomplete' }
      continue
    }

    // The guard first, on its own: a record that cannot be written (a full
    // quota) must never cost the one-move-per-session rule — that is a loop.
    try { sessionStorage.setItem(FLOOR_RELOADED_KEY, plan.to) } catch { /* see below */ }
    if (readSession(FLOOR_RELOADED_KEY) !== plan.to) {
      console.warn('[package-floor] moved, but this session cannot remember it — not reloading (the next boot runs the moved package)')
      return plan
    }
    try {
      localStorage.setItem(FLOOR_RECORD_KEY, JSON.stringify({ from: plan.from, to: plan.to, zone: plan.zone, at: Date.now() }))
    } catch { /* the move stands without its record */ }
    // The reload boots on a frozen import map; cache the one the move made.
    try { await cacheImportMap() } catch (error) {
      console.warn('[package-floor] import map not cached before reload', error)
    }
    await quiet()
    console.log(`[package-floor] moved to ${plan.to.slice(0, 12)}… — reloading onto it`)
    location.reload()
    return plan
  }
  if (below) console.warn(`[package-floor] below the floor, not moved — staying on the installed package: ${last.act ? 'no head' : last.why}`)
  return last
}

/** Participant web shells only: the native shell adopts its own bundle, and a
 *  visitor runs a publisher's renderer, never an update line. */
export const watchPackageFloor = (): void => {
  setTimeout(() => { void checkPackageFloor().catch(error => console.warn('[package-floor] check threw', error)) }, SETTLE_MS)
}
