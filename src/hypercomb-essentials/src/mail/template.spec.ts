// mail/template.spec.ts — a message you fill in. The templates here are written
// the way an author would, the fills the way a hostile sender would, and the
// part travels through a real multipart message read by mime.ts.

import { describe, expect, it } from 'vitest'
import { attachmentBytes, parseMail } from './mime.js'
import {
  MAIL_TEMPLATE_HEADER,
  MAIL_TEMPLATE_LIMITS,
  MAIL_TEMPLATE_PART_TYPE,
  mailPart,
  parseTemplate,
  readMailPart,
  renderTemplate,
  templateBytes,
  validateFill,
  type HeldResource,
  type MailFill,
  type MailTemplate,
  type MailTemplateDocument,
  type RenderDeps,
  type TemplateTrust,
} from './template.js'

const enc = new TextEncoder()
const sha256 = async (bytes: Uint8Array): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), b => b.toString(16).padStart(2, '0')).join('')
/** A signature-shaped value, never a literal one. */
const sigOf = (ch: string): string => ch.repeat(64)

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
const SVG = enc.encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script></svg>')

const THANKS: MailTemplateDocument = {
  name: 'Thank you',
  description: 'A thank-you note with a picture and a list',
  subject: 'Thanks, {{name}}',
  holes: {
    name: { type: 'text', required: true, label: 'Their name' },
    link: { type: 'url', label: 'Where to read more' },
    when: { type: 'date' },
    count: { type: 'number' },
    photo: { type: 'resource', label: 'A picture' },
    items: { type: 'list', of: 'text', max: 5 },
  },
  text: 'Hello {{name}},\n\nThank you for the {{count}} tiles on {{when}}.\n  {{items}}\nMore: {{link}}\n{{@logo}}',
  html: '<h1>Hello {{name}}</h1><p>Thank you for the <strong>{{count}}</strong> tiles on {{when}}.</p>'
    + '<ul>{{items}}</ul><p>{{photo}} {{@logo}}</p><p><a href="{{link}}" rel="noopener">read more</a> &amp; '
    + '<a href="https://hypercomb.com/">home</a></p><hr><blockquote><p><em>signed</em> <code>{{name}}</code></p></blockquote>',
  resources: { logo: sigOf('b') },
}

const FILL = {
  name: 'Ana',
  link: 'https://example.org/read',
  when: '2026-11-06',
  count: 1234.5,
  photo: sigOf('c'),
  items: ['one', 'two'],
}

/** A document as an author writes it (through templateBytes), or raw JSON that already says its version. */
const parsed = async (doc: MailTemplateDocument | Record<string, unknown>): Promise<MailTemplate> => {
  const bytes = 'mail:template' in doc ? enc.encode(JSON.stringify(doc)) : templateBytes(doc as MailTemplateDocument)
  const result = await parseTemplate(bytes)
  if (!result.ok) throw new Error(result.reason)
  return result.template
}

const reasonFor = async (doc: unknown): Promise<string> => {
  const result = await parseTemplate(typeof doc === 'string' ? enc.encode(doc) : enc.encode(JSON.stringify(doc)))
  if (result.ok) throw new Error('expected a refusal')
  return result.reason
}

const withHtml = (html: string, holes: MailTemplateDocument['holes'] = { name: { type: 'text' }, link: { type: 'url' }, items: { type: 'list', of: 'text' } }): Record<string, unknown> =>
  ({ 'mail:template': 1, name: 'x', holes, text: 'x', html })

const heap = (entries: Record<string, HeldResource>) => (sig: string): HeldResource | null => entries[sig] ?? null
const deps = (trust: TemplateTrust, more: Partial<RenderDeps> = {}): RenderDeps =>
  ({ trust: () => trust, resolveResource: heap({ [sigOf('c')]: { type: 'image/png', bytes: PNG } }), ...more })

const fillOf = (template: MailTemplate, fill: unknown): MailFill => {
  const checked = validateFill(template, fill)
  if (!checked.ok) throw new Error(checked.problems.join('; '))
  return checked.fill
}

