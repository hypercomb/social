// features-viewer-refresh.spec.ts — A REFRESH NEVER REVEALS THE BEEHAVIORS PANEL.
//
// A window opens only when the participant asks for that window. The panel's
// own re-reads (a roster flip, navigation, a reach choice) and the drone's
// answers to writes are REFRESHES: they update the panel while it is showing
// and are dropped while it is down. Only a door's request — the rail switch,
// the `views` word, the store button — may raise it. Read from the source, as
// the component cannot be constructed outside Angular here.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PANEL = readFileSync(
  join(process.cwd(), 'hypercomb-shared', 'ui', 'features-viewer', 'features-viewer.component.ts'), 'utf8')

/** The body of the method or handler starting at `marker`, up to `until`. */
const slice = (marker: string, until: string): string => {
  const start = PANEL.indexOf(marker)
  expect(start).toBeGreaterThan(-1)
  const rest = PANEL.slice(start)
  return rest.slice(0, rest.indexOf(until, marker.length))
}

describe('the Beehaviors panel and refreshes', () => {
  it('drops a refresh answer before it can raise a panel that is down', () => {
    const handler = slice("EffectBus.on<FeaturesOpenPayload>('features:open'", 'this.visible.set(true)')
    // While down a refresh only updates a held (parked) group in place, then
    // returns before anything below can set visible.
    const down = handler.slice(handler.indexOf('if (p.refresh === true && !this.visible()) {'))
    expect(down.length).toBeLessThan(handler.length)
    const ret = down.indexOf('return')
    expect(ret).toBeGreaterThan(-1)
    expect(down.slice(0, ret)).not.toContain('visible.set')
  })

  it('marks its own re-reads as refreshes — the group refresh, navigation and a reach choice', () => {
    expect(slice('#refreshGroup(): void {', '\n  }')).toContain('this.#openAt(g.segments, g.cell, true)')
    expect(slice('const onNav = (): void => {', '\n      }')).toContain("this.#openAt(segs, 'hypercomb', true)")
    expect(slice('async setSourceScope(', '\n  }')).toContain('this.#openAt(group.segments, group.cell, true)')
  })

  it('still answers its doors with a plain request — the rail switch and a lens', () => {
    expect(slice("EffectBus.on('features:context-open'", '}))')).toContain('this.#openAt(this.#currentSegments())')
    expect(slice("EffectBus.on<{ lens?: string }>('features:lens'", '}))')).toContain('this.#openAt(this.#currentSegments())')
  })

  it('carries the refresh flag on the request it sends the drone', () => {
    const openAt = slice('#openAt(segments: readonly string[]', '\n  }')
    expect(openAt).toContain('refresh ? { refresh: true } : {}')
    expect(openAt.match(/\.\.\.flag/g)).toHaveLength(2)
  })
})
