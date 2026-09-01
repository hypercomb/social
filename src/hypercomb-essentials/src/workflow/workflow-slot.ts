// workflow/workflow-slot.ts
//
// `workflow` layer slot — what makes a cell a WORKFLOW, and (once named) a
// SKILL the hive can run and a peer can adopt.
//
// ── What is in the record, and what deliberately is not ───────────────
//
// The record is tiny on purpose:
//
//     { v: 1, name: 'onboard a peer', description?, at }
//
// It does NOT hold the steps. The steps are the cell's CHILD TILES, in the
// order the layer already keeps them. A step list here would be a second
// copy of that order, and a second copy is a thing to drift: drag a tile,
// undo a delete, adopt a peer's branch, and the two disagree. One truth —
// the tiles — and the slot only says "this cell is a workflow, and this is
// what it's called".
//
// It also does NOT hold run state. Which step is running, what a step
// returned, whether the last run failed — participant-local and transient,
// same rule as viewport and clipboard. A workflow's signature must be the
// same on your hive and mine, or adoption compares two things that were
// never the same. The RESULT of a run is a different matter: that is a
// `workflow:run` decoration, minted deliberately (workflow-runner.drone).
//
// ── Why a slot and not a pool ─────────────────────────────────────────
//
// Same answer as snapshots: undo ⇒ layer + lineage bag. A workflow must be
// undoable, must travel on adoption, and must sit inside the merkle so its
// signature covers its steps. That is a slot. (Snapshots-slot has the long
// form of this argument.)
//
// ── Read / write ──────────────────────────────────────────────────────
//
// READ:  `layer.workflow` — a flat sig array; the newest entry is current.
// WRITE: `setWorkflow()` below, or the generic bridge op
//        `{ op: 'bag-set', segments, slot: 'workflow', cells: [recordSig] }`.
//
// ── Registration ──────────────────────────────────────────────────────
//
// PASSIVE (`triggers: []`) — committed through `LayerCommitter.update`, so
// no trigger event drives it. Registering declares the slot so the
// preloader warms it and history diff sees it as first-class.

import type { LayerSlotRegistry } from '../history/layer-slot-registry.js'
import type { PlacementLayer } from '../history/layer-placement.js'

/** Slot name on the layer JSON. */
export const WORKFLOW_SLOT = 'workflow'

const SIG = /^[0-9a-f]{64}$/

/** The workflow record resource. */
export interface WorkflowRecord {
  readonly v: 1
  /** What the participant calls it. This is the SKILL name once published —
   *  `/skill <name>` resolves against it. Not an identity: the cell's own
   *  name is the address (project_tile_rename_is_title_decoration). */
  readonly name: string
  /** One line on what it does. Shown in the palette and the skill list. */
  readonly description?: string
  /** When the record was written (ms). */
  readonly at: number
  /** The record's own signature — filled in by the reader, never stored. */
  readonly sig?: string
}

type StoreLike = {
  putResource(blob: Blob): Promise<string>
  getResource(signature: string): Promise<Blob | null>
}