describe('a template is one artifact', () => {
  it('round-trips through its canonical bytes, and its signature is the sha256 of those bytes', async () => {
    const bytes = templateBytes(THANKS)
    const result = await parseTemplate(bytes)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sig).toBe(await sha256(bytes))
    expect(result.template.sig).toBe(result.sig)
    expect(result.template.name).toBe('Thank you')
    expect(result.template.holes['items']).toEqual({ type: 'list', of: 'text', max: 5 })
    expect(templateBytes(result.template)).toEqual(bytes)
  })

  it('the same template is the same signature, and one changed byte is another', async () => {
    const a = await parseTemplate(templateBytes(THANKS))
    const b = await parseTemplate(templateBytes({ ...THANKS }))
    const c = await parseTemplate(templateBytes({ ...THANKS, name: 'Thank you!' }))
    expect(a.ok && b.ok && c.ok).toBe(true)
    if (!a.ok || !b.ok || !c.ok) return
    expect(a.sig).toBe(b.sig)
    expect(c.sig).not.toBe(a.sig)
  })

  it('refuses bytes that do not match the signature they were held under', async () => {
    const bytes = templateBytes(THANKS)
    expect((await parseTemplate(bytes, await sha256(bytes))).ok).toBe(true)
    const wrong = await parseTemplate(bytes, sigOf('d'))
    expect(wrong.ok).toBe(false)
    if (!wrong.ok) expect(wrong.reason).toMatch(/do not match/)
  })

  it('declares a script and keeps it as a signature, nothing more', async () => {
    const template = await parsed({ ...THANKS, script: sigOf('e') })
    expect(template.script).toBe(sigOf('e'))
  })
})

describe('parse refuses, with a reason, never strips', () => {
  const base = { 'mail:template': 1, name: 'x', holes: {}, text: 'x' }
  const cases: [string, unknown, RegExp][] = [
    ['not JSON', '{ nope', /not JSON/],
    ['not an object', '[1,2]', /not a JSON object/],
    ['no version', { name: 'x', holes: {}, text: 'x' }, /"mail:template": 1/],
    ['a later version', { ...base, 'mail:template': 2 }, /"mail:template": 1/],
    ['an unknown field', { ...base, style: 'x' }, /unknown field "style"/],
    ['no text', { ...base, text: ' ' }, /"text" is missing/],
    ['no name', { ...base, name: '' }, /"name" is empty/],
    ['a long name', { ...base, name: 'n'.repeat(121) }, /longer than 120/],
    ['holes not an object', { ...base, holes: [] }, /"holes" must be an object/],
    ['a bad hole type', { ...base, holes: { a: { type: 'html' } } }, /no type this format knows/],
    ['a hole with an unknown field', { ...base, holes: { a: { type: 'text', default: 'x' } } }, /unknown field "default"/],
    ['a list without "of"', { ...base, holes: { a: { type: 'list' } } }, /must say what it holds/],
    ['a list of lists', { ...base, holes: { a: { type: 'list', of: 'list' } } }, /must say what it holds/],
    ['"of" on a scalar', { ...base, holes: { a: { type: 'text', of: 'text' } } }, /only a list says "of"/],
    ['"max" on a number', { ...base, holes: { a: { type: 'number', max: 3 } } }, /only a text or list hole says "max"/],
    ['"max" over the ceiling', { ...base, holes: { a: { type: 'list', of: 'text', max: 10_000 } } }, /from 1 to 200/],
    ['"required" not a boolean', { ...base, holes: { a: { type: 'text', required: 'yes' } } }, /true or false/],
    ['a hole name with capitals', { ...base, holes: { Name: { type: 'text' } } }, /hole's name must be lowercase/],
    ['too many holes', { ...base, holes: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`h${i}`, { type: 'text' }])) }, /more than 64 holes/],
    ['a resource that is not a signature', { ...base, resources: { logo: 'logo.png' } }, /not a signature/],
    ['a script that is not a signature', { ...base, script: 'alert(1)' }, /"script" must be a signature/],
    ['a subject on two lines', { ...base, subject: 'a\nb' }, /one line/],
    ['a picture in the subject', { ...base, holes: { p: { type: 'resource' } }, subject: '{{p}}' }, /subject names a picture/],
    ['an undeclared hole', { ...base, text: 'hi {{who}}' }, /does not declare: who/],
    ['an undeclared resource', { ...base, text: 'hi {{@logo}}' }, /does not declare: @logo/],
    ['a nested "{{"', { ...base, holes: { a: { type: 'text' } }, text: 'x {{{a}}} y' }, /"\{\{" that is not a hole/],
    ['an unclosed "{{"', { ...base, holes: { a: { type: 'text' } }, text: 'x {{a y' }, /"\{\{" that is not a hole/],
    ['a direction override', { ...base, text: 'pay ‮exe.txt' }, /direction overrides/],
    ['a control character', { ...base, text: 'a\u0007b' }, /control characters/],
  ]
  for (const [what, doc, reason] of cases) {
    it(`refuses ${what}`, async () => { expect(await reasonFor(doc)).toMatch(reason) })
  }

  it('refuses __proto__, constructor and prototype as keys anywhere', async () => {
    expect(await reasonFor('{"mail:template":1,"name":"x","holes":{},"text":"x","__proto__":{"polluted":true}}')).toMatch(/__proto__/)
    expect(await reasonFor('{"mail:template":1,"name":"x","holes":{"constructor":{"type":"text"}},"text":"x"}')).toMatch(/constructor/)
    expect(await reasonFor('{"mail:template":1,"name":"x","holes":{"a":{"type":"text","prototype":1}},"text":"x"}')).toMatch(/prototype/)
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
  })

  it('refuses a key said twice, which two readers could read two ways', async () => {
    expect(await reasonFor('{"mail:template":1,"name":"safe","name":"evil","holes":{},"text":"x"}')).toMatch(/repeats the key "name"/)
    expect(await reasonFor('{"mail:template":1,"name":"x","holes":{"a":{"type":"text","type":"url"}},"text":"x"}')).toMatch(/repeats the key "type"/)
    // The same key in two different objects is not a repeat.
    expect((await parseTemplate(enc.encode('{"mail:template":1,"name":"x","holes":{"a":{"type":"text"},"b":{"type":"text"}},"text":"{{a}}{{b}}"}'))).ok).toBe(true)
  })

  it('refuses bytes over 256 KB and bytes that are not UTF-8', async () => {
    const big = templateBytes({ name: 'x', holes: {}, text: 'x'.repeat(MAIL_TEMPLATE_LIMITS.templateBytes) })
    const over = await parseTemplate(big)
    expect(over.ok).toBe(false)
    if (!over.ok) expect(over.reason).toMatch(/larger than 256 KB/)
    const bad = await parseTemplate(Uint8Array.from([0x7b, 0xff, 0xfe, 0x7d]))
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.reason).toMatch(/not UTF-8/)
  })

  it('refuses a template that names holes more than 256 times', async () => {
    expect(await reasonFor({ 'mail:template': 1, name: 'x', holes: { a: { type: 'text' } }, text: '{{a}}'.repeat(257) })).toMatch(/more than 256 times/)
  })
})

