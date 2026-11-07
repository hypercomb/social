// mail/template-pool.spec.ts — the templates a hive keeps, against a store that
// behaves like the real one where it matters: `openPool` never creates,
// `putPoolDoc` keeps every version, resources are named by their bytes.

import { describe, expect, it } from 'vitest'
import { parseTemplate, templateBytes, type MailTemplate, type MailTemplateDocument } from './template.js'
import {
  MAIL_TEMPLATE_MEANING,
  MAX_KEPT_TEMPLATES,
  auditBytes,
  auditTemplate,
  forgetTemplate,
  listTemplates,
  recordTemplateAudit,
  saveTemplate,
  type TemplateStore,
} from './template-pool.js'

const enc = new TextEncoder()
const hex = (bytes: ArrayBuffer): string => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('')
const sha = async (bytes: Uint8Array): Promise<string> => hex(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer))
const sigOf = (ch: string): string => ch.repeat(64)

/** jsdom's Blob has no `arrayBuffer()`; a FileReader reads it, as mail-to-hive.spec.ts does. */
const bytesOf = (blob: Blob): Promise<Uint8Array> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(reader.error)
  reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
  reader.readAsArrayBuffer(blob)
})

type Held = { size: number; arrayBuffer(): Promise<ArrayBuffer> }

/** A store as this module sees it. `versions` is every list ever written, oldest first. */
const fakeStore = () => {
  const heap = new Map<string, Uint8Array>()
  const versions: string[][] = []
  const writes: { keep?: string }[] = []
  let created = false
  const files = new Set<string>()
  const pool = { name: 'pool', keys: async function* () { yield* files } }
  let reads = 0
  const store: TemplateStore & Record<string, unknown> = {
    getPool: async () => { created = true; return pool },
    openPool: async () => (created ? pool : null),
    getPoolDoc: async () => {
      const current = versions.at(-1)
      return current ? enc.encode(JSON.stringify({ meaning: MAIL_TEMPLATE_MEANING, members: current })).buffer as ArrayBuffer : null
    },
    putPoolDoc: async (_pool, bytes, _subKey, options) => {
      const doc = JSON.parse(new TextDecoder().decode(bytes)) as { meaning: string; members: string[] }
      expect(doc.meaning).toBe(MAIL_TEMPLATE_MEANING)
      versions.push(doc.members)
      writes.push({ ...(options?.keep ? { keep: options.keep } : {}) })
      const sig = await sha(new Uint8Array(bytes))
      files.add(sig)
      return sig
    },
    putResource: async (blob: Blob) => {
      const bytes = await bytesOf(blob)
      const sig = await sha(bytes)
      heap.set(sig, bytes)
      return sig
    },
    getResourceLocal: async (sig: string) => {
      const bytes = heap.get(sig)
      if (!bytes) return null
      const held: Held = { size: bytes.length, arrayBuffer: async () => { reads++; return bytes.slice().buffer as ArrayBuffer } }
      return held as unknown as Blob
    },
  }
  return { store, heap, versions, writes, files, wasCreated: () => created, reads: () => reads }
}

const NOTE: MailTemplateDocument = {
  name: 'Tasting night',
  subject: 'Join us, {{name}}',
  holes: { name: { type: 'text', required: true }, link: { type: 'url' }, photo: { type: 'resource' } },
  text: 'Hello {{name}}, more at {{link}}',
  html: '<p>Hello {{name}}</p><p><a href="https://hypercomb.com/">hypercomb.com</a> <a href="{{link}}">read more</a></p>',
  resources: { logo: sigOf('b') },
}
const OTHER: MailTemplateDocument = { name: 'Thanks', holes: {}, text: 'Thank you' }

const sigFor = async (doc: MailTemplateDocument): Promise<string> => {
  const parsed = await parseTemplate(templateBytes(doc))
  if (!parsed.ok) throw new Error(parsed.reason)
  return parsed.sig
}
const parsed = async (doc: MailTemplateDocument): Promise<MailTemplate> => {
  const result = await parseTemplate(templateBytes(doc))
  if (!result.ok) throw new Error(result.reason)
  return result.template
}

