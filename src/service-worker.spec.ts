// @vitest-environment node
//
// service-worker.spec.ts
//
// Runs in NODE, not the suite's default jsdom: jsdom's Blob does not implement
// `.slice().arrayBuffer()` / `.text()`, and the sniffers treat a read failure
// as "cannot tell" — so under jsdom every case would pass through the catch
// and return '', turning a real sniffer into one that silently answers 
// nothing. Node's Blob is the same shape a service worker actually sees.
//
// Guards the two properties of `hypercomb.worker.js` that rot silently.
//
// 1. THE TWO COPIES MUST NOT DRIFT. `hypercomb-web/public/` and
//    `hypercomb-dev/public/` each ship their own copy of the service worker
//    and nothing builds one from the other — so a fix applied to the shell
//    you happened to be testing in stays there, and the other shell keeps the
//    bug. Byte equality is the only check that catches it.
//
// 2. THE CONTENT-TYPE SNIFFER MUST STAY HONEST. It leads the ladder in
//    `guessResourceContentType`, ahead of the URL tail, because a resource is
//    content-addressed: the type belongs to the bytes, not to how a reference
//    was spelled. That is only safe while the sniffer answers ONLY for
//    formats that identify themselves. The negative cases below are the
//    important half — CSS, JS, JSON and markdown are all "text" to a header
//    check, and a sniffer that guessed between them would outrank the tail
//    and destination that actually know.
//
// The worker is a plain script (no exports — it registers `self` handlers), so
// the functions are lifted out of the source by brace matching. A failure to
// lift is reported as a harness failure, never as a sniffer failure.

import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const at = (p: string): string => fileURLToPath(new URL(p, import.meta.url))

const WEB = at('./hypercomb-web/public/hypercomb.worker.js')
const DEV = at('./hypercomb-dev/public/hypercomb.worker.js')

const source = readFileSync(WEB, 'utf8')

