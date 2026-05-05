import { readManifest, writeManifest } from './intel-shared.js'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length < 1) {
    console.error('Usage: tsx scripts/intel-remove.ts <name>')
    process.exit(1)
  }
  const name = args[0]

  const m = await readManifest()
  if (!(name in m.workingSet)) {
    console.error(`[intel] "${name}" not in workingSet`)
    process.exit(1)
  }
  const sig = m.workingSet[name]
  delete m.workingSet[name]
  await writeManifest(m)

  console.log(`[intel] "${name}" removed (was ${sig}; payload kept)`)
}

main().catch(err => { console.error(err); process.exit(1) })
