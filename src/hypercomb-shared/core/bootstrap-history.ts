// hypercomb-shared/core/bootstrap-history.ts
// hypercomb-web/src/bootstrap/bootstrap-history.ts

import { CompletionUtility } from './completion-utility'

type BootstrapStep = {
  index: number
  segment: string
  path: string
}

export class BootstrapHistory {

  #hasRun = false

  public run = async (): Promise<void> => {
    if (this.#hasRun) return
    this.#hasRun = true

    const preloader = get('@hypercomb.social/ScriptPreloader') as any
    const utility = get('@hypercomb.social/CompletionUtility') as CompletionUtility

    const inputPath = window.location.pathname || '/'
    const inputSuffix = (window.location.search || '') + (window.location.hash || '')

    // use the same decode + normalize rules as navigation.cleanSegment
    const urlSegments = this.parsePath(inputPath, utility)

    // prefer lineage segments if they exist and lineage is ready
    const lineage = this.tryGetLineage()
    const lineageSegments = this.tryGetLineageSegments(lineage)
    const rawSegments =
      lineageSegments.length
        ? lineageSegments
        : urlSegments

    const finalUrl = inputPath + inputSuffix

    // rebuild history stack
    // important: always restore finalUrl even if something fails, so the url never gets stuck at '/'
    try {
      window.history.replaceState({ i: 0, steps: [] as BootstrapStep[] }, '', '/')

      // Always encounter root markers (global bees that load at every location)
      await this.encounter(preloader, '')

      let path = ''
      let index = 0
      const steps: BootstrapStep[] = []

      for (let i = 0; i < rawSegments.length; i++) {
        const seg = (rawSegments[i] ?? '').trim()
        if (!seg) continue

        path += `/${seg}`
        index++

        window.history.pushState({ i: index }, '', path)
        steps.push({ index, segment: seg, path })

        // replay: encounter this segment
        await this.encounter(preloader, seg)
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

    this.dispatchPopState()
  }

  private parsePath = (path: string, completions: CompletionUtility | null): string[] => {
    const parts = (path ?? '').split('/').filter(Boolean)
    return parts
      .map(p => this.cleanSegment(p, completions))
      .filter(Boolean)
  }

  private cleanSegment = (s: string, completions: CompletionUtility | null): string => {
    const decoded = this.safeDecode((s ?? '').trim())
    const noSlashes = decoded.replace(/[\/\\]+/g, ' ')
    if (completions?.normalize) return completions.normalize(noSlashes)
    return noSlashes.replace(/\s+/g, ' ').trim()
  }

  private safeDecode = (s: string): string => {
    try { return decodeURIComponent(s) } catch { return s }
  }

  private tryGetLineage = (): any | null => {
    try { return get('@hypercomb.social/Lineage') as any } catch { return null }
  }

  private tryGetLineageSegments = (lineage: any | null): string[] => {
    if (!lineage) return []

    // lineage.ready is now a boolean getter; fallback handles legacy signal form
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

  private encounter = async (preloader: any, seg: string): Promise<void> => {
    let bees: any[] = []
    try {
      bees = await preloader.find(seg)
    } catch {
      return
    }

    for (const b of bees) {
      try {
        const res = b?.pulse?.(seg)
        if (res && typeof res.then === 'function') await res
      } catch {
        // ignore
      }
    }
  }

  private dispatchPopState = (): void => {
    try {
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
    } catch {
      // ignore
    }
  }
}


register('@hypercomb.social/BootstrapHistory', new BootstrapHistory())