// diamondcoreprocessor.com/presentation/tiles/tree-layout.ts
//
// Pure geometry + palette for the sideways tree view. No IoC, no DOM, no
// awaits — given a walked hierarchy it returns node positions, tapered
// branch ribbons and per-ring columns. Kept separate from the drone so the
// maths stays inspectable and the render stays a thin projection of it.
//
// The reading direction is trunk-on-the-left: depth becomes the x column
// (ring N = column N), and the vertical axis is a classic tidy-tree leaf
// packing — leaves take successive rows, a parent centres on its children.
// The trunk therefore lands vertically centred against its own subtree.
//
// Branches are drawn as CLOSED RIBBONS, not strokes: each edge is a filled
// bezier quad that is thick where it leaves the parent and thin where it
// meets the child, so a twig ending in a leaf comes to a point. Ribbon
// thickness derives from the child's leaf count, which makes a parent's
// outgoing bundle read as a trunk splitting into limbs.

/** One walked cell. `segments` is null when the node was reached purely by
 *  signature (a sig-rooted view) and therefore has no navigable path. */
export type TreeNode = {
  readonly id: number
  /** Index into the node array; -1 for the root. */
  readonly parent: number
  readonly sig: string
  readonly name: string
  readonly depth: number
  readonly segments: readonly string[] | null
  /** Child sigs declared by the layer — may exceed the walked children when
   *  the walk hit its depth or node budget. */
  readonly childCount: number
  /** False when the walk stopped here with children still declared. */
  readonly walked: boolean
}

export type PlacedNode = TreeNode & {
  readonly x: number
  readonly y: number
  /** Leaves under this node WITHIN the drawn tree (collapsed = 1). */
  readonly leaves: number
  /** Hue of the limb this node belongs to; null on the trunk itself. */
  readonly hue: number | null
  readonly radius: number
  readonly collapsed: boolean
  /** Ancestor ids, trunk-first — the highlight path on hover. */
  readonly ancestry: readonly number[]
}

export type Ribbon = {
  readonly from: number
  readonly to: number
  readonly d: string
  readonly hue: number | null
  readonly depth: number
}

export type RingColumn = {
  readonly depth: number
  readonly x: number
  readonly count: number
}

export type TreeLayout = {
  readonly nodes: readonly PlacedNode[]
  readonly ribbons: readonly Ribbon[]
  readonly rings: readonly RingColumn[]
  readonly width: number
  readonly height: number
}

/** Horizontal distance between rings. Wide enough for a ~22ch label to sit
 *  beside its node without colliding with the next column's markers. */
export const RING_GAP = 300
/** Vertical rhythm — one drawn leaf per row. */
export const ROW_GAP = 30
export const PAD_X = 96
export const PAD_Y = 64

/** Golden-angle hue walk: adjacent limbs land far apart on the wheel, and
 *  the sequence is stable for a given child order, so a branch keeps its
 *  colour across re-walks. 214 starts the first limb on the house steel. */
const HUE_ORIGIN = 214
const HUE_STEP = 137.508

/** Limb colour at a depth — deeper twigs lighten and desaturate, so the
 *  trunk end of a limb reads heaviest. Bark grey when hue is null. */
export function limbColor(hue: number | null, depth: number, alpha = 1): string {
  if (hue === null) return alpha === 1 ? 'hsl(210 12% 62%)' : `hsl(210 12% 62% / ${alpha})`
  const saturation = Math.max(38, 64 - depth * 5)
  const lightness = Math.min(76, 46 + depth * 6)
  return `hsl(${hue.toFixed(1)} ${saturation}% ${lightness}%${alpha === 1 ? '' : ` / ${alpha}`})`
}

/** Ribbon half-thickness for a subtree of `leaves` drawn leaves. Square-root
 *  so a 400-leaf limb is visibly heavier than a 40-leaf one without becoming
 *  a slab; a single leaf resolves to a near-point tip. */
function halfWidth(leaves: number): number {
  return Math.min(26, 1.6 + Math.sqrt(Math.max(0, leaves - 1)) * 2.4)
}

function markerRadius(leaves: number, depth: number): number {
  if (leaves <= 1) return 3.5
  return Math.min(12, 4 + Math.sqrt(leaves) * (depth === 0 ? 1.6 : 1.1))
}

/**
 * Place a walked hierarchy. `collapsed` ids keep their node but drop their
 * subtree, so collapsing is a layout concern only — the walk is never redone.
 */
