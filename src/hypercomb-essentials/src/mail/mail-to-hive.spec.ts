import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EffectBus, SignatureService } from '@hypercomb/core'
import type { ParsedMail } from './mime.js'
import {
  MAIL_MESSAGE_KIND, NOTE_TEXT_LIMIT,
  liveMailToHiveDeps, nameCandidates, noteTextFor, saveMessageToHive, tileNameFor,
  type MailMessageMark, type MailToHiveDeps,
} from './mail-to-hive.js'
import type { AttachmentPayload } from '../files/files-attachment.js'

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)
const sha = (bytes: Uint8Array): Promise<string> => SignatureService.sign(bytes.slice().buffer)
const key = (segments: readonly string[]): string => segments.join('/')

const mailOf = (over: Partial<ParsedMail> = {}): ParsedMail => ({
  from: 'Leanne <leanne@hypercomb.com>',
  to: 'jaime@hypercomb.com',
  cc: '',
  replyTo: '',
  subject: 'Quarterly invoice',
  date: 'Thu, 05 Nov 2026 10:00:00 +0000',
  messageId: '<m1@hypercomb.com>',
  inReplyTo: '',
  references: '',
  text: 'Hello Jaime,\n\nthe invoice is attached.',
  html: '',
  attachments: [],
  inlineImages: {},
  ...over,
})

/** A message as the window holds it: its bytes, its signature, its attachments. */
const message = async (raw: string, over: Partial<ParsedMail> = {}, files: Uint8Array[] = []) => {
  const bytes = utf8(raw)
  return {
    mail: mailOf({
      attachments: files.map((file, i) => ({ filename: `file-${i + 1}.pdf`, type: 'application/pdf', size: file.byteLength })),
      ...over,
    }),
    raw: bytes,
    sig: await sha(bytes),
    attachmentBytes: (index: number) => files[index] ?? null,
  }
}

/** A hive as the save's acts see it: pages of tiles, a content store, and what
 *  each tile carries. Every act is logged, in order. */
const hive = (start: readonly string[] = ['inbox']) => {
  const pages = new Map<string, Set<string>>()
  const store = new Map<string, Uint8Array>()
  const notes = new Map<string, string[]>()
  const files = new Map<string, AttachmentPayload[]>()
  const marks = new Map<string, MailMessageMark[]>()
  const log: string[] = []
  const state = { here: [...start] as readonly string[], createMakesNothing: false, noteFails: false }
  const tile = (page: readonly string[], name: string): void => {
    const set = pages.get(key(page)) ?? new Set<string>()
    set.add(name)
    pages.set(key(page), set)
  }
  const deps: MailToHiveDeps = {
    here: () => state.here,
    tilesOn: async page => [...(pages.get(key(page)) ?? [])],
    marksOn: async segments => marks.get(key(segments)) ?? [],
    refusedName: name => name === 'bees',
    create: async name => {
      log.push(`create ${name}`)
      if (!state.createMakesNothing) tile(state.here, name)
    },
    holds: async sig => store.has(sig),
    put: async bytes => {
      const sig = await sha(bytes)
      log.push(`put ${sig.slice(0, 8)}`)
      if (!store.has(sig)) store.set(sig, bytes.slice())
      return sig
    },
    contentRef: async sig => {
      const envelope = utf8(JSON.stringify({ meta: 1, resource: sig, relation: 'mail:message' }))
      const ref = await sha(envelope)
      store.set(ref, envelope)
      return ref
    },
    addNote: async (parent, name, text) => {
      log.push('note')
      if (state.noteFails) throw new Error('the notes slot refused')
      const at = key([...parent, name])
      notes.set(at, [...(notes.get(at) ?? []), text])
    },
    attach: async (segments, file) => {
      log.push(`attach ${file.name}`)
      files.set(key(segments), [...(files.get(key(segments)) ?? []), file])
    },
    wear: async (segments, mark) => {
      log.push('wear')
      marks.set(key(segments), [...(marks.get(key(segments)) ?? []), mark])
    },
    cellSig: async () => 'c'.repeat(64),
  }
  return { deps, pages, store, notes, files, marks, log, state, tile }
}

