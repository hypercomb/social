// hypercomb-shared/ui/command-line/cut-paste.behavior.ts

import type { CommandLineBehavior } from './command-line-behavior'
import type { CompletionUtility } from '@hypercomb/shared/core/completion-utility'
import type { Lineage } from '../../core/lineage'
import type { Navigation } from '../../core/navigation'
import { EffectBus, SignatureService, hypercomb } from '@hypercomb/core'
import { parseArrayItems } from '../../core/array-parser'
import { persistTagOps, type TagOp } from '../../core/tag-ops'
import { SELECT_OPS } from './select-ops'

type HistoryOp = { op: 'add' | 'remove'; seed: string; at: number }

interface HistoryServiceLike {
  record(signature: string, operation: HistoryOp): Promise<void>
}

/**
 * Enter with bracket-path syntax → copy items to a destination folder.
 *
 * Examples:
 *   "[cigars,whiskey]/interests"       → copies items to ./interests, stays here
 *   "[cigars,whiskey]/interests/"      → copies items to ./interests, navigates there
 *   "[a,b]/sub/deep"                   → copies to ./sub/deep
 *   "[new, ~old]/dest"                 → copies new to dest, deletes old from current
 *
 * Items autocomplete from current surface tiles. Non-matching items
 * still create seeds at the destination (same as regular create).
 * Path is relative to the current explorer directory.
 */
export class CutPasteBehavior implements CommandLineBehavior {

  readonly name = 'cut-paste'
  readonly operations = [
    {
      trigger: 'Enter',
      pattern: /^\[.+\]\/.+/,
      description: 'Copy items to a destination folder',
      examples: [
        { input: '[cigars,whiskey]/interests', key: 'Enter', result: 'Copies cigars and whiskey to ./interests' },
        { input: '[cigars,whiskey]/interests/', key: 'Enter', result: 'Copies to ./interests and navigates there' },
      ]
    }
  ]

  match(event: KeyboardEvent, input: string): boolean {
    if (event.key !== 'Enter' || event.shiftKey) return false
    const close = input.indexOf(']')
    if (!(input.startsWith('[') && close > 1 && close < input.length - 1 && input[close + 1] === '/')) return false
    // Exclude bracket-first select syntax: [items]/move(8) is select, not cut-paste
    const afterSlash = input.slice(close + 2)
    const nextSlash = afterSlash.indexOf('/')
    const firstSeg = (nextSlash === -1 ? afterSlash : afterSlash.slice(0, nextSlash)).toLowerCase().replace(/\(.*$/, '')
    if (SELECT_OPS.has(firstSeg)) return false
    return true
  }

  async execute(input: string): Promise<void> {
    const completions = get('@hypercomb.social/CompletionUtility') as CompletionUtility
    const lineage = get('@hypercomb.social/Lineage') as Lineage
    const navigation = get('@hypercomb.social/Navigation') as Navigation
    const historyService = get('@diamondcoreprocessor.com/HistoryService') as HistoryServiceLike | undefined

    // parse [items]/path
    const close = input.indexOf(']')
    const itemsPart = input.slice(1, close)
    const pathPart = input.slice(close + 2) // skip ]/

    const parsed = parseArrayItems(itemsPart, completions.normalize)
    if (parsed.length === 0) return

    const navigateAfter = pathPart.endsWith('/')
    const pathRaw = pathPart.replace(/\/+$/, '').trim()
    const pathSegments = pathRaw
      .split('/')
      .map(s => completions.normalize(s.trim()))
      .filter(Boolean)
    if (pathSegments.length === 0) return

    const currentDir = await lineage.explorerDir()
    if (!currentDir) return

    // Process delete and tag ops from source
    const tagOps: TagOp[] = []
    const createItems: string[] = []

    for (const item of parsed) {
      const label = item.segments[item.segments.length - 1]

      if (item.op === 'delete') {
        // delete from current directory
        await this.#deleteTarget(currentDir, item.segments)
      } else if (item.op === 'tag-add' || item.op === 'tag-remove') {
        if (item.tag) {
          tagOps.push({ label, tag: item.tag, color: item.tagColor, remove: item.op === 'tag-remove' })
        }
        // tag-add items also get copied to destination
        if (item.op === 'tag-add') createItems.push(label)
      } else {
        createItems.push(label)
      }
    }

    // guard: prevent pasting into self
    const destFirst = pathSegments[0]
    const safeItems = createItems.filter(item => {
      if (item === destFirst && pathSegments.length === 1) return false
      return true
    })

    if (safeItems.length > 0) {
      // resolve destination OPFS directory
      let destDir = currentDir
      for (const seg of pathSegments) {
        destDir = await destDir.getDirectoryHandle(seg, { create: true })
      }

      // create seed directories at destination
      for (const item of safeItems) {
        await destDir.getDirectoryHandle(item, { create: true })
      }

      // record history ops at the destination's signature
      if (historyService) {
        const destSig = await this.#computeDestSig(lineage, pathSegments)
        const now = Date.now()
        for (const item of safeItems) {
          await historyService.record(destSig, { op: 'add', seed: item, at: now })
        }
      }
    }

    // persist tag ops at current directory
    if (tagOps.length > 0) {
      await persistTagOps(tagOps, currentDir)
    }

    await new hypercomb().act()

    // navigate to destination if trailing /
    if (navigateAfter) {
      const currentSegments = navigation.segmentsRaw()
      navigation.goRaw([...currentSegments, ...pathSegments])
    }
  }

  async #deleteTarget(root: FileSystemDirectoryHandle, segments: string[]): Promise<void> {
    if (!segments.length) return

    let parent = root
    for (let i = 0; i < segments.length - 1; i++) {
      try {
        parent = await parent.getDirectoryHandle(segments[i], { create: false })
      } catch {
        return
      }
    }

    const name = segments[segments.length - 1]
    try {
      await parent.removeEntry(name, { recursive: true })
      EffectBus.emit('seed:removed', { seed: name })
    } catch { /* skip */ }
  }

  async #computeDestSig(lineage: Lineage, extraSegments: string[]): Promise<string> {
    const domain = window.location.hostname || 'hypercomb.io'
    const currentSegments = lineage.explorerSegments?.() ?? []
    const destPath = [...currentSegments, ...extraSegments].join('/')

    const roomStore = get<any>('@hypercomb.social/RoomStore')
    const secretStore = get<any>('@hypercomb.social/SecretStore')
    const space = roomStore?.value ?? ''
    const secret = secretStore?.value ?? ''
    const parts = [space, domain, destPath, secret, 'seed'].filter(Boolean)
    const key = parts.join('/')

    return await SignatureService.sign(new TextEncoder().encode(key).buffer as ArrayBuffer)
  }
}
