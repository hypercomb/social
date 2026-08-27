// hypercomb-essentials/scripts/copy-to-dcp.ts
// Copies built module output to all local targets so dev servers can feed OPFS.
// Signature beeline: files are named by their signature, so if a file exists in
// the target with the same name, it IS the correct content. No hashing needed.
//
// Layout-agnostic on purpose: dist emits the FLAT layout (bare sig-named files
// + sig-named bag dirs at the dist root, plus manifest.json and the one-line
// bootstrap pin — see
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

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { chainManifest, chainScore, type ContentManifest } from './chain-manifest.js'

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
const BOOTSTRAP_PIN_FILE = 'bootstrap-pin.json'

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

/** Read and parse a target's manifest.json, or null when absent/unreadable. */
const readTargetManifest = (targetDir: string): ContentManifest | null => {
  const path = join(targetDir, MANIFEST_FILE)
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed?.packages && typeof parsed.packages === 'object' ? parsed as ContentManifest : null
  } catch {
    return null
  }
}

/** Every signature the chained manifest advertises: the package sigs
 *  themselves plus everything each package references. This is the RETENTION
 *  AUTHORITY — see the prune in syncTarget. */
const advertisedSigs = (manifest: ContentManifest): Set<string> => {
  const out = new Set<string>()
  const packages = (manifest as { packages?: Record<string, Record<string, unknown>> }).packages ?? {}
  for (const [sig, pkg] of Object.entries(packages)) {
    out.add(sig)
    for (const field of ['layers', 'bees', 'dependencies', 'resources']) {
      for (const ref of (pkg[field] as string[] | undefined) ?? []) out.add(ref)
    }
    // Signed package descriptor and sigbags are scalar signature edges.
    // Retaining them keeps every advertised historical revision resolvable.
    for (const field of ['bootstrap', 'dependenciesBag', 'beesBag']) {
      const ref = String(pkg[field] ?? '')
      if (SIG_NAME.test(ref)) out.add(ref)
    }
  }
  return out
}

/** Copy one sig entry (file or bag dir) into the target from the first source
 *  that holds it. Sources are tried in order; the additive pool is passed
 *  first because it never prunes, so it is the complete one. */
const backfillFrom = (sources: string[], name: string, targetDir: string): boolean => {
  for (const src of sources) {
    const srcPath = join(src, name)
    if (!existsSync(srcPath)) continue
    const tgtPath = join(targetDir, name)
    if (statSync(srcPath).isDirectory()) copyDirRecursive(srcPath, tgtPath)
    else copyFileSync(srcPath, tgtPath)
    return true
  }
  return false
}

