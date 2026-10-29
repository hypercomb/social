import { afterEach, describe, expect, it, vi } from 'vitest'
import { pageHomeOf, releaseTrial, rememberTrial, stageTrial, trialBase, trialLabel, trialOf, trialOrigin, trialVector, trialVersion, trialVersionLabel, trialZone } from './try-page.js'

afterEach(() => localStorage.clear())

describe('a page trial', () => {
  it('names the door from the tile, as one try- label', () => {
    expect(trialLabel(['home', 'Studio'])).toBe('try-studio')
    expect(trialLabel(['notes'])).toBe('try-notes')
    expect(trialZone('localhost')).toBe('localhost')
    expect(trialZone('127.0.0.1')).toBe('localhost')
    expect(trialZone('try-other.hypercomb.io')).toBe('hypercomb.io')
    expect(trialOrigin('try-studio', 'http://localhost:4250/')).toBe('http://try-studio.localhost:4250')
    expect(trialOrigin('try-studio', 'https://hypercomb.io/')).toBe('https://try-studio.hypercomb.io')
    expect(trialOrigin('try-studio', 'https://jwize.com/')).toBe('https://try-studio.jwize.com')
    expect(trialLabel([''])).toBeNull()
  })

  it('numbers versions on the same name and leaves a name that only looks like one', () => {
    expect(trialBase('try-press-kit')).toBe('try-press-kit')
    expect(trialVersion('try-press-kit')).toBeNull()
    expect(trialBase('try-press-kit-v2')).toBe('try-press-kit')
    expect(trialVersion('try-press-kit-v2')).toBe(2)
    expect(trialVersionLabel('try-press-kit', 3)).toBe('try-press-kit-v3')
    expect(trialOrigin('try-press-kit-v3', 'http://localhost:4250/')).toBe('http://try-press-kit-v3.localhost:4250')
    expect(trialBase('try-v2')).toBe('try-v2')
    expect(trialVersion('try-v2')).toBeNull()
    expect(trialVector('try-press-kit-v2')).toBe('1.0.0.2')
    expect(trialBase('try-press-kit-v1-1-0-3')).toBe('try-press-kit')
    expect(trialVector('try-press-kit-v1-1-0-3')).toBe('1.1.0.3')
    expect(trialVersion('try-press-kit-v1-1-0-3')).toBeNull()
    expect(trialVersionLabel('try-press-kit', 0)).toBeNull()
  })

  it('remembers a resource as a trial and ignores anything else', () => {
    const sig = 'a'.repeat(64)
    rememberTrial(sig, 'try-studio')
    rememberTrial('nope', 'try-studio')
    rememberTrial(sig, 'studio')
    expect(trialOf(sig)).toBe('try-studio')
    expect(trialOf('b'.repeat(64))).toBeNull()
  })

  it('comes home only when a person releases it, onto localhost or their domain', () => {
    const sig = 'a'.repeat(64)
    expect(pageHomeOf('localhost')).toEqual({ where: 'localhost', name: 'localhost' })
    expect(pageHomeOf('try-studio.localhost')).toEqual({ where: 'localhost', name: 'localhost' })
    expect(pageHomeOf('jwize.com')).toEqual({ where: 'domain', name: 'jwize.com' })
    expect(releaseTrial(sig)).toBe(false)
    rememberTrial(sig, 'try-studio')
    expect(releaseTrial(sig)).toBe(true)
    expect(trialOf(sig)).toBeNull()
  })

  it('copies a page picture onto the trial after the page is accepted', async () => {
    const sig = 'ab'.repeat(32)
    const html = `<img src="resource:${sig}/art.png">`
    const blob = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])], { type: 'image/png' })
    const calls: Array<{ headers: Headers; body: unknown }> = []
    const prior = window.ioc
    window.ioc = {
      get: (key: string) => (key === '@hypercomb.social/Store' ? { getResource: async () => blob } : undefined),
    } as unknown as Window['ioc']
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      calls.push({ headers: new Headers(init?.headers), body: init?.body })
      return new Response(null, {
        status: 204,
        headers: { 'x-hc-trial-version': '1', 'x-hc-trial-label': 'try-studio', 'x-hc-trial-vector': '1.0.0.1' },
      })
    })
    try {
      const staged = await stageTrial('try-studio', html, 'http://127.0.0.1:4250/')
      expect(staged.ok).toBe(true)
      expect(staged.version).toBe(1)
      expect(calls).toHaveLength(2)
      expect(calls[1].headers.get('x-hc-trial')).toBe('try-studio')
      expect(calls[1].headers.get('x-hc-trial-asset')).toBe(sig)
      expect(calls[1].headers.get('content-type')).toBe('image/png')
      expect(calls[1].body).toBe(blob)

      calls.length = 0
      const plain = await stageTrial('try-studio', '<p>Only the page.</p>', 'http://127.0.0.1:4250/')
      expect(plain.ok).toBe(true)
      expect(calls).toHaveLength(1)

      window.ioc = {
        get: () => ({ getResource: async () => { throw new Error('missing') } }),
      } as unknown as Window['ioc']
      calls.length = 0
      const missed = await stageTrial('try-studio', html, 'http://127.0.0.1:4250/')
      expect(missed.ok).toBe(true)
      expect(calls).toHaveLength(1)
    } finally {
      fetchSpy.mockRestore()
      window.ioc = prior
    }
  })
})
