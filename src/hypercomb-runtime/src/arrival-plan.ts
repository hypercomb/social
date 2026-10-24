// hypercomb-runtime/src/arrival-plan.ts
//
// THE ARRIVAL (jwize, 2026-09-25: "only load the bees revolucion actually
// needs" · "passivated but then ready at a moment's notice"). A published
// branch names the bees its arrival needs — by IoC key, which survives every
// rebuild of the package, never by signature, which does not. The package's
// own layer docs say which bee each class is and which services it declares
// it reads, so the plan names only the faces (a site view, a game view) and
// the rest of what they need follows from the package itself.
//
// Everything the plan does not reach stays PASSIVE: held, not compiled, not
// run — its bytes warm at idle, and it wakes the moment the visitor
// approaches it (`loader:activate`). A plan that resolves to nothing is no
// plan: the package loads as it always has.

export type BeeClass = {
  readonly sig: string
  /** IoC keys the bee declares it reads (`deps` in its layer doc). */
  readonly needs: readonly string[]
  /** A queen's word, and whether loading her only readies it — then she
   *  sleeps until the word is used (essentials scripts/passive-queen.ts). */
  readonly command?: string
  readonly description?: string
  readonly passive?: boolean
  /** The views a sleeping renderer answers: it wakes when one is entered. */
  readonly renders?: readonly string[]
  /** The effects that wake a sleeping bee: it loads when one is emitted. */
  readonly wakesOn?: readonly string[]
}

/** `@domain.com/ClassName` → `ClassName`; a bare class name stays itself. */
export const classOfKey = (key: string): string => {
  const clean = String(key ?? '').trim()
  const slash = clean.lastIndexOf('/')
  return slash >= 0 ? clean.slice(slash + 1) : clean
}

/** A layer doc's bees, as the class index the arrival resolves against. */
export const beeClassesOfDocs = (docs: unknown): Array<[string, BeeClass]> => {
  const bees = (docs as { bees?: Record<string, unknown> } | undefined)?.bees
  if (!bees || typeof bees !== 'object') return []
  const out: Array<[string, BeeClass]> = []
  for (const [ref, doc] of Object.entries(bees)) {
    const sig = ref.replace(/\.js$/i, '').toLowerCase()
    const className = (doc as { className?: unknown })?.className
    if (!/^[a-f0-9]{64}$/.test(sig) || typeof className !== 'string' || !className) continue
    const deps = (doc as { deps?: unknown }).deps
    const needs = deps && typeof deps === 'object'
      ? Object.values(deps as Record<string, unknown>).filter((v): v is string => typeof v === 'string')
      : []
    const command = (doc as { command?: unknown }).command
    const description = (doc as { description?: unknown }).description
    out.push([className, {
      sig,
      needs,
      ...(typeof command === 'string' && command ? { command } : {}),
      ...(typeof description === 'string' && description ? { description } : {}),
      ...((doc as { passive?: unknown }).passive === true ? { passive: true } : {}),
      ...(Array.isArray((doc as { wakesOn?: unknown }).wakesOn)
        ? { wakesOn: ((doc as { wakesOn: unknown[] }).wakesOn).map(String).filter(Boolean) }
        : {}),
      ...(Array.isArray((doc as { renders?: unknown }).renders)
        ? { renders: ((doc as { renders: unknown[] }).renders).map(String).filter(Boolean) }
        : {}),
    }])
  }
  return out
}

/** The bees an arrival loads: every named class, and every class those
 *  declare they read, transitively — restricted to the package's own bees.
 *  `missing` lists plan names the package does not carry. */
export const resolveArrival = (
  names: readonly string[],
  classes: ReadonlyMap<string, BeeClass>,
  packageBees: ReadonlySet<string>,
): { bees: Set<string>; missing: string[] } => {
  const bees = new Set<string>()
  const missing: string[] = []
  const seen = new Set<string>()
  // A plan said as a sentence arrives folded to lower case (the reader folds
  // a bare line: `@….com/viewbee`), and no two classes differ by case alone —
  // so a name finds its class in any case. Signed plans stay as they were.
  const folded = new Map([...classes].map(([name, cls]) => [name.toLowerCase(), cls]))
  const queue = names.map(classOfKey).filter(Boolean)
  const named = new Set(queue.map(cls => cls.toLowerCase()))
  while (queue.length) {
    const cls = queue.shift()!
    if (seen.has(cls.toLowerCase())) continue
    seen.add(cls.toLowerCase())
    const hit = classes.get(cls) ?? folded.get(cls.toLowerCase())
    if (!hit || !packageBees.has(hit.sig)) {
      // A declared need the package answers some other way (a shell
      // service, a dependency's class) is not a gap; a NAMED face is.
      if (named.has(cls.toLowerCase())) missing.push(cls)
      continue
    }
    bees.add(hit.sig)
    for (const key of hit.needs) queue.push(classOfKey(key))
  }
  return { bees, missing }
}

