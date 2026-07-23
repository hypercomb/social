// hypercomb-shared/ui/feedback-viewer/feedback-viewer.component.ts
//
// Right-docked "Feedback" panel — THE feedback surface, opened from the
// command-line header's feedback toggle (EffectBus `feedback:toggle`; state
// mirrored back on `feedback:panel-state` so the header icon lights). It
// absorbs what used to be two controls: the top of the panel is the inbox
// (every `kind: 'feedback'` record from the sign('optimization') pool,
// newest-first, per-item Resolve), the bottom is the share-feedback compose
// form (category + message; the visitor permission handshake rides along).
//
// The list is REACH-SCOPED like the pheromone filter: three icons in the
// header pick local (this page) / children (this page and below) / global
// (the whole hive), matched against each record's `route`. The current
// location re-reads on every `navigation:guard-end`, so navigating with the
// panel open re-filters live. Non-sticky — each session opens at 'local'.
//
// The hive stays visible/interactive behind it (host pointer-events:none;
// panel pointer-events:auto), mirroring the Features panel.
//
// Shell UI — never imports essentials; resolves Store/Navigation/Swarm at
// runtime via the local `get` helper and coordinates over EffectBus only.

import { registerShellSurface } from '../../core/shell-surface-registry'
import { Component, computed, signal, type OnDestroy } from '@angular/core'
import { FormsModule } from '@angular/forms'
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
  putOptimization?: (blob: Blob) => Promise<string>
}
type NavigationLike = { segmentsRaw?: () => readonly string[] }
type I18nLike = { t?: (key: string, params?: Record<string, unknown>) => string }
type SwarmLike = { subscribedTo?: () => string | null }
type FeedbackSwarmLike = { isGrantedBy?: (host: string) => boolean }

const HEX64 = /^[0-9a-f]{64}$/
type FeedbackCategory = 'idea' | 'issue'
type Scope = 'local' | 'children' | 'global'

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
  imports: [FormsModule, TranslatePipe, DockInsetDirective, HcDockedPanelDirective],
  templateUrl: './feedback-viewer.component.html',
  styleUrls: ['./feedback-viewer.component.scss'],
})
export class FeedbackViewerComponent implements OnDestroy {

  readonly visible = signal(false)
  readonly loading = signal(false)
  readonly items = signal<FeedbackItem[]>([])

  // ── reach scope (mirrors the pheromone panel's three reaches) ──
  readonly scope = signal<Scope>('local')
  readonly scopeOptions: readonly { id: Scope; icon: string }[] = [
    { id: 'local', icon: 'center_focus_strong' },
    { id: 'children', icon: 'account_tree' },
    { id: 'global', icon: 'public' },
  ]
  /** Current location as a route string — re-read on navigation:guard-end. */
  readonly #route = signal('')

  /** The inbox, narrowed to the picked reach around the current location. */
  readonly scoped = computed<FeedbackItem[]>(() => {
    const scope = this.scope()
    if (scope === 'global') return this.items()
    const here = this.#route()
    return this.items().filter(i => scope === 'local'
      ? i.route === here
      : i.route === here || (here === '' || i.route.startsWith(here + '/')))
  })

  // ── compose form ────────────────────────────────────────
  readonly sending = signal(false)
  readonly category = signal<FeedbackCategory>('idea')
  /** Bound to the textarea via ngModel. */
  text = ''

  // ── swarm context (remote feedback) ─────────────────────
  /** When viewing someone else's hive over the swarm, the host's pubkey;
   *  null on your own hive (where feedback is written locally). */
  readonly host = signal<string | null>(null)
  /** The host has approved this participant to post feedback. */
  readonly granted = signal(false)
  /** A permission request has been sent and is awaiting the host's decision. */
  readonly requested = signal(false)

  /** Visitor on another hive who hasn't been granted yet → the form asks
   *  for permission instead of posting. */
  get needsPermission(): boolean {
    return this.host() !== null && !this.granted()
  }

  #cleanups: (() => void)[] = []

