// host-online.spec.ts — the "host your hive from this computer" walkthrough,
// against a fake desktop bridge: the app does the work and answers; the page
// says the word and checks the address the way a visitor would.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { canHostHere, hostOnlineBlock, opensAPage, resetHostOnline } from './host-online.js'

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}
const button = (className: string, text: string): HTMLButtonElement => {
  const node = make('button', className, text)
  node.type = 'button'
  return node
}
const t = (_key: string, fallback: string, params?: Record<string, string | number>): string =>
  params ? fallback.replace(/\{(\w+)\}/g, (all, name) => String(params[name] ?? all)) : fallback

type Shell = { __TAURI__?: unknown; ioc?: unknown; fetch: typeof fetch }
const shell = globalThis as unknown as Shell
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

afterEach(() => {
  delete shell.__TAURI__
  resetHostOnline()
  vi.restoreAllMocks()
})

describe('host your hive from this computer', () => {
  it('is not drawn on the web, where nothing can serve', () => {
    expect(canHostHere()).toBe(false)
    expect(hostOnlineBlock({ t, make, button, repaint: () => {} })).toBeNull()
  })

  it('a visitor check passes only when the address carries the door to a page', async () => {
    const page = (html: string, ok = true) => vi.fn(async () => new Response(html, { status: ok ? 200 : 502 })) as unknown as typeof fetch
    expect(await opensAPage('a.example', page('<head><script id="hc-door" type="application/json">{}</script></head>'))).toBe(true)
    expect(await opensAPage('a.example', page('<head></head>'))).toBe(false)
    expect(await opensAPage('a.example', page('', false))).toBe(false)
    expect(await opensAPage('a.example', vi.fn(async () => { throw new Error('down') }) as unknown as typeof fetch)).toBe(false)
  })

  it('try it now: the app goes online, the page is served there, and the address is checked', async () => {
    let tunnel: { kind: string; host: string } | null = null
    const calls: string[] = []
    shell.__TAURI__ = { core: { invoke: async (command: string) => {
      calls.push(command)
      if (command === 'tunnel_status') return { serving: 'http://192.168.1.5:4270', tunnel }
      if (command === 'tunnel_try') return (tunnel = { kind: 'quick', host: 'fancy-words.trycloudflare.com' })
      throw new Error(`unexpected ${command}`)
    } } }
    const said: string[] = []
    const ioc = shell.ioc
    shell.ioc = { get: (key: string) => key === '@diamondcoreprocessor.com/ServeQueenBee'
      ? { invoke: async (args: string) => { said.push(args) } }
      : undefined }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response('<head><script id="hc-door" type="application/json">{}</script></head>'))
    try {
      let block: HTMLElement | null = null
      const repaint = () => { block = hostOnlineBlock({ t, make, button, repaint }) }
      repaint()
      await settle()
      const tryIt = [...block!.querySelectorAll('button')].find(b => b.textContent === 'Try it now')!
      tryIt.click()
      for (let i = 0; i < 10; i++) await settle()

      expect(calls).toContain('tunnel_try')
      expect(said).toEqual(['at fancy-words.trycloudflare.com'])
      expect(block!.textContent).toContain('fancy-words.trycloudflare.com opens your page')
      expect(block!.querySelector('a')?.getAttribute('href')).toBe('https://fancy-words.trycloudflare.com')
    } finally { shell.ioc = ioc }
  })

  it('a cancelled dialog says nothing and serves nothing', async () => {
    const said: string[] = []
    shell.__TAURI__ = { core: { invoke: async (command: string) => {
      if (command === 'tunnel_status') return { serving: null, tunnel: null }
      throw new Error('cancelled')
    } } }
    const ioc = shell.ioc
    shell.ioc = { get: () => ({ invoke: async (args: string) => { said.push(args) } }) }
    try {
      let block: HTMLElement | null = null
      const repaint = () => { block = hostOnlineBlock({ t, make, button, repaint }) }
      repaint()
      await settle()
      ;[...block!.querySelectorAll('button')].find(b => b.textContent === 'Try it now')!.click()
      for (let i = 0; i < 10; i++) await settle()
      expect(said).toEqual([])
      expect(block!.querySelector('.hd-online-said')).toBeNull()
    } finally { shell.ioc = ioc }
  })
})
