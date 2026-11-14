// @vitest-environment jsdom
//
// hypercomb-shim/src/bootstrap/copy-text.spec.ts — what the other place needs
// goes to the clipboard, and the button says whether it did.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText, offerCopy } from './copy-text'

const withClipboard = (writeText: unknown): void => {
  Object.defineProperty(navigator, 'clipboard', { value: writeText === undefined ? undefined : { writeText }, configurable: true })
}
afterEach(() => { withClipboard(undefined) })

describe('copyText', () => {
  it('puts the text on the clipboard', async () => {
    const writeText = vi.fn(async () => {})
    withClipboard(writeText)
    expect(await copyText('https://example.org/#invite=abc')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('https://example.org/#invite=abc')
  })

  it('answers false where the browser refuses, and where it has no clipboard', async () => {
    withClipboard(vi.fn(async () => { throw new DOMException('no', 'NotAllowedError') }))
    expect(await copyText('x')).toBe(false)
    withClipboard(undefined)
    expect(await copyText('x')).toBe(false)
  })
})

describe('offerCopy', () => {
  const labels = { idle: 'Copy the link', done: 'Link copied' }

  it('copies without a press when asked to, and says so on the button', async () => {
    const button = document.createElement('button')
    const copy = vi.fn(async () => true)
    const said = vi.fn()
    const offer = offerCopy(button, 'the link', labels, said, copy)
    expect(button.textContent).toBe('Copy the link')
    expect(await offer.now()).toBe(true)
    expect(copy).toHaveBeenCalledWith('the link')
    expect(button.textContent).toBe('Link copied')
    expect(said).toHaveBeenLastCalledWith(true)
  })

  it('leaves the button to press when the first copy is refused, and a press copies', async () => {
    const button = document.createElement('button')
    let allowed = false
    const copy = vi.fn(async () => allowed)
    const said = vi.fn()
    const offer = offerCopy(button, 'the link', labels, said, copy)
    expect(await offer.now()).toBe(false)
    expect(button.textContent).toBe('Copy the link')
    expect(said).toHaveBeenLastCalledWith(false)
    allowed = true
    button.click()
    await vi.waitFor(() => expect(button.textContent).toBe('Link copied'))
    expect(copy).toHaveBeenCalledTimes(2)
  })

  it('a copy that throws is a refusal, never an error on the page', async () => {
    const button = document.createElement('button')
    const offer = offerCopy(button, 'the link', labels, () => {}, async () => { throw new Error('gone') })
    expect(await offer.now()).toBe(false)
    expect(button.textContent).toBe('Copy the link')
  })
})
