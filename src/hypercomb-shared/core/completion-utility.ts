export type CompletionStyle = 'space' | 'dot'
export type CompletionMode = 'action' | 'marker' | 'filter'

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

  public readonly normalize = (s: string): string =>
    s.replace(/\./g, ' ')
      .replace(/\s+/g, '-')
      .trim()
      .toLowerCase()


  public readonly render = (s: string, style: CompletionStyle): string =>
    style === 'dot' ? s.replace(/\s+/g, '.') : s

}

register('@hypercomb.social/CompletionUtility', new CompletionUtility())