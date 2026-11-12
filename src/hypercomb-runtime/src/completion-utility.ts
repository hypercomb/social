// MOVED DOWN FROM hypercomb-shared/core (2026-11-11, jwize: "anything built in the
// debugger (subdomains) should not load angular"). The framework-free host had
// no lineage and no navigation, so a page there had no "where you stand": a
// create committed nothing and said it ran. This file imports no Angular and
// nothing of the shell; the shell file of the same name re-exports it.
import { normalizeCell } from '@hypercomb/core'

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

register('@hypercomb.social/CompletionUtility', new CompletionUtility())