describe('the html is a closed set', () => {
  const refused: [string, string, RegExp][] = [
    ['a script', '<p>hi</p><script>alert(1)</script>', /<script>/],
    ['an iframe', '<iframe srcdoc="x"></iframe>', /<iframe>/],
    ['an onload', '<p onload="alert(1)">hi</p>', /onload is not allowed on <p>/],
    ['a style block with url(', '<style>p{background:url(https://tracker.example/p.gif)}</style>', /<style>/],
    ['a style attribute', '<p style="background:url(https://tracker.example/p.gif)">x</p>', /style is not allowed/],
    ['a base', '<base href="https://evil.example/">', /<base>/],
    ['a meta refresh', '<meta http-equiv="refresh" content="0;url=https://evil.example/">', /<meta>/],
    ['an img tag', '<img src="https://tracker.example/p.gif">', /<img>/],
    ['an svg', '<svg onload="alert(1)"></svg>', /<svg>/],
    ['a form', '<form action="https://evil.example/"><input name="pw"></form>', /<form>/],
    ['a comment', '<!--[if mso]><p>x</p><![endif]-->', /does not open a tag/],
    ['a doctype', '<!doctype html><p>x</p>', /does not open a tag/],
    ['a bare <', '<p>1 < 2</p>', /does not open a tag/],
    ['a bare &', '<p>fish & chips</p>', /"&" that is not a character/],
    ['an unknown entity', '<p>&bogus;</p>', /"&" that is not a character/],
    ['a NUL character reference', '<p>&#0;</p>', /"&" that is not a character/],
    ['a direction override by reference', '<p>&#x202E;</p>', /"&" that is not a character/],
    ['a javascript: link', '<a href="javascript:alert(1)">x</a>', /not http, https or mailto/],
    ['a javascript: link spelled with references', '<a href="javascript&#58;alert(1)">x</a>', /not http, https or mailto/],
    ['a data: link', '<a href="data:text/html,<script>alert(1)</script>">x</a>', /not http, https or mailto/],
    ['a link with credentials', '<a href="https://bank.example@evil.example/">x</a>', /not http, https or mailto/],
    ['a text hole as an href', '<a href="{{name}}">x</a>', /may only be a url hole/],
    ['an href that is a hole and more', '<a href="https://x.example/?q={{name}}">x</a>', /one hole and nothing else/],
    ['a target attribute', '<a href="https://x.example/" target="_top">x</a>', /target is not allowed/],
    ['a rel it does not know', '<a href="https://x.example/" rel="opener">x</a>', /rel may only say/],
    ['an attribute with no value', '<a href>x</a>', /has no value/],
    ['an attribute said twice', '<a href="https://a.example/" href="https://b.example/">x</a>', /repeats the attribute href/],
    ['a link inside a link', '<a href="https://a.example/"><strong><a href="https://b.example/">x</a></strong></a>', /cannot sit inside|link cannot sit inside a link/],
    ['a block inside a paragraph', '<p><ul><li>x</li></ul></p>', /<ul> cannot sit inside <p>/],
    ['an li outside a list', '<li>x</li>', /<li> cannot sit inside the top/],
    ['text directly in a list', '<ul>loose<li>x</li></ul>', /directly in a <ul>/],
    ['a scalar hole directly in a list', '<ul>{{name}}</ul>', /only a list hole may sit directly/],
    ['a tag never closed', '<p><strong>x</p>', /closes something that is not open/],
    ['a paragraph never closed', '<p>x', /<p> is never closed/],
    ['a close with nothing open', 'x</em>', /closes something that is not open/],
    ['a tag inside code', '<code><em>x</em></code>', /<em> cannot sit inside <code>/],
    ['a start that is not a number', '<ol start="-1"><li>x</li></ol>', /whole number/],
  ]
  for (const [what, html, reason] of refused) {
    it(`refuses ${what}`, async () => { expect(await reasonFor(withHtml(html))).toMatch(reason) })
  }

  it('refuses nesting deeper than 16', async () => {
    expect(await reasonFor(withHtml('<blockquote>'.repeat(17) + 'x' + '</blockquote>'.repeat(17)))).toMatch(/deeper than 16/)
  })

  it('accepts the format.ts set, h3, hr, references, a start and a mailto link', async () => {
    const template = await parsed(withHtml(
      '<h1>a</h1><h2>b</h2><h3>c</h3><p>d<br>e<br/></p><hr><ol start="3"><li>f</li><li><p>g</p><ul><li>h</li></ul></li></ol>'
      + '<blockquote><p>&lt;i&gt; &quot;q&quot; &#39;s&#39; &nbsp; &#x263A;</p></blockquote>'
      + '<p><a href="mailto:ana@example.org" rel="noopener noreferrer"><em>write</em></a> <CODE>x</CODE></p>'))
    expect(template.html).toContain('<h3>c</h3>')
  })

  it('finishes quickly on a hostile wall of almost-tags', async () => {
    const started = Date.now()
    const result = await parseTemplate(enc.encode(JSON.stringify(withHtml('<a' + ' '.repeat(200_000)))))
    expect(result.ok).toBe(false)
    expect(Date.now() - started).toBeLessThan(2000)
  })
})

