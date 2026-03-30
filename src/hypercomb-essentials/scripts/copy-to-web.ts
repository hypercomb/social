// hypercomb-essentials/scripts/copy-to-web.ts
// Copies built module output to hypercomb-web/public/content/ for local development.
// Signature beeline: files are named by their signature, so if a file exists in
// the target with the same name, it IS the correct content. No hashing needed.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'fs'
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

  mkdirSync(WEB_CONTENT, { recursive: true })

  let copied = 0
  let skipped = 0
  let removed = 0

  // sync each content directory: copy new files, remove stale ones
  for (const dir of CONTENT_DIRS) {
    const srcDir = join(DIST_ROOT, dir)
    const tgtDir = join(WEB_CONTENT, dir)

    if (!existsSync(srcDir)) continue

    mkdirSync(tgtDir, { recursive: true })

    const srcFiles = new Set(readdirSync(srcDir))
    const tgtFiles = existsSync(tgtDir) ? new Set(readdirSync(tgtDir)) : new Set<string>()

    // beeline: filename IS the signature — if it exists in target, it's correct
    for (const file of srcFiles) {
      if (tgtFiles.has(file)) {
        skipped++
      } else {
        copyFileSync(join(srcDir, file), join(tgtDir, file))
        copied++
      }
    }

    // remove stale files (signatures no longer in source)
    for (const file of tgtFiles) {
      if (!srcFiles.has(file)) {
        rmSync(join(tgtDir, file), { force: true })
        removed++
      }
    }
  }

  // manifest.json: compare content before copying
  const srcManifest = join(DIST_ROOT, MANIFEST_FILE)
  const tgtManifest = join(WEB_CONTENT, MANIFEST_FILE)
  if (existsSync(tgtManifest)) {
    const srcContent = readFileSync(srcManifest, 'utf8')
    const tgtContent = readFileSync(tgtManifest, 'utf8')
    if (srcContent === tgtContent) {
      skipped++
    } else {
      copyFileSync(srcManifest, tgtManifest)
      copied++
    }
  } else {
    copyFileSync(srcManifest, tgtManifest)
    copied++
  }

  console.log(`[copy-to-web] synced to ${WEB_CONTENT}`)
  console.log(`[copy-to-web] ${copied} copied, ${skipped} unchanged, ${removed} removed`)
}

main()
