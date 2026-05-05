import { promises as fs } from 'node:fs'
import {
  SEED_PATH, SKELETON_PATH, ensureDirs,
  writePayload, readManifest, writeManifest,
  type Manifest,
} from './intel-shared.js'

async function main(): Promise<void> {
  await ensureDirs()

  const seedSrc = await fs.readFile(SEED_PATH, 'utf8')
  const hierarchy = extractHierarchy(seedSrc)

  const skeletonText = JSON.stringify(hierarchy, null, 2)
  await fs.writeFile(SKELETON_PATH, skeletonText + '\n', 'utf8')

  const skeletonSig = await writePayload(skeletonText)

  let manifest: Manifest
  try {
    manifest = await readManifest()
    manifest.skeletonSig = skeletonSig
  } catch {
    manifest = { skeletonSig, workingSet: {}, history: [] }
  }
  await writeManifest(manifest)

  const leaves = countLeaves(hierarchy)
  const nodes = countNodes(hierarchy)

  console.log(`[intel] skeleton extracted`)
  console.log(`        ${nodes} nodes, ${leaves} leaves`)
  console.log(`        sig: ${skeletonSig}`)
  console.log(`        path: ${SKELETON_PATH}`)
}

function extractHierarchy(seedSrc: string): unknown {
  const start = seedSrc.indexOf('const hierarchy = {')
  if (start === -1) throw new Error(`couldn't find 'const hierarchy = {' in seed`)

  const braceStart = seedSrc.indexOf('{', start)
  let depth = 0
  let i = braceStart
  let inString: false | '"' | "'" = false
  let escape = false
  let inLineComment = false
  let inBlockComment = false

  for (; i < seedSrc.length; i++) {
    const ch = seedSrc[i]

    if (inLineComment) {
      if (ch === '\n') inLineComment = false
      continue
    }
    if (inBlockComment) {
      if (ch === '*' && seedSrc[i + 1] === '/') { inBlockComment = false; i++ }
      continue
    }
    if (inString) {
      if (escape) { escape = false; continue }
      if (ch === '\\') { escape = true; continue }
      if (ch === inString) { inString = false }
      continue
    }
    if (ch === '/' && seedSrc[i + 1] === '/') { inLineComment = true; i++; continue }
    if (ch === '/' && seedSrc[i + 1] === '*') { inBlockComment = true; i++; continue }
    if (ch === '"' || ch === "'") { inString = ch; continue }
    if (ch === '{') depth++
    if (ch === '}') {
      depth--
      if (depth === 0) break
    }
  }

  const literal = seedSrc.slice(braceStart, i + 1)
  return new Function(`return (${literal})`)()
}

function countLeaves(o: unknown): number {
  if (o === null || typeof o !== 'object') return 0
  let n = 0
  for (const v of Object.values(o as Record<string, unknown>)) {
    if (v === null) n++
    else n += countLeaves(v)
  }
  return n
}

function countNodes(o: unknown): number {
  if (o === null || typeof o !== 'object') return 0
  let n = Object.keys(o as Record<string, unknown>).length
  for (const v of Object.values(o as Record<string, unknown>)) {
    n += countNodes(v)
  }
  return n
}

main().catch(err => { console.error(err); process.exit(1) })