  constructor() {
    // Toggle from the command-line header's feedback icon.
    this.#cleanups.push(EffectBus.on('feedback:toggle', () => {
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
    // Navigating with the panel open re-scopes the list to the new page.
    this.#cleanups.push(EffectBus.on('navigation:guard-end', () => {
      if (this.visible()) this.#refreshRoute()
    }))
    // Activate the compose form the moment the host approves us.
    this.#cleanups.push(EffectBus.on<{ host?: string }>('feedback:access-granted', (p) => {
      const h = String(p?.host ?? '').trim().toLowerCase()
      if (h && h === this.host()) {
        this.granted.set(true)
        this.requested.set(false)
        this.#toast('success', 'feedback.granted.title', 'feedback.granted.message')
      }
    }))
  }

  ngOnDestroy(): void {
    for (const c of this.#cleanups) c()
  }

  async openPanel(): Promise<void> {
    this.#refreshRoute()
    this.#refreshContext()
    this.visible.set(true)
    // Broadcast open-state (last-value replayed) so the header toggle lights.
    EffectBus.emit('feedback:panel-state', { open: true })
    // Focus the panel so Escape lands without an extra click.
    queueMicrotask(() => {
      document.querySelector<HTMLElement>('.feedback-viewer-panel')?.focus()
    })
    await this.reload()
  }

  close(): void {
    this.visible.set(false)
    EffectBus.emit('feedback:panel-state', { open: false })
  }

  setScope(id: Scope): void {
    this.scope.set(id)
  }

  #refreshRoute(): void {
    const nav = get('@hypercomb.social/Navigation') as NavigationLike | undefined
    this.#route.set((nav?.segmentsRaw?.() ?? []).map(String).join('/'))
  }

  /** Resolve whether we're a visitor (and on whose hive) + our grant state.
   *  Both swarm drones are essentials, resolved at runtime via window.ioc. */
  #refreshContext(): void {
    const swarm = get('@diamondcoreprocessor.com/SwarmDrone') as SwarmLike | undefined
    const h = String(swarm?.subscribedTo?.() ?? '').trim().toLowerCase()
    const host = HEX64.test(h) ? h : null
    this.host.set(host)
    if (host) {
      const fs = get('@diamondcoreprocessor.com/FeedbackSwarmDrone') as FeedbackSwarmLike | undefined
      this.granted.set(!!fs?.isGrantedBy?.(host))
    } else {
      this.granted.set(false)
    }
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

  // ── compose ─────────────────────────────────────────────

  readonly setCategory = (c: FeedbackCategory): void => {
    this.category.set(c)
  }

  get canSend(): boolean {
    return this.text.trim().length > 0 && !this.sending()
  }

  /** Drives the primary button's enabled state across both modes. */
  get canSubmit(): boolean {
    if (this.needsPermission) return !this.requested() && !this.sending()
    return this.canSend
  }

  async submit(): Promise<void> {
    // Ungranted visitor → ask the host's permission instead of posting.
    if (this.needsPermission) { this.requestAccess(); return }
    if (!this.canSend) return
    this.sending.set(true)
    try {
      const nav = get('@hypercomb.social/Navigation') as NavigationLike | undefined
      const segments = (nav?.segmentsRaw?.() ?? []).map(String)
      // Same payload the loop reads (id/category/text/route/at).
      const payload = {
        id: `fb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        category: this.category(),
        text: this.text.trim(),
        route: segments.join('/'),
        at: Date.now(),
      }
      const host = this.host()
      if (host && this.granted()) {
        // Granted visitor → post over the swarm to the host's inbox; the
        // FeedbackSwarmDrone publishes it and the host ingests it.
        EffectBus.emit('feedback:remote-post', { host, payload: { ...payload, appliesTo: segments } })
      } else {
        // Own hive → write straight to the local optimization inbox, the
        // exact same record shape the Q&A modal mints. `feedback:submitted`
        // triggers our own live refresh, so the new item appears in the list.
        const store = get('@hypercomb.social/Store') as StoreLike | undefined
        if (!store?.putOptimization) { this.#toast('error', 'feedback.error.title', 'feedback.error.message'); return }
        const record = { kind: 'feedback', appliesTo: segments, payload, mark: 'persistent' }
        await store.putOptimization(new Blob([new TextEncoder().encode(JSON.stringify(record)) as BlobPart]))
        EffectBus.emit('feedback:submitted', {})
      }
      this.#toast('success', 'feedback.sent.title', 'feedback.sent.message')
      this.text = ''
      this.category.set('idea')
    } catch (err) {
      console.warn('[feedback] submit failed', err)
      this.#toast('error', 'feedback.error.title', 'feedback.error.message')
    } finally {
      this.sending.set(false)
    }
  }

  /** Visitor: ask the host for permission to share feedback. The
   *  FeedbackSwarmDrone publishes the request over the swarm; the host sees a
   *  consent toast and, on approval, our `feedback:access-granted` fires. */
  requestAccess(): void {
    const host = this.host()
    if (!host || this.requested()) return
    EffectBus.emit('feedback:request-access', { host })
    this.requested.set(true)
    this.#toast('success', 'feedback.request.title', 'feedback.request.message')
  }

  onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); this.close() }
    else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void this.submit() }
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

  // ── helpers ─────────────────────────────────────────────

  /** Toasts take resolved strings (not keys), so localize here with an
   *  English fallback before emitting on the shared bus. */
  #toast(type: 'success' | 'error', titleKey: string, messageKey: string): void {
    const i18n = get('@hypercomb.social/I18n') as I18nLike | undefined
    const fallback: Record<string, string> = {
      'feedback.sent.title': 'Thank you',
      'feedback.sent.message': 'Your feedback is on its way.',
      'feedback.error.title': 'Could not send',
      'feedback.error.message': 'Please try again in a moment.',
      'feedback.request.title': 'Request sent',
      'feedback.request.message': "Waiting for the host to allow you to share feedback.",
      'feedback.granted.title': "You're in",
      'feedback.granted.message': 'The host approved you — share away.',
    }
    EffectBus.emit('toast:show', {
      type,
      title: i18n?.t?.(titleKey) ?? fallback[titleKey] ?? '',
      message: i18n?.t?.(messageKey) ?? fallback[messageKey] ?? '',
    })
  }
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-feedback-viewer',
  owner: '@hypercomb.shared/FeedbackViewerComponent',
  component: FeedbackViewerComponent,
  order: 200,
})
