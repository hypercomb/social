// hypercomb-runtime/src/chat-window/ui/chat-window/chat-delete-hide-first.spec.ts
//
// HIDE FIRST, DELETE SECOND (documentation/hide-first-delete-second.md). A
// conversation's Delete removes its whole thread; archiving is the hide. So
// Delete is offered only on a conversation already put away — or where there
// is nothing to put away (no turns, or a build that cannot archive).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The chat window's template, where it lives now that it runs without Angular.
const template = readFileSync(join(__dirname, '../../chat-window.template.ts'), 'utf8')

describe('chat Delete', () => {
  it('is offered only behind the hide', () => {
    const del = template.indexOf('class: "chat-list-del"')
    expect(del).toBeGreaterThan(0)
    const gate = template.lastIndexOf('when([', del)
    expect(template.slice(gate, del)).toContain(
      '[() => ((ctx()["$implicit"].archived || !c.canArchive()) || !ctx()["$implicit"].turnCount), () => [',
    )
  })
})
