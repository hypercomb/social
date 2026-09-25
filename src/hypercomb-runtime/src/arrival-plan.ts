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
    out.push([className, { sig, needs }])
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
  const queue = names.map(classOfKey).filter(Boolean)
  const named = new Set(queue)
  while (queue.length) {
    const cls = queue.shift()!
    if (seen.has(cls)) continue
    seen.add(cls)
    const hit = classes.get(cls)
    if (!hit || !packageBees.has(hit.sig)) {
      // A declared need the package answers some other way (a shell
      // service, a dependency's class) is not a gap; a NAMED face is.
      if (named.has(cls)) missing.push(cls)
      continue
    }
    bees.add(hit.sig)
    for (const key of hit.needs) queue.push(classOfKey(key))
  }
  return { bees, missing }
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
