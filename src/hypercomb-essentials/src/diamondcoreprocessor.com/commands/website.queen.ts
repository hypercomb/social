// diamondcoreprocessor.com/commands/website.queen.ts
//
// View-mode toggling, subtree export, and Claude codegen triggers for
// embedded sites. Pages live in each cell's `context` slot; this queen
// no longer stamps `websiteSig` decorations or builds bundles — the
// renderer (site-view.drone) reads `context` directly.
//
// The website render surface is a SINGLE GLOBAL flag (ViewModeService) —
// `/website on` turns it on everywhere there's a page, `/website off` turns
// it off, bare `/website` toggles. There is no per-branch render marker.
// `/website here` is a different thing entirely: it drops a build-intent
// marker on the current cell (a `visual:website:pending` decoration) for the
// NEXT gen pass / build skill to turn into a page. Independent, signature-
// addressed, undoable — it never flips the render surface.
//
// Syntax:
//
//   /website                         — toggle hexagons ↔ website view (global)
//   /website on | web | site | view  — switch to website view (global)
//   /website off | hex | hexagons    — switch to hexagons view (global)
//   /website here | mark             — flag THIS cell for the next gen pass
//                                      (drops a visual:website:pending
//                                      decoration; re-run to unflag)
//   /website save                    — export the current branch as a portable
//                                      .zip (Payload Bundle) you can carry
//   /website load                    — import a website .zip into your hive
//   /website export                  — dump current subtree as JSON
//                                      (copies to clipboard for Claude
//                                      Code's /website skill)
//   /website <name-or-path>          — export that subtree as JSON
//   /website upgrade [* | <name>]    — emit website:build (mode=upgrade)
//   /website new | build             — emit website:build (mode=new)
//   /website list                    — the gen queue: cells flagged with
//                                      /website here; clear one by × on its line
//
// <name-or-path> is one of:
//   - a registered branch name (from /branch)
//   - a lineage path (contains `/` or starts with `/`)
//
// Bundle stamping (`/website <sig>`, `/website [sig][sig]…`, `/website
// clear`) was removed alongside the bundle path in site-view; the
// errors in #parseArgs surface the removal if older muscle memory
// invokes them.
//
// `CELL_WEBSITE_PROPERTY` still imported solely for the read side of
// `snapshot()` — existing user data with vestigial `websiteSig`
// values surfaces in the export JSON for archaeology.

import { QueenBee, EffectBus } from '@hypercomb/core'
import { CELL_WEBSITE_PROPERTY } from '@hypercomb/core'
import {
  readTilePropertiesAt,
  isSignature,
} from '../editor/tile-properties.js'
import type { VisualBeeRegistry } from './visual-bee-registry.js'
import { showWebsiteListPanel } from './website-instances.js'
// `/website save` / `/website load` — portable .zip export/import of a branch,
// folded in from the former standalone /website-save and /website-load commands
// so they no longer crowd the /website autocomplete.
import { exportBranch, importArchive } from './website-archive.queen.js'
// `/website here` writes a build-intent marker as a decoration on the
// current cell, and toggles it off on re-run. The named imports also anchor
// the decoration-manifest module (slot registration) against tree-shaking.
import { writeDecoration, listDecorations, removeDecoration } from './decoration-manifest.js'
// Side-effect imports: ensure foundational modules load at startup.
// Some bundler configurations drop modules whose value exports aren't
// directly imported elsewhere; the explicit imports here anchor them
// against tree-shaking.
//
//   - decoration-kind-index: maintains in-memory cell-label → kind
//     index for visibleWhen lookups
//   - visual-bee-icons: syncs visual-bee declarations to
//     IconProviderRegistry; dispatches clicks to the bee's queen
import './decoration-kind-index.js'
import './visual-bee-icons.js'

/**
 * Build-intent marker kind. `/website here` drops a decoration of this kind
 * on the current cell; the next gen pass / `website-build` skill reads them
 * as the authoritative queue of cells to turn into pages, then replaces each
 * with a `visual:website:page` decoration once generated. Distinct from the
 * page kind so SiteViewDrone (which mounts `visual:website:page` + htmlSig)
 * and ViewBee's presence check never confuse a request for a built page.
 */
