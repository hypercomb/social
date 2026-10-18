// A window opens only from its own door. The bus replays the last
// `workflow:view-open` to a new subscriber, so the designer ignores the
// replay it receives at subscribe time: only a request made while it listens
// opens it. Read from the source (the component needs the Angular host).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PANEL = readFileSync(
  join(process.cwd(), 'hypercomb-shared', 'ui', 'workflow-designer', 'workflow-designer.component.ts'), 'utf8')

describe('the workflow designer ignores the replayed open', () => {
  it('guards workflow:view-open with a live flag set after it subscribes', () => {
    const subscribe = PANEL.indexOf("EffectBus.on('workflow:view-open'")
    expect(subscribe).toBeGreaterThan(-1)
    const declared = PANEL.lastIndexOf('let live = false', subscribe)
    expect(declared).toBeGreaterThan(-1)
    const handler = PANEL.slice(subscribe, PANEL.indexOf('}))', subscribe))
    expect(handler.indexOf('if (!live) return')).toBeLessThan(handler.indexOf('this.visible.set(true)'))
    expect(PANEL.indexOf('live = true', subscribe)).toBeGreaterThan(subscribe)
  })
})
