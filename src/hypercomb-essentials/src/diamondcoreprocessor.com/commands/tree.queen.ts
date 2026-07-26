// diamondcoreprocessor.com/commands/tree.queen.ts
//
// `/tree` — open the sideways tree: the current branch drawn as a mind map
// that grows like a branch. Trunk at the left, one column per ring, limbs
// tapering to a point at the tips.
//
// Syntax:
//   /tree                     — the branch under where you are standing
//   /tree <name>              — a handle registered with `/branch`
//   /tree <64-hex signature>  — root anywhere in the merkle tree
//   /tree /path/to/tile       — root at a lineage path
//   /tree stencil <name>      — re-open a named fragment (or start one)
//   /tree stencils            — list the fragments on file
//   /tree rings 8             — how many rings to walk up front (1–12)
//   /tree off                 — back to hexagons
//
// The render itself is TreeViewDrone (presentation/tiles/tree-view.drone.ts).
// This queen only resolves the target: a signature is the primitive input,
// and everything else — a path, a `/branch` handle, the current location —
// is a way of naming one.

import { QueenBee, EffectBus } from '@hypercomb/core'
import { parseTreeTarget, TREE_VIEW } from '../presentation/tiles/tree-view.drone.js'
import type { TreeRoot } from '../presentation/tiles/tree-walk.js'

const get = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

const OFF_KEYWORDS = new Set(['off', 'hex', 'hexagons', 'hexagon', 'close', 'exit'])
const ON_KEYWORDS = new Set(['on', 'open', 'go', 'view', 'here'])

type ViewModeShape = { mode: string; setMode(next: string): void }
type TreeViewShape = {
  setRoot(root: TreeRoot, rings?: number): void
  setRootToCurrent(): void
  setRings(rings: number): void
  stencils(): Promise<Record<string, { calls: readonly string[] }>>
  openStencil(name: string): Promise<boolean>
  beginStencil(name: string): Promise<boolean>
}
type NameEntry = {
  target: { kind: 'lineage'; path: readonly string[] } | { kind: 'signature'; signature: string }
}
type NameRegistryShape = {
  names: string[]
  matching(prefix: string): string[]
  get(name: string): NameEntry | undefined
  ensureLoaded(): Promise<void>
}

