// inspect-window.edit.spec.ts — a file on a tile, edited where it is read:
// Edit, the file's own text, Save through the tile's files door, and on a
// managed site door what the page did with it.

import { beforeEach, describe, expect, it } from 'vitest'

const registrations = new Map<string, unknown>()
;(globalThis as unknown as { ioc: unknown }).ioc = { get: (key: string) => registrations.get(key) }
;(window as unknown as { ioc: unknown }).ioc = (globalThis as unknown as { ioc: unknown }).ioc

const { InspectWindowView } = await import('./inspect-window.view.js')

const sig = (n: number): string => n.toString(16).padStart(64, '0')
const OLD = sig(1)
const NEW = sig(2)
const bytes = new Map<string, string>()
let writes: Array<[unknown, string]>
let answer: { ok: true; sig: string; unchanged?: boolean } | { ok: false; error: string }
let page: string[] | null

const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0)) }
let host: HTMLElement
let view: InstanceType<typeof InspectWindowView>
const q = <T extends Element>(selector: string): T | null => host.querySelector<T>(selector)
const act = (words: string): HTMLButtonElement | undefined =>
  [...host.querySelectorAll<HTMLButtonElement>('.hc-inspect-act')].find(button => button.textContent === words)
const FILE = { route: ['business-card'], name: 'main.js' }

beforeEach(async () => {
  bytes.clear()
  bytes.set(OLD, '{"colour":"teal"}')
  bytes.set(NEW, '{"colour":"red"}')
  writes = []
  answer = { ok: true, sig: NEW }
  page = ['The page ran for 1.2 s and reported no errors.']
  registrations.clear()
  registrations.set('@hypercomb.social/Store', {
    // The test environment's Blob has no arrayBuffer(): hand back the one method read.
    getResource: async (wanted: string) => bytes.has(wanted) ? { arrayBuffer: async () => new TextEncoder().encode(bytes.get(wanted)!).buffer } : null,
  })
  registrations.set('@diamondcoreprocessor.com/TileFilesDrone', {
    write: async (target: unknown, text: string) => { writes.push([target, text]); return answer },
  })
  registrations.set('@diamondcoreprocessor.com/SiteRunWatch', { say: async () => page ?? [] })
  host = document.createElement('div')
  document.body.replaceChildren(host)
  view = new InspectWindowView()
  view.mount(host, { kind: 'resource', sig: OLD, name: 'main.js', file: FILE })
  await settle()
})

describe('a file on a tile, edited where it is read', () => {
  it('offers Edit on a tile’s file, and not on a resource that is no file', async () => {
    expect(act('Edit')).toBeTruthy()
    view.mount(host, { kind: 'resource', sig: OLD, name: 'a record' })
    await settle()
    expect(act('Edit')).toBeUndefined()
  })

  it('edits the file’s own text, never the indented copy it is read as', async () => {
    // Read, JSON on one line is shown indented.
    expect(q('.hc-inspect-code')?.textContent).toContain('"colour": "teal"')
    act('Edit')!.click()
    await settle()
    expect(q<HTMLTextAreaElement>('.hc-inspect-edit')?.value).toBe('{"colour":"teal"}')
    expect(q('.hc-inspect-code')).toBeNull()
  })

  it('saves through the tile’s files door, then shows the file as saved and what the page did', async () => {
    act('Edit')!.click()
    await settle()
    q<HTMLTextAreaElement>('.hc-inspect-edit')!.value = '{"colour":"red"}'
    act('Save')!.click()
    await settle()
    expect(writes).toEqual([[{ route: ['business-card'], kind: 'file', name: 'main.js' }, '{"colour":"red"}']])
    expect(q('.hc-inspect-edit')).toBeNull()
    expect([...host.querySelectorAll('.hc-inspect-saved div')].map(node => node.textContent))
      .toEqual(['Saved main.js.', 'The page ran for 1.2 s and reported no errors.'])
    // The step now reads the saved file, and can be edited again.
    expect(q('.hc-inspect-code')?.textContent).toContain('"colour": "red"')
    expect(q('.hc-inspect-say')?.textContent).toBe(`read ${NEW}`)
    expect(act('Edit')).toBeTruthy()
  })

  it('keeps the edit and says why when it was not saved', async () => {
    answer = { ok: false, error: 'the file is larger than a tile holds' }
    act('Edit')!.click()
    await settle()
    q<HTMLTextAreaElement>('.hc-inspect-edit')!.value = 'changed'
    act('Save')!.click()
    await settle()
    expect(q<HTMLTextAreaElement>('.hc-inspect-edit')?.value).toBe('changed')
    expect(q('.hc-inspect-edit-said')?.textContent).toBe('It was not saved: the file is larger than a tile holds')
    expect(act('Save')!.disabled).toBe(false)
  })

  it('says when a save changed nothing, and asks the page nothing then', async () => {
    answer = { ok: true, sig: OLD, unchanged: true }
    act('Edit')!.click()
    await settle()
    act('Save')!.click()
    await settle()
    expect([...host.querySelectorAll('.hc-inspect-saved div')].map(node => node.textContent))
      .toEqual(['Nothing changed: the file already held exactly this.'])
  })

  it('Cancel and Escape leave the edit with the file as it was', async () => {
    act('Edit')!.click()
    await settle()
    act('Cancel')!.click()
    await settle()
    expect(q('.hc-inspect-edit')).toBeNull()
    act('Edit')!.click()
    await settle()
    q<HTMLTextAreaElement>('.hc-inspect-edit')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(q('.hc-inspect-edit')).toBeNull()
    expect(writes).toEqual([])
  })

  it('offers no Edit where files cannot be written', async () => {
    registrations.delete('@diamondcoreprocessor.com/TileFilesDrone')
    view.mount(host, { kind: 'resource', sig: OLD, name: 'main.js', file: FILE })
    await settle()
    expect(act('Edit')).toBeUndefined()
  })
})
