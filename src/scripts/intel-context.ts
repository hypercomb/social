import { promises as fs } from 'node:fs'
import { readManifest, expand } from './intel-shared.js'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  let outPath: string | null = null

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') outPath = args[++i]
  }

  const m = await readManifest()

  let rootText: string
  if (m.history.length > 0) {
    rootText = JSON.stringify(m.history[0].sig)
  } else {
    rootText = JSON.stringify(m, null, 2)
  }

  const expanded = await expand(rootText)

  if (outPath) {
    await fs.writeFile(outPath, expanded, 'utf8')
    console.error(`[intel] context written to ${outPath} (${expanded.length} bytes)`)
  } else {
    process.stdout.write(expanded)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
