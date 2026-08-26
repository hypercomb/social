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
//     Per-item Resolve adds a local `kind:'hidden'` marker. The feedback bytes
//     stay put, so a relay replay cannot resurrect the row and the panel's
//     explicit "show hidden" lens can still visit / restore feedback history.
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
// PAGE-ADDRESSED ITEMS are reach-scoped like the pheromone filter: three icons
// pick local (this page) / children (this page and below) / global (the whole
// hive), matched against each record's `route`. The current location re-reads
// on the immediate browser `navigate` event and after `navigation:guard-end`,
// so navigating with the panel open re-filters live. Non-sticky — each
// session opens at 'local'. Return-channel replies have no route and remain
// visible until resolved.
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
import { signalSession } from '@hypercomb/core'
import {
  feedbackMatchesReach,
  indexFeedbackRetirements,
  questionWasAnswered,
  visibleFeedbackItems,
} from './feedback-retirement'

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
  /** `qa` only: an AI request that needs a decision instead of prose. */
  approval: boolean
  /** `qa` only: plain-language provenance for why the question needs the
   *  participant. Questions without this were indistinguishable from rows
   *  mysteriously returning after they had already been handled. */
  why: string
  /** `reply` only — a short quote of the original feedback it answers. */
  re: string
  /** Resolve is a visibility lens, never deletion. This is the signature of
   *  the local `kind:'hidden'` marker targeting this item, when one exists. */
  hiddenRecordSig: string
  /** The feedback loop's durable processed ledger. A replayed feedback record
   *  remains retired when its stable id has already been marked seen. */
  seenRecordSig: string
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

  /** Put away while the hive is covered — including anything half-typed in the
   *  composer, which a reload-free return must not throw away. */
  readonly session = signalSession(
    this.visible,
    open => EffectBus.emit('feedback:panel-state', { open }),
    { close: () => this.close() },
  )

  readonly loading = signal(false)
  readonly items = signal<FeedbackItem[]>([])
  /** Feedback history is an explicit panel-local lens. Tile hiding can
   *  auto-enable the application's global `hc:show-hidden` state, so sharing
   *  that state leaked retired feedback into the normal inbox. */
  readonly showHidden = signal(false)
  readonly shownItems = computed<FeedbackItem[]>(() =>
    visibleFeedbackItems(this.items(), this.showHidden(), item => this.isRetired(item)))

  // ── reach scope (mirrors the pheromone panel's three reaches) ──
  readonly scope = signal<Scope>('local')
  /** The three reaches in cycle order — the toggle's walk, and each stage's
   *  glyph. Same ids and glyphs as everywhere else. */
  readonly scopeOptions: readonly { id: Scope; icon: string }[] = [
    { id: 'local', icon: 'blur_on' },
    { id: 'children', icon: 'account_tree' },
    { id: 'global', icon: 'public' },
  ]
  /** The glyph for the reach currently in force — the toggle's readout. */
  readonly scopeIcon = computed(() => this.scopeOptions.find(o => o.id === this.scope())!.icon)
  /** Current location as a route string — re-read immediately on every
   *  committed browser navigation and again after the renderer settles. */
  readonly #route = signal('')

  /** The inbox, narrowed to the picked reach around the current location.
   *
   *  Every page-addressed row follows the reach. Replies are the sole
   *  exception: their return-channel record has no route, so they remain
   *  visible until resolved. */
  readonly scoped = computed<FeedbackItem[]>(() => {
    const scope = this.scope()
    const items = this.shownItems()
    const here = this.#route()
    return items.filter(item => feedbackMatchesReach(item, scope, here))
  })
  /** AI work must not disappear into the scrolling inbox while it waits for
   *  authorization. Producers mark these explicitly; wording is never parsed. */
  readonly pinned = computed<FeedbackItem[]>(() => this.scoped().filter(i => i.kind === 'qa' && i.approval))
  readonly unpinned = computed<FeedbackItem[]>(() => this.scoped().filter(i => !i.approval))

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
  readonly #onNavigate = (): void => {
    if (this.visible()) this.#refreshRoute()
  }

  constructor() {
    // Navigation updates the URL before dispatching this event. Reading here
    // makes "This page" swap immediately for go/goRaw/replace/back/forward,
    // including views that do not run the tile renderer's guard lifecycle.
    window.addEventListener('navigate', this.#onNavigate)
    this.#cleanups.push(() => window.removeEventListener('navigate', this.#onNavigate))
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
    // Re-read after rendering too. This is an idempotent safety check for any
    // navigation path that repairs or redirects the route while loading.
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
    // Opening the inbox always means active work. Retired history appears only
    // after the participant explicitly asks for it in this panel.
    this.showHidden.set(false)
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

  /** Step to the next reach and wrap — local → children → global → local. */
  cycleScope(): void {
    const at = this.scopeOptions.findIndex(o => o.id === this.scope())
    this.setScope(this.scopeOptions[(at + 1) % this.scopeOptions.length].id)
  }

  toggleHidden(): void {
    this.showHidden.update(active => !active)
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
      const records: Array<{ sig: string; value: any }> = []
      // Read once, then project. Hidden markers may sort before or after their
      // target, and answers may sort before or after their question, so all
      // retirement ledgers are deliberately collected in a separate pass.
      for (const sig of sigs) {
        const blob = await store.getOptimization(sig)
        if (!blob) continue
        try {
          const value = JSON.parse(await blob.text())
          records.push({ sig, value })
        } catch { /* skip non-JSON */ }
      }
      const retirement = indexFeedbackRetirements(records)
      const out: FeedbackItem[] = []
      for (const { sig, value: o } of records) {
        try {
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
              approval: false,
              why: '',
              re: '',
              hiddenRecordSig: retirement.hiddenByTarget.get(sig.toLowerCase()) ?? '',
              seenRecordSig: retirement.seenByKey.get(String(p.id ?? '').trim()) ?? '',
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
              approval: false,
              why: '',
              re: String(p.re ?? ''),
              hiddenRecordSig: retirement.hiddenByTarget.get(sig.toLowerCase()) ?? '',
              seenRecordSig: '',
            })
          } else if (o?.kind === 'qa') {
            // An OPEN question — the record the dashboard used to render as a
            // hex tile. `appliesTo` is the lineage it concerns, which doubles
            // as its route so the reach filter narrows questions exactly like
            // feedback.
            const question = String(p.question ?? '').trim()
            if (!question) continue
            const path = Array.isArray(o.appliesTo) ? (o.appliesTo as unknown[]).map(String) : []
            const qId = String(p.qId ?? sig.slice(0, 16))
            // A qa-answer is the durable tombstone for its open question.
            // The channel is add-only and may replay the qa after local
            // removal; never ask the participant for the same answer twice.
            if (questionWasAnswered(retirement, sig, qId)) continue
            const approval = p.responseKind === 'approval' || p.requiresApproval === true
            out.push({
              sig,
              kind: 'qa',
              category: 'question',
              text: question,
              route: path.join('/'),
              at: Number(p.askedAt ?? p.at ?? 0),
              id: qId,
              by, from,
              qId,
              qPath: path,
              approval,
              why: this.#questionReason(p, approval),
              re: '',
              hiddenRecordSig: '',
              seenRecordSig: '',
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

  async resolve(item: FeedbackItem): Promise<boolean> {
    const store = get('@hypercomb.social/Store') as StoreLike | undefined
    if (!store?.putOptimization || this.isRetired(item)) return false
    const appliesTo = item.route.split('/').map(s => s.trim()).filter(Boolean)
    const record = {
      kind: 'hidden',
      appliesTo,
      payload: {
        targetKind: 'feedback-item',
        targetSig: item.sig,
        itemKind: item.kind,
      },
      mark: 'persistent',
    }
    try {
      const hiddenRecordSig = await store.putOptimization(
        new Blob([new TextEncoder().encode(JSON.stringify(record)) as BlobPart]),
      )
      // The scheduled feedback loop already treats `feedback-seen` as its
      // local retirement ledger. Mirror Resolve into that ledger so a relay
      // replay cannot re-queue or re-display the item under the same id.
      let seenRecordSig = item.seenRecordSig
      if (item.kind === 'feedback' && item.id) {
        const seen = { kind: 'feedback-seen', payload: { key: item.id, at: Date.now() } }
        try {
          seenRecordSig = await store.putOptimization(
            new Blob([new TextEncoder().encode(JSON.stringify(seen)) as BlobPart]),
          )
        } catch (err) {
          // The sig-targeted hidden marker is already durable, so the row is
          // closed. Failure here only affects the routine's id-level dedupe.
          console.warn('[feedback] could not mirror resolve into feedback-seen', err)
        }
      }
      this.items.update(list => list.map(i => i.sig === item.sig
        ? { ...i, hiddenRecordSig, seenRecordSig }
        : i))
      this.answering.set(this.answering() === item.sig ? null : this.answering())
      this.replyingTo.set(this.replyingTo() === item.sig ? null : this.replyingTo())
      return true
    } catch (err) {
      console.warn('[feedback] could not resolve item', err)
      this.#toast('error', 'feedback.resolve.error.title', 'feedback.resolve.error.message')
      return false
    }
  }

  /** Remove every local retirement marker for an explicitly restored item.
   *  This intentionally makes it eligible for the feedback loop again. */
  async restore(item: FeedbackItem): Promise<void> {
    const markers = [...new Set([item.hiddenRecordSig, item.seenRecordSig].filter(Boolean))]
    if (!markers.length) return
    const store = get('@hypercomb.social/Store') as StoreLike | undefined
    if (!store?.removeOptimization) return
    for (const sig of markers) await store.removeOptimization(sig)
    this.items.update(list => list.map(i => i.sig === item.sig
      ? { ...i, hiddenRecordSig: '', seenRecordSig: '' }
      : i))
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
    await this.#commitAnswer(item, this.answer.trim())
  }

  /** Approval questions deliberately have no editable text box: the decision
   *  is the answer. `decision` is machine-readable while `answer` preserves
   *  compatibility with existing feedback-loop consumers. */
  async submitDecision(item: FeedbackItem, decision: 'approved' | 'declined'): Promise<void> {
    if (item.kind !== 'qa' || !item.approval || this.sending()) return
    await this.#commitAnswer(item, decision, decision)
  }

  async #commitAnswer(
    item: FeedbackItem,
    text: string,
    decision?: 'approved' | 'declined',
  ): Promise<void> {
    const store = get('@hypercomb.social/Store') as StoreLike | undefined
    if (!store?.putOptimization) { this.#toast('error', 'feedback.error.title', 'feedback.error.message'); return }
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
          ...(decision ? { decision } : {}),
          answeredAt: Date.now(),
          ...(by ? { by } : {}),
          ...(from ? { from } : {}),
        },
        mark: 'persistent',
      }
      await store.putOptimization(new Blob([new TextEncoder().encode(JSON.stringify(record)) as BlobPart]))
      // The routine consumes and removes qa-answer after acting on it. Keep a
      // tiny local tombstone so an add-only channel replay cannot resurrect
      // the question after that response record has been drained.
      const answered = {
        kind: 'qa-answered',
        appliesTo: [...item.qPath],
        payload: { qId: item.qId, qSig: item.sig, at: Date.now() },
        mark: 'persistent',
      }
      try {
        await store.putOptimization(
          new Blob([new TextEncoder().encode(JSON.stringify(answered)) as BlobPart]),
        )
      } catch (err) {
        // The qa-answer itself still closes the row for now and must remain
        // available to the routine. Report the durability failure without
        // pretending the participant's response was lost.
        console.warn('[feedback] could not persist qa-answered tombstone', err)
      }
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
      // A response completes the inbox task. Keep the source bytes for the
      // history lens, but retire the row before confirming success.
      await this.resolve(item)
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
    if (item.kind === 'qa') return item.approval ? 'approval' : 'help'
    if (item.kind === 'reply') return 'reply'
    return item.category === 'issue' ? 'bug_report' : 'lightbulb'
  }

  isRetired(item: FeedbackItem): boolean {
    return !!(item.hiddenRecordSig || item.seenRecordSig)
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
      'feedback.replied.message': "It will arrive in the sender's feedback window, and this item is closed.",
      'feedback.reply.error.title': "Couldn't send the reply",
      'feedback.reply.error.message': 'The mesh may be down — try again in a moment.',
      'feedback.resolve.error.title': "Couldn't close this item",
      'feedback.resolve.error.message': 'It is still in the inbox. Please try Resolve again.',
    }
    EffectBus.emit('toast:show', {
      type,
      title: i18n?.t?.(titleKey) ?? fallback[titleKey] ?? '',
      message: i18n?.t?.(messageKey) ?? fallback[messageKey] ?? '',
    })
  }

  /** Explain why a machine-authored question is asking for attention. New
   *  producers carry explicit provenance; legacy records still get an honest
   *  state-based explanation instead of appearing as unexplained noise. */
  #questionReason(payload: any, approval: boolean): string {
    const explicit = String(payload?.reason ?? payload?.why ?? '').trim().slice(0, 500)
    if (explicit) return explicit
    const origin = String(payload?.origin ?? payload?.source ?? '').trim().toLowerCase()
    const i18n = get('@hypercomb.social/I18n') as I18nLike | undefined
    const key = origin === 'feedback-loop'
      ? 'feedback.reason.feedback-loop'
      : origin === 'meaning-loop'
        ? 'feedback.reason.meaning-loop'
        : approval
          ? 'feedback.reason.approval'
          : 'feedback.reason.answer'
    const fallback: Record<string, string> = {
      'feedback.reason.feedback-loop': 'The feedback loop needs your input before it can continue.',
      'feedback.reason.meaning-loop': 'The meaning loop needs your decision before it can continue.',
      'feedback.reason.approval': 'AI work is paused until you approve or discard this request.',
      'feedback.reason.answer': 'Work is paused until you answer this question.',
    }
    return i18n?.t?.(key) ?? fallback[key]
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
