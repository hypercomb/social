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

    // Restore the URL synchronously and let bees load + pulse in the
    // background. The current level must never wait on the preloader —
    // the cell tree renders off cache; bees attach as they come up.
    const segments: string[] = []
    try {
      window.history.replaceState({ i: 0, steps: [] as BootstrapStep[] }, '', '/')

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
        segments.push(seg)
      }

      try {
        const state = window.history.state as any
        window.history.replaceState({ ...state, i: index, steps }, '', finalUrl)
      } catch {
        // ignore
      }

    } catch {

      try {
        window.history.replaceState(window.history.state, '', finalUrl)
      } catch {
        // ignore
      }

    } finally {

      try {
        window.history.replaceState(window.history.state, '', finalUrl)
      } catch {
        // ignore
      }
    }

    this.dispatchPopState()

    // Fire-and-forget bee loading + pulse, in URL order. Errors swallowed
    // per level so a single failure does not strand the chain.
    void (async () => {
      await this.encounter(preloader, '').catch(() => {})
      for (const seg of segments) {
        await this.encounter(preloader, seg).catch(() => {})
      }
    })()
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