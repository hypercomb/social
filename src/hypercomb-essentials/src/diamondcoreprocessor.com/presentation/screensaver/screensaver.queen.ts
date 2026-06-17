// diamondcoreprocessor.com/presentation/screensaver/screensaver.queen.ts
//
// /screensaver — control the idle screensaver.
//
// hypercomb's screensaver is enabled BY DEFAULT: when you go idle, the current
// node's tiles drift around as neon bubbles until you move. This command flips
// that preference and picks the visual style — both remembered across reloads.
//
//   /screensaver                — toggle on/off
//   /screensaver on | off       — set explicitly
//   /screensaver now            — start it immediately (preview)
//   /screensaver <style>        — choose the look: hexagon | circle | thought | …
//
// Styles come from the BubbleStyle registry, so this command automatically
// knows about any new style added under presentation/screensaver/.

import { QueenBee, EffectBus } from '@hypercomb/core'
import './styles.js'   // ensure the built-in styles are registered
import { bubbleStyleNames, bubbleStyles, getBubbleStyle } from './bubble-style.js'
import type { ScreensaverDrone } from './screensaver.drone.js'

const get = (key: string) => (window as any).ioc?.get?.(key)

export class ScreensaverQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'screensaver'
  override readonly aliases = ['bounce', 'bubbles']
  override description = 'Idle screensaver: toggle on/off and pick the look (hexagon, circle, thought…)'
  override descriptionKey = 'slash.screensaver'

  override slashComplete(args: string): readonly string[] {
    const q = args.trim().toLowerCase()
    return ['on', 'off', 'now', ...bubbleStyleNames()].filter(o => o.startsWith(q))
  }

  protected async execute(args: string): Promise<void> {
    const drone = get('@diamondcoreprocessor.com/ScreensaverDrone') as ScreensaverDrone | undefined
    if (!drone) { this.#log('screensaver unavailable'); return }

    const a = args.trim().toLowerCase()

    // style selection
    if (a && getBubbleStyle(a)) {
      drone.setStyle(a)
      this.#log(`screensaver style → ${a}`, '◈')
      return
    }

    if (a === 'now') {
      if (!drone.isEnabled()) drone.setEnabled(true)
      drone.activateNow()
      this.#log('screensaver started — move the mouse to dismiss', '●')
      return
    }

    if (a === 'on' || a === 'off') {
      const on = drone.setEnabled(a === 'on')
      this.#log(on ? `screensaver on (${drone.getStyle()}) — kicks in when idle` : 'screensaver off', on ? '●' : '○')
      return
    }

    // unknown non-empty token → show what's available rather than silently toggling
    if (a) {
      const styles = bubbleStyles().map(s => s.name).join(', ')
      this.#log(`screensaver: try on, off, now, or a style (${styles})`)
      return
    }

    // bare → toggle on/off
    const on = drone.toggleEnabled()
    this.#log(on ? `screensaver on (${drone.getStyle()}) — kicks in when idle` : 'screensaver off', on ? '●' : '○')
  }

  #log(message: string, icon = '◈'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _screensaver = new ScreensaverQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ScreensaverQueenBee', _screensaver)
