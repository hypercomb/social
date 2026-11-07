// mail/template-form.spec.ts — the form a template asks, in jsdom. The
// templates come through parseTemplate, the way a reader holds them; the
// labels are written the way a hostile author would.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseTemplate, templateBytes, validateFill, type MailTemplate, type MailTemplateDocument } from './template.js'
import { templateForm, type TemplateForm, type TemplateSay } from './template-form.js'

const sigOf = (ch: string): string => ch.repeat(64)

const DOC: MailTemplateDocument = {
  name: 'Tasting night',
  holes: {
    name: { type: 'text', required: true, label: 'Their name', max: 80 },
    note: { type: 'text', label: 'A note' },
    link: { type: 'url', label: 'Where to read more' },
    seats: { type: 'number' },
    when: { type: 'date', label: 'When' },
    photo: { type: 'resource', label: 'A picture' },
    items: { type: 'list', of: 'url', max: 3, label: 'Links' },
  },
  text: '{{name}} {{note}} {{link}} {{seats}} {{when}} {{items}}',
}

const parsed = async (doc: MailTemplateDocument): Promise<MailTemplate> => {
  const result = await parseTemplate(templateBytes(doc))
  if (!result.ok) throw new Error(result.reason)
  return result.template
}

/** Words as a catalog gives them, so a test can see which key was asked. */
const keyed: TemplateSay = (key, _fallback, params) => `«${key}${params ? ` ${Object.values(params).join(' ')}` : ''}»`
const english: TemplateSay = (_key, fallback, params) => fallback.replace(/\{(\w+)\}/g, (_w, k: string) => params?.[k] ?? '')

let open: TemplateForm[] = []
const mount = (form: TemplateForm): TemplateForm => { document.body.append(form.element); open.push(form); return form }
afterEach(() => { for (const form of open) form.dispose(); open = [] })

const field = (form: TemplateForm, n: number): HTMLElement => form.element.querySelectorAll<HTMLElement>(':scope > .hc-mail-field')[n] as HTMLElement
const type = (control: HTMLInputElement | HTMLTextAreaElement, value: string): void => {
  control.value = value
  control.dispatchEvent(new Event('input', { bubbles: true }))
}
const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('the form is built from the holes alone', () => {
  it('one field per hole, in the author\'s order, each asking its label', async () => {
    const form = mount(templateForm(await parsed(DOC), english))
    const captions = [...form.element.querySelectorAll(':scope > .hc-mail-field > span')].map(span => span.textContent)
    expect(captions).toEqual(['Their name (required)', 'A note', 'Where to read more', 'seats', 'When', 'A picture', 'Links'])
    expect(field(form, 0).querySelector('input')?.getAttribute('aria-required')).toBe('true')
  })

  it('a short text hole is a line, a long one a box; each has the right kind of field', async () => {
    const form = mount(templateForm(await parsed(DOC), english))
    expect(field(form, 0).querySelector('input')?.type).toBe('text')
    expect(field(form, 0).querySelector('input')?.maxLength).toBe(80)
    expect(field(form, 1).querySelector('textarea')).not.toBeNull()
    expect(field(form, 2).querySelector('input')?.type).toBe('url')
    expect(field(form, 3).querySelector('input')?.type).toBe('number')
    expect([...field(form, 4).querySelectorAll('input')].map(input => input.type)).toEqual(['date', 'time'])
    expect(field(form, 5).querySelector('input')?.maxLength).toBe(64)
  })

  it('a label is text, whatever it says', async () => {
    const form = mount(templateForm(await parsed({ name: 'x', holes: { a: { type: 'text', label: '<img src=x onerror=alert(1)>' } }, text: '{{a}}' }), english))
    expect(form.element.querySelector('img')).toBeNull()
    expect(field(form, 0).querySelector('span')?.textContent).toBe('<img src=x onerror=alert(1)>')
  })

  it('the words it adds are asked of the caller by key', async () => {
    const form = mount(templateForm(await parsed(DOC), keyed, { pickResource: async () => null }))
    expect(field(form, 0).querySelector('span')?.textContent).toBe('«mail.template.required Their name»')
    expect(field(form, 5).querySelector('button')?.textContent).toBe('«mail.template.pick»')
    expect(field(form, 6).querySelector(':scope > button')?.textContent).toBe('«mail.template.add-item»')
  })

  it('words a caller cannot give fall back to English', async () => {
    const form = mount(templateForm(await parsed(DOC), () => { throw new Error('no catalog') }))
    expect(field(form, 0).querySelector('span')?.textContent).toBe('Their name (required)')
  })

  it('no markup is ever parsed: the source writes text and nodes only', () => {
    // vitest runs from src/ (as the doctrine ratchets do).
    const source = readFileSync(join(process.cwd(), 'hypercomb-essentials/src/mail/template-form.ts'), 'utf8').replace(/\/\/.*$/gm, '')
    expect(source).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|DOMParser|document\.write|createContextualFragment/)
    expect(source).not.toMatch(/^import .* from '(?!\.\/)/m)
  })
})

