// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { markWorkbenchPage, workbenchKeeps } from './workbench-page'

const page = '<html lang="en"><head></head><body></body></html>'

describe('the workbench mark', () => {
  it('marks a try- door and leaves the root and a named mode alone', () => {
    expect(markWorkbenchPage(page, 'try-review.jwize.com')).toBe(
      '<html data-hypercomb-mode="workbench" lang="en"><head></head><body></body></html>',
    )
    expect(markWorkbenchPage(page, 'jwize.com')).toBe(page)
    expect(markWorkbenchPage(page, 'swarm.jwize.com')).toBe(page)
    const visitor = page.replace('<html', '<html data-hypercomb-mode="visitor"')
    expect(markWorkbenchPage(visitor, 'try-review.jwize.com')).toBe(visitor)
  })

  it('keeps the chat and leaves the other surfaces out', () => {
    expect(workbenchKeeps('hc-chat-window', true)).toBe(true)
    expect(workbenchKeeps('hc-command-palette', true)).toBe(false)
    expect(workbenchKeeps('hc-command-palette', false)).toBe(true)
  })
})
