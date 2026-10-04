// ui/chat-window/hypercomb-work-fence.rollback.spec.ts — what a model is told
// when its block stopped and the hive put the pages back.
//
// The receipt must never claim more than happened: "nothing of the block
// stands" only when every page went back and no line wrote outside the pages.

import { describe, expect, it } from 'vitest'
import { doFailedMessage, type DoRollback } from './hypercomb-work-fence'

const told = (rollback: DoRollback): string =>
  doFailedMessage(['/create a', '/title a = A'], '/paste', 'nothing was placed here', 'q', rollback)

describe('a stopped block, rolled back', () => {
  it('every page back and nothing beyond them: nothing of the block stands', () => {
    const text = told({ restored: 2, kept: 0, failed: 0, beyond: [] })
    expect(text).toContain('It ran before stopping:\n- /create a\n- /title a = A')
    expect(text).toContain('The hive put back the 2 pages they changed, as new versions')
    expect(text).toContain('Nothing of the block stands.')
  })

  it('a line that wrote outside the pages is named, and the block is not called undone', () => {
    const text = told({ restored: 1, kept: 0, failed: 0, beyond: ['/keyword a = b'] })
    expect(text).toContain('What these lines wrote outside the pages stays: /keyword a = b.')
    expect(text).not.toContain('Nothing of the block stands')
  })

  it('pages moved by something else, or not put back, are said', () => {
    const text = told({ restored: 0, kept: 1, failed: 1, beyond: [] })
    expect(text).toContain('No page was put back.')
    expect(text).toContain('1 page changed again by something else meanwhile was left as it is.')
    expect(text).toContain('1 page could not be put back.')
    expect(text).not.toContain('Nothing of the block stands')
  })

  it('a refused roll back says why and that nothing went back', () => {
    const text = told({ restored: 0, kept: 0, failed: 0, refused: 'the hive takes no writes', beyond: [] })
    expect(text).toContain('Nothing was put back: the hive takes no writes.')
    expect(text).not.toContain('Nothing of the block stands')
  })

  it('lines that changed no page are said plainly', () => {
    expect(told({ restored: 0, kept: 0, failed: 0, beyond: [] })).toContain('Those lines changed no page, so there was nothing to put back.')
  })

  it('without a roll back the receipt is what it always was', () => {
    expect(doFailedMessage(['/a b'], '/c d', 'no such tile', 'q')).not.toContain('put back')
  })
})
