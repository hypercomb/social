// hypercomb-runtime/src/confirm-dialog.spec.ts — the consent dialog with no Angular.
//
// Ported from the Angular component's spec (shared/ui/confirm-dialog, gone):
// every request is asked in its turn and every caller gets an answer. The
// dialog held ONE request once: a second `confirm:request` replaced the first,
// and the first caller's promise never settled (2026-10-23). Then what the
// Angular template drew, drawn here by hand: the words, the warning and hint
// only when asked, the opt-out box, the danger look, Escape and the backdrop.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const services = new Map<string, unknown>()
const ready = new Map<string, ((v: unknown) => void)[]>()
;(window as unknown as { ioc: unknown }).ioc = {
  get: (k: string) => services.get(k),
  register: (k: string, v: unknown) => { services.set(k, v); for (const cb of ready.get(k) ?? []) cb(v) },
  whenReady: (k: string, cb: (v: unknown) => void) => {
    if (services.has(k)) cb(services.get(k))
    else ready.set(k, [...(ready.get(k) ?? []), cb])
  },
}

const { EffectBus, requestConfirm, requestConfirmDetailed, I18N_IOC_KEY } = await import('@hypercomb/core')
const { ConfirmDesk, ConfirmDialogElement, CONFIRM_DIALOG_SURFACE, mountConfirmDialog } = await import('./confirm-dialog.js')

/** A catalog that answers some keys and returns the rest as the key — the
 *  shell's provider does the same — and says `change` like it does. */
class FakeI18n extends EventTarget {
  words: Record<string, string> = {
    'confirm.cancel': 'Cancel', 'confirm.delete': 'Delete', 'publish.title': 'Publish',
    'publish.ask': 'Publish {name}?',
  }
  t(key: string, params?: Record<string, string | number>): string {
    const word = this.words[key]
    return word === undefined ? key : word.replace(/\{(\w+)\}/g, (_, n: string) => String(params?.[n] ?? ''))
  }
}

const settled = async <T>(p: Promise<T>): Promise<T | 'pending'> =>
  Promise.race([p, new Promise<'pending'>(resolve => setTimeout(() => resolve('pending'), 20))])

if (!customElements.get(CONFIRM_DIALOG_SURFACE)) customElements.define(CONFIRM_DIALOG_SURFACE, ConfirmDialogElement)

let desk: InstanceType<typeof ConfirmDesk>
let i18n: FakeI18n
let now = 1_000

beforeEach(() => {
  // A fresh bus: last-value replay would hand a new desk the previous test's
  // request. On a page there is one desk, started once.
  EffectBus.clear()
  vi.restoreAllMocks()
  now = 1_000
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  i18n = new FakeI18n()
  services.set(I18N_IOC_KEY, i18n)
  desk = new ConfirmDesk()
  desk.start()
  document.body.replaceChildren()
})

const mount = (): HTMLElement => {
  ConfirmDialogElement.desk = desk
  const el = document.createElement(CONFIRM_DIALOG_SURFACE)
  document.body.append(el)
  return el
}
const $ = <T extends Element = HTMLElement>(el: Element, sel: string): T => el.querySelector(sel) as T

