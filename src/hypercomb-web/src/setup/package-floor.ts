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
//   - one move per session: a reload that did not stick is not retried
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

import { EffectBus } from '@hypercomb/core'
import { acquire, headPackage } from '@hypercomb/runtime/acquire'
import { INSTALLED_KEY, installedPackageSig } from '@hypercomb/runtime/installed-package'
import { DEFAULT_HOST_ZONES, listHostZones } from '@hypercomb/runtime/host-zones'
import { cacheImportMap } from './resolve-import-map'

/** What the shell's update pill emits (upgrade-indicator.component.ts). */
export const UPDATE_DOOR = 'packages:open'
/** `{ from, to, zone, at }` of the last floor move. */
export const FLOOR_RECORD_KEY = 'hc:install:floor'
/** sessionStorage: the sig this session already reloaded onto. */
const FLOOR_RELOADED_KEY = 'hc:install:floor-reloaded'
/** After first paint, the surfaces mounting, and the package's own scout. */
const SETTLE_MS = 15_000
/** Quiet time before the reload, so it never lands mid-gesture. */
const IDLE_MS = 3_000

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
  head: { packageSig: string; zone: string } | null
  reloadedFor: string | null
}): FloorPlan => {
  if (!q.installed) return { act: false, why: 'nothing installed' }
  if (!q.legacyRecord && q.doorAnswered === null) return { act: false, why: 'the bus cannot say who listens' }
  if (!q.legacyRecord && q.doorAnswered) return { act: false, why: 'the package answers the update door' }
  if (!q.head) return { act: false, why: 'the seed offered no head' }
  if (q.head.packageSig === q.installed) return { act: false, why: 'already on the seed head' }
  if (q.reloadedFor === q.head.packageSig) return { act: false, why: 'this session already moved to it and it did not stick' }
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

const seedHead = async (): Promise<{ packageSig: string; zone: string } | null> => {
  for (const zone of DEFAULT_HOST_ZONES) {
    try {
      const head = await headPackage(zone)
      if (head) return head
    } catch { /* next seed */ }
  }
  return null
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
  const below = legacyRecord || answered === false
  // Only a package below the floor costs a network call.
  const head = installed && below ? await seedHead() : null
  const plan = planFloor({ installed, legacyRecord, doorAnswered: answered, head, reloadedFor: readSession(FLOOR_RELOADED_KEY) })
  if (!plan.act) {
    if (below) console.warn(`[package-floor] below the floor, not moved: ${plan.why}`)
    return plan
  }

  console.warn(`[package-floor] ${plan.from.slice(0, 12)}… cannot answer the update door on this shell — taking ${plan.to.slice(0, 12)}… from ${plan.zone}`)
  const carried = await listHostZones().catch(() => [] as string[])
  const outcome = await acquire(plan.to, [plan.zone, ...carried.filter(zone => zone !== plan.zone)], { floor: true })
  if (!outcome.ok) {
    console.warn('[package-floor] move failed — staying on the installed package:', outcome.error ?? `${outcome.holes.length} hole(s)`)
    return { act: false, why: outcome.error ?? 'incomplete' }
  }

  try {
    localStorage.setItem(FLOOR_RECORD_KEY, JSON.stringify({ from: plan.from, to: plan.to, zone: plan.zone, at: Date.now() }))
    sessionStorage.setItem(FLOOR_RELOADED_KEY, plan.to)
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

/** Participant web shells only: the native shell adopts its own bundle, and a
 *  visitor runs a publisher's renderer, never an update line. */
export const watchPackageFloor = (): void => {
  setTimeout(() => { void checkPackageFloor().catch(error => console.warn('[package-floor] check threw', error)) }, SETTLE_MS)
}
