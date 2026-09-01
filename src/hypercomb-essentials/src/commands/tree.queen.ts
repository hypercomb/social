// commands/tree.queen.ts
//
// `/tree` — open the sideways tree: the current branch drawn as a mind map
// that grows like a branch. Trunk at the left, one column per ring, limbs
// tapering to a point at the tips.
//
// Syntax:
//   /tree                     — the branch under where you are standing
//   /tree <name>              — a handle registered with `/hive`
//   /tree <64-hex signature>  — root anywhere in the merkle tree
//   /tree /path/to/tile       — root at a lineage path
//   /tree insight <name>      — re-open a named insight (or start one)
//   /tree insights            — list the insights on file
//   /tree rings 8             — how many rings to walk up front (1–12)
//   /tree off                 — back to hexagons
//
// The render itself is TreeViewDrone (presentation/tiles/tree-view.drone.ts).
// This queen only resolves the target: a signature is the primitive input,
// and everything else — a path, a `/hive` handle, the current location —
// is a way of naming one.

import { QueenBee, EffectBus } from '@hypercomb/core'
import { parseTreeTarget, TREE_VIEW } from '../presentation/tiles/tree-view.drone.js'
import type { TreeRoot } from '../presentation/tiles/tree-walk.js'
import type { VisualBeeRegistry } from './visual-bee-registry.js'

const get = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

const OFF_KEYWORDS = new Set(['off', 'hex', 'hexagons', 'hexagon', 'close', 'exit'])
const ON_KEYWORDS = new Set(['on', 'open', 'go', 'view', 'here'])

type ViewModeShape = { mode: string; setMode(next: string): void }
type TreeViewShape = {
  setRoot(root: TreeRoot, rings?: number): void
  setRootToCurrent(): void
  setRings(rings: number): void
  insights(): Promise<Record<string, { calls: readonly string[] }>>
  openInsight(name: string): Promise<boolean>
  beginInsight(name: string): Promise<boolean>
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
    'insight <name>', 'insights', 'rings <n>', 'off',
  ]
  override examples = [
    { input: '/tree', result: 'Draws the branch under the current tile' },
    { input: '/tree rings 9', result: 'Walks nine rings deep instead of six' },
    { input: '/tree docs', result: 'Roots the tree at the "docs" handle from /hive' },
    { input: '/tree insight audit', result: 'Re-opens the named insight "audit"' },
  ]

  override slashComplete(args: string): readonly string[] {
    const tokens = args.split(/\s+/)
    const head = (tokens[0] ?? '').toLowerCase()
    if (tokens.length > 1 && head === 'rings') {
      return ['4', '6', '8', '10', '12'].filter(n => n.startsWith(tokens[1] ?? ''))
    }
    if (tokens.length > 1 && (head === 'insight' || head === 'fragment')) {
      return this.#insightNames.filter(n => n.toLowerCase().startsWith((tokens[1] ?? '').toLowerCase()))
    }
    const registry = get<NameRegistryShape>('@hypercomb.social/NameRegistry')
    const names = registry?.matching?.(head) ?? []
    return [
      ...['insight', 'insights', 'rings', 'off'].filter(o => o.startsWith(head)),
      ...names,
    ]
  }

  /** Cached for the SYNCHRONOUS completer — refreshed whenever the view is
   *  asked for its catalog. */
  #insightNames: string[] = []

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

    // `/tree insights` — what insights exist.
    if (lower === 'insights' || lower === 'fragments') {
      const catalog = await view.insights()
      this.#insightNames = Object.keys(catalog).sort()
      if (this.#insightNames.length === 0) {
        this.#log('Tree — no insights yet; open /tree and name a view to start one', '✦')
        return
      }
      for (const name of this.#insightNames) {
        const calls = catalog[name].calls.length
        this.#log(`Tree — insight “${name}” · ${calls} branch${calls === 1 ? '' : 'es'}`, '✦')
      }
      return
    }

    // `/tree insight <name>` — re-open an insight, or start it if it is new.
    const insightMatch = /^(?:insight|fragment)\s+(.+)$/i.exec(raw)
    if (insightMatch) {
      const name = insightMatch[1].trim()
      const catalog = await view.insights()
      this.#insightNames = Object.keys(catalog).sort()
      if (await view.openInsight(name)) {
        vm.setMode(TREE_VIEW)
        this.#log(`Tree — insight “${name}”`, '✦')
        return
      }
      // Unknown name: naming IS how an insight starts, so make one here.
      if (vm.mode !== TREE_VIEW) view.setRootToCurrent()
      vm.setMode(TREE_VIEW)
      if (await view.beginInsight(name)) this.#insightNames = Object.keys(await view.insights()).sort()
      else this.#log(`Tree — “${name}” is not a usable insight name`, '✦')
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
      this.#log(`Tree — nothing named "${raw}"; try a path, a signature, or a /hive handle`)
      return
    }
    view.setRoot(root)
    vm.setMode(TREE_VIEW)
    this.#log(`Tree — rooted at ${root.label ?? (root.sig ? root.sig.slice(0, 12) + '…' : '/' + (root.segments ?? []).join('/'))}`)
  }

  /** A `/hive` handle wins over a bare word being read as a path segment —
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

// ── The tree as a VISUAL BEE — a branch-scoped entrance ────────────────
//
// `/tree` was slash-command-only: no icon anywhere, so the one way in was to
// know the command. It is now a declared view like any other, with the ONE
// difference that makes it fit the tree: `scope: 'branch'`. Mark a cell with
// `visual:tree:branch` (the bee is `attachable`, so `name@tree` from the
// command line IS the whole install) and the toggle appears in the icon rail
// for that cell AND everywhere beneath it — click to open the tree, click to
// close. Step outside the branch and the icon drops.
//
// Nothing here is behaviors-specific. The `behaviors` root is simply the
// first cell to carry the mark; any branch a participant wants navigable as
// a tree gets the same entrance by being marked, with no code change. That
// is the point — the classification lives on the tile, not in this file.
;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<VisualBeeRegistry>(
  '@diamondcoreprocessor.com/VisualBeeRegistry',
  (registry) => {
    registry.register({
      view: TREE_VIEW,
      slashCommand: '/tree',
      iconName: 'tree',
      toggleIcon: 'account_tree',
      decorationKind: 'visual:tree:branch',
      scope: 'branch',
      labelKey: 'view.tree',
      descriptionKey: 'view.tree.description',
      queenKey: '@diamondcoreprocessor.com/TreeQueenBee',
      // The tree's content IS the branch the cell already has — there is
      // nothing to author first, so the mark alone installs it.
      attachable: true,
      // Marking a root says "this branch reads as a tree", which is exactly
      // the kind of statement that should travel with the branch.
      adoptScope: 'hierarchy',
      pheromones: ['platform:desktop'],
    })
  },
)
