// diamondcoreprocessor.com/commands/website-archive.queen.ts
//
// `/website save` and `/website load` (subcommands of /website, dispatched by
// WebsiteQueenBee) — export a website (or any) branch as a self-contained .zip
// you can carry to another machine, and import one back. This module is no
// longer a QueenBee; it exports `exportBranch` / `importArchive`, which
// website.queen invokes. (Folded in from the former standalone `/website-save`
// + `/website-load` commands, which cluttered the `/website` completion list.)
//
// This is the first consumer of the Payload Bundle protocol: a branch's whole
// byte closure — layers + decoration records + page bodies + images +
// chrome.css + tile-property images + any bees/deps — packaged as sig-named
// files so the recipient holds every byte and serves the site LOCALLY, with no
// dependency on the origin host being reachable. Web assets stay OUT of the
// layer; only the decoration sig rides the merkle tree. The same primitive
// transports any payload (pptx/xlsx/doc) the day it exists — the walk only ever
// sees "a sig and its closure of content-addressed blobs".
//
// Reimplemented in essentials (not the DCP app's PackageExportService, which is
// DCP-bound and reads the install cache, not the hive Store): the user's branch
// lives in the hive Store, reached here via IoC. All cross-service access is
// IoC-resolved at runtime — no static import of shared/web/dcp.
//
// EXPORT: walk the branch from the current node → collect the full layer +
// resource closure (decorationClosureSigs handles the HTML-body parse for
// legacy pages; a generic JSON nested-sig collect catches tile-property images
// and any other resource refs) → buildStoreZip → browser download.
//
// IMPORT: pick a .zip → readStoreZip → raw sha256-verify each sig-named entry
// (untrusted carried bytes) → land into the hive Store → fold the root into the
// hive at the current node via committer.importTree — the exact accept path
// swarm-adopt uses (including the tile-props-index seed, without which the
// substrate clobbers each imported image).

import { EffectBus, hypercomb, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { buildStoreZip, readStoreZip } from './store-zip.js'
import { decorationClosureSigs } from '../sharing/decoration-closure.js'
import {
  childLayerOf,
  childNamesOf,
  flattenLayerTree,
  resolveLayerAt,
  type PlacementHistory,
  type PlacementLayer,
} from '../history/layer-placement.js'
import { cellLocationSig, readTilePropsIndex, writeTilePropsIndex } from '../editor/tile-properties.js'

const STORE_KEY = '@hypercomb.social/Store'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const COMMITTER_KEY = '@diamondcoreprocessor.com/LayerCommitter'
const CURSOR_KEY = '@diamondcoreprocessor.com/HistoryCursorService'

const SIG_RE = /^[0-9a-f]{64}$/
const CHILD_SLOTS = new Set(['cells', 'layers', 'children'])
const ENTRY_RE = /^(__layers__|__bees__|__dependencies__|__resources__)\/([0-9a-f]{64})(?:\.js|\.json)?$/

// ── service shapes (resolved via IoC at runtime) ──────────────

interface StoreLike {
  opfsRoot?: FileSystemDirectoryHandle
  getLayerPoolBytes(signature: string): Promise<Uint8Array | null>
  writeLayerBytes(signature: string, bytes: ArrayBuffer): Promise<void>
  getResourceLocal(signature: string): Promise<Blob | null>
  putResource(blob: Blob, options?: { emit?: boolean }): Promise<string>
}
interface LineageLike {
  explorerSegments?: () => readonly string[]
  readonly domain?: unknown
}
interface CommitterLike {
  importTree(
    updates: { segments: readonly string[]; layer: { name?: string; [slot: string]: unknown } }[],
    nameSlots?: ReadonlySet<string>,
  ): Promise<unknown>
}
/** The history cursor — `state.rewound` is true while scrubbed back in time.
 *  committer.importTree no-ops in that state, so /website load must refuse. */
interface CursorLike { state?: { rewound?: boolean } }

function ioc<T>(key: string): T | undefined {
  return (window as unknown as { ioc?: { get?: <U>(k: string) => U | undefined } }).ioc?.get?.<T>(key)
}

function i18n(): I18nProvider | undefined { return ioc<I18nProvider>(I18N_IOC_KEY) }

function toast(type: 'success' | 'error' | 'warn' | 'info', title: string, message: string): void {
  try { EffectBus.emit('toast:show', { type, title, message }) } catch { /* noop */ }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const hash = await crypto.subtle.digest('SHA-256', buf)
  const view = new Uint8Array(hash)
  let hex = ''
  for (let i = 0; i < view.length; i++) hex += view[i].toString(16).padStart(2, '0')
  return hex
}

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

/** First non-whitespace byte, or -1. Used to cheaply tell a JSON resource
 *  (`{`/`[`) from a binary image or an HTML body without decoding the whole
 *  blob. */
function firstNonWsByte(bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i]
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) continue
    return c
  }
  return -1
}