describe('saveMessageToHive — one message, one tile', () => {
  it('makes ONE tile named by the subject, its text as the note, its bytes put by signature, the mark worn last', async () => {
    const h = hive()
    const pdf = utf8('%PDF-1.4 invoice')
    const input = await message('From: leanne\r\n\r\ninvoice', {}, [pdf])
    const pdfSig = await sha(pdf)

    const result = await saveMessageToHive(input, h.deps)

    expect(result.status).toBe('saved')
    expect(result.cell).toBe('quarterly-invoice')
    expect(result.page).toEqual(['inbox'])
    expect(result.cellSig).toBe('c'.repeat(64))
    expect([...h.pages.get('inbox')!]).toEqual(['quarterly-invoice'])
    expect(h.notes.get('inbox/quarterly-invoice')).toEqual(['Hello Jaime,\n\nthe invoice is attached.'])
    expect(h.store.get(input.sig)).toEqual(input.raw)
    expect(h.store.get(pdfSig)).toEqual(pdf)
    expect(h.files.get('inbox/quarterly-invoice')).toEqual([
      { name: 'file-1.pdf', mime: 'application/pdf', size: pdf.byteLength, sig: pdfSig },
    ])
    const [mark] = h.marks.get('inbox/quarterly-invoice')!
    expect(mark).toMatchObject({
      sig: input.sig,
      from: 'Leanne <leanne@hypercomb.com>',
      subject: 'Quarterly invoice',
      date: 'Thu, 05 Nov 2026 10:00:00 +0000',
      messageId: '<m1@hypercomb.com>',
    })
    // The content hop names the raw message, nothing else.
    expect(JSON.parse(new TextDecoder().decode(h.store.get(mark.content)!))).toEqual({
      meta: 1, resource: input.sig, relation: 'mail:message',
    })
    expect(result.placed).toEqual([input.sig, pdfSig])
    expect(result.shared).toEqual([])
    expect(result.skipped).toEqual([])
    expect(result.message).toContain('quarterly-invoice')
    // The tile first, the bytes before anything points at them, the mark last.
    expect(h.log[0]).toBe('create quarterly-invoice')
    expect(h.log.slice(1, 3)).toEqual([`put ${input.sig.slice(0, 8)}`, `put ${pdfSig.slice(0, 8)}`])
    expect(h.log.slice(3)).toEqual(['note', 'attach file-1.pdf', 'wear'])
  })

  it('refuses a signature that is not the bytes’ own, and touches nothing', async () => {
    const h = hive()
    const input = await message('the real bytes')
    for (const sig of [await sha(utf8('other bytes')), 'not-a-signature', '']) {
      const result = await saveMessageToHive({ ...input, sig }, h.deps)
      expect(result.status).toBe('refused')
      expect(result.message).toMatch(/does not match its signature/)
    }
    expect(h.log).toEqual([])
    expect(h.store.size).toBe(0)
  })

  it('accepts the signature in either case', async () => {
    const h = hive()
    const input = await message('mixed case')
    expect((await saveMessageToHive({ ...input, sig: input.sig.toUpperCase() }, h.deps)).status).toBe('saved')
    expect(h.store.has(input.sig)).toBe(true)
  })

  it('saving the same message twice places nothing new, and says so', async () => {
    const h = hive()
    const input = await message('once', {}, [utf8('attachment')])
    await saveMessageToHive(input, h.deps)
    const acts = h.log.length
    const stored = h.store.size

    const again = await saveMessageToHive(input, h.deps)

    expect(again.status).toBe('already-saved')
    expect(again.cell).toBe('quarterly-invoice')
    expect(again.placed).toEqual([])
    expect(again.message).toMatch(/Already in the hive here as “quarterly-invoice”/)
    expect(h.log.length).toBe(acts)
    expect(h.store.size).toBe(stored)
    expect(h.marks.get('inbox/quarterly-invoice')).toHaveLength(1)
  })

  it('finds a saved message under its numbered name too', async () => {
    const h = hive()
    h.tile(['inbox'], 'quarterly-invoice')
    const input = await message('numbered')
    expect((await saveMessageToHive(input, h.deps)).cell).toBe('quarterly-invoice-2')
    const again = await saveMessageToHive(input, h.deps)
    expect(again.status).toBe('already-saved')
    expect(again.cell).toBe('quarterly-invoice-2')
  })

  it('never writes into a tile of the same name that is not this message', async () => {
    const h = hive()
    h.tile(['inbox'], 'quarterly-invoice')
    h.notes.set('inbox/quarterly-invoice', ['the participant’s own note'])
    const result = await saveMessageToHive(await message('a second invoice'), h.deps)
    expect(result.cell).toBe('quarterly-invoice-2')
    expect(h.notes.get('inbox/quarterly-invoice')).toEqual(['the participant’s own note'])
    expect(h.marks.get('inbox/quarterly-invoice')).toBeUndefined()
  })

  it('shares bytes the hive already holds: one copy, many tiles', async () => {
    const h = hive()
    const logo = utf8('the same logo')
    const logoSig = await sha(logo)
    const first = await message('first message', { subject: 'Hello' }, [logo])
    const second = await message('second message', { subject: 'Hello again' }, [logo])

    await saveMessageToHive(first, h.deps)
    const result = await saveMessageToHive(second, h.deps)

    expect(result.status).toBe('saved')
    expect(result.placed).toEqual([second.sig, logoSig])
    expect(result.shared).toEqual([logoSig])
    expect(result.message).toMatch(/shared, not copied/)
    expect([...h.store.keys()].filter(sig => sig === logoSig)).toHaveLength(1)

    // The same message on another page is another tile of the same atoms (A7).
    h.state.here = ['archive']
    const elsewhere = await saveMessageToHive(first, h.deps)
    expect(elsewhere.status).toBe('saved')
    expect(elsewhere.page).toEqual(['archive'])
    expect(elsewhere.shared).toEqual([first.sig, logoSig])
    expect(h.files.get('archive/hello')).toEqual(h.files.get('inbox/hello'))
  })

  it('leaves out, by name, attachments whose bytes cannot be read', async () => {
    const h = hive()
    const input = await message('two files', {
      attachments: [
        { filename: 'a.pdf', type: 'application/pdf', size: 3 },
        { filename: 'b.pdf', type: 'application/pdf', size: 3 },
        { filename: '', type: '', size: 0 },
      ],
    })
    const result = await saveMessageToHive({ ...input, attachmentBytes: i => (i === 0 ? utf8('aaa') : i === 2 ? new Uint8Array() : null) }, h.deps)
    expect(result.status).toBe('saved')
    expect(result.skipped).toEqual(['b.pdf', 'attachment-3'])
    expect(result.message).toMatch(/b\.pdf, attachment-3/)
    expect(h.files.get('inbox/quarterly-invoice')!.map(file => file.name)).toEqual(['a.pdf'])
  })

  it('writes no note for a message with no text', async () => {
    const h = hive()
    const result = await saveMessageToHive(await message('no text', { text: '   ' }), h.deps)
    expect(result.status).toBe('saved')
    expect(h.notes.size).toBe(0)
    expect(h.marks.get('inbox/quarterly-invoice')).toHaveLength(1)
  })

  it('refuses when the participant moved before the tile was made', async () => {
    const h = hive()
    let asked = 0
    const deps: MailToHiveDeps = { ...h.deps, here: () => (asked++ === 0 ? ['inbox'] : ['elsewhere']) }
    const result = await saveMessageToHive(await message('moved'), deps)
    expect(result.status).toBe('refused')
    expect(result.message).toMatch(/moved to another page/)
    expect(h.log).toEqual([])
  })

  it('refuses on a page that has not finished loading', async () => {
    const h = hive()
    const result = await saveMessageToHive(await message('cold'), { ...h.deps, tilesOn: async () => null })
    expect(result.status).toBe('refused')
    expect(h.log).toEqual([])
  })

  it('a create that made nothing is a failure, and nothing else is written', async () => {
    const h = hive()
    h.state.createMakesNothing = true
    const result = await saveMessageToHive(await message('nothing made'), h.deps)
    expect(result.status).toBe('failed')
    expect(h.log).toEqual(['create quarterly-invoice'])
    expect(h.store.size).toBe(0)
  })

  it('a write that fails after the tile is made says so, and the tile wears no mark', async () => {
    const h = hive()
    h.state.noteFails = true
    const input = await message('half saved')
    const result = await saveMessageToHive(input, h.deps)
    expect(result.status).toBe('failed')
    expect(result.cell).toBe('quarterly-invoice')
    expect(result.placed).toEqual([input.sig])
    expect(result.message).toMatch(/the notes slot refused/)
    expect(h.marks.size).toBe(0)
  })

  it('says why when the create is refused while viewing the past', async () => {
    const h = hive()
    const rewound = Object.assign(new Error('rewound'), { name: 'RewoundCommitError' })
    const result = await saveMessageToHive(await message('past'), { ...h.deps, create: async () => { throw rewound } })
    expect(result.status).toBe('failed')
    expect(result.message).toMatch(/viewing the past/)
  })

  it('is refused, not thrown, when the hive is not ready', async () => {
    const result = await saveMessageToHive(await message('no hive'), null)
    expect(result.status).toBe('refused')
    expect(result.message).toMatch(/not ready/)
  })
})

