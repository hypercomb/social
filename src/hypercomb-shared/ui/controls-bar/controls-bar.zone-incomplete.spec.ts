// ui/controls-bar/controls-bar.zone-incomplete.spec.ts — A SWARM WITH NO
// ROOM OR SECRET IS SAID, NOT OPENED.
//
// `swarm:zone-incomplete` fires from a boot or navigation sync, never a tap,
// so the controls bar answers with a toast whose action is the selector's
// door — it never opens the selector itself. The drone's emit is stored, so
// the boot sync still reaches a bar that mounts later; the bar reads the live
// room and secret first, so a replay of a zone since fixed says nothing. Read from
// source: the bar is an Angular component and the drone a full swarm.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (...parts: string[]): string => readFileSync(join(process.cwd(), ...parts), 'utf8')

/** The bar's handler body, from its subscribe to the next subscription. */
const handler = (): string => {
  const src = read('hypercomb-shared', 'ui', 'controls-bar', 'controls-bar.component.ts')
  const at = src.indexOf("'swarm:zone-incomplete'")
  expect(at).toBeGreaterThan(-1)
  return src.slice(at, src.indexOf('this.#inputVisibleMirrorUnsub', at))
}

describe('swarm:zone-incomplete answers in place', () => {
  it('the controls bar toasts with the selector as its action and never opens it', () => {
    const body = handler()
    expect(body).toContain("actionEffect: 'mesh:open-modal'")
    expect(body).toContain('actionPayload: { join: true }')
    expect(body).not.toMatch(/EffectBus\.emit\(\s*'mesh:open-modal'/)
    expect(body).not.toContain("type: 'error'") // not a ToastType
  })

  it('the boot announcement still reaches a late bar, and a fixed zone stays quiet', () => {
    const src = read('hypercomb-essentials', 'src', 'sharing', 'swarm.drone.ts')
    expect(src).toMatch(/emitEffect\(\s*'swarm:zone-incomplete'/)
    expect(src).not.toMatch(/emitTransient\(\s*'swarm:zone-incomplete'/)
    const body = handler()
    expect(body).toMatch(/roomStore\?\.value\?\.trim\(\) && this\.secretStore\?\.value\?\.trim\(\)\) return/)
    expect(body).toContain('duration: 0')
  })
})
