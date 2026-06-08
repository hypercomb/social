// hypercomb-essentials/scripts/copy-to-dcp.ts
// Copies built module output to all local targets so dev servers can feed OPFS.
// Signature beeline: files are named by their signature, so if a file exists in
// the target with the same name, it IS the correct content. No hashing needed.
//
// Targets:
//   diamond-core-processor/public/   — DCP browser app (local-backup tool)
//   hypercomb-web/public/content/    — local dev server (feeds OPFS via localInstall)
//   hypercomb-relay/content/         — operator's HTTP host content dir
//                                      (jwize.com serves layer/resource/dependency
//                                      resolution endpoints from here — see
//                                      memory: project_domain_as_identity.md)

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const DIST_ROOT = resolve(__dirname, '..', 'dist')

// `additive: true` = persistent pool — never mirror. The operator HOST pool
// holds package content AND user-authored (HostSync PUT) AND adopted/co-hosted
// content, all signature-addressed and deduped. Removing "stale" entries (sigs
// not in the current build) would wipe user/adopted bytes that the build never
// produced. Additive only; reclaiming space is a separate, deliberate GC phase
// (mark-sweep over active roots), never a build-time side effect.
// The dev OPFS feeds (web/dcp public) stay mirrored — they're regenerable.
const TARGETS = [
  { dir: resolve(__dirname, '..', '..', 'diamond-core-processor', 'public'), additive: false },
  { dir: resolve(__dirname, '..', '..', 'hypercomb-web', 'public', 'content'), additive: false },
  { dir: resolve(__dirname, '..', '..', 'hypercomb-relay', 'content'), additive: true },
]

const CONTENT_DIRS = ['__layers__', '__bees__', '__dependencies__', '__resources__']
const MANIFEST_FILE = 'manifest.json'

const copyDirRecursive = (srcDir: string, tgtDir: string): void => {
  mkdirSync(tgtDir, { recursive: true })
  for (const name of readdirSync(srcDir)) {
    const srcPath = join(srcDir, name)
    const tgtPath = join(tgtDir, name)
    if (statSync(srcPath).isDirectory()) {
      copyDirRecursive(srcPath, tgtPath)
    } else {
      copyFileSync(srcPath, tgtPath)
    }
  }
}

const syncTarget = (targetDir: string, additive: boolean): { copied: number; skipped: number; removed: number } => {
  mkdirSync(targetDir, { recursive: true })

  let copied = 0
  let skipped = 0
  let removed = 0

  for (const dir of CONTENT_DIRS) {
    const srcDir = join(DIST_ROOT, dir)
    const tgtDir = join(targetDir, dir)

    if (!existsSync(srcDir)) continue

    mkdirSync(tgtDir, { recursive: true })

    const srcEntries = new Set(readdirSync(srcDir))
    const tgtEntries = existsSync(tgtDir) ? new Set(readdirSync(tgtDir)) : new Set<string>()

    // beeline: entry name IS the signature (file = leaf, directory = bag).
    // Either way, if the name exists in target, content-addressing guarantees
    // it's the same content — skip.
    for (const name of srcEntries) {
      if (tgtEntries.has(name)) {
        skipped++
        continue
      }
      const srcPath = join(srcDir, name)
      const tgtPath = join(tgtDir, name)
      if (statSync(srcPath).isDirectory()) {
        copyDirRecursive(srcPath, tgtPath)
      } else {
        copyFileSync(srcPath, tgtPath)
      }
      copied++
    }

    // remove stale entries (signatures no longer in source) — recursive
    // handles bag directories. SKIPPED for additive (persistent) pools so a
    // rebuild never deletes user-authored or adopted content sharing the dir.
    if (!additive) {
      for (const name of tgtEntries) {
        if (!srcEntries.has(name)) {
          rmSync(join(tgtDir, name), { recursive: true, force: true })
          removed++
        }
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

  for (const { dir, additive } of TARGETS) {
    const { copied, skipped, removed } = syncTarget(dir, additive)
    console.log(`[copy-to-dcp] ${dir}${additive ? ' (additive/persistent)' : ''}`)
    console.log(`  ${copied} copied, ${skipped} unchanged, ${removed} removed`)
  }
}

main()
