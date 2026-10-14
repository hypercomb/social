// history/saved-roots.ts
//
// SAVE AS / USE — the names your roots are filed under.
//
// jwize, 2026-10-10: "no new hive functionality just save as then you are on
// an empty slate". 2026-10-13: "your home page is your root. Saving as lets
// you create a new entrance, save it, and turn it on as your current root at
// any time" — `use <name>`, and the root you leave goes back under its name.
//
// THE MODEL. The root is one place ('/', the home molecule's bag). A saved
// root is a WORD whose molecule bag, sign(<word>), holds a root layer as its
// head — the same atom, by signature, that the root held when it was filed.
// Nothing is copied and nothing is deleted: every step is a forward commit.
//
//   save as <word>   sign(<word>) ← the root's head; the root ← an empty
//                    layer that carries only the restore-point index. If the
//                    root came from a name, that name takes the head first.
//   use <word>       the name the root came from takes its head; the root ←
//                    <word>'s head (the live restore-point index carried, as
//                    /restore carries it). An unnamed root with tiles on it is
//                    refused — "save as <name> first" — so nothing is lost.
//
// PAGES ARE SHARED BY NAME. A root layer lists its children by signature, but
// under per-page history those are hints: each page's truth is its own bag,
// named by the tile. So switching roots moves the ROOT PAGE only — never the
// pages beneath it, which keep their latest state whichever root lists them.
// A tile made on one root with the same name as a tile of another IS that tile.
//
// THE RECORD is one participant DOCUMENT (pool `roots:saved`, never
// replicated): `{ saved: [word…], active: word | null }`. Every write keeps a
// version, so the document's own history is the log of every save and switch.
//
// GUARDS THAT LIVE ELSEWHERE: a saved word can never become a tile's name (the
// naming gestures ask `isSaved`, beside the reserved-word gate), because a tile
// called <word> would open sign(<word>) — the saved root itself; and prune
// never offers a saved root's pages for destruction (prune.service.ts).

import { get, moleculeKey } from '@hypercomb/core'
import { ParticipantDocument } from '../preferences/participant-document.js'
import { ROOT_NAME, type LayerContent } from './history.service.js'
import { SNAPSHOTS_SLOT } from './snapshots-slot.js'

export const SAVED_ROOTS_MEANING = 'roots:saved'
export const SAVED_ROOTS_KEY = '@diamondcoreprocessor.com/SavedRoots'

export type SavedRootsRecord = {
  /** Every filed word, folded (moleculeKey), in the order they were saved. */
  readonly saved: readonly string[]
  /** The word the current root came from (`use`), or null for an unnamed root. */
  readonly active: string | null
}

export const EMPTY_SAVED_ROOTS: SavedRootsRecord = { saved: [], active: null }

/** The record as stored, or null when the bytes are not one. */
export const parseSavedRoots = (raw: unknown): SavedRootsRecord | null => {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (!Array.isArray(o['saved'])) return null
  const saved = [...new Set(o['saved'].filter((w): w is string => typeof w === 'string' && !!w))]
  const active = typeof o['active'] === 'string' && saved.includes(o['active']) ? o['active'] : null
  return { saved, active }
}

/** After `save as <word>`: the word is filed, and the root is unnamed. */
export const afterSaveAs = (record: SavedRootsRecord, word: string): SavedRootsRecord => ({
  saved: record.saved.includes(word) ? record.saved : [...record.saved, word],
  active: null,
})

/** After `use <word>`: the root is that word's. */
export const afterUse = (record: SavedRootsRecord, word: string): SavedRootsRecord => ({
  saved: record.saved,
  active: word,
})

/** The word a name is filed under — folded the way a molecule folds. */
export const savedWordOf = (name: unknown): string => moleculeKey(name)

// ── the record, as a service the naming gestures can ask synchronously ──

export class SavedRoots extends EventTarget {
  readonly #doc: ParticipantDocument<SavedRootsRecord>

