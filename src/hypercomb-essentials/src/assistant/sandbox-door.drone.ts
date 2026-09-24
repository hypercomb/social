// assistant/sandbox-door.drone.ts
//
// THE DOOR SAYS WHAT IT IS (documentation/module-sandbox.md). A hive opened
// at `try-<change>.<zone>` runs a change someone has not promoted yet. Once,
// as it boots, this drone reads the door's own /site.json and says so: whose
// sandbox it is, how the host's AI read the change, and how people assessed
// it — with the word to read it again or add your own. It also emits
// `module:door` with the whole descriptor, for any surface that wants to show
// more (the change and review signatures open with `read <sig>`).
//
// Anywhere else it does nothing: `sense` is false off a sandbox door.
//
// It is also the bee that WIRES this feature's surface: the what-changed
// panel (sandbox-change.view.ts), which `module changes <change>` opens over
// any hive. The view only exports its element; adding its tag to the
// ShellSurfaceRegistry, and defining it when a request first asks for it, is
// this bee's act.
//
// And it finishes a TAKE (`module take`): a trial picked by hand waits in the
// brood, and a bundle held there is not composed. When a hand accepts code in
// the brood (`brood:ruled`), this bee composes the selection again, so what
// was accepted is what runs after a reload.

import { Drone, EffectBus, I18N_IOC_KEY, INSTALL_IOC_KEY, sandboxDoorOf, type I18nProvider } from '@hypercomb/core'
import { isSandboxSite, tallyAssessments } from './module-review.js'
import type { SandboxChangePayload } from './sandbox-change.view.js'

// THE PANEL'S NAMES, spelled here: importing even a constant from the view
// would keep it on the boot path. sandbox-change.view.ts spells the same, and
// sandbox-door.spec.ts holds the two together.
const SANDBOX_CHANGE_SURFACE = 'hc-sandbox-change'
const SANDBOX_CHANGE_OWNER = '@diamondcoreprocessor.com/SandboxChangeView'
const SANDBOX_CHANGE_EFFECT = 'module:changes'
/** The panel takes no request older than this (its own replay guard). */
const CHANGES_STAMP_MS = 4_000

export class SandboxDoorDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'

  public override description =
    'On a sandbox door (try-<change>.<zone>), says once whose change this hive runs, how the host AI read it, and how people assessed it.'

  protected override listens: string[] = ['brood:ruled', SANDBOX_CHANGE_EFFECT]
  protected override emits: string[] = ['module:door', 'toast:show', SANDBOX_CHANGE_EFFECT]

  #done = false

  protected override sense = (): boolean => !this.#done && !!sandboxDoorOf(location.hostname)

  protected override heartbeat = async (): Promise<void> => {
    if (this.#done) return
    this.#done = true
    const name = sandboxDoorOf(location.hostname)?.label ?? ''
    let site: unknown = null
    try {
      const res = await fetch('/site.json', { cache: 'no-store' })
      site = res.ok ? await res.json() : null
    } catch { site = null }
    if (!isSandboxSite(site)) return
    EffectBus.emit('module:door', site)
    const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
    const t = (key: string, fallback: string, params: Record<string, string | number>): string => {
      const value = i18n?.t?.(key, params)
      return value && value !== key ? value : fallback.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ''))
    }
    const tally = tallyAssessments(site)
    const change = name.replace(/^try-/, '')
    EffectBus.emit('toast:show', {
      type: 'info',
      message: t('module.door',
        "You are in sandbox {name}, by {publisher} — not promoted yet. The host's AI says {review}; people say {accept} accept, {refuse} refuse, {unclear} unclear. See what it changes: module changes {change}. Assess it from your own hive: module assess {change} accept|refuse <note>.",
        {
          name, change, publisher: site.publisher || site.pubkey.slice(0, 12) + '…',
          review: site.reviewVerdict ?? t('module.unreviewed', 'nothing yet', {}),
          accept: tally.accept, refuse: tally.refuse, unclear: tally.unclear,
        }),
    })
  }
}

const _door = new SandboxDoorDrone()
window.ioc.register('@diamondcoreprocessor.com/SandboxDoorDrone', _door)

;(window as { ioc?: { whenReady?: (k: string, cb: (v: { add(s: unknown): void }) => void) => void } })
  .ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', registry => {
    try {
      registry.add({ name: SANDBOX_CHANGE_SURFACE, owner: SANDBOX_CHANGE_OWNER, element: SANDBOX_CHANGE_SURFACE, order: 152 })
    } catch {
      // duplicate add (hot reload) — the mounted surface is already live
    }
  })

// THE PANEL ARRIVES WITH ITS FIRST REQUEST, not at boot (atomic-modules-plan.md,
// "adopt the proper load"): the surface registers only its tag, the shell makes
// the element from it, and `module changes` defines it here — the element
// already in the page upgrades in place, subscribes, and takes the request
// from the bus's replay. A request the load outlived (the panel refuses one
// older than its stamp window) is said once more, freshly stamped.
let changePanel: Promise<void> | null = null
/** The newest request heard while the panel loads. */
let changeAsked: SandboxChangePayload | null = null

EffectBus.on<SandboxChangePayload>(SANDBOX_CHANGE_EFFECT, payload => {
  if (customElements.get(SANDBOX_CHANGE_SURFACE)) return
  if (!payload || Math.abs(Date.now() - (payload.at ?? 0)) > CHANGES_STAMP_MS) return
  changeAsked = payload
  changePanel ??= import('./sandbox-change.view.js').then(({ SandboxChangeElement }) => {
    if (!customElements.get(SANDBOX_CHANGE_SURFACE)) customElements.define(SANDBOX_CHANGE_SURFACE, SandboxChangeElement)
    const asked = changeAsked
    changeAsked = null
    if (asked && Math.abs(Date.now() - asked.at) > CHANGES_STAMP_MS) EffectBus.emit(SANDBOX_CHANGE_EFFECT, { ...asked, at: Date.now() })
  }).catch((error: unknown) => {
    // A failed load says so, and the next request tries again.
    changePanel = null
    changeAsked = null
    EffectBus.emit('activity:log', { message: `Could not load the trial's changes panel: ${error instanceof Error ? error.message : String(error)}` })
  })
})

/** A ruling older than this is a replay, not a hand. */
const RULED_STAMP_MS = 4_000

type RecomposeLike = {
  selection?(): Promise<{ picks: Record<string, { byHand?: boolean }> }>
  applyUnits?(): Promise<boolean>
}

EffectBus.on<{ verdict?: string; at?: number }>('brood:ruled', ruled => {
  if (ruled?.verdict !== 'accepted' || Math.abs(Date.now() - (ruled.at ?? 0)) > RULED_STAMP_MS) return
  void (async () => {
    const install = window.ioc?.get?.(INSTALL_IOC_KEY) as RecomposeLike | undefined
    const picks = (await install?.selection?.().catch(() => null))?.picks ?? {}
    if (!Object.values(picks).some(pick => pick.byHand === true)) return
    const composed = await install?.applyUnits?.().catch(() => false)
    const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
    const say = (key: string, fallback: string): string => { const value = i18n?.t?.(key); return value && value !== key ? value : fallback }
    EffectBus.emit('toast:show', composed
      ? { type: 'success', message: say('module.takenlive', 'Accepted: what you took from a trial is composed in, and runs after a reload.') }
      : { type: 'warning', message: say('module.notcomposed', 'Accepted, but what you took could not be composed in yet — reload, or say module take again.') })
  })()
})
