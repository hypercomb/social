// safety/brood.drone.ts
//
// THE BROOD'S BEE (atomic-modules-plan.md, rule 1: one behaviour per feature;
// registration is the bee's act). The brood's surface — every held automaton,
// with Read · Accept · Refuse — is a dependency atom (brood.view.ts) that only
// exports. This bee defines its element and adds it to the ShellSurfaceRegistry,
// so `brood:open` — from the `brood` word, or a trial taken by hand whose code
// is waiting — always has a panel to open.
//
// THE DRAFT AUDIT'S READER. When a draft lands (runtime module-drafts.ts
// announces `module:drafted`), this bee has the change read
// (brood-audit.ts auditDraft; the model reads it, JEV scores that reading when
// it may) and says who read it and what was found. The scan already held
// anything that newly reaches something; the reading can hold it too, never
// release it.

import { broodRecord, Drone, EffectBus, I18N_IOC_KEY, INSTALL_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import type { DraftLanded } from './brood-audit.js'
import { BROOD_OWNER, BROOD_SURFACE, BroodElement } from './brood.view.js'

/** A draft announced longer ago than this is not read on replay. */
const FRESH_MS = 60_000
/** A ruling older than this is a replay, not a hand. */
const RULED_MS = 4_000

export class BroodDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'

  public override description =
    'The brood: puts its surface in the shell, where held code is read, accepted or refused, and reads every draft before it runs.'

  protected override listens = ['module:drafted', 'brood:ruled']

  protected override sense = (): boolean => false

  #reading = new Set<string>()

  constructor() {
    super()
    this.onEffect<DraftLanded & { at?: number }>('module:drafted', draft => {
      if (!draft?.sig || Math.abs(Date.now() - (draft.at ?? 0)) > FRESH_MS) return
      void this.#read(draft)
    })
    // ACCEPTING A DRAFT THE AUDIT HELD. A held module waits to be imported; a
    // held dependency was left out of the composed selection (the trunk's copy
    // kept running). So once a hand accepts it, the selection is composed
    // again, and what was accepted runs after a reload.
    this.onEffect<{ sig?: string; verdict?: string; at?: number }>('brood:ruled', ruled => {
      if (ruled?.verdict !== 'accepted' || !ruled.sig || Math.abs(Date.now() - (ruled.at ?? 0)) > RULED_MS) return
      void this.#recompose(ruled.sig)
    })
  }

  async #recompose(sig: string): Promise<void> {
    const record = await broodRecord(sig).catch(() => null)
    if (!record?.flags?.length || record.source.kind !== 'own') return
    const install = window.ioc?.get?.(INSTALL_IOC_KEY) as { applyUnits?(): Promise<boolean> } | undefined
    const composed = await install?.applyUnits?.().catch(() => false)
    const params = { section: record.name ?? sig.slice(0, 12) }
    this.#say(composed
      ? this.#t('brood.draftaccepted', 'Accepted: your draft of {section} runs after a reload.', params)
      : this.#t('brood.draftnotcomposed', 'Accepted, but your draft of {section} could not be composed in yet — reload, and it is tried again.', params),
    composed ? 'info' : 'warning')
  }

  async #read(draft: DraftLanded): Promise<void> {
    if (this.#reading.has(draft.sig)) return
    this.#reading.add(draft.sig)
    try {
      const { auditDraft } = await import('./brood-audit.js')
      const reading = await auditDraft(draft)
      if (!reading) return
      const params = { reader: reading.reader, section: draft.section, summary: reading.summary, path: draft.path ?? '' }
      if (reading.heldByReading) {
        this.#say(this.#t('brood.draftheld', '{reader} held your draft of {section}: {summary}. brood shows it; brood accept runs it anyway; module drop {path} undoes it.', params), 'warning')
      } else if (reading.held) {
        this.#say(this.#t('brood.draftstillheld', '{reader} read your draft of {section}: {summary}. It stays held for what it newly reaches until you accept it.', params), 'warning')
      } else {
        this.#say(this.#t('brood.draftread', '{reader} read your draft of {section}: {summary}', params), 'info')
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'the reader did not answer'
      this.#say(this.#t('brood.draftunread', 'Your draft of {section} was not read: {reason}. What the scan held stays held.', { section: draft.section, reason }), 'info')
    } finally {
      this.#reading.delete(draft.sig)
    }
  }

  #t(key: string, fallback: string, params: Record<string, string>): string {
    const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
    const value = i18n?.t?.(key, params)
    return value && value !== key ? value : fallback.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? '')
  }

  #say(message: string, type: 'info' | 'warning'): void {
    EffectBus.emit('toast:show', { type, message })
  }
}

window.ioc.whenReady<{ add(surface: unknown): void }>('@hypercomb.social/ShellSurfaceRegistry', registry => {
  if (!customElements.get(BROOD_SURFACE)) customElements.define(BROOD_SURFACE, BroodElement)
  try {
    registry.add({ name: BROOD_SURFACE, owner: BROOD_OWNER, element: BROOD_SURFACE, order: 150 })
  } catch {
    // duplicate add (hot reload) — the mounted surface is already live
  }
})

window.ioc.register('@diamondcoreprocessor.com/BroodDrone', new BroodDrone())
