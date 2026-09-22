// assistant/anatomy/doctrine.ts
//
// THE DOCTRINE IS A HIVE ARTIFACT (documentation/anatomy-context-need.md §2a;
// jwize, 2026-09-21: "create only hive artifacts that hold everything").
//
// Every model is sent the anatomy first, and Jev judges every change against
// the anatomy's doctrine one section at a time. Until now those sections were
// baked into the build. Now they are content:
//
//   a SECTION    one resource: `### <heading>`, a source line, the rule's text
//   the RECORD   one resource: { kind: 'doctrine', sections: [<sig>, …] }
//   the BAG      `sign('system:doctrine')`, 8-digit markers, each
//                { layerSig: <record sig>, at, by }; the highest is the doctrine
//                this hive runs
//
// The build's sections are the SEED. A hive that has never changed its
// doctrine follows the build: a build whose doctrine moved appends a new seed
// marker. A hive whose head the participant chose is never overwritten by a
// build; `seedPending` says the build carries doctrine the hive has not taken,
// and taking it is the participant's word (`doctrine seed`).
//
// Nothing is removed. Dropping a section, stepping back and taking the seed
// are all forward commits: a new record, a new marker, every earlier record
// still readable. Pure and store-injected, so a spec hands it a world.

export const DOCTRINE_BAG_MEANING = 'system:doctrine'
const MARKER = /^\d{8}$/
const SIG = /^[a-f0-9]{64}$/
/** A heading is one line: what follows `### `. */
export const HEADING_MAX = 80

export type DoctrineBy = 'seed' | 'hive'
export type DoctrineMarker = { readonly name: string; readonly layerSig: string; readonly at: number; readonly by: DoctrineBy }

/** Everything doctrine.ts touches. */
export type DoctrineIo = {
  put(text: string, type: string): Promise<string>
  get(sig: string): Promise<string | null>
  /** The `system:doctrine` bag, or null when no store is open. */
  bag(): Promise<DoctrineBag | null>
  now(): number
}
export type DoctrineBag = {
  names(): Promise<string[]>
  read(name: string): Promise<string | null>
  write(name: string, text: string): Promise<void>
}

export type DoctrineState = {
  /** The sections the anatomy is composed from, in order. */
  readonly sections: readonly string[]
  readonly recordSig: string
  /** The head marker's name, or '' when this is the seed in memory only. */
  readonly marker: string
  readonly by: DoctrineBy
  /** The build carries doctrine this hive has never taken. */
  readonly seedPending: boolean
}

export type DoctrineOutcome = { readonly ok: true; readonly state: DoctrineState } | { readonly ok: false; readonly error: string }

// ── sections ────────────────────────────────────────────────────────────────

/** The heading a section opens with (`### <heading>`), or '' when it opens with none. */
export const headingOf = (section: string): string => {
  const first = section.split('\n', 1)[0] ?? ''
  return first.startsWith('### ') ? first.slice(4).trim() : ''
}

/** Where a section came from: the `(source: …)` line under its heading. */
export const sourceOf = (section: string): string =>
  /^\(source: ([^)]+)\)$/m.exec(section.split('\n').slice(1, 3).join('\n'))?.[1] ?? ''