export const WEBSITE_PENDING_KIND = 'visual:website:pending'

// View-mode toggle constants. These are the args /website accepts as
// "I want to switch rendering surface" instead of "stamp / export."
const HEXAGON_KEYWORDS = new Set(['hex', 'hexagons', 'hexagon', 'off'])
const WEBSITE_KEYWORDS = new Set(['web', 'site', 'page', 'on', 'view'])
const VIEW_TOGGLE_KEYWORDS = new Set([...HEXAGON_KEYWORDS, ...WEBSITE_KEYWORDS])

type LayerLike = { name?: string; children?: readonly string[]; [k: string]: unknown }

type HistoryServiceLike = {
  currentLayerAt(locationSig: string): Promise<LayerLike | null>
  getLayerBySig(sig: string): Promise<LayerLike | null>
  sign(lineage: { explorerSegments?: () => readonly string[] }): Promise<string>
}

const SIG_REGEX = /^[a-f0-9]{64}$/

const toast = (type: 'info' | 'success' | 'warning' | 'tip', title: string, message: string): void => {
  try { EffectBus.emit('toast:show', { type, title, message }) } catch { /* noop */ }
}

type HierarchyNode = {
  path: readonly string[]
  label?: string
  websiteSig?: string
}

type HierarchyExport = {
  rootPath: readonly string[]
  currentWebsiteSig?: string
  nodes: readonly HierarchyNode[]
}

// ──────────────────────────────────────────────────────────────────────────
// Parsing
// ──────────────────────────────────────────────────────────────────────────

const BRACKET_SIGS_RE = /\[([0-9a-f]{64})\]/gi

/**
 * Parse args into { target, op, payload } where:
 *   target  — name to resolve OR null (current cell)
 *   op      — 'export' | 'stamp' | 'clear'
 *   payload — for 'stamp': single sig, or array of sigs to bundle
 */
type Parsed =
  | { kind: 'export'; target: string | null }
  | { kind: 'list' }
  | { kind: 'error'; message: string }

function parseArgs(raw: string): Parsed {
  const trimmed = raw.trim()
  if (!trimmed) return { kind: 'export', target: null }
  if (trimmed.toLowerCase() === 'list') return { kind: 'list' }

  // Single token shortcuts on current cell.
  const tokens = splitTopLevel(trimmed)
  if (tokens.length === 1) {
    const tok = tokens[0]
    // The bundle-stamping ops (`clear`, `<sig>`, `[sig][sig]…`) are
    // gone — site rendering is per-cell `context` slot, no
    // `websiteSig` decoration to stamp or clear.
    if (tok.toLowerCase() === 'clear' || tok.toLowerCase() === 'remove') {
      return { kind: 'error', message: `clear/remove no longer applies — the bundle path was removed; per-cell pages are managed in the cell's context slot` }
    }
    if (isSignature(tok)) {
      return { kind: 'error', message: `stamping a websiteSig is no longer supported; pages live on each cell's context slot` }
    }
    const bracketed = extractBracketedSigs(tok)
    if (bracketed.length) {
      return { kind: 'error', message: `bundle assembly is no longer supported; per-cell pages don't use bundles` }
    }
    // Otherwise treat as target → export
    return { kind: 'export', target: tok }
  }

  // Two+ tokens: first is target, rest is op. Bundle ops are rejected
  // for the same reason as above; only `<target> export` (implicit) is
  // honored.
  const target = tokens[0]
  const rest = tokens.slice(1).join(' ')

  if (rest.toLowerCase() === 'clear' || rest.toLowerCase() === 'remove') {
    return { kind: 'error', message: `clear/remove no longer applies — the bundle path was removed` }
  }
  if (isSignature(rest)) {
    return { kind: 'error', message: `stamping a websiteSig on "${target}" is no longer supported` }
  }
  const bracketed = extractBracketedSigs(rest)
  if (bracketed.length) {
    return { kind: 'error', message: `bundle assembly for "${target}" is no longer supported` }
  }

  return { kind: 'error', message: `could not parse "${rest.slice(0, 40)}"` }
}

