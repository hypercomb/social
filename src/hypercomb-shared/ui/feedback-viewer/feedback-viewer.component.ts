// hypercomb-shared/ui/feedback-viewer/feedback-viewer.component.ts
//
// Right-docked "Feedback" review panel — the host's inbox surface. Opened by
// the controls-bar feedback toggle (EffectBus `feedback:viewer-toggle`). It
// reads every `kind: 'feedback'` record straight out of the sign('optimization')
// pool (Store.listOptimizations — which unions the legacy `__optimization__`
// dir only while it drains) and lists them newest-first, with a
// per-item Resolve that removes the record. The hive stays visible/interactive
// behind it (host pointer-events:none; panel pointer-events:auto), mirroring
// the Features panel.
//
// Shell UI — never imports essentials; resolves the Store at runtime via the
// local `get` helper and coordinates over EffectBus only.

import { Component, signal, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'

/** Runtime service locator (shared must never import essentials). */
const get = (key: string): any => (globalThis as { ioc?: { get(k: string): unknown } }).ioc?.get(key)

type StoreLike = {
  listOptimizations?: () => Promise<string[]>
  getOptimization?: (sig: string) => Promise<Blob | null>
  removeOptimization?: (sig: string) => Promise<boolean>
}

interface FeedbackItem {
  sig: string
  category: string
  text: string
  route: string
  at: number
}

@Component({
  selector: 'hc-feedback-viewer',
  standalone: true,
  imports: [TranslatePipe, DockInsetDirective, HcDockedPanelDirective],
  templateUrl: './feedback-viewer.component.html',
  styleUrls: ['./feedback-viewer.component.scss'],
})
export class FeedbackViewerComponent implements OnDestroy {

  readonly visible = signal(false)
  readonly loading = signal(false)
  readonly items = signal<FeedbackItem[]>([])

  #cleanups: (() => void)[] = []

  constructor() {
    // Toggle from the controls-bar icon.
    this.#cleanups.push(EffectBus.on('feedback:viewer-toggle', () => {
      if (this.visible()) this.close()
      else void this.openPanel()
    }))
    // Explicit close (e.g. global escape cascade).
    this.#cleanups.push(EffectBus.on('feedback:viewer-close', () => this.close()))
    // Live-refresh while open on every inbound path. `feedback:submitted`
    // covers local submits and live swarm posts; `feedback:channel-ingested`
    // covers feedback that arrives over the durable feedback channel from
    // another OPFS / device / cloud (FeedbackChannelDrone writes with
    // emit:false, so this is its only signal to the open panel). reload() is
    // idempotent + dedup-safe, so subscribing to both is harmless.
    const liveRefresh = (): void => { if (this.visible()) void this.reload() }
    this.#cleanups.push(EffectBus.on('feedback:submitted', liveRefresh))
    this.#cleanups.push(EffectBus.on('feedback:channel-ingested', liveRefresh))
  }

  ngOnDestroy(): void {
    for (const c of this.#cleanups) c()
  }

  async openPanel(): Promise<void> {
    this.visible.set(true)
    // Broadcast open-state (last-value replayed) so the controls-bar button
    // can mirror an active highlight, the way the clipboard panel does.
    EffectBus.emit('feedback:viewer-open', { open: true })
    await this.reload()
  }

  close(): void {
    this.visible.set(false)
    EffectBus.emit('feedback:viewer-open', { open: false })
  }

  async reload(): Promise<void> {
    const store = get('@hypercomb.social/Store') as StoreLike | undefined
    if (!store?.listOptimizations || !store.getOptimization) { this.items.set([]); return }
    this.loading.set(true)
    try {
      const sigs = await store.listOptimizations()
      const out: FeedbackItem[] = []
      for (const sig of sigs) {
        const blob = await store.getOptimization(sig)
        if (!blob) continue
        try {
          const o = JSON.parse(await blob.text())
          if (o?.kind !== 'feedback') continue
          const p = o.payload ?? {}
          out.push({
            sig,
            category: String(p.category ?? 'idea'),
            text: String(p.text ?? ''),
            route: String(p.route ?? ''),
            at: Number(p.at ?? 0),
          })
        } catch { /* skip non-JSON */ }
      }
      out.sort((a, b) => b.at - a.at)   // newest first
      this.items.set(out)
    } finally {
      this.loading.set(false)
    }
  }

  async resolve(item: FeedbackItem): Promise<void> {
    const store = get('@hypercomb.social/Store') as StoreLike | undefined
    if (!store?.removeOptimization) return
    await store.removeOptimization(item.sig)
    this.items.update(list => list.filter(i => i.sig !== item.sig))
  }

  onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); this.close() }
  }

  // ── template helpers ────────────────────────────────────

  icon(category: string): string {
    return category === 'issue' ? 'bug_report' : 'lightbulb'
  }

  relativeTime(at: number): string {
    if (!at) return ''
    const diff = Date.now() - at
    const m = Math.floor(diff / 60000)
    if (m < 1) return 'just now'
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
  }

  trackBySig = (_i: number, item: FeedbackItem): string => item.sig
}
