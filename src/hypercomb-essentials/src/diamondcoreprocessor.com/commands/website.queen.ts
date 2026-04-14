// diamondcoreprocessor.com/commands/website.queen.ts
//
// Design-time authoring and stamping for embedded sites.
//
// Syntax (positional; optional target + optional payload):
//
//   /website                         — export CURRENT subtree
//   /website clear                   — clear websiteSig on current cell
//   /website <sig>                   — stamp <sig> onto current cell
//   /website [sig1][sig2]…           — build bundle by concatenating sigs,
//                                      stamp resulting sig onto current cell
//
//   /website <name-or-path>          — export that subtree
//   /website <name-or-path> <sig>    — stamp <sig> onto that cell
//   /website <name-or-path> [sigs…]  — build + stamp onto that cell
//   /website <name-or-path> clear    — clear websiteSig on that cell
//
// <name-or-path> is one of:
//   - a registered branch name (from /branch)
//   - a lineage path (contains `/` or starts with `/`)
//
// Autocomplete offers branch names from NameRegistry, plus the operator
// shortcuts (clear, list).

import { QueenBee, EffectBus } from '@hypercomb/core'
import { CELL_WEBSITE_PROPERTY } from '@hypercomb/core'
import {
  readCellProperties,
  writeCellProperties,
  isSignature,
} from '../editor/tile-properties.js'

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
  | { kind: 'clear'; target: string | null }
  | { kind: 'stamp'; target: string | null; sigs: readonly string[] }
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
    if (tok.toLowerCase() === 'clear' || tok.toLowerCase() === 'remove') {
      return { kind: 'clear', target: null }
    }
    if (isSignature(tok)) return { kind: 'stamp', target: null, sigs: [tok.toLowerCase()] }
    const bracketed = extractBracketedSigs(tok)
    if (bracketed.length) return { kind: 'stamp', target: null, sigs: bracketed }
    // Otherwise treat as target → export
    return { kind: 'export', target: tok }
  }

  // Two+ tokens: first is target, rest is op/payload.
  const target = tokens[0]
  const rest = tokens.slice(1).join(' ')

  if (rest.toLowerCase() === 'clear' || rest.toLowerCase() === 'remove') {
    return { kind: 'clear', target }
  }
  if (isSignature(rest)) return { kind: 'stamp', target, sigs: [rest.toLowerCase()] }
  const bracketed = extractBracketedSigs(rest)
  if (bracketed.length) return { kind: 'stamp', target, sigs: bracketed }

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
  await walk(target.dir, [], nodes)

  const rootProps: Record<string, unknown> = await readCellProperties(target.dir).catch(() => ({} as Record<string, unknown>))
  const current = rootProps[CELL_WEBSITE_PROPERTY]
  const currentWebsiteSig = isSignature(current) ? (current as string) : undefined

  return { rootPath: target.path, currentWebsiteSig, nodes }
}

