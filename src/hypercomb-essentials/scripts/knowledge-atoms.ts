// scripts/knowledge-atoms.ts
//
// WHAT A MODEL CAN READ ABOUT THE PLATFORM ITSELF (jwize, 2026-11-13: "The ai
// needs full ability to get at all the information in the core of the
// architecture and then determine its needs and use the hive to build stuff.
// ... If it can't understand how hypercomb works ... then we are not done.").
//
// A model in the hive reads the code the hive runs by signature: `code <words>`
// lists every module and dependency the installed package names, and
// `read <signature> <src/… path>` opens one source file of one. That reached
// every package module and nothing beneath them. The core primitives are
// mapped to a path, not a signature, and the shell (store, navigation,
// install, the chat) is compiled into the host, so the ground everything
// stands on could not be opened at all; nor could the documents the doctrine
// cites, or the codex's own Build and Paint tiers.
//
// So the package carries that ground as KNOWLEDGE ATOMS: dependencies like
// any other, named by signature, each holding source files AS WRITTEN — types
// and comments included, which a bundle strips — under the same `// src/…`
// section headers a bundled module has. The reader needs nothing new: the
// atoms are in the manifest, so `code` searches them and `read` opens them.
//
// AN ATOM IS NEVER RUN. Line 2 is the lazy marker, so the dependency loader
// leaves it alone, and nothing imports its alias. Its body is one block
// comment and `export {}`: valid JavaScript whatever the source inside says,
// which the minified derivation of a package (hypercomb-runtime reminify.ts)
// reduces to nothing. Only `*/` is rewritten inside it, as `*\/`.
//
// Deterministic: files in code-unit order, line endings folded, no dates, no
// machine paths. Same sources, same bytes, same signature.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** A section header as core's module-sections.ts reads one. */
const HEADER_RE = /^\/\/ (src\/[^\s]+)$/
const SECTION_PATH_RE = /^src\/[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)*$/

export type KnowledgeSource = {
  /** The section it is read by: `src/hypercomb-core/core/ioc.ts`. */
  readonly path: string
  readonly text: string
}

export type KnowledgeAtom = {
  /** The dependency's name in the import map; nothing imports it. */
  readonly alias: string
  readonly text: string
  readonly files: number
}

/** One line a reader sees before the sources. */
const aboutLine = (about: string): string =>
  `// knowledge, never run: ${about}. Each file is a section; read one with its \`src/…\` path.`

/** A source file's text as it sits inside the block comment: line endings
 *  folded, the one sequence that would end the comment rewritten, and a line
 *  that would read as a section header of its own set off by a space. */
export const quoteSource = (text: string): string =>
  text.replace(/\r\n?/g, '\n').replace(/\*\//g, '*\\/').split('\n')
    .map(line => (HEADER_RE.test(line) ? ` ${line}` : line)).join('\n').replace(/\n*$/, '\n')

/** The atom's whole text: the alias, the lazy marker, what it is, then every
 *  source under its header inside one block comment. */
export const knowledgeAtomText = (alias: string, lazyLine: string, about: string, sources: readonly KnowledgeSource[]): string => {
  if (!lazyLine.startsWith('// lazy')) throw new Error('[knowledge] line 2 must be the lazy marker, or the atom is imported at boot')
  const seen = new Set<string>()
  const body = sources.map(source => {
    if (!SECTION_PATH_RE.test(source.path) || source.path.length > 200) throw new Error(`[knowledge] not a section path: ${source.path}`)
    if (seen.has(source.path)) throw new Error(`[knowledge] two sources at one path: ${source.path}`)
    seen.add(source.path)
    return `// ${source.path}\n${quoteSource(source.text)}`
  }).join('')
  return `// ${alias}\n${lazyLine}\n${aboutLine(about)}\n/*\n${body}*/\nexport {}\n`
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Every file under `dir` the test keeps, as paths relative to it with
 *  forward slashes, in code-unit order. */
const walk = (dir: string, keep: (name: string) => boolean, rel = ''): string[] => {
  const found: string[] = []
  for (const name of readdirSync(join(dir, rel)).sort(byCodeUnit)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
    const at = rel ? `${rel}/${name}` : name
    if (statSync(join(dir, at)).isDirectory()) found.push(...walk(dir, keep, at))
    else if (keep(name)) found.push(at)
  }
  return found
}

/** Source as written: no specs, no declarations, nothing generated. */
const isSource = (name: string): boolean =>
  name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts') && !name.endsWith('.generated.ts')

const sourcesUnder = (root: string, project: string): KnowledgeSource[] => {
  const dir = join(root, project, 'src')
  if (!existsSync(dir)) throw new Error(`[knowledge] missing ${project}/src`)
  return walk(dir, isSource)
    .filter(rel => SECTION_PATH_RE.test(`src/${project}/${rel}`))
    .map(rel => ({ path: `src/${project}/${rel}`, text: readFileSync(join(dir, rel), 'utf8') }))
}

/** The documents the doctrine names: the codex itself (every tier, the
 *  builders' ones included), each document a tier cites, and the glossary. */
const documents = (root: string): KnowledgeSource[] => {
  const dir = join(root, 'documentation')
  const codex = join(dir, 'doctrine.codex')
  if (!existsSync(codex)) throw new Error('[knowledge] missing documentation/doctrine.codex')
  const cited = new Set<string>(['glossary.md'])
  for (const line of readFileSync(codex, 'utf8').split(/\r?\n/)) {
    const tier = /^@\d+ .+? ~(.+)$/.exec(line.trimEnd())
    for (const name of (tier?.[1] ?? '').split(/[\s,]+/).filter(Boolean)) if (name.endsWith('.md')) cited.add(name)
  }
  const names = ['doctrine.codex', ...[...cited].filter(name => existsSync(join(dir, name))).sort(byCodeUnit)]
  return names.map(name => ({ path: `src/documentation/${name}`, text: readFileSync(join(dir, name), 'utf8') }))
}

/** The knowledge atoms of this checkout. `root` is the monorepo's `src/`. */
export const knowledgeAtoms = (root: string, lazyLine: string): KnowledgeAtom[] => {
  const atom = (alias: string, about: string, sources: KnowledgeSource[]): KnowledgeAtom =>
    ({ alias, text: knowledgeAtomText(alias, lazyLine, about, sources), files: sources.length })
  return [
    atom('@hypercomb/source/core', 'the source of hypercomb-core as written: IoC, EffectBus, the bee bases, signatures, layers, the machine door and the lesson a model is taught',
      sourcesUnder(root, 'hypercomb-core')),
    atom('@hypercomb/source/runtime', 'the source of the shell every host runs, as written: the store, navigation, lineage, install, module drafts and the chat window',
      sourcesUnder(root, 'hypercomb-runtime')),
    atom('@hypercomb/source/shim', 'the source of the framework-free host, as written: its boot, its front door and the managed site door',
      sourcesUnder(root, 'hypercomb-shim')),
    atom('@hypercomb/source/documentation', 'the whole doctrine codex (the Build and Paint tiers included), every document a tier cites, and the glossary',
      documents(root)),
  ]
}