describe('the consent desk', () => {
  it('asks a second request after the first is answered — neither caller is left waiting', async () => {
    const first = requestConfirm({ title: 'a', message: 'first' })
    const second = requestConfirm({ title: 'b', message: 'second' })
    expect(desk.request?.message).toBe('first')

    desk.confirm()
    expect(await settled(first)).toBe(true)
    expect(desk.request?.message).toBe('second')
    expect(await settled(second)).toBe('pending')

    // The second click of a double-click lands on a question nobody read yet.
    now += 120
    desk.confirm()
    expect(desk.request?.message).toBe('second')
    expect(await settled(second)).toBe('pending')

    now += ConfirmDesk.ARM_MS
    desk.dismiss()
    expect(await settled(second)).toBe(false)
    expect(desk.open).toBe(false)
  })

  it('a replayed request it already showed is not asked twice', async () => {
    const asked = requestConfirm({ title: 'c', message: 'once' })
    const shown = desk.request!
    EffectBus.emit('confirm:request', shown)          // a late replay of the same request
    desk.confirm()
    expect(await settled(asked)).toBe(true)
    expect(desk.open).toBe(false)
    EffectBus.emit('confirm:request', shown)          // and once more, after it was answered
    expect(desk.open).toBe(false)
  })

  it('the opt-out box counts only on a confirm, and starts clear for the next question', async () => {
    const muted = requestConfirmDetailed({ title: 'a', message: 'm', optOut: 'stop asking' })
    desk.optedOut = true
    desk.confirm()
    expect(await settled(muted)).toEqual(expect.objectContaining({ confirmed: true, optedOut: true }))
    expect(desk.optedOut).toBe(false)

    const cancelled = requestConfirmDetailed({ title: 'a', message: 'm', optOut: 'stop asking' })
    desk.optedOut = true
    desk.dismiss()
    const answer = await settled(cancelled)
    expect(answer).toEqual(expect.objectContaining({ confirmed: false }))
    expect((answer as { optedOut?: boolean }).optedOut).toBeUndefined()

    // A question with no box never says it was muted, ticked or not.
    const plain = requestConfirmDetailed({ title: 'a', message: 'm' })
    desk.optedOut = true
    desk.confirm()
    expect((await settled(plain) as { optedOut?: boolean }).optedOut).toBeUndefined()
  })

  it('Escape answers no, and only while a question is open', async () => {
    EffectBus.emit('keymap:invoke', { cmd: 'global.escape' })
    expect(desk.open).toBe(false)
    const asked = requestConfirm({ title: 'a', message: 'm' })
    EffectBus.emit('keymap:invoke', { cmd: 'global.other' })
    expect(desk.open).toBe(true)
    EffectBus.emit('keymap:invoke', { cmd: 'global.escape' })
    expect(await settled(asked)).toBe(false)
  })

  it('stopped, it hears nothing more', () => {
    desk.stop()
    void requestConfirm({ title: 'a', message: 'm' })
    expect(desk.open).toBe(false)
  })
})