describe('a fill is checked before anything renders', () => {
  it('accepts a good fill and normalizes it', async () => {
    const template = await parsed(THANKS)
    const checked = validateFill(template, { ...FILL, link: 'HTTPS://Example.org/read', name: 'Ana\r\nB' })
    expect(checked.ok).toBe(true)
    if (!checked.ok) return
    expect(checked.fill['link']).toBe('https://example.org/read')
    expect(checked.fill['name']).toBe('Ana\nB')
    expect(Object.isFrozen(checked.fill)).toBe(true)
  })

  const hostile: [string, Record<string, unknown>, RegExp][] = [
    ['a missing required hole', { link: 'https://x.example/' }, /^name: required$/],
    ['a blank required hole', { name: '   ' }, /^name: required$/],
    ['an unknown hole', { name: 'a', extra: 1 }, /^extra: unknown$/],
    ['a javascript: url', { name: 'a', link: 'javascript:alert(1)' }, /^link: not-a-link$/],
    ['a data: url', { name: 'a', link: 'data:text/html;base64,PHNjcmlwdD4=' }, /^link: not-a-link$/],
    ['a url with credentials', { name: 'a', link: 'https://bank.example@evil.example/' }, /^link: not-a-link$/],
    ['a url that is not a string', { name: 'a', link: { href: 'https://x.example/' } }, /^link: not-a-link$/],
    ['a number that is a string', { name: 'a', count: '12' }, /^count: not-a-number$/],
    ['an infinite number', { name: 'a', count: Infinity }, /^count: not-a-number$/],
    ['NaN', { name: 'a', count: Number.NaN }, /^count: not-a-number$/],
    ['a date that is not ISO', { name: 'a', when: 'Nov 6 2026' }, /^when: not-a-date$/],
    ['a date that is not real', { name: 'a', when: '2026-02-30' }, /^when: not-a-date$/],
    ['a time with no zone', { name: 'a', when: '2026-11-06T10:00' }, /^when: not-a-date$/],
    ['a resource that is not a signature', { name: 'a', photo: 'https://tracker.example/p.gif' }, /^photo: not-a-signature$/],
    ['an upper-case signature', { name: 'a', photo: sigOf('C') }, /^photo: not-a-signature$/],
    ['a list that is not a list', { name: 'a', items: 'one, two' }, /^items: not-a-list$/],
    ['a list over its max', { name: 'a', items: ['1', '2', '3', '4', '5', '6'] }, /^items: too-many$/],
    ['a bad list item', { name: 'a', items: ['ok', 7] }, /^items\[1\]: not-text$/],
    ['a direction override in text', { name: 'evil‮txt.exe' }, /^name: control-characters$/],
    ['a control character in text', { name: 'a\u0000b' }, /^name: control-characters$/],
  ]
  for (const [what, fill, problem] of hostile) {
    it(`refuses ${what}`, async () => {
      const checked = validateFill(await parsed(THANKS), fill)
      expect(checked.ok).toBe(false)
      if (!checked.ok) expect(checked.problems.some(p => problem.test(p))).toBe(true)
    })
  }

  it('refuses a 10 MB string by its length, before reading it', async () => {
    const started = Date.now()
    const checked = validateFill(await parsed(THANKS), { name: 'x'.repeat(10 * 1024 * 1024) })
    expect(checked.ok).toBe(false)
    if (!checked.ok) expect(checked.problems).toEqual(['name: too-long'])
    expect(Date.now() - started).toBeLessThan(500)
  })

  it('refuses a 10,000-item list by its length, before reading it', async () => {
    const template = await parsed({ ...THANKS, holes: { ...THANKS.holes, items: { type: 'list', of: 'text', max: 200 } } })
    const checked = validateFill(template, { name: 'a', items: Array.from({ length: 10_000 }, () => 'x') })
    expect(checked.ok).toBe(false)
    if (!checked.ok) expect(checked.problems).toEqual(['items: too-many'])
  })

  it('refuses a fill whose strings together are too large', async () => {
    const holes = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`t${i}`, { type: 'text' as const, max: 20_000 }]))
    const template = await parsed({ 'mail:template': 1, name: 'x', holes, text: 'x' })
    const checked = validateFill(template, Object.fromEntries(Object.keys(holes).map(k => [k, 'y'.repeat(2_000)])))
    expect(checked.ok).toBe(false)
    if (!checked.ok) expect(checked.problems).toContain('fill: too-large')
  })

  it('refuses prototype-pollution keys and never pollutes', async () => {
    const template = await parsed(THANKS)
    const fromJson = JSON.parse('{"name":"a","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}') as unknown
    const checked = validateFill(template, fromJson)
    expect(checked.ok).toBe(false)
    if (!checked.ok) expect(checked.problems).toEqual(expect.arrayContaining(['__proto__: forbidden', 'constructor: forbidden']))
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
  })

  it('refuses what is not a plain object, and never calls a getter', async () => {
    const template = await parsed(THANKS)
    for (const fill of [null, 'name=a', ['a'], new Map([['name', 'a']]), new Date()]) {
      const checked = validateFill(template, fill)
      expect(checked.ok).toBe(false)
    }
    let called = false
    const sneaky = { get name(): string { called = true; return 'a' } }
    const checked = validateFill(template, sneaky)
    expect(checked.ok).toBe(false)
    if (!checked.ok) expect(checked.problems).toEqual(['name: not-a-value'])
    expect(called).toBe(false)
  })
})