/** Lift `async function <name>(…) { … }` out of the worker source. */
const lift = (name: string): string => {
  const start = source.indexOf(`async function ${name}(`)
  expect(start, `harness: ${name} not found in the worker source`).toBeGreaterThan(-1)
  let depth = 0
  let opened = false
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') { depth++; opened = true }
    else if (source[i] === '}') {
      depth--
      if (opened && depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`harness: could not find the end of ${name}`)
}

type Sniffers = {
  sniffBinaryContentType(file: Blob): Promise<string>
  sniffTextContentType(file: Blob): Promise<string>
}

const load = async (): Promise<Sniffers> => await import(
  'data:text/javascript,' + encodeURIComponent(
    `${lift('sniffBinaryContentType')}\n${lift('sniffTextContentType')}\n`
    + 'export { sniffBinaryContentType, sniffTextContentType }',
  )
) as Sniffers

/** Bytes + enough tail that a 32-byte header read is always satisfied. */
const bytes = (...head: number[]): Blob =>
  new Blob([new Uint8Array([...head, ...new Array(32).fill(0)])])

const ascii = (...parts: Array<string | number[]>): Blob =>
  new Blob([new Uint8Array(parts.flatMap(p =>
    typeof p === 'string' ? [...p].map(c => c.charCodeAt(0)) : p,
  ).concat(new Array(16).fill(0)))])

describe('service worker copies', () => {
  it('are byte-identical across the web and dev shells', () => {
    expect(readFileSync(DEV)).toEqual(readFileSync(WEB))
  })

  // `ignoreSearch` scans every cached entry on every lookup. With a thousand
  // modules held, a boot's four hundred module requests kept the worker busy
  // for about two seconds (atomic-modules-plan.md). The key drops the query
  // instead, and a lookup is exact.
  it('match the module cache exactly — never with ignoreSearch', () => {
    const workers = [WEB, DEV, at('./hypercomb-shim/public/hypercomb.worker.js'), at('./meadowverse/public/meadowverse.worker.js')]
    for (const worker of workers) {
      const code = readFileSync(worker, 'utf8').replace(/\/\/.*$/gm, '')
      expect(code, worker).not.toMatch(/ignoreSearch/)
      expect(code, worker).toMatch(/cache\.match\(cacheKeyOf\(request\)\)/)
    }
  })

  it('keeps a published head in the shim worker', () => {
    const shim = readFileSync(at('./hypercomb-shim/public/hypercomb.worker.js'), 'utf8')
    const web = readFileSync(WEB, 'utf8')
    expect(shim).toContain("const HEAD_CACHE = 'hc-instance-head'")
    expect(shim).toContain('n !== HEAD_CACHE')
    expect(shim).toContain("url.pathname === '/head'")
    expect(web).not.toContain('hc-instance-head')
    expect(readFileSync(DEV, 'utf8')).not.toContain('hc-instance-head')
  })
})

describe('sniffBinaryContentType', () => {
  it.each([
    ['png',   bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), 'image/png'],
    ['jpeg',  bytes(0xff, 0xd8, 0xff, 0xe0),                         'image/jpeg'],
    ['gif',   new Blob(['GIF89a'.padEnd(32, 'x')]),                  'image/gif'],
    ['webp',  ascii('RIFF', [0, 0, 0, 0], 'WEBP'),                   'image/webp'],
    ['wav',   ascii('RIFF', [0, 0, 0, 0], 'WAVE'),                   'audio/wav'],
    ['avif',  ascii([0, 0, 0, 0], 'ftypavif'),                       'image/avif'],
    ['m4a',   ascii([0, 0, 0, 0], 'ftypM4A '),                       'audio/mp4'],
    ['mp4',   ascii([0, 0, 0, 0], 'ftypisom'),                       'video/mp4'],
    ['webm',  bytes(0x1a, 0x45, 0xdf, 0xa3),                         'video/webm'],
    ['mp3',   new Blob(['ID3'.padEnd(32, 'x')]),                     'audio/mpeg'],
    ['woff2', new Blob(['wOF2'.padEnd(32, 'x')]),                    'font/woff2'],
    ['pdf',   new Blob(['%PDF-1.7'.padEnd(32, 'x')]),                'application/pdf'],
  ])('reads %s from its header', async (_name, blob, expected) => {
    expect(await (await load()).sniffBinaryContentType(blob)).toBe(expected)
  })

  // The half that keeps the sniffer ahead of the URL tail safely.
  it.each([
    ['css',      'body { color: red }'],
    ['js',       'export const a = 1'],
    ['json',     '{"a":1}'],
    ['markdown', '# heading\n\ntext'],
    ['html',     '<!doctype html><html></html>'],
  ])('declines to guess at %s', async (_name, text) => {
    expect(await (await load()).sniffBinaryContentType(new Blob([text]))).toBe('')
  })

  it('declines on bytes too short to carry a header', async () => {
    expect(await (await load()).sniffBinaryContentType(new Blob(['ab']))).toBe('')
  })
})