async function walk(
  dir: FileSystemDirectoryHandle,
  path: readonly string[],
  out: HierarchyNode[]
): Promise<void> {
  const props: Record<string, unknown> = await readCellProperties(dir).catch(() => ({} as Record<string, unknown>))
  const node: HierarchyNode = { path }
  const sig = props[CELL_WEBSITE_PROPERTY]
  if (isSignature(sig)) node.websiteSig = sig as string
  const label = props['label'] ?? props['title']
  if (typeof label === 'string' && label.trim()) node.label = label
  out.push(node)

  const children: string[] = []
  try {
    // @ts-ignore async-iterable
    for await (const [name, entry] of (dir as any).entries()) {
      if ((entry as any).kind === 'directory' && !name.startsWith('_')) children.push(name as string)
    }
  } catch { /* noop */ }
  children.sort()

  for (const name of children) {
    try {
      const childDir = await dir.getDirectoryHandle(name)
      await walk(childDir, [...path, name], out)
    } catch { /* noop */ }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Bundle construction from bracketed sig lists
// ──────────────────────────────────────────────────────────────────────────

async function sigsToBundleSig(sigs: readonly string[]): Promise<string | null> {
  const store = get('@hypercomb.social/Store') as any
  if (!store?.putResource) return null
  const bundleText = sigs.map(s => s.toLowerCase()).join('')
  const blob = new Blob([bundleText], { type: 'text/plain' })
  return await store.putResource(blob)
}

// ──────────────────────────────────────────────────────────────────────────
// Queen
// ──────────────────────────────────────────────────────────────────────────

export class WebsiteQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'website'
  override readonly aliases = []
  override description =
    'Export a subtree, stamp a bundleSig, or build a bundle from a list of sigs. Targets current cell or a named branch / lineage path.'
  override descriptionKey = 'slash.website'

  override slashComplete(args: string): readonly string[] {
    const registry = get('@hypercomb.social/NameRegistry') as any
    const names: string[] = registry?.names ?? []

    const tokens = args.split(/\s+/)
    const head = (tokens[0] ?? '').toLowerCase()

    if (tokens.length <= 1) {
      const matches = names.filter(n => n.toLowerCase().startsWith(head))
      const fixed = ['(export current)', '<64-hex sig>', '[sig][sig]…', 'clear', 'list']
        .filter(s => !head || s.toLowerCase().startsWith(head))
      return [...new Set([...matches, ...fixed])]
    }

    // Second token — after a target — suggest operators
    const second = (tokens[1] ?? '').toLowerCase()
    const ops = ['<64-hex sig>', '[sig][sig]…', 'clear']
    if (!second) return ops
    return ops.filter(o => o.toLowerCase().startsWith(second))
  }

  protected execute(args: string): void {
    const parsed = parseArgs(args)

    switch (parsed.kind) {
      case 'list': return void this.#list()
      case 'error': console.warn(`[/website] ${parsed.message}`); return
      case 'export': return void this.#export(parsed.target)
      case 'clear':  return void this.#clear(parsed.target)
      case 'stamp':  return void this.#stamp(parsed.target, parsed.sigs)
    }
  }

  async #export(targetSpec: string | null): Promise<void> {
    // Special case: if the lone arg resolves to a signature-typed branch,
    // reinterpret as a stamp on CURRENT cell.
    if (targetSpec !== null) {
      const sig = resolveSignatureFromName(targetSpec)
      if (sig) return this.#stamp(null, [sig])
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

  async #stamp(targetSpec: string | null, sigs: readonly string[]): Promise<void> {
    if (sigs.length === 0) { console.warn('[/website] no signatures to stamp'); return }

    const target = await resolveTarget(targetSpec)
    if (!target) {
      console.warn(`[/website] could not resolve target: ${targetSpec ?? '(current)'}`)
      return
    }

    let finalSig: string
    if (sigs.length === 1) {
      finalSig = sigs[0]
    } else {
      const constructed = await sigsToBundleSig(sigs)
      if (!constructed) { console.warn('[/website] could not build bundle resource'); return }
      finalSig = constructed
      console.log(`[/website] built bundle from ${sigs.length} sigs → ${finalSig}`)
    }

    await writeCellProperties(target.dir, { [CELL_WEBSITE_PROPERTY]: finalSig })
    console.log(`[/website] ${CELL_WEBSITE_PROPERTY}=${finalSig} on ${target.label}`)
    toast('success', 'Website stamped', `${target.label} → ${finalSig.slice(0, 12)}…`)

    const lineage = get('@hypercomb.social/Lineage') as any
    lineage?.dispatchEvent?.(new CustomEvent('change'))
  }

  async #clear(targetSpec: string | null): Promise<void> {
    const target = await resolveTarget(targetSpec)
    if (!target) return

    const props: Record<string, unknown> = await readCellProperties(target.dir).catch(() => ({} as Record<string, unknown>))
    if (!(CELL_WEBSITE_PROPERTY in props)) return
    delete props[CELL_WEBSITE_PROPERTY]
    const file = await target.dir.getFileHandle('0000', { create: true })
    const writable = await file.createWritable()
    await writable.write(JSON.stringify(props))
    await writable.close()

    console.log(`[/website] cleared ${CELL_WEBSITE_PROPERTY} on ${target.label}`)
    toast('info', 'Website cleared', target.label)
    const lineage = get('@hypercomb.social/Lineage') as any
    lineage?.dispatchEvent?.(new CustomEvent('change'))
  }

  async #list(): Promise<void> {
    const registry = get('@hypercomb.social/NameRegistry') as any
    if (!registry?.ensureLoaded) { console.warn('[/website] registry not ready'); return }
    await registry.ensureLoaded()
    const all = registry.all as Record<string, any>
    const names = Object.keys(all).sort()
    console.log(`[/website] ${names.length} branch${names.length === 1 ? '' : 'es'}:`)
    for (const name of names) {
      const entry = all[name]
      if (entry?.target?.kind === 'lineage') {
        console.log(`  ${name} → /${(entry.target.path ?? []).join('/')}`)
      } else if (entry?.target?.kind === 'signature') {
        console.log(`  ${name} → signature ${entry.target.signature}`)
      }
    }
  }
}

const _website = new WebsiteQueenBee()
window.ioc.register('@diamondcoreprocessor.com/WebsiteQueenBee', _website)
