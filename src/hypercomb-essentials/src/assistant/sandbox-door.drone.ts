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
// any hive. The view only exports its element; defining it and adding it to
// the ShellSurfaceRegistry is this bee's act.
//
// And it finishes a TAKE (`module take`): a trial picked by hand waits in the
// brood, and a bundle held there is not composed. When a hand accepts code in
// the brood (`brood:ruled`), this bee composes the selection again, so what
// was accepted is what runs after a reload.

import { Drone, EffectBus, I18N_IOC_KEY, INSTALL_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { isSandboxSite, tallyAssessments } from './module-review.js'
import { SANDBOX_CHANGE_OWNER, SANDBOX_CHANGE_SURFACE, SandboxChangeElement } from './sandbox-change.view.js'

const DOOR_RE = /^(try-[a-z0-9](?:[a-z0-9-]{0,55}[a-z0-9])?)\./i

export class SandboxDoorDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'

  public override description =
    'On a sandbox door (try-<change>.<zone>), says once whose change this hive runs, how the host AI read it, and how people assessed it.'

  protected override listens: string[] = ['brood:ruled']
  protected override emits: string[] = ['module:door', 'toast:show']

  #done = false

  protected override sense = (): boolean => !this.#done && DOOR_RE.test(location.hostname)

  protected override heartbeat = async (): Promise<void> => {
    if (this.#done) return
    this.#done = true
    const name = DOOR_RE.exec(location.hostname)?.[1]?.toLowerCase() ?? ''
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
        "You are in sandbox {name}, by {publisher} — not promoted yet. The host's AI says {review}; people say {accept} accept, {refuse} refuse, {unclear} unclear. See what it changes: module changes {change}. Add yours: module assess {change} accept|refuse <note>.",
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
    if (!customElements.get(SANDBOX_CHANGE_SURFACE)) customElements.define(SANDBOX_CHANGE_SURFACE, SandboxChangeElement)
    try {
      registry.add({ name: SANDBOX_CHANGE_SURFACE, owner: SANDBOX_CHANGE_OWNER, element: SANDBOX_CHANGE_SURFACE, order: 152 })
    } catch {
      // duplicate add (hot reload) — the mounted surface is already live
    }
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