describe('sniffTextContentType', () => {
  it.each([
    ['svg',          '<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'image/svg+xml'],
    ['xml-wrapped svg', '<?xml version="1.0"?><svg></svg>',            'image/svg+xml'],
    ['html',         '<!DOCTYPE html><html></html>',                   'text/html; charset=utf-8'],
  ])('reads %s from its opening', async (_name, text, expected) => {
    expect(await (await load()).sniffTextContentType(new Blob([text]))).toBe(expected)
  })

  // Markdown may legitimately open with raw markup, which is exactly why this
  // step sits BELOW the URL tail in the ladder — and why it must not claim
  // anything the tail could have answered better.
  it.each([
    ['css',      'body { color: red }'],
    ['markdown', '# heading\n\ntext'],
  ])('declines to guess at %s', async (_name, text) => {
    expect(await (await load()).sniffTextContentType(new Blob([text]))).toBe('')
  })
})

// A FILE OPENED AS A PAGE IS SEALED (2026-11-16). /@resource/ serves any bytes a
// host this hive knows holds; opened as a document, a page or an SVG there ran
// as the hive itself — its storage, its signing key, its services. Opened as a
// document, a type that can run script now carries a sandbox with no
// same-origin — unless this hive authored it. A PDF or a picture is never
// sealed (a sealed PDF is a blank one), and what a page of the hive loads (a
// picture, a sheet, a script) is served as before. A TRIAL is sealed even when
// it was marked authored (2026-11-27): trials written before that day were.
describe('a resource opened as a page', () => {
  type Ask = (sig: string) => Promise<boolean>
  type Seal = (request: { mode?: string; destination?: string; url?: string }, response: Response, authored?: Ask, trial?: Ask) => Promise<Response>
  type Entry = [string, { kind: string; getFile(): Promise<{ text(): Promise<string> }> }]
  const sha256Hex = async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
  const TRIAL_POOL = createHash('sha256').update('trials:pages').digest('hex')
  /** A fake OPFS root holding the trial pool's documents, or a root that cannot be read. */
  const holding = (docs: Record<string, string> | 'unreadable' | null) => ({
    navigator: {
      storage: {
        getDirectory: async () => ({
          getDirectoryHandle: async (name: string) => {
            if (docs === 'unreadable') throw Object.assign(new Error('the disk is busy'), { name: 'InvalidStateError' })
            if (name !== TRIAL_POOL || !docs) throw Object.assign(new Error('not here'), { name: 'NotFoundError' })
            return {
              async *entries(): AsyncGenerator<Entry> {
                for (const [file, text] of Object.entries(docs)) yield [file, { kind: 'file', getFile: async () => ({ text: async () => text }) }]
              },
            }
          },
        }),
      },
    },
  })
  const sealing = (worker: string, self: unknown = holding(null)) => {
    const code = readFileSync(worker, 'utf8')
    const from = code.indexOf('const SEALED_DESTINATIONS')
    const to = code.indexOf('async function handleSiteResourceRequest(')
    expect(from, `harness: no seal in ${worker}`).toBeGreaterThan(-1)
    return new Function('self', 'sha256Hex', `const SITE_RESOURCE_PREFIX = '/@resource/'; ${code.slice(from, to)}; return { sealedIfDocument, trialHere, SEALED_DOCUMENT_POLICY }`)(self, sha256Hex) as {
      sealedIfDocument: Seal
      trialHere: Ask
      SEALED_DOCUMENT_POLICY: string
    }
  }
  const SIG = 'a'.repeat(64)
  const url = `https://hive.example/@resource/${SIG}/page.html`
  const page = (type = 'text/html; charset=utf-8') => new Response('<script>steal()</script>', { headers: { 'content-type': type } })
  const nobody = async () => false

  it('is sealed in every worker: a tab, a frame, an object — a page or an SVG', async () => {
    for (const worker of [WEB, DEV, at('./hypercomb-shim/public/hypercomb.worker.js')]) {
      const { sealedIfDocument, SEALED_DOCUMENT_POLICY } = sealing(worker)
      expect(SEALED_DOCUMENT_POLICY).toMatch(/^sandbox /)
      expect(SEALED_DOCUMENT_POLICY).not.toContain('allow-same-origin')
      expect(SEALED_DOCUMENT_POLICY).not.toContain('allow-top-navigation')
      expect(SEALED_DOCUMENT_POLICY).not.toContain('escape-sandbox')
      for (const request of [{ mode: 'navigate', destination: 'document' }, { mode: 'navigate', destination: 'iframe' }, { mode: 'no-cors', destination: 'object' }, { mode: 'no-cors', destination: 'embed' }]) {
        // Sealing is the default: every type not known to run nothing, a host's odd +xml and a sniffed one included.
        for (const type of ['text/html; charset=utf-8', 'image/svg+xml', 'application/xhtml+xml', 'application/x-page+xml', 'unknown/unknown', 'application/octet-stream', '']) {
          const out = await sealedIfDocument({ ...request, url }, page(type), nobody)
          expect(out.headers.get('content-security-policy'), `${JSON.stringify(request)} ${type}`).toBe(SEALED_DOCUMENT_POLICY)
          expect(out.headers.get('x-content-type-options')).toBe('nosniff')
          expect(out.headers.get('content-type') ?? '').toBe(type)
        }
      }
    }
  })

  it('a page this hive authored opens as it always did', async () => {
    const { sealedIfDocument } = sealing(WEB)
    const asked: string[] = []
    const response = page()
    expect(await sealedIfDocument({ mode: 'navigate', destination: 'document', url }, response, async sig => { asked.push(sig); return true }, async sig => { asked.push(`trial ${sig}`); return false })).toBe(response)
    expect(asked).toEqual([SIG, `trial ${SIG}`])
  })

  it('a trial is sealed in every worker even when it was marked authored', async () => {
    const authored = async () => true
    const ledger = JSON.stringify({ trials: { [SIG]: 'try-studio' }, own: [SIG] })
    for (const worker of [WEB, DEV, at('./hypercomb-shim/public/hypercomb.worker.js')]) {
      const asked = sealing(worker)
      const out = await asked.sealedIfDocument({ mode: 'navigate', destination: 'document', url }, page(), authored, async () => true)
      expect(out.headers.get('content-security-policy'), worker).toBe(asked.SEALED_DOCUMENT_POLICY)
      // Asked nothing but the request, the worker reads the trial ledger itself.
      const read = sealing(worker, holding({ ['1'.repeat(64)]: ledger }))
      const sealed = await read.sealedIfDocument({ mode: 'navigate', destination: 'iframe', url }, page(), authored)
      expect(sealed.headers.get('content-security-policy'), worker).toBe(read.SEALED_DOCUMENT_POLICY)
    }
  })

  it('reads the trial ledger in its current and its older shape, and seals when it cannot read it', async () => {
    const other = 'b'.repeat(64)
    const { trialHere } = sealing(WEB, holding({ ['1'.repeat(64)]: JSON.stringify({ trials: { [SIG]: 'try-studio' }, own: [] }) }))
    expect(await trialHere(SIG)).toBe(true)
    expect(await trialHere(SIG.toUpperCase())).toBe(true)
    expect(await trialHere(other)).toBe(false)
    // The bare `{ sig: label }` every ledger was before 2026-11-27.
    expect(await sealing(WEB, holding({ ['2'.repeat(64)]: JSON.stringify({ [SIG]: 'try-notes' }) })).trialHere(SIG)).toBe(true)
    // Caught mid-write, two documents: a sig either lists is a trial.
    const two = holding({ ['3'.repeat(64)]: JSON.stringify({ trials: {} }), ['4'.repeat(64)]: JSON.stringify({ trials: { [SIG]: 'try-studio' } }) })
    expect(await sealing(WEB, two).trialHere(SIG)).toBe(true)
    // A marker, a file that is not a ledger, a document that is not JSON: passed over.
    const noise = holding({ '00000000': SIG, ['5'.repeat(64)]: 'not json', ['6'.repeat(64)]: JSON.stringify({ trials: { [other]: 'try-x' } }) })
    expect(await sealing(WEB, noise).trialHere(SIG)).toBe(false)
    // No pool: no trials. A pool that cannot be read: sealed.
    expect(await sealing(WEB, holding(null)).trialHere(SIG)).toBe(false)
    expect(await sealing(WEB, holding('unreadable')).trialHere(SIG)).toBe(true)
  })

  it('a page that is not authored is sealed without asking for the trial ledger', async () => {
    const { sealedIfDocument, SEALED_DOCUMENT_POLICY } = sealing(WEB)
    let asked = 0
    const out = await sealedIfDocument({ mode: 'navigate', destination: 'document', url }, page(), nobody, async () => { asked++; return false })
    expect(out.headers.get('content-security-policy')).toBe(SEALED_DOCUMENT_POLICY)
    expect(asked).toBe(0)
  })

  it('a PDF, a picture or a video opened as a page is never sealed: nothing in it runs', async () => {
    const { sealedIfDocument } = sealing(WEB)
    for (const type of ['application/pdf', 'image/png', 'video/mp4', 'audio/mpeg', 'text/plain; charset=utf-8', 'text/css', 'application/json']) {
      const response = page(type)
      expect(await sealedIfDocument({ mode: 'navigate', destination: 'document', url }, response, nobody), type).toBe(response)
    }
  })

  it('a picture, a sheet or a script a page of the hive loads is served as it was', async () => {
    const { sealedIfDocument } = sealing(WEB)
    for (const destination of ['image', 'style', 'script', 'font', '']) {
      const response = page()
      expect(await sealedIfDocument({ mode: 'no-cors', destination, url }, response, nobody)).toBe(response)
    }
  })

  it('every answer of the resource door passes through the seal', () => {
    for (const worker of [WEB, at('./hypercomb-shim/public/hypercomb.worker.js')]) {
      expect(readFileSync(worker, 'utf8').replace(/\r\n/g, '\n')).toContain('async function handleSiteResourceRequest(request) {\n  return sealedIfDocument(request, await serveSiteResource(request))\n}')
    }
  })
})
