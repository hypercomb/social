// hypercomb-essentials/scripts/copy-content.ts
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
//   hypercomb-web/public/content/    — local dev server (feeds OPFS via localInstall)
//   hypercomb-relay/content/         — operator's HTTP host content dir
//                                      (jwize.com serves layer/resource/dependency
//                                      resolution endpoints from here — see
//                                      memory: project_domain_as_identity.md)

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'node:crypto'
import { formatPoolEntry, packageClosure, poolEntries, retentionSet } from './retention.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const DIST_ROOT = resolve(__dirname, '..', 'dist')

// `additive: true` = persistent pool — never mirror. The operator HOST pool
// holds package content AND user-authored (HostSync PUT) AND adopted/co-hosted
// content, all signature-addressed and deduped. Removing "stale" entries (sigs
// not in the current build) would wipe user/adopted bytes that the build never
// produced. Additive only; reclaiming space is a separate, deliberate GC phase
// (mark-sweep over active roots), never a build-time side effect.
// The dev OPFS feed (web public) stays mirrored — it's regenerable.
const TARGETS = [
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

// DISCOVERY IS A POOL OF MEANING (documentation/host-packages-pool.md). A host
// publishes its packages by APPENDING one signature per entry to the pool at
// `sign('host:packages')`; the max index is the head. There is no catalogue,
// no filename anyone had to agree on, and nothing stated that the content does
// not already say — a client derives this same address from the same meaning
// and asks for it.
//
// The address is DERIVED, never hardcoded: this is `sign(meaning)`, byte for
// byte what core's `registerPoolMeaning` mints, and it must stay that way or
// the two sides address different directories. The colon is the collision
// rule — `lineageKey` folds every non-alphanumeric to `-`, so no location can
// ever produce this address.
const HOST_PACKAGES_MEANING = 'host:packages'
const HOST_PACKAGES_POOL = createHash('sha256').update(HOST_PACKAGES_MEANING, 'utf8').digest('hex')
const poolEntryName = (index: number): string => String(index).padStart(8, '0')

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
  poolOrder: { sig: string; label: string }[],
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
  // is often being SERVED while this mirror runs (ng serve on web public, the
  // relay's content dir), and a reader resolves manifest → sig files with no
  // lock. Written in this order, every instant is consistent: the new files
  // land while the old manifest still points only at old files, the new
  // manifest lands once everything it references is present, and only then do
  // the entries nothing references anymore go. The old order removed stale
  // sigs BEFORE the manifest swap — a reader in that window fetched a
  // manifest that advertised just-deleted bytes, failed the install, and the
  // installer row fossilized "No content found" (2026-08-14).
  const writeDoc = (name: string, json: string): void => {
    const path = join(targetDir, name)
    const existing = existsSync(path) ? readFileSync(path, 'utf8') : null
    if (existing === json) { skipped++; return }
    writeFileSync(path, json, 'utf8')
    copied++
  }
  // NO MANIFEST IS WRITTEN. A target that already carries one keeps it — it is
  // a drain artifact for readers that have not moved, and stale removal never
  // touches a non-64-hex name — but nothing refreshes it, and no client reads
  // one. What a host publishes is the pool below.

  // THE POOL, APPENDED. Same window as the manifest — after every file it can
  // name, before anything is removed — so a client that lands mid-ship walks
  // to a head whose bytes are already there.
  //
  // Append-only, and that is load-bearing: the head probe bisects on the
  // promise that entries are gapless and that index i never changes meaning.
  // An entry that is already present is therefore left exactly as it is; if it
  // ever disagreed with the chain that is a fault to report, not to paper over
  // by rewriting history under a client that may be mid-walk.
  const poolDir = join(targetDir, HOST_PACKAGES_POOL)
  mkdirSync(poolDir, { recursive: true })
  poolOrder.forEach((member, index) => {
    const entry = join(poolDir, poolEntryName(index))
    const bytes = formatPoolEntry(member)
    if (existsSync(entry)) {
      const held = readFileSync(entry, 'utf8')
      const heldSig = (held.split('\n')[0] ?? '').trim()
      if (heldSig !== member.sig) {
        // A different package at an index already shipped. Append-only says
        // this cannot happen, so it is a fault to report — never to paper over
        // by rewriting history under a client that may be mid-walk.
        console.warn(`[copy-content] pool entry ${poolEntryName(index)} holds ${heldSig.slice(0, 12)}, chain says ${member.sig.slice(0, 12)} — left as written`)
        skipped++
        return
      }
      if (held.trim() === bytes) { skipped++; return }
      // Same package, fuller bytes: an entry written before members carried
      // their branch mark. The signature — the only line a reader must have —
      // is unchanged, so this adds to an entry rather than rewriting one.
      writeFileSync(entry, bytes, 'utf8')
      copied++
      return
    }
    writeFileSync(entry, bytes, 'utf8')
    copied++
  })

  // THE STATIC SHIP'S INDEX (documentation/pools-across-hosts.md).
  //
  // A live host answers `GET /<pool>/` by `readdir`. A bucket cannot, so the
  // ship writes the same bytes the live host would compute, at the same
  // address — a directory describing itself. Both host shapes then answer one
  // URL, which is the whole point: nothing is named and nothing is agreed.
  //
  // `index.html` because that is what a static host serves for a directory
  // URL. It is not a member and every reader filters it out, on both shapes.
  const listing = poolOrder.map((_, index) => poolEntryName(index)).sort().join('\n')
  const indexPath = join(poolDir, 'index.html')
  if (!existsSync(indexPath) || readFileSync(indexPath, 'utf8') !== listing) {
    writeFileSync(indexPath, listing, 'utf8')
    copied++
  } else skipped++

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
    console.error('[copy-content] dist/ not found — run build:module first')
    process.exit(1)
  }

  if (!poolEntries(DIST_ROOT, HOST_PACKAGES_POOL).length) {
    console.error('[copy-content] dist carries no host:packages member — run build:module first')
    process.exit(1)
  }

  // ── What this ship publishes ─────────────────────────────────────────────
  // dist carries ONE member: the package just built, and the branch it was
  // built from. There is no chain to merge and no version to mint — a package
  // is named by its own bytes, and where it sits in a host's history is the
  // pool's index, which is a fact about that host rather than about the
  // package. `generation` / `previous` were per-host bookkeeping impersonating
  // a version history; the pool answers the same question by being ordered.

  // The deepest existing pool is the authority (the additive target's, which
  // never prunes), and the package just built is appended if it is not already
  // a member — publishing the same package twice is a no-op, which is what a
  // content-addressed member buys.
  const distMember = poolEntries(DIST_ROOT, HOST_PACKAGES_POOL)[0]
  const existingPool = [...TARGETS]
    .sort((a, b) => Number(b.additive) - Number(a.additive))
    .map(target => poolEntries(target.dir, HOST_PACKAGES_POOL))
    .reduce((deepest, candidate) => (candidate.length > deepest.length ? candidate : deepest), [] as { sig: string; label: string }[])
  const poolOrder = distMember && !existingPool.some(entry => entry.sig === distMember.sig)
    ? [...existingPool, distMember]
    : existingPool
  console.log(`[copy-content] host:packages — ${poolOrder.length} member(s), head ${poolOrder[poolOrder.length - 1]?.sig.slice(0, 12) ?? '(none)'}`)

  // RETENTION IS DERIVED, NOT ADVERTISED (retention.ts). Every signature any
  // published package still needs, walked from its sealed root — the same walk
  // admission does — plus the two bag addresses, recomputed. No document says
  // what may not be deleted; the packages do.
  //
  // Sources are additive-first: that pool never prunes, so it holds the whole
  // deploy history and can answer for a version dist no longer carries. dist
  // itself is included for the package just built, which is in no pool yet.
  //
  // Measured before this replaced the manifest: 3014 signatures either way,
  // and the five the manifest kept that this does not are phantom bag
  // references no host has ever held. A dry run at the mirrored target deleted
  // nothing that the old authority kept.
  const retentionSources = [...[...TARGETS].sort((a, b) => Number(b.additive) - Number(a.additive)).map(t => t.dir), DIST_ROOT]
  const keep = retentionSet(retentionSources, HOST_PACKAGES_POOL)
  for (const member of poolOrder) for (const sig of packageClosure(DIST_ROOT, member.sig)) keep.add(sig)
  const sourceOrder = [...TARGETS].sort((a, b) => Number(b.additive) - Number(a.additive)).map(t => t.dir)

  for (const { dir, additive } of TARGETS) {
    const peers = sourceOrder.filter(d => d !== dir && existsSync(d))
    const { copied, skipped, removed, drained, healed } = syncTarget(dir, additive, poolOrder, keep, peers)
    console.log(`[copy-content] ${dir}${additive ? ' (additive/persistent)' : ''}`)
    console.log(`  ${copied} copied, ${skipped} unchanged, ${removed} removed${healed ? `, ${healed} backfilled for older versions` : ''}${drained ? `, ${drained} drained from legacy dirs` : ''}`)
  }
}

main()
