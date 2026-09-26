// @vitest-environment node
//
// offline-shell.spec.ts — THE SHELL, FOR OFFLINE. The shim's worker answers
// the page, the kernel, the processor, the theme and the host faces network
// first and keeps each good answer, so an installed hive starts with the
// network cut. The worker is a plain script (it registers `self` handlers),
// so `networkThenShell` is lifted out of its source by brace matching.

import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../public/hypercomb.worker.js', import.meta.url)), 'utf8')

const lift = (name: string): string => {
  const start = source.indexOf(`async function ${name}(`)
  expect(start, `harness: ${name} not found in the worker source`).toBeGreaterThan(-1)
  let depth = 0
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1)
  }
  throw new Error(`harness: could not find the end of ${name}`)
}

type Shell = (request: Request, key: string) => Promise<Response>
const kept = new Map<string, Response>()
let online = true
let answer: () => Response = () => new Response('page', { status: 200 })

const stubs = {
  fetch: async () => {
    if (!online) throw new TypeError('Failed to fetch')
    const response = answer()
    Object.defineProperty(response, 'type', { value: 'basic' })
    return response
  },
  caches: {
    open: async () => ({
      put: async (key: string, response: Response) => { kept.set(key, response) },
      match: async (key: string) => kept.get(key)?.clone(),
    }),
  },
}

const load = async (): Promise<Shell> => {
  const body = `${lift('networkThenShell')}\nreturn networkThenShell`
  return new Function('SHELL_CACHE', 'fetch', 'caches', body)('hypercomb-shell-v1', stubs.fetch, stubs.caches) as Shell
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('the offline shell', () => {
  beforeEach(() => { kept.clear(); online = true; answer = () => new Response('page', { status: 200 }) })

  it('answers from the network and keeps a good answer', async () => {
    const shell = await load()
    expect(await (await shell(new Request('http://h/'), '/')).text()).toBe('page')
    await settle()
    expect(await kept.get('/')!.clone().text()).toBe('page')
  })

  it('answers from the kept copy when the network fails', async () => {
    const shell = await load()
    await shell(new Request('http://h/'), '/'); await settle()
    online = false
    expect(await (await shell(new Request('http://h/deep/link'), '/')).text()).toBe('page')
  })

  it('never keeps a failed answer', async () => {
    const shell = await load()
    answer = () => new Response('missing', { status: 404 })
    await shell(new Request('http://h/main.js'), '/main.js'); await settle()
    expect(kept.has('/main.js')).toBe(false)
  })

  it('fails as the network does when nothing is kept', async () => {
    const shell = await load()
    online = false
    await expect(shell(new Request('http://h/'), '/')).rejects.toThrow('Failed to fetch')
  })
})
