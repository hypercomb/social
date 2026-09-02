// A DOCKED PANEL IS PARKED, NOT CLOSED — AND ITS GLYPH HAS TO KNOW.
//
// The one-window rule parks a docked panel whenever another window opens
// (window-rule.ts): the panel's DOM goes, but a panel whose truth lives in a
// DRONE never tells the drone, so its `#open` stayed true over an empty edge.
// The next press on the control-bar glyph then flipped a flag nobody could
// see — nothing happened — and it took a SECOND press to get the panel back.
//
// The fix is one sentence: the glyph asks the SCREEN, never the flag.
// `isWindowShowing(<panel id>)` is the panel's own registration in the window
// session, dropped the moment it stops showing, so parked and closed read
// alike — which is exactly what the participant means by that press.
//
// Two halves are ratcheted here, because either one alone fails silently:
//   1. the drone derives its toggle from `isWindowShowing`, not from `#open`;
//   2. the id it passes is the id the panel actually REGISTERS under (its
//      `hcDockedPanel` attribute). A typo there is a query that answers
//      "nothing is showing" forever, and the glyph stops closing anything.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (p: string): string =>
  readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')

/** Drone-owned docked panels: the drone that holds the open flag, the effect
 *  its glyph emits, and the panel template that registers the window id. */
const PANELS = [
  {
    what: 'hosts',
    drone: './hypercomb-essentials/src/sharing/hosts.drone.ts',
    effect: 'hosts:view-toggle',
    template: './hypercomb-shared/ui/hosts-panel/hosts-panel.component.html',
  },
  {
    what: 'publish',
    drone: './hypercomb-essentials/src/sharing/publish-status.drone.ts',
    effect: 'publish:view-toggle',
    template: './hypercomb-shared/ui/publish-panel/publish-panel.component.html',
  },
  {
    what: 'observe',
    drone: './hypercomb-essentials/src/sharing/observe.drone.ts',
    effect: 'observe:toggle',
    template: './hypercomb-shared/ui/observe-viewer/observe-viewer.component.html',
  },
] as const

// ── THE BUG ITSELF, REPRODUCED ────────────────────────────────────────────
//
// The drone is driven exactly as the shell drives it: the panel mirrors
// `<name>:render` and joins/leaves the window session as `hcDockedPanel`
// does — showing means registered — so parking is the registration going
// away WITHOUT the drone being told. Each of these fails on the old
// `#open = !#open` shape, which is the point of writing them.

;(globalThis as Record<string, unknown>).ioc ??= {
  register: () => {}, get: () => undefined, whenReady: () => {},
}
await import('./hypercomb-essentials/src/sharing/hosts.drone.js')
await import('./hypercomb-essentials/src/sharing/observe.drone.js')
await import('./hypercomb-essentials/src/sharing/publish-status.drone.js')
const core = await import('@hypercomb/core')

const noop = { park: () => {}, unpark: () => {} }

describe('a glyph press on a parked panel brings it back — once', () => {
  for (const { what, effect, render, id } of [
    { what: 'hosts', effect: 'hosts:view-toggle', render: 'hosts:render', id: 'hosts-panel' },
    { what: 'publish', effect: 'publish:view-toggle', render: 'publish:render', id: 'publish-panel' },
    { what: 'observe', effect: 'observe:toggle', render: 'observe:render', id: 'observe-viewer' },
  ]) {
    let open = false
    let release: (() => void) | null = null

    const wire = (): void => {
      core.resetWindowSession()
      open = false
      release = null
      core.EffectBus.on(render, (p: { open?: boolean }) => {
        open = !!p?.open
        if (open && !release) release = core.holdWindow(id, noop)
        else if (!open && release) { release(); release = null }
      })
    }

    it(`${what}: press opens, press again closes`, () => {
      wire()
      core.EffectBus.emit(effect, {})
      expect(open).toBe(true)
      expect(core.isWindowShowing(id)).toBe(true)
      core.EffectBus.emit(effect, {})
      expect(open).toBe(false)
    })

    it(`${what}: parked — ONE press brings it back`, () => {
      wire()
      core.EffectBus.emit(effect, {})
      expect(open).toBe(true)

      // The one-window rule parks it: the DOM goes, the registration with
      // it, and nothing tells the drone.
      release?.()
      release = null
      expect(core.isWindowShowing(id)).toBe(false)

      core.EffectBus.emit(effect, {})
      expect(open).toBe(true)
      expect(core.isWindowShowing(id)).toBe(true)
    })
  }
})

describe('a parked panel opens on ONE press of its glyph', () => {
  for (const { what, drone, effect, template } of PANELS) {
    it(`${what}: the toggle reads the screen, not its own flag`, () => {
      const src = read(drone)
      // The HANDLER, not the `listens` line that also names the effect: start
      // at the registration and stop at the next one.
      const start = src.indexOf(`this.onEffect('${effect}'`)
      expect(start).toBeGreaterThan(-1)
      const rest = src.slice(start + 1)
      const end = rest.indexOf('this.onEffect')
      const body = end === -1 ? rest : rest.slice(0, end)
      expect(body).toMatch(/this\.#open = !isWindowShowing\(/)
      // The old shape is the bug itself. It must never come back here.
      expect(body).not.toMatch(/this\.#open = !this\.#open/)
    })

    it(`${what}: asks about the id the panel registers under`, () => {
      const asked = read(drone).match(/isWindowShowing\('([^']+)'\)/)?.[1]
      const registered = read(template).match(/hcDockedPanel="([^"]+)"/)?.[1]
      expect(registered).toBeTruthy()
      expect(asked).toBe(registered)
    })
  }
})

describe('the window session is one registry, not one per module copy', () => {
  it('is pinned on globalThis, like the effect bus', () => {
    // Core is compiled INTO the Angular shell and served SEPARATELY to the
    // runtime-loaded drones through the import map. A module-level `const`
    // registry is two registries that never meet, and every drone asking
    // `isWindowShowing` would be told "nothing" forever — an answer, not an
    // error, which is the worst way for this to fail.
    const src = read('./hypercomb-core/src/core/panels/window-session.ts')
    expect(src).toMatch(/globalThis as \{ __hypercombWindowSession\?/)
    expect(src).toMatch(/__hypercombWindowSession \?\?=/)
  })
})
