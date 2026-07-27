// hypercomb-shared/ui/feedback-viewer/feedback-viewer.component.ts
//
// Right-docked "Feedback" panel — THE inbox for everything that arrives from
// someone else, opened from the command-line header's feedback toggle
// (EffectBus `feedback:toggle`; state mirrored back on `feedback:panel-state`
// so the header icon lights). The dashboard is gone (2026-07-26): its one real
// job — showing open questions and taking an answer — lives here now, so there
// is ONE place to look instead of a hidden hex bag nobody found.
//
// The list is a union of two record kinds from the sign('optimization') pool,
// newest-first:
//   • `feedback` — what a participant shared (mine, or another participant's,
//     arriving over the swarm handshake or the durable feedback channel).
//     Per-item Resolve retires it.
//   • `qa` — an open QUESTION addressed to me: minted by the feedback-loop
//     routine, by a workflow `ask` step, or by the responder answering a
//     hive-wide `/opus`-style ask. Answering inline writes a `qa-answer`
//     record (the raw answer is decoration, never canonical content — the
//     next codegen pass interprets it into a note) and removes the open `qa`,
//     which is exactly what the retired QaModalView did.
//
// WHO SENT IT: every record carries the participant's identity — `by` (their
// chosen name) and `from` (their nostr pubkey). The compose form REQUIRES a
// name before it will send, and each row shows it, so feedback arriving from
// the community is never anonymous noise.
//
// The bottom is the share-feedback compose form (name + category + message;
// the visitor permission handshake rides along).
//
// FEEDBACK is REACH-SCOPED like the pheromone filter: three icons in the reach
// row under the header pick local (this page) / children (this page and below)
// / global (the whole hive), matched against each record's `route`. The current
// location re-reads on every `navigation:guard-end`, so navigating with the
// panel open re-filters live. Non-sticky — each session opens at 'local'.
// QUESTIONS are exempt (see `scoped`) — they are addressed to you, not to a
// place.
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
type NavigationLike = { segmentsRaw?: () => readonly string[]; goRaw?: (segments: readonly string[]) => void }
type I18nLike = { t?: (key: string, params?: Record<string, unknown>) => string }
type SwarmLike = { subscribedTo?: () => string | null }
type FeedbackSwarmLike = { isGrantedBy?: (host: string) => boolean }
type SignerLike = { getPublicKeyHex?: () => Promise<string | null> }

const HEX64 = /^[0-9a-f]{64}$/
/** The participant's chosen display name. The SAME key the mesh modal writes
 *  and the swarm handshake reads — one identity across every surface. */
const LABEL_KEY = 'hc:user-label'
type FeedbackCategory = 'idea' | 'issue'
type Scope = 'local' | 'children' | 'global'

interface FeedbackItem {
  sig: string
  /** `feedback` = something shared; `qa` = an open question awaiting my
   *  answer; `reply` = the host's response to feedback I sent, delivered
   *  back over my pubkey-derived reply channel. */
  kind: 'feedback' | 'qa' | 'reply'
  category: string
  text: string
  route: string
  at: number
  /** The record's own stable id (fb-… / qId) — what a reply references. */
  id: string
  /** Who it came from — their chosen name ('' when a legacy record carries none). */
  by: string
  /** Their nostr pubkey, when known. The ADDRESS a reply is sent to. */
  from: string
  /** `qa` only — the question's stable id, carried into the answer record. */
  qId: string
  /** `qa` only — the lineage the question is about (its `appliesTo`). */
  qPath: readonly string[]
  /** `reply` only — a short quote of the original feedback it answers. */
  re: string
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

  /** The inbox, narrowed to the picked reach around the current location.
   *
   *  QUESTIONS AND REPLIES ARE NEVER SCOPED OUT. Feedback is about a PLACE,
   *  so the reach filter is the right lens for it; a question or a reply is
   *  addressed to YOU, and one tied to a tile three levels down would be
   *  invisible from wherever you happened to be standing — which is exactly
   *  the "the dashboard is always empty" failure this panel replaced. */
  readonly scoped = computed<FeedbackItem[]>(() => {
    const scope = this.scope()
    if (scope === 'global') return this.items()
    const here = this.#route()
    return this.items().filter(i => i.kind !== 'feedback' || (scope === 'local'
      ? i.route === here
      : i.route === here || (here === '' || i.route.startsWith(here + '/'))))
  })

  // ── compose form ────────────────────────────────────────
  readonly sending = signal(false)
  readonly category = signal<FeedbackCategory>('idea')
  /** Bound to the textarea via ngModel. */
  text = ''

