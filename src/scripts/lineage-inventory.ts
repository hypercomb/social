// Lineage inventory — READ-ONLY census of every location in the live hive.
//
// Every location owns exactly one lineage sigbag (sign(lineageKey(segments))),
// so the set of paths IS the set of lineages. Run this before any migration
// planning: it is the denominator for "how many bags exist" and the checklist
// a drain would have to prove equivalence against, one path at a time.
//
// Writes NOTHING. Only `inflate` (recursive read from the root layer).
//
//   npx tsx scripts/lineage-inventory.ts
//   npx tsx scripts/lineage-inventory.ts --json > inventory.json

import WebSocket from 'ws'

const BRIDGE_PORT = 2401
const TIMEOUT = 120_000
let counter = 0
type BridgeRes = { id: string; ok: boolean; data?: unknown; error?: string }

function send(request: Record<string, unknown>): Promise<BridgeRes> {
  return new Promise((resolve, reject) => {
    const msg = { ...request, id: `inv-${Date.now()}-${++counter}` }
    const ws = new WebSocket(`ws://localhost:${BRIDGE_PORT}`)
    const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, TIMEOUT)
    ws.on('open', () => ws.send(JSON.stringify(msg)))
    ws.on('message', (raw: unknown) => {
      clearTimeout(timer)
      try { resolve(JSON.parse(String(raw)) as BridgeRes) } catch { reject(new Error('invalid response')) }
      ws.close()
    })
    ws.on('error', (err: Error) => { clearTimeout(timer); reject(new Error(`bridge connection failed: ${err.message}`)) })
  })
}

type Node = Record<string, unknown>

/** The inflated shape varies by layer version — pull children from whichever
 *  slot carries them, accepting expanded objects and bare sigs alike. */
function childrenOf(node: Node): unknown[] {
  for (const key of ['children', 'cells']) {
    const v = node[key]
    if (Array.isArray(v)) return v
  }
  return []
}

function nameOf(node: Node, fallback: string): string {
  const n = node['name']
  return typeof n === 'string' && n.trim() ? n.trim() : fallback
}

const paths: string[][] = []
const unexpanded: string[] = []

function walk(node: unknown, trail: readonly string[], depth: number): void {
  if (depth > 64) { unexpanded.push(`${trail.join('/')} (depth cap)`); return }
  if (typeof node === 'string') { unexpanded.push(`${trail.join('/')} -> ${node.slice(0, 12)}…`); return }
  if (!node || typeof node !== 'object') return
  const n = node as Node
  const kids = childrenOf(n)
  kids.forEach((kid, i) => {
    const kidName = typeof kid === 'object' && kid ? nameOf(kid as Node, `#${i}`) : `#${i}`
    const kidTrail = [...trail, kidName]
    paths.push(kidTrail)
    walk(kid, kidTrail, depth + 1)
  })
}

async function main(): Promise<void> {
  const asJson = process.argv.includes('--json')
  const res = await send({ op: 'inflate', segments: [] })
  if (!res.ok) throw new Error(`inflate failed: ${res.error}`)

  const root = res.data as Node
  paths.push([])                      // the root location owns a lineage too
  walk(root, [], 0)

  if (asJson) {
    console.log(JSON.stringify({
      total: paths.length,
      paths: paths.map(p => '/' + p.join('/')),
      unexpanded,
    }, null, 2))
    return
  }

  const byDepth = new Map<number, number>()
  for (const p of paths) byDepth.set(p.length, (byDepth.get(p.length) ?? 0) + 1)

  const roots = new Map<string, number>()
  for (const p of paths) {
    if (p.length === 0) continue
    roots.set(p[0]!, (roots.get(p[0]!) ?? 0) + 1)
  }

  console.log(`\nLINEAGE INVENTORY — ${paths.length} locations = ${paths.length} lineage sigbags\n`)
  console.log('By depth:')
  for (const d of [...byDepth.keys()].sort((a, b) => a - b)) {
    console.log(`  depth ${d}: ${byDepth.get(d)}`)
  }
  console.log('\nBy root (variable roots — each would keep ONE head under a per-root model):')
  for (const [name, count] of [...roots.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  /${name}: ${count}`)
  }
  console.log(`\nRoots: ${roots.size}  |  Locations: ${paths.length}  |  Reduction if head-per-root: ${paths.length} -> ${roots.size + 1}`)
  if (unexpanded.length) {
    console.log(`\nUnexpanded (bare sigs / depth cap): ${unexpanded.length}`)
    for (const u of unexpanded.slice(0, 20)) console.log(`  ${u}`)
    if (unexpanded.length > 20) console.log(`  … ${unexpanded.length - 20} more`)
  }
  console.log()
}

main().catch(err => { console.error(`[inventory] ${err.message}`); process.exit(1) })