describe('the parts', () => {
  it('names a tile by its subject, folded; a slash is a word break, never a nest', () => {
    expect(tileNameFor({ subject: 'Re: Your invoice #123 — paid!', from: '' })).toBe('re-your-invoice-123-paid')
    expect(tileNameFor({ subject: 'plans/2027', from: '' })).toBe('plans-2027')
    expect(tileNameFor({ subject: '請求書', from: '' })).toBe('請求書')
  })

  it('names a tile with no subject for its sender', () => {
    expect(tileNameFor({ subject: '', from: '"Leanne R." <leanne@hypercomb.com>' })).toBe('mail-from-leanne-r')
    expect(tileNameFor({ subject: '!!!', from: 'jaime@hypercomb.com' })).toBe('mail-from-jaime-hypercomb-com')
    expect(tileNameFor({ subject: '', from: '' })).toBe('mail-from')
  })

  it('never offers a refused word, and numbers the rest', () => {
    const refused = (name: string): boolean => name === 'bees'
    expect(nameCandidates('bees', refused).slice(0, 3)).toEqual(['mail-bees', 'mail-bees-2', 'mail-bees-3'])
    expect(nameCandidates('hello')).toHaveLength(9)
    expect(nameCandidates('x'.repeat(64))[1]).toBe(`${'x'.repeat(60)}-2`)
  })

  it('cuts a very long text in the note and says so', () => {
    const long = noteTextFor({ text: 'a'.repeat(NOTE_TEXT_LIMIT + 10) })
    expect(long.cut).toBe(true)
    expect(long.text.length).toBe(NOTE_TEXT_LIMIT + 2)
    expect(noteTextFor({ text: '  short  ' })).toEqual({ text: 'short', cut: false })
  })
})