describe('the list is read from this device only', () => {
  it('says when there is no store, and never throws', async () => {
    expect(await listTemplates(undefined)).toEqual({ entries: [], problem: 'no-store' })
    expect(await listTemplates({ getPoolDoc: async () => null })).toEqual({ entries: [], problem: 'no-store' })
  })

  it('a hive that kept nothing has an empty list, and reading it creates no pool', async () => {
    const hive = fakeStore()
    expect(await listTemplates(hive.store)).toEqual({ entries: [] })
    expect(hive.wasCreated()).toBe(false)
  })

  it('a store whose every call throws is an answer, not a throw', async () => {
    const boom = async (): Promise<never> => { throw new Error('down') }
    const store: TemplateStore = { getPool: boom, openPool: boom, getPoolDoc: boom, putPoolDoc: boom, putResource: boom, getResourceLocal: boom }
    expect(await listTemplates(store)).toEqual({ entries: [] })
    expect((await saveTemplate(store, NOTE)).ok).toBe(false)
    expect((await forgetTemplate(store, sigOf('a'))).ok).toBe(false)
  })
})

describe('keeping a template', () => {
  it('its canonical bytes become a resource and the list gains its signature', async () => {
    const hive = fakeStore()
    const sig = await sigFor(NOTE)
    expect(await saveTemplate(hive.store, NOTE)).toEqual({ ok: true, sig, added: true })
    expect(await sha(hive.heap.get(sig) as Uint8Array)).toBe(sig)
    expect(hive.versions).toEqual([[sig]])
  })

  it('the list it writes is the index a host serves at sign(meaning)', async () => {
    const hive = fakeStore()
    const sig = await sigFor(NOTE)
    await saveTemplate(hive.store, NOTE)
    const bytes = await hive.store.getPoolDoc?.({})
    expect(new TextDecoder().decode(bytes as ArrayBuffer)).toBe(`{"meaning":"mail:template","members":["${sig}"]}`)
  })

  it('a save keeps the list before it: no write asks for current-only', async () => {
    const hive = fakeStore()
    await saveTemplate(hive.store, NOTE)
    await saveTemplate(hive.store, OTHER)
    expect(hive.versions).toEqual([[await sigFor(NOTE)], [await sigFor(NOTE), await sigFor(OTHER)]])
    expect(hive.writes).toEqual([{}, {}])
  })

  it('the same template twice is one member, and writes no new list', async () => {
    const hive = fakeStore()
    await saveTemplate(hive.store, NOTE)
    expect(await saveTemplate(hive.store, NOTE)).toEqual({ ok: true, sig: await sigFor(NOTE), added: false })
    expect(hive.versions).toHaveLength(1)
  })

  it('two saves finishing together are both on the list', async () => {
    const hive = fakeStore()
    const [a, b] = await Promise.all([saveTemplate(hive.store, NOTE), saveTemplate(hive.store, OTHER)])
    expect(a.ok && b.ok).toBe(true)
    expect(hive.versions.at(-1)).toEqual([await sigFor(NOTE), await sigFor(OTHER)])
  })

  it('a document that would not read back is refused with its reason, and nothing is written', async () => {
    const hive = fakeStore()
    const out = await saveTemplate(hive.store, { ...NOTE, html: '<p>hi</p><script>alert(1)</script>' })
    expect(out.ok).toBe(false)
    expect(!out.ok && out.reason).toMatch(/script/)
    expect(hive.heap.size).toBe(0)
    expect(hive.versions).toHaveLength(0)
  })

  it('something that is not a document at all is refused', async () => {
    const hive = fakeStore()
    expect(await saveTemplate(hive.store, null as unknown as MailTemplateDocument)).toEqual({ ok: false, reason: 'it is not a template' })
  })

  it('a store that keeps other bytes than it was given is refused (S3)', async () => {
    const hive = fakeStore()
    const out = await saveTemplate({ ...hive.store, putResource: async () => sigOf('e') }, NOTE)
    expect(out).toEqual({ ok: false, reason: 'the store did not keep the bytes it was given' })
    expect(hive.versions).toHaveLength(0)
  })

  it(`the list holds at most ${MAX_KEPT_TEMPLATES}, so it always publishes whole`, async () => {
    const hive = fakeStore()
    for (let i = 0; i < MAX_KEPT_TEMPLATES; i++) await saveTemplate(hive.store, { ...OTHER, name: `t${i}` })
    expect(await saveTemplate(hive.store, NOTE)).toEqual({ ok: false, reason: `the list already holds ${MAX_KEPT_TEMPLATES} templates` })
  })

  it('a list on disk that does not read is left as it is, never rewritten shorter', async () => {
    const hive = fakeStore()
    const foreign = { ...hive.store, getPoolDoc: async () => enc.encode('{"members":["x"]}').buffer as ArrayBuffer }
    expect(await saveTemplate(foreign, NOTE)).toEqual({ ok: false, reason: 'the template list on this device does not read, so it was left as it is' })
    expect(hive.versions).toHaveLength(0)
    await hive.store.getPool?.(MAIL_TEMPLATE_MEANING)
    expect(await listTemplates(foreign)).toEqual({ entries: [], problem: 'unreadable' })
  })

  it('a pool that holds a document the store could not read is not treated as empty', async () => {
    const hive = fakeStore()
    await saveTemplate(hive.store, NOTE)
    const failing = { ...hive.store, getPoolDoc: async () => null }
    expect((await saveTemplate(failing, OTHER)).ok).toBe(false)
    expect(hive.versions).toHaveLength(1)
  })

  it('a list that names something other than signatures does not read', async () => {
    const hive = fakeStore()
    await hive.store.getPool?.(MAIL_TEMPLATE_MEANING)
    for (const members of [['not-a-sig'], [1], 'x', Array(MAX_KEPT_TEMPLATES + 1).fill(sigOf('a'))]) {
      const odd = { ...hive.store, getPoolDoc: async () => enc.encode(JSON.stringify({ meaning: MAIL_TEMPLATE_MEANING, members })).buffer as ArrayBuffer }
      expect((await listTemplates(odd)).problem).toBe('unreadable')
    }
  })
})

