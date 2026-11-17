// hypercomb-essentials/scripts/typescript-atoms.ts
//
// THE PACKAGE'S OWN TYPESCRIPT, HOSTED AND NEVER INSTALLED (owner, 2026-11-16:
// "Host the package's TypeScript without installing it, fetched only when a
// file is opened"). A module ships as compiled JavaScript; the TypeScript it
// came from is about 18 MB, far too much to install for the few files a person
// ever opens. So each top-level source folder becomes ONE text atom, named by
// its signature, and the folder's own layer names it in a `typescript` slot
// (src/assistant/package-typescript.ts). A file directly in src/, and a
// file in a folder that yields no layer, is in no atom.
//
// An atom is plain text: the source files as written, each under the same
// `// src/<path>` header the compiled module carries, so the section a person
// is reading in the compiled text is the section to read here. It is NOT the
// knowledge atom's wrapper (knowledge-atoms.ts): no block comment, no `*/`
// rewrite, no `export {}`. It is never a dependency, so it need not parse.
//
// Deterministic: files in code-unit order, line endings folded, no dates, no
// machine paths. Same sources, same bytes, same signature.
//
// Pure helpers only. build-module.ts decides where the bytes land
// (dist/.typescript/, a folder no "every signature in dist" copier reads).

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { TYPESCRIPT_NAME, TYPESCRIPT_SLOT, typescriptPaths } from '../src/assistant/package-typescript.js'

/** The folder of dist the atoms are written to. Not a signature, so nothing
 *  that ships dist's signature-named entries carries it. */
export const TYPESCRIPT_STAGING = '.typescript'

export type CarriedFile = {
  /** The section it is read by: `src/<rel>`. */
  readonly path: string
  readonly abs: string
}

export type TypescriptAtom = {
  /** The top-level folder. */
  readonly key: string
  /** Line 1 without its comment marker: `@hypercomb/typescript/<folder>`. */
  readonly name: string
  readonly text: string
  readonly files: number
}

/** A section header as core's module-sections.ts reads one. */
const HEADER_RE = /^\/\/ (src\/[^\s]+)$/
const SIGNATURE_RE = /^[a-f0-9]{64}$/

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Every file under `srcRoot` the rule keeps, in code-unit path order. A path
 *  the reader's own lookup would refuse (typescriptPaths) is dropped here, so
 *  an atom never holds a section nobody can ask for. */
export const carriedFiles = (srcRoot: string, keep: (rel: string) => boolean): CarriedFile[] => {
  const found: CarriedFile[] = []
  const walk = (rel: string): void => {
    for (const name of readdirSync(rel ? join(srcRoot, rel) : srcRoot).sort(byCodeUnit)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const at = rel ? `${rel}/${name}` : name
      const abs = join(srcRoot, at)
      if (statSync(abs).isDirectory()) { walk(at); continue }
      const path = `src/${at}`
      if (keep(at) && typescriptPaths(path)) found.push({ path, abs })
    }
  }
  walk('')
  return found.sort((a, b) => byCodeUnit(a.path, b.path))
}

/** One signature for everything the atoms are made from. The build's early
 *  exit asks it, because a file of types alone is bundled by no unit and would
 *  otherwise change an atom without the build noticing. */
export const typescriptDigest = (files: readonly CarriedFile[], contentSig: (abs: string) => string): string => {
  const hash = createHash('sha256')
  for (const file of [...files].sort((a, b) => byCodeUnit(a.path, b.path))) hash.update(`${file.path}\0${contentSig(file.abs)}\n`, 'utf8')
  return hash.digest('hex')
}

/** A source file's text as it sits in an atom: line endings folded, a line
 *  that would read as a section header of its own set off by one space, and
 *  exactly one newline at the end. Nothing else is touched. */
export const foldSource = (text: string): string =>
  text.replace(/\r\n?/g, '\n').split('\n')
    .map(line => (HEADER_RE.test(line) ? ` ${line}` : line)).join('\n').replace(/\n*$/, '\n')

const atomName = (key: string): string => `${TYPESCRIPT_NAME}${key}`

/** The top-level folder a section sits in, or '' for a file directly in src/. */
const topFolder = (path: string): string => {
  const segments = path.split('/')
  return segments.length > 2 ? segments[1]! : ''
}

/** An atom's whole text: its name, the lazy marker, what it is, then every
 *  source under its header. Line 2 is the lazy marker so that a copy filed
 *  among the dependencies by mistake is still never imported at boot. */
export const typescriptAtomText = (key: string, lazyLine: string, sources: readonly { path: string; text: string }[]): string => {
  if (!key) throw new Error('[typescript] an atom is one top-level folder; a file directly in src/ has none')
  if (!lazyLine.startsWith('// lazy')) throw new Error('[typescript] line 2 must be the lazy marker, or a mis-filed atom is imported at boot')
  const seen = new Set<string>()
  const body = sources.map(source => {
    if (!typescriptPaths(source.path)) throw new Error(`[typescript] not a section path: ${source.path}`)
    if (seen.has(source.path)) throw new Error(`[typescript] two sources at one path: ${source.path}`)
    seen.add(source.path)
    return `// ${source.path}\n${foldSource(source.text)}`
  }).join('')
  const where = `hypercomb-essentials/src/${key}`
  return `// ${atomName(key)}\n${lazyLine}\n// TypeScript as written, never run: ${where}. Hosted with the package, not installed. Each file is a section; read one with its \`src/…\` path.\n${body}`
}