export class TreeQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'tree'
  override readonly aliases = ['mindmap', 'branches']
  override description =
    'Sideways tree — draw a branch as a mind map: trunk on the left, one column per ring, any signature as the root'
  override descriptionKey = 'slash.tree'
  override options = [
    '<name>', '<64-hex signature>', '/path/to/tile',
    'stencil <name>', 'stencils', 'rings <n>', 'off',
  ]
  override examples = [
    { input: '/tree', result: 'Draws the branch under the current tile' },
    { input: '/tree rings 9', result: 'Walks nine rings deep instead of six' },
    { input: '/tree docs', result: 'Roots the tree at the "docs" handle from /branch' },
    { input: '/tree stencil audit', result: 'Re-opens the named fragment "audit"' },
  ]

  override slashComplete(args: string): readonly string[] {
    const tokens = args.split(/\s+/)
    const head = (tokens[0] ?? '').toLowerCase()
    if (tokens.length > 1 && head === 'rings') {
      return ['4', '6', '8', '10', '12'].filter(n => n.startsWith(tokens[1] ?? ''))
    }
    if (tokens.length > 1 && (head === 'stencil' || head === 'fragment')) {
      return this.#stencilNames.filter(n => n.toLowerCase().startsWith((tokens[1] ?? '').toLowerCase()))
    }
    const registry = get<NameRegistryShape>('@hypercomb.social/NameRegistry')
    const names = registry?.matching?.(head) ?? []
    return [
      ...['stencil', 'stencils', 'rings', 'off'].filter(o => o.startsWith(head)),
      ...names,
    ]
  }

  /** Cached for the SYNCHRONOUS completer — refreshed whenever the view is
   *  asked for its catalog. */
  #stencilNames: string[] = []

  protected async execute(args: string): Promise<void> {
    const raw = args.trim()
    const lower = raw.toLowerCase()

    const vm = get<ViewModeShape>('@hypercomb.social/ViewMode')
    const view = get<TreeViewShape>('@diamondcoreprocessor.com/TreeViewDrone')
    if (!vm || !view) { this.#log('Tree view unavailable'); return }

    if (OFF_KEYWORDS.has(lower)) {
      vm.setMode('hexagons')
      this.#log('Tree — closed', '○')
      return
    }

    // `/tree stencils` — what fragments exist.
    if (lower === 'stencils' || lower === 'fragments') {
      const catalog = await view.stencils()
      this.#stencilNames = Object.keys(catalog).sort()
      if (this.#stencilNames.length === 0) {
        this.#log('Tree — no stencils yet; open /tree and name a view to start one', '✦')
        return
      }
      for (const name of this.#stencilNames) {
        const calls = catalog[name].calls.length
        this.#log(`Tree — stencil “${name}” · ${calls} branch${calls === 1 ? '' : 'es'}`, '✦')
      }
      return
    }

    // `/tree stencil <name>` — re-open a fragment, or start it if it is new.
    const stencilMatch = /^(?:stencil|fragment)\s+(.+)$/i.exec(raw)
    if (stencilMatch) {
      const name = stencilMatch[1].trim()
      const catalog = await view.stencils()
      this.#stencilNames = Object.keys(catalog).sort()
      if (await view.openStencil(name)) {
        vm.setMode(TREE_VIEW)
        this.#log(`Tree — stencil “${name}”`, '✦')
        return
      }
      // Unknown name: naming IS how a fragment starts, so make one here.
      if (vm.mode !== TREE_VIEW) view.setRootToCurrent()
      vm.setMode(TREE_VIEW)
      if (await view.beginStencil(name)) this.#stencilNames = Object.keys(await view.stencils()).sort()
      else this.#log(`Tree — “${name}” is not a usable stencil name`, '✦')
      return
    }

    // `/tree rings 8` — re-walk at a new depth, keeping whatever root the
    // view is already rooted at.
    const ringsMatch = /^rings?\s+(\d+)$/.exec(lower)
    if (ringsMatch) {
      const rings = Math.max(1, Math.min(12, Number(ringsMatch[1])))
      if (vm.mode !== TREE_VIEW) view.setRootToCurrent()
      view.setRings(rings)
      vm.setMode(TREE_VIEW)
      this.#log(`Tree — walking ${rings} rings`)
      return
    }

    if (!raw || ON_KEYWORDS.has(lower)) {
      // Bare /tree toggles; the trunk is wherever you are standing.
      if (!raw && vm.mode === TREE_VIEW) { vm.setMode('hexagons'); this.#log('Tree — closed', '○'); return }
      view.setRootToCurrent()
      vm.setMode(TREE_VIEW)
      this.#log('Tree — the branch under you')
      return
    }

    const root = await this.#resolveTarget(raw)
    if (!root) {
      this.#log(`Tree — nothing named "${raw}"; try a path, a signature, or a /branch handle`)
      return
    }
    view.setRoot(root)
    vm.setMode(TREE_VIEW)
    this.#log(`Tree — rooted at ${root.label ?? (root.sig ? root.sig.slice(0, 12) + '…' : '/' + (root.segments ?? []).join('/'))}`)
  }

  /** A `/branch` handle wins over a bare word being read as a path segment —
   *  handles are the names people actually type, and a one-word path is
   *  still reachable as `/word`. */
  async #resolveTarget(raw: string): Promise<TreeRoot | null> {
    if (!raw.includes('/')) {
      const registry = get<NameRegistryShape>('@hypercomb.social/NameRegistry')
      if (registry?.ensureLoaded) {
        try {
          await registry.ensureLoaded()
          const entry = registry.get(raw)
          if (entry?.target.kind === 'lineage') return { segments: entry.target.path, label: raw }
          if (entry?.target.kind === 'signature') return { sig: entry.target.signature, label: raw }
        } catch { /* registry cold — fall through to literal parsing */ }
      }
    }
    return parseTreeTarget(raw)
  }

  #log(message: string, icon = '🌿'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _tree = new TreeQueenBee()
window.ioc.register('@diamondcoreprocessor.com/TreeQueenBee', _tree)
