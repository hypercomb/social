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
//   /screensaver random         — surprise me: a fresh style + motion each time
//   /screensaver <style>        — choose the look: hexagon | circle | thought | …
//   /screensaver <motion>       — choose the movement: bounce | shooting-stars | …
//
// Styles come from the BubbleStyle registry and motions from the Motion
// registry, so this command automatically knows about any new style or motion
// added under presentation/screensaver/.

import { QueenBee, EffectBus } from '@hypercomb/core'
import './styles.js'    // ensure the built-in styles are registered
import './motions.js'   // ensure the built-in motions are registered
import { bubbleStyleNames, bubbleStyles, getBubbleStyle } from './bubble-style.js'
import { motionNames, motions, getMotion } from './motion.js'
import type { ScreensaverDrone } from './screensaver.drone.js'

const get = (key: string) => (window as any).ioc?.get?.(key)

export class ScreensaverQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'screensaver'
  override readonly aliases = ['bounce', 'bubbles']
  override description = 'Idle screensaver: toggle on/off, pick the look (hexagon, circle, thought…) and the motion (bounce, shooting-stars…)'
  override descriptionKey = 'slash.screensaver'
  override options = ['on', 'off', 'now', 'hexagon', 'circle', 'thought']
  override examples = [
    { input: '/screensaver now', result: 'Starts the screensaver immediately' },
    { input: '/screensaver circle', result: 'Switches the look to circles' },
  ]

  override slashComplete(args: string): readonly string[] {
    const q = args.trim().toLowerCase()
    return ['on', 'off', 'now', 'random', ...bubbleStyleNames(), ...motionNames()].filter(o => o.startsWith(q))
  }

  protected async execute(args: string): Promise<void> {
    const drone = get('@diamondcoreprocessor.com/ScreensaverDrone') as ScreensaverDrone | undefined
    if (!drone) { this.#log('screensaver unavailable'); return }

    const a = args.trim().toLowerCase()

    // style selection (the look of one bubble)
    if (a && getBubbleStyle(a)) {
      drone.setStyle(a)
      this.#log(`screensaver style → ${a}`, '◈')
      return
    }

    // motion selection (how the field moves)
    if (a && getMotion(a)) {
      drone.setMotion(a)
      this.#log(`screensaver motion → ${a}`, '◈')
      return
    }

    // random mode — surprise me with a different style + motion each time
    if (a === 'random' || a === 'shuffle') {
      drone.setRandom(true)
      this.#log('screensaver → random (a fresh style + motion each time)', '◈')
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
      this.#log(on ? `screensaver on (${this.#mode(drone)}) — kicks in when idle` : 'screensaver off', on ? '●' : '○')
      return
    }

    // unknown non-empty token → show what's available rather than silently toggling
    if (a) {
      const styles = bubbleStyles().map(s => s.name).join(', ')
      const motionList = motions().map(m => m.name).join(', ')
      this.#log(`screensaver: try on, off, now, random, a style (${styles}) or a motion (${motionList})`)
      return
    }

    // bare → toggle on/off
    const on = drone.toggleEnabled()
    this.#log(on ? `screensaver on (${this.#mode(drone)}) — kicks in when idle` : 'screensaver off', on ? '●' : '○')
  }

  // How the running screensaver will look: "random", or the pinned style·motion.
  #mode(drone: ScreensaverDrone): string {
    return drone.isRandom() ? 'random' : `${drone.getStyle()} · ${drone.getMotionName()}`
  }

  #log(message: string, icon = '◈'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _screensaver = new ScreensaverQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ScreensaverQueenBee', _screensaver)