  // ── identity ────────────────────────────────────────────
  /** The participant's display name, bound to the compose form's name field.
   *  Persisted to `hc:user-label` on send — the same identity the mesh modal
   *  and the swarm feedback handshake use. */
  name = ''
  /** True once a name exists, so the field can collapse out of the way. */
  readonly named = signal(false)
  /** Set when a send was refused for want of a name, to light the field. */
  readonly nameMissing = signal(false)
  /** My own pubkey, resolved once — stamped on everything I write so the
   *  receiving host can tell two people with the same name apart. */
  #myPubkey: string | null = null

  // ── inline question answering (what the QA modal used to do) ──
  /** sig of the `qa` row whose answer box is open, or null. */
  readonly answering = signal<string | null>(null)
  /** Bound to the open answer textarea. */
  answer = ''

  // ── inline replying (host → the item's sender, over their pubkey channel) ──
  /** sig of the row whose reply box is open, or null. */
  readonly replyingTo = signal<string | null>(null)
  /** Bound to the open reply textarea. */
  reply = ''

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
    // A host's reply landed on MY pubkey-derived channel (FeedbackReplyDrone
    // ingests with emit:false, so this is its only signal to an open panel).
    this.#cleanups.push(EffectBus.on('feedback:reply-ingested', liveRefresh))
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
    this.#refreshIdentity()
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

  /** Load the stored name into the field and resolve my pubkey in the
   *  background (the signer is essentials, so it may not be up yet — a missing
   *  pubkey never blocks sending, the NAME is what identifies a person). */
  #refreshIdentity(): void {
    let stored = ''
    try { stored = String(localStorage.getItem(LABEL_KEY) ?? '').trim().slice(0, 64) } catch { /* private mode */ }
    if (stored && !this.name.trim()) this.name = stored
    this.named.set(!!this.name.trim())
    if (this.#myPubkey) return
    const signer = get('@diamondcoreprocessor.com/NostrSigner') as SignerLike | undefined
    void signer?.getPublicKeyHex?.().then(pk => {
      const p = String(pk ?? '').trim().toLowerCase()
      if (HEX64.test(p)) this.#myPubkey = p
    }).catch(() => { /* no identity yet — the name still stands */ })
  }

