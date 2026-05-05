import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  writePayload, readManifest, writeManifest, toJsonPayload,
  type IterationBundle,
} from './intel-shared.js'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  let summary = ''
  let filePath: string | null = null

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--summary') summary = args[++i]
    else if (!filePath) filePath = args[i]
  }

  if (!filePath) {
    console.error('Usage: tsx scripts/intel-publish.ts <organized-graph-file> [--summary "..."]')
    process.exit(1)
  }

  const bytes = await fs.readFile(path.resolve(filePath), 'utf8')
  const generationJson = toJsonPayload(bytes)
  const generationSig = await writePayload(generationJson)

  const m = await readManifest()
  const previousIterationSig = m.history[0]?.sig ?? null

  const bundle: IterationBundle = {
    iteration: m.history.length + 1,
    at: Date.now(),
    summary,
    workingSet: { ...m.workingSet },
    generation: generationSig,
    previousIterationSig,
  }

  const bundleText = JSON.stringify(bundle, null, 2)
  const bundleSig = await writePayload(bundleText)

  m.history.unshift({ at: bundle.at, sig: bundleSig, summary })
  await writeManifest(m)

  console.log(`[intel] iteration ${bundle.iteration} published`)
  console.log(`        bundle:     ${bundleSig}`)
  console.log(`        generation: ${generationSig}`)
  console.log(`        previous:   ${previousIterationSig ?? '(none — first iteration)'}`)
  console.log(`        summary:    ${summary || '(none)'}`)
}

main().catch(err => { console.error(err); process.exit(1) })
