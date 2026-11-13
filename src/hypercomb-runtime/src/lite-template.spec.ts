// lite-template.spec.ts — the same DOM an Angular template builds, kept
// current the way zoneless OnPush change detection keeps it, without Angular.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { signal, effect } from './lite-signals'
import { attr, classMap, cls, each, el, eventFullKey, html, match, mount, on, prop, ref, render, sanitizeUrl, str, style, text, trustHtml, txt, when, type ElementRefLike } from './lite-template'

// A refresh is a macrotask (Angular's setTimeout / requestAnimationFrame race): wait a few out.
const tick = async (): Promise<void> => { for (let i = 0; i < 3; i++) await new Promise<void>(r => setTimeout(r, 0)) }
/** The host's markup without the comment marks (Angular leaves its own; the shape is what is compared). */
const markup = (host: Element): string => host.innerHTML.replace(/<!---->/g, '')

let host: HTMLElement
afterEach(() => host?.remove())
const mountHost = (): HTMLElement => { host = document.createElement('hc-test'); document.body.appendChild(host); return host }

describe('building', () => {
  it('builds the elements once, after construction, wearing the scope attribute; the host wears the host attribute', async () => {
    const h = mountHost()
    render(h, [el('aside', { class: 'chat-panel' }, el('header', null, text('Chat')))], { scope: 'hc-chat' })
    expect(h.children).toHaveLength(0)             // deferred, as Angular's first change detection
    await tick()
    expect(h.hasAttribute('_nghost-hc-chat')).toBe(true)
    expect(markup(h)).toBe('<aside _ngcontent-hc-chat="" class="chat-panel"><header _ngcontent-hc-chat="">Chat</header></aside>')
  })

  it('interpolates, printing null and undefined as nothing', async () => {
    const h = mountHost()
    const name = signal<string | null>('Ada')
    render(h, [el('span', null, txt(() => name()))], { scope: 's' })
    await tick()
    expect(h.textContent).toBe('Ada')
    name.set(null)
    await tick()
    expect(h.textContent).toBe('')
    expect(str(undefined)).toBe('')
    expect(str(0)).toBe('0')
  })

  it('builds svg children in the svg namespace', async () => {
    const h = mountHost()
    render(h, [el('svg', { viewBox: '0 0 1 1' }, el('path', { d: 'M0' }))], { scope: 's' })
    await tick()
    expect(h.querySelector('path')!.namespaceURI).toBe('http://www.w3.org/2000/svg')
  })
})

describe('bindings, by Angular\'s rules', () => {
  it('[prop] uses Angular\'s property names and sanitises src and href', async () => {
    const h = mountHost()
    const link = signal('javascript:alert(1)')
    render(h, [el('a', null, prop('href', () => link()), prop('tabindex', () => 2), prop('title', () => 'T'))], { scope: 's' })
    await tick()
    const a = h.querySelector('a')!
    expect(a.getAttribute('href')).toBe('unsafe:javascript:alert(1)')
    expect(a.tabIndex).toBe(2)
    expect(a.title).toBe('T')
    link.set('https://hypercomb.com/')
    await tick()
    expect(a.getAttribute('href')).toBe('https://hypercomb.com/')
    expect(sanitizeUrl('data:image/png;base64,AA')).toBe('data:image/png;base64,AA')
    expect(sanitizeUrl('blob:https://x/y')).toBe('blob:https://x/y')
  })

  it('[attr.x] and [style.x] remove on null; [style.x.px] adds the unit; custom properties set', async () => {
    const h = mountHost()
    const label = signal<string | null>('Close')
    const top = signal<number | null>(12)
    render(h, [el('div', null,
      attr('aria-label', () => label()),
      style('top', () => top(), 'px'),
      style('--chat-route-side-w', () => '320px'),
    )], { scope: 's' })
    await tick()
    const div = h.querySelector('div')!
    expect(div.getAttribute('aria-label')).toBe('Close')
    expect(div.style.top).toBe('12px')
    expect(div.style.getPropertyValue('--chat-route-side-w')).toBe('320px')
    label.set(null); top.set(null)
    await tick()
    expect(div.hasAttribute('aria-label')).toBe(false)
    expect(div.style.top).toBe('')
  })

  it('[class.x] toggles; [class] adds and removes only its own classes', async () => {
    const h = mountHost()
    const on1 = signal(true)
    const kinds = signal('a b')
    render(h, [el('div', { class: 'static' }, cls('lit', () => on1()), classMap(() => kinds()))], { scope: 's' })
    await tick()
    const div = h.querySelector('div')!
    expect([...div.classList].sort()).toEqual(['a', 'b', 'lit', 'static'])
    kinds.set('b c'); on1.set(false)
    await tick()
    expect([...div.classList].sort()).toEqual(['b', 'c', 'static'])
  })

  it('[innerHTML] re-sets only when the trusted box is a new one (Angular compares SafeHtml by identity)', async () => {
    const h = mountHost()
    const box = signal(trustHtml('<b>hi</b>'))
    render(h, [el('div', null, html(() => box()))], { scope: 's' })
    await tick()
    const div = h.querySelector('div')!
    expect(div.innerHTML).toBe('<b>hi</b>')
    div.querySelector('b')!.setAttribute('data-kept', '1')
    box.set(box())                                   // same box: untouched
    await tick()
    expect(div.querySelector('b')!.getAttribute('data-kept')).toBe('1')
    box.set(trustHtml('<b>hi</b>'))                  // a new box: re-set
    await tick()
    expect(div.querySelector('b')!.hasAttribute('data-kept')).toBe(false)
  })
})

