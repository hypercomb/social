// hypercomb-essentials/scripts/copy-to-web.ts
// Copies built module output to hypercomb-web/public/content/ for local development.

import { cpSync, existsSync, mkdirSync, rmSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const DIST_ROOT = resolve(__dirname, '..', 'dist')
const WEB_CONTENT = resolve(__dirname, '..', '..', 'hypercomb-web', 'public', 'content')

const CONTENT_DIRS = ['__layers__', '__bees__', '__dependencies__']
const MANIFEST_FILE = 'manifest.json'

const main = () => {
  if (!existsSync(DIST_ROOT)) {
    console.error('[copy-to-web] dist/ not found — run build:module first')
    process.exit(1)
  }

  if (!existsSync(join(DIST_ROOT, MANIFEST_FILE))) {
    console.error('[copy-to-web] dist/manifest.json not found — run build:module first')
    process.exit(1)
  }

  // clean and recreate content dir
  if (existsSync(WEB_CONTENT)) {
    rmSync(WEB_CONTENT, { recursive: true, force: true })
  }
  mkdirSync(WEB_CONTENT, { recursive: true })

  // copy content directories flat
  for (const dir of CONTENT_DIRS) {
    const src = join(DIST_ROOT, dir)
    if (existsSync(src)) {
      cpSync(src, join(WEB_CONTENT, dir), { recursive: true })
    }
  }

  // copy manifest.json
  cpSync(join(DIST_ROOT, MANIFEST_FILE), join(WEB_CONTENT, MANIFEST_FILE))

  console.log(`[copy-to-web] copied flat content to ${WEB_CONTENT}`)
  console.log(`[copy-to-web] done at ${new Date().toISOString()} — reload web app to pick up changes`)
}

main()
