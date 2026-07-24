// diamondcoreprocessor.com/presentation/tiles/mobile-empty-prompt.drone.ts
//
// Empty-state prompt for the MOBILE viewer gate. When mobile mode filters a
// page down to zero tiles, a blank canvas is the worst possible answer — the
// casual viewer can't tell "broken" from "nothing marked". This prompt names
// the state and, when it is safe to act, offers the one-tap fix (the
// `/mobile sweep`, which marks link/image tiles).
//
// Quiet by design (mirrors collection-empty-prompt.drone.ts):
//   - shows ONLY when the gate reports `shown === 0` while tiles exist
//     (`total > 0`) and the render has settled at zero cells;
//   - a genuinely empty page (total === 0) stays silent — that is not a
//     mobile-gate condition and other prompts own it. This also covers the
//     just-joined-a-swarm-with-nothing-shared case: an empty swarm is not a
//     mobile problem, so no prompt.
//
// MESH STATE MACHINE (private → world/prep → swarm — and back): the prompt
// must re-justify itself on EVERY transition. show-cell forces a full render
// pass on each of `world:mode`, `mesh:public-changed`, `mesh:room`, and
// `mesh:secret` (renderedCellsKey cleared), so a fresh `mobile:gate` +
// `render:cell-count` pair always follows. We therefore INVALIDATE on those
// same effects — hide immediately, forget the old pass's numbers — and only
// re-show when the new stage's own pass confirms the state. Holding numbers
// across a transition is how the prompt went stale (visible tiles underneath
// a "nothing marked" card).
//
// SWARM VARIANT: inside a swarm the message changes — the honest fix there
// is adopting mobile-ready tiles (tags ride layers, so a peer's
// `mobile:friendly` marks arrive with adoption and render immediately). The
// sweep button is withheld while mesh-public: sweeping would write tags into
// content you are only browsing. NOTE the flag value is 'true'/'false'
// (String(bool) — see runtime-initializer / show-cell), never '1'.

import { EffectBus, I18N_IOC_KEY } from '@hypercomb/core'

type GatePayload = { active: boolean; shown: number; total: number }
type CellCountPayload = { count: number; settled?: boolean }
type ModePayload = { active: boolean }
type I18nLike = { t(key: string, params?: Record<string, string | number>): string }
type SweepLike = { sweep?: () => Promise<void> }

const ioc = (): { get<T = unknown>(key: string): T | undefined } | undefined =>
  (globalThis as { ioc?: { get<T = unknown>(key: string): T | undefined } }).ioc

