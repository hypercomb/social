// didyouknow/unavailable.ts
//
// The one sentence every Did You Know word says when the game cannot be
// played where it was spoken. A typed word is a gesture, and swallowing it
// reads as a broken game, so a word that is refused answers and says where
// the light lives (the same rule games follow when they are dormant).
//
// A dependency; it registers nothing.

import { I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import type { Unavailable } from './didyouknow.service.js'

export function unavailableSentence(why: Unavailable): string {
  const i18n = (window as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<I18nProvider>(I18N_IOC_KEY)
  return why === 'switched-off'
    ? (i18n?.t('didyouknow.unavailable.global') ?? 'Did You Know is switched off in Beehaviors')
    : (i18n?.t('didyouknow.unavailable') ?? 'Did You Know is off here — say "did-you-know on" to play on this layer and beneath, or "did-you-know everywhere"')
}