// ── the live acts, through the hive's services (all mocked: jsdom, no OPFS) ──

type Layer = { name?: string; children?: string[]; decorations?: string[] }

/** jsdom's Blob has no `arrayBuffer()` or `text()`; a FileReader reads it, as
 *  lightbox-forget.spec.ts does. */
const bytesOf = (blob: Blob): Promise<Uint8Array> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(reader.error)
  reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
  reader.readAsArrayBuffer(blob)
})
/** A held resource as the store hands it back: a Blob its readers can read here. */
const heldBlob = (b: Uint8Array): Blob => Object.assign(new Blob([b.slice()]), {
  text: async () => new TextDecoder().decode(b),
  arrayBuffer: async () => b.slice().buffer,
})

const liveHive = async (page: readonly string[] = ['inbox']) => {
  const bytes = new Map<string, Uint8Array>()
  const layers = new Map<string, Layer>()          // route → current layer
  const bySig = new Map<string, Layer>()           // child layer sig → layer
  const notesCalls: { parent: readonly string[]; cell: string; text: string }[] = []
  const appends: { segments: readonly string[]; slot: string; sig: string }[] = []
  const layerSig = async (layer: Layer): Promise<string> => sha(utf8(JSON.stringify(layer)))
  const store = {
    putResource: async (blob: Blob) => {
      const b = await bytesOf(blob)
      const sig = await sha(b)
      if (!bytes.has(sig)) bytes.set(sig, b)
      return sig
    },
    getResource: async (sig: string) => (bytes.has(sig) ? heldBlob(bytes.get(sig)!) : null),
    getResourceLocal: async (sig: string) => (bytes.has(sig) ? heldBlob(bytes.get(sig)!) : null),
  }
  const history = {
    sign: async (lineage: { explorerSegments: () => readonly string[] }) => `loc:${key(lineage.explorerSegments())}`,
    currentLayerAt: async (loc: string) => layers.get(loc.slice(4)) ?? null,
    getLayerBySig: async (sig: string) => bySig.get(sig) ?? null,
    commitLayer: async () => '',
    currentLayerRefAt: async (loc: string) => {
      const layer = layers.get(loc.slice(4))
      return layer ? { locationSig: loc, layerSig: await layerSig(layer), layer } : null
    },
  }
  const committer = {
    commitSlotAppend: async (segments: readonly string[], slot: string, sig: string) => {
      appends.push({ segments: [...segments], slot, sig })
      const layer = layers.get(key(segments)) ?? { name: segments[segments.length - 1] }
      const list = (layer as Record<string, unknown>)[slot] as string[] | undefined
      layers.set(key(segments), { ...layer, [slot]: [...(list ?? []).filter(s => s !== sig), sig] })
    },
    commitSlotRemove: async () => { /* not used */ },
  }
  const notes = {
    addAtSegments: async (parent: readonly string[], cell: string, text: string) => { notesCalls.push({ parent: [...parent], cell, text }) },
  }
  const lineage = { explorerSegments: () => [...page] }
  const services: Record<string, unknown> = {
    '@hypercomb.social/Store': store,
    '@diamondcoreprocessor.com/HistoryService': history,
    '@diamondcoreprocessor.com/LayerCommitter': committer,
    '@diamondcoreprocessor.com/NotesService': notes,
    '@hypercomb.social/Lineage': lineage,
  }
  ;(window as unknown as { ioc: unknown }).ioc = {
    get: (k: string) => services[k],
    register: () => { /* noop */ },
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
  }
  // The shell's create path: the tile joins the page it is made on.
  const created: string[] = []
  const off = EffectBus.on<{ name?: string; accept?: () => void; complete?: (error?: unknown) => void }>('command:create-cells', payload => {
    payload.accept?.()
    const name = String(payload.name ?? '')
    created.push(name)
    void (async () => {
      const child: Layer = { name }
      const sig = await layerSig(child)
      bySig.set(sig, child)
      const parent = layers.get(key(page)) ?? { name: page[page.length - 1] }
      layers.set(key(page), { ...parent, children: [...(parent.children ?? []), sig] })
      layers.set(key([...page, name]), child)
      payload.complete?.()
    })()
  })
  return { bytes, layers, notesCalls, appends, created, off, services }
}

