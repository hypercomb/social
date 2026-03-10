// hypercomb-shared/core/bootstrap-history.ts

import { computeLineageSig } from '@hypercomb/core'
import { CompletionUtility } from './completion-utility'
import { Store } from './store'

type BootstrapStep = {
  index: number
  segment: string
  path: string
}

export class BootstrapHistory {

  /**
   * Walk from root to the deepest valid lineage for the current URL,
   * rebuilding the browser history stack at each depth.
   *
   * The processor handles bee loading after popstate fires — bootstrap
   * only validates the URL against the live cache and sets up history.
   */
  public run = async (): Promise<void> => {

    const store = get('@hypercomb.social/Store') as Store
    const utility = get('@hypercomb.social/CompletionUtility') as CompletionUtility

    const inputPath = window.location.pathname || '/'
    const inputSuffix = (window.location.search || '') + (window.location.hash || '')

    // use the same decode + normalize rules as navigation.cleanSegment
    const urlSegments = this.#parsePath(inputPath, utility)

    // prefer lineage segments if they exist and lineage is ready
    const lineage = this.#tryGetLineage()
    const lineageSegments = this.#tryGetLineageSegments(lineage)
    const rawSegments = lineageSegments.length ? lineageSegments : urlSegments

    // resolve deepest existing lineage in the live cache
    const existingSegments: string[] = []

    for (let i = 0; i < rawSegments.length; i++) {
      const seg = (rawSegments[i] ?? '').trim()
      if (!seg) continue

      const candidate = [...existingSegments, seg]
      const lineageSig = await computeLineageSig(candidate)
      const layer = store.getLayer(lineageSig)
      if (!layer) break

      existingSegments.push(seg)
    }

    const fullExists = existingSegments.length === rawSegments.length

    const finalPath =
      fullExists
        ? inputPath
        : (existingSegments.length ? ('/' + existingSegments.join('/')) : '/')

    const finalUrl = finalPath + inputSuffix

    // rebuild history stack
    // important: always restore finalUrl even if something fails, so the url never gets stuck at '/'
    try {
      window.history.replaceState({ i: 0, steps: [] as BootstrapStep[] }, '', '/')

      let path = ''
      let index = 0
      const steps: BootstrapStep[] = []

      for (let i = 0; i < existingSegments.length; i++) {
        const seg = existingSegments[i]

        path += `/${seg}`
        index++

        window.history.pushState({ i: index }, '', path)
        steps.push({ index, segment: seg, path })
      }

      // stash steps for debugging, but keep the current url correct
      try {
        const state = window.history.state as any
        window.history.replaceState({ ...state, i: index, steps }, '', finalUrl)
      } catch {
        // ignore
      }

    } catch {

      // if anything blows up after we touched '/', restore the url immediately
      try {
        window.history.replaceState(window.history.state, '', finalUrl)
      } catch {
        // ignore
      }

    } finally {

      // hard guarantee: end on finalUrl no matter what
      try {
        window.history.replaceState(window.history.state, '', finalUrl)
      } catch {
        // ignore
      }
    }

    this.#dispatchPopState()
  }

  #parsePath = (path: string, completions: CompletionUtility | null): string[] => {
    const parts = (path ?? '').split('/').filter(Boolean)
    return parts
      .map(p => this.#cleanSegment(p, completions))
      .filter(Boolean)
  }

  #cleanSegment = (s: string, completions: CompletionUtility | null): string => {
    const decoded = this.#safeDecode((s ?? '').trim())
    const noSlashes = decoded.replace(/[\/\\]+/g, ' ')
    if (completions?.normalize) return completions.normalize(noSlashes)
    return noSlashes.replace(/\s+/g, ' ').trim()
  }

  #safeDecode = (s: string): string => {
    try { return decodeURIComponent(s) } catch { return s }
  }

  #tryGetLineage = (): any | null => {
    try { return get('@hypercomb.social/Lineage') as any } catch { return null }
  }

  #tryGetLineageSegments = (lineage: any | null): string[] => {
    if (!lineage) return []

    try {
      const ready = (typeof lineage.ready === 'function') ? lineage.ready() : !!lineage.ready
      if (!ready) return []
    } catch {
      return []
    }

    try {
      const segs = lineage.explorerSegments?.()
      if (Array.isArray(segs) && segs.length) return segs.map((s: any) => (s ?? '').toString())
    } catch {
      // ignore
    }

    return []
  }

  #dispatchPopState = (): void => {
    try {
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
    } catch {
      // ignore
    }
  }
}

register('@hypercomb.social/BootstrapHistory', new BootstrapHistory())
