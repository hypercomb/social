// hypercomb-shared/core/navigation.ts

import { hypercomb } from '@hypercomb/core'
import { CompletionUtility } from '../core/completion-utility'

// global get/register/list available via ioc.web.ts

type SelectionDetail = {
  selected: string[]
}

export class Navigation extends hypercomb {

  private get completions(): CompletionUtility { return get('@hypercomb.social/CompletionUtility') as CompletionUtility }
  private listening = false

  // ----------------------------------
  // reads
  // ----------------------------------

  // ----------------------------------
  // bracket-segment selection
  //   Path syntax `/path/to/parent/[a,b,c]` carries a selection list
  //   as its trailing segment. The bracket segment is NOT part of the
  //   navigation target — it pre-selects child cells under the parent.
  //   On parse: strip from `segments()` / `segmentsRaw()`, expose via
  //   `getSelections()` so SelectionService can sync. Hash-based
  //   selections (`#name` or `#(a,b,c)`) remain supported as a fallback
  //   for back-compat with existing in-flight links.
  // ----------------------------------

  // Match `[a, b, c]` or `[a,b,c]` (last segment, brackets included).
  private readonly bracketRe = /^\[(.+)\]$/

  // Parse current pathname into { pathSegments (no bracket), bracket (names or null) }.
  private readonly parsePath = (): { pathSegments: string[]; bracket: string[] | null } => {
    const raw = window.location.pathname.split('/').filter(Boolean)
    if (raw.length === 0) return { pathSegments: [], bracket: null }
    const last = this.safeDecode(raw[raw.length - 1] ?? '')
    const m = this.bracketRe.exec(last.trim())
    if (!m) return { pathSegments: raw, bracket: null }
    const inner = m[1]
    const names = inner.split(',').map(s => this.cleanSegment(s)).filter(Boolean)
    return { pathSegments: raw.slice(0, -1), bracket: names }
  }

  // normalized segments (good for actions/cells); bracket segment stripped
  public segments = (): string[] => {
    const { pathSegments } = this.parsePath()
    return pathSegments.map(this.cleanSegment).filter(Boolean)
  }

  // raw decoded segments (good for explorer folder names); bracket segment stripped
  public segmentsRaw = (): string[] => {
    const { pathSegments } = this.parsePath()
    return pathSegments.map(this.safeDecode).map(s => (s ?? '').trim()).filter(Boolean)
  }

  // ----------------------------------
  // selection helpers
  //   Path bracket (`/parent/[a,b]`) wins over hash form (`#(a,b)`).
  //   Hash form remains supported for back-compat.
  // ----------------------------------

  public readonly getSelections = (): string[] => {
    // Path-bracket form takes precedence — it's the canonical / shareable
    // representation. Hash form survives as a back-compat reader.
    const { bracket } = this.parsePath()
    if (bracket && bracket.length > 0) return bracket

    const raw = window.location.hash ?? ''
    const h = raw.startsWith('#') ? raw.slice(1) : raw
    if (!h.trim()) return []

    const trimmed = h.trim()

    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
      const inner = trimmed.slice(1, -1).trim()
      if (!inner) return []
      return inner.split(',').map(s => this.cleanSegment(s)).filter(Boolean)
    }

    return trimmed.split(',').map(s => this.cleanSegment(s)).filter(Boolean)
  }

  public readonly replaceSelections = (names: readonly string[]): void => {
    const clean = Array.from(new Set(names.map(this.cleanSegment).filter(Boolean)))

    if (!clean.length) {
      window.history.replaceState(window.history.state, '', window.location.pathname)
      this.dispatchSelection([])
      return
    }

    const hash =
      clean.length === 1
        ? '#' + clean[0]
        : '#(' + clean.join(',') + ')'

    window.history.replaceState(window.history.state, '', window.location.pathname + hash)
    this.dispatchSelection(clean)
  }

  public readonly toggleSelection = (name: string): string[] => {
    const clean = this.cleanSegment(name)
    if (!clean) return this.getSelections()

    const current = this.getSelections()
    const next = current.includes(clean)
      ? current.filter(x => x !== clean)
      : [...current, clean]

    this.replaceSelections(next)
    return next
  }

  // ----------------------------------
  // listening
  // ----------------------------------

  public listen = (): void => {
    if (this.listening) return
    this.listening = true
    window.addEventListener('popstate', this.onPopState)
  }

  // ----------------------------------
  // bootstrap
  // ----------------------------------

  public bootstrap = (segments: readonly string[] = []): void => {
    this.listen()

    const clean = segments.map(this.cleanSegment).filter(Boolean)
    this.replace(clean)
    this.dispatchSelection(this.getSelections())
  }

  // ----------------------------------
  // mutations (normalized)
  // ----------------------------------

  public go = (segments: readonly string[]): void => {
    const clean = segments.map(this.cleanSegment).filter(Boolean)
    const path = '/' + clean.join('/')
    const hash = window.location.hash ?? ''

    window.history.pushState({}, '', path + hash)
    this.dispatch()
  }

  public replace = (segments: readonly string[]): void => {
    const clean = segments.map(this.cleanSegment).filter(Boolean)
    const path = '/' + clean.join('/')
    const hash = window.location.hash ?? ''

    window.history.replaceState({}, '', path + hash)
    this.dispatch()
  }

  // ----------------------------------
  // mutations (raw, url-encoded)
  // ----------------------------------

  public goRaw = (segments: readonly string[]): void => {
    const clean = segments.map(s => (s ?? '').trim()).filter(Boolean)
    const path = '/' + clean.map(encodeURIComponent).join('/')
    const hash = window.location.hash ?? ''

    window.history.pushState({}, '', path + hash)
    this.dispatch()
  }

  public replaceRaw = (segments: readonly string[]): void => {
    const clean = segments.map(s => (s ?? '').trim()).filter(Boolean)
    const path = '/' + clean.map(encodeURIComponent).join('/')
    const hash = window.location.hash ?? ''

    window.history.replaceState({}, '', path + hash)
    this.dispatch()
  }

  public back = (): void => { window.history.back() }
  public forward = (): void => { window.history.forward() }

  public move = (segment: string): void => {
    const next = [...this.segments(), segment].filter(Boolean)
    this.go(next)
  }

  // ----------------------------------
  // internal
  // ----------------------------------

  private readonly onPopState = (): void => {
    this.dispatch()
    this.dispatchSelection(this.getSelections())
  }

  private readonly dispatch = (): void => {
    window.dispatchEvent(new Event('navigate'))
  }

  private readonly dispatchSelection = (selected: string[]): void => {
    window.dispatchEvent(
      new CustomEvent<SelectionDetail>('selection', { detail: { selected } })
    )
  }

  private readonly safeDecode = (s: string): string => {
    try { return decodeURIComponent(s) } catch { return s }
  }

  // url-safe normalization
  private readonly cleanSegment = (s: string): string => {
    const decoded = this.safeDecode((s ?? '').trim())
    const noSlashes = decoded.replace(/[\/\\]+/g, ' ')
    return this.completions.normalize(noSlashes)
  }
}

register('@hypercomb.social/Navigation', new Navigation())