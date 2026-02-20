// hypercomb-shared/core/bootstrap-history.ts
// hypercomb-web/src/bootstrap/bootstrap-history.ts

import { DirectoryWalker } from './directory-walker'
import { Store } from './store'

type BootstrapStep = {
  index: number
  segment: string
  path: string
}

export class BootstrapHistory {

  // note: reserved for later; current bootstrap starts at store.hypercombRoot
  private readonly defaultDomain = 'hypercomb.io'

  public run = async (): Promise<void> => {
    const { get, register, list } = window.ioc
    void register
    void list

    const store = get('Store') as Store
    const preloader = get('ScriptPreloader') as any

    const inputPath = window.location.pathname || '/'
    const inputSuffix = (window.location.search || '') + (window.location.hash || '')
    const urlSegments = this.parsePath(inputPath)

    // root for now is just the hypercomb root
    // note: when you introduce per-domain roots, swap this for getDirectoryHandle(this.defaultDomain)
    const domainRoot = store.hypercombRoot

    // current starts at domain root
    store.setCurrentHandle(domainRoot, [])

    // prefer lineage segments if they exist and lineage is ready
    const lineage = this.tryGetLineage()
    const lineageSegments = this.tryGetLineageSegments(lineage)
    const rawSegments =
      lineageSegments.length
        ? lineageSegments
        : urlSegments

    // walker strategy: build a path->handle lookup so we never mutate url until we know the answer
    const walker = get('DirectoryWalker') as DirectoryWalker
    const directories = await walker.walk(domainRoot)

    // map key is "a/b/c" (no leading slash), rooted at domainRoot
    const byPath = new Map<string, FileSystemDirectoryHandle>()
    byPath.set('', domainRoot)

    for (const d of directories as any[]) {
      const parts = (d?.path ?? []) as string[]
      const handle = (d?.handle ?? null) as FileSystemDirectoryHandle | null
      if (!handle) continue
      byPath.set(parts.join('/'), handle)
    }

    // resolve deepest existing lineage for the current segments
    const existingSegments: string[] = []
    const existingDirs: FileSystemDirectoryHandle[] = []

    let cursor = ''

    for (let i = 0; i < rawSegments.length; i++) {
      const seg = (rawSegments[i] ?? '').trim()
      if (!seg) continue

      cursor = cursor ? `${cursor}/${seg}` : seg

      const dir = byPath.get(cursor)
      if (!dir) break

      existingSegments.push(seg)
      existingDirs.push(dir)
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
        const dir = existingDirs[i]

        path += `/${seg}`
        index++

        window.history.pushState({ i: index }, '', path)
        steps.push({ index, segment: seg, path })

        // advance current folder for runtime
        store.setCurrentHandle(dir, existingSegments.slice(0, i + 1))

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

  private parsePath = (path: string): string[] => {
    return (path ?? '').split('/').map(s => s.trim()).filter(Boolean)
  }

  private tryGetLineage = (): any | null => {
    try { return window.ioc.get('Lineage') as any } catch { return null }
  }

  private tryGetLineageSegments = (lineage: any | null): string[] => {
    if (!lineage) return []

    // lineage.ready is a signal, so read via ready()
    try {
      const ready = (typeof lineage.ready === 'function') ? lineage.ready() : false
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
    let drones: any[] = []
    try {
      drones = await preloader.find(seg)
    } catch {
      return
    }

    for (const d of drones) {
      try {
        const res = d?.encounter?.(seg)
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

const { get, register, list } = window.ioc
void get
void list
window.ioc.register('BootstrapHistory', new BootstrapHistory())
