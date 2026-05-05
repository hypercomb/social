// Walks the relational-intelligence skeleton tree and issues one batched
// `tile add` per parent (with that parent's children) over the bridge.
// Each call goes through the bridge's awaited #add path with a segments
// parameter, so the cascade for each parent is one consistent merkle update.
//
// This is the tactical bulk-import path while the proper layer-import primitive
// is still pending in the layer-as-primitive refactor (see memory:
// project_layer_is_primitive.md). Better than 367 racy `do --stdin` submits
// because each call is awaited end-to-end and the worker emits cell:added
// with proper segments so the cascade starts at the correct depth.

import { send } from '../hypercomb-cli/src/bridge/client.js'
import { promises as fs } from 'node:fs'
import { SKELETON_PATH } from './intel-shared.js'

type Tree = Record<string, Tree | null>

interface Batch {
  segments: string[]
  children: string[]
}

async function main(): Promise<void> {
  const text = await fs.readFile(SKELETON_PATH, 'utf8')
  const tree = JSON.parse(text) as Tree

  const batches: Batch[] = []
  collectBatches(tree, [], batches)

  console.log(`[build-tree] ${batches.length} parent batches to commit`)
  console.log(`[build-tree] total children across all batches: ${batches.reduce((n, b) => n + b.children.length, 0)}`)

  let okCount = 0
  let failCount = 0
  let cellCount = 0

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]
    const path = batch.segments.length === 0 ? '(root)' : batch.segments.join('/')
    process.stdout.write(`[${i + 1}/${batches.length}] ${path} ← ${batch.children.length} children ... `)

    const res = await send({
      op: 'add',
      cells: batch.children,
      segments: batch.segments,
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
  console.log(`  batches:  ${okCount} ok, ${failCount} failed`)
  console.log(`  cells committed: ${cellCount}`)
}

function collectBatches(node: Tree, segments: string[], out: Batch[]): void {
  // Children of this node = direct keys whose values are object or null.
  // Any key in this node is a child cell at THIS depth (segments).
  const children = Object.keys(node)
  if (children.length > 0) {
    out.push({ segments: segments.slice(), children })
  }
  // Recurse into each non-null child to collect its own batch.
  for (const [name, sub] of Object.entries(node)) {
    if (sub !== null && typeof sub === 'object') {
      collectBatches(sub as Tree, [...segments, name], out)
    }
  }
}

main().catch(err => { console.error(err); process.exit(1) })