class MobileEmptyPromptDrone {
  #host: HTMLDivElement | null = null
  #shownVariant: 'own' | 'swarm' | null = null
  #gate: GatePayload | null = null
  #settledEmpty = false
  #mobileActive = false
  #sweeping = false
  // Master privacy switch, kept live via mesh:public-changed. Init from
  // localStorage for a mid-session (re)load; value is 'true', not '1'.
  #meshPublic = (() => {
    try { return localStorage.getItem('hc:mesh-public') === 'true' } catch { return false }
  })()

  constructor() {
    EffectBus.on<GatePayload>('mobile:gate', payload => {
      this.#gate = payload
      this.#mobileActive = !!payload.active
      this.#reconcile()
    })
    EffectBus.on<ModePayload>('mobile:mode', ({ active }) => {
      this.#mobileActive = !!active
      if (!active) this.#gate = null
      this.#reconcile()
    })
    EffectBus.on<CellCountPayload>('render:cell-count', payload => {
      this.#settledEmpty = payload.count === 0 && payload.settled === true
      this.#reconcile()
    })

    // ── mesh stage transitions: forget everything, let the new pass decide ──
    EffectBus.on<{ public: boolean }>('mesh:public-changed', ({ public: isPublic }) => {
      this.#meshPublic = !!isPublic
      this.#invalidate()
    })
    EffectBus.on('world:mode', () => this.#invalidate())
    EffectBus.on('mesh:room', () => this.#invalidate())
    EffectBus.on('mesh:secret', () => this.#invalidate())

    // Navigation invalidates the last gate report — a new page recomputes it.
    window.addEventListener('navigate', () => this.#invalidate())
  }

  /** Drop the previous pass's evidence and hide. The prompt may only return
   *  once a fresh `mobile:gate` AND a fresh settled `render:cell-count` both
   *  arrive from the pass that follows the transition. */
  #invalidate(): void {
    this.#gate = null
    this.#settledEmpty = false
    this.#hide()
  }

  #t(key: string, fallback: string): string {
    const i18n = ioc()?.get<I18nLike>(I18N_IOC_KEY)
    const value = i18n?.t?.(key)
    return value && value !== key ? value : fallback
  }

  #reconcile(): void {
    const gate = this.#gate
    const show = this.#mobileActive
      && !!gate && gate.shown === 0 && gate.total > 0
      && this.#settledEmpty
    if (show) this.#show()
    else this.#hide()
  }

  #show(): void {
    const variant: 'own' | 'swarm' = this.#meshPublic ? 'swarm' : 'own'
    if (this.#host && this.#shownVariant === variant) return
    this.#hide()

    const host = document.createElement('div')
    host.id = 'hc-mobile-empty-prompt'
    host.style.cssText =
      'position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;' +
      'pointer-events:none;padding:24px;box-sizing:border-box;font-family:inherit;'

    const panel = document.createElement('div')
    panel.style.cssText =
      'pointer-events:auto;max-width:320px;text-align:center;border-radius:12px;padding:22px 22px 24px;' +
      'background:rgba(12,17,24,0.82);border:1px solid rgba(126,182,214,0.22);' +
      'box-shadow:0 18px 44px rgba(0,0,0,0.3);backdrop-filter:blur(10px);'

    const title = document.createElement('div')
    title.style.cssText = 'font-size:17px;font-weight:700;color:#d8e6ee;margin-bottom:8px;'
    title.textContent = this.#t('mobile.empty.title', 'Nothing marked for mobile yet')

    const body = document.createElement('div')
    body.style.cssText = 'font-size:13.5px;line-height:1.55;color:rgba(216,230,238,0.66);'
    body.textContent = variant === 'swarm'
      ? this.#t(
          'mobile.empty.body-swarm',
          'Nothing mobile-ready is shared here yet. Mobile-marked tiles from swarm members — and any you adopt — appear automatically.',
        )
      : this.#t(
          'mobile.empty.body',
          'Tiles live here, but none carry the mobile pheromone. Videos, photos and links can be marked automatically.',
        )
    panel.appendChild(title)
    panel.appendChild(body)

    // The one-tap fix — own hive only. NEVER while mesh-public: the sweep
    // writes tags, and you don't write into a swarm you're browsing.
    if (variant === 'own') {
      const button = document.createElement('button')
      button.type = 'button'
      button.style.cssText =
        'margin-top:16px;border:0;border-radius:8px;padding:11px 18px;font:inherit;font-size:14px;' +
        'font-weight:700;color:#0c1118;background:rgb(126,182,214);cursor:pointer;min-height:44px;'
      button.textContent = this.#t('mobile.empty.action', 'Mark media tiles')
      button.addEventListener('click', () => { void this.#runSweep(button) })
      panel.appendChild(button)
    }

    host.appendChild(panel)
    document.body.appendChild(host)
    this.#host = host
    this.#shownVariant = variant
  }

  async #runSweep(button: HTMLButtonElement): Promise<void> {
    if (this.#sweeping) return
    this.#sweeping = true
    button.disabled = true
    button.style.opacity = '0.6'
    button.textContent = this.#t('mobile.empty.working', 'Marking…')
    try {
      const queen = ioc()?.get<SweepLike>('@diamondcoreprocessor.com/MobileQueenBee')
      await queen?.sweep?.()
      // The sweep emits `mobile:marks-changed`; the renderer re-runs the gate
      // and the next `mobile:gate`/`render:cell-count` pair reconciles us away
      // (or leaves us up, truthfully, if nothing qualified).
    } finally {
      this.#sweeping = false
      if (this.#host) {
        button.disabled = false
        button.style.opacity = '1'
        button.textContent = this.#t('mobile.empty.action', 'Mark media tiles')
      }
    }
  }

  #hide(): void {
    this.#host?.remove()
    this.#host = null
    this.#shownVariant = null
  }
}

const _mobileEmptyPrompt = new MobileEmptyPromptDrone()
window.ioc.register('@diamondcoreprocessor.com/MobileEmptyPromptDrone', _mobileEmptyPrompt)