describe('each member is read back by its signature', () => {
  it('in the order kept, as templates that render', async () => {
    const hive = fakeStore()
    await saveTemplate(hive.store, NOTE)
    await saveTemplate(hive.store, OTHER)
    const listing = await listTemplates(hive.store)
    expect(listing.entries.map(entry => entry.ok && entry.template.name)).toEqual(['Tasting night', 'Thanks'])
    expect(listing.entries.map(entry => entry.sig)).toEqual([await sigFor(NOTE), await sigFor(OTHER)])
  })

  it('a member whose bytes are not held is kept in the answer with its reason', async () => {
    const hive = fakeStore()
    await saveTemplate(hive.store, NOTE)
    hive.heap.clear()
    expect((await listTemplates(hive.store)).entries).toEqual([{ sig: await sigFor(NOTE), ok: false, reason: 'its bytes are not held here' }])
  })

  it('bytes held under the wrong name are refused (S3)', async () => {
    const hive = fakeStore()
    await saveTemplate(hive.store, NOTE)
    const sig = await sigFor(NOTE)
    hive.heap.set(sig, templateBytes(OTHER))
    const [entry] = (await listTemplates(hive.store)).entries
    expect(entry).toEqual({ sig, ok: false, reason: 'its bytes do not match the signature they were held under' })
  })

  it('a member too large to be a template is refused before it is read', async () => {
    const hive = fakeStore()
    await saveTemplate(hive.store, NOTE)
    hive.heap.set(await sigFor(NOTE), new Uint8Array(256 * 1024 + 1))
    const [entry] = (await listTemplates(hive.store)).entries
    expect(entry?.ok === false && entry.reason).toBe('it is larger than 256 KB')
    expect(hive.reads()).toBe(0)
  })

  it('a member that is not a template says why', async () => {
    const hive = fakeStore()
    const bytes = enc.encode('{"mail:template":1,"name":"a","name":"b","holes":{},"text":"x"}')
    const sig = await sha(bytes)
    hive.heap.set(sig, bytes)
    await hive.store.getPool?.(MAIL_TEMPLATE_MEANING)
    await hive.store.putPoolDoc?.({}, enc.encode(JSON.stringify({ meaning: MAIL_TEMPLATE_MEANING, members: [sig] })).buffer as ArrayBuffer)
    const [entry] = (await listTemplates(hive.store)).entries
    expect(entry?.ok === false && entry.reason).toMatch(/repeats the key "name"/)
  })
})