export function layoutTree(
  nodes: readonly TreeNode[],
  collapsed: ReadonlySet<number> = new Set(),
): TreeLayout {
  if (nodes.length === 0) return { nodes: [], ribbons: [], rings: [], width: 0, height: 0 }

  const childrenOf = new Map<number, number[]>()
  for (const node of nodes) {
    if (node.parent < 0) continue
    const bucket = childrenOf.get(node.parent)
    if (bucket) bucket.push(node.id)
    else childrenOf.set(node.parent, [node.id])
  }

  const drawnChildren = (id: number): number[] => (collapsed.has(id) ? [] : (childrenOf.get(id) ?? []))

  // ── pass 1: leaf packing (iterative — a deep hive would blow the stack) ──
  const y = new Array<number>(nodes.length).fill(0)
  const leaves = new Array<number>(nodes.length).fill(1)
  const ancestry = new Array<readonly number[]>(nodes.length).fill([])
  const hue = new Array<number | null>(nodes.length).fill(null)

  const roots = nodes.filter(n => n.parent < 0).map(n => n.id)
  let row = 0
  let limbIndex = 0

  type Frame = { id: number; phase: 0 | 1 }
  const stack: Frame[] = roots.map(id => ({ id, phase: 0 as const })).reverse()

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]
    const node = nodes[frame.id]
    const kids = drawnChildren(frame.id)

    if (frame.phase === 0) {
      frame.phase = 1
      // Inherit the limb hue; each child of the trunk opens a new limb.
      if (node.parent < 0) {
        ancestry[frame.id] = []
        hue[frame.id] = null
      } else {
        ancestry[frame.id] = [...ancestry[node.parent], node.parent]
        hue[frame.id] = nodes[node.parent].parent < 0
          ? (HUE_ORIGIN + limbIndex++ * HUE_STEP) % 360
          : hue[node.parent]
      }
      if (kids.length > 0) {
        for (let i = kids.length - 1; i >= 0; i--) stack.push({ id: kids[i], phase: 0 })
        continue
      }
      // Leaf — claim a row.
      y[frame.id] = row * ROW_GAP
      leaves[frame.id] = 1
      row++
      stack.pop()
      continue
    }

    // Post-order: centre on the drawn children, sum their leaves.
    let total = 0
    for (const kid of kids) total += leaves[kid]
    leaves[frame.id] = Math.max(1, total)
    y[frame.id] = (y[kids[0]] + y[kids[kids.length - 1]]) / 2
    stack.pop()
  }

  // ── pass 2: place, then build the ribbons ──────────────────────────────
  const visible = new Set<number>()
  const queue = [...roots]
  while (queue.length > 0) {
    const id = queue.pop() as number
    visible.add(id)
    for (const kid of drawnChildren(id)) queue.push(kid)
  }

  const placed: PlacedNode[] = []
  const byId = new Map<number, PlacedNode>()
  let maxDepth = 0
  let maxY = 0

  for (const node of nodes) {
    if (!visible.has(node.id)) continue
    const entry: PlacedNode = {
      ...node,
      x: PAD_X + node.depth * RING_GAP,
      y: PAD_Y + y[node.id],
      leaves: leaves[node.id],
      hue: hue[node.id],
      radius: markerRadius(leaves[node.id], node.depth),
      collapsed: collapsed.has(node.id),
      ancestry: ancestry[node.id],
    }
    placed.push(entry)
    byId.set(node.id, entry)
    if (node.depth > maxDepth) maxDepth = node.depth
    if (entry.y > maxY) maxY = entry.y
  }

  const ribbons: Ribbon[] = []
  for (const node of placed) {
    if (node.parent < 0) continue
    const parent = byId.get(node.parent)
    if (!parent) continue
    ribbons.push({
      from: parent.id,
      to: node.id,
      hue: node.hue,
      depth: node.depth,
      d: ribbonPath(
        parent.x, parent.y, halfWidth(node.leaves),
        node.x, node.y, node.leaves <= 1 ? 0.9 : halfWidth(node.leaves) * 0.62,
      ),
    })
  }

  const counts = new Map<number, number>()
  for (const node of placed) counts.set(node.depth, (counts.get(node.depth) ?? 0) + 1)
  const rings: RingColumn[] = []
  for (let depth = 0; depth <= maxDepth; depth++) {
    rings.push({ depth, x: PAD_X + depth * RING_GAP, count: counts.get(depth) ?? 0 })
  }

  return {
    nodes: placed,
    ribbons,
    rings,
    width: PAD_X + maxDepth * RING_GAP + RING_GAP,
    height: maxY + PAD_Y * 2,
  }
}

/**
 * A closed, tapered bezier ribbon from (x0,y0) with half-thickness h0 to
 * (x1,y1) with half-thickness h1. Both edges are S-curves sharing the same
 * horizontal control offsets, so the limb leaves and lands flat — the shape
 * of a branch rather than a wire. A leaf's h1 is sub-pixel, which is what
 * makes the tip come to a point.
 */
export function ribbonPath(
  x0: number, y0: number, h0: number,
  x1: number, y1: number, h1: number,
): string {
  const dx = (x1 - x0) * 0.45
  const cx0 = x0 + dx
  const cx1 = x1 - dx
  const f = (n: number): string => (Math.round(n * 100) / 100).toString()
  return (
    `M${f(x0)},${f(y0 - h0)}` +
    `C${f(cx0)},${f(y0 - h0)} ${f(cx1)},${f(y1 - h1)} ${f(x1)},${f(y1 - h1)}` +
    `L${f(x1)},${f(y1 + h1)}` +
    `C${f(cx1)},${f(y1 + h1)} ${f(cx0)},${f(y0 + h0)} ${f(x0)},${f(y0 + h0)}Z`
  )
}

/** Trim a cell name to fit beside its marker without measuring text. */
export function clipLabel(name: string, max = 26): string {
  const clean = String(name ?? '').trim()
  if (clean.length <= max) return clean
  return clean.slice(0, max - 1) + '…'
}
