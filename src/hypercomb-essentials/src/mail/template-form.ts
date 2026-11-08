// mail/template-form.ts
//
// THE FORM A TEMPLATE ASKS. Its holes are the questions (N4: a schema of
// holes), so the form is built from `holes` alone and knows nothing of what
// the template says: each hole's `label` is the question, its type the field.
// text is a line or a box, url a link field, number and date their inputs (a
// date may carry a time, sent as the instant it names), resource a signature
// with the shelf as the hand that fills it (A9), list a set of repeatable rows.
//
// ── EVERY STRING IS WRITTEN AS TEXT ─────────────────────────────────────────
//
// A template is somebody else's bytes, and its labels are its own words. They
// reach the page through `textContent` and attribute values only; nothing in
// this file parses markup. The words the form adds go through `say`, the
// caller's i18n, under `mail.template.*`.
//
// ── THE FORM COLLECTS; validateFill DECIDES ─────────────────────────────────
//
// `fill()` is what was entered, typed, with empty fields left out. Whether it
// may be sent is `validateFill`'s answer and nobody else's: `problems()` asks
// it and shows each problem beside its field, so what the form calls fine is
// exactly what the renderer will accept. No third-party code; it registers
// nothing and is mounted by whoever asks for it (the composer, step 3). It
// wears the mail window's own classes, so it is the same material there.

import { MAIL_TEMPLATE_LIMITS, validateFill, type MailFill, type MailHole, type MailTemplate, type ScalarHoleType } from './template.js'

/** The caller's words: an i18n key, the English to fall back on, and its parameters. */
export type TemplateSay = (key: string, fallback: string, params?: Readonly<Record<string, string>>) => string

export interface TemplateFormOptions {
  /** The shelf: asked for a picture's signature when its button is pressed. Without it there is no button. */
  readonly pickResource?: (hole: string) => Promise<string | null>
  /** Told after every edit. Read `fill()` or `problems()` then. */
  readonly onChange?: () => void
  /** Values to start from, such as a draft. Read as text; nothing in it is trusted. */
  readonly initial?: MailFill
}

/** One problem `validateFill` found, placed: the hole and, for a list, the row. A null hole is the fill as a whole. */
export interface TemplateFormProblem {
  readonly hole: string | null
  readonly item?: number
  readonly why: string
  readonly words: string
}

export interface TemplateForm {
  readonly element: HTMLElement
  /** What is entered, typed, empty fields left out. Not yet checked: `problems()` checks it. */
  fill(): MailFill
  /** Check the fill, show each problem beside its field, and return them. Empty when it may be sent. */
  problems(): readonly TemplateFormProblem[]
  dispose(): void
}

const SIG = /^[0-9a-f]{64}$/
/** A text hole this short is one line; longer is a box. */
const LINE_MAX = 200
/** Problems `validateFill` reports for the fill as a whole, never for one hole. */
const WHOLE = new Set(['too-large', 'not-an-object', 'unreadable', 'too-many-values'])
const PROBLEM = /^([a-z][a-z0-9_-]{0,39})(?:\[(\d+)\])?: ([a-z-]+)$/

const PROBLEM_WORDS: Readonly<Record<string, string>> = {
  required: 'This is needed.',
  'too-long': 'This is too long.',
  'too-many': 'There are too many items.',
  'control-characters': 'This has characters that cannot be sent.',
  'not-a-link': 'This is not a link that can be sent: http, https or mailto, with no password in it.',
  'not-a-number': 'This is not a number.',
  'not-a-date': 'This is not a date.',
  'not-a-signature': 'This is not a 64-character signature.',
  'too-large': 'Everything filled in together is too long.',
}

let forms = 0

const interpolate = (text: string, params?: Readonly<Record<string, string>>): string =>
  params ? text.replace(/\{(\w+)\}/g, (whole, key: string) => (Object.hasOwn(params, key) ? params[key] as string : whole)) : text

/** One question: how to read what was entered, and where its problems go. */
interface Field {
  readonly hole: string
  read(): string | number | readonly (string | number)[] | undefined
  show(item: number | undefined, words: string | null): void
}

