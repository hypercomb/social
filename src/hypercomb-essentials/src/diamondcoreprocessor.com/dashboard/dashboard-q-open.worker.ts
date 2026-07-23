// diamondcoreprocessor.com/dashboard/dashboard-q-open.worker.ts
//
// Intercepts `tile:action` `'open'` events for tiles that are children
// of a `/dashboard`-rooted lineage and routes them to the QA modal
// instead of letting them fall through to LinkOpenWorker (which would
// `window.open` the source-cell URL in a new tab).
//
// Lookup path: the dashboard refresh script writes one
// `dashboard-q-binding` optimization per open Q with
// `appliesTo: ['dashboard', <child-label>]`. On click, this worker
// reads the optimization substrate, finds the binding whose
// `appliesTo` matches `[…explorerSegments, label]`, and hands the
// payload to QaModalView.show().
//
// LinkOpenWorker also receives the same effect. Now that the refresh
// script no longer stamps a `link` on dashboard children, it no-ops
// silently, so there's no race / dual-trigger.

import { Worker, EffectBus } from '@hypercomb/core'
import type { QaBindingPayload, QaModalView } from './qa-modal.view.js'

type TileActionPayload = { action: string; label: string; q: number; r: number; index: number }

type StoreLike = {
  listOptimizations?: () => Promise<string[]>
  getOptimization?: (sig: string) => Promise<Blob | null>
}

type LineageLike = {
  explorerSegments?: () => readonly string[]
}

const BINDING_KIND = 'dashboard-q-binding'

export class DashboardQOpenWorker extends Worker {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'dashboard'

  public override description =
    'Routes tile clicks on /dashboard children to the QA modal instead of opening the source cell in a new tab.'

  protected override emits: string[] = []

  // Parsed bindings keyed by their appliesTo path. Built by ONE pool scan
  // on the first click, then reused — scanning every optimization record
  // per click made the modal take visibly long to open on grown pools.
  // Any pool write may be a producer binding rewrite, so the cache drops
  // on `optimization:wrote` and rebuilds on the next click.
  #bindings: Map<string, QaBindingPayload> | null = null

  protected override act = async (): Promise<void> => {
    EffectBus.on<TileActionPayload>('tile:action', (payload) => {
      if (payload.action !== 'open') return
      void this.#handleOpen(payload.label)
    })
    EffectBus.on('optimization:wrote', () => { this.#bindings = null })
  }

  async #handleOpen(label: string): Promise<void> {
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    const segments = lineage?.explorerSegments?.() ?? []
    // Only intervene when we're sitting inside a dashboard. Two shapes:
    //   • literal ['dashboard', …] — the legacy node-script render target, and
    //   • the participant-local hidden bag DashboardBee navigates the toggle
    //     into (bindings there are keyed by [...bagSegments, label]).
    // DashboardProducerDrone writes bindings whose appliesTo matches whichever
    // location holds the open-question tiles, so #findBinding resolves both.
    const inBag = get<{ isActive?: () => boolean }>('@diamondcoreprocessor.com/DashboardBee')?.isActive?.() === true
    if (segments[0] !== 'dashboard' && !inBag) return

    const targetPath = [...segments, label]
    const binding = await this.#findBinding(targetPath)
    if (!binding) return

    const modal = get<QaModalView>('@diamondcoreprocessor.com/QaModalView')
    if (!modal) return
    modal.show(binding)
  }

  async #findBinding(targetPath: readonly string[]): Promise<QaBindingPayload | null> {
    const cache = this.#bindings ?? await this.#scanBindings()
    return cache.get(targetPath.join('|')) ?? null
  }

  async #scanBindings(): Promise<Map<string, QaBindingPayload>> {
    const cache = new Map<string, QaBindingPayload>()
    this.#bindings = cache
    const store = get<StoreLike>('@hypercomb.social/Store')
    if (!store?.listOptimizations || !store?.getOptimization) return cache

    const sigs = await store.listOptimizations()
    for (const sig of sigs) {
      const blob = await store.getOptimization(sig)
      if (!blob) continue
      let parsed: { kind?: string; appliesTo?: unknown; payload?: unknown }
      try { parsed = JSON.parse(await blob.text()) } catch { continue }
      if (parsed.kind !== BINDING_KIND) continue
      if (!Array.isArray(parsed.appliesTo)) continue
      const ap = (parsed.appliesTo as unknown[]).map(String)
      const payload = parsed.payload as Partial<QaBindingPayload> | undefined
      if (!payload || typeof payload.qId !== 'string' || typeof payload.question !== 'string') continue
      cache.set(ap.join('|'), {
        qId: payload.qId,
        qSig: typeof payload.qSig === 'string' ? payload.qSig : '',
        qPath: Array.isArray(payload.qPath) ? payload.qPath.map(String) : [],
        question: payload.question,
        bagPath: ap,
      })
    }
    return cache
  }
}

const _dashboardQOpen = new DashboardQOpenWorker()
window.ioc.register('@diamondcoreprocessor.com/DashboardQOpenWorker', _dashboardQOpen)