describe('events', () => {
  it('(keydown.enter) fires only for Enter with no modifier held', async () => {
    const h = mountHost()
    const send = vi.fn()
    render(h, [el('textarea', null, on('keydown', send, { key: 'enter' }))], { scope: 's' })
    await tick()
    const area = h.querySelector('textarea')!
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }))
    expect(send).not.toHaveBeenCalled()
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(send).toHaveBeenCalledOnce()
    expect(eventFullKey(new KeyboardEvent('keydown', { key: 'Escape', ctrlKey: true }))).toBe('control.escape')
    expect(eventFullKey(new KeyboardEvent('keydown', { key: ' ' }))).toBe('space')
  })

  it('a handler returning false prevents the default; the view refreshes after it', async () => {
    const h = mountHost()
    let count = 0
    render(h, [el('button', null, on('click', () => { count++; return false }), txt(() => count))], { scope: 's' })
    await tick()
    const button = h.querySelector('button')!
    const click = new MouseEvent('click', { cancelable: true })
    button.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    await tick()
    expect(button.textContent).toBe('1')            // a plain field, no signal: the event refreshed it
  })
})

describe('@if', () => {
  it('keeps the same view while the same branch holds, and reads the alias fresh', async () => {
    const h = mountHost()
    const url = signal<string | null>('a.png')
    render(h, [when([[() => url(), (u: () => string) => [el('img', null, prop('alt', () => u()))]]], () => [el('i', null, text('none'))])], { scope: 's' })
    await tick()
    const img = h.querySelector('img')!
    expect(img.alt).toBe('a.png')
    url.set('b.png')
    await tick()
    expect(h.querySelector('img')).toBe(img)        // same node
    expect(img.alt).toBe('b.png')
    url.set(null)
    await tick()
    expect(h.querySelector('img')).toBeNull()
    expect(h.querySelector('i')!.textContent).toBe('none')
  })

  it('@switch picks the matching case', async () => {
    const h = mountHost()
    const kind = signal('run')
    render(h, [match(() => kind(), { run: () => [text('R')], wait: () => [text('W')] })], { scope: 's' })
    await tick()
    expect(h.textContent).toBe('R')
    kind.set('wait')
    await tick()
    expect(h.textContent).toBe('W')
    kind.set('other')
    await tick()
    expect(h.textContent).toBe('')
  })
})

