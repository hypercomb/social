// hypercomb-essentials/scripts/build-determinism.ts
//
// WHAT MAKES TWO BUILDS OF THE SAME INPUTS THE SAME BYTES. The package's
// identity is its root signature, and the root is a hash of layers whose
// JSON lists children, bees and dependencies IN AN ORDER — so any order that
// depends on the machine (an ICU locale's collation, a directory listing's
// native order) or any cache that trusts a clock instead of the bytes makes
// the same source tree mint different packages on different machines.
//
// Three rules, each one function here:
//   1. ORDER BY CODE UNIT. `localeCompare` ranks `-`, `_`, case and accents by
//      the ICU data the runtime shipped with; code-unit order is the same on
//      every machine. Anything whose order reaches a signature sorts with
//      `byCodeUnit`.
//   2. A CACHE HITS ON CONTENT. A file's identity is the hash of its bytes
//      (`fileContentSig`); an mtime says only that something touched it. A
//      checkout, a copy, or `touch` moves mtimes without moving a byte, and a
//      restore can move bytes without moving an mtime.
//   3. A PUBLISH SIGNS WHAT WAS BUILT FROM THESE SOURCES. A build leaves a
//      stamp — the digest of its inputs and the root it made — and a publish
//      that skips the build (`--no-build`) must find a stamp that still
//      matches the sources on disk, or refuse.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

/** Locale-free ordering: UTF-16 code units, identical on every machine. */
export const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Directory entries in code-unit order (the OS listing order is not stable). */
export const sortedNames = (dir: string): string[] => readdirSync(dir).slice().sort(byCodeUnit)

/** sha256 of a file's bytes — the identity a cache keys on. */
export const fileContentSig = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex')

/** Has any recorded input changed? `recorded` maps path → the content sig the
 *  last build saw. A missing or unreadable file counts as changed; an mtime is
 *  never consulted. */
export const inputsMoved = (
  recorded: Readonly<Record<string, { sig: string }>>,
  hash: (path: string) => string = fileContentSig,
): boolean => {
  for (const [path, leaf] of Object.entries(recorded)) {
    try { if (hash(path) !== leaf.sig) return true } catch { return true }
  }
  return false
}

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of sortedNames(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const isBuildInput = (rel: string): boolean =>
  /\.(ts|js|json)$/.test(rel) && !/\.d\.ts$/.test(rel) && !/\.spec\.ts$/.test(rel)

/**
 * The digest of everything a build reads from this project: every source file
 * under `src/`, the atomized-roots list and the build scripts, each by content,
 * in code-unit path order. Deliberately wider than the build's own unit lists —
 * a stamp that over-invalidates costs a rebuild; one that under-invalidates
 * signs the wrong bytes.
 */
export const buildInputsDigest = (projectRoot: string, scriptFiles: readonly string[]): string => {
  const files = [
    ...walk(join(projectRoot, 'src')).filter(f => isBuildInput(relative(projectRoot, f))),
    join(projectRoot, 'atomized-roots.json'),
    ...scriptFiles,
  ]
  const lines = files
    .map(f => [relative(projectRoot, f).replace(/\\/g, '/'), existsSync(f) ? fileContentSig(f) : 'absent'] as const)
    .sort(([a], [b]) => byCodeUnit(a, b))
    .map(([rel, sig]) => `${rel}\0${sig}`)
  return createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex')
}

/** The build scripts whose change changes the bytes a build makes. */
export const BUILD_SCRIPT_FILES = ['build-module.ts', 'passive-queen.ts', 'build-determinism.ts', 'pool-address.ts']

export const buildScriptPaths = (scriptsDir: string): string[] => BUILD_SCRIPT_FILES.map(f => join(scriptsDir, f))

export const BUILD_STAMP_FILE = 'build-stamp.json'

export type BuildStamp = { inputs: string; root: string }

/** Where the stamp lives: inside dist's `.cache`, which is never copied or deployed. */
export const buildStampPath = (distDir: string): string => join(distDir, '.cache', BUILD_STAMP_FILE)

export const writeBuildStamp = (distDir: string, stamp: BuildStamp): void => {
  const path = buildStampPath(distDir)
  mkdirSync(dirname(path), { recursive: true })
  const text = JSON.stringify(stamp)
  if (existsSync(path) && readFileSync(path, 'utf8') === text) return
  writeFileSync(path, text, 'utf8')
}

export const readBuildStamp = (distDir: string): BuildStamp | null => {
  try {
    const raw = JSON.parse(readFileSync(buildStampPath(distDir), 'utf8')) as Partial<BuildStamp>
    return typeof raw.inputs === 'string' && typeof raw.root === 'string' ? { inputs: raw.inputs, root: raw.root } : null
  } catch { return null }
}

/** May a publish that skips the build sign what `dist` holds? Only when the
 *  stamp exists, was made from the sources as they are now, and names the
 *  root dist actually carries. */
export const checkBuildStamp = (
  projectRoot: string,
  distDir: string,
  distRoot: string | null,
  scriptsDir: string = join(projectRoot, 'scripts'),
): { ok: true } | { ok: false; reason: string } => {
  const stamp = readBuildStamp(distDir)
  if (!stamp) return { ok: false, reason: 'dist carries no build stamp — it was not built by this tree' }
  if (!distRoot) return { ok: false, reason: 'dist carries no package root' }
  if (stamp.root !== distRoot) return { ok: false, reason: `dist holds ${distRoot.slice(0, 12)} but the last build made ${stamp.root.slice(0, 12)}` }
  if (stamp.inputs !== buildInputsDigest(projectRoot, buildScriptPaths(scriptsDir))) {
    return { ok: false, reason: 'the sources have changed since dist was built' }
  }
  return { ok: true }
}
