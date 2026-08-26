// completion-utility.ts — pure name-completion normalization. A kernel
// utility: the command line and its behaviors reach it by IoC key, and it
// must exist before any of them. Moved in the everything-is-a-beehavior
// Phase 1.

import { normalizeCell } from '../cell.js'

export type CompletionStyle = 'space' | 'dot'
export type CompletionMode = 'action' | 'marker' | 'filter' | 'slash' | 'delete' | 'remove' | 'select' | 'tag' | 'feature' | 'behaviour-args' | 'find'

export type CompletionContext =
  | { active: false }
  | {
    active: true
    mode: CompletionMode
    head: string
    raw: string
    normalized: string
    style: CompletionStyle
  }

export class CompletionUtility {

  public readonly normalize = (s: string): string => normalizeCell(s)


  public readonly render = (s: string, style: CompletionStyle): string =>
    style === 'dot' ? s.replace(/\s+/g, '.') : s

}

export const COMPLETION_UTILITY_KEY = '@hypercomb.social/CompletionUtility'

export const completionUtility = new CompletionUtility()

/** Register into the live IoC map when one exists (core also runs in node). */
export const ensureCompletionUtilityRegistered = (): void => {
  const ioc = (globalThis as unknown as {
    ioc?: { has?: (k: string) => boolean; register?: (k: string, v: unknown) => void }
  }).ioc
  if (!ioc?.has?.(COMPLETION_UTILITY_KEY)) {
    ioc?.register?.(COMPLETION_UTILITY_KEY, completionUtility)
  }
}
ensureCompletionUtilityRegistered()
