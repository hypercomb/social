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

import { afterAll, describe, expect, it, vi } from 'vitest'
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
    template: './hypercomb-essentials/src/sharing/host-directory.view.ts',
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
const { HostsDrone } = await import('./hypercomb-essentials/src/sharing/hosts.drone.js')
const { ObserveDrone } = await import('./hypercomb-essentials/src/sharing/observe.drone.js')
const { PublishStatusDrone } = await import('./hypercomb-essentials/src/sharing/publish-status.drone.js')
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
    let off: (() => void) | null = null
    // One stand-in panel at a time: a stale listener left subscribed would
    // hold the same window id and answer for the next test's panel.
    afterAll(() => { off?.(); off = null })

    const wire = (): void => {
      off?.()
      core.resetWindowSession()
      open = false
      release = null
      off = core.EffectBus.on(render, (p: { open?: boolean }) => {
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

      // A shell older than `<name>:shown` parks it without telling the
      // drone: the DOM goes, the registration with it, and #open stays true —
      // the press must still read the screen.
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
      let body = end === -1 ? rest : rest.slice(0, end)
      // A handler that hands the press to one method (`() => this.#toggle()`,
      // so the keymap's `p` lands in the same place) is read in that method.
      // The press may be guarded against the bus's replay (`if (live)`).
      const handoff = body.match(/^[^\n]*=>\s*(?:\{\s*if \(live\)\s*)?this\.(#\w+)\(\)/)?.[1]
      if (handoff) {
        const at = src.indexOf(`  ${handoff}(): void {`)
        expect(at, `the ${handoff} method`).toBeGreaterThan(-1)
        const method = src.slice(at)
        body = method.slice(0, method.indexOf('\n  }\n') + 4)
      }
      expect(body).toMatch(/this\.#open = !isWindowShowing\(/)
      // The old shape is the bug itself. It must never come back here.
      expect(body).not.toMatch(/this\.#open = !this\.#open/)
    })

    it(`${what}: asks about the id the panel registers under`, () => {
      const asked = read(drone).match(/isWindowShowing\('([^']+)'\)/)?.[1]
      // An Angular window names its id in the template; an element names it in a constant.
      const registered = read(template).match(/hcDockedPanel="([^"]+)"/)?.[1] ?? read(template).match(/_WINDOW = '([^']+)'/)?.[1]
      expect(registered).toBeTruthy()
      expect(asked).toBe(registered)
    })
  }
})

// ── PARKED IS NOT SHOWING — THE DRONE IS TOLD ────────────────────────────
//
// The other half of the same bug: parked, the drone's `#open` stayed true, so
// any BACKGROUND render — a commit, a walk, the swarm breathing — carried
// open:true and the panel came back by itself, in answer to nothing. The
// panel's session now announces park and unpark (`<name>:shown`), and the
// stand-in below is wired exactly as the Angular panel is: `signalSession`
// over its visible signal, the window held while it shows, parked by the
// one-window rule's own `parkWindows`.

const standIn = (id: string, render: string, shown: string) => {
  let value = false
  let release: (() => void) | null = null
  const renders: boolean[] = []
  const visible = Object.assign(() => value, {
    set: (next: boolean): void => {
      value = next
      if (next && !release) release = core.holdWindow(id, session)
      else if (!next && release) { release(); release = null }
    },
  })
  const session = core.signalSession(visible, (open) => core.EffectBus.emitTransient(shown, { open }))
  const off = core.EffectBus.on(render, (p: { open?: boolean }) => {
    renders.push(!!p?.open)
    visible.set(!!p?.open)
  })
  return { visible, renders, off }
}

const settle = (ms: number): Promise<void> => new Promise(done => setTimeout(done, ms))

describe('a parked panel stays parked until it is asked for', () => {
  for (const { what, toggle, close, render, shown, id, background } of [
    {
      what: 'publish', toggle: 'publish:view-toggle', close: 'publish:close', render: 'publish:render',
      shown: 'publish:shown', id: 'publish-panel',
      // A commit (a debounced sweep), a behaviour lit, a host's sync state.
      background: ['history:head-changed', 'behavior:enablement-changed', 'sync:state'],
    },
    {
      what: 'observe', toggle: 'observe:toggle', close: 'observe:close', render: 'observe:render',
      shown: 'observe:shown', id: 'observe-viewer',
      background: ['swarm:peers-changed', 'swarm:presence-changed'],
    },
  ]) {
    const open = () => {
      core.resetWindowSession()
      const panel = standIn(id, render, shown)
      core.EffectBus.emit(close, {})
      expect(panel.visible()).toBe(false)
      core.EffectBus.emit(toggle, {})
      expect(panel.visible()).toBe(true)
      expect(core.isWindowShowing(id)).toBe(true)
      return panel
    }

    it(`${what}: parked, a background render carries open:false`, async () => {
      const panel = open()
      expect(core.parkWindows()).toBe(1)
      expect(core.isWindowShowing(id)).toBe(false)
      expect(panel.renders.at(-1)).toBe(false)
      panel.renders.length = 0
      for (const effect of background) core.EffectBus.emit(effect, {})
      // Past the publish sweep's debounce: the old shape rendered open:true here.
      await settle(900)
      expect(panel.renders).not.toContain(true)
      expect(panel.visible()).toBe(false)
      expect(core.isWindowShowing(id)).toBe(false)
      core.unparkWindows()
      core.EffectBus.emit(close, {})
      panel.off()
    })

    it(`${what}: brought back, it renders open:true`, () => {
      const panel = open()
      core.parkWindows()
      panel.renders.length = 0
      expect(core.unparkWindows()).toBe(1)
      expect(panel.visible()).toBe(true)
      expect(panel.renders.at(-1)).toBe(true)
      expect(core.isWindowShowing(id)).toBe(true)
      core.EffectBus.emit(close, {})
      panel.off()
    })

    it(`${what}: parked, ONE press of its glyph still opens it`, () => {
      const panel = open()
      core.parkWindows()
      expect(panel.visible()).toBe(false)
      core.EffectBus.emit(toggle, {})
      expect(panel.visible()).toBe(true)
      expect(core.isWindowShowing(id)).toBe(true)
      // The way home adds, never closes: the panel stays.
      core.unparkWindows()
      expect(panel.visible()).toBe(true)
      core.EffectBus.emit(close, {})
      panel.off()
    })
  }
})

// ── A PRESS IS A PRESS NOW, NEVER ITS ECHO ───────────────────────────────
//
// The bus replays the last value of an effect to a listener as it
// subscribes. A toggle is a gesture, not a state: a drone that loads (or
// reloads) after some earlier press must not open its panel on the echo.

describe('a toggle pressed before the drone loaded does not open it', () => {
  for (const { what, make, toggle, close, render } of [
    { what: 'hosts', make: () => new HostsDrone(), toggle: 'hosts:view-toggle', close: 'hosts:close', render: 'hosts:render' },
    { what: 'publish', make: () => new PublishStatusDrone(), toggle: 'publish:view-toggle', close: 'publish:close', render: 'publish:render' },
    { what: 'observe', make: () => new ObserveDrone(), toggle: 'observe:toggle', close: 'observe:close', render: 'observe:render' },
  ]) {
    it(`${what}: the replayed press is ignored`, () => {
      core.resetWindowSession()
      core.EffectBus.emit(toggle, {}) // stored: the bus will replay it
      core.EffectBus.emit(close, {}) // the loaded drone closes again
      const seen: boolean[] = []
      const off = core.EffectBus.on(render, (p: { open?: boolean }) => { seen.push(!!p?.open) })
      seen.length = 0 // drop the replay to THIS listener
      const late = make()
      expect(seen).not.toContain(true)
      // A press made now is still a press — and the LATE drone itself
      // answers it (the module's own singleton answering alone would not
      // prove the guard ever turned live).
      const said = vi.spyOn(late as unknown as { emitEffect: (e: string, p: unknown) => void }, 'emitEffect')
      core.EffectBus.emit(toggle, {})
      expect(seen).toContain(true)
      expect(said.mock.calls.some(([e, p]) => e === render && (p as { open?: boolean })?.open === true)).toBe(true)
      late.markDisposed()
      core.EffectBus.emit(close, {})
      off()
    })
  }
})

describe('the shell tells the drone when its panel is parked', () => {
  // The drone-side cases above drive a stand-in session; this pins the real
  // shell halves. The announce is TRANSIENT: a park replayed to a drone that
  // loads later would shut a panel nobody parked.
  for (const { file, shown } of [
    { file: './hypercomb-shared/ui/publish-panel/publish-panel.component.ts', shown: 'publish:shown' },
    { file: './hypercomb-shared/ui/observe-viewer/observe-viewer.component.ts', shown: 'observe:shown' },
  ]) {
    it(`${shown} rides the panel's signalSession announce`, () => {
      const src = read(file)
      const at = src.indexOf('signalSession(')
      expect(at).toBeGreaterThan(-1)
      const call = src.slice(at, at + 300)
      expect(call).toContain(`EffectBus.emitTransient('${shown}'`)
      expect(src.includes(`EffectBus.emit('${shown}'`)).toBe(false)
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
