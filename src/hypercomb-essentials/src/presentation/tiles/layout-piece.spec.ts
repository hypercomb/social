import { createHash } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  HOLE_RELATION, TEMPLATE_RELATION,
  layoutPieceRecord, mintTree, parseLayoutPiece, resolveTree,
} from './layout-piece.js'
import { fetchThroughContentHop } from './artifact-content.js'
import {
  builtinLayout, layoutTemplateRecord, nodeOf, parseLayoutTemplate, withNodeAt,
} from './layout-template.js'

/** jsdom's Blob has no `.text()`, and both the store and the content hop need
 *  it. Same stand-in the tile-properties specs use. */
class TextBlob {
  readonly type: string
  readonly size: number
  readonly #text: string

  constructor(parts: readonly unknown[] = [], options: { type?: string } = {}) {
    this.#text = parts.map(part => String(part ?? '')).join('')
    this.size = this.#text.length
    this.type = options.type ?? ''
  }

  async text(): Promise<string> { return this.#text }
}

beforeAll(() => { vi.stubGlobal('Blob', TextBlob) })

/** A content store, exactly as content-addressed as the real one — which is
 *  what makes the dedup assertions below mean anything. */
function makeStore() {
  const bytes = new Map<string, string>()
  const put = async (blob: Blob): Promise<string> => {
    const text = await blob.text()
    const sig = createHash('sha256').update(text).digest('hex')
    bytes.set(sig, text)
    return sig
  }
  const get = async (sig: string): Promise<Blob | null> => {
    const text = bytes.get(sig)
    return text === undefined ? null : new Blob([text], { type: 'application/json' })
  }
  const templateSigOf = async (template: Parameters<typeof layoutTemplateRecord>[0]) =>
    put(new Blob([JSON.stringify(layoutTemplateRecord(template))], { type: 'application/json' }))
  const loadTemplate = async (ref: string) => {
    const blob = await fetchThroughContentHop(ref, get)
    return blob ? parseLayoutTemplate(JSON.parse(await blob.text())) : null
  }
  const read = async (sig: string): Promise<Record<string, unknown> | null> => {
    const text = bytes.get(sig)
    return text === undefined ? null : JSON.parse(text)
  }
  return { bytes, put, get, templateSigOf, loadTemplate, read }
}

const bookends = builtinLayout('bookends')!
const thirds = builtinLayout('thirds')!
const split = builtinLayout('split')!

describe('every reference is a typed hop', () => {
  it('a piece holds the ENVELOPE signature, never the template bytes', async () => {
    const store = makeStore()
    const minted = (await mintTree(nodeOf(bookends, bookends.vars), store.templateSigOf, store.put))!
    const piece = await store.read(minted.sig)

    const envelope = await store.read(String(piece!['template']))
    expect(envelope).toEqual({ meta: 1, resource: expect.any(String), relation: TEMPLATE_RELATION })

    // The field is NOT the template's own signature — that would be an
    // untyped hop, and the Life Primitive has none.
    const templateBytes = String((envelope as Record<string, unknown>)['resource'])
    expect(piece!['template']).not.toBe(templateBytes)
    expect(JSON.parse(store.bytes.get(templateBytes)!)['kind']).toBe('layout-template')
  })

  it('a hole holds an envelope too, with the relation naming the ROLE', async () => {
    const store = makeStore()
    const tree = withNodeAt(nodeOf(bookends, bookends.vars), ['head'], nodeOf(thirds, {}))
    const minted = (await mintTree(tree, store.templateSigOf, store.put))!
    const piece = await store.read(minted.sig)

    const envelope = await store.read(String((piece!['holes'] as Record<string, string>)['head']))
    expect(envelope).toEqual({ meta: 1, resource: expect.any(String), relation: HOLE_RELATION })
  })

  it('the relation is the role, not the hole key — so the same shape dedups', async () => {
    // Keying the relation by hole would mint a different envelope for the same
    // nested arrangement in a different slot, destroying the dedup that is the
    // whole reason a hole holds a signature.
    const store = makeStore()
    const root = nodeOf(bookends, bookends.vars)
    const inHead = (await mintTree(withNodeAt(root, ['head'], nodeOf(thirds, {})), store.templateSigOf, store.put))!
    const inTail = (await mintTree(withNodeAt(root, ['tail'], nodeOf(thirds, {})), store.templateSigOf, store.put))!

    const head = (await store.read(inHead.sig))!['holes'] as Record<string, string>
    const tail = (await store.read(inTail.sig))!['holes'] as Record<string, string>
    expect(head['head']).toBe(tail['tail'])
  })

  it('resolves back through the hop to the arrangement it was minted from', async () => {
    const store = makeStore()
    const tree = withNodeAt(
      withNodeAt(nodeOf(bookends, bookends.vars), ['head'], nodeOf(thirds, {})),
      ['head', 'one'], nodeOf(split, {}))
    const minted = (await mintTree(tree, store.templateSigOf, store.put))!

    const back = (await resolveTree(minted.sig, store.loadTemplate, store.get))!
    expect(back.template.name).toBe('bookends')
    expect(back.nested['head'].template.name).toBe('thirds')
    expect(back.nested['head'].nested['one'].template.name).toBe('split')
  })
})

describe('the arrangement travels', () => {
  it('names every record it reaches, so an adopter gets the whole design', async () => {
    const store = makeStore()
    const tree = withNodeAt(nodeOf(bookends, bookends.vars), ['head'], nodeOf(thirds, {}))
    const minted = (await mintTree(tree, store.templateSigOf, store.put))!

    // Everything that was written, minus nothing. A signature the closure
    // omits is a record that never leaves this hive.
    const closure = new Set([...minted.closure, minted.sig])
    for (const sig of store.bytes.keys()) expect(closure.has(sig)).toBe(true)
  })

  it('declares its own closure on every level, not only at the root', async () => {
    const store = makeStore()
    const tree = withNodeAt(nodeOf(bookends, bookends.vars), ['head'], nodeOf(thirds, {}))
    const minted = (await mintTree(tree, store.templateSigOf, store.put))!

    const root = (await store.read(minted.sig))!
    const holeRef = (root['holes'] as Record<string, string>)['head']
    const holeEnvelope = (await store.read(holeRef))!
    const child = (await store.read(String(holeEnvelope['resource'])))!

    expect((root['refs'] as string[]).length).toBeGreaterThan(0)
    expect((child['refs'] as string[]).length).toBeGreaterThan(0)
    // The root's closure covers the child's as well — the push walk does not
    // recurse into what it enqueues, so depth cannot be left to it.
    for (const sig of child['refs'] as string[]) {
      expect(root['refs'] as string[]).toContain(sig)
    }
  })
})

describe('a piece is content-addressed', () => {
  it('mints the same signature for the same arrangement', async () => {
    const store = makeStore()
    const tree = () => withNodeAt(nodeOf(bookends, bookends.vars), ['head'], nodeOf(thirds, {}))
    const first = (await mintTree(tree(), store.templateSigOf, store.put))!
    const second = (await mintTree(tree(), store.templateSigOf, store.put))!
    expect(second.sig).toBe(first.sig)
  })

  it('re-mints only the chain above an edit', async () => {
    const store = makeStore()
    const before = withNodeAt(nodeOf(bookends, bookends.vars), ['head'], nodeOf(thirds, {}))
    const after = withNodeAt(before, ['tail'], nodeOf(split, {}))
    const a = (await mintTree(before, store.templateSigOf, store.put))!
    const b = (await mintTree(after, store.templateSigOf, store.put))!

    expect(b.sig).not.toBe(a.sig)
    // The untouched branch keeps the signature it had.
    const holesA = (await store.read(a.sig))!['holes'] as Record<string, string>
    const holesB = (await store.read(b.sig))!['holes'] as Record<string, string>
    expect(holesB['head']).toBe(holesA['head'])
  })

  it('canonicalises, so key order cannot mint a second signature', () => {
    const one = layoutPieceRecord({
      template: 'a'.repeat(64),
      vars: { padding: '1rem', space: '0rem' },
      holes: { right: 'c'.repeat(64), left: 'b'.repeat(64) },
    })
    const two = layoutPieceRecord({
      template: 'a'.repeat(64),
      vars: { space: '0rem', padding: '1rem' },
      holes: { left: 'b'.repeat(64), right: 'c'.repeat(64) },
    })
    expect(JSON.stringify(one)).toBe(JSON.stringify(two))
  })
})

describe('a damaged arrangement degrades, never fails', () => {
  it('drops a hole whose piece cannot be read rather than losing the page', async () => {
    const store = makeStore()
    const tree = withNodeAt(nodeOf(bookends, bookends.vars), ['head'], nodeOf(thirds, {}))
    const minted = (await mintTree(tree, store.templateSigOf, store.put))!

    // Lose exactly the nested piece.
    const root = (await store.read(minted.sig))!
    const holeEnvelope = (await store.read((root['holes'] as Record<string, string>)['head']))!
    store.bytes.delete(String(holeEnvelope['resource']))

    const back = (await resolveTree(minted.sig, store.loadTemplate, store.get))!
    expect(back.template.name).toBe('bookends')
    expect(back.nested['head']).toBeUndefined()
  })

  it('is null for a record that is not a piece', () => {
    expect(parseLayoutPiece(null)).toBeNull()
    expect(parseLayoutPiece({ kind: 'layout-template', name: 'bookends' })).toBeNull()
    // A piece whose template reference is not a signature is not a piece.
    expect(parseLayoutPiece({ kind: 'layout-piece', version: 1, template: 'nope' })).toBeNull()
  })
})
