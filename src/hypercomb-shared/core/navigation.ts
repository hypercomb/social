// src/app/core/navigation.ts
import { Injectable, inject } from '@angular/core'
import { CompletionUtility } from './completion-utility'
import { hypercomb } from '@hypercomb/core'

type SelectionDetail = {
  selected: string[]
}

@Injectable({ providedIn: 'root' })
export class Navigation extends hypercomb {

  private get completions(): CompletionUtility { return <CompletionUtility>window.ioc.get("CompletionUtility") }
  private listening = false

  // ----------------------------------
  // bootstrap (semantic replay only)
  // ----------------------------------

  // replay encounters for the current url; no history mutation
  public bootstrap = (segments: readonly string[]): void => {
    for (const segment of segments) {
      this.act(segment)
    }
  }

  // ----------------------------------
  // reads
  // ----------------------------------

  // canonical source of truth is the url
  public segments = (): string[] => {
    const raw = window.location.pathname.split('/').filter(Boolean)
    return raw.map(this.cleanSegment).filter(Boolean)
  }

  // ----------------------------------
  // selection (hash) helpers
  // ----------------------------------

  // supported:
  // - #abc
  // - #(abc,def)
  // - #abc,def
  public readonly getSelections = (): string[] => {
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
  // mutations
  // ----------------------------------

  public go = (segments: readonly string[]): void => {
    const clean = segments.map(this.cleanSegment).filter(Boolean)
    const path = '/' + clean.join('/')

    window.history.pushState({}, '', path)
    this.dispatch()
  }

  public replace = (segments: readonly string[]): void => {
    const clean = segments.map(this.cleanSegment).filter(Boolean)
    const path = '/' + clean.join('/')

    window.history.replaceState({}, '', path)
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

window.ioc.register('Navigation', new Navigation())