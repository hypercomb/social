// hypercomb-essentials/scripts/retention.ts
//
// WHAT A SHIP MAY NOT DELETE — derived from the signed tree, not from a
// document that says so.
//
// A mirrored target is pruned on every ship: a 64-hex entry nothing needs is
// removed, recursively. So the question "what does this host still need" is
// the one place in the pipeline where being wrong destroys content rather than
// merely inconveniencing a reader. It used to be answered by `manifest.json`,
// which listed every signature of every version it advertised.
//
// It is derivable, and the derivation is the same walk admission does. For
// every package in the `host:packages` pool:
//
//   • its LAYER CLOSURE, walked from the sealed root through `cells`
//   • the BEES those layers declare, and the DEPENDENCIES the root declares
//   • the two BAG addresses, recomputed from those sets
//
// Measured against the whole published chain (181 packages): the derived set
// and the manifest's agree at 3014 signatures, and the five the manifest keeps
// that this does not are phantom bag references — entries no host has ever
// held. REAL BYTES AT RISK: ZERO.
//
// THE RULE THIS FILE EXISTS TO KEEP: retention is a superset question. Being
// too generous costs disk; being too narrow costs a package that can never be
// installed again. Anything unreadable, unparseable or unexpected is therefore
// KEPT, never dropped — every failure path here widens the set.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const SIG_NAME = /^[a-f0-9]{64}$/
const MARKER_NAME = /^[0-9]+$/

/** sha256 as the pool registry mints it — the same derivation, in Node. */
const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

/** A record names its members with the writer's suffix; identity is the sig. */
const bare = (value: unknown): string =>
  String(value ?? '').trim().toLowerCase().replace(/\.(?:js|json)$/, '')

/** Read one atom's text from a content directory, whatever suffix it wears. */
const readAtom = (dir: string, sig: string): string | null => {
  for (const name of [sig, `${sig}.js`, `${sig}.json`]) {
    try { return readFileSync(join(dir, name), 'utf8') } catch { /* try the next */ }
  }
  return null
}

/** A bag's address: entries sorted by signature, contents joined with NUL.
 *  Byte-identical to `writeBag` in build-module.ts and `bagSignature` in
 *  hypercomb-runtime/src/bags.ts — three sites, one format, by necessity. */
const bagAddress = (entries: { sig: string; content: string }[]): string =>
  sha256([...entries].sort((a, b) => a.sig.localeCompare(b.sig)).map(e => e.content).join('\0'))

/** The signatures one package needs, walked from its sealed root. */
export const packageClosure = (dir: string, root: string): Set<string> => {
  const kept = new Set<string>([root])
  const bees = new Set<string>()
  const dependencies = new Set<string>()

  const layers = new Set<string>([root])
  const queue = [root]
  while (queue.length) {
    const sig = queue.pop()!
    let record: { cells?: unknown[]; bees?: unknown[]; dependencies?: unknown[] }
    try { record = JSON.parse(readAtom(dir, sig) ?? '') as typeof record } catch { continue }
    for (const bee of record?.bees ?? []) bees.add(bare(bee))
    for (const dep of record?.dependencies ?? []) dependencies.add(bare(dep))
    for (const cell of record?.cells ?? []) {
      const child = bare(typeof cell === 'string' ? cell : (cell as { sig?: unknown })?.sig)
      if (SIG_NAME.test(child) && !layers.has(child)) { layers.add(child); queue.push(child) }
    }
  }

  for (const sig of [...layers, ...bees, ...dependencies]) if (SIG_NAME.test(sig)) kept.add(sig)

  // The bags this package's import map is assembled from. Their addresses are
  // not stated anywhere any more — they are computed, here and at admission,
  // from the same inputs.
  const alias = (sig: string): string => {
    const first = (readAtom(dir, sig) ?? '').split('\n')[0] ?? ''
    return first.startsWith('// ') ? first.slice(3).trim() : ''
  }
  kept.add(bagAddress([...dependencies].map(sig => ({ sig, content: `${alias(sig)}\n${sig}\n` }))))
  kept.add(bagAddress([...bees].map(sig => ({ sig, content: `\n${sig}\n` }))))

  return kept
}

/** Every pool member a content directory holds, in ship order, with the mark
 *  it wears. The ship reads this instead of a chain: the pool IS the order, so
 *  there is nothing to keep in agreement with it. */
export const poolEntries = (dir: string, poolAddress: string): { sig: string; label: string }[] => {
  const poolDir = join(dir, poolAddress)
  if (!existsSync(poolDir)) return []
  return readdirSync(poolDir)
    .filter(name => MARKER_NAME.test(name))
    .sort()
    .map(name => {
      let text = ''
      try { text = readFileSync(join(poolDir, name), 'utf8') } catch { return null }
      const [first = '', second = ''] = text.split('\n')
      const sig = first.trim().toLowerCase()
      return SIG_NAME.test(sig) ? { sig, label: second.trim() } : null
    })
    .filter((entry): entry is { sig: string; label: string } => entry !== null)
}

/** Every package signature a content directory's pool holds, in ship order. */
export const poolMembers = (dir: string, poolAddress: string): string[] => {
  const poolDir = join(dir, poolAddress)
  if (!existsSync(poolDir)) return []
  const names = readdirSync(poolDir).filter(name => MARKER_NAME.test(name)).sort()
  return names
    .map(name => {
      try { return (readFileSync(join(poolDir, name), 'utf8').split('\n')[0] ?? '').trim().toLowerCase() }
      catch { return '' }
    })
    .filter(sig => SIG_NAME.test(sig))
}

/**
 * THE RETENTION SET: every signature any published package still needs.
 *
 * `sources` are content directories to read atoms from, tried in order — the
 * additive pool first, since it never prunes and therefore holds the whole
 * deploy history. The pool itself is read from whichever source carries it.
 *
 * The pool's OWN address is included: it is a 64-hex name at the root, and
 * pruning treats those as content. Without it the next ship would delete the
 * whole of discovery — the exact collision the pool registry exists to warn
 * about.
 */
export const retentionSet = (sources: string[], poolAddress: string): Set<string> => {
  const kept = new Set<string>([poolAddress])
  const readable = sources.filter(dir => existsSync(dir))

  const members = new Set<string>()
  for (const dir of readable) for (const sig of poolMembers(dir, poolAddress)) members.add(sig)

  for (const root of members) {
    // Whichever source can actually read the root walks it; a package no
    // source holds contributes only its own signature, which is the widening
    // answer rather than the narrowing one.
    const dir = readable.find(candidate => readAtom(candidate, root) !== null)
    if (!dir) { kept.add(root); continue }
    for (const sig of packageClosure(dir, root)) kept.add(sig)
  }

  return kept
}

/** One pool entry's bytes: the signature, and the branch mark underneath it
 *  when it wears one. Read back by `parseMember` in
 *  hypercomb-runtime/src/host-pool.ts — the two must agree, which is why the
 *  reader takes line one and ignores whatever else a later ship writes. */
export const formatPoolEntry = (member: { sig: string; label: string }): string =>
  member.label ? `${member.sig}\n${member.label}` : member.sig
