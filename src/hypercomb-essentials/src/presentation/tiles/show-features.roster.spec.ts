// show-features.roster.spec.ts — A RETIRED MARK IS NOT A FOREIGN BEHAVIOUR.
//
// The Beehaviors pool is the census: every behaviour the app knows, one light
// each — and, so that nothing can strand itself, every kind that carries a
// record (lit, off or bound) but that no module here declares, listed as a
// FOREIGN behaviour waiting on its module. A view that was RETIRED leaves
// exactly such a record behind: its mark was lit while the view lived, and
// the lit-list is never rewritten. Without the guard the three document
// views retired 2026-10-16 came straight back into the pool as "Living
// brief", "Evidence atlas" and "Knowledge studio", each waiting on a module
// that will never arrive. A kind a retirement names is skipped; a kind nobody
// retired is still listed; and a live bee's kind is listed as live, because
// the retirement is read only after the live lookup missed.

import { beforeEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const services = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  get: (key: string) => services.get(key),
  register: (key: string, value: unknown) => { if (!services.has(key)) services.set(key, value) },
  list: () => [...services.keys()],
  whenReady: () => void 0,
  onRegister: () => void 0,
}

const RETIRED_KIND = 'visual:document:living-brief'
const FOREIGN_KIND = 'visual:lightbox:gallery'
const LIVE_KIND = 'visual:postit:note'

services.set('@diamondcoreprocessor.com/SlashBehaviourDrone', {
  retiredKind: (kind: string) => kind === RETIRED_KIND ? { word: 'brief', kinds: [RETIRED_KIND] } : undefined,
})
services.set('@hypercomb.social/I18n', { t: (key: string) => key })

type Bee = { view: string; decorationKind: string; iconName: string; labelKey: string; descriptionKey: string }
const bees: Bee[] = []
services.set('@diamondcoreprocessor.com/VisualBeeRegistry', {
  all: () => bees,
  get: (view: string) => bees.find(b => b.view === view),
  byDecorationKind: (kind: string) => bees.find(b => b.decorationKind === kind),
})

await import('./show-features.drone.js')

type Row = { kind: string; foreign?: boolean }

/** Open the pool and read the rows it answers with. The answer is transient
 *  (it never replays to a later subscriber), so listen before asking. */
const roster = (): Row[] => {
  let rows: Row[] = []
  const off = EffectBus.on<{ rows: Row[] }>('features:roster', p => { rows = p.rows })
  EffectBus.emit('features:roster-open', {})
  off()
  return rows
}

/** Write the enablement lists the way the shell's writer does — and say so,
 *  because the essentials reader caches them until that effect fires. */
const enablement = (on: string[] | null, off: string[] = []): void => {
  if (on) localStorage.setItem('hc:behavior-global-on', JSON.stringify(on))
  else localStorage.removeItem('hc:behavior-global-on')
  localStorage.setItem('hc:behavior-global-off', JSON.stringify(off))
  EffectBus.emit('behavior:enablement-changed', {})
}

describe('the Beehaviors pool and a retired mark', () => {
  beforeEach(() => {
    localStorage.clear()
    bees.length = 0
  })

  it('never lists a kind a retirement names — lit, off or bound, it is not waiting on a module', () => {
    enablement([RETIRED_KIND])
    expect(roster().map(r => r.kind)).not.toContain(RETIRED_KIND)

    enablement([], [RETIRED_KIND])
    expect(roster().map(r => r.kind)).not.toContain(RETIRED_KIND)
  })

  it('still lists a lit kind nobody here declares, as the foreign behaviour it is', () => {
    enablement([RETIRED_KIND, FOREIGN_KIND])
    const rows = roster()
    expect(rows.map(r => r.kind)).not.toContain(RETIRED_KIND)
    expect(rows.find(r => r.kind === FOREIGN_KIND)?.foreign).toBe(true)
  })

  it('lists a live bee as live — the retirement is read only after the live lookup missed', () => {
    bees.push({ view: 'postit', decorationKind: LIVE_KIND, iconName: 'note', labelKey: 'postit.label', descriptionKey: 'postit.desc' })
    enablement([LIVE_KIND, RETIRED_KIND])
    const rows = roster()
    expect(rows.map(r => r.kind)).not.toContain(RETIRED_KIND)
    const live = rows.find(r => r.kind === LIVE_KIND)
    expect(live).toBeDefined()
    expect(live?.foreign).toBeUndefined()
  })
})