describe('taking one off the list is hiding it', () => {
  it('the list loses it, the bytes stay, and the list before still names it', async () => {
    const hive = fakeStore()
    const sig = await sigFor(NOTE)
    await saveTemplate(hive.store, NOTE)
    await saveTemplate(hive.store, OTHER)
    expect(await forgetTemplate(hive.store, sig)).toEqual({ ok: true, sig, added: false })
    expect(hive.versions.at(-1)).toEqual([await sigFor(OTHER)])
    expect(hive.versions[1]).toContain(sig)
    expect(hive.heap.has(sig)).toBe(true)
  })

  it('forgetting what is not on the list changes nothing; a non-signature is refused', async () => {
    const hive = fakeStore()
    await saveTemplate(hive.store, NOTE)
    expect(await forgetTemplate(hive.store, sigOf('a'))).toEqual({ ok: true, sig: sigOf('a'), added: false })
    expect(hive.versions).toHaveLength(1)
    expect(await forgetTemplate(hive.store, 'nope')).toEqual({ ok: false, reason: 'not a signature' })
  })
})

describe('the audit is a reading, never a yes', () => {
  it('lists every host, the links the sender picks, its pictures and its script', async () => {
    const template = await parsed({ ...NOTE, html: `${NOTE.html}<p><a href="mailto:host@Mail.Example">write</a></p>`, script: sigOf('d') })
    const report = auditTemplate(template)
    expect(report?.template).toBe(template.sig)
    expect(report?.hosts).toEqual(['hypercomb.com', 'mail.example'])
    expect(report?.findings).toEqual([
      { kind: 'links-to', subject: 'hypercomb.com' },
      { kind: 'links-to', subject: 'mail.example' },
      { kind: 'sender-chooses-link', subject: 'link' },
      { kind: 'sender-chooses-picture', subject: 'photo' },
      { kind: 'names-resource', subject: sigOf('b') },
      { kind: 'declares-script', subject: sigOf('d') },
    ])
  })

  it('a link whose words name one place and go to another is a finding', async () => {
    const template = await parsed({
      name: 'x', holes: { link: { type: 'url' } }, text: 'x',
      html: '<p><a href="https://evil.example/login">bank.example/login</a> <a href="https://www.bank.example/x">bank.example</a> '
        + '<a href="{{link}}">https://bank.example</a> <a href="https://bank.example/">your account</a></p>',
    })
    const odd = auditTemplate(template)?.findings.filter(f => f.kind === 'link-words-name-another-place')
    expect(odd).toEqual([
      { kind: 'link-words-name-another-place', subject: 'bank.example/login', target: 'https://evil.example/login' },
      { kind: 'link-words-name-another-place', subject: 'https://bank.example', target: '{{link}}' },
    ])
  })

  it('one template always gives one report, so its signature is its identity', async () => {
    const template = await parsed(NOTE)
    const a = auditBytes(auditTemplate(template) as NonNullable<ReturnType<typeof auditTemplate>>)
    const b = auditBytes(auditTemplate(await parsed(NOTE)) as NonNullable<ReturnType<typeof auditTemplate>>)
    expect(await sha(a)).toBe(await sha(b))
    expect(JSON.parse(new TextDecoder().decode(a))['mail:template-audit']).toBe(1)
  })

  it('the report is kept by its signature, and the brood entry recommends nothing', async () => {
    const hive = fakeStore()
    const template = await parsed(NOTE)
    const out = await recordTemplateAudit(hive.store, template)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.reportSig).toBe(await sha(auditBytes(auditTemplate(template) as NonNullable<ReturnType<typeof auditTemplate>>)))
    expect(hive.heap.has(out.reportSig)).toBe(true)
    expect(out.audit).toEqual({
      reportSig: out.reportSig,
      summary: 'template: links to 1 host; the sender picks 1 link',
      by: 'template-reader',
      recommends: 'unclear',
    })
  })

  it('even a template that reaches nothing is only "unclear"', async () => {
    const hive = fakeStore()
    const out = await recordTemplateAudit(hive.store, await parsed(OTHER))
    expect(out.ok && out.audit.recommends).toBe('unclear')
    expect(out.ok && out.audit.summary).toBe('template: links to 0 hosts')
  })

  it('without a store, or for a template that does not compile, it says so', async () => {
    expect(await recordTemplateAudit(undefined, await parsed(NOTE))).toEqual({ ok: false, reason: 'the store is not available here' })
    const forged = { name: 'x', holes: {}, text: '{{nope}}', sig: sigOf('a') } as MailTemplate
    expect(auditTemplate(forged)).toBeNull()
    expect(await recordTemplateAudit(fakeStore().store, forged)).toEqual({ ok: false, reason: 'it is not a template' })
  })
})