// A STALLED ARRIVAL WAKES THE REST (jwize 2026-10-18: "we can create many
// different apps that need to show soon" — so a plan is derived at publish,
// with no tuning, and a derived plan can miss a bee its page reads without
// declaring it). The arrival answers with its verdict (`view:arrival`): a view
// opening is the plan working. The door opening as hexagons, or no verdict
// ARRIVAL_GRACE_MS after the planned bees are in, means what the reader needs
// is asleep — so everything wakes, as if there had been no plan. The worst a
// wrong plan costs is the old speed plus the grace.

export const ARRIVAL_GRACE_MS = 2500

type BusLike = { on<T>(effect: string, handler: (payload: T) => void): () => void }
type TimersLike = { set: (run: () => void, ms: number) => unknown; clear: (handle: unknown) => void }

/** Watch one planned arrival; `wake` runs at most once. Returns a stop. */
export const guardArrival = (
  bus: BusLike,
  wake: (reason: 'hexagons' | 'stalled') => void,
  graceMs = ARRIVAL_GRACE_MS,
  timers: TimersLike = { set: (run, ms) => setTimeout(run, ms), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
): (() => void) => {
  let done = false
  let timer: unknown = null
  const offs: Array<() => void> = []
  const stop = (): void => {
    if (done) return
    done = true
    if (timer !== null) timers.clear(timer)
    for (const off of offs.splice(0)) off()
  }
  const finish = (reason: 'hexagons' | 'stalled' | null): void => {
    if (done) return
    stop()
    if (reason) wake(reason)
  }
  // The bus replays a last value as it subscribes, so a handler may finish
  // the watch before its own unsubscribe exists: drop it the moment it does.
  const listen = <T>(effect: string, handler: (payload: T) => void): void => {
    const off = bus.on<T>(effect, handler)
    if (done) off()
    else offs.push(off)
  }
  listen<{ view?: string }>('view:arrival', p => finish(p?.view ? null : 'hexagons'))
  if (!done) listen('loader:bees-done', () => {
    if (done || timer !== null) return
    timer = timers.set(() => finish('stalled'), graceMs)
  })
  return stop
}

/** The plan this visit carries, if its shell found one: the IoC keys the
 *  publisher's arrival needs. The shell starts reading it before the runtime
 *  exists (hypercomb-web main.visitor.ts), so this only waits on a read
 *  already in flight — bounded, and a slow or absent plan is no plan. */
export const arrivalNames = async (ms = 4000): Promise<string[] | null> => {
  const pending = (globalThis as { __hcArrival?: Promise<unknown> | unknown }).__hcArrival
  if (pending === undefined || pending === null) return null
  let timer: ReturnType<typeof setTimeout> | undefined
  const value = await Promise.race([
    Promise.resolve(pending).catch(() => null),
    new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), ms) }),
  ])
  clearTimeout(timer)
  if (!Array.isArray(value)) return null
  const names = value.map(v => String(v ?? '').trim()).filter(Boolean)
  return names.length ? names : null
}

/** FEATURES FOR PARTICIPANTS ONLY (essentials sharing/participant-features.ts):
 *  the names in the `features:participant` pool of the publisher whose site
 *  this is, as the shell read them from the snapshot the publisher's signed
 *  index names (`pool:features:participant`). A read-only reader never loads
 *  a bee under a layer so named. Absent, slow or empty: nothing is quiet. */
export const quietFeatureNames = async (ms = 4000): Promise<Set<string>> => {
  const pending = (globalThis as { __hcQuietFeatures?: Promise<unknown> | unknown }).__hcQuietFeatures
  if (pending === undefined || pending === null) return new Set()
  let timer: ReturnType<typeof setTimeout> | undefined
  const value = await Promise.race([
    Promise.resolve(pending).catch(() => null),
    new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), ms) }),
  ])
  clearTimeout(timer)
  return new Set(Array.isArray(value) ? value.map(v => String(v ?? '').trim()).filter(Boolean) : [])
}
