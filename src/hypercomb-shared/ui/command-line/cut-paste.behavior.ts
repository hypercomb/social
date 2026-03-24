// hypercomb-shared/ui/command-line/cut-paste.behavior.ts

import type { CommandLineBehavior } from './command-line-behavior'
import type { CompletionUtility } from '@hypercomb/shared/core/completion-utility'
import type { Lineage } from '../../core/lineage'
import type { Navigation } from '../../core/navigation'
import { SignatureService, hypercomb } from '@hypercomb/core'

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
    return input.startsWith('[') && close > 1 && close < input.length - 1 && input[close + 1] === '/'
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

    const items = itemsPart
      .split(',')
      .map(s => completions.normalize(s.trim()))
      .filter(Boolean)
    if (items.length === 0) return

    const navigateAfter = pathPart.endsWith('/')
    const pathRaw = pathPart.replace(/\/+$/, '').trim()
    const pathSegments = pathRaw
      .split('/')
      .map(s => completions.normalize(s.trim()))
      .filter(Boolean)
    if (pathSegments.length === 0) return

    // guard: prevent pasting into self — if the destination path starts
    // with one of the items, the item would be copied inside itself
    const destFirst = pathSegments[0]
    const safeItems = items.filter(item => {
      if (item === destFirst && pathSegments.length === 1) return false // [x]/x → skip
      return true
    })
    if (safeItems.length === 0) return

    // resolve destination OPFS directory (create if needed)
    const currentDir = await lineage.explorerDir()
    if (!currentDir) return

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

    await new hypercomb().act()

    // navigate to destination if trailing /
    if (navigateAfter) {
      const currentSegments = navigation.segmentsRaw()
      navigation.goRaw([...currentSegments, ...pathSegments])
    }
  }

  /**
   * Compute the history signature for a destination path relative to
   * the current lineage. Mirrors HistoryService.sign() but with
   * destination segments appended to the current explorer path.
   */
  async #computeDestSig(lineage: Lineage, extraSegments: string[]): Promise<string> {
    const domain = lineage.domain?.() ?? 'hypercomb.io'
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
