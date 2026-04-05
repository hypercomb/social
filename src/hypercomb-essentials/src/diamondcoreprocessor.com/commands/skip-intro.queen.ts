// diamondcoreprocessor.com/commands/skip-intro.queen.ts

import { QueenBee, EffectBus } from '@hypercomb/core'

/**
 * /skip-intro — bypass the intro audio queue.
 *
 * Behaviour is a toggle:
 *  - If the intro is currently playing, emits `intro:skip` so the shell
 *    ends playback and reveals the hive.
 *  - If both episodes have already been watched (persisted in localStorage),
 *    the flags are cleared so the intros play again on next load — this is
 *    the recovery path for anyone who wants to hear them again after
 *    skipping earlier.
 *
 * Aliases: `bypass`, `skip`
 */
export class SkipIntroQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'skip-intro'
  override readonly aliases = ['bypass', 'skip']
  override description = 'Skip the intro audio (toggle to reset)'

  protected async execute(_args: string): Promise<void> {
    const episodeOneKey = 'hc:intro:episode-1-watched'
    const episodeZeroKey = 'hc:intro:episode-0-watched'

    const bothWatched =
      localStorage.getItem(episodeOneKey) === 'true' &&
      localStorage.getItem(episodeZeroKey) === 'true'

    if (bothWatched) {
      // Toggle: clear watched flags so the intros replay on next load.
      localStorage.removeItem(episodeOneKey)
      localStorage.removeItem(episodeZeroKey)
      EffectBus.emit('toast:show', { message: 'intro will replay on next load' })
      return
    }

    // Intro is (or should be) playing — tell the shell to end it.
    EffectBus.emit('intro:skip', {})
  }
}

// ── registration ────────────────────────────────────────
const _skipIntro = new SkipIntroQueenBee()
window.ioc.register('@diamondcoreprocessor.com/SkipIntroQueenBee', _skipIntro)
