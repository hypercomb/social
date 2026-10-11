import { Component, EventEmitter, Input, Output, computed, signal, type OnInit, type OnDestroy, type OnChanges, type SimpleChanges } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { fromRuntime } from '../../core/from-runtime'
import type { SecretStore } from '../../core/secret-store'
import type { SecretStrengthProvider } from '../../core/secret-strength'
import { SLOW_FOR_MS, UNREACHABLE_AFTER_MS, headerLink, type MeshConnection } from '../presence-banner/presence-status'

/** Stages of the single share toggle. Ordered: the preview is on from WORLD up. */
const STAGE_PRIVATE = 0
const STAGE_WORLD = 1
const STAGE_HOST = 2

@Component({
  selector: 'hc-mesh-header',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './mesh-header.component.html',
  styleUrls: ['./mesh-header.component.scss'],
})
export class MeshHeaderComponent implements OnInit, OnDestroy, OnChanges {

  @Input() meshPublic: boolean | null = false
  @Output() readonly meshToggled = new EventEmitter<void>()

  // ── ONE three-stage toggle (not two icons side by side) ───────────
  // A single control that CYCLES, so entering a swarm is a deliberate journey
  // that always starts from safety:
  //   0 PRIVATE 'lock'   — secure. Nothing previewed, nothing being shared.
  //   1 WORLD   'public' — sharing preview on: the canvas dims unshared tiles
  //                        and the per-tile / branch scope controls appear, so
  //                        you choose WHAT you'd share.
  //   2 HOST    'hub'    — opens the selector (host, location, secret,
  //                        participant). Clicking again WRAPS BACK to PRIVATE,
  //                        so the safe direction is always one click away.
  // In a swarm the control reads 'groups' and a click leaves. Joining carries
  // the preview in (stage ≥ WORLD), so scope controls stay reachable there
  // without a second icon.
  //
  // ALWAYS BOOTS AT PRIVATE — `hc:world-mode` is force-cleared on init
  // regardless of swarm state, so a refresh can never leave you previewing,
  // dimmed, or carrying a sharing posture across sessions.
  readonly #stage = signal(STAGE_PRIVATE)
  readonly stage = this.#stage.asReadonly()

  /** The sharing preview is on from the WORLD stage onward. */
  readonly worldMode = computed(() => this.#stage() >= STAGE_WORLD)

  /** Persisted opt-out: skip the privacy-review stage and go straight to the
   *  host/location selector. Read fresh per click. */
  #skipReview(): boolean {
    try { return localStorage.getItem('hc:skip-privacy-review') === '1' }
    catch { return false }
  }

