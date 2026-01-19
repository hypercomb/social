// src/app/core/navigation.ts
import { Injectable, inject } from '@angular/core'
import { CompletionUtility } from './completion-utility'

type NavigateDetail = {
  segments: string[]
}

@Injectable({ providedIn: 'root' })
export class Navigation {

private readonly completions = inject(CompletionUtility)
  private bootstrapped = false
  private listening = false

  // reconstructs browser history on cold entry so back button steps by segment
  public bootstrap = (segments: readonly string[]): void => {
    if (this.bootstrapped) return
    this.bootstrapped = true

    const clean = segments.map(this.cleanSegment).filter(Boolean)

    // preserve any existing state object
    const state = window.history.state ?? null

    // replace current entry with root
    window.history.replaceState(state, '', '/')

    // push one entry per grammar
    const acc: string[] = []
    for (const s of clean) {
      acc.push(s)
      const path = '/' + acc.join('/')
      window.history.pushState(state, '', path)
    }

    // notify listeners of final state
    this.dispatch([...clean])
  }


  // reads current url and returns normalized segments only
  public segments = (): string[] => {
    const raw = window.location.pathname.split('/').filter(Boolean)
    return raw.map(this.cleanSegment).filter(Boolean)
  }

  public listen = (): void => {
    if (this.listening) return
    this.listening = true

    // back/forward only
    window.addEventListener('popstate', this.onPopState)
  }

  public go = (segments: readonly string[]): void => {
    const clean = segments.map(this.cleanSegment).filter(Boolean)
    const path = '/' + clean.join('/')

    window.history.pushState(null, '', path)
    this.dispatch(clean)
  }

  public replace = (segments: readonly string[]): void => {
    const clean = segments.map(this.cleanSegment).filter(Boolean)
    const path = '/' + clean.join('/')

    window.history.replaceState(null, '', path)
    this.dispatch(clean)
  }

  public back = (): void => {
    window.history.back()
  }

  public forward = (): void => {
    window.history.forward()
  }

  public move = (segment: string): void => {
    const next = [...this.segments(), segment].filter(Boolean)
    this.go(next)
  }

  // ----------------------------------
  // internal
  // ----------------------------------

  private readonly onPopState = (): void => {
    // url already changed, just publish
    this.dispatch(this.segments())
  }

  private readonly dispatch = (segments: string[]): void => {
    window.dispatchEvent(
      new CustomEvent<NavigateDetail>('navigate', { detail: { segments } })
    )
  }

  private readonly safeDecode = (s: string): string => {
    try {
      return decodeURIComponent(s)
    } catch {
      return s
    }
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