type HistoryLike = {
  sign(lineage: { explorerSegments: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<PlacementLayer | null>
}

const store = (): StoreLike | undefined =>
  window.ioc.get<StoreLike>('@hypercomb.social/Store')

const history = (): HistoryLike | undefined =>
  window.ioc.get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')

/**
 * The cell's current workflow record, or null when the cell is not a
 * workflow. Unreadable or malformed → null rather than a throw: a broken
 * record must not make the designer unusable on the tile it is standing on.
 */
export async function readWorkflow(
  segments: readonly string[],
): Promise<WorkflowRecord | null> {
  const h = history()
  const s = store()
  if (!h?.sign || !h.currentLayerAt || !s?.getResource) return null

  const locationSig = await h.sign({ explorerSegments: () => [...segments] })
  const layer = await h.currentLayerAt(locationSig)
  const slot = (layer as Record<string, unknown> | null)?.[WORKFLOW_SLOT]
  const sigs = Array.isArray(slot)
    ? slot.map(x => String(x).toLowerCase()).filter(x => SIG.test(x))
    : []
  if (!sigs.length) return null

  // Newest entry wins.
  for (let i = sigs.length - 1; i >= 0; i--) {
    try {
      const blob = await s.getResource(sigs[i])
      if (!blob) continue
      const parsed = JSON.parse(await blob.text()) as Partial<WorkflowRecord>
      if (typeof parsed?.name !== 'string') continue
      return {
        v: 1,
        name: parsed.name,
        description: typeof parsed.description === 'string' ? parsed.description : undefined,
        at: typeof parsed.at === 'number' ? parsed.at : 0,
        sig: sigs[i],
      }
    } catch { /* skip unreadable member */ }
  }
  return null
}

/**
 * Declare a cell a workflow (or rename one). Mints the record resource and
 * sets the slot to hold exactly it — `update` leaves every other slot on the
 * cell alone, so this never touches the cell's children, notes, or keywords.
 *
 * Returns the record signature.
 */
export async function setWorkflow(opts: {
  segments: readonly string[]
  name: string
  description?: string
  at: number
}): Promise<string> {
  const s = store()
  const h = history()
  if (!s?.putResource) throw new Error('[workflow-slot] Store not available')
  if (!opts.segments.length) throw new Error('[workflow-slot] the hive root cannot be a workflow')

  const record: WorkflowRecord = {
    v: 1,
    name: opts.name.trim(),
    ...(opts.description?.trim() ? { description: opts.description.trim() } : {}),
    at: opts.at,
  }
  const sig = await s.putResource(
    new Blob([JSON.stringify(record)], { type: 'application/json' }),
  )

  const committer = window.ioc.get<{
    update?: (segments: readonly string[], layer: object) => Promise<string>
  }>('@diamondcoreprocessor.com/LayerCommitter')
  if (!committer?.update) throw new Error('[workflow-slot] LayerCommitter.update not available')

  const segments = [...opts.segments]
  const locationSig = await h?.sign({ explorerSegments: () => segments })
  const layer = locationSig ? await h?.currentLayerAt(locationSig) : null
  const cellName = layer?.name ?? segments[segments.length - 1] ?? ''

  await committer.update(segments, { name: cellName, [WORKFLOW_SLOT]: [sig] })
  return sig
}

// ── skills: a named workflow ──────────────────────────────────────────
//
// A SKILL is a workflow with a name the hive can reach. There is already a
// primitive for "a name that resolves to a lineage path, and that other
// slash commands autocomplete against" — NameRegistry, the thing `/hive`
// writes. So naming a workflow writes BOTH: the record (so the cell says
// what it is called, and that name travels on adoption) and the registry
// entry (so `/workflow run <name>` finds it from anywhere).
//
// No skill registry, no skill store, no skill format. A skill is a subtree
// of tiles with a name, which is the whole point.

type NameRegistryLike = {
  ensureLoaded?(): Promise<void>
  setLineage?(name: string, path: readonly string[]): Promise<void>
  remove?(name: string): Promise<boolean>
  names?: readonly string[]
  all?: Record<string, { target?: { kind?: string; path?: readonly string[] } }>
}

const nameRegistry = (): NameRegistryLike | undefined =>
  window.ioc.get<NameRegistryLike>('@hypercomb.social/NameRegistry')

/**
 * Name a workflow — the "save as skill" gesture. Writes the record and the
 * reachable name together, so the two can never disagree about what this
 * workflow is called.
 */
export async function nameWorkflow(opts: {
  segments: readonly string[]
  name: string
  description?: string
  at: number
}): Promise<string> {
  const sig = await setWorkflow(opts)
  const registry = nameRegistry()
  if (registry?.setLineage) {
    await registry.setLineage(opts.name.trim(), [...opts.segments])
  }
  return sig
}

/** Every named workflow the hive can reach, newest name order-independent.
 *  Reads only the NAMED entries — bounded by how many names exist, never a
 *  hive walk. A name whose cell is not (or is no longer) a workflow is
 *  skipped rather than reported, because a stale label is not a skill. */
export async function listWorkflows(): Promise<
  Array<{ name: string; segments: readonly string[]; record: WorkflowRecord }>
> {
  const registry = nameRegistry()
  if (!registry) return []
  await registry.ensureLoaded?.()
  const all = registry.all ?? {}

  const out: Array<{ name: string; segments: readonly string[]; record: WorkflowRecord }> = []
  for (const [name, entry] of Object.entries(all)) {
    if (entry?.target?.kind !== 'lineage') continue
    const segments = [...(entry.target.path ?? [])]
    if (!segments.length) continue
    const record = await readWorkflow(segments)
    if (!record) continue
    out.push({ name, segments, record })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<LayerSlotRegistry>(
  '@diamondcoreprocessor.com/LayerSlotRegistry',
  (slotRegistry) => {
    slotRegistry.register({
      slot: WORKFLOW_SLOT,
      triggers: [],
    })
  },
)
