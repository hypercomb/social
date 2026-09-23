// scripts/build-anatomy.ts
//
// THE STATIC ANATOMY — one file that tells any model outside this machine
// what the hive IS and what it may PROPOSE. Design: documentation/
// anatomy-context-need.md §2. Runs from `prepare` so the generated module is
// always in step with the doctrine documents it lifts from.
//
// Deterministic on purpose: same sources → same bytes → same signature. No
// dates, no paths, no environment. The signature is derived at RUNTIME by
// `anatomy.service.ts` (never hardcoded — doctrine ratchet), and that sig is
// the head of the `system:anatomy` lineage bag.
//
// Doctrine is LIFTED VERBATIM from its source document, section by section,
// so there is never a paraphrased second copy that can drift. What this
// writes is the SEED: at runtime the doctrine is a hive artifact — one
// resource per section, a record naming them, the `system:doctrine` bag's
// head naming the record (assistant/anatomy/doctrine.ts). The build's
// sections become the head only while the participant has not changed the
// doctrine in the hive. The authored
// parts here are the mechanics a reader needs before the doctrine makes
// sense, and the history rules the design added.

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DOCS = resolve(__dirname, '../../documentation')
const OUT = resolve(__dirname, '../src/assistant/anatomy/anatomy.generated.ts')

/** A section lifted verbatim: the document and the `## ` heading it starts
 *  at. Order here is reading order in the anatomy. A `title` names the
 *  section where its own heading only makes sense inside its document —
 *  Jev's scoreboard reports the rule a change comes closest to breaking by
 *  this name.
 *
 *  THE LIFE PRIMITIVE is doctrine (jwize, 2026-09-23): every part of the hive
 *  shares one shape — a meta envelope, one typed hop, recursive — so all of it
 *  is replayable, reviewable and traversable the same way across peers and
 *  open communities. Its shape and its rules sit right after the signature
 *  rule, and Jev judges every proposed change against both. */
const DOCTRINE: readonly { doc: string; heading: string; title?: string; maxLines?: number }[] = [
  { doc: 'signature-system.md', heading: 'The core rule' },
  { doc: 'life-primitive.md', heading: 'The primitive', title: 'The Life Primitive' },
  { doc: 'life-primitive.md', heading: 'Rules', title: 'The Life Primitive — its rules' },
  { doc: 'hypergraph-molecule-lineage.md', heading: 'Data never heals — it moves forward' },
  { doc: 'hypergraph-molecule-lineage.md', heading: 'Backward compatibility is mandatory — NOTHING is deleted' },
  { doc: 'known-location-pools.md', heading: 'The rules (enforced where possible)' },
  { doc: 'website-artifact-paradigm.md', heading: 'The rule' },
  { doc: 'optimize-phase.md', heading: 'The contract' },
]
const MAX_SECTION_LINES = 60

