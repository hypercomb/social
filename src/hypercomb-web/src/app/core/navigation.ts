// src/app/core/navigation.ts
import { Injectable, inject } from '@angular/core'
import { CompletionUtility } from './completion-utility'

export type HcPhase = 'bootstrap' | 'navigate' | 'popstate'

export type HcHistoryState = {
  // monotonically increasing index in the reconstructed stack
  i: number
  // normalized segments for this history entry (root == [])
  segments: string[]
}

export type HcNavigate = HcHistoryState & {
  phase: HcPhase
}

type NavigateDetail = {
  // keep for compatibility while you migrate listeners
  segments: string[]
  // new: canonical payload
  nav: HcNavigate
}

type SelectionDetail = {
  selected: string[]
}

@Injectable({ providedIn: 'root' })
export class Navigation {

  private readonly completions = inject(CompletionUtility)
  private bootstrapped = false
  private listening = false

  // ----------------------------------
  // bootstrap
  // ----------------------------------

  // reconstructs browser history on cold entry so back button steps by segment
  public bootstrap = (segments: readonly string[]): void => {
    if (this.bootstrapped) return
    this.bootstrapped = true

    const clean = segments.map(this.cleanSegment).filter(Boolean)

    // root entry
    const rootState: HcHistoryState = { i: 0, segments: [] }
    window.history.replaceState(rootState, '', '/')

    // one entry per grammar depth
    const acc: string[] = []
    for (let idx = 0; idx < clean.length; idx++) {
      acc.push(clean[idx])
      const path = '/' + acc.join('/')
      const state: HcHistoryState = { i: idx + 1, segments: [...acc] }
      window.history.pushState(state, '', path)
    }

    // publish only the final state
    this.dispatch(this.readOrUrlFallback('bootstrap'))
  }

  // ----------------------------------
  // reads
  // ----------------------------------

  // reads current url and returns normalized segments only
  public segments = (): string[] => {
    const raw = window.location.pathname.split('/').filter(Boolean)
    return raw.map(this.cleanSegment).filter(Boolean)
  }

  public current = (): HcHistoryState => {
    return this.readState() ?? { i: this.segments().length, segments: this.segments() }
  }

  // ----------------------------------
  // selection (hash) helpers
  // ----------------------------------

  // hash formats supported:
  // - #abc
  // - #(abc,def)
  // - #abc,def (legacy style, still accepted)
  public readonly getSelections = (): string[] => {
    const raw = window.location.hash ?? ''
    const h = raw.startsWith('#') ? raw.slice(1) : raw
    if (!h.trim()) return []

    const trimmed = h.trim()

    // #(a,b,c)
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
      const inner = trimmed.slice(1, -1).trim()
      if (!inner) return []
      return inner
        .split(',')
        .map(s => this.cleanSegment(s))
        .filter(Boolean)
    }

    // abc,def (or just abc)
    return trimmed
      .split(',')
      .map(s => this.cleanSegment(s))
      .filter(Boolean)
  }

  public readonly replaceSelections = (names: readonly string[]): void => {
    const clean = names.map(this.cleanSegment).filter(Boolean)
    const unique = Array.from(new Set(clean))

    // empty selection → clear hash
    if (!unique.length) {
      window.history.replaceState(window.history.state, '', window.location.pathname)
      this.dispatchSelection([])
      return
    }

    // single item → #abc
    if (unique.length === 1) {
      const next = window.location.pathname + '#' + unique[0]
      window.history.replaceState(window.history.state, '', next)
      this.dispatchSelection(unique)
      return
    }

    // multi → #(a,b,c)
    const next = window.location.pathname + '#(' + unique.join(',') + ')'
    window.history.replaceState(window.history.state, '', next)
    this.dispatchSelection(unique)
  }

  public readonly toggleSelection = (name: string): string[] => {
    const clean = this.cleanSegment(name)
    if (!clean) return this.getSelections()

    const current = this.getSelections()
    const exists = current.includes(clean)

    const next = exists
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

    // back/forward only
    window.addEventListener('popstate', this.onPopState)
  }

  // ----------------------------------
  // mutations
  // ----------------------------------

  public go = (segments: readonly string[]): void => {
    const clean = segments.map(this.cleanSegment).filter(Boolean)
    const path = '/' + clean.join('/')

    const nextIndex = (this.readState()?.i ?? clean.length - 1) + 1
    const state: HcHistoryState = { i: Math.max(0, nextIndex), segments: [...clean] }

    window.history.pushState(state, '', path)
    this.dispatch({ ...state, phase: 'navigate' })
  }

  public replace = (segments: readonly string[]): void => {
    const clean = segments.map(this.cleanSegment).filter(Boolean)
    const path = '/' + clean.join('/')

    const currentIndex = this.readState()?.i ?? clean.length
    const state: HcHistoryState = { i: Math.max(0, currentIndex), segments: [...clean] }

    window.history.replaceState(state, '', path)
    this.dispatch({ ...state, phase: 'navigate' })
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
    // url and history.state already changed; just publish the current entry
    this.dispatch(this.readOrUrlFallback('popstate'))

    // selection may have changed via url history traversal
    this.dispatchSelection(this.getSelections())
  }

  private readonly dispatch = (nav: HcNavigate): void => {
    window.dispatchEvent(
      new CustomEvent<NavigateDetail>('navigate', { detail: { segments: nav.segments, nav } })
    )
  }

  private readonly dispatchSelection = (selected: string[]): void => {
    window.dispatchEvent(
      new CustomEvent<SelectionDetail>('selection', { detail: { selected } })
    )
  }

  private readonly readOrUrlFallback = (phase: HcPhase): HcNavigate => {
    const state = this.readState()
    if (state) return { ...state, phase }

    // fallback if someone navigated without our helpers
    const segs = this.segments()
    return { i: segs.length, segments: segs, phase }
  }

  private readonly readState = (): HcHistoryState | null => {
    const s = window.history.state as unknown
    if (!s || typeof s !== 'object') return null

    const any = s as any
    if (!Array.isArray(any.segments)) return null
    if (typeof any.i !== 'number') return null

    return { i: any.i, segments: [...any.segments] }
  }

  private readonly safeDecode = (s: string): string => {
    try { return decodeURIComponent(s) } catch { return s }
  }

  // ensures:
  // - no % escapes in internal representation
  // - no slashes
  // - url-safe slug (depends on completions.normalize)
  private readonly cleanSegment = (s: string): string => {
    const decoded = this.safeDecode((s ?? '').trim())
    const noSlashes = decoded.replace(/[\/\\]+/g, ' ')
    return this.completions.normalize(noSlashes)
  }
}
