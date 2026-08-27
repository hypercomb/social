// hypercomb-essentials/scripts/copy-to-dcp.ts
// Copies built module output into flat, append-only signature heaps.
// Ordinary builds fill the two local browser feeds. `--publish` additionally
// fills the operator's HTTP heap; use --host-heap (or CONTENT_DIR) when the
// live relay is served from a different checkout.
//
// Layout-agnostic on purpose: dist emits the FLAT layout (bare sig-named files
// + sig-named bag dirs at the dist root, plus manifest.json and the one-line
// bootstrap pin — see
// build-module.ts). This script copies whatever 64-hex-named entries dist
// holds; it never creates, migrates, or scans legacy typed dirs. Package
// publication touches only the signed package closure and its pointer files;
// private backup/migration pools are outside this boundary.
//
// Targets:
//   diamond-core-processor/public/   — DCP browser app (local-backup tool)
//   hypercomb-web/public/content/    — local dev server (feeds OPFS via localInstall)
//   --publish host heap              — operator's HTTP host content dir
//                                      (jwize.com serves layer/resource/dependency
//                                      resolution endpoints from here — see
//                                      memory: project_domain_as_identity.md)

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { chainManifest, chainScore, type ContentManifest } from './chain-manifest.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const DIST_ROOT = resolve(__dirname, '..', 'dist')

// Every destination is a heap, including the local browser feeds. A package
// build can share those directories with authored/adopted content and every
// chained package revision must remain resolvable. This pass therefore has no
// deletion phase. Reclamation, if ever needed, is a separate explicit GC over
// signed active roots—not a build or publish side effect.
type Target = { dir: string; role: 'local' | 'host' }

const LOCAL_TARGETS: Target[] = [
  { dir: resolve(__dirname, '..', '..', 'diamond-core-processor', 'public'), role: 'local' },
  { dir: resolve(__dirname, '..', '..', 'hypercomb-web', 'public', 'content'), role: 'local' },
]

const defaultHostHeap = (): string => {
  try {
    // An explicit publish from a linked worktree must fill the primary
    // checkout's relay heap, not the worktree's private copy. The common git
    // directory sits at <primary-checkout>/.git for both checkout shapes.
    const commonGitDir = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
    if (commonGitDir) return resolve(dirname(commonGitDir), 'src', 'hypercomb-relay', 'content')
  } catch {
    // Non-git package installations can still publish to their adjacent relay.
  }
  return resolve(__dirname, '..', '..', 'hypercomb-relay', 'content')
}

const targetsForInvocation = (): Target[] => {
  const args = process.argv.slice(2)
  const publish = args.includes('--publish')
  const hostAt = args.indexOf('--host-heap')
  if (hostAt >= 0 && !args[hostAt + 1]) {
    throw new Error('--host-heap requires a directory path')
  }
  if (hostAt >= 0 && !publish) {
    throw new Error('--host-heap only has an effect with --publish')
  }

  const targets = [...LOCAL_TARGETS]
  if (publish) {
    const configured = (hostAt >= 0 ? args[hostAt + 1] : process.env.CONTENT_DIR)?.trim()
    const hostHeap = resolve(configured || defaultHostHeap())
    if (!targets.some(target => target.dir.toLowerCase() === hostHeap.toLowerCase())) {
      targets.push({ dir: hostHeap, role: 'host' })
    }
  }
  return targets
}

// A content entry is anything 64-hex-named at the dist/target root:
// file = leaf bytes, directory = sigbag. Everything else at the target root
// (index.html, app assets, manifest.json) is NEVER touched by the mirror.
const SIG_NAME = /^[0-9a-f]{64}$/i
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
 *  themselves plus everything each package references. */
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

/** Copy one sig entry (file or bag dir) into the target from the first peer
 *  that holds it. Every peer is append-only, so older revisions remain useful
 *  backfill sources. */
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
  manifestJson: string,
  bootstrapPinJson: string,
  keep: Set<string>,
  peers: string[],
): { copied: number; skipped: number; healed: number } => {
  mkdirSync(targetDir, { recursive: true })

  let copied = 0
  let skipped = 0
  const srcEntries = new Set(readdirSync(DIST_ROOT).filter(n => SIG_NAME.test(n)))
  const tgtEntries = new Set(readdirSync(targetDir).filter(n => SIG_NAME.test(n)))

  // Beeline: entry name is the signature (file = leaf, directory = bag).
  // Existing immutable entries are retained; acceptance still verifies bytes
  // against that signature before code or content can be used.
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

  // BACKFILL — dist only holds the newest build's bytes, while the chained
  // manifest advertises historical versions. Fill any advertised gap from a
  // peer heap before advancing discovery metadata.
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
  // ORDER MATTERS — immutable files above, discovery manifest here, pin last.
  // A target is often being served while this copy runs (DCP, web, or relay),
  // relay's content dir), and a reader resolves manifest → sig files with no
  // lock. Written in this order, every instant is consistent: the new files
  // land while the old manifest still points only at old files, the new
  // manifest lands once everything it references is present. Old entries are
  // never removed, so rollback and propagation remain possible.
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

  return { copied, skipped, healed }
}

const main = () => {
  const targets = targetsForInvocation()
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
  for (const { dir } of targets) {
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

  // What the shipped manifest advertises — every target must be able to serve
  // that closure before its pointer moves.
  const keep = advertisedSigs(chained.manifest)
  const sourceOrder = targets.map(target => target.dir)

  for (const { dir, role } of targets) {
    const peers = sourceOrder.filter(d => d !== dir && existsSync(d))
    const { copied, skipped, healed } = syncTarget(
      dir,
      manifestJson,
      bootstrapPinJson,
      keep,
      peers,
    )
    console.log(`[copy-to-dcp] ${dir} (${role}, additive heap)`)
    console.log(`  ${copied} copied, ${skipped} unchanged, 0 removed${healed ? `, ${healed} backfilled for older versions` : ''}`)
  }
}

main()