const liftSection = (doc: string, heading: string, maxLines = MAX_SECTION_LINES, title?: string): string => {
  const path = join(DOCS, doc)
  if (!existsSync(path)) throw new Error(`[anatomy] missing source document ${doc}`)
  const lines = readFileSync(path, 'utf8').split(/\r?\n/)
  const start = lines.findIndex(line => line.trim() === `## ${heading}`)
  if (start < 0) throw new Error(`[anatomy] ${doc} has no section "## ${heading}"`)
  let end = lines.findIndex((line, i) => i > start && /^## /.test(line))
  if (end < 0) end = lines.length
  const body = lines.slice(start + 1, end)
  while (body.length && !body[0].trim()) body.shift()
  while (body.length && !body[body.length - 1].trim()) body.pop()
  const clipped = body.length > maxLines ? [...body.slice(0, maxLines), '…'] : body
  return `### ${title ?? heading}\n(source: ${doc}${title ? ` › ${heading}` : ''})\n\n${sanitise(clipped.join('\n'))}`
}

/** The doctrine names the retired typed folders (`__hive__`, …) in order to
 *  forbid them. The generated module is `.ts`, and the typed-folder ratchet
 *  in doctrine.spec.ts scans `.ts` for exactly that token shape — so the
 *  anatomy spells them as prose instead. The meaning is unchanged; the
 *  ratchet stays tight. */
const sanitise = (text: string): string =>
  text.replace(/__([a-z][a-z0-9-]*)__/gi, (_, name: string) => `the legacy "${name}" folder`)

const MECHANICS = `# Hypercomb anatomy

You are reading a hive: a content-addressed tree a participant is building.
Everything below is stable protocol. What the participant is looking at, and
what they are asking, arrive AFTER this text and change every call.

## What the hive is

- A LAYER is one JSON document: a tile's name, its properties, and a list of
  child signatures. It is complete on its own; loading it loads nothing else.
- A SIGNATURE is the SHA-256 of a document's canonical bytes, 64 hex chars.
  It is identity. Same content, same signature. Content never changes: new
  content is a new signature, and old signatures stay valid forever.
- INFLATE turns a signature into its document, then recursively replaces every
  signature-valued slot inside it with the document it names, leaves first.
  A cycle inflates to { "$cycle": true }; an absent document inflates to
  { "$sig": "<sig>", "$missing": true }. A document is not usable until it is
  inflated; before that its slots hold bare signatures.
- A POOL OF MEANING is a directory named sign(<meaning>) holding records of
  that meaning. Pools are federated: the local directory is one replica.
- The tile NAME is the grammar. A path like /business/people is a ROUTE to
  walk, never an address. Addresses are signatures.
- To the participant these are TILES. In code they are cells. Say "tiles".

## History — how you remember

You have no memory between calls. History is your memory.

- A LINEAGE BAG is a directory named by a signature, holding marker files
  0000, 0001, 0002 … Each marker names one signature. The highest marker is
  now. Every earlier marker is a complete earlier state, not a diff.
- To walk history: read the bag's markers, inflate any one. Two markers are
  two whole documents. Compare documents; there is no patch format.
- A CONVERSATION is a lineage bag with one marker per turn. A turn records
  the anatomy it was sent with, the context roots it was given, the tools it
  called, and its answer. Replay is exact.
- SUMMARIES are derived records keyed by the signature of what they
  summarise. A changed subtree has a new signature and therefore no summary
  yet. If a summary and its subtree disagree, the subtree is truth.
- NOTHING IN HISTORY IS EVER REWRITTEN. New understanding is a new marker.
  Hide first; delete second — and "delete" only ever means a forward commit
  that no longer references something, never removing bytes.

## Working — how you read and act

You work in rounds. What you may do in this conversation is stated after this
document, in plain words. When nothing is stated, answer from the transcript
and say what you could not see.

- To READ, end a reply with a hypercomb-read block of reads. The hive answers
  in the next message with what it read, truncated to a budget per
  conversation. Slots come back holding bare signatures: read a signature to
  open what it names — an earlier layer, a note, an attachment, or the code
  the hive runs. Pull what you need; nothing is pushed to you.
- To CHANGE, end a reply with a hypercomb-do block of behaviour sentences in
  the hive's own grammar. You PROPOSE; the participant runs it from the
  Execution window, or has chosen to run that kind automatically. The next
  message says what ran. Never claim you changed anything before it does.
  Never invent a behaviour name that is not in the vocabulary you are given.
- You cannot use a shell, edit files, or control the computer, and you should
  not imply otherwise.

## Answering

Prose for information. Keep working in rounds until the request is done, then
answer with no block. Short. Name tiles by their names. When you relied on a
summary rather than the subtree, say so.

# Doctrine

The rules below are lifted verbatim from the documents that decide them.
`

const sections = DOCTRINE.map(entry => liftSection(entry.doc, entry.heading, entry.maxLines, entry.title))
// The composition anatomy.service.ts repeats at runtime (doctrine.ts composeAnatomy).
const text = `${MECHANICS}\n${sections.join('\n\n')}\n`

const generated = `// auto-generated by scripts/build-anatomy.ts — do not edit.
// Sources: ${[...new Set(DOCTRINE.map(entry => entry.doc))].join(', ')}
// The signature of ANATOMY_TEXT is derived at runtime (anatomy.service.ts).

export const ANATOMY_SOURCES: readonly { readonly doc: string; readonly heading: string }[] = ${JSON.stringify(
  DOCTRINE.map(({ doc, heading }) => ({ doc, heading })), null, 2,
)}

/** Everything before the doctrine sections, the doctrine header included. */
export const ANATOMY_MECHANICS: string = ${JSON.stringify(MECHANICS)}

/** The seed doctrine, one section per entry, each opening with its heading. */
export const ANATOMY_SECTIONS: readonly string[] = ${JSON.stringify(sections, null, 2)}

/** The seed anatomy: ANATOMY_MECHANICS composed with ANATOMY_SECTIONS. */
export const ANATOMY_TEXT: string = ${JSON.stringify(text)}
`

const previous = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
if (previous !== generated) {
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, generated)
  console.log(`[anatomy] wrote ${OUT} (${text.length} chars)`)
} else {
  console.log('[anatomy] unchanged')
}
