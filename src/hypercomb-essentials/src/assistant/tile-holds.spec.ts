// tile-holds.spec.ts — what a tile holds, for the eye: the resources its
// records name, what some bytes are shown as, and the chat's code target.

import { describe, expect, it } from 'vitest'
import { pictureMime, platformSources, readable, recordResources, shownAs, signaturesIn, sizeWords } from './tile-holds.js'
import { chatCodeTarget } from './chat-code.js'

const sig = (n: number): string => n.toString(16).padStart(64, '0')
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

describe('the resources a record names', () => {
  it('lists each …Sig field by its own name, then what refs add', () => {
    expect(recordResources({
      kind: 'card:data', payload: { dataSig: sig(1), themeSig: sig(2), artSig: sig(3), label: 'mine' }, refs: [sig(1), sig(4)],
    })).toEqual({ kind: 'card:data', named: [
      { label: 'dataSig', sig: sig(1) }, { label: 'themeSig', sig: sig(2) }, { label: 'artSig', sig: sig(3) }, { label: 'ref', sig: sig(4) },
    ] })
    expect(recordResources({ kind: 'visual:website:page', payload: { htmlSig: sig(5) } }))
      .toEqual({ kind: 'visual:website:page', named: [{ label: 'htmlSig', sig: sig(5) }] })
    expect(recordResources({ kind: 'visual:lightbox:gallery', payload: { imageSigs: [sig(6), sig(7), 'not a signature'] } })?.named)
      .toEqual([{ label: 'imageSigs', sig: sig(6) }, { label: 'imageSigs', sig: sig(7) }])
  })

  it('leaves out a record that names an identity, a file the Files list shows, and anything that is not a record', () => {
    expect(recordResources({ kind: 'group', payload: { sig: sig(1) } })).toBeNull()
    expect(recordResources({ kind: 'creation', payload: { id: sig(1) } })).toBeNull()
    expect(recordResources({ kind: 'files:attachment', payload: { name: 'main.js', sig: sig(1) } })).toBeNull()
    expect(recordResources({ payload: { dataSig: sig(1) } })).toBeNull()
    expect(recordResources('text')).toBeNull()
    expect(recordResources(null)).toBeNull()
  })

  it('names a marker that points at nothing as a record with no resources', () => {
    expect(recordResources({ kind: 'trait:want', payload: { word: 'animation', own: true } })).toEqual({ kind: 'trait:want', named: [] })
  })
})

describe('what some bytes are shown as', () => {
  it('knows a picture by its first bytes, never by a name', () => {
    expect(pictureMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe('image/png')
    expect(pictureMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(pictureMime(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe('image/webp')
    expect(pictureMime(bytes('<svg></svg>'))).toBeNull()
    expect(shownAs(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toEqual({ as: 'picture', mime: 'image/png' })
  })

  it('shows whole UTF-8 as text, and anything else as bytes', () => {
    expect(shownAs(bytes('const a = 1\n'))).toEqual({ as: 'text', text: 'const a = 1\n' })
    expect(shownAs(bytes('café ☕'))).toEqual({ as: 'text', text: 'café ☕' })
    expect(shownAs(new Uint8Array([0x61, 0x00, 0x62]))).toEqual({ as: 'bytes' })
    expect(shownAs(new Uint8Array([0xc3, 0x28]))).toEqual({ as: 'bytes' })
  })

  it('indents JSON written on one line, and leaves other text as it is', () => {
    expect(readable('{"n":"Jaime","l":[1,2]}')).toBe('{\n  "n": "Jaime",\n  "l": [\n    1,\n    2\n  ]\n}')
    expect(readable('const a = { b: 1 }')).toBe('const a = { b: 1 }')
    expect(readable('{ not json')).toBe('{ not json')
    expect(readable('{"a":1}', 3)).toBe('{"a":1}')
  })

  it('finds the signatures a text names, each once', () => {
    // Hashes as hashes look: most of the sixteen digits in each.
    const [a, b, c] = ['0123456789abcdef', 'fedcba9876543210', '89abcdef01234567'].map(part => part.repeat(4))
    const text = `{"htmlSig":"${a}","refs":["${b}","${a}"]} resource:${c.toUpperCase()}/main.js`
    expect(signaturesIn(text)).toEqual([a, b, c])
    expect(signaturesIn(text, 2)).toEqual([a, b])
    expect(signaturesIn('nothing here')).toEqual([])
  })

  it('leaves out a run of hex digits that is plainly not a hash', () => {
    // A page that carries a library inline holds constants like these.
    const text = `mask=0x${'f'.repeat(64)};zero="${'0'.repeat(64)}";pattern="${'ab'.repeat(32)}";real="${'0123456789abcdef'.repeat(4)}"`
    expect(signaturesIn(text)).toEqual(['0123456789abcdef'.repeat(4)])
  })

  it('knows the platform\u2019s own sources from modules that merely have the word in their name', () => {
    const entries = [
      { name: '@hypercomb/essentials/commands/view-source-scope', sig: sig(1) },
      { name: '@hypercomb/essentials/presentation/tiles/tile-source-registry', sig: sig(2) },
      { name: '@hypercomb/source/core', sig: sig(3) },
      { name: '@hypercomb/source/shim', sig: sig(4) },
    ]
    expect(platformSources(entries).map(entry => entry.name)).toEqual(['@hypercomb/source/core', '@hypercomb/source/shim'])
  })

  it('says a size the way a person reads it', () => {
    expect([sizeWords(512), sizeWords(19_029), sizeWords(1_307_981), sizeWords(-1)]).toEqual(['512 B', '19 KB', '1.2 MB', ''])
  })
})

describe('the tile the chat’s code view opens on', () => {
  it('is the tile the conversation is about', () => {
    expect(chatCodeTarget(['business-card', 'main'], ['business-card'], ['elsewhere'])).toEqual(['business-card', 'main'])
  })

  it('is the managed site for a conversation about no tile, else the page in hand', () => {
    expect(chatCodeTarget([], ['business-card'], ['elsewhere'])).toEqual(['business-card'])
    expect(chatCodeTarget(undefined, null, ['projects', 'roadmap'])).toEqual(['projects', 'roadmap'])
    expect(chatCodeTarget(null, null, null)).toEqual([])
  })

  it('drops empty segments', () => {
    expect(chatCodeTarget(['', ' business-card ', ''], null, null)).toEqual(['business-card'])
  })
})