function splitTopLevel(s: string): string[] {
  // Respect bracketed groups so `[sig][sig]` stays as one token.
  const out: string[] = []
  let cur = ''
  let inBracket = 0
  for (const ch of s) {
    if (ch === '[') inBracket++
    else if (ch === ']') inBracket = Math.max(0, inBracket - 1)
    if (!inBracket && /\s/.test(ch)) {
      if (cur) { out.push(cur); cur = '' }
      continue
    }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}

function extractBracketedSigs(s: string): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  const re = new RegExp(BRACKET_SIGS_RE.source, 'gi')
  while ((m = re.exec(s)) !== null) out.push(m[1].toLowerCase())
  return out
}

// ──────────────────────────────────────────────────────────────────────────
// Target resolution
// ──────────────────────────────────────────────────────────────────────────

type Target = {
  dir: FileSystemDirectoryHandle
  path: readonly string[]
  label: string
}

async function resolveTarget(spec: string | null): Promise<Target | null> {
  const lineage = get('@hypercomb.social/Lineage') as any
  const store = get('@hypercomb.social/Store') as any
  if (!lineage || !store?.hypercombRoot) return null

  if (spec === null) {
    const dir = await lineage.explorerDir?.()
    if (!dir) return null
    return {
      dir,
      path: [...(lineage.explorerSegments?.() ?? [])],
      label: lineage.explorerLabel?.() ?? '/',
    }
  }

  // 1. branch name?
  const registry = get('@hypercomb.social/NameRegistry') as any
  if (registry?.ensureLoaded) await registry.ensureLoaded()
  const entry = registry?.get?.(spec)
  if (entry?.target?.kind === 'lineage') {
    return resolvePath(lineage, store, entry.target.path)
  }
  if (entry?.target?.kind === 'signature') {
    // A signature-typed name cannot be a STAMPING target — only used as
    // the payload. When passed alone (/website <sigName>), the stamp form
    // should fire instead. The caller handles this case.
    return null
  }

  // 2. lineage path
  const parts = spec.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  if (parts.length > 0) return resolvePath(lineage, store, parts)

  return null
}

async function resolvePath(lineage: any, store: any, path: readonly string[]): Promise<Target | null> {
  const dir = await lineage.tryResolve?.(path, store.hypercombRoot)
  if (!dir) return null
  return { dir, path, label: '/' + path.join('/') }
}

/**
 * If `spec` is a signature-typed name, return its signature. Otherwise null.
 * Lets `/website <sigName>` work as a stamp form.
 */
function resolveSignatureFromName(spec: string | null): string | null {
  if (!spec) return null
  const registry = get('@hypercomb.social/NameRegistry') as any
  const entry = registry?.get?.(spec)
  if (entry?.target?.kind === 'signature') return entry.target.signature
  return null
}

// ──────────────────────────────────────────────────────────────────────────
// Snapshot (export)
// ──────────────────────────────────────────────────────────────────────────

async function snapshot(target: Target): Promise<HierarchyExport> {
  const nodes: HierarchyNode[] = []
  // Root node — its properties live on its own layer; the path is
  // segments to the target, so the parent-of-root is everything except
  // the last segment (or empty list for the hypercomb root).
  const history = get<HistoryServiceLike>('@diamondcoreprocessor.com/HistoryService')
  if (!history) return { rootPath: target.path, currentWebsiteSig: undefined, nodes }

  await walkLayer(history, target.path, nodes)

  // Root websiteSig — for the snapshot root, read its props from the layer.
  let currentWebsiteSig: string | undefined
  if (target.path.length > 0) {
    const parent = target.path.slice(0, -1)
    const leaf = target.path[target.path.length - 1]
    const rootProps = await readTilePropertiesAt(parent, leaf).catch(() => ({} as Record<string, unknown>))
    const current = rootProps[CELL_WEBSITE_PROPERTY]
    if (isSignature(current)) currentWebsiteSig = current as string
  }
  return { rootPath: target.path, currentWebsiteSig, nodes }
}

