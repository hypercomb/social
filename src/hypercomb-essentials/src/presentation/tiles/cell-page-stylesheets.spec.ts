import { afterEach, describe, expect, it, vi } from 'vitest'
import { hoistPageStylesheets, STYLESHEET_WAIT_MS, stylesheetsSettled } from './cell-page-stylesheets.js'

const page = (head: string): Document => new DOMParser()
  .parseFromString(`<!doctype html><html><head>${head}</head><body><p>page</p></body></html>`, 'text/html')

/** Observe a promise without awaiting it. */
const watch = (promise: Promise<void>): { done: boolean } => {
  const state = { done: false }
  void promise.then(() => { state.done = true })
  return state
}

describe('hoistPageStylesheets', () => {
  afterEach(() => { document.head.querySelectorAll('[data-hc-cell-page]').forEach(node => node.remove()) })

  it('moves only the linked sheets into the live head, tagged with the page', () => {
    const links = hoistPageStylesheets(
      page('<link rel="stylesheet" href="/@resource/abc/chrome.css"><link rel="icon" href="/x.png"><style>p{}</style>'),
      'page-sig',
    )
    expect(links).toHaveLength(1)
    expect(links[0].parentNode).toBe(document.head)
    expect(links[0].getAttribute('href')).toBe('/@resource/abc/chrome.css')
    expect(links[0].getAttribute('data-hc-cell-page')).toBe('page-sig')
  })
})

describe('stylesheetsSettled', () => {
  afterEach(() => { vi.useRealTimers() })

  it('resolves at once when the page links no sheets', async () => {
    await expect(stylesheetsSettled([])).resolves.toBeUndefined()
  })

  it('holds the page until every sheet has loaded or failed', async () => {
    const a = document.createElement('link')
    const b = document.createElement('link')
    const state = watch(stylesheetsSettled([a, b]))
    a.dispatchEvent(new Event('load'))
    await Promise.resolve()
    expect(state.done).toBe(false)
    b.dispatchEvent(new Event('error'))
    await Promise.resolve()
    expect(state.done).toBe(true)
  })

  it('never strands the page on a sheet that never answers', async () => {
    vi.useFakeTimers()
    const state = watch(stylesheetsSettled([document.createElement('link')]))
    await vi.advanceTimersByTimeAsync(STYLESHEET_WAIT_MS - 1)
    expect(state.done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(state.done).toBe(true)
  })
})