/** Recursively harvest every 64-hex signature reachable inside a parsed JSON
 *  value — the generic resource-ref collector (tile-property `imageSig`,
 *  decoration `refs`/`htmlSig`, any nested sig). Mirrors content-broker's
 *  #collectSigs but over a fetched resource's content. */
function collectSigsDeep(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') {
    const s = value.toLowerCase()
    if (SIG_RE.test(s)) out.add(s)
    return
  }
  if (Array.isArray(value)) { for (const v of value) collectSigsDeep(v, out); return }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectSigsDeep(v, out)
  }
}

// ── EXPORT ────────────────────────────────────────────────────

export async function exportBranch(): Promise<void> {
  const store = ioc<StoreLike>(STORE_KEY)
  const history = ioc<PlacementHistory>(HISTORY_KEY)
  const lineage = ioc<LineageLike>(LINEAGE_KEY)
  if (!store?.getLayerPoolBytes || !history?.getLayerBySig || !lineage) {
    toast('error', i18n()?.t('website-archive.save-failed.title') ?? 'Save failed', i18n()?.t('website-archive.save-failed.message') ?? 'Core services unavailable'); return
  }

  const segs = (lineage.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  if (segs.length === 0) {
    // Refuse to archive the whole hive — /website save is branch-scoped.
    toast('warn', i18n()?.t('website-archive.pick-branch.title') ?? 'Pick a branch', i18n()?.t('website-archive.pick-branch.message') ?? 'Navigate into the website you want to save, then run /website save'); return
  }

  const name = segs[segs.length - 1]
  const parent = await resolveLayerAt(history, lineage.domain, segs.slice(0, -1))
  const root = await childLayerOf(history, parent, name)
  if (!root) { toast('warn', i18n()?.t('website-archive.pick-branch.title') ?? 'Nothing to save', i18n()?.t('website-archive.nothing-to-save', { name }) ?? `No branch named "${name}" at this location`); return }

  const files: { path: string; bytes: Uint8Array }[] = []
  const layers: string[] = [], resources: string[] = [], bees: string[] = [], deps: string[] = []
  const missing: string[] = []
  // Kind-scoped visited sets — a layer sig and a resource sig live in separate
  // pools, so a sig seen in one walk must never short-circuit the other (a SHA
  // collision across pools is infeasible, but the structural class is removed).
  const visitedLayers = new Set<string>()
  const visitedAssets = new Set<string>()
  const fetchHtml = (s: string): Promise<ArrayBuffer | null> =>
    store.getResourceLocal(s).then(b => (b ? b.arrayBuffer() : null))

  // Full recursive resource closure: the decoration body+images (HTML parse)
  // PLUS any nested sig refs in a JSON resource (tile-property images, etc.),
  // recursing into each so an arbitrarily-deep payload graph is carried whole.
  const walkResource = async (sig: string): Promise<void> => {
    if (visitedAssets.has(sig)) return
    visitedAssets.add(sig)
    const blob = await store.getResourceLocal(sig)
    if (!blob) { missing.push(sig); return }
    const bytes = new Uint8Array(await blob.arrayBuffer())
    files.push({ path: `__resources__/${sig}`, bytes })
    resources.push(sig)

    const children = new Set<string>()
    for (const s of await decorationClosureSigs(bytes, fetchHtml)) children.add(s)
    const c0 = firstNonWsByte(bytes)
    if (c0 === 0x7b /* { */ || c0 === 0x5b /* [ */) {
      try { collectSigsDeep(JSON.parse(decode(bytes)), children) } catch { /* not JSON — leaf */ }
    }
    for (const child of children) await walkResource(child)
  }

  const readBeeDep = async (dirName: string, sig: string): Promise<Uint8Array | null> => {
    const opfs = store.opfsRoot
    if (!opfs) return null
    try {
      const dir = await opfs.getDirectoryHandle(dirName, { create: false })
      for (const fname of [`${sig}.js`, sig]) {
        try {
          const h = await dir.getFileHandle(fname, { create: false })
          return new Uint8Array(await (await h.getFile()).arrayBuffer())
        } catch { /* try next filename shape */ }
      }
    } catch { /* dir absent */ }
    return null
  }

  const walkLayer = async (sig: string): Promise<void> => {
    if (visitedLayers.has(sig)) return
    visitedLayers.add(sig)
    const bytes = await store.getLayerPoolBytes(sig)
    if (!bytes) { missing.push(sig); return }
    files.push({ path: `__layers__/${sig}.json`, bytes })
    layers.push(sig)

    let layer: Record<string, unknown>
    try { layer = JSON.parse(decode(bytes)) as Record<string, unknown> } catch { return }
    for (const [slot, value] of Object.entries(layer)) {
      if (!Array.isArray(value)) continue
      for (const raw of value) {
        const ref = String(raw ?? '').trim().toLowerCase()
        if (!SIG_RE.test(ref)) continue
        if (CHILD_SLOTS.has(slot)) { await walkLayer(ref); continue }
        if (slot === 'bees') {
          if (visitedAssets.has(ref)) continue
          visitedAssets.add(ref)
          const b = await readBeeDep('__bees__', ref)
          if (b) { files.push({ path: `__bees__/${ref}.js`, bytes: b }); bees.push(ref) } else missing.push(ref)
          continue
        }
        if (slot === 'dependencies') {
          if (visitedAssets.has(ref)) continue
          visitedAssets.add(ref)
          const b = await readBeeDep('__dependencies__', ref)
          if (b) { files.push({ path: `__dependencies__/${ref}.js`, bytes: b }); deps.push(ref) } else missing.push(ref)
          continue
        }
        // every other slot (decorations, properties, notes, …) → resource closure
        await walkResource(ref)
      }
    }
  }

  await walkLayer(root.sig)

  const manifest = {
    version: 1,
    kind: 'hypercomb.payload-bundle',
    payload: 'website',
    rootSig: root.sig,
    name,
    segments: segs,           // provenance only — import folds at the importer's current node
    at: Date.now(),
    layers, resources, bees, dependencies: deps,
    missing,                  // sigs referenced but not held locally at export time
  }
  files.push({ path: 'manifest.json', bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) })

  if (missing.length) {
    toast('warn', i18n()?.t('website-archive.incomplete.title') ?? 'Incomplete archive', i18n()?.t('website-archive.incomplete.message', { count: missing.length }) ?? `${missing.length} asset(s) not held locally were skipped`)
  }

  const zip = buildStoreZip(files)
  downloadBlob(new Blob([zip as BlobPart], { type: 'application/zip' }), `${safeFileName(name)}-${root.sig.slice(0, 12)}.zip`)
  toast('success', i18n()?.t('website-archive.saved.title') ?? 'Website saved', i18n()?.t('website-archive.saved.message', { name, layers: layers.length, resources: resources.length, size: (zip.length / 1024).toFixed(0) }) ?? `${name} — ${layers.length} layers, ${resources.length} assets, ${(zip.length / 1024).toFixed(0)} KB`)
}

