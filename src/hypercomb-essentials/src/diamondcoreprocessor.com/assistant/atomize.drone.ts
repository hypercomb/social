// diamondcoreprocessor.com/assistant/atomize.drone.ts
import { Drone, EffectBus, hypercomb, normalizeSeed } from '@hypercomb/core'
import type { OverlayActionDescriptor } from '../presentation/tiles/tile-overlay.drone.js'
import { MODELS, getApiKey, callAnthropic, API_KEY_STORAGE } from './llm-api.js'

const ACTION_DESCRIPTOR: OverlayActionDescriptor = {
  name: 'expand',
  fontChar: '{',
  x: -25.25,
  y: 5,
  hoverTint: 0xd8c8ff,
  profile: 'private',
}

const SUBTOPIC_COUNT = 7

const SYSTEM_PROMPT = `You are a precise decomposition engine for a spatial knowledge graph called Hypercomb.

Your job: Given a single subject, break it down into its constituent parts — the smaller, more specific pieces that compose it. Each piece should be concrete enough to explore further on its own.

Produce a flat JSON array where each element is an object with:
- "name": a short 1–3 word label (will become a tile label, lowercase, no special characters)
- "detail": a concise descriptive phrase (5–12 words)

Rules:
1. Output exactly ${SUBTOPIC_COUNT} items.
2. Items must be unique and non-overlapping.
3. Items should be concrete constituents, not vague categories.
4. Output ONLY the JSON array. No markdown, no wrapping text.`

type TileActionPayload = { action: string; label: string; q: number; r: number; index: number }

export class AtomizeDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'expands a tile into constituent parts via Claude Haiku'

  protected override deps = {
    lineage: '@hypercomb.social/Lineage',
    navigation: '@hypercomb.social/Navigation',
    store: '@hypercomb.social/Store',
  }

  protected override listens = ['render:host-ready', 'tile:action']
  protected override emits = ['overlay:register-action', 'seed:added']

  #registered = false
  #effectsRegistered = false
  #busy = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    this.onEffect('render:host-ready', () => {
      if (this.#registered) return
      this.#registered = true
      this.emitEffect('overlay:register-action', [ACTION_DESCRIPTOR])
    })

    this.onEffect<TileActionPayload>('tile:action', (payload) => {
      if (payload.action !== 'expand') return
      void this.#expand(payload.label)
    })
  }

  async #expand(rawLabel: string): Promise<void> {
    if (this.#busy) return
    this.#busy = true

    try {
      const apiKey = getApiKey()
      if (!apiKey) {
        console.warn(`[expand] No API key. Set via: localStorage.setItem('${API_KEY_STORAGE}', 'sk-ant-...')`)
        EffectBus.emit('llm:api-key-required', {})
        return
      }

      const label = normalizeSeed(rawLabel) || rawLabel
      const lineage = this.resolve<{ explorerDir(): Promise<FileSystemDirectoryHandle> }>('lineage')
      const dir = await lineage?.explorerDir()
      if (!dir) return

      const tileDir = await dir.getDirectoryHandle(label, { create: true })

      // Build lineage stem — snapshot from root down to this tile
      const stem = await this.#buildStem(label)

      // Gather sibling context — what else is at this level?
      const siblings: string[] = []
      for await (const [name, handle] of (dir as any).entries()) {
        if (handle.kind === 'directory' && !name.startsWith('__')) {
          siblings.push(name)
        }
      }

      const siblingContext = siblings.length > 1
        ? `\nSiblings at the same level: ${siblings.filter(s => s !== label).join(', ')}`
        : ''

      const userMessage = `Decompose this into ${SUBTOPIC_COUNT} constituent parts:\n\nTopic: ${label}\n\nLineage (path from root to this tile):\n${stem}${siblingContext}`

      const responseText = await callAnthropic(
        MODELS['haiku'],
        SYSTEM_PROMPT,
        userMessage,
        apiKey,
        1024,
      )

      const parts = this.#extractArray(responseText)
      if (parts.length === 0) {
        console.warn('[expand] No parts extracted from response')
        return
      }

      for (const item of parts) {
        const name = normalizeSeed(item.name)
        if (!name) continue
        await tileDir.getDirectoryHandle(name, { create: true })
        EffectBus.emit('seed:added', { seed: name })
      }

      console.log(`[expand] ${label} → ${parts.length} parts`)
      await new hypercomb().act()
    } catch (err) {
      console.warn('[expand] failed:', err)
    } finally {
      this.#busy = false
    }
  }

  /** Walk from OPFS root through each navigation segment, collecting children at each level. */
  async #buildStem(targetLabel: string): Promise<string> {
    const nav = this.resolve<{ segments(): string[] }>('navigation')
    const store = this.resolve<{ hypercombRoot: FileSystemDirectoryHandle }>('store')
    if (!nav || !store?.hypercombRoot) return targetLabel

    const segments = nav.segments()
    const lines: string[] = []
    let cursor: FileSystemDirectoryHandle = store.hypercombRoot

    // Walk domain root first (hypercomb.io)
    try {
      cursor = await cursor.getDirectoryHandle('hypercomb.io')
    } catch {
      return targetLabel
    }

    // Walk each segment, collecting children names at each level
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const indent = '  '.repeat(i)
      const children = await this.#listChildren(cursor)
      const childList = children.filter(c => c !== seg).join(', ')
      const suffix = childList ? ` (also: ${childList})` : ''
      lines.push(`${indent}${seg}${suffix}`)

      try {
        cursor = await cursor.getDirectoryHandle(seg)
      } catch {
        break
      }
    }

    // Add the target tile at the deepest level
    const targetIndent = '  '.repeat(segments.length)
    const targetChildren = await this.#listChildren(cursor)
    const targetSiblings = targetChildren.filter(c => c !== targetLabel).join(', ')
    const targetSuffix = targetSiblings ? ` (also: ${targetSiblings})` : ''
    lines.push(`${targetIndent}> ${targetLabel}${targetSuffix}  ← EXPAND THIS`)

    return lines.join('\n')
  }

  async #listChildren(dir: FileSystemDirectoryHandle): Promise<string[]> {
    const names: string[] = []
    try {
      for await (const [name, handle] of (dir as any).entries()) {
        if (handle.kind === 'directory' && !name.startsWith('__') && !name.startsWith('.')) {
          names.push(name)
        }
      }
    } catch {}
    return names
  }

  #extractArray(text: string): { name: string; detail: string }[] {
    try {
      const p = JSON.parse(text)
      if (Array.isArray(p)) return p
    } catch {}

    const m = text.match(/\[[\s\S]*\]/g) || []
    for (const chunk of m.sort((a, b) => b.length - a.length)) {
      try {
        const arr = JSON.parse(chunk)
        if (Array.isArray(arr)) return arr
      } catch {}
    }

    return []
  }
}

const _atomize = new AtomizeDrone()
window.ioc.register('@diamondcoreprocessor.com/AtomizeDrone', _atomize)
