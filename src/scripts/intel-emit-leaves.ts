import { promises as fs } from 'node:fs'
import { SKELETON_PATH } from './intel-shared.js'

async function main(): Promise<void> {
  const text = await fs.readFile(SKELETON_PATH, 'utf8')
  const tree = JSON.parse(text)
  const lines: string[] = []
  walk(tree, [], lines)
  process.stdout.write(lines.join('\n') + '\n')
  console.error(`[intel] emitted ${lines.length} leaf paths`)
}

function walk(node: unknown, path: string[], out: string[]): void {
  if (node === null) {
    out.push(path.join('/'))
    return
  }
  if (typeof node !== 'object') return
  for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
    walk(child, [...path, key], out)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
