// src/app/core/navigation.ts
import { Injectable, inject } from '@angular/core'
import { CompletionUtility } from './completion-utility'

type NavigateDetail = {
  segments: string[]
}

@Injectable({ providedIn: 'root' })
export class Navigation {

  private readonly completions = inject(CompletionUtility)

  // reads current url and returns normalized segments only
  public segments = (): string[] => {
    const raw = window.location.pathname.split('/').filter(Boolean)
    return raw.map(this.cleanSegment).filter(Boolean)
  }

  public listen = (): void => {
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
