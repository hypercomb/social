// diamondcoreprocessor.com/website/website-build.drone.ts
//
// Listens for `website:build` events emitted by /website upgrade | new |
// build, assembles the codegen context envelope by walking the relevant
// branches of the merkle tree, and emits `website:build:envelope` once
// the envelope is ready for downstream consumption (bridge → Claude).
//
// This drone owns the READ side of the upgrade pipeline — collecting
// what Claude needs to see. The WRITE side (applying returned ops) is
// the existing committer / cell:added paths, no new mechanism needed.
//
// Envelope shape (kept generic — every node is a layer at a sig):
//
//   {
//     mode: 'new' | 'upgrade',
//     scope: 'root' | 'subtree' | 'named',
//     scopeSegments: string[],
//     branch:        BranchNode,    // recursive: { name, children, notes }
//     instructions:  BranchNode,    // walked from ['instructions']
//     priorRootSig:  string | null, // last successful build's root sig
//     priorBranchSig: string | null,// for diff math
//   }
//
// BranchNode is the recursive walk output — name + children[] + notes[].
// No new schema invented; sigs walked through the standard primitives.

import { EffectBus } from '@hypercomb/core'

type Note = {
  id: string
  text: string
  createdAt: number
  updatedAt?: number
  tags?: string[]
}

type LayerLike = {
  name?: string
  children?: readonly string[]
  [k: string]: unknown
}

type HistoryServiceLike = {
  currentLayerAt(locationSig: string): Promise<LayerLike | null>
  getLayerBySig(sig: string): Promise<LayerLike | null>
  sign(lineage: { explorerSegments?: () => readonly string[] }): Promise<string>
}

type NotesServiceLike = {
  getNotesAtSegments(segments: readonly string[]): Promise<readonly Note[]>
}

const SIG_REGEX = /^[a-f0-9]{64}$/

type BranchNode = {
  segments: readonly string[]
  name: string
  notes: readonly Note[]
  children: readonly BranchNode[]
}

type BuildEvent = {
  mode: 'new' | 'upgrade'
  scope: 'root' | 'subtree' | 'named'
  scopeName?: string | null
  scopeSegments?: readonly string[]
  priorRootMarker?: string | null
}

type BuildEnvelope = {
  mode: 'new' | 'upgrade'
  scope: 'root' | 'subtree' | 'named'
  scopeSegments: readonly string[]
  branch: BranchNode | null
  instructions: BranchNode | null
  branchSig: string | null
  instructionsSig: string | null
  priorRootSig: string | null
}

const MAX_DEPTH = 24
const PRIOR_SIG_KEY = 'hc:website:last-root-sig'

export class WebsiteBuildDrone extends EventTarget {

