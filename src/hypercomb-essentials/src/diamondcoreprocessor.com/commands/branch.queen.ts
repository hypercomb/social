// diamondcoreprocessor.com/commands/branch.queen.ts
//
// Named references to lineage paths or raw signatures.
//
// The registry lives in hypercomb-shared (NameRegistry). This queen is
// just the authoring surface:
//
//   /branch <name>              — label CURRENT cell's lineage as <name>
//   /branch <name> <64-hex>     — label a raw signature as <name>
//   /branch <name> clear        — remove the label
//   /branch list                — dump all labels to console
//
// Other slash queens (/website, future /marker-based commands) read the
// same registry to resolve names → targets, and use NameRegistry.matching
// for autocomplete.

import { QueenBee, EffectBus } from '@hypercomb/core'
import { isSignature } from '../editor/tile-properties.js'

const toast = (type: 'info' | 'success' | 'warning' | 'tip', title: string, message: string): void => {
  try { EffectBus.emit('toast:show', { type, title, message }) } catch { /* noop */ }
}

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/

export class BranchQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'branch'
  override readonly aliases = ['mark', 'label']
  override description =
    'Give a lineage path or signature a named handle that other slash commands autocomplete against.'
  override descriptionKey = 'slash.branch'

  override slashComplete(args: string): readonly string[] {
    const tokens = args.split(/\s+/)
    const registry = get('@hypercomb.social/NameRegistry') as any
    const names: string[] = registry?.names ?? []

    if (tokens.length <= 1) {
      const first = (tokens[0] ?? '').toLowerCase()
      const matches = names.filter((n: string) => n.toLowerCase().startsWith(first))
      const suggestions: string[] = []
      if (!first) suggestions.push('(name)', 'list')
      if ('list'.startsWith(first)) suggestions.push('list')
      return [...new Set([...matches, ...suggestions])]
    }

    if (tokens.length === 2) {
      const second = (tokens[1] ?? '').toLowerCase()
      const ops = ['<64-hex signature>', 'clear']
      if (!second) return ops
      return ops.filter(o => o.toLowerCase().startsWith(second))
    }

    return []
  }

  protected execute(args: string): void {
    const trimmed = args.trim()
    if (!trimmed) {
      console.warn('[/branch] usage: /branch <name> [signature | clear]  |  /branch list')
      return
    }

    const tokens = trimmed.split(/\s+/)
    const first = tokens[0]

    if (first.toLowerCase() === 'list') { void this.#list(); return }
    if (!NAME_RE.test(first)) {
      console.warn(`[/branch] invalid name "${first}" — use letters, digits, - . _ (max 64)`)
      return
    }

    const second = tokens[1]?.trim()

    if (!second) { void this.#setLineage(first); return }
    if (second.toLowerCase() === 'clear' || second.toLowerCase() === 'remove') {
      void this.#remove(first); return
    }
    if (isSignature(second)) { void this.#setSignature(first, second.toLowerCase()); return }

    console.warn(`[/branch] second arg must be empty, "clear", or a 64-hex signature — got "${second.slice(0, 20)}…"`)
  }

  async #setLineage(name: string): Promise<void> {
    const lineage = get('@hypercomb.social/Lineage') as any
    const registry = get('@hypercomb.social/NameRegistry') as any
    if (!lineage?.explorerSegments || !registry?.setLineage) {
      console.warn('[/branch] services not ready')
      return
    }
    const path: string[] = [...(lineage.explorerSegments() ?? [])]
    await registry.setLineage(name, path)
    const label = '/' + path.join('/')
    console.log(`[/branch] ${name} → ${label}`)
    toast('success', 'Branch saved', `${name} → ${label}`)
  }

  async #setSignature(name: string, sig: string): Promise<void> {
    const registry = get('@hypercomb.social/NameRegistry') as any
    if (!registry?.setSignature) return
    await registry.setSignature(name, sig)
    console.log(`[/branch] ${name} → signature ${sig}`)
    toast('success', 'Branch saved', `${name} → ${sig.slice(0, 12)}…`)
  }

  async #remove(name: string): Promise<void> {
    const registry = get('@hypercomb.social/NameRegistry') as any
    if (!registry?.remove) return
    const removed = await registry.remove(name)
    console.log(removed ? `[/branch] removed ${name}` : `[/branch] no such name: ${name}`)
    if (removed) toast('info', 'Branch removed', name)
    else toast('warning', 'No such branch', name)
  }

  async #list(): Promise<void> {
    const registry = get('@hypercomb.social/NameRegistry') as any
    if (!registry?.ensureLoaded) { console.warn('[/branch] registry not ready'); return }
    await registry.ensureLoaded()
    const all = registry.all as Record<string, any>
    const names = Object.keys(all).sort()
    if (!names.length) { console.log('[/branch] no branches'); return }
    for (const name of names) {
      const entry = all[name]
      if (entry?.target?.kind === 'lineage') {
        console.log(`[/branch] ${name} → /${(entry.target.path ?? []).join('/')}`)
      } else if (entry?.target?.kind === 'signature') {
        console.log(`[/branch] ${name} → signature ${entry.target.signature}`)
      }
    }
  }
}

const _branch = new BranchQueenBee()
window.ioc.register('@diamondcoreprocessor.com/BranchQueenBee', _branch)