describe('rendering escapes each value by its type', () => {
  it('renders subject, text and html', async () => {
    const template = await parsed(THANKS)
    const out = renderTemplate(template, FILL, deps('unknown'))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.subject).toBe('Thanks, Ana')
    expect(out.text).toContain('Hello Ana,')
    expect(out.text).toContain('1,234.5 tiles on November 6, 2026.')
    expect(out.text).toContain('  - one\n  - two\n')
    expect(out.text).toContain('More: https://example.org/read')
    expect(out.text).toContain('[picture: logo]')
    expect(out.html).toContain('<h1>Hello Ana</h1>')
    expect(out.html).toContain('<ul><li>one</li><li>two</li></ul>')
    expect(out.html).toContain('<a href="https://example.org/read" rel="noopener noreferrer">read more</a> &amp; <a href="https://hypercomb.com/" rel="noopener noreferrer">home</a>')
    expect(out.html).toContain(`<img src="data:image/png;base64,${btoa(String.fromCharCode(...PNG))}" alt="A picture">`)
    expect(out.html).toContain('<code>Ana</code>')
  })

  it('renders html and "{{" in a text hole as the characters they are, and never expands them', async () => {
    const template = await parsed(THANKS)
    const out = renderTemplate(template, { name: '<img src=x onerror=alert(1)> {{link}} {{@logo}}', link: 'https://example.org/' }, deps('admitted'))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.html).toContain('&lt;img src=x onerror=alert(1)&gt; {{link}} {{@logo}}')
    expect(out.html).not.toContain('<img src=x')
    expect(out.text).toContain('Hello <img src=x onerror=alert(1)> {{link}} {{@logo}},')
    expect(out.subject).toBe('Thanks, <img src=x onerror=alert(1)> {{link}} {{@logo}}')
  })

  it('folds a fill\'s line breaks out of the subject, so no header can be smuggled', async () => {
    const out = renderTemplate(await parsed(THANKS), { name: 'Ana\nBcc: everyone@example.org' }, deps('unknown'))
    expect(out.ok && out.subject).toBe('Thanks, Ana Bcc: everyone@example.org')
  })

  it('a quote in a url cannot leave its attribute', async () => {
    const out = renderTemplate(await parsed(THANKS), { name: 'a', link: 'https://example.org/?q="onmouseover="alert(1)' }, deps('unknown'))
    expect(out.ok).toBe(false)
    const encoded = renderTemplate(await parsed(THANKS), { name: 'a', link: "https://example.org/?q='x'" }, deps('unknown'))
    expect(encoded.ok).toBe(true)
    if (encoded.ok) expect(encoded.html).toContain('href="https://example.org/?q=%27x%27"')
  })

  it('a url hole in text becomes a link, inside a link or code it stays text', async () => {
    const template = await parsed(withHtml('<p>{{link}}</p><p><a href="https://a.example/">{{link}}</a></p><p><code>{{link}}</code></p>'))
    const out = renderTemplate(template, { link: 'https://b.example/' }, deps('unknown'))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.html).toBe('<p><a href="https://b.example/" rel="noopener noreferrer">https://b.example/</a></p>'
      + '<p><a href="https://a.example/" rel="noopener noreferrer">https://b.example/</a></p><p><code>https://b.example/</code></p>')
  })

  it('leaves an optional hole empty, and a link to a missing url without an href', async () => {
    const out = renderTemplate(await parsed(THANKS), { name: 'Ana' }, deps('unknown'))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.html).toContain('<p><a>read more</a> &amp; ')
    expect(out.html).toContain('<ul></ul>')
    expect(out.text).toContain('More: \n')
  })

  it('formats dates with a time in the zone it is given', async () => {
    const template = await parsed({ 'mail:template': 1, name: 'x', holes: { at: { type: 'date' } }, text: '{{at}}' })
    const utc = renderTemplate(template, { at: '2026-11-06T18:30:00Z' }, deps('unknown'))
    const pacific = renderTemplate(template, { at: '2026-11-06T18:30:00Z' }, deps('unknown', { timeZone: 'America/Vancouver' }))
    // ICU's joiner and the space before PM differ across Node versions; the day and the hour do not.
    expect(utc.ok && utc.text).toMatch(/^November 6, 2026\D+6:30\sPM$/)
    expect(pacific.ok && pacific.text).toMatch(/^November 6, 2026\D+10:30\sAM$/)
    const broken = renderTemplate(template, { at: '2026-11-06T18:30:00Z' }, deps('unknown', { timeZone: 'Not/AZone', locale: 'not a locale' }))
    expect(broken.ok && broken.text).toMatch(/^November 6, 2026\D+6:30\sPM$/)
  })

  it('refuses to render an unchecked fill', async () => {
    const out = renderTemplate(await parsed(THANKS), { name: 'a', link: 'javascript:alert(1)' }, deps('admitted'))
    expect(out).toEqual({ ok: false, problems: ['link: not-a-link'] })
  })
})

