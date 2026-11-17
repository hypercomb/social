// sharing/site-code-review.ts
//
// CODE TO REVIEW — THE CARD PAGE'S DOOR TO THE BROOD (subdomain AI, step 5:
// build). Every draft a model writes is HELD until the participant accepts it
// (jwize, 2026-10-26: "I have to decide whether to accept the changes
// always"; runtime module-drafts.ts admitInBrood). On a hive the door is the
// word `brood`; a managed site page has no command line, so a draft written
// from its chat sat held with no way to read it, accept it or refuse it.
//
// This is that door: one button, shown only while the brood holds a draft of
// your own that nobody has ruled on, saying how many. It opens the brood
// (`brood:open`, which the brood's bee answers on any page), where Read ·
// Accept · Refuse are the brood's own; this button decides nothing.
//
// A dependency: it exports, registers nothing. The card's bar
// (site-manage.view.ts) and the chat's rail strip (site-revisions.view.ts)
// each mount one.

import { EffectBus, I18N_IOC_KEY, broodRoster, type BroodRecord, type I18nProvider } from '@hypercomb/core'

const BROOD_OPEN = 'brood:open'
/** What changes the count: a draft landing, a ruling made. */
const RECOUNT_ON = ['module:drafted', 'brood:ruled'] as const

/** A draft of your own still waiting for your hand: written here by a model
 *  (module-drafts.ts records it as `own`, "a draft of …"), held, unruled. */
export const waitsForYou = (record: BroodRecord): boolean =>
  record.source.kind === 'own'
  && /^a draft of /.test(record.source.how ?? '')
  && !record.ruling
  && !!record.flags?.length

/** How many of your drafts wait for you. Never throws: a brood that cannot be
 *  read shows nothing rather than a wrong number. */
export const draftsWaiting = async (roster: () => Promise<readonly BroodRecord[]> = broodRoster): Promise<number> => {
  try { return (await roster()).filter(waitsForYou).length } catch { return 0 }
}

const t = (key: string, fallback: string, params: Record<string, string | number> = {}): string => {
  const i18n = (window as { ioc?: { get?: <T>(k: string) => T | undefined } }).ioc?.get?.<I18nProvider>(I18N_IOC_KEY)
  const value = i18n?.t?.(key, params)
  return value && value !== key ? value : fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''))
}

export type CodeReviewButton = {
  readonly element: HTMLButtonElement
  /** Count again now (the brood's records are its own; nothing announces
   *  every change to them). */
  recount(): Promise<void>
  dispose(): void
}

/** The button: hidden at zero, `Code to review · 2` otherwise. */
export function codeReviewButton(
  className: string,
  roster: () => Promise<readonly BroodRecord[]> = broodRoster,
): CodeReviewButton {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.hidden = true
  button.setAttribute('aria-haspopup', 'dialog')
  button.addEventListener('click', () => EffectBus.emit(BROOD_OPEN, { at: Date.now() }))
  let disposed = false
  let asked = 0
  const recount = async (): Promise<void> => {
    const ask = ++asked
    const waiting = await draftsWaiting(roster)
    if (disposed || ask !== asked) return
    button.hidden = waiting === 0
    button.textContent = t('site-code-review.button', 'Code to review · {waiting}', { waiting })
    button.title = t('site-code-review.title', 'Drafts a model wrote here wait for you: read them, then accept or refuse')
  }
  // A ruling is written just after `brood:ruled` is heard, so count again a
  // moment later as well.
  const later = (): void => { void recount(); setTimeout(() => { void recount() }, 600) }
  const offs = RECOUNT_ON.map(effect => EffectBus.on(effect, later))
  void recount()
  return {
    element: button,
    recount,
    dispose: () => { disposed = true; for (const off of offs) off() },
  }
}
