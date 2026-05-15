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
  // bracket selection grammar
  //
  // Read side accepts three forms (any one parses):
  //   /parent/[a,b,c]     — path-tail. Address bar shows brackets literally
  //                         in modern browsers. Canonical writer form.
  //   /parent?[a,b,c]     — query-string. Survives proxies / routers but
  //                         browsers re-serialize `[a]` as `%5Ba%5D=`,
  //                         which is ugly in the address bar. Reader-
  //                         only — no longer written.
  //   #name / #(a,b,c)    — legacy hash form. Reader fallback so old
  //                         shared links still resolve.
  //
  // Writer side (`replaceSelections`) emits path-tail brackets so a
  // user-typed `/[dolphin]` URL survives any in-app round-trip — sync
  // → notify → potential re-write all preserve the bracket segment
  // instead of clobbering it to `#dolphin`.
  //
  // The bracket content is stripped from `segments()` / `segmentsRaw()`
  // so callers walking the path don't see the selection markup.
  // ----------------------------------

  // Match `[a, b, c]` or `[a,b,c]` exactly (brackets included).
  private readonly bracketRe = /^\[(.+)\]$/

  // Parse the query string for the `?[a,b,c]` bracket form. Returns
  // the parsed name list (possibly empty) or null when the search
  // doesn't carry a bracket. URL-encoded brackets are accepted via
  // safeDecode so paste from any encoder works.
  private readonly parseQueryBracket = (): string[] | null => {
    const raw = window.location.search ?? ''
    if (!raw) return null
    const trimmed = raw.startsWith('?') ? raw.slice(1) : raw
    const decoded = this.safeDecode(trimmed).trim()
    const m = this.bracketRe.exec(decoded)
    if (!m) return null
    return m[1].split(',').map(s => this.cleanSegment(s)).filter(Boolean)
  }

  // Parse current pathname into { pathSegments (no bracket), bracket (names or null) }.
  // Query-string form wins; falls back to legacy path-tail form.
  private readonly parsePath = (): { pathSegments: string[]; bracket: string[] | null } => {
    const raw = window.location.pathname.split('/').filter(Boolean)

    // Query-string form: pathname stays as-is, bracket comes from `?[...]`.
    const queryBracket = this.parseQueryBracket()
    if (queryBracket) return { pathSegments: raw, bracket: queryBracket }

    // Legacy path-tail form: last segment is `[a,b,c]`.
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

  /** True iff the current URL path carries a `[...]` selection segment.
   *  Lets URL-driven consumers (auto-open popup on dashboard click)
   *  distinguish "user navigated here with a selection intent" from
   *  "user is just here and might have prior hash-form selection." */
  public readonly hasBracketSelection = (): boolean => {
    const { bracket } = this.parsePath()
    return !!(bracket && bracket.length > 0)
  }

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

    // Path-tail bracket form (`/parent/[a,b,c]`) is the canonical writer
    // shape so any in-app round-trip preserves what the user typed.
    // Strip an existing trailing `[…]` segment (or a legacy `?[…]` query)
    // so we don't end up doubling the bracket each time the selection is
    // re-written.
    const { pathSegments } = this.parsePath()
    const basePath = pathSegments.length === 0 ? '' : '/' + pathSegments.join('/')

    // Search may legitimately carry app params unrelated to selection.
    // Drop it only if it's the `?[…]` legacy form; preserve otherwise.
    const rawSearch = window.location.search ?? ''
    const decodedSearch = this.safeDecode(rawSearch.startsWith('?') ? rawSearch.slice(1) : rawSearch).trim()
    const search = this.bracketRe.test(decodedSearch) ? '' : rawSearch

    const hash = window.location.hash ?? ''

    if (!clean.length) {
      const newUrl = (basePath || '/') + search + hash
      window.history.replaceState(window.history.state, '', newUrl)
      this.dispatchSelection([])
      return
    }

    const bracket = `/[${clean.join(',')}]`
    window.history.replaceState(window.history.state, '', basePath + bracket + search + hash)
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