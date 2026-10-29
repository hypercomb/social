import { createServer, request as httpRequest } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'

const { handleTrial } = createRequire(import.meta.url)('./try-page-door.cjs') as {
  handleTrial: (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse, options?: { dir?: string }) => Promise<boolean>
}

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

const listen = (dir: string) => new Promise<{ port: number; close: () => Promise<void> }>((resolve, reject) => {
  const server = createServer((request, response) => {
    void handleTrial(request, response, { dir }).then(handled => {
      if (handled || response.writableEnded) return
      response.statusCode = 200
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end('<title>Hypercomb Development</title>')
    }).catch(reject)
  })
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (!address || typeof address === 'string') { reject(new Error('no port')); return }
    resolve({
      port: address.port,
      close: () => new Promise((done, fail) => server.close(error => error ? fail(error) : done())),
    })
  })
})

const ask = (port: number, method: string, host: string, path = '/', body?: string | Buffer, headers: Record<string, string> = {}) => new Promise<{ status: number; type: string; csp: string; text: string; bytes: Buffer; version: string; assigned: string; location: string }>((resolve, reject) => {
  const request = httpRequest({ host: '127.0.0.1', port, method, path, headers: { host, ...headers } }, (response) => {
    const chunks: Buffer[] = []
    response.on('data', (chunk: Buffer) => chunks.push(chunk))
    response.on('end', () => {
      const bytes = Buffer.concat(chunks)
      resolve({
        status: response.statusCode ?? 0,
        type: String(response.headers['content-type'] || ''),
        csp: String(response.headers['content-security-policy'] || ''),
        text: bytes.toString('utf8'),
        bytes,
        version: String(response.headers['x-hc-trial-version'] || ''),
        assigned: String(response.headers['x-hc-trial-label'] || ''),
        location: String(response.headers.location || ''),
      })
    })
  })
  request.on('error', reject)
  if (body) request.write(body)
  request.end()
})