describe('pictures come only from the reader\'s own heap', () => {
  it('a resource the reader does not hold shows as words naming it, and is listed', async () => {
    const out = renderTemplate(await parsed(THANKS), FILL, deps('unknown', { resolveResource: () => null }))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.html).toContain(`<em>[picture ${sigOf('c').slice(0, 12)}… is not shown here]</em>`)
    expect(out.html).not.toContain('<img')
    expect(out.blocked).toEqual([
      { kind: 'resource', sig: sigOf('c'), why: 'not-held' },
      { kind: 'resource', sig: sigOf('b'), why: 'not-held' },
    ])
  })

  it('an SVG is never inlined, whatever it is labelled', async () => {
    const template = await parsed(THANKS)
    for (const type of ['image/svg+xml', 'image/png']) {
      const out = renderTemplate(template, FILL, deps('admitted', { resolveResource: heap({ [sigOf('c')]: { type, bytes: SVG } }) }))
      expect(out.ok).toBe(true)
      if (!out.ok) continue
      expect(out.html).not.toContain('<img')
      expect(out.html).not.toContain('svg')
      expect(out.blocked).toContainEqual({ kind: 'resource', sig: sigOf('c'), why: 'not-a-picture' })
    }
  })

  it('a picture too large is not inlined', async () => {
    const big = new Uint8Array(MAIL_TEMPLATE_LIMITS.image + 1)
    big.set(PNG)
    const out = renderTemplate(await parsed(THANKS), FILL, deps('unknown', { resolveResource: heap({ [sigOf('c')]: { type: 'image/png', bytes: big } }) }))
    expect(out.ok && out.blocked).toContainEqual({ kind: 'resource', sig: sigOf('c'), why: 'too-large' })
  })

  it('a resolver that throws is a resource not held', async () => {
    const out = renderTemplate(await parsed(THANKS), FILL, deps('unknown', { resolveResource: () => { throw new Error('heap down') } }))
    expect(out.ok && out.blocked).toContainEqual({ kind: 'resource', sig: sigOf('c'), why: 'not-held' })
  })

  it('for the baked copy, pictures point at inline parts the send must carry', async () => {
    const out = renderTemplate(await parsed(THANKS), FILL, deps('unknown', {
      images: 'cid',
      resolveResource: heap({ [sigOf('c')]: { type: 'image/png', bytes: PNG }, [sigOf('b')]: { type: 'image/png', bytes: PNG } }),
    }))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.html).toContain(`<img src="cid:${sigOf('c')}@hypercomb" alt="A picture">`)
    expect(out.images).toEqual([
      { sig: sigOf('c'), type: 'image/png', cid: `${sigOf('c')}@hypercomb` },
      { sig: sigOf('b'), type: 'image/png', cid: `${sigOf('b')}@hypercomb` },
    ])
  })

  it('uses the words it is given for what it could not show', async () => {
    const out = renderTemplate(await parsed(THANKS), FILL, deps('unknown', {
      resolveResource: () => null,
      say: (key, _fallback, params) => `«${key} ${params?.['sig'] ?? params?.['label'] ?? ''}»`,
    }))
    expect(out.ok && out.html).toContain(`«mail.template.picture-missing ${sigOf('c').slice(0, 12)}…»`)
    expect(out.ok && out.text).toContain('«mail.template.picture logo»')
  })
})