describe('the consent dialog element', () => {
  it('draws nothing until asked, then the question in the words of the catalog', () => {
    const el = mount()
    expect(el.childElementCount).toBe(0)
    void requestConfirm({ title: 'publish.title', message: 'publish.ask', messageParams: { name: 'card' } })
    const panel = $(el, '.confirm-panel')
    expect(panel.getAttribute('role')).toBe('alertdialog')
    expect(panel.getAttribute('aria-label')).toBe('Publish')
    expect($(el, '.confirm-header h3').textContent).toBe('Publish')
    expect($(el, '.confirm-message').textContent).toBe('Publish card?')
    // Labels default as the template's did, and the danger look is the default.
    expect($(el, '.confirm-btn.cancel').textContent).toBe('Cancel')
    const ok = el.querySelectorAll('.confirm-btn')[1] as HTMLElement
    expect(ok.textContent).toBe('Delete')
    expect(ok.classList.contains('danger')).toBe(true)
    // No warning, hint or box unless the question carries one.
    expect($(el, '.confirm-warning').hidden).toBe(true)
    expect($(el, '.confirm-hint').hidden).toBe(true)
    expect($(el, '.confirm-optout').hidden).toBe(true)
  })

  it('draws the warning, hint, box and own labels it is given; danger: false is quiet', () => {
    const el = mount()
    void requestConfirm({
      title: 't', message: 'm', warning: 'w {n}', warningParams: { n: 2 }, hint: 'h', optOut: 'o',
      confirmLabel: 'yes', cancelLabel: 'no', danger: false,
    })
    expect($(el, '.confirm-warning').hidden).toBe(false)
    expect($(el, '.confirm-warning').textContent).toBe('w {n}')   // an unknown key reads as itself
    expect($(el, '.confirm-hint').textContent).toBe('h')
    expect($(el, '.confirm-optout').hidden).toBe(false)
    expect($(el, '.confirm-optout span').textContent).toBe('o')
    const ok = el.querySelectorAll('.confirm-btn')[1] as HTMLElement
    expect(ok.textContent).toBe('yes')
    expect(ok.classList.contains('danger')).toBe(false)
    expect($(el, '.confirm-btn.cancel').textContent).toBe('no')
  })

  it('answers by its buttons, the close mark and the backdrop', async () => {
    const el = mount()
    const yes = requestConfirm({ title: 't', message: 'm' })
    ;(el.querySelectorAll('.confirm-btn')[1] as HTMLElement).click()
    expect(await settled(yes)).toBe(true)
    expect(el.childElementCount).toBe(0)

    for (const sel of ['.confirm-btn.cancel', '.confirm-close', '.confirm-backdrop']) {
      const no = requestConfirm({ title: 't', message: sel })
      $(el, sel).click()
      expect(await settled(no)).toBe(false)
    }
  })

  it('the box is the desk\'s, and a ticked box rides the confirm', async () => {
    const el = mount()
    const asked = requestConfirmDetailed({ title: 't', message: 'm', optOut: 'o' })
    const box = $<HTMLInputElement>(el, '.confirm-optout input')
    expect(box.checked).toBe(false)
    box.checked = true
    box.dispatchEvent(new Event('change'))
    expect(desk.optedOut).toBe(true)
    ;(el.querySelectorAll('.confirm-btn')[1] as HTMLElement).click()
    expect(await settled(asked)).toEqual(expect.objectContaining({ confirmed: true, optedOut: true }))
  })

  it('a question moved up from the queue lands in the same panel', async () => {
    const el = mount()
    void requestConfirm({ title: 't', message: 'first' })
    void requestConfirm({ title: 't', message: 'second' })
    const panel = $(el, '.confirm-panel')
    desk.confirm()
    expect($(el, '.confirm-panel')).toBe(panel)
    expect($(el, '.confirm-message').textContent).toBe('second')
  })

  it('new words redraw the open question', () => {
    const el = mount()
    void requestConfirm({ title: 'publish.title', message: 'm' })
    i18n.words['publish.title'] = 'Publicar'
    i18n.dispatchEvent(new CustomEvent('change'))
    expect($(el, '.confirm-header h3').textContent).toBe('Publicar')
  })

  it('a question asked before the element was mounted is drawn when it is', () => {
    void requestConfirm({ title: 't', message: 'early' })
    const el = mount()
    expect($(el, '.confirm-message').textContent).toBe('early')
  })

  it('carries its own stylesheet once, every rule under its tag', () => {
    mount(); mount()
    const sheets = document.querySelectorAll('#hc-confirm-dialog-style')
    expect(sheets.length).toBe(1)
    const css = sheets[0]!.textContent ?? ''
    for (const line of css.split('\n').filter(l => /^\s*[^@\s}][^{]*\{/.test(l))) {
      if (/^\s*(from|to)\b/.test(line)) continue
      expect(line).toContain(CONFIRM_DIALOG_SURFACE)
    }
  })
})

describe('the host mounts it', () => {
  it('puts the surface in the registry once, at the order the Angular dialog stood', async () => {
    const added: { name: string; element?: string; order?: number }[] = []
    const registry = { add: (x: { name: string }) => { added.push(x) }, all: () => added }
    services.set('@hypercomb.social/ShellSurfaceRegistry', registry)
    mountConfirmDialog()
    mountConfirmDialog()
    expect(added).toEqual([expect.objectContaining({ name: CONFIRM_DIALOG_SURFACE, element: CONFIRM_DIALOG_SURFACE, order: 240 })])
  })

  it('a registry that comes up later still gets it', () => {
    services.delete('@hypercomb.social/ShellSurfaceRegistry')
    const added: { name: string }[] = []
    mountConfirmDialog()
    ;(window as unknown as { ioc: { register: (k: string, v: unknown) => void } }).ioc
      .register('@hypercomb.social/ShellSurfaceRegistry', { add: (x: { name: string }) => { added.push(x) }, all: () => added })
    expect(added).toHaveLength(1)
  })

  it('a second copy of the module finds the first desk instead of starting its own', async () => {
    EffectBus.clear()
    const defined = customElements.get(CONFIRM_DIALOG_SURFACE) as unknown as { desk: unknown }
    defined.desk = null
    mountConfirmDialog()
    const first = defined.desk
    expect(first).not.toBeNull()
    vi.resetModules()
    const copy = await import('./confirm-dialog.js')       // runs its own mount on import
    copy.mountConfirmDialog()
    expect(defined.desk).toBe(first)
    // One desk listens: a question is asked once, and answered once.
    const asked = requestConfirm({ title: 't', message: 'one desk' })
    ;(first as InstanceType<typeof ConfirmDesk>).confirm()
    expect(await settled(asked)).toBe(true)
  })
})