describe('the website trial door', () => {
  it('returns the stored page, and the hive for every other host', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hc-trial-'))
    dirs.push(dir)
    const server = await listen(dir)
    try {
      const before = await ask(server.port, 'GET', 'try-press-kit.localhost:4250')
      expect(before.text).toContain('Hypercomb Development')

      const posted = await ask(server.port, 'POST', 'localhost:4250', '/', '<!doctype html><title>Press kit</title><p>Only the page.</p>', {
        'content-type': 'text/html; charset=utf-8',
        'x-hc-trial': 'try-press-kit',
      })
      expect(posted.status).toBe(204)
      expect(posted.version).toBe('1')
      expect(posted.assigned).toBe('try-press-kit-v1')

      const again = await ask(server.port, 'POST', 'localhost:4250', '/', '<!doctype html><title>Press kit</title><p>Only the page.</p>', {
        'content-type': 'text/html; charset=utf-8',
        'x-hc-trial': 'try-press-kit',
      })
      expect(again.version).toBe('1')

      const second = await ask(server.port, 'POST', 'localhost:4250', '/', '<!doctype html><title>Press kit</title><p>Hours.</p>', {
        'content-type': 'text/html; charset=utf-8',
        'x-hc-trial': 'try-press-kit',
      })
      expect(second.version).toBe('2')

      const raw1 = await ask(server.port, 'GET', 'try-press-kit-v1.localhost:4250', '/raw')
      expect(raw1.status).toBe(200)
      expect(raw1.text).toBe('<!doctype html><title>Press kit</title><p>Only the page.</p>')
      expect(raw1.text).not.toContain('Hypercomb Development')
      expect(raw1.csp).toContain("connect-src 'none'")
      expect(raw1.csp).toContain("form-action 'none'")
      expect(raw1.csp).toContain('frame-ancestors http://try-press-kit.localhost:4250')
      expect(raw1.csp).toContain('http://try-press-kit-v1.localhost:4250')

      const v1 = await ask(server.port, 'GET', 'try-press-kit-v1.localhost:4250')
      expect(v1.status).toBe(200)
      expect(v1.text).toContain('Suggest from these')
      expect(v1.text).toContain('Keep marks')
      expect(v1.text).toContain('sandbox="allow-scripts"')
      expect(v1.text).not.toContain('allow-same-origin')
      expect(v1.text).not.toContain('Only the page.')
      expect(v1.text).not.toContain('Hypercomb Development')
      expect(v1.csp).toContain("form-action 'self'")
      expect(v1.csp).toContain("frame-src 'self'")
      expect(v1.csp).toContain("frame-ancestors 'none'")
      expect(v1.csp).not.toContain('script-src')

      const raw2 = await ask(server.port, 'GET', 'try-press-kit-v2.localhost:4250', '/raw')
      expect(raw2.text).toContain('Hours.')
      expect(raw2.text).not.toContain('Only the page.')

      const lineup = await ask(server.port, 'GET', 'try-press-kit.localhost:4250')
      expect(lineup.status).toBe(200)
      expect(lineup.text).toContain('try-press-kit-v1.localhost:4250')
      expect(lineup.text).toContain('try-press-kit-v2.localhost:4250')
      expect(lineup.text).toContain('/raw')
      expect(lineup.text).toContain('Suggest from these')
      expect(lineup.text).not.toContain('Hypercomb Development')
      expect(lineup.csp).toContain("frame-ancestors 'none'")
      expect(lineup.csp).toContain('frame-src')
      expect(lineup.csp).toContain("form-action 'self'")

      const missing = await ask(server.port, 'GET', 'try-press-kit-v9.localhost:4250')
      expect(missing.status).toBe(404)
      expect(missing.text).not.toContain('Hypercomb Development')

      const asset = await ask(server.port, 'GET', 'try-press-kit-v1.localhost:4250', '/main.js')
      expect(asset.status).toBe(404)
      expect(asset.text).not.toContain('Hypercomb Development')

      expect(lineup.text).toContain('class="side"')
      expect(lineup.text).toContain('1.0.0')
      expect(lineup.text).toContain('Changes')
      expect(lineup.text).toContain('Comparison')

      const list = await ask(server.port, 'GET', 'localhost:4250', '/', undefined, { 'x-hc-trial-list': 'try-press-kit' })
      expect(JSON.parse(list.text)).toEqual({
        base: 'try-press-kit',
        versions: [1, 2],
        latest: 2,
        vectors: ['1.0.0.1', '1.0.0.2'],
        latestVector: '1.0.0.2',
      })

      const hive = await ask(server.port, 'GET', 'localhost:4250')
      expect(hive.text).toContain('Hypercomb Development')

      const branched = await ask(server.port, 'POST', 'localhost:4250', '/', '<!doctype html><title>Press kit</title><h2>Updated</h2>', {
        'content-type': 'text/html; charset=utf-8',
        'x-hc-trial': 'try-press-kit',
        'x-hc-trial-bump': 'minor',
        'x-hc-trial-summary': 'Updated from the two builds.',
        'x-hc-trial-from': '1.0.0.1 1.0.0.2',
      })
      expect(branched.status).toBe(204)
      expect(branched.assigned).toBe('try-press-kit-v1-1-0-1')

      const line = await ask(server.port, 'GET', 'try-press-kit-v1-1-0-1.localhost:4250', '/raw')
      expect(line.status).toBe(200)
      expect(line.text).toContain('Updated')
      expect(line.text).not.toContain('Hypercomb Development')

      const shelf = await ask(server.port, 'GET', 'try-press-kit.localhost:4250')
      expect(shelf.text).toContain('1.1.0')
      expect(shelf.text).toContain('Updated from the two builds.')
      expect(shelf.text).toContain('from 1.0.0.1, 1.0.0.2')

      const marked = await ask(server.port, 'POST', 'try-press-kit-v2.localhost:4250', '/', 'pick=1.0.0.1&pick=1.0.0.2&ask=Add+a+note&act=mark', {
        'content-type': 'application/x-www-form-urlencoded',
      })
      expect(marked.status).toBe(303)
      expect(marked.location).toBe('/')

      const shared = await ask(server.port, 'GET', 'try-press-kit-v1.localhost:4250')
      expect(shared.text).toContain('value="1.0.0.1" checked')
      expect(shared.text).toContain('value="1.0.0.2" checked')
      const sharedLineup = await ask(server.port, 'GET', 'try-press-kit.localhost:4250')
      expect(sharedLineup.text).toContain('value="1.0.0.1" checked')
      expect(sharedLineup.text).toContain('value="1.0.0.2" checked')

      const suggested = await ask(server.port, 'POST', 'try-press-kit.localhost:4250', '/', 'pick=1.0.0.2&ask=Add+a+note&act=suggest', {
        'content-type': 'application/x-www-form-urlencoded',
      })
      expect(suggested.status).toBe(303)
      expect(suggested.location).toContain('http://localhost:4250/?')
      expect(suggested.location).toContain('hc-trial=try-press-kit')
      expect(suggested.location).toContain('picked=1.0.0.2')
      expect(suggested.location).toContain('ask=Add+a+note')

      const plain = await ask(server.port, 'POST', 'try-press-kit-v1.localhost:4250', '/', 'nope', {
        'content-type': 'text/plain',
      })
      expect(plain.status).toBe(405)
    } finally {
      await server.close()
    }
  })

  it('serves a page picture and stylesheet from the trial, and leaves connect closed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hc-trial-'))
    dirs.push(dir)
    const server = await listen(dir)
    const pngSig = 'ab'.repeat(32)
    const cssSig = 'cd'.repeat(32)
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    const html = `<!doctype html><link rel="stylesheet" href="resource:${cssSig}/chrome.css"><img src="resource:${pngSig}/art.png">`
    try {
      const posted = await ask(server.port, 'POST', 'localhost:4250', '/', html, {
        'content-type': 'text/html; charset=utf-8',
        'x-hc-trial': 'try-revolucion',
      })
      expect(posted.status).toBe(204)
      expect(posted.version).toBe('1')

      const picture = await ask(server.port, 'POST', 'localhost:4250', '/', png, {
        'content-type': 'image/png',
        'x-hc-trial': 'try-revolucion',
        'x-hc-trial-asset': pngSig,
      })
      expect(picture.status).toBe(204)

      const style = await ask(server.port, 'POST', 'localhost:4250', '/', 'body{color:red}', {
        'content-type': 'text/css',
        'x-hc-trial': 'try-revolucion',
        'x-hc-trial-asset': cssSig,
      })
      expect(style.status).toBe(204)

      const refused = await ask(server.port, 'POST', 'localhost:4250', '/', 'not a picture', {
        'content-type': 'text/plain',
        'x-hc-trial': 'try-revolucion',
        'x-hc-trial-asset': 'ee'.repeat(32),
      })
      expect(refused.status).toBe(415)

      const unnamed = await ask(server.port, 'POST', 'localhost:4250', '/', png, {
        'content-type': 'image/png',
        'x-hc-trial': 'try-revolucion',
        'x-hc-trial-asset': 'nope',
      })
      expect(unnamed.status).toBe(400)

      const list = await ask(server.port, 'GET', 'localhost:4250', '/', undefined, { 'x-hc-trial-list': 'try-revolucion' })
      expect(JSON.parse(list.text).latest).toBe(1)
      expect(JSON.parse(list.text).versions).toEqual([1])

      const stored = await readFile(join(dir, 'try-revolucion-v1.html'), 'utf8')
      expect(stored).toContain(`resource:${pngSig}/art.png`)
      expect(stored).toContain(`resource:${cssSig}/chrome.css`)

      const raw = await ask(server.port, 'GET', 'try-revolucion-v1.localhost:4250', '/raw')
      expect(raw.status).toBe(200)
      expect(raw.text).toContain(`/asset/${pngSig}/art.png`)
      expect(raw.text).toContain(`/asset/${cssSig}/chrome.css`)
      expect(raw.text).not.toContain('resource:')
      expect(raw.csp).toContain("connect-src 'none'")
      expect(raw.csp).toContain("form-action 'none'")
      expect(raw.csp).toContain("style-src http://try-revolucion-v1.localhost:4250 'unsafe-inline'")
      expect(raw.csp).toContain('img-src http://try-revolucion-v1.localhost:4250 data: blob:')
      expect(raw.csp).not.toContain("'self'")
      expect(raw.csp).not.toContain('https:')
      expect(raw.csp).toContain("script-src 'unsafe-inline'")

      const got = await ask(server.port, 'GET', 'try-revolucion-v1.localhost:4250', `/asset/${pngSig}/art.png`)
      expect(got.status).toBe(200)
      expect(got.type).toBe('image/png')
      expect(got.bytes.equals(png)).toBe(true)
      expect(got.csp).toBe("default-src 'none'")

      const css = await ask(server.port, 'GET', 'try-revolucion-v1.localhost:4250', `/asset/${cssSig}/chrome.css`)
      expect(css.status).toBe(200)
      expect(css.type).toContain('text/css')
      expect(css.text).toBe('body{color:red}')

      const missing = await ask(server.port, 'GET', 'try-revolucion-v1.localhost:4250', `/asset/${'ff'.repeat(32)}/art.png`)
      expect(missing.status).toBe(404)
    } finally {
      await server.close()
    }
  })
})