  constructor() {
    super()

    EffectBus.on<BuildEvent>('website:build', (payload) => {
      void this.#handleBuild(payload).catch(err => {
        console.error('[website-build] envelope assembly failed', err)
        EffectBus.emit('website:build:error', { error: String(err?.message ?? err) })
      })
    })
  }

  async #handleBuild(payload: BuildEvent): Promise<void> {
    const history = get<HistoryServiceLike>('@diamondcoreprocessor.com/HistoryService')
    const notes = get<NotesServiceLike>('@diamondcoreprocessor.com/NotesService')
    if (!history || !notes) {
      console.warn('[website-build] HistoryService / NotesService not ready yet')
      return
    }

    const scopeSegments = (payload.scopeSegments ?? []).map(String)
    const mode = payload.mode ?? 'upgrade'
    const scope = payload.scope ?? 'subtree'

    // 1) Resolve the branch root + walk it recursively.
    const branchSig = await history.sign({ explorerSegments: () => scopeSegments })
    const branch = await this.#walk(history, notes, scopeSegments, MAX_DEPTH)

    // 2) Resolve instructions/ root + walk it (always at literal root).
    const instructionsSig = await history.sign({ explorerSegments: () => ['instructions'] })
    const instructions = await this.#walk(history, notes, ['instructions'], MAX_DEPTH)

    // 3) Prior root sig — last successful build, stashed in localStorage
    //    by the build:complete handler when it lands.
    const priorRootSig =
      (typeof payload.priorRootMarker === 'string' && payload.priorRootMarker.length > 0)
        ? payload.priorRootMarker
        : (typeof localStorage !== 'undefined' ? localStorage.getItem(PRIOR_SIG_KEY) : null)

    const envelope: BuildEnvelope = {
      mode,
      scope,
      scopeSegments,
      branch,
      instructions,
      branchSig,
      instructionsSig,
      priorRootSig,
    }

    // Log a compact summary; downstream consumers (bridge, future Claude
    // forwarder) read the full envelope from the emitted event.
    console.log('[website-build] envelope ready', {
      mode,
      scope,
      lineage: scopeSegments.join('/') || '(root)',
      branchSig: branchSig.slice(0, 12),
      instructionsSig: instructionsSig.slice(0, 12),
      priorRootSig: priorRootSig?.slice(0, 12) ?? null,
      branchCells: this.#countCells(branch),
      branchNotes: this.#countNotes(branch),
      instructionsCells: this.#countCells(instructions),
      instructionsNotes: this.#countNotes(instructions),
    })

    EffectBus.emit('website:build:envelope', envelope)
    EffectBus.emit('website:build:ready', {
      branchSig,
      instructionsSig,
      priorRootSig,
      mode,
      scope,
    })
  }

  /** Recursive walk: layer at segments → BranchNode with full subtree.
   *  Cycle/depth guarded. Children may be sigs (resolve to layer.name)
   *  or names (use directly). Notes hydrated via NotesService for each
   *  cell so the envelope is complete (no per-cell async fetches at
   *  the codegen step — pure-function input). */
  async #walk(
    history: HistoryServiceLike,
    notes: NotesServiceLike,
    segments: readonly string[],
    depth: number,
    visited: Set<string> = new Set(),
  ): Promise<BranchNode | null> {
    if (depth < 0) return null
    const key = segments.join('/')
    if (visited.has(key)) return null
    visited.add(key)

    const sig = await history.sign({ explorerSegments: () => segments })
    const layer = await history.currentLayerAt(sig)
    if (!layer) {
      // Branch doesn't exist yet (e.g., greenfield).
      return {
        segments: [...segments],
        name: segments[segments.length - 1] ?? '',
        notes: [],
        children: [],
      }
    }

    const childNames = await this.#resolveChildNames(history, layer)
    const cellNotes = segments.length === 0
      ? []   // root has no notes slot at this version
      : await notes.getNotesAtSegments(segments)

    const children: BranchNode[] = []
    for (const childName of childNames) {
      const child = await this.#walk(history, notes, [...segments, childName], depth - 1, visited)
      if (child) children.push(child)
    }

    return {
      segments: [...segments],
      name: typeof layer.name === 'string' && layer.name ? layer.name : (segments[segments.length - 1] ?? ''),
      notes: cellNotes,
      children,
    }
  }

  async #resolveChildNames(
    history: HistoryServiceLike,
    layer: LayerLike,
  ): Promise<string[]> {
    const children = Array.isArray(layer.children) ? layer.children.slice() : []
    const names: string[] = []
    for (const entry of children) {
      const s = String(entry ?? '').trim()
      if (!s) continue
      if (SIG_REGEX.test(s)) {
        const child = await history.getLayerBySig(s)
        const n = child?.name
        if (typeof n === 'string' && n) names.push(n)
      } else {
        names.push(s)
      }
    }
    return names
  }

  #countCells(n: BranchNode | null): number {
    if (!n) return 0
    return 1 + n.children.reduce((sum, c) => sum + this.#countCells(c), 0)
  }

  #countNotes(n: BranchNode | null): number {
    if (!n) return 0
    return n.notes.length + n.children.reduce((sum, c) => sum + this.#countNotes(c), 0)
  }
}

const _build = new WebsiteBuildDrone()
window.ioc.register('@diamondcoreprocessor.com/WebsiteBuildDrone', _build)
