// Walks the relational-intelligence skeleton tree and issues one bridge
// `update` per parent. Each update carries the full layer state at that
// position — `{ name, children: [...] }` — and goes through
// `LayerCommitter.update` (the layer-as-primitive entry). One awaited
// cascade per parent. No item-level synthesis, no fire-and-forget, no
// race window between batches.

import { send } from '../hypercomb-cli/src/bridge/client.js'
import { promises as fs } from 'node:fs'
import { SKELETON_PATH } from './intel-shared.js'

type Tree = Record<string, Tree | null>

interface Batch {
  segments: string[]
  name: string
  children: string[]
}

async function main(): Promise<void> {
  const text = await fs.readFile(SKELETON_PATH, 'utf8')
  const tree = JSON.parse(text) as Tree

  const batches: Batch[] = []
  collectBatches(tree, [], 'root', batches)

  console.log(`[build-tree] ${batches.length} parent updates to commit`)
  console.log(`[build-tree] total children across all batches: ${batches.reduce((n, b) => n + b.children.length, 0)}`)

  let okCount = 0
  let failCount = 0
  let cellCount = 0

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]
    const path = batch.segments.length === 0 ? '(root)' : batch.segments.join('/')
    process.stdout.write(`[${i + 1}/${batches.length}] ${path} ← ${batch.children.length} children ... `)

    const res = await send({
      op: 'update',
      segments: batch.segments,
      layer: { name: batch.name, children: batch.children },
    })

    if (res.ok) {
      okCount++
      cellCount += batch.children.length
      console.log('ok')
    } else {
      failCount++
      console.log(`FAIL: ${res.error}`)
    }
  }

  console.log('')
  console.log(`[build-tree] complete`)
  console.log(`  updates: ${okCount} ok, ${failCount} failed`)
  console.log(`  children committed: ${cellCount}`)
}

function collectBatches(node: Tree, segments: string[], name: string, out: Batch[]): void {
  // Each level produces one update: this node's layer = its name + its children list.
  const children = Object.keys(node)
  if (children.length > 0) {
    out.push({ segments: segments.slice(), name, children })
  }
  // Recurse into each non-null child to collect its own update.
  for (const [childName, sub] of Object.entries(node)) {
    if (sub !== null && typeof sub === 'object') {
      collectBatches(sub as Tree, [...segments, childName], childName, out)
    }
  }
}

main().catch(err => { console.error(err); process.exit(1) })