  /** `whenStore` is how the record reaches the Store — IoC by default; tests hand in a fake. */
  constructor(opts: { whenStore?: ConstructorParameters<typeof ParticipantDocument>[0]['whenStore'] } = {}) {
    super()
    this.#doc = new ParticipantDocument<SavedRootsRecord>({
      meaning: SAVED_ROOTS_MEANING,
      parse: parseSavedRoots,
      empty: EMPTY_SAVED_ROOTS,
      ...(opts.whenStore ? { whenStore: opts.whenStore } : {}),
    })
    this.#doc.addEventListener('change', () => this.dispatchEvent(new CustomEvent('change')))
  }

  get record(): SavedRootsRecord { return this.#doc.value }

  /** Is this name a saved root? Synchronous — the record as last read. */
  isSaved(name: unknown): boolean {
    const word = savedWordOf(name)
    return !!word && this.#doc.value.saved.includes(word)
  }

  /** Resolves once the record has been read from disk (or after `capMs`, when
   *  no store can answer — a hive with no OPFS has no saved roots). */
  ready(capMs = 3_000): Promise<void> {
    if (this.#doc.hydrated) return Promise.resolve()
    return new Promise(resolve => {
      const done = (): void => { clearTimeout(timer); this.#doc.removeEventListener('hydrated', done); resolve() }
      const timer = setTimeout(done, capMs)
      this.#doc.addEventListener('hydrated', done)
    })
  }

  write(record: SavedRootsRecord): void {
    this.#doc.write(record)
    this.dispatchEvent(new CustomEvent('change'))
  }
}

// ── moving the root ─────────────────────────────────────────────────────

/** The slice of HistoryService the switch needs. */
export type RootHistory = {
  sign(lineage: { explorerSegments: () => readonly string[] }): Promise<string>
  latestMarkerSigFor(locationSig: string, name: string): Promise<string>
  getLayerBySig(sig: string): Promise<LayerContent | null>
  commitLayer(locationSig: string, layer: LayerContent, base?: { marker?: string | null }): Promise<string>
  headMarkerOf?(locationSig: string): string | null
  listLayers?(locationSig: string): Promise<ReadonlyArray<{ layerSig: string }>>
  readonly previewActive?: boolean
}

export type RootHead = { readonly location: string; readonly sig: string; readonly layer: LayerContent; readonly marker: string | null }

const childrenOf = (layer: LayerContent | null | undefined): readonly string[] =>
  Array.isArray(layer?.children) ? layer!.children!.filter(s => typeof s === 'string' && !!s) : []

/** Does this root layer list any tile? */
export const holdsTiles = (layer: LayerContent | null | undefined): boolean => childrenOf(layer).length > 0

/** A layer that is only a name — the husk a first read of a bag can plant. */
const isHusk = (layer: LayerContent | null | undefined): boolean =>
  !!layer && Object.keys(layer).every(key => key === 'name')

/** Is <word> already a molecule of this hive — a bag holding real content
 *  (beyond a husk, and other than the root head itself, which a resumed save
 *  may have filed already), or a tile the root lists by that name? Saving
 *  under it would join the two. */
export async function wordIsTaken(history: RootHistory, word: string, rootHeadSig: string): Promise<boolean> {
  const location = await history.sign({ explorerSegments: () => [word] })
  if (!location) return true
  for (const entry of (await history.listLayers?.(location).catch(() => [])) ?? []) {
    if (entry.layerSig === rootHeadSig) continue
    if (!isHusk(await history.getLayerBySig(entry.layerSig))) return true
  }
  const root = await history.getLayerBySig(rootHeadSig)
  for (const childSig of childrenOf(root)) {
    if (savedWordOf((await history.getLayerBySig(childSig))?.name) === word) return true
  }
  return false
}

/** Is <word> a behaviour the command line runs (a queen's word or alias)?
 *  Typing it would run that instead. Asked of IoC, never a list. */
export function isBehaviourWord(word: string): boolean {
  const ioc = (globalThis as { ioc?: { list?: () => readonly string[]; get?: (key: string) => unknown } }).ioc
  for (const key of ioc?.list?.() ?? []) {
    const queen = ioc?.get?.(key) as { command?: unknown; aliases?: unknown } | undefined
    if (!queen || typeof queen.command !== 'string') continue
    if (savedWordOf(queen.command) === word) return true
    if (Array.isArray(queen.aliases) && queen.aliases.some(alias => savedWordOf(alias) === word)) return true
  }
  return false
}

/** The tile names every saved root lists — pages that are NOT deleted, only
 *  filed under another root. Prune at the root must never offer them. */
export async function savedRootTileNames(history: RootHistory, words: readonly string[]): Promise<Set<string>> {
  const names = new Set<string>()
  for (const word of words) {
    const head = await readSavedHead(history, word).catch(() => null)
    for (const childSig of childrenOf(head?.layer)) {
      const name = (await history.getLayerBySig(childSig).catch(() => null))?.name
      if (name) names.add(name)
    }
  }
  return names
}

/** The root's location and its current head. null when the root has no head. */
export async function readRootHead(history: RootHistory): Promise<RootHead | null> {
  const location = await history.sign({ explorerSegments: () => [] })
  if (!location) return null
  const sig = await history.latestMarkerSigFor(location, ROOT_NAME)
  if (!sig) return null
  const layer = await history.getLayerBySig(sig)
  if (!layer) return null
  return { location, sig, layer, marker: history.headMarkerOf?.(location) ?? null }
}

/** The head of a saved word's bag, or null when nothing is filed there. */
export async function readSavedHead(history: RootHistory, word: string): Promise<{ location: string; sig: string; layer: LayerContent } | null> {
  const location = await history.sign({ explorerSegments: () => [word] })
  if (!location) return null
  const sig = await history.latestMarkerSigFor(location, ROOT_NAME)
  if (!sig) return null
  const layer = await history.getLayerBySig(sig)
  return layer ? { location, sig, layer } : null
}

/** File the root's head under <word>: one forward commit of the same layer
 *  (byte-identical, so the same signature) — nothing when it is there already. */
export async function fileUnder(history: RootHistory, word: string, head: RootHead): Promise<void> {
  const location = await history.sign({ explorerSegments: () => [word] })
  if (!location) throw new Error(`no address for "${word}"`)
  const filed = await history.commitLayer(location, head.layer)
  if (filed !== head.sig) throw new Error(`filing "${word}" wrote ${filed.slice(0, 8)}, not the root's ${head.sig.slice(0, 8)}`)
}

/** The root's next layer: `next` with the live restore-point index carried
 *  forward, so a switch never eats the map of restore points (snapshots-slot.ts). */
export const withLiveSnapshots = (next: LayerContent, live: LayerContent): LayerContent => {
  const carried = live[SNAPSHOTS_SLOT]
  const out: LayerContent = { ...next, name: ROOT_NAME }
  if (Array.isArray(carried) && carried.length > 0) out[SNAPSHOTS_SLOT] = carried
  else delete out[SNAPSHOTS_SLOT]
  return out
}

/** The empty root a save leaves: no tiles, the restore-point index kept. */
export const slateFrom = (live: LayerContent): LayerContent => withLiveSnapshots({ name: ROOT_NAME }, live)

/** Commit `layer` as the root, on top of the head it was built from. */
export async function setRoot(history: RootHistory, head: RootHead, layer: LayerContent): Promise<string> {
  return history.commitLayer(head.location, layer, { marker: head.marker })
}

/** The one record this page keeps. Registered by saved-roots.drone.ts — a
 *  dependency never registers itself. */
export const sharedSavedRoots = new SavedRoots()

/** The registered record (queens and gates reach it here). */
export const savedRoots = (): SavedRoots => get<SavedRoots>(SAVED_ROOTS_KEY) ?? sharedSavedRoots
