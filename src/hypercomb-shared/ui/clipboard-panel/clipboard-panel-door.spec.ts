// A window opens only from its own door. A copy or cut used to pop the
// clipboard open (parking whatever was up, the chat among them); now the
// capture answers with a toast that CARRIES the door, and only the
// `clipboard:panel` request opens the window. Read from the source, the way
// publish-panel-inspect.spec.ts reads its panel: the shell component needs
// the whole Angular host to construct.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PANEL = readFileSync(
  join(process.cwd(), 'hypercomb-shared', 'ui', 'clipboard-panel', 'clipboard-panel.component.ts'), 'utf8')

describe('the clipboard window opens only from its own door', () => {
  it('a capture answers with a toast that carries the door, and never opens the panel', () => {
    const start = PANEL.indexOf("'clipboard:captured'")
    expect(start).toBeGreaterThan(-1)
    const body = PANEL.slice(start, PANEL.indexOf("'clipboard:panel', (p)", start))
    expect(body).not.toMatch(/#setVisible\(|visible\.set\(/)
    expect(body).toContain("actionEffect: 'clipboard:panel'")
    expect(body).toMatch(/if \(!live/)
  })
})