export function templateForm(template: MailTemplate, say: TemplateSay, options: TemplateFormOptions = {}): TemplateForm {
  const id = `hc-mail-template-${++forms}`
  const life = new AbortController()
  const signal = life.signal
  let disposed = false
  let made = 0

  const words = (key: string, fallback: string, params?: Readonly<Record<string, string>>): string => {
    try {
      const said = say(key, fallback, params)
      return typeof said === 'string' && said ? said : interpolate(fallback, params)
    } catch { return interpolate(fallback, params) }
  }
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }
  const changed = (): void => { if (!disposed) options.onChange?.() }
  const initial = (name: string): unknown => (options.initial && Object.hasOwn(options.initial, name) ? options.initial[name] : undefined)

  /** A problem line for a control, placed right after `after`, hidden until there is something to say. */
  const problemLine = (control: HTMLElement, after: HTMLElement): ((text: string | null) => void) => {
    const line = make('p', 'hc-mail-status is-bad')
    line.id = `${id}-problem-${++made}`
    line.hidden = true
    after.after(line)
    return text => {
      line.textContent = text ?? ''
      line.hidden = !text
      if (text) { control.setAttribute('aria-invalid', 'true'); control.setAttribute('aria-describedby', line.id) }
      else { control.removeAttribute('aria-invalid'); control.removeAttribute('aria-describedby') }
    }
  }

  /** The control for one value of a scalar type, and how to read it. */
  const scalarControl = (type: ScalarHoleType, hole: MailHole, name: string, start: unknown, row: HTMLElement): { control: HTMLElement; read(): string | number | undefined } => {
    const asText = (value: unknown): string => (typeof value === 'string' || typeof value === 'number' ? String(value) : '')
    const input = (kind: string): HTMLInputElement => {
      const node = make('input')
      node.type = kind
      node.addEventListener('input', changed, { signal })
      return node
    }
    switch (type) {
      // A hole type no parsed template has (a hand-built one) is asked as text; validateFill names it.
      default:
      case 'text': {
        const max = hole.type === 'text' ? (hole.max ?? MAIL_TEMPLATE_LIMITS.textDefault) : MAIL_TEMPLATE_LIMITS.textDefault
        const node = max > LINE_MAX ? make('textarea') : input('text')
        node.maxLength = max
        node.value = asText(start)
        if (node instanceof HTMLTextAreaElement) node.addEventListener('input', changed, { signal })
        row.append(node)
        return { control: node, read: () => (node.value === '' ? undefined : node.value) }
      }
      case 'url': {
        const node = input('url')
        node.maxLength = MAIL_TEMPLATE_LIMITS.url
        node.value = asText(start)
        row.append(node)
        return { control: node, read: () => (node.value.trim() === '' ? undefined : node.value.trim()) }
      }
      case 'number': {
        const node = input('number')
        node.step = 'any'
        node.value = typeof start === 'number' ? String(start) : ''
        row.append(node)
        return {
          control: node,
          read: () => {
            if (node.value.trim() === '') return undefined
            const n = Number(node.value)
            return Number.isFinite(n) ? n : node.value
          },
        }
      }
      case 'date': {
        // A day, and optionally a time of that day here: the time is sent as
        // the instant it names, so every reader sees it in their own zone.
        const day = input('date')
        const time = input('time')
        time.setAttribute('aria-label', words('mail.template.time', 'Time (optional)'))
        const text = asText(start)
        day.value = text.slice(0, 10)
        if (text.length > 10) {
          const at = new Date(text)
          if (Number.isFinite(at.getTime())) {
            const pad = (n: number): string => String(n).padStart(2, '0')
            day.value = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
            time.value = `${pad(at.getHours())}:${pad(at.getMinutes())}`
          }
        }
        row.append(day, time)
        return {
          control: day,
          read: () => {
            if (day.value === '') return time.value === '' ? undefined : time.value
            if (time.value === '') return day.value
            const at = new Date(`${day.value}T${time.value}`)
            return Number.isFinite(at.getTime()) ? at.toISOString() : `${day.value}T${time.value}`
          },
        }
      }
      case 'resource': {
        const node = input('text')
        node.spellcheck = false
        node.autocomplete = 'off'
        node.maxLength = 64
        node.placeholder = words('mail.template.signature', '64-character signature')
        node.value = asText(start)
        row.append(node)
        if (options.pickResource) {
          const pick = make('button', 'hc-mail-do is-small', words('mail.template.pick', 'From the shelf'))
          pick.type = 'button'
          pick.addEventListener('click', () => {
            void options.pickResource?.(name).then(sig => {
              // The shelf's answer is a value like any other: only a signature is taken.
              if (disposed || typeof sig !== 'string' || !SIG.test(sig.trim().toLowerCase())) return
              node.value = sig.trim().toLowerCase()
              changed()
            }, () => undefined)
          }, { signal })
          row.append(pick)
        }
        return { control: node, read: () => (node.value.trim() === '' ? undefined : node.value.trim().toLowerCase()) }
      }
    }
  }

  const root = make('div', 'hc-mail-form hc-mail-template-form')
  const fields: Field[] = []

  for (const [name, hole] of Object.entries(template.holes)) {
    const question = hole.label ?? name
    const title = hole.required ? words('mail.template.required', '{label} (required)', { label: question }) : question
    const labelId = `${id}-${name}-label`

    if (hole.type !== 'list') {
      // One control: a label holds it. A date's two inputs, or a picture and its button, share a group.
      const many = hole.type === 'date' || (hole.type === 'resource' && !!options.pickResource)
      const wrap = make(many ? 'div' : 'label', 'hc-mail-field')
      const caption = make('span', undefined, title)
      caption.id = labelId
      wrap.append(caption)
      if (many) { wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-labelledby', labelId) }
      const row = many ? make('div') : wrap
      if (many) wrap.append(row)
      const { control, read } = scalarControl(hole.type, hole, name, initial(name), row)
      if (many) control.setAttribute('aria-labelledby', labelId)
      if (hole.required) control.setAttribute('aria-required', 'true')
      root.append(wrap)
      const show = problemLine(control, many ? row : control)
      control.addEventListener('input', () => show(null), { signal })
      fields.push({ hole: name, read, show: (_item, text) => show(text) })
      continue
    }

    // A list: rows of one scalar type, added and removed, at most `max`.
    const of = hole.of as ScalarHoleType
    const max = hole.max ?? MAIL_TEMPLATE_LIMITS.listDefault
    const wrap = make('div', 'hc-mail-field')
    wrap.setAttribute('role', 'group')
    wrap.setAttribute('aria-labelledby', labelId)
    const caption = make('span', undefined, title)
    caption.id = labelId
    const rows = make('div', 'hc-mail-template-rows')
    const add = make('button', 'hc-mail-do is-small', words('mail.template.add-item', 'Add'))
    add.type = 'button'
    wrap.append(caption, rows, add)
    // What is said about the list as a whole (too many items) goes under its button.
    const showWhole = problemLine(wrap, add)
    type Row = { readonly element: HTMLElement; read(): string | number | undefined; show(text: string | null): void }
    const held: Row[] = []
    const refresh = (): void => { add.disabled = held.length >= max }
    const addRow = (start: unknown): void => {
      if (held.length >= max) return
      const element = make('div', 'hc-mail-template-row')
      const { control, read } = scalarControl(of, hole, name, start, element)
      control.setAttribute('aria-labelledby', labelId)
      const remove = make('button', 'hc-mail-do is-small', words('mail.template.remove-item', 'Remove'))
      remove.type = 'button'
      element.append(remove)
      rows.append(element)
      // Inside the row, so removing the row removes what was said about it.
      const show = problemLine(control, remove)
      control.addEventListener('input', () => show(null), { signal })
      const row: Row = { element, read, show }
      held.push(row)
      remove.addEventListener('click', () => {
        const at = held.indexOf(row)
        if (at >= 0) held.splice(at, 1)
        element.remove()
        refresh()
        changed()
      }, { signal })
      refresh()
    }
    add.addEventListener('click', () => { addRow(undefined); changed() }, { signal })
    const start = initial(name)
    if (Array.isArray(start) && start.length) for (const item of start.slice(0, max)) addRow(item)
    else addRow(undefined)
    root.append(wrap)
    fields.push({
      hole: name,
      read: () => {
        // Empty rows are not items. The list's index is the one validateFill reports.
        const items = held.map(row => row.read()).filter((item): item is string | number => item !== undefined)
        return items.length ? items : undefined
      },
      show: (item, text) => {
        if (item === undefined) { showWhole(text); if (!text) for (const row of held) row.show(null); return }
        const filled = held.filter(row => row.read() !== undefined)
        filled[item]?.show(text)
      },
    })
  }

  const formLine = make('p', 'hc-mail-status is-bad')
  formLine.hidden = true
  root.append(formLine)

  const fill = (): MailFill => {
    const out: Record<string, string | number | readonly (string | number)[]> = {}
    for (const field of fields) {
      const value = field.read()
      if (value !== undefined) out[field.hole] = value
    }
    return Object.freeze(out) as MailFill
  }

  const problems = (): readonly TemplateFormProblem[] => {
    for (const field of fields) field.show(undefined, null)
    formLine.hidden = true
    formLine.textContent = ''
    const checked = validateFill(template, fill())
    if (checked.ok) return []
    const out: TemplateFormProblem[] = []
    const byHole = new Map(fields.map(field => [field.hole, field]))
    for (const problem of checked.problems) {
      const m = PROBLEM.exec(problem)
      const why = m ? (m[3] as string) : 'other'
      const said = words(`mail.template.problem.${Object.hasOwn(PROBLEM_WORDS, why) ? why : 'other'}`, PROBLEM_WORDS[why] ?? 'This could not be used.')
      const hole = m && !(m[1] === 'fill' && WHOLE.has(why)) ? (m[1] as string) : null
      const item = m?.[2] !== undefined ? Number(m[2]) : undefined
      const field = hole ? byHole.get(hole) : undefined
      if (field) field.show(item, said)
      else { formLine.textContent = formLine.textContent ? `${formLine.textContent} ${said}` : said; formLine.hidden = false }
      out.push({ hole: field ? hole : null, ...(item !== undefined ? { item } : {}), why, words: said })
    }
    return out
  }

  return {
    element: root,
    fill,
    problems,
    dispose: () => {
      if (disposed) return
      disposed = true
      life.abort()
      root.remove()
    },
  }
}
