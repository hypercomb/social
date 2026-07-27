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