  #setStage(next: number): void {
    this.#stage.set(next)
    const on = next >= STAGE_WORLD
    try { localStorage.setItem('hc:world-mode', on ? '1' : '0') } catch { /* ignore */ }
    EffectBus.emit('world:mode', { active: on })
  }

  #openSelector(): void {
    EffectBus.emit('mesh:open-modal', { join: true })
  }

  // ── the socket, on the glyph ──────────────────────────────────────
  // 'joined' used to be read straight off the per-tab flag, so a dead socket
  // still wore 'groups' and a room that could not hear you looked like a
  // room with nobody in it. In a swarm the glyph now follows the mesh's own
  // `mesh:connection`: 'groups' while live, amber 'sync' while it connects
  // or reconnects, 'link_off' once it has had no socket for 30 s. Until the
  // mesh reports anything (an older essentials package never does) it stays
  // 'groups', exactly as before. The glyph reads the line's rules: an OPEN
  // socket slow to answer is live (never a flickering 'sync' — TS-6), and a
  // standing refusal no wait cures (the meeting point wants the current code,
  // or names a computer's own relay this page cannot reach) is 'link_off' at
  // once, not after 30 s of amber.
  readonly #conn = signal<MeshConnection | null>(null)
  readonly #downSince = signal<number | null>(null)
  readonly #clock = signal(Date.now())
  #downTimer: ReturnType<typeof setTimeout> | null = null
  #unsubConn: (() => void) | null = null

  /** 'open' | 'pending' | 'down' — null when the mesh never said. */
  readonly link = computed<'open' | 'pending' | 'down' | null>(() => headerLink(this.#conn(), this.#downSince(), this.#clock()))
  #slowTimer: ReturnType<typeof setTimeout> | null = null

  /** Glyph for the current stage (see class comment). */
  readonly modeGlyph = (): string => {
    if (this.meshPublic) {
      const link = this.link()
      return link === 'pending' ? 'sync' : link === 'down' ? 'link_off' : 'groups'
    }
    if (this.#stage() === STAGE_WORLD) return 'public'
    if (this.#stage() === STAGE_HOST) return 'hub'
    return 'lock'
  }

  /** i18n key for the tooltip, per stage. */
  readonly modeTitleKey = (): string => {
    if (this.meshPublic) return 'controls.leave-swarm'
    if (this.#stage() === STAGE_WORLD) return 'controls.stage-world'
    if (this.#stage() === STAGE_HOST) return 'controls.stage-host'
    return 'controls.stage-private'
  }

  #secret$ = fromRuntime(
    get('@hypercomb.social/SecretStore') as EventTarget | undefined,
    () => (get('@hypercomb.social/SecretStore') as SecretStore | undefined)?.value ?? '',
  )

  // While the mesh-modal is editing, it broadcasts the draft so the header
  // shield can preview the strength in real time. Null = no active draft;
  // header falls back to the persisted store value.
  readonly #draft = signal<string | null>(null)
  #unsubDraft: (() => void) | null = null
  #unsubStepBack: (() => void) | null = null
  #unsubModal: (() => void) | null = null

  readonly shieldColor = computed(() => {
    const draft = this.#draft()
    const secret = (draft !== null ? draft : this.#secret$()).trim()
    if (!secret) return 'rgba(var(--hc-chrome-ink), var(--hc-ink-a-faint))'
    const provider = get('@hypercomb.social/SecretStrengthProvider') as SecretStrengthProvider | undefined
    const score = provider?.evaluate(secret) ?? 0.5
    const hue = Math.round(score * 130)
    return `hsl(${hue} 70% var(--hc-shield-l, 50%))`
  })

  ngOnInit(): void {
    this.#unsubDraft = EffectBus.on<{ secret: string | null }>('mesh:secret-draft', ({ secret }) => {
      this.#draft.set(secret)
    })
    // Unchecking "skip the privacy review" in the selector means "I DO want to
    // review" — so step back to the WORLD stage. (Checking it changes nothing:
    // you're already past the review.)
    this.#unsubStepBack = EffectBus.on('mesh:privacy-step-back', () => {
      if (!this.meshPublic) this.#setStage(STAGE_WORLD)
    })
    // Cancelling the join selector abandons the whole entry cycle. Return the
    // icon from HOST to PRIVATE instead of leaving a stale filled hub behind.
    // Other closes are intentional transitions: save joins, and opting back
    // into the privacy review explicitly restores WORLD above.
    this.#unsubModal = EffectBus.on<{ open?: boolean; cancelled?: boolean }>(
      'mesh:modal-open',
      ({ open, cancelled }) => {
        if (!open && cancelled && !this.meshPublic) this.#setStage(STAGE_PRIVATE)
      },
    )
    this.#unsubConn = EffectBus.on<MeshConnection>('mesh:connection', (c) => this.#onConnection(c, false))
    // ALWAYS boot at PRIVATE — a refresh never carries a sharing posture.
    this.#setStage(STAGE_PRIVATE)
  }

  ngOnChanges(changes: SimpleChanges): void {
    const mp = changes['meshPublic']
    if (!mp || mp.firstChange) return
    // Either transition drops the WORLD/privacy-selector preview. The WORLD
    // stage is PREP — "choose what to share" BEFORE joining; once meshPublic
    // flips (joined OR left) the prep is over, so world mode must go off and
    // the actual swarm view (peer tiles + adopt affordances) takes over.
    // (Previously joining kept stage >= WORLD to carry the scope controls in,
    // which stranded the participant in the privacy selector inside the
    // swarm instead of switching to the live swarm — reversed here.) Both
    // land on PRIVATE: on JOIN the glyph still reads 'groups' because
    // meshPublic wins that check; on LEAVE it returns to the secure lock.
    this.#setStage(STAGE_PRIVATE)
    // A join starts the socket's 30 s clock over.
    this.#downSince.set(null)
    if (this.#downTimer) { clearTimeout(this.#downTimer); this.#downTimer = null }
    const conn = this.#conn()
    if (this.meshPublic && conn) this.#onConnection(conn, true)
  }

  #onConnection(c: MeshConnection | null | undefined, rejoined: boolean): void {
    if (!c || typeof c.state !== 'string') return
    this.#conn.set(c)
    // The glyph reads its own clock: bring it to now, and wake it once a
    // stall outlives the probe deadline (slow → reconnecting).
    const at = Date.now()
    this.#clock.set(at)
    if (this.#slowTimer) { clearTimeout(this.#slowTimer); this.#slowTimer = null }
    if (c.state === 'stalled') {
      const since = typeof c.since === 'number' && c.since > 0 ? c.since : at
      this.#slowTimer = setTimeout(() => { this.#slowTimer = null; this.#clock.set(Date.now()) }, Math.max(0, since + SLOW_FOR_MS - at) + 50)
    }
    if (c.state === 'open') {
      this.#downSince.set(null)
      if (this.#downTimer) { clearTimeout(this.#downTimer); this.#downTimer = null }
      return
    }
    if (this.#downSince() !== null) return
    const now = Date.now()
    const since = !rejoined && typeof c.since === 'number' && c.since > 0 && c.since <= now ? c.since : now
    this.#downSince.set(since)
    this.#downTimer = setTimeout(() => {
      this.#downTimer = null
      this.#clock.set(Date.now())
    }, Math.max(0, since + UNREACHABLE_AFTER_MS - now) + 50)
  }

  ngOnDestroy(): void {
    this.#unsubDraft?.()
    this.#unsubStepBack?.()
    this.#unsubModal?.()
    this.#unsubConn?.()
    if (this.#downTimer) clearTimeout(this.#downTimer)
    if (this.#slowTimer) clearTimeout(this.#slowTimer)
  }

  // One control, cycling PRIVATE → WORLD → HOST → (wrap) PRIVATE.
  readonly onToggle = (): void => {
    // In a swarm: the control LEAVES it. The controls-bar's single 'mesh:join'
    // listener owns the solo↔swarm flip; leaving goes through meshToggled.
    if (this.meshPublic) { this.meshToggled.emit(); return }

    if (this.#stage() === STAGE_PRIVATE) {
      // The persisted opt-out jumps the review and goes straight to the
      // selector; otherwise stop at WORLD so nothing is exposed before you've
      // actually looked at what's private.
      if (this.#skipReview()) { this.#setStage(STAGE_HOST); this.#openSelector(); return }
      this.#setStage(STAGE_WORLD)
      // The WORLD stage previews the tile axis only: the canvas dims unshared
      // tiles. The behavior axis (Beehaviors roster) is NOT forced open here —
      // it stays one explicit click away via the join selector's button.
      return
    }

    if (this.#stage() === STAGE_WORLD) {
      // Scopes vetted — now set host, location, secret + participant. The join
      // itself happens on START inside the selector (JOIN mode → 'mesh:join').
      this.#setStage(STAGE_HOST)
      this.#openSelector()
      return
    }

    // HOST → wrap back to secure. Closes the selector if it's still open, so
    // the safe direction is always exactly one click away.
    EffectBus.emit('mesh:close-modal', {})
    this.#setStage(STAGE_PRIVATE)
  }
}
