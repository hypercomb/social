// chat-code.spec.ts — opening one thing in the chat's main pane: drawn there
// when the pane already shows the code, asked for by the window's own switch
// when it shows the conversation, and over the hive where there is no pane.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => [] as Array<[string, unknown]>)
vi.mock('./inspect-window.view.js', () => ({
  inspectWindow: () => ({
    mount: (_host: unknown, frame: unknown) => { calls.push(['mount', frame]) },
    open: (frame: unknown) => { calls.push(['open', frame]) },
    unmount: () => { calls.push(['unmount', null]) },
  }),
}))

const { openChatCode, showChatCode } = await import('./chat-code.js')

const FILE = { kind: 'resource', sig: 'a'.repeat(64), name: 'main.js' } as const
const settle = async (): Promise<void> => { for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0)) }

/** The chat window's two parts this reads: the lent pane and its switch. The
 *  switch, pressed, does what the window does: says the pane is the code's. */
const chat = (on: boolean): { host: HTMLElement; presses: () => number } => {
  const host = document.createElement('div')
  host.className = 'chat-code-host' + (on ? ' on' : '')
  const toggle = document.createElement('button')
  toggle.className = 'chat-code-toggle'
  let presses = 0
  toggle.addEventListener('click', () => {
    presses++
    host.classList.add('on')
    void showChatCode({ open: true, segments: ['business-card'] })
  })
  document.body.replaceChildren(toggle, host)
  return { host, presses: () => presses }
}

beforeEach(() => { calls.length = 0; document.body.replaceChildren() })

describe('opening one thing in the chat’s main pane', () => {
  it('draws it there when the pane already shows the code', async () => {
    const { presses } = chat(true)
    await openChatCode(FILE)
    expect(calls).toEqual([['mount', FILE]])
    expect(presses()).toBe(0)
  })

  it('asks the window to switch when it shows the conversation, and shows the thing asked for, not the tile', async () => {
    const { presses } = chat(false)
    await openChatCode(FILE)
    await settle()
    expect(presses()).toBe(1)
    expect(calls).toEqual([['mount', FILE]])
    // The next switch by hand opens on the tile again.
    await showChatCode({ open: true, segments: ['business-card'] })
    expect(calls.at(-1)).toEqual(['mount', { kind: 'tile', segments: ['business-card'] }])
  })

  it('opens the inspect panel over the hive where there is no pane to lend', async () => {
    await openChatCode(FILE)
    expect(calls).toEqual([['open', FILE]])
  })
})