describe('trust changes one bit, and runs nothing', () => {
  it('renders the same for held and unknown, and differs only in live for admitted', async () => {
    const template = await parsed({ ...THANKS, script: sigOf('e') })
    const unknown = renderTemplate(template, FILL, deps('unknown'))
    const held = renderTemplate(template, FILL, deps('held'))
    const admitted = renderTemplate(template, FILL, deps('admitted'))
    expect(held).toEqual(unknown)
    expect(unknown.ok && unknown.live).toBe(false)
    expect(admitted.ok && admitted.live).toBe(true)
    expect({ ...admitted, live: false }).toEqual(unknown)
  })

  it('a declared script is listed as not run, for every reader', async () => {
    const template = await parsed({ ...THANKS, script: sigOf('e') })
    for (const trust of ['admitted', 'held', 'unknown'] as const) {
      const out = renderTemplate(template, FILL, deps(trust))
      expect(out.ok && out.blocked).toContainEqual({ kind: 'script', sig: sigOf('e'), why: 'not-run' })
    }
  })

  it('the gate is asked about this template\'s signature, and a gate that throws is unknown', async () => {
    const template = await parsed(THANKS)
    const asked: string[] = []
    renderTemplate(template, FILL, deps('unknown', { trust: sig => { asked.push(sig); return 'admitted' } }))
    expect(asked).toEqual([template.sig])
    const out = renderTemplate(template, FILL, deps('unknown', { trust: () => { throw new Error('gate down') } }))
    expect(out.ok && out.live).toBe(false)
  })

  it('a template built by hand is checked the first time it renders', async () => {
    const forged = { ...(await parsed(THANKS)), html: '<p>{{name}}</p><script>alert(1)</script>' } as MailTemplate
    expect(renderTemplate(forged, FILL, deps('admitted'))).toEqual({ ok: false, problems: ['template: unreadable'] })
  })
})