/** The atoms of a source tree: one per top-level folder that has a layer
 *  (`layered`). Every other file is left out: there is no layer to name an
 *  atom for it. */
export const typescriptAtoms = (
  files: readonly CarriedFile[],
  lazyLine: string,
  layered: ReadonlySet<string>,
  read: (abs: string) => string = abs => readFileSync(abs, 'utf8'),
): TypescriptAtom[] => {
  const groups = new Map<string, CarriedFile[]>()
  for (const file of files) {
    const key = topFolder(file.path)
    if (!key || !layered.has(key)) continue
    const group = groups.get(key)
    if (group) group.push(file)
    else groups.set(key, [file])
  }
  return [...groups.keys()].sort(byCodeUnit).map(key => {
    const group = [...groups.get(key)!].sort((a, b) => byCodeUnit(a.path, b.path))
    return {
      key,
      name: atomName(key),
      text: typescriptAtomText(key, lazyLine, group.map(file => ({ path: file.path, text: read(file.abs) }))),
      files: group.length,
    }
  })
}

/**
 * What is wrong with the slots a set of layers carries. `layers` maps a layer
 * signature to its JSON, `atoms` is every source atom the build wrote, and
 * `installed` is every signature a device installs (layers, bees,
 * dependencies). Empty when each atom is named by exactly one layer, each slot
 * names a written atom, and no slot points into the installed package.
 */
export const typescriptSlotErrors = (
  layers: ReadonlyMap<string, string>,
  atoms: ReadonlySet<string>,
  installed: ReadonlySet<string>,
): string[] => {
  const errors: string[] = []
  const namedBy = new Map<string, string[]>()
  for (const [sig, json] of layers) {
    let record: unknown
    try { record = JSON.parse(json) } catch { continue }
    if (!record || typeof record !== 'object' || !(TYPESCRIPT_SLOT in record)) continue
    const value = (record as Record<string, unknown>)[TYPESCRIPT_SLOT]
    const tag = `layer "${String((record as { name?: unknown }).name ?? '?')}" (${sig.slice(0, 12)})`
    if (typeof value !== 'string' || !SIGNATURE_RE.test(value)) { errors.push(`${tag} → ${TYPESCRIPT_SLOT} slot is not a bare signature`); continue }
    if (installed.has(value)) errors.push(`${tag} → ${TYPESCRIPT_SLOT} slot ${value.slice(0, 12)} names a layer, bee or dependency: a source atom is never installed`)
    else if (!atoms.has(value)) errors.push(`${tag} → ${TYPESCRIPT_SLOT} slot ${value.slice(0, 12)} names no source atom this build wrote`)
    namedBy.set(value, [...(namedBy.get(value) ?? []), tag])
  }
  for (const atom of [...atoms].sort(byCodeUnit)) {
    const tags = namedBy.get(atom) ?? []
    if (!tags.length) errors.push(`source atom ${atom.slice(0, 12)} is named by no layer`)
    else if (tags.length > 1) errors.push(`source atom ${atom.slice(0, 12)} is named by ${tags.length} layers: ${tags.join(', ')}`)
  }
  return errors
}

/**
 * Does every TypeScript section the compiled package shows have its source in
 * the atom a reader would be sent to? `compiled` is the text of every bee and
 * compiled dependency. `missing` is a carried file whose atom lacks its
 * section: a bug in the build. `outside` is a header for a file no atom
 * holds (a generated index, a keys file, a file directly in src/, a folder
 * that is no layer): the view offers nothing there.
 */
export const unresolvedSections = (
  compiled: Iterable<string>,
  atoms: readonly TypescriptAtom[],
  layered: ReadonlySet<string>,
  carried: ReadonlySet<string>,
): { missing: string[]; outside: string[] } => {
  const sections = new Map<string, Set<string>>()
  for (const atom of atoms) {
    const paths = new Set<string>()
    for (const line of atom.text.split('\n')) {
      const match = HEADER_RE.exec(line)
      if (match) paths.add(match[1]!)
    }
    sections.set(atom.key, paths)
  }
  const missing = new Set<string>()
  const outside = new Set<string>()
  for (const text of compiled) {
    for (const line of text.split('\n')) {
      const path = HEADER_RE.exec(line)?.[1]
      if (!path || !path.endsWith('.ts')) continue
      const key = topFolder(path)
      if (!carried.has(path) || !key || !layered.has(key)) { outside.add(path); continue }
      if (!sections.get(key)?.has(path)) missing.add(path)
    }
  }
  return { missing: [...missing].sort(byCodeUnit), outside: [...outside].sort(byCodeUnit) }
}