describe('fill() collects what was entered, typed', () => {
  it('numbers as numbers, links trimmed, empty fields left out', async () => {
    const form = mount(templateForm(await parsed(DOC), english))
    type(field(form, 0).querySelector('input') as HTMLInputElement, 'Ana')
    type(field(form, 2).querySelector('input') as HTMLInputElement, '  https://example.org/read  ')
    type(field(form, 3).querySelector('input') as HTMLInputElement, '12.5')
    expect(form.fill()).toEqual({ name: 'Ana', link: 'https://example.org/read', seats: 12.5 })
    expect(Object.isFrozen(form.fill())).toBe(true)
  })

  it('a day alone is a date; a day and a time are the instant they name here', async () => {
    const form = mount(templateForm(await parsed(DOC), english))
    const [day, time] = [...field(form, 4).querySelectorAll('input')] as HTMLInputElement[]
    type(day as HTMLInputElement, '2026-11-06')
    expect(form.fill()['when']).toBe('2026-11-06')
    type(time as HTMLInputElement, '18:30')
    expect(form.fill()['when']).toBe(new Date('2026-11-06T18:30').toISOString())
    expect(validateFill(await parsed(DOC), { name: 'a', when: form.fill()['when'] }).ok).toBe(true)
  })

  it('a list is rows, added up to its max and removed; empty rows are not items', async () => {
    const form = mount(templateForm(await parsed(DOC), english))
    const list = field(form, 6)
    const add = list.querySelector(':scope > button') as HTMLButtonElement
    add.click()
    add.click()
    expect(list.querySelectorAll('.hc-mail-template-row')).toHaveLength(3)
    expect(add.disabled).toBe(true)
    const inputs = [...list.querySelectorAll<HTMLInputElement>('.hc-mail-template-row input')]
    type(inputs[0] as HTMLInputElement, 'https://a.example/')
    type(inputs[2] as HTMLInputElement, 'https://c.example/')
    expect(form.fill()['items']).toEqual(['https://a.example/', 'https://c.example/'])
    ;(list.querySelector('.hc-mail-template-row button') as HTMLButtonElement).click()
    expect(form.fill()['items']).toEqual(['https://c.example/'])
    expect(add.disabled).toBe(false)
  })

  it('starts from a draft, read as text', async () => {
    const when = '2026-11-06T18:30:00.000Z'
    const form = mount(templateForm(await parsed(DOC), english, { initial: { name: 'Ana', seats: 4, when, items: ['https://a.example/', 'https://b.example/'] } }))
    expect(form.fill()).toEqual({ name: 'Ana', seats: 4, when, items: ['https://a.example/', 'https://b.example/'] })
  })
})

describe('a picture comes from the shelf, and only a signature is taken', () => {
  it('the shelf fills the field', async () => {
    const asked: string[] = []
    const form = mount(templateForm(await parsed(DOC), english, { pickResource: async hole => { asked.push(hole); return sigOf('C') } }))
    ;(field(form, 5).querySelector('button') as HTMLButtonElement).click()
    await tick()
    expect(asked).toEqual(['photo'])
    expect(form.fill()['photo']).toBe(sigOf('c'))
  })

  it('an answer that is not a signature, or a shelf that fails, changes nothing', async () => {
    for (const answer of [async () => 'javascript:alert(1)', async () => null, async () => { throw new Error('shelf down') }]) {
      const form = mount(templateForm(await parsed(DOC), english, { pickResource: answer }))
      ;(field(form, 5).querySelector('button') as HTMLButtonElement).click()
      await tick()
      expect(form.fill()['photo']).toBeUndefined()
    }
  })

  it('a shelf that answers after the form is gone writes nothing and tells no one', async () => {
    let answer: (sig: string) => void = () => undefined
    let changes = 0
    const form = mount(templateForm(await parsed(DOC), english, { pickResource: () => new Promise(resolve => { answer = resolve }), onChange: () => { changes++ } }))
    const input = field(form, 5).querySelector('input') as HTMLInputElement
    ;(field(form, 5).querySelector('button') as HTMLButtonElement).click()
    form.dispose()
    answer(sigOf('d'))
    await tick()
    expect(input.value).toBe('')
    expect(changes).toBe(0)
  })

  it('without a shelf there is no button, only the field', async () => {
    const form = mount(templateForm(await parsed(DOC), english))
    expect(field(form, 5).querySelector('button')).toBeNull()
    expect(field(form, 5).tagName).toBe('LABEL')
  })
})