const syncTarget = (
  targetDir: string,
  additive: boolean,
  manifestJson: string,
  bootstrapPinJson: string,
  keep: Set<string>,
  peers: string[],
): { copied: number; skipped: number; removed: number; drained: number; healed: number } => {
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

  // BACKFILL — the manifest is CHAINED (every past version stays listed), but
  // dist only ever holds the NEWEST build's bytes. A mirrored target that has
  // only ever seen dist therefore advertises ~20 historical versions whose
  // layer bytes it never received (or pruned in an earlier run, before the
  // retention rule below existed): selecting any revision but the newest gave
  // a permanent "No content found" — the row could not heal, because the
  // bytes really were gone. Restore anything the manifest advertises from
  // whichever peer target still holds it (the additive pool is complete).
  let healed = 0
  for (const name of keep) {
    if (srcEntries.has(name) || tgtEntries.has(name)) continue
    if (backfillFrom(peers, name, targetDir)) {
      tgtEntries.add(name)
      healed++
    }
  }

  // manifest.json: every target receives the SAME chained manifest (computed
  // once in main against the deepest existing chain), compare-first so an
  // unchanged re-deploy writes nothing.
  //
  // ORDER MATTERS — files above, manifest here, stale removal LAST. A target
  // is often being SERVED while this mirror runs (ng serve on DCP public, the
  // relay's content dir), and a reader resolves manifest → sig files with no
  // lock. Written in this order, every instant is consistent: the new files
  // land while the old manifest still points only at old files, the new
  // manifest lands once everything it references is present, and only then do
  // the entries nothing references anymore go. The old order removed stale
  // sigs BEFORE the manifest swap — a reader in that window fetched a
  // manifest that advertised just-deleted bytes, failed the install, and the
  // installer row fossilized "No content found" (2026-08-14).
  const tgtManifest = join(targetDir, MANIFEST_FILE)
  const existing = existsSync(tgtManifest) ? readFileSync(tgtManifest, 'utf8') : null
  if (existing === manifestJson) {
    skipped++
  } else {
    writeFileSync(tgtManifest, manifestJson, 'utf8')
    copied++
  }
  // The pin is the deployment's only mutable trust edge. Write it only after
  // every signed leaf and the matching discovery manifest are present. A
  // reader then sees either the previous valid pin or the new valid pin—never
  // a signature whose descriptor has not landed yet.
  const targetPin = join(targetDir, BOOTSTRAP_PIN_FILE)
  const existingPin = existsSync(targetPin) ? readFileSync(targetPin, 'utf8') : null
  if (existingPin === bootstrapPinJson) {
    skipped++
  } else {
    writeFileSync(targetPin, bootstrapPinJson, 'utf8')
    copied++
  }

  // remove stale entries (signatures no longer in source) — STRICTLY
  // whitelisted to 64-hex names so app assets sharing the target root
  // (index.html, worker scripts, manifest.json) are untouchable. Recursive
  // rm handles bag directories. SKIPPED for additive (persistent) pools so
  // a rebuild never deletes user-authored or adopted content sharing the dir.
  //
  // RETENTION AUTHORITY IS THE MANIFEST, not dist. "Stale" means nothing
  // advertises it — a sig referenced by ANY package in the chained manifest is
  // live content, however old the version that references it. Pruning by dist
  // alone deleted every historical version's bytes on the next build while the
  // chain kept offering those versions to install, which is how a target came
  // to advertise 23 revisions it could only serve one of.
  if (!additive) {
    for (const name of tgtEntries) {
      if (!srcEntries.has(name) && !keep.has(name)) {
        rmSync(join(targetDir, name), { recursive: true, force: true })
        removed++
      }
    }
  }

  return { copied, skipped, removed, drained, healed }
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

  if (!existsSync(join(DIST_ROOT, BOOTSTRAP_PIN_FILE))) {
    console.error('[copy-to-dcp] dist/bootstrap-pin.json not found — run build:module first')
    process.exit(1)
  }

  // ── Version chaining ────────────────────────────────────────────────────
  // dist holds the build's single-package manifest (stable genesis label,
  // previous: null — see build-module.ts). The version is minted HERE, at
  // ship time, by chaining against the deepest chain any target already
  // holds (the additive relay pool normally — it never prunes, so its chain
  // is the operator's real deploy history). All targets then receive the
  // SAME merged manifest so their chains can never diverge. An identical
  // rebuild adopts the version it already has — no re-chaining, no churn.
  // dist itself stays single-package: the build's skip-write compare must
  // keep seeing its own bytes. (Azure keeps its own equivalent merge in
  // deploy-azure.ps1 — numbering there is per-remote by construction.)
  const localManifest = JSON.parse(readFileSync(join(DIST_ROOT, MANIFEST_FILE), 'utf8')) as ContentManifest
  let authority: ContentManifest | null = null
  let authorityScore = 0
  for (const { dir } of TARGETS) {
    const candidate = readTargetManifest(dir)
    const score = chainScore(candidate)
    if (candidate && score > authorityScore) {
      authority = candidate
      authorityScore = score
    }
  }
  const chained = chainManifest(localManifest, authority, new Date())
  const manifestJson = JSON.stringify(chained.manifest, null, 2) + '\n'
  const bootstrapPinJson = readFileSync(join(DIST_ROOT, BOOTSTRAP_PIN_FILE), 'utf8')
  if (chained.generation) {
    console.log(`[copy-to-dcp] manifest version: v${chained.generation} '${chained.label}'${chained.minted ? '' : ' (unchanged re-deploy)'}`)
  }

  // What the shipped manifest advertises — the retention set every target must
  // be able to serve. Backfill sources are ordered additive-first: those pools
  // never prune, so they carry the full deploy history.
  const keep = advertisedSigs(chained.manifest)
  const sourceOrder = [...TARGETS].sort((a, b) => Number(b.additive) - Number(a.additive)).map(t => t.dir)

  for (const { dir, additive } of TARGETS) {
    const peers = sourceOrder.filter(d => d !== dir && existsSync(d))
    const { copied, skipped, removed, drained, healed } = syncTarget(
      dir,
      additive,
      manifestJson,
      bootstrapPinJson,
      keep,
      peers,
    )
    console.log(`[copy-to-dcp] ${dir}${additive ? ' (additive/persistent)' : ''}`)
    console.log(`  ${copied} copied, ${skipped} unchanged, ${removed} removed${healed ? `, ${healed} backfilled for older versions` : ''}${drained ? `, ${drained} drained from legacy dirs` : ''}`)
  }
}

main()