export const isHeading = (value: string): boolean =>
  !!value.trim() && value.length <= HEADING_MAX && !/[\r\n`]/.test(value) && !value.trim().startsWith('#')

/** A section written in the hive: its heading, its provenance, its text. */
export const hiveSection = (heading: string, body: string): string =>
  `### ${heading.trim()}\n(source: hive)\n\n${body.replace(/^\s*\n/, '').replace(/\s+$/, '')}`

/** Replace the section with this heading, or add it at the end. */
export const writeSection = (sections: readonly string[], heading: string, body: string): string[] => {
  const next = hiveSection(heading, body)
  const at = sections.findIndex(section => headingOf(section) === heading.trim())
  return at < 0 ? [...sections, next] : sections.map((section, i) => i === at ? next : section)
}

/** The anatomy as a model reads it: the mechanics (doctrine header included),
 *  then the sections. The same composition build-anatomy.ts writes, so the
 *  seed composes to the build's own bytes. */
export const composeAnatomy = (mechanics: string, sections: readonly string[]): string =>
  `${mechanics}\n${sections.join('\n\n')}\n`

// ── the bag ─────────────────────────────────────────────────────────────────

const markerName = (index: number): string => String(index).padStart(8, '0')

export const readMarkers = async (bag: DoctrineBag): Promise<DoctrineMarker[]> => {
  const out: DoctrineMarker[] = []
  for (const name of (await bag.names()).filter(name => MARKER.test(name)).sort()) {
    try {
      const record = JSON.parse((await bag.read(name)) ?? '') as { layerSig?: unknown; at?: unknown; by?: unknown }
      if (typeof record.layerSig !== 'string' || !SIG.test(record.layerSig)) continue
      out.push({ name, layerSig: record.layerSig, at: Number(record.at) || 0, by: record.by === 'hive' ? 'hive' : 'seed' })
    } catch { /* an unreadable marker names nothing */ }
  }
  return out
}

/** The record for these sections — every section and the record written. */
const putRecord = async (io: DoctrineIo, sections: readonly string[]): Promise<string> => {
  const sigs: string[] = []
  for (const section of sections) sigs.push(await io.put(section, 'text/markdown'))
  return io.put(JSON.stringify({ kind: 'doctrine', sections: sigs }), 'application/json')
}

/** The sections a record names, or null when any is not held (complete-or-absent). */
export const readRecord = async (io: DoctrineIo, recordSig: string): Promise<string[] | null> => {
  const text = await io.get(recordSig)
  if (!text) return null
  let record: { kind?: unknown; sections?: unknown }
  try { record = JSON.parse(text) as typeof record } catch { return null }
  if (record.kind !== 'doctrine' || !Array.isArray(record.sections)) return null
  const sections: string[] = []
  for (const sig of record.sections) {
    const section = typeof sig === 'string' && SIG.test(sig) ? await io.get(sig) : null
    if (section === null) return null
    sections.push(section)
  }
  return sections
}

const append = async (bag: DoctrineBag, markers: readonly DoctrineMarker[], layerSig: string, by: DoctrineBy, at: number): Promise<string> => {
  const last = markers[markers.length - 1]
  const name = markerName(last ? Number(last.name) + 1 : 0)
  await bag.write(name, JSON.stringify({ layerSig, at, by }))
  return name
}

// ── the acts ────────────────────────────────────────────────────────────────

/** THE DOCTRINE THIS HIVE RUNS. An empty bag takes the seed as marker zero; a
 *  head the seed wrote follows a build whose doctrine moved; a head the
 *  participant chose stands, with `seedPending` when the build moved. A head
 *  that cannot be read runs the seed for now and writes nothing. */
export const loadDoctrine = async (io: DoctrineIo, seed: readonly string[]): Promise<DoctrineState> => {
  const seedSig = await putRecord(io, seed)
  const bag = await io.bag()
  const inMemory: DoctrineState = { sections: seed, recordSig: seedSig, marker: '', by: 'seed', seedPending: false }
  if (!bag) return inMemory
  const markers = await readMarkers(bag)
  const head = markers[markers.length - 1]
  if (!head || (head.by === 'seed' && head.layerSig !== seedSig)) {
    const marker = await append(bag, markers, seedSig, 'seed', io.now())
    return { ...inMemory, marker }
  }
  const seedPending = !markers.some(marker => marker.layerSig === seedSig)
  if (head.layerSig === seedSig) return { ...inMemory, marker: head.name, by: head.by }
  const sections = await readRecord(io, head.layerSig)
  if (!sections) return { ...inMemory, seedPending }
  return { sections, recordSig: head.layerSig, marker: head.name, by: head.by, seedPending }
}

/** Commit these sections as the doctrine: a new record and a new marker, or
 *  nothing when they are the doctrine already. */
export const commitDoctrine = async (io: DoctrineIo, sections: readonly string[], by: DoctrineBy, seed: readonly string[]): Promise<DoctrineOutcome> => {
  if (!sections.length) return { ok: false, error: 'the doctrine would have no sections' }
  const bag = await io.bag()
  if (!bag) return { ok: false, error: 'the doctrine cannot be written here: no store is open' }
  const recordSig = await putRecord(io, sections)
  const seedSig = await putRecord(io, seed)
  const markers = await readMarkers(bag)
  const head = markers[markers.length - 1]
  const marker = head?.layerSig === recordSig ? head.name : await append(bag, markers, recordSig, by, io.now())
  const after = head?.layerSig === recordSig ? markers : await readMarkers(bag)
  return { ok: true, state: { sections, recordSig, marker, by, seedPending: !after.some(m => m.layerSig === seedSig) } }
}

/** THE STEP BACK: the doctrine the head replaced, to be committed again as a
 *  new marker — undo as a forward commit, never a rewound pointer. The
 *  participant chose it, so it is committed as theirs: a later build never
 *  moves it. */
export const previousDoctrine = async (io: DoctrineIo): Promise<{ sections: string[] } | { error: string }> => {
  const bag = await io.bag()
  if (!bag) return { error: 'no store is open' }
  const markers = await readMarkers(bag)
  const head = markers[markers.length - 1]
  if (!head) return { error: 'the doctrine has no history yet' }
  const before = [...markers].reverse().find(marker => marker.layerSig !== head.layerSig)
  if (!before) return { error: 'there is no earlier doctrine' }
  const sections = await readRecord(io, before.layerSig)
  return sections ? { sections } : { error: 'the earlier doctrine is not held here' }
}