describe('@for', () => {
  type Item = { id: string; label: string }
  const rows = (h: Element): string[] => [...h.querySelectorAll('li')].map(li => li.textContent ?? '')

  it('keeps each row\'s nodes while its key lives, and moves rows rather than rebuilding them', async () => {
    const h = mountHost()
    const list = signal<Item[]>([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }])
    render(h, [el('ul', null, each(() => list(), item => item.id, item => [el('li', null, txt(() => item().label))]))], { scope: 's' })
    await tick()
    const [a, b, c] = [...h.querySelectorAll('li')]
    list.set([{ id: 'c', label: 'C' }, { id: 'a', label: 'A!' }, { id: 'b', label: 'B' }])
    await tick()
    expect(rows(h)).toEqual(['C', 'A!', 'B'])
    const after = [...h.querySelectorAll('li')]
    expect(after[0]).toBe(c)
    expect(after[1]).toBe(a)
    expect(after[2]).toBe(b)
  })

  it('moves only the row that moved, as Angular does — focus elsewhere stays', async () => {
    const h = mountHost()
    const list = signal(['A', 'B', 'C', 'D', 'E'])
    render(h, [each(() => list(), x => x, x => [el('button', null, txt(() => x()))])], { scope: 's' })
    await tick()
    const buttons = [...h.querySelectorAll('button')]
    const moved: string[] = []
    const observer = new MutationObserver(records => { for (const r of records) for (const n of r.addedNodes) if ((n as Element).tagName === 'BUTTON') moved.push((n as Element).textContent ?? '') })
    observer.observe(h, { childList: true })
    buttons[1]!.focus()                               // B
    list.set(['E', 'A', 'B', 'C', 'D'])               // a reply bumps E to the top
    await tick()
    observer.disconnect()
    expect([...h.querySelectorAll('button')].map(b => b.textContent)).toEqual(['E', 'A', 'B', 'C', 'D'])
    expect(moved).toEqual(['E'])
    expect(document.activeElement).toBe(buttons[1])
  })

  it('a focused row that stays in place is not moved, so it keeps focus', async () => {
    const h = mountHost()
    const list = signal(['a', 'b', 'c'])
    render(h, [each(() => list(), x => x, x => [el('input', null, prop('value', () => x()))])], { scope: 's' })
    await tick()
    const first = h.querySelector('input')!
    first.focus()
    list.set(['a', 'c'])                              // b removed; a and c stay in order
    await tick()
    expect(document.activeElement).toBe(first)
  })

  it('shows @empty when the list is empty, and gives way when it fills', async () => {
    const h = mountHost()
    const list = signal<string[]>([])
    render(h, [each(() => list(), x => x, x => [el('b', null, txt(() => x()))], () => [el('i', null, text('nothing'))])], { scope: 's' })
    await tick()
    expect(h.querySelector('i')!.textContent).toBe('nothing')
    list.set(['x'])
    await tick()
    expect(h.querySelector('i')).toBeNull()
    expect(h.querySelector('b')!.textContent).toBe('x')
  })

  it('pairs duplicate keys first-come and gives each row its index', async () => {
    const h = mountHost()
    const list = signal(['v', 'v', 'w'])
    render(h, [each(() => list(), x => x, (x, i) => [el('b', null, txt(() => `${i()}:${x()}`))])], { scope: 's' })
    await tick()
    expect([...h.querySelectorAll('b')].map(b => b.textContent)).toEqual(['0:v', '1:v', '2:w'])
  })
})

describe('references and mounts', () => {
  it('a view query sees the element once built, and nothing once its region is gone', async () => {
    const h = mountHost()
    const shown = signal(true)
    const input = signal<ElementRefLike<HTMLTextAreaElement> | undefined>(undefined)
    const seen: (string | undefined)[] = []
    effect(() => { seen.push(input()?.nativeElement.tagName) })
    render(h, [when([[() => shown(), () => [el('textarea', null, ref(input))]]])], { scope: 's' })
    await tick()
    expect(input()?.nativeElement.tagName).toBe('TEXTAREA')
    shown.set(false)
    await tick()
    expect(input()).toBeUndefined()
    expect(seen).toEqual([undefined, 'TEXTAREA', undefined])
  })

  it('mount runs once the element is in the document, and its detach when the region goes', async () => {
    const h = mountHost()
    const shown = signal(true)
    const log: string[] = []
    render(h, [when([[() => shown(), () => [el('aside', null, el('header', null), mount(node => {
      log.push(`attach ${node.isConnected} ${node.querySelector('header') ? 'built' : 'empty'}`)
      return () => log.push('detach')
    }))]]])], { scope: 's' })
    await tick()
    shown.set(false)
    await tick()
    expect(log).toEqual(['attach true built', 'detach'])
  })

  it('dispose removes everything and stops refreshing', async () => {
    const h = mountHost()
    const name = signal('a')
    const view = render(h, [el('p', null, txt(() => name()))], { scope: 's' })
    await tick()
    view.dispose()
    expect(h.childNodes).toHaveLength(0)
    name.set('b')
    await tick()
    expect(h.childNodes).toHaveLength(0)
  })
})
