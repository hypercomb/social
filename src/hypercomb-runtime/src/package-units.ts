// hypercomb-runtime/src/package-units.ts
//
// A PACKAGE IS A NAMED LAYER OF THE SERVED TREE. The root a publisher signs
// has one child layer per feature directory — assistant, games, sharing,
// presentation — and each carries its own bees. That child is the unit a
// participant turns on or off: the NAME is its identity (the grammar), the
// layer signature is its version. A build that changes `games` and nothing
// else changes exactly one unit's signature, which is how a per-package
// update mark is honest rather than decorative.
//
// ON/OFF is a name set, not a signature set, so it survives every update.
// What is off is simply left out of the bee list activation writes; its layers
// and dependencies stay held, so turning it back on is a repoint, never a
// fetch.

import { SignatureService } from '@hypercomb/core'
import { resolveSignatureClosure, type ReplicationIo } from './replication-walker.js'
import { isPath } from './package-tree.js'

/** localStorage key holding the name paths this participant has off —
 *  `games`, or `games/arkanoid` beneath it. */
export const UNITS_OFF_KEY = 'hc:install:off-units'

const SIG_RE = /^[a-f0-9]{64}$/
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i

export type PackageUnit = {
  name: string
  layerSig: string
  bees: string[]
  description: string
}

const bare = (value: unknown): string =>
  String(value ?? '').trim().toLowerCase().replace(/\.(?:js|json)$/, '')

const sigsOf = (list: unknown): string[] =>
  (Array.isArray(list) ? list : [])
    .map(entry => bare(typeof entry === 'string' ? entry : (entry as { sig?: unknown })?.sig))
    .filter(sig => SIG_RE.test(sig))

type LayerRecord = { name?: unknown; cells?: unknown; bees?: unknown; dependencies?: unknown; docs?: { description?: unknown } }

const parseLayer = (bytes: Uint8Array | null): LayerRecord | null => {
  if (!bytes) return null
  try { return JSON.parse(new TextDecoder().decode(bytes)) as LayerRecord } catch { return null }
}

/** One atom, held or admitted: the walker verifies it against its own name
 *  and writes it before it is read back, so nothing unverified is parsed. */
const readAtom = async (sig: string, io: ReplicationIo): Promise<Uint8Array<ArrayBuffer> | null> => {
  const held = await io.read(sig)
  if (held && (await SignatureService.sign(held.buffer)) === sig) return held
  const result = await resolveSignatureClosure(sig, io, { children: () => [] })
  return result.held.includes(sig) ? io.read(sig) : null
}

/**
 * The units of one package root: its top-level layers, each with every bee
 * its subtree declares. A subtree that cannot be resolved yields no unit — a
 * caller then sees fewer units, never a unit with a partial bee list.
 */
export const packageUnits = async (rootSig: string, io: ReplicationIo): Promise<PackageUnit[]> => {
  const root = parseLayer(await readAtom(rootSig, io))
  if (!root) return []
  const units: PackageUnit[] = []
  for (const layerSig of sigsOf(root.cells)) {
    const walk = await resolveSignatureClosure(layerSig, io, { children: bytes => sigsOf(parseLayer(bytes)?.cells) })
    if (walk.holes.length || walk.refused.length || walk.limited) continue
    const top = parseLayer(await io.read(layerSig))
    const name = String(top?.name ?? '').trim()
    if (!NAME_RE.test(name)) continue
    const bees = new Set<string>()
    for (const sig of walk.held) for (const bee of sigsOf(parseLayer(await io.read(sig))?.bees)) bees.add(bee)
    units.push({
      name,
      layerSig,
      bees: [...bees].sort(),
      description: String(top?.docs?.description ?? '').trim(),
    })
  }
  return units.sort((a, b) => a.name.localeCompare(b.name))
}

export const readOffUnits = (storage: Pick<Storage, 'getItem'> = localStorage): Set<string> => {
  try {
    const raw = JSON.parse(storage.getItem(UNITS_OFF_KEY) ?? '[]')
    return new Set((Array.isArray(raw) ? raw : []).map(String).filter(isPath))
  } catch { return new Set() }
}

export const writeOffUnits = (off: Iterable<string>, storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage): void => {
  const names = [...new Set([...off].filter(isPath))].sort()
  try {
    if (names.length) storage.setItem(UNITS_OFF_KEY, JSON.stringify(names))
    else storage.removeItem(UNITS_OFF_KEY)
  } catch { /* storage unavailable */ }
}

/** The bees that load: every bee, minus those declared only by units that are
 *  off. A bee two units both declare stays while either is on. */
export const beesWithUnitsOff = (bees: readonly string[], units: readonly PackageUnit[], off: ReadonlySet<string>): string[] => {
  const kept = new Set<string>()
  for (const unit of units) if (!off.has(unit.name)) for (const bee of unit.bees) kept.add(bee)
  const declared = new Set(units.flatMap(unit => unit.bees))
  return bees.filter(bee => kept.has(bee) || !declared.has(bee))
}

/** The unit a namespace dependency belongs to, by the alias on its first line:
 *  `// @hypercomb/essentials/presentation/tiles` → `presentation`. */
export const unitOfDependency = (bytes: Uint8Array | null): string => {
  if (!bytes) return ''
  const line = new TextDecoder().decode(bytes.subarray(0, 240)).split('\n')[0] ?? ''
  const alias = line.replace(/^\s*\/\/\s*/, '').trim()
  const ns = alias.startsWith('@hypercomb/essentials/') ? alias.slice('@hypercomb/essentials/'.length) : alias.replace(/^@/, '')
  const name = ns.split('/')[0] ?? ''
  return NAME_RE.test(name) ? name : ''
}

/**
 * Which units a newer root moved through its NAMESPACE DEPENDENCIES. A queen,
 * a view or a service builds into its namespace's dependency bundle, and those
 * are listed on the root layer only — so a change to one moves the root and no
 * unit layer. Each dependency the two roots do not share is attributed to the
 * unit its alias names: bytes from what is held, else fetched and verified. A
 * dependency that cannot be read marks nothing.
 */
export const dependencyUnits = async (
  installedRoot: string,
  nextRoot: string,
  io: ReplicationIo,
  readHeld: (sig: string) => Promise<Uint8Array<ArrayBuffer> | null>,
): Promise<Set<string>> => {
  const [a, b] = await Promise.all([readAtom(installedRoot, io), readAtom(nextRoot, io)])
  const before = new Set(sigsOf(parseLayer(a)?.dependencies))
  const after = new Set(sigsOf(parseLayer(b)?.dependencies))
  const changed = [...after].filter(sig => !before.has(sig)).concat([...before].filter(sig => !after.has(sig)))
  const units = new Set<string>()
  for (const sig of changed) {
    let bytes = await readHeld(sig)
    if (!bytes) {
      const fetched = await io.fetch(sig)
      bytes = fetched && (await SignatureService.sign(fetched.buffer)) === sig ? fetched : null
    }
    const name = unitOfDependency(bytes)
    if (name) units.add(name)
  }
  return units
}

/** Which units a newer root changes, by name: a unit whose layer signature
 *  differs, or one the installed root does not have at all. */
export const changedUnits = (installed: readonly PackageUnit[], next: readonly PackageUnit[]): Set<string> => {
  const before = new Map(installed.map(unit => [unit.name, unit.layerSig]))
  return new Set(next.filter(unit => before.get(unit.name) !== unit.layerSig).map(unit => unit.name))
}
