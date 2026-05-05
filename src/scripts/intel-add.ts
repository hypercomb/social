import { promises as fs } from 'node:fs'
import path from 'node:path'
import { writePayload, readManifest, writeManifest, toJsonPayload } from './intel-shared.js'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length < 2) {
    console.error('Usage: tsx scripts/intel-add.ts <name> <file>')
    process.exit(1)
  }
  const [name, filePath] = args

  const bytes = await fs.readFile(path.resolve(filePath), 'utf8')
  const json = toJsonPayload(bytes)
  const sig = await writePayload(json)

  const m = await readManifest()
  const prev = m.workingSet[name]
  m.workingSet[name] = sig
  await writeManifest(m)

  if (prev === sig) {
    console.log(`[intel] "${name}" unchanged: ${sig}`)
  } else if (prev) {
    console.log(`[intel] "${name}" updated: ${prev} → ${sig}`)
  } else {
    console.log(`[intel] "${name}" added: ${sig}`)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
