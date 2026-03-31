// hypercomb-essentials/scripts/copy-to-dcp.ts
// Copies built module output to all local targets so dev servers can feed OPFS.
// Signature beeline: files are named by their signature, so if a file exists in
// the target with the same name, it IS the correct content. No hashing needed.
//
// Targets:
//   diamond-core-processor/public/   — production proxy (serves content into OPFS)
//   hypercomb-web/public/content/    — local dev server (feeds OPFS via localInstall)

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const DIST_ROOT = resolve(__dirname, '..', 'dist')

const TARGETS = [
  resolve(__dirname, '..', '..', 'diamond-core-processor', 'public'),
]

const CONTENT_DIRS = ['__layers__', '__bees__', '__dependencies__', '__resources__']
const MANIFEST_FILE = 'manifest.json'

const syncTarget = (targetDir: string): { copied: number; skipped: number; removed: number } => {
  mkdirSync(targetDir, { recursive: true })

  let copied = 0
  let skipped = 0
  let removed = 0

  for (const dir of CONTENT_DIRS) {
    const srcDir = join(DIST_ROOT, dir)
    const tgtDir = join(targetDir, dir)

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
  const tgtManifest = join(targetDir, MANIFEST_FILE)
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

  return { copied, skipped, removed }
}

const main = () => {
  if (!existsSync(DIST_ROOT)) {
    console.error('[copy-to-dcp] dist/ not found — run build:module first')
    process.exit(1)
  }

  if (!existsSync(join(DIST_ROOT, MANIFEST_FILE))) {
    console.error('[copy-to-dcp] dist/manifest.json not found — run build:module first')
    process.exit(1)
  }

  for (const target of TARGETS) {
    const { copied, skipped, removed } = syncTarget(target)
    console.log(`[copy-to-dcp] ${target}`)
    console.log(`  ${copied} copied, ${skipped} unchanged, ${removed} removed`)
  }
}

main()