describe('the part a message carries', () => {
  const CRLF = '\r\n'
  const b64 = (text: string): string => btoa(String.fromCharCode(...enc.encode(text))).replace(/(.{76})/g, `$1${CRLF}`)
  const message = (parts: { type: string; filename?: string; body: string }[]): Uint8Array => {
    const lines = [
      'From: Ana <ana@example.org>', 'To: jaime@hypercomb.com', 'Subject: Thanks, Ana',
      `${MAIL_TEMPLATE_HEADER}: placeholder`, 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="b1"', '',
      '--b1', 'Content-Type: multipart/alternative; boundary="b2"', '',
      '--b2', 'Content-Type: text/plain; charset=utf-8', '', 'Hello Ana', '',
      '--b2', 'Content-Type: text/html; charset=utf-8', '', '<p>Hello Ana</p>', '',
      '--b2--', '',
    ]
    for (const part of parts) {
      lines.push('--b1', `Content-Type: ${part.type}`, 'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment${part.filename ? `; filename="${part.filename}"` : ''}`, '', b64(part.body), '')
    }
    lines.push('--b1--', '')
    return Uint8Array.from(lines.join(CRLF), c => c.charCodeAt(0) & 0xff)
  }

  it('round-trips through a real multipart message read by mime.ts', async () => {
    const template = await parsed(THANKS)
    const fill = fillOf(template, FILL)
    const part = mailPart(template.sig, fill)
    expect(part).not.toBeNull()
    if (!part) return
    expect(part.type).toBe(MAIL_TEMPLATE_PART_TYPE)
    expect(part.header).toEqual({ name: 'X-Hypercomb-Template', value: template.sig })

    const raw = message([{ type: 'application/pdf', filename: 'menu.pdf', body: '%PDF-1.4' }, { type: part.type, filename: part.filename, body: part.body }])
    const mail = parseMail(raw)
    expect(mail.text).toBe('Hello Ana')
    expect(mail.attachments.map(a => a.type)).toEqual(['application/pdf', MAIL_TEMPLATE_PART_TYPE])

    const read = readMailPart(mail, index => attachmentBytes(raw, index))
    expect(read).toEqual({ templateSig: template.sig, fill: { ...fill } })
    if (!read) return
    // The reader trusts the part no further than its shape: the fill is checked against its own copy.
    const out = renderTemplate(template, read.fill, deps('held'))
    expect(out.ok && out.subject).toBe('Thanks, Ana')
  })

  it('reads a kept Sent copy the same way', async () => {
    const template = await parsed(THANKS)
    const part = mailPart(template.sig, fillOf(template, FILL))
    if (!part) throw new Error('no part')
    const sent = { attachments: [{ filename: part.filename, type: part.type, content: btoa(String.fromCharCode(...enc.encode(part.body))) }] }
    const read = readMailPart(sent, index => Uint8Array.from(atob(sent.attachments[index]?.content ?? ''), c => c.charCodeAt(0)))
    expect(read?.templateSig).toBe(template.sig)
  })

  const refusedPart: [string, string][] = [
    ['not JSON', '{nope'],
    ['a later version', '{"mail:fill":2,"template":"SIG","fill":{}}'],
    ['a template that is not a signature', '{"mail:fill":1,"template":"thanks","fill":{}}'],
    ['an extra field', '{"mail:fill":1,"template":"SIG","fill":{},"html":"<script>"}'],
    ['a fill that is not an object', '{"mail:fill":1,"template":"SIG","fill":["a"]}'],
    ['a forbidden key', '{"mail:fill":1,"template":"SIG","fill":{"__proto__":{"polluted":true}}}'],
    ['a repeated key', '{"mail:fill":1,"template":"SIG","template":"SIG","fill":{}}'],
    ['a value that is an object', '{"mail:fill":1,"template":"SIG","fill":{"name":{"toString":"x"}}}'],
    ['a list of objects', '{"mail:fill":1,"template":"SIG","fill":{"items":[{"a":1}]}}'],
    ['a hole name it could not have', '{"mail:fill":1,"template":"SIG","fill":{"Name":"a"}}'],
  ]
  for (const [what, body] of refusedPart) {
    it(`finds nothing in a part with ${what}`, () => {
      const json = body.replace(/SIG/g, sigOf('a'))
      const raw = message([{ type: MAIL_TEMPLATE_PART_TYPE, body: json }])
      expect(readMailPart(parseMail(raw), index => attachmentBytes(raw, index))).toBeNull()
      expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
    })
  }

  it('finds nothing when there is no part, or two', async () => {
    const template = await parsed(THANKS)
    const part = mailPart(template.sig, fillOf(template, FILL))
    if (!part) throw new Error('no part')
    const none = message([{ type: 'application/pdf', body: '%PDF' }])
    expect(readMailPart(parseMail(none), index => attachmentBytes(none, index))).toBeNull()
    const two = message([{ type: part.type, body: part.body }, { type: part.type, body: part.body }])
    expect(readMailPart(parseMail(two), index => attachmentBytes(two, index))).toBeNull()
  })

  it('does not read a part larger than its cap, and survives an accessor that throws', () => {
    const big = { attachments: [{ type: MAIL_TEMPLATE_PART_TYPE, size: MAIL_TEMPLATE_LIMITS.partBytes + 1 }] }
    let asked = false
    expect(readMailPart(big, () => { asked = true; return new Uint8Array(0) })).toBeNull()
    expect(asked).toBe(false)
    expect(readMailPart({ attachments: [{ type: MAIL_TEMPLATE_PART_TYPE }] }, () => { throw new Error('gone') })).toBeNull()
  })

  it('makes no part for a signature that is not one, or a fill that is not an object', () => {
    expect(mailPart('thanks', {})).toBeNull()
    expect(mailPart(sigOf('A'), {})).toBeNull()
    expect(mailPart(sigOf('a'), ['x'] as unknown as MailFill)).toBeNull()
  })
})