  /** Persist the typed name as THE participant identity (same key the mesh
   *  modal writes), and return it. Empty when the participant hasn't named
   *  themselves — callers refuse to send on that. */
  #commitName(): string {
    const clean = this.name.trim().slice(0, 64)
    if (!clean) return ''
    try { localStorage.setItem(LABEL_KEY, clean) } catch { /* private mode — in-session only */ }
    this.named.set(true)
    this.nameMissing.set(false)
    return clean
  }

  /** The identity stamped on every record this participant writes. */
  #identity(): { by: string; from: string } {
    return { by: this.#commitName(), from: this.#myPubkey ?? '' }
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
          const p = o?.payload ?? {}
          const by = String(p.by ?? p.label ?? '')
          const from = String(p.from ?? '')
          if (o?.kind === 'feedback') {
            out.push({
              sig,
              kind: 'feedback',
              category: String(p.category ?? 'idea'),
              text: String(p.text ?? ''),
              route: String(p.route ?? ''),
              at: Number(p.at ?? 0),
              id: String(p.id ?? ''),
              by, from,
              qId: '',
              qPath: [],
              re: '',
            })
          } else if (o?.kind === 'feedback-reply') {
            // The host's answer to feedback I sent — arrived over my own
            // pubkey-derived reply channel (FeedbackReplyDrone).
            const text = String(p.text ?? '').trim()
            if (!text) continue
            out.push({
              sig,
              kind: 'reply',
              category: 'reply',
              text,
              route: '',
              at: Number(p.at ?? 0),
              id: String(p.reId ?? ''),
              by, from,
              qId: '',
              qPath: [],
              re: String(p.re ?? ''),
            })
          } else if (o?.kind === 'qa') {
            // An OPEN question — the record the dashboard used to render as a
            // hex tile. `appliesTo` is the lineage it concerns, which doubles
            // as its route so the reach filter narrows questions exactly like
            // feedback.
            const question = String(p.question ?? '').trim()
            if (!question) continue
            const path = Array.isArray(o.appliesTo) ? (o.appliesTo as unknown[]).map(String) : []
            out.push({
              sig,
              kind: 'qa',
              category: 'question',
              text: question,
              route: path.join('/'),
              at: Number(p.askedAt ?? p.at ?? 0),
              id: String(p.qId ?? sig.slice(0, 16)),
              by, from,
              qId: String(p.qId ?? sig.slice(0, 16)),
              qPath: path,
              re: '',
            })
          }
        } catch { /* skip non-JSON */ }
      }
      // Bands: questions first (waiting on the participant), then replies
      // (news for the participant), then feedback — newest-first within each.
      const band = (k: FeedbackItem['kind']): number => k === 'qa' ? 0 : k === 'reply' ? 1 : 2
      out.sort((a, b) => (band(a.kind) - band(b.kind)) || (b.at - a.at))
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

  // ── answering an open question (the retired QA modal, inline) ──

  /** Open / close the answer box on a question row. One at a time. */
  toggleAnswer(item: FeedbackItem): void {
    if (this.answering() === item.sig) { this.answering.set(null); this.answer = ''; return }
    this.answering.set(item.sig)
    this.answer = ''
  }

  /** Go to the tile the question is about, without losing the panel. */
  goToQuestion(item: FeedbackItem): void {
    if (!item.qPath.length) return
    const nav = get('@hypercomb.social/Navigation') as NavigationLike | undefined
    nav?.goRaw?.([...item.qPath])
  }

  get canAnswer(): boolean {
    return this.answer.trim().length > 0 && !this.sending()
  }

  /** Mint a `qa-answer` pairing the question with the participant's raw answer,
   *  then retire the open `qa`. The raw text is DECORATION, not canonical
   *  content: it rests in the sign('optimization') pool until the next codegen
   *  pass interprets it into a note. Identical to what QaModalView committed —
   *  plus the identity, so the routine knows whose answer it is. */
  async submitAnswer(item: FeedbackItem): Promise<void> {
    if (!this.canAnswer) return
    const store = get('@hypercomb.social/Store') as StoreLike | undefined
    if (!store?.putOptimization) { this.#toast('error', 'feedback.error.title', 'feedback.error.message'); return }
    const text = this.answer.trim()
    this.sending.set(true)
    try {
      const { by, from } = this.#identity()
      const record = {
        kind: 'qa-answer',
        appliesTo: [...item.qPath],
        payload: {
          qId: item.qId,
          qSig: item.sig,
          question: item.text,
          answer: text,
          answeredAt: Date.now(),
          ...(by ? { by } : {}),
          ...(from ? { from } : {}),
        },
        mark: 'persistent',
      }
      await store.putOptimization(new Blob([new TextEncoder().encode(JSON.stringify(record)) as BlobPart]))
      // The open question is answered — retire it so it stops asking.
      try { await store.removeOptimization?.(item.sig) } catch { /* tolerate */ }
      this.items.update(list => list.filter(i => i.sig !== item.sig))
      this.answering.set(null)
      this.answer = ''
      this.#toast('success', 'feedback.answered.title', 'feedback.answered.message')
    } catch (err) {
      console.warn('[feedback] answer failed', err)
      this.#toast('error', 'feedback.error.title', 'feedback.error.message')
    } finally {
      this.sending.set(false)
    }
  }

  onAnswerKey(event: KeyboardEvent, item: FeedbackItem): void {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.toggleAnswer(item) }
    else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void this.submitAnswer(item) }
  }

  // ── replying to a sender (the return channel) ───────────

  /** A row can be replied to when it carries an ADDRESS — the sender's
   *  pubkey — and that address isn't me. The pubkey is the "code" each
   *  instance provides automatically; the name is display-only on top. */
  canReply(item: FeedbackItem): boolean {
    return item.kind === 'feedback' && HEX64.test(item.from) && item.from !== this.#myPubkey
  }

  /** Open / close the reply box on a row. One at a time. */
  toggleReply(item: FeedbackItem): void {
    if (this.replyingTo() === item.sig) { this.replyingTo.set(null); this.reply = ''; return }
    this.replyingTo.set(item.sig)
    this.reply = ''
  }

  get canSendReply(): boolean {
    return this.reply.trim().length > 0 && !this.sending()
  }

  /** Send the reply back to the item's sender over their pubkey-derived
   *  channel (FeedbackReplyDrone). It lands in THEIR feedback window as a
   *  `reply` row quoting this item. Requires a name — a reply from nobody is
   *  the same failure as feedback from nobody. */
  async submitReply(item: FeedbackItem): Promise<void> {
    if (!this.canSendReply || !this.canReply(item)) return
    if (!this.name.trim()) {
      this.nameMissing.set(true)
      this.#toast('error', 'feedback.identity.title', 'feedback.identity.message')
      return
    }
    const drone = get('@diamondcoreprocessor.com/FeedbackReplyDrone') as
      { sendReply?: (r: Record<string, unknown>) => Promise<boolean> } | undefined
    if (!drone?.sendReply) { this.#toast('error', 'feedback.reply.error.title', 'feedback.reply.error.message'); return }
    this.sending.set(true)
    try {
      const { by, from } = this.#identity()
      const ok = await drone.sendReply({
        to: item.from,
        text: this.reply.trim(),
        reId: item.id,
        re: item.text.slice(0, 280),
        by, from,
      })
      if (!ok) { this.#toast('error', 'feedback.reply.error.title', 'feedback.reply.error.message'); return }
      this.replyingTo.set(null)
      this.reply = ''
      this.#toast('success', 'feedback.replied.title', 'feedback.replied.message')
    } finally {
      this.sending.set(false)
    }
  }

  onReplyKey(event: KeyboardEvent, item: FeedbackItem): void {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.toggleReply(item) }
    else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void this.submitReply(item) }
  }

  // ── compose ─────────────────────────────────────────────

  readonly setCategory = (c: FeedbackCategory): void => {
    this.category.set(c)
  }

  /** A name AND a message — feedback that reaches a host must say who it is
   *  from, so the name is part of "can this be sent" rather than an optional
   *  extra the sender skips. */
  get canSend(): boolean {
    return this.text.trim().length > 0 && this.name.trim().length > 0 && !this.sending()
  }

  /** Drives the primary button's enabled state across both modes. */
  get canSubmit(): boolean {
    if (this.needsPermission) return !this.requested() && this.name.trim().length > 0 && !this.sending()
    return this.canSend
  }

  /** Clear the "name required" flag as soon as the participant types one. */
  onNameInput(): void {
    if (this.nameMissing() && this.name.trim()) this.nameMissing.set(false)
  }

  async submit(): Promise<void> {
    // No name = no send. The host has to be able to tell who an item is from,
    // and a name typed once is remembered for every surface (mesh, swarm).
    if (!this.name.trim()) {
      this.nameMissing.set(true)
      this.#toast('error', 'feedback.identity.title', 'feedback.identity.message')
      queueMicrotask(() => document.querySelector<HTMLInputElement>('.fv-name-input')?.focus())
      return
    }
    // Ungranted visitor → ask the host's permission instead of posting.
    if (this.needsPermission) { this.requestAccess(); return }
    if (!this.canSend) return
    this.sending.set(true)
    try {
      const nav = get('@hypercomb.social/Navigation') as NavigationLike | undefined
      const segments = (nav?.segmentsRaw?.() ?? []).map(String)
      const { by, from } = this.#identity()
      // Same payload the loop reads (id/category/text/route/at), plus the
      // identity so every item in the list can say who it came from.
      const payload = {
        id: `fb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        category: this.category(),
        text: this.text.trim(),
        route: segments.join('/'),
        at: Date.now(),
        by,
        ...(from ? { from } : {}),
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
   *  consent toast and, on approval, our `feedback:access-granted` fires. The
   *  name rides along so the host's consent toast names a person, not a
   *  pubkey prefix. */
  requestAccess(): void {
    const host = this.host()
    if (!host || this.requested()) return
    EffectBus.emit('feedback:request-access', { host, label: this.#commitName() })
    this.requested.set(true)
    this.#toast('success', 'feedback.request.title', 'feedback.request.message')
  }

  onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); this.close() }
    else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void this.submit() }
  }

  // ── template helpers ────────────────────────────────────

  icon(item: FeedbackItem): string {
    if (item.kind === 'qa') return 'help'
    if (item.kind === 'reply') return 'reply'
    return item.category === 'issue' ? 'bug_report' : 'lightbulb'
  }

  /** Who the row is from, resolved for display: the name if they gave one,
   *  else a short pubkey, else nothing (the row simply shows no author). */
  author(item: FeedbackItem): string {
    const by = item.by.trim()
    if (by) return by
    return item.from ? `${item.from.slice(0, 8)}…` : ''
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
      'feedback.identity.title': 'Who is this from?',
      'feedback.identity.message': 'Add your name so the host knows who sent it.',
      'feedback.answered.title': 'Answer recorded',
      'feedback.answered.message': 'Thanks — the question is closed.',
      'feedback.replied.title': 'Reply sent',
      'feedback.replied.message': "It will arrive in the sender's feedback window.",
      'feedback.reply.error.title': "Couldn't send the reply",
      'feedback.reply.error.message': 'The mesh may be down — try again in a moment.',
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