async function walkLayer(
  history: HistoryServiceLike,
  path: readonly string[],
  out: HierarchyNode[],
): Promise<void> {
  // Build this node's HierarchyNode. Properties + websiteSig come from
  // the tile's own layer via readTilePropertiesAt. The root entry
  // (path = []) has no parent; skip the per-tile properties read for it.
  const node: HierarchyNode = { path }
  if (path.length > 0) {
    const parent = path.slice(0, -1)
    const leaf = path[path.length - 1]
    const props = await readTilePropertiesAt(parent, leaf).catch(() => ({} as Record<string, unknown>))
    const sig = props[CELL_WEBSITE_PROPERTY]
    if (isSignature(sig)) node.websiteSig = sig as string
    const label = props['label'] ?? props['title']
    if (typeof label === 'string' && label.trim()) node.label = label
  }
  out.push(node)

  // Descend via the layer's `children` slot — the only legitimate
  // source of hierarchy. Each entry is either a sig (descend via
  // getLayerBySig) or a name string (descend by name).
  const locSig = await history.sign({ explorerSegments: () => path })
  const layer = await history.currentLayerAt(locSig)
  const rawChildren = Array.isArray(layer?.children) ? layer!.children : []

  const childNames: string[] = []
  for (const entry of rawChildren) {
    const s = String(entry ?? '').trim()
    if (!s) continue
    if (SIG_REGEX.test(s)) {
      const child = await history.getLayerBySig(s).catch(() => null)
      if (child?.name) childNames.push(String(child.name))
    } else {
      childNames.push(s)
    }
  }
  childNames.sort()

  for (const name of childNames) {
    await walkLayer(history, [...path, name], out)
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Queen
// ──────────────────────────────────────────────────────────────────────────

export class WebsiteQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'website'
  override readonly aliases = []
  override description =
    'Toggle the website view, export the current subtree as JSON, or trigger a Claude codegen build. Bundle stamping was removed; per-cell pages live on each cell\'s `context` slot.'
  override descriptionKey = 'slash.website'
  override options = ['on', 'off', 'here', 'save', 'load', 'export', '<name-or-path>', 'upgrade', 'upgrade *', 'upgrade <name>', 'new', 'build', 'list']
  override examples = [
    { input: '/website', result: 'Toggles the website view globally' },
    { input: '/website here', result: 'Flags this cell for the next gen pass' },
  ]

  override slashComplete(args: string): readonly string[] {
    const registry = get('@hypercomb.social/NameRegistry') as any
    const names: string[] = registry?.names ?? []

    const tokens = args.split(/\s+/)
    const head = (tokens[0] ?? '').toLowerCase()

    if (tokens.length <= 1) {
      const matches = names.filter(n => n.toLowerCase().startsWith(head))
      // Bundle ops (`<sig>`, `[sig][sig]…`, `clear`) removed.
      const fixed = ['(toggle view)', 'here', 'save', 'load', 'export', 'upgrade', 'new', 'build', 'list']
        .filter(s => !head || s.toLowerCase().startsWith(head))
      return [...new Set([...matches, ...fixed])]
    }

    // Second-token completions for the bundle ops (`<sig>`,
    // `[sig][sig]…`, `clear`) were dropped along with the bundle
    // path. After a target, there's nothing meaningful to complete —
    // export is implicit when the target stands alone.
    return []
  }

  protected execute(args: string): void {
    const trimmed = args.trim().toLowerCase()

    // `/website here` — flag THIS cell for the next gen pass. Drops a
    // `visual:website:pending` build-intent decoration on the current cell
    // (re-run clears it). This is NOT a render-surface action; it never
    // touches ViewMode. The build skill reads these markers as its queue.
    if (trimmed === 'here' || trimmed === 'mark') {
      return void this.#markHere()
    }

    // `/website save` / `/website load` — portable .zip export/import of the
    // current branch (Payload Bundle protocol). Delegated to the archive
    // module; folded in from the old standalone /website-save & /website-load.
    if (trimmed === 'save') return void exportBranch()
    if (trimmed === 'load') return void importArchive()

    // Global view apply. /website with no arg, or with one of the mode
    // keywords, flips the SINGLE GLOBAL render surface (ViewModeService).
    // Routed through the same `view:toggle` event the command-line icon
    // uses so command and icon stay in sync; ViewBee flips ViewMode directly
    // (no marker, nothing reverts it).
    //   no arg            → toggle hexagons ⇄ website
    //   on/web/site/page  → force website on
    //   off/hex/hexagons  → force website off
    if (!trimmed || VIEW_TOGGLE_KEYWORDS.has(trimmed)) {
      const mode: 'on' | 'off' | 'toggle' =
        !trimmed ? 'toggle' : HEXAGON_KEYWORDS.has(trimmed) ? 'off' : 'on'
      EffectBus.emit('view:toggle', { view: 'website', mode })
      console.log(`[/website] global view → website (${mode})`)
      return
    }

    if (trimmed === 'export') {
      return void this.#export(null)
    }

    // Upgrade pipeline trigger. /website upgrade emits a build event the
    // bridge worker forwards to Claude with [skeleton, notes, prior code]
    // as context. Returned ops cascade through the normal merkle update
    // path. Three forms:
    //   /website upgrade        — current lineage outward to leaves
    //   /website upgrade *      — whole tree from root
    //   /website upgrade <name> — named branch (resolved via NameRegistry)
    if (trimmed === 'upgrade' || trimmed.startsWith('upgrade ') || trimmed.startsWith('upgrade\t')) {
      const rest = trimmed === 'upgrade' ? '' : trimmed.slice('upgrade'.length).trim()
      const lineage = get('@hypercomb.social/Lineage') as { explorerSegments?: () => readonly string[] } | undefined
      const currentSegments = (lineage?.explorerSegments?.() ?? [])
        .map(s => String(s ?? '').trim()).filter(Boolean)

      let scope: 'root' | 'subtree' | 'named'
      let scopeSegments: readonly string[]
      let scopeName: string | null = null

      if (rest === '*' || rest === '/' || rest === 'root' || rest === 'all') {
        scope = 'root'
        scopeSegments = []
      } else if (rest) {
        scope = 'named'
        scopeName = rest
        scopeSegments = currentSegments
      } else {
        scope = 'subtree'
        scopeSegments = currentSegments
      }

      EffectBus.emit('website:build', {
        mode: 'upgrade',
        scope,
        scopeName,
        scopeSegments: [...scopeSegments],
        priorRootMarker: localStorage.getItem('hc:website:last-root-sig') ?? null,
      })

      console.log(`[/website upgrade] emitted website:build scope=${scope}` +
        (scopeName ? ` name=${scopeName}` : '') +
        (scopeSegments.length ? ` lineage=${scopeSegments.join('/')}` : ' lineage=(root)'))

      toast('info', 'website upgrade', `queued ${scope}${scopeName ? `: ${scopeName}` : ''}`)
      return
    }

    // /website new — explicit greenfield build (no prior code in context).
    if (trimmed === 'new' || trimmed === 'build') {
      const lineage = get('@hypercomb.social/Lineage') as { explorerSegments?: () => readonly string[] } | undefined
      const currentSegments = (lineage?.explorerSegments?.() ?? [])
        .map(s => String(s ?? '').trim()).filter(Boolean)
      EffectBus.emit('website:build', {
        mode: 'new',
        scope: currentSegments.length === 0 ? 'root' : 'subtree',
        scopeSegments: [...currentSegments],
        priorRootMarker: null,
      })
      console.log(`[/website ${trimmed}] emitted website:build mode=new lineage=${currentSegments.join('/') || '(root)'}`)
      toast('info', 'website build', 'queued — bridge worker will pick up')
      return
    }

    const parsed = parseArgs(args)

    switch (parsed.kind) {
      case 'list': return void this.#list()
      case 'error': console.warn(`[/website] ${parsed.message}`); return
      case 'export': return void this.#export(parsed.target)
    }
  }

  async #export(targetSpec: string | null): Promise<void> {
    // Special case: if the lone arg resolves to a signature-typed branch,
    // reinterpret as a stamp on CURRENT cell.
    // Note: bundle stamping was removed (see class header) — this branch
    // is unreachable per #execute's gating, kept here as a no-op so the
    // method's TypeScript narrowing stays unchanged.
    if (targetSpec !== null) {
      const sig = resolveSignatureFromName(targetSpec)
      if (sig) return
    }

    const target = await resolveTarget(targetSpec)
    if (!target) {
      console.warn(`[/website] could not resolve target: ${targetSpec ?? '(current)'}`)
      return
    }

    const spec = await snapshot(target)
    const json = JSON.stringify(spec, null, 2)
    console.log(`[/website] hierarchy export from ${target.label}:`)
    console.log(json)

    try {
      await navigator.clipboard.writeText(json)
      console.log(`[/website] copied ${json.length} bytes to clipboard — paste into Claude Code /website skill`)
      toast('success', 'Website exported',
        `${spec.nodes.length} node${spec.nodes.length === 1 ? '' : 's'} from ${target.label} — ${json.length} bytes on clipboard`)
    } catch (err) {
      console.warn('[/website] clipboard write failed — copy from console:', err)
      toast('warning', 'Export copy failed',
        'Clipboard write blocked — copy the JSON from the browser console')
    }
  }

  /**
   * `/website here` — flag the current cell for the next gen pass by writing
   * a `visual:website:pending` decoration on its own `decorations` slot. The
   * marker is an independent, signature-addressed, undoable resource on the
   * cell's layer (no central map, no cross-cell dependency) — exactly the
   * shape the build skill reads as its queue. Idempotent and reversible: if
   * the cell is already flagged, re-running `/website here` clears it.
   */
  async #markHere(): Promise<void> {
    const lineage = get('@hypercomb.social/Lineage') as { explorerSegments?: () => readonly string[] } | undefined
    const segments = (lineage?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)
    const where = segments.length ? `/${segments.join('/')}` : '/'

    try {
      // Already flagged here? Re-running is the off-switch — drop the marker.
      const existing = await listDecorations({ kind: WEBSITE_PENDING_KIND, segments })
      if (existing.length) {
        for (const e of existing) removeDecoration({ sig: e.sig, segments })
        console.log(`[/website here] unflagged ${where} (${existing.length} marker${existing.length === 1 ? '' : 's'} cleared)`)
        toast('info', 'website', `${where} removed from the next gen pass`)
        return
      }

      await writeDecoration({
        kind: WEBSITE_PENDING_KIND,
        appliesTo: segments,
        segments,
        payload: { requestedAt: Date.now() },
        mark: 'persistent',
      })
      console.log(`[/website here] flagged ${where} for the next /website build`)
      toast('success', 'website', `${where} flagged — run /website build (or the website skill) to generate its page`)
    } catch (err) {
      console.warn('[/website here] failed', err)
      toast('warning', 'website', 'could not flag this cell — see console')
    }
  }

  /** Open the gen-queue panel: the cells flagged with `/website here`
   *  (carrying a `visual:website:pending` decoration), each clearable via its
   *  × button and navigable by clicking its path. */
  #list(): void {
    void showWebsiteListPanel()
  }
}

