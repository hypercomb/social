// sharing/deliver-link.ts
//
// DELIVERING A MINTED URL ON THE DEVICE'S OWN TERMS.
//
// Phones deliver links through the SHARE SHEET; the clipboard is a desktop
// tool — and a clipboard write outside a fresh user activation is refused by
// mobile browsers anyway, which is exactly the state long mints (the /host
// availability gate can run minutes) arrive in. So the ladder is:
//
//   1. navigator.share — the sheet, when the platform offers one and the
//      activation is still warm. The user cancelling the sheet is a CHOICE,
//      not a failure; nothing falls through after it.
//   2. navigator.clipboard — the desktop path, and the phone path while the
//      tap is still fresh.
//   3. A sticky toast whose button is a FRESH TAP: its click handler runs
//      the same ladder again, this time inside a live activation, so the
//      sheet (or the clipboard) succeeds where the stale one could not. The
//      URL rides the toast, so even a dead end leaves it on screen.
//
// One module owns this so no mint site ever hand-rolls the ladder again.

import { EffectBus, get, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'

export type LinkDelivery = 'shared' | 'copied' | 'offered'

/** The effect the sticky toast's button emits — its handler below re-runs
 *  the ladder INSIDE that click. Exported so a mint site that already holds a
 *  URL (a panel's own Share button) can ride the same fresh-tap path. */
export const SHARE_DELIVER_EFFECT = 'share:deliver'

type ShareCapable = Navigator & { share?: (data: { url: string; title?: string }) => Promise<void> }

/** The re-anchored attempt, run INSIDE the toast button's click. Synchronous
 *  distance from the tap is what makes the sheet legal here. */
EffectBus.on<{ url?: unknown; title?: unknown }>(SHARE_DELIVER_EFFECT, payload => {
  const url = typeof payload?.url === 'string' ? payload.url : ''
  if (!url) return
  const title = typeof payload?.title === 'string' ? payload.title : undefined
  const nav = navigator as ShareCapable
  if (typeof nav.share === 'function') {
    nav.share({ url, title }).catch(() => {
      void navigator.clipboard?.writeText?.(url).catch(() => { /* the toast already carried the URL */ })
    })
    return
  }
  void navigator.clipboard?.writeText?.(url).catch(() => { /* the toast already carried the URL */ })
})

/** Hand `url` to the participant: sheet, clipboard, or a fresh-tap offer.
 *  Returns what actually happened so the caller's own message can say it. */
export async function deliverLink(url: string, title?: string): Promise<LinkDelivery> {
  const nav = navigator as ShareCapable
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ url, title })
      return 'shared'
    } catch (err) {
      // AbortError = the participant closed the sheet themselves — done.
      if ((err as { name?: string })?.name === 'AbortError') return 'shared'
      // Anything else (stale activation, data refused) → keep descending.
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    return 'copied'
  } catch { /* stale activation or no permission — offer a fresh tap */ }
  const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
  EffectBus.emit('toast:show', {
    type: 'info',
    message: url,
    duration: 0,
    actionLabel: i18n?.t('share.offer') ?? 'Share',
    actionEffect: SHARE_DELIVER_EFFECT,
    actionPayload: { url, title },
  })
  return 'offered'
}
