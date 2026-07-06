// hypercomb-essentials/scripts/copy-to-dcp.ts
// Copies built module output to all local targets so dev servers can feed OPFS.
// Signature beeline: files are named by their signature, so if a file exists in
// the target with the same name, it IS the correct content. No hashing needed.
//
// Layout-agnostic on purpose: dist emits the FLAT layout (bare sig-named files
// + sig-named bag dirs at the dist root, plus manifest.json — see
// build-module.ts). This script copies whatever 64-hex-named entries dist
// holds; it never creates a typed `__x__` dir. Targets that still carry the
// legacy typed dirs (`__layers__`/`__bees__`/`__dependencies__`/`__resources__`)
// get a SELF-CLEANING drain: per-entry copy → verify → remove into the flat
// target root, then a gated non-recursive rmdir that only succeeds once the
// dir is empty. Nothing is ever deleted before its bytes are confirmed at the
// flat root.
//
// Targets:
//   diamond-core-processor/public/   — DCP browser app (local-backup tool)
//   hypercomb-web/public/content/    — local dev server (feeds OPFS via localInstall)
//   hypercomb-relay/content/         — operator's HTTP host content dir
//                                      (jwize.com serves layer/resource/dependency
//                                      resolution endpoints from here — see
//                                      memory: project_domain_as_identity.md)

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, unlinkSync } from 'fs'
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

// A content entry is anything 64-hex-named at the dist/target root:
// file = leaf bytes, directory = sigbag. Everything else at the target root
// (index.html, app assets, manifest.json) is NEVER touched by the mirror.
const SIG_NAME = /^[0-9a-f]{64}$/i
// LEGACY drain sources at the TARGETS only — dist no longer emits these.
// The three build dirs were only ever written by this script, so their
// content is provably build content at every target. `__resources__` was
// never build-emitted: at the additive relay pool it holds legacy client
// PUTs (user bytes → drain to the flat root, which additive never prunes);
// at mirrored targets its provenance is unknown, and draining it into a
// root that mirror-deletes would eventually destroy it — so it is left
// untouched there.
const LEGACY_BUILD_DIRS = ['__layers__', '__bees__', '__dependencies__']
const LEGACY_RESOURCES_DIR = '__resources__'
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

// recursive (name → size) fingerprint, used to verify a bag copy landed
// completely before its source is removed.
const dirFingerprint = (dir: string, prefix = ''): Map<string, number> => {
  const out = new Map<string, number>()
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      for (const [k, v] of dirFingerprint(full, `${prefix}${name}/`)) out.set(k, v)
    } else {
      out.set(`${prefix}${name}`, st.size)
    }
  }
  return out
}

const fingerprintsMatch = (a: Map<string, number>, b: Map<string, number>): boolean => {
  if (a.size !== b.size) return false
  for (const [k, v] of a) if (b.get(k) !== v) return false
  return true
}

/** Self-cleaning drain of a target's legacy typed dirs into its flat root.
 *  Per entry: copy (if the flat root lacks it or holds a size-mismatched
 *  partial) → verify sizes match → remove the legacy entry. A non-sig-named
 *  straggler is left alone and blocks the final rmdir — the gated,
 *  non-recursive removal only succeeds once the dir is truly empty, so
 *  nothing unconfirmed is ever destroyed. Names are canonicalized: legacy
 *  `<sig>.js` / `<sig>.json` land at the flat root as bare `<sig>`. */
const drainLegacyDirs = (targetDir: string, additive: boolean): number => {
  let drained = 0
  const sources = additive ? [...LEGACY_BUILD_DIRS, LEGACY_RESOURCES_DIR] : LEGACY_BUILD_DIRS
  for (const legacyName of sources) {
    const legacyDir = join(targetDir, legacyName)
    if (!existsSync(legacyDir)) continue
    for (const name of readdirSync(legacyDir)) {
      const srcPath = join(legacyDir, name)
      const st = statSync(srcPath)
      if (st.isDirectory()) {
        // sigbag dir — relocate whole, verify by recursive fingerprint
        if (!SIG_NAME.test(name)) continue // unknown subdir — leave, blocks rmdir
        const tgtPath = join(targetDir, name)
        if (!existsSync(tgtPath)) copyDirRecursive(srcPath, tgtPath)
        if (fingerprintsMatch(dirFingerprint(srcPath), dirFingerprint(tgtPath))) {
          rmSync(srcPath, { recursive: true, force: true })
          drained++
        }
      } else {
        const sig = name.replace(/\.(js|json)$/i, '')
        if (!SIG_NAME.test(sig)) continue // not content-addressed — leave
        const tgtPath = join(targetDir, sig)
        const needsCopy = !existsSync(tgtPath) || statSync(tgtPath).size !== st.size
        if (needsCopy) copyFileSync(srcPath, tgtPath)
        if (existsSync(tgtPath) && statSync(tgtPath).size === st.size) {
          unlinkSync(srcPath)
          drained++
        }
      }
    }
    // gated removal: non-recursive on purpose — only an EMPTY (fully
    // drained) legacy dir disappears; stragglers survive to a later run.
    try { rmdirSync(legacyDir) } catch { /* not yet empty */ }
  }
  return drained
}

const syncTarget = (targetDir: string, additive: boolean): { copied: number; skipped: number; removed: number; drained: number } => {
  mkdirSync(targetDir, { recursive: true })

  let copied = 0
  let skipped = 0
  let removed = 0

  // drain BEFORE mirroring so relocated-then-stale entries get pruned in the
  // same run (mirrored targets) and reads keep resolving throughout.
  const drained = drainLegacyDirs(targetDir, additive)

  const srcEntries = new Set(readdirSync(DIST_ROOT).filter(n => SIG_NAME.test(n)))
  const tgtEntries = new Set(readdirSync(targetDir).filter(n => SIG_NAME.test(n)))

  // beeline: entry name IS the signature (file = leaf, directory = bag).
  // Either way, if the name exists in target, content-addressing guarantees
  // it's the same content — skip.
  for (const name of srcEntries) {
    if (tgtEntries.has(name)) {
      skipped++
      continue
    }
    const srcPath = join(DIST_ROOT, name)
    const tgtPath = join(targetDir, name)
    if (statSync(srcPath).isDirectory()) {
      copyDirRecursive(srcPath, tgtPath)
    } else {
      copyFileSync(srcPath, tgtPath)
    }
    copied++
  }

  // remove stale entries (signatures no longer in source) — STRICTLY
  // whitelisted to 64-hex names so app assets sharing the target root
  // (index.html, worker scripts, manifest.json) are untouchable. Recursive
  // rm handles bag directories. SKIPPED for additive (persistent) pools so
  // a rebuild never deletes user-authored or adopted content sharing the dir.
  if (!additive) {
    for (const name of tgtEntries) {
      if (!srcEntries.has(name)) {
        rmSync(join(targetDir, name), { recursive: true, force: true })
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

  return { copied, skipped, removed, drained }
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
    const { copied, skipped, removed, drained } = syncTarget(dir, additive)
    console.log(`[copy-to-dcp] ${dir}${additive ? ' (additive/persistent)' : ''}`)
    console.log(`  ${copied} copied, ${skipped} unchanged, ${removed} removed${drained ? `, ${drained} drained from legacy dirs` : ''}`)
  }
}

main()
