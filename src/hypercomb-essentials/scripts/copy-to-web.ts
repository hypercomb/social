// hypercomb-essentials/scripts/copy-to-web.ts
// Copies built module output to hypercomb-web/public/content/ for local development.

import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync, rmSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const DIST_ROOT = resolve(__dirname, '..', 'dist')
const WEB_CONTENT = resolve(__dirname, '..', '..', 'hypercomb-web', 'public', 'content')

const main = () => {
  if (!existsSync(DIST_ROOT)) {
    console.error('[copy-to-web] dist/ not found — run build:module first')
    process.exit(1)
  }

  // find the root signature directory (only one expected)
  const entries = readdirSync(DIST_ROOT).filter(
    name => /^[a-f0-9]{64}$/i.test(name)
  )

  if (entries.length === 0) {
    console.error('[copy-to-web] no signature directory found in dist/')
    process.exit(1)
  }

  const rootSig = entries[0]
  const srcDir = join(DIST_ROOT, rootSig)

  // clean and recreate content dir
  if (existsSync(WEB_CONTENT)) {
    rmSync(WEB_CONTENT, { recursive: true, force: true })
  }
  mkdirSync(WEB_CONTENT, { recursive: true })

  // copy the root signature directory
  cpSync(srcDir, join(WEB_CONTENT, rootSig), { recursive: true })

  // write latest.txt
  writeFileSync(join(WEB_CONTENT, 'latest.txt'), rootSig, 'utf8')

  console.log(`[copy-to-web] copied ${rootSig} to ${WEB_CONTENT}`)
  console.log(`[copy-to-web] latest.txt → ${rootSig}`)
  console.log(`[copy-to-web] done at ${new Date().toISOString()} — reload web app to pick up changes`)
}

main()