describe('the live acts', () => {
  let off: (() => void) | undefined
  beforeEach(() => { off = undefined })
  afterEach(() => {
    off?.()
    ;(window as unknown as { ioc: unknown }).ioc = { get: () => undefined, register: () => { /* noop */ } }
  })

  it('land through the create path, the store, the notes service and the layer committer', async () => {
    const h = await liveHive(['inbox'])
    off = h.off
    const pdf = utf8('%PDF the bill')
    const input = await message('Subject: Quarterly invoice\r\n\r\nraw', {}, [pdf])
    const pdfSig = await sha(pdf)

    const result = await saveMessageToHive(input)

    // The message rides along so a failure says what the hive said.
    expect({ status: result.status, message: result.message }).toMatchObject({ status: 'saved' })
    expect(h.created).toEqual(['quarterly-invoice'])
    // As plain arrays: the reader's bytes and the encoder's come from two realms.
    expect([...h.bytes.get(input.sig)!]).toEqual([...input.raw])
    expect([...h.bytes.get(pdfSig)!]).toEqual([...pdf])
    expect(h.notesCalls).toEqual([{ parent: ['inbox'], cell: 'quarterly-invoice', text: 'Hello Jaime,\n\nthe invoice is attached.' }])
    expect(result.cellSig).toMatch(/^[0-9a-f]{64}$/)

    // Two records on the tile's decorations slot, both through the committer.
    const slot = h.layers.get('inbox/quarterly-invoice')!.decorations!
    expect(h.appends.every(a => a.slot === 'decorations' && key(a.segments) === 'inbox/quarterly-invoice')).toBe(true)
    const records = slot.map(sig => JSON.parse(new TextDecoder().decode(h.bytes.get(sig)!)) as {
      kind: string; payload: Record<string, unknown>; refs?: string[]
    })
    const attachment = records.find(r => r.kind === 'files:attachment')!
    expect(attachment.payload).toEqual({ name: 'file-1.pdf', mime: 'application/pdf', size: pdf.byteLength, sig: pdfSig })
    const mark = records.find(r => r.kind === MAIL_MESSAGE_KIND)!
    expect(mark.payload.sig).toBe(input.sig)
    // The mark's closure carries the message's bytes and its content hop.
    expect(mark.refs).toEqual(expect.arrayContaining([input.sig, mark.payload.content]))
    const envelope = JSON.parse(new TextDecoder().decode(h.bytes.get(String(mark.payload.content))!))
    expect(envelope).toEqual({ meta: 1, resource: input.sig, relation: 'mail:message' })
    // The mark is the last record on the tile.
    expect(records[records.length - 1].kind).toBe(MAIL_MESSAGE_KIND)
  })

  it('find the mark on a second press and place nothing', async () => {
    const h = await liveHive(['inbox'])
    off = h.off
    const input = await message('pressed twice')
    await saveMessageToHive(input)
    const appended = h.appends.length
    const stored = h.bytes.size

    const again = await saveMessageToHive(input)

    expect(again.status).toBe('already-saved')
    expect(h.created).toEqual(['quarterly-invoice'])
    expect(h.appends.length).toBe(appended)
    expect(h.bytes.size).toBe(stored)
  })

  it('are absent without the hive’s services, and the save says so', async () => {
    ;(window as unknown as { ioc: unknown }).ioc = { get: () => undefined }
    expect(liveMailToHiveDeps()).toBeNull()
    const result = await saveMessageToHive(await message('no services'))
    expect(result.status).toBe('refused')
  })
})