describe('problems() is validateFill, shown where it belongs', () => {
  it('a missing required hole is said beside its field and returned', async () => {
    const form = mount(templateForm(await parsed(DOC), keyed))
    const problems = form.problems()
    expect(problems).toEqual([{ hole: 'name', why: 'required', words: '«mail.template.problem.required»' }])
    const input = field(form, 0).querySelector('input') as HTMLInputElement
    const line = field(form, 0).querySelector('.hc-mail-status') as HTMLElement
    expect(line.hidden).toBe(false)
    expect(line.textContent).toBe('«mail.template.problem.required»')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe(line.id)
  })

  it('typing clears what was said, and a good fill has no problems', async () => {
    const form = mount(templateForm(await parsed(DOC), english))
    form.problems()
    const input = field(form, 0).querySelector('input') as HTMLInputElement
    type(input, 'Ana')
    expect((field(form, 0).querySelector('.hc-mail-status') as HTMLElement).hidden).toBe(true)
    expect(form.problems()).toEqual([])
    expect(input.hasAttribute('aria-invalid')).toBe(false)
  })

  it('every refusal by type has its words', async () => {
    const form = mount(templateForm(await parsed(DOC), english))
    type(field(form, 0).querySelector('input') as HTMLInputElement, 'Ana‮')
    type(field(form, 2).querySelector('input') as HTMLInputElement, 'javascript:alert(1)')
    type(field(form, 5).querySelector('input') as HTMLInputElement, 'not a sig')
    // A time with no day. (An impossible day, 2026-02-30, the date field itself empties, as a browser does.)
    const [, time] = [...field(form, 4).querySelectorAll('input')] as HTMLInputElement[]
    type(time as HTMLInputElement, '18:30')
    expect(form.problems().map(p => [p.hole, p.why, p.words])).toEqual([
      ['name', 'control-characters', 'This has characters that cannot be sent.'],
      ['link', 'not-a-link', 'This is not a link that can be sent: http, https or mailto, with no password in it.'],
      ['when', 'not-a-date', 'This is not a date.'],
      ['photo', 'not-a-signature', 'This is not a 64-character signature.'],
    ])
  })

  it('a bad item is said on its own row, counting only the filled rows', async () => {
    const form = mount(templateForm(await parsed(DOC), english))
    type(field(form, 0).querySelector('input') as HTMLInputElement, 'Ana')
    const list = field(form, 6)
    const add = list.querySelector(':scope > button') as HTMLButtonElement
    add.click()
    add.click()
    const rows = [...list.querySelectorAll<HTMLElement>('.hc-mail-template-row')]
    type(rows[1]?.querySelector('input') as HTMLInputElement, 'https://ok.example/')
    type(rows[2]?.querySelector('input') as HTMLInputElement, 'ftp://no.example/')
    expect(form.problems()).toEqual([{ hole: 'items', item: 1, why: 'not-a-link', words: expect.any(String) }])
    expect((rows[2]?.querySelector('.hc-mail-status') as HTMLElement).hidden).toBe(false)
    expect((rows[1]?.querySelector('.hc-mail-status') as HTMLElement).hidden).toBe(true)
  })

  it('a problem with the fill as a whole is said under the form', async () => {
    const holes = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`t${i}`, { type: 'text' as const, max: 20_000 }]))
    const form = mount(templateForm(await parsed({ name: 'x', holes, text: Object.keys(holes).map(h => `{{${h}}}`).join(' ') }), english))
    for (const box of form.element.querySelectorAll('textarea')) type(box, 'x'.repeat(14_000))
    expect(form.problems()).toEqual([{ hole: null, why: 'too-large', words: 'Everything filled in together is too long.' }])
    const line = form.element.querySelector(':scope > .hc-mail-status') as HTMLElement
    expect(line.hidden).toBe(false)
  })

  it('a hole named "fill" is still a hole', async () => {
    const form = mount(templateForm(await parsed({ name: 'x', holes: { fill: { type: 'text', required: true } }, text: '{{fill}}' }), english))
    expect(form.problems()).toEqual([{ hole: 'fill', why: 'required', words: 'This is needed.' }])
  })
})

describe('change and disposal', () => {
  it('every edit is told; after dispose nothing is, and the form is gone', async () => {
    let changes = 0
    const form = mount(templateForm(await parsed(DOC), english, { onChange: () => { changes++ } }))
    const input = field(form, 0).querySelector('input') as HTMLInputElement
    type(input, 'A')
    type(field(form, 1).querySelector('textarea') as HTMLTextAreaElement, 'B')
    ;(field(form, 6).querySelector(':scope > button') as HTMLButtonElement).click()
    expect(changes).toBe(3)
    form.dispose()
    type(input, 'C')
    expect(changes).toBe(3)
    expect(form.element.isConnected).toBe(false)
    form.dispose()
  })

  it('a hand-built hole type is asked as text, and validateFill names it', async () => {
    const forged = { name: 'x', holes: { odd: { type: 'colour' } }, text: 'x', sig: sigOf('a') } as unknown as MailTemplate
    const form = mount(templateForm(forged, english))
    type(form.element.querySelector('textarea') as HTMLTextAreaElement, 'red')
    expect(form.problems().map(p => p.why)).toEqual(['unknown-type'])
  })
})