function safeFileName(s: string): string {
  return s.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'website'
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

// ── IMPORT ────────────────────────────────────────────────────

export async function importArchive(): Promise<void> {
  const buf = await pickZip()
  if (!buf) return

  let entries: { path: string; bytes: Uint8Array }[]
  try { entries = readStoreZip(new Uint8Array(buf)) }
  catch (err) { toast('error', i18n()?.t('website-archive.unreadable') ?? 'Unreadable archive', String((err as Error)?.message ?? err)); return }

  const manifestEntry = entries.find(e => e.path === 'manifest.json')
  if (!manifestEntry) { toast('error', i18n()?.t('website-archive.unreadable') ?? 'Not a website archive', i18n()?.t('website-archive.no-manifest') ?? 'No manifest.json inside the .zip'); return }
  let manifest: { rootSig?: string }
  try { manifest = JSON.parse(decode(manifestEntry.bytes)) as { rootSig?: string } }
  catch { toast('error', i18n()?.t('website-archive.unreadable') ?? 'Bad archive', i18n()?.t('website-archive.bad-json') ?? 'manifest.json is not valid JSON'); return }
  const rootSig = String(manifest.rootSig ?? '').toLowerCase()
  if (!SIG_RE.test(rootSig)) { toast('error', i18n()?.t('website-archive.unreadable') ?? 'Bad archive', i18n()?.t('website-archive.bad-root-sig') ?? 'manifest.rootSig is missing or invalid'); return }

  const store = ioc<StoreLike>(STORE_KEY)
  const history = ioc<PlacementHistory>(HISTORY_KEY)
  const committer = ioc<CommitterLike>(COMMITTER_KEY)
  const lineage = ioc<LineageLike>(LINEAGE_KEY)
  if (!store?.writeLayerBytes || !history?.getLayerBySig || !committer?.importTree || !lineage) {
    toast('error', i18n()?.t('website-archive.import-failed.title') ?? 'Import failed', i18n()?.t('website-archive.import-failed.message') ?? 'Core services unavailable'); return
  }

  // Refuse while the history cursor is rewound (scrubbed back): committer
  // .importTree no-ops in that state, so landing bytes + seeding the props
  // index would leave orphans while the fold silently did nothing and we
  // reported success. Decline up front, before any side effect — the same
  // up-front refuse the clipboard worker uses (#blockedByRewound).
  const cursor = ioc<CursorLike>(CURSOR_KEY)
  if (cursor?.state?.rewound) {
    toast('info', i18n()?.t('move.promote.rewound.title') ?? 'Viewing history', i18n()?.t('website-archive.rewound') ?? 'Return to the latest revision before importing a website'); return
  }

  // Resolve the fold destination + current siblings ONCE — stable across the
  // landing below (landing the archive's own layers never alters the existing
  // parent's children). Used for an early name pre-check (so we don't land
  // bytes we then can't fold) and again for the authoritative check after.
  const at = (lineage.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  const parent = await resolveLayerAt(history, lineage.domain, at)
  const existing = await childNamesOf(history, parent)
  const manifestName = String((manifest as { name?: unknown }).name ?? '').trim()
  if (manifestName && existing.includes(manifestName)) {
    toast('info', i18n()?.t('website-archive.already-here.title') ?? 'Already here', i18n()?.t('website-archive.already-here.message', { name: manifestName }) ?? `"${manifestName}" already exists at this location`); return
  }

  // PASS 1 — VERIFY every sig-named entry before landing ANY of them, so a
  // tampered archive lands nothing. Raw sha256 (carried bytes are untrusted;
  // a trust-store check would short-circuit pre-trusted sigs).
  const toLand: { dir: string; sig: string; bytes: Uint8Array }[] = []
  for (const e of entries) {
    if (e.path === 'manifest.json') continue
    const m = ENTRY_RE.exec(e.path)
    if (!m) continue
    if ((await sha256Hex(e.bytes)) !== m[2]) {
      toast('error', i18n()?.t('website-archive.tampered.title') ?? 'Tampered archive', i18n()?.t('website-archive.tampered.message', { path: e.path }) ?? `${e.path} failed signature verification — nothing imported`); return
    }
    toLand.push({ dir: m[1], sig: m[2], bytes: e.bytes })
  }

  // PASS 2 — LAND all verified entries. Layers land before the fold runs, so
  // flattenLayerTree resolves every child via getLayerPoolBytes.
  for (const { dir, sig, bytes } of toLand) {
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    if (dir === '__layers__') await store.writeLayerBytes(sig, ab)
    else if (dir === '__resources__') await store.putResource(new Blob([ab]), { emit: false })
    else if (dir === '__bees__') await writeBeeDep(store, '__bees__', sig, ab)
    else if (dir === '__dependencies__') await writeBeeDep(store, '__dependencies__', sig, ab)
  }

  // FOLD at the importer's current node — the swarm-adopt path, minus the
  // network adopt (bytes are already landed from the zip). The name is now read
  // authoritatively from the landed root layer (the pre-check used the manifest).
  const branchLayer = await history.getLayerBySig(rootSig)
  const name = (branchLayer && typeof branchLayer.name === 'string') ? branchLayer.name.trim() : ''
  // Name rides untrusted bytes — reject path separators / control chars.
  if (!branchLayer || !name || /[\\/\x00-\x1f]/.test(name)) {
    toast('error', i18n()?.t('website-archive.unreadable') ?? 'Bad archive', i18n()?.t('website-archive.bad-name') ?? 'Branch root has no usable name'); return
  }
  if (existing.includes(name)) {
    toast('info', i18n()?.t('website-archive.already-here.title') ?? 'Already here', i18n()?.t('website-archive.already-here.message', { name }) ?? `"${name}" already exists at this location`); return
  }

  const treeUpdates = await flattenLayerTree(history, branchLayer, [...at, name])

  // Seed the participant-local tile-props index from each node's `properties`
  // slot BEFORE importTree. show-cell render + substrate blank-detection read
  // ONLY this localStorage index; without the seed the imported tiles look
  // blank and the substrate clobbers each image with a random one. Fill-if-empty.
  try {
    const index = readTilePropsIndex()
    let seeded = false
    for (const u of treeUpdates) {
      const props = (u.layer as { properties?: unknown }).properties
      const propSig = Array.isArray(props) && typeof props[0] === 'string' ? props[0] : undefined
      if (!propSig || !SIG_RE.test(propSig)) continue
      const segs = u.segments
      if (segs.length === 0) continue
      const key = await cellLocationSig(segs.slice(0, -1), segs[segs.length - 1])
      if (!key || index[key]) continue
      index[key] = propSig
      seeded = true
    }
    if (seeded) writeTilePropsIndex(index)
  } catch (err) { console.warn('[website-archive] props-index seed skipped', err) }

  await committer.importTree([
    { segments: at, layer: { ...((parent ?? {}) as PlacementLayer), children: [...existing, name] } },
    ...treeUpdates,
  ])
  EffectBus.emit('fs:changed', { segments: at })
  await new hypercomb().act()
  toast('success', i18n()?.t('website-archive.imported.title') ?? 'Website imported', i18n()?.t('website-archive.imported.message', { name, count: toLand.length }) ?? `${name} — ${toLand.length} files, open it to view`)
}

function pickZip(): Promise<ArrayBuffer | null> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.zip,application/zip'
    input.style.display = 'none'
    // settle-once guard: onchange and oncancel can both be plausible; whichever
    // fires first wins, and the input is always cleaned up (no orphan node, no
    // dangling Promise when the user dismisses the dialog).
    let settled = false
    const settle = (value: ArrayBuffer | null): void => {
      if (settled) return
      settled = true
      input.remove()
      resolve(value)
    }
    input.onchange = async () => {
      const f = input.files?.[0]
      settle(f ? await f.arrayBuffer() : null)
    }
    input.oncancel = () => settle(null)
    document.body.appendChild(input)
    input.click()
  })
}

async function writeBeeDep(store: StoreLike, dirName: string, sig: string, ab: ArrayBuffer): Promise<void> {
  const opfs = store.opfsRoot
  if (!opfs) return
  try {
    const dir = await opfs.getDirectoryHandle(dirName, { create: true })
    const h = await dir.getFileHandle(`${sig}.js`, { create: true })
    const w = await h.createWritable()
    try { await w.write(ab) } finally { await w.close() }
  } catch { /* best-effort */ }
}

// No QueenBee here any more — `exportBranch` / `importArchive` are invoked as
// the `save` / `load` subcommands of WebsiteQueenBee (website.queen.ts), so
// they no longer register as top-level `/website-save` / `/website-load`
// commands that crowd the `/website` autocomplete.