const _website = new WebsiteQueenBee()
window.ioc.register('@diamondcoreprocessor.com/WebsiteQueenBee', _website)

// Visual-bee registration. Declares the view identity, decoration kind,
// and adoption icon name so the renderer + adoption UI can discover the
// website bee. Decoration writes (to the resource store — root sig files —
// + the cell's `decorations` slot) are still handled by the bridge worker /
// build drone via the helpers in decoration-manifest.ts — this registration
// is just the declaration. Adoption icons surface for any tile whose
// peer manifest contains entries matching this decorationKind.
;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<VisualBeeRegistry>(
  '@diamondcoreprocessor.com/VisualBeeRegistry',
  (registry) => {
    registry.register({
      view: 'website',
      slashCommand: '/website',
      iconName: 'website',
      toggleIcon: 'web',
      // Per-node toggle ON: standing on any page-bearing cell (root or
      // sub-page) surfaces this site's own glyph, so "go to the tile, click
      // the website" enters the site right there. The launcher aggregator
      // still opens sites from their ROOTS; this is the child-page entrance
      // the launcher can't provide.
      decorationKind: 'visual:website:page',
      labelKey: 'view.website',
      descriptionKey: 'view.website.description',
      queenKey: '@diamondcoreprocessor.com/WebsiteQueenBee',
      adoptable: true,
      // A website IS its subtree — each page is a child cell carrying its own
      // page in its `website` slot. Adopting the site must bring the page-tiles,
      // not just the host cell's slot. See VisualBeeDescriptor.adoptScope.
      adoptScope: 'hierarchy',
    })
  },
)
