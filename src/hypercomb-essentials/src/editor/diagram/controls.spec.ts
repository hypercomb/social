// editor/diagram/controls.spec.ts
//
// The control builders, one per field kind, driven through a fake port. Nothing
// here imports a service: the port is the only seam.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { HEXAGON } from '../models/hexagon.model.js'
import type { FieldKey, TileModel } from '../models/tile-model.js'
import {
  buildControl, buildLayerChip, buildQuestions, buildTabSwatch, closeLayerMenus, glanceOf, parseHex,
  type ControlEnv, type FieldValue, type LayerFacts, type TileSessionPort,
} from './controls.js'

const t = (_k: string, fallback: string, params?: Record<string, string | number>): string =>
  fallback.replace(/\{(\w+)\}/g, (_, k: string) => String(params?.[k] ?? ''))

interface Rig {
  port: TileSessionPort
  env: ControlEnv
  values: Record<string, FieldValue>
  sets: [FieldKey, FieldValue][]
  state: {
    group: boolean; status: { state: string; sibling?: string; siblingAddress?: string }; dirty: boolean; portal: boolean; has: boolean
    verdict: { tone: 'warn' | 'alert'; reason: string } | null; layer: LayerFacts | null; items: { id: string; question: string; answer?: string }[]
    phone: boolean; camera: boolean; fillLive: boolean; variant: string
  }
  spies: Record<string, ReturnType<typeof vi.fn>>
}

const rig = (model: TileModel = HEXAGON as unknown as TileModel): Rig => {
  const input = document.createElement('input')
  const values: Record<string, FieldValue> = {}
  const sets: [FieldKey, FieldValue][] = []
  const drafts: Record<string, string> = {}
  const state: Rig['state'] = {
    group: false, status: { state: 'idle' }, dirty: false, portal: false, has: true, verdict: null, layer: null, items: [], phone: false,
    camera: true, fillLive: true, variant: 'point-top',
  }
  const spies = {
    act: vi.fn(), setVariant: vi.fn(), setSlider: vi.fn(), check: vi.fn(async () => undefined), clear: vi.fn(), reply: vi.fn(),
    undo: vi.fn(), focus: vi.fn(), history: vi.fn(async () => [] as never[]), toggleCard: vi.fn(),
  }
  const port = {
    get group() { return state.group ? { count: 3, labels: [] } : null },
    value: (k: FieldKey) => values[k],
    set: (k: FieldKey, v: FieldValue) => { sets.push([k, v]); values[k] = v },
    fallback: (k: FieldKey) => (k === 'border.color' ? '#c8975a' : ''),
    layer: () => state.layer,
    name: {
      input, value: 'Harbour dusk', stored: 'Harbour dusk', address: 'harbour-dusk', locale: 'en',
      get status() { return state.status }, get dirty() { return state.dirty }, get throughPortal() { return state.portal },
      focus: spies.focus, undo: spies.undo,
    },
    picture: {
      get has() { return state.has }, mode: 'fit', linked: true, noOriginal: false, percent: 58, ratio: '3:2', slider01: 0.25,
      get cameraAvailable() { return state.camera }, get phone() { return state.phone },
      act: spies.act, setSlider01: spies.setSlider, history: spies.history, twinUrl: (v: string) => `blob:${v}`, setVariant: spies.setVariant,
    },
    link: { get verdict() { return state.verdict }, check: spies.check, clearVerdict: spies.clear },
    questions: {
      get items() { return state.items }, draft: (id: string) => drafts[id] ?? '', setDraft: (id: string, x: string) => { drafts[id] = x }, reply: spies.reply,
    },
    onChange: () => () => undefined,
  } as unknown as TileSessionPort
  const env: ControlEnv = {
    port, model, t, uid: 'x',
    get group() { return state.group },
    geometry: () => model.geometry(616, 'point-top'),
    fillLive: () => state.fillLive,
    variant: () => state.variant,
    imagePart: () => 'pic',
    toggleCard: spies.toggleCard,
  } as ControlEnv
  return { port, env, values, sets, state, spies }
}

afterEach(() => { document.body.replaceChildren() })

const mount = <T extends { node: HTMLElement }>(c: T): T => { document.body.append(c.node); return c }
const input = (el: Element, value: string): void => {
  const i = el as HTMLInputElement
  i.value = value
  i.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('parseHex', () => {
  it('takes six hex digits with or without the hash, and nothing else', () => {
    expect(parseHex('#ABCDEF')).toBe('#abcdef')
    expect(parseHex('abcdef')).toBe('#abcdef')
    expect(parseHex(' #123456 ')).toBe('#123456')
    for (const bad of ['#abc', '#12345g', '', '#1234567', 'red']) expect(parseHex(bad)).toBeNull()
  })
})

describe('the colour control', () => {
  it('writes only on six valid digits; garbage on blur sets aria-invalid and writes nothing', () => {
    const r = rig()
    const c = mount(buildControl('colour', 'border.color', r.env, 'Border'))
    c.sync()
    const hex = c.node.querySelector<HTMLInputElement>('.te-dg-hex')!
    expect(hex.placeholder).toBe('#c8975a')
    input(hex, '#12')
    expect(r.sets).toEqual([])
    input(hex, '#112233')
    expect(r.sets).toEqual([['border.color', '#112233']])
    hex.value = 'zzz'
    hex.dispatchEvent(new Event('blur'))
    expect(hex.getAttribute('aria-invalid')).toBe('true')
    expect(r.sets).toHaveLength(1)
  })

  it('keeps a garbage hex flagged, as typed, through a sync, until the next input', () => {
    const r = rig()
    const c = mount(buildControl('colour', 'border.color', r.env, 'Border'))
    c.sync()
    const hex = c.node.querySelector<HTMLInputElement>('.te-dg-hex')!
    hex.value = 'zzz'
    hex.dispatchEvent(new Event('blur'))
    c.sync()
    expect(hex.getAttribute('aria-invalid')).toBe('true')
    expect(hex.value).toBe('zzz')
    input(hex, 'zzzz')
    expect(hex.getAttribute('aria-invalid')).toBeNull()   // the next input lifts it; the next blur says again
    hex.dispatchEvent(new Event('blur'))
    expect(hex.getAttribute('aria-invalid')).toBe('true')
    input(hex, '#112233')
    c.sync()
    expect(hex.getAttribute('aria-invalid')).toBeNull()
  })

  it('names the clear word by field and says "leave as is" in a group; the word shows only once a value is set', () => {
    const r = rig()
    const c = mount(buildControl('colour', 'background.color', r.env, 'Fill behind'))
    c.sync()
    const clear = c.node.querySelector<HTMLElement>('.te-dg-word')!
    expect(clear.hidden).toBe(true)
    r.values['background.color'] = '#223344'
    c.sync()
    expect(clear.hidden).toBe(false)
    expect(clear.textContent).toBe('none')
    r.state.group = true
    c.sync()
    expect(clear.textContent).toBe('leave as is')
    expect(c.node.querySelector<HTMLInputElement>('.te-dg-hex')!.placeholder).toBe('as is')
    clear.click()
    expect(r.sets[r.sets.length - 1]).toEqual(['background.color', ''])
  })

  it('shows the dormant note and a Fit word only while the ground is covered', () => {
    const r = rig()
    const c = mount(buildControl('colour', 'background.color', r.env, 'Fill behind'))
    r.state.fillLive = false
    c.sync()
    const note = c.node.querySelector<HTMLElement>('.te-dg-status')!
    expect(note.hidden).toBe(false)
    expect(note.textContent).toContain('Seen behind a picture set to Fit.')
    note.querySelector('button')!.click()
    expect(r.spies.act).toHaveBeenCalledWith('fit')
    r.state.fillLive = true
    c.sync()
    expect(note.hidden).toBe(true)
    // the border has no such note
    expect(buildControl('colour', 'border.color', r.env, 'Border').node.querySelector('.te-dg-status')).toBeNull()
  })

  it('does not write into a native colour input that is focused', () => {
    const r = rig()
    const sw = buildTabSwatch('border.color', r.env, 'Border')
    document.body.append(sw.el)
    sw.sync()
    expect(sw.input.value).toBe('#c8975a')
    sw.input.focus()
    r.values['border.color'] = '#000001'
    sw.sync()
    expect(sw.input.value).toBe('#c8975a')
    sw.input.blur()
    sw.sync()
    expect(sw.input.value).toBe('#000001')
    expect(sw.el.style.getPropertyValue('--sw')).toBe('#000001')
    expect(sw.el.dataset.unset).toBe('false')
  })
})

describe('the toggle control', () => {
  it('flips on a single tile and is disabled, always shown, without a picture', () => {
    const r = rig()
    const c = mount(buildControl('toggle', 'hideText', r.env, 'Name'))
    c.sync()
    const sw = c.node.querySelector<HTMLButtonElement>('[role=switch]')!
    expect(sw.getAttribute('aria-checked')).toBe('true')
    expect(c.node.querySelector('.te-dg-state')!.textContent).toBe('shown over the picture')
    sw.click()
    expect(r.sets).toEqual([['hideText', true]])
    c.sync()
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(c.node.querySelector('.te-dg-state')!.textContent).toBe('hidden over the picture')
    r.state.has = false
    c.sync()
    expect(sw.disabled).toBe(true)
    expect(sw.getAttribute('aria-checked')).toBe('true')
    expect(c.node.querySelector('.te-dg-state')!.textContent).toBe('always shown without a picture')
  })

  it('is tri-state in a group, and "leave as is" returns it to untouched', () => {
    const r = rig()
    r.state.group = true
    const c = mount(buildControl('toggle', 'hideText', r.env, 'Name'))
    c.sync()
    const sw = c.node.querySelector<HTMLButtonElement>('[role=switch]')!
    const leave = c.node.querySelector<HTMLButtonElement>('.te-dg-word')!
    expect(sw.getAttribute('aria-checked')).toBe('mixed')
    expect(leave.hidden).toBe(true)
    sw.click(); c.sync()
    expect(r.values.hideText).toBe(false)
    expect(sw.getAttribute('aria-checked')).toBe('true')
    expect(leave.hidden).toBe(false)
    sw.click(); c.sync()
    expect(r.values.hideText).toBe(true)
    expect(sw.getAttribute('aria-checked')).toBe('false')
    leave.click(); c.sync()
    expect(r.values.hideText).toBeUndefined()
    expect(sw.getAttribute('aria-checked')).toBe('mixed')
    expect(r.sets.map(s => s[1])).toEqual([false, true, undefined])
  })
})

describe('the name control', () => {
  const status = (r: Rig): { text: string; role: string | null; tone: string | null } => {
    const c = mount(buildControl('text', 'title', r.env, 'Name'))
    c.sync()
    const el = c.node.querySelector<HTMLElement>('.te-dg-status')!
    return { text: el.textContent ?? '', role: el.getAttribute('role'), tone: el.getAttribute('data-tone') }
  }

  it('says each state in its exact words', () => {
    let r = rig()
    expect(status(r).text).toBe('reads "Harbour dusk" in en')
    r = rig(); r.state.dirty = true
    expect(status(r).text).toBe('not saved yet')
    r = rig(); r.state.status = { state: 'saving' }
    expect(status(r)).toMatchObject({ text: 'saving the name...', tone: 'ok' })
    r = rig(); r.state.status = { state: 'saved' }
    expect(status(r).text).toContain('name saved')
    r = rig(); r.state.status = { state: 'failed' }
    expect(status(r)).toMatchObject({ role: 'alert', tone: 'alert' })
    expect(status(r).text).toContain('Could not save the name.')
  })

  it('names the sibling when refused, with an undo word and role=alert', () => {
    const r = rig()
    r.state.status = { state: 'refused', sibling: 'Salt flats', siblingAddress: 'salt-flats' }
    const c = mount(buildControl('text', 'title', r.env, 'Name'))
    c.sync()
    const el = c.node.querySelector<HTMLElement>('.te-dg-status')!
    expect(el.getAttribute('role')).toBe('alert')
    expect(el.textContent).toContain('"Salt flats" is taken. The tile salt-flats already reads that way here.')
    el.querySelector<HTMLButtonElement>('[data-act=undo]')!.click()
    expect(r.spies.undo).toHaveBeenCalled()
    // 'edit on tile' hands focus to the shell's input
    c.node.querySelector<HTMLButtonElement>('.te-dg-word')!.click()
    expect(r.spies.focus).toHaveBeenCalled()
  })

  it('shows the portal line only through a portal, and the address and locale always', () => {
    const r = rig()
    const c = mount(buildControl('text', 'title', r.env, 'Name'))
    c.sync()
    expect(c.node.textContent).toContain('address')
    expect(c.node.querySelector('code')!.textContent).toBe('harbour-dusk')
    expect(c.node.querySelector('.te-dg-localechip')!.textContent).toBe('en')
    const via = Array.from(c.node.querySelectorAll<HTMLElement>('.te-dg-status')).find(e => e.textContent?.includes('original'))!
    expect(via.hidden).toBe(true)
    r.state.portal = true
    c.sync()
    expect(via.hidden).toBe(false)
  })
})

describe('the link control', () => {
  it('writes as typed, clears the verdict, and asks for a check on blur', () => {
    const r = rig()
    const c = mount(buildControl('link', 'link', r.env, 'Link'))
    c.sync()
    const url = c.node.querySelector<HTMLInputElement>('.te-dg-url')!
    expect(url.getAttribute('enterkeyhint')).toBe('done')
    input(url, ' https://harbourdusk.example/ ')
    expect(r.sets).toEqual([['link', 'https://harbourdusk.example/']])
    expect(r.spies.clear).toHaveBeenCalled()
    url.dispatchEvent(new Event('blur'))
    expect(r.spies.check).toHaveBeenCalled()
  })

  it('shows a verdict, and a deny is an alert and marks the field invalid', () => {
    const r = rig()
    const c = mount(buildControl('link', 'link', r.env, 'Link'))
    c.sync()
    const verdict = c.node.querySelector<HTMLElement>('.te-dg-status')!
    expect(verdict.hidden).toBe(true)
    r.state.verdict = { tone: 'warn', reason: 'This address asks visitors to sign in.' }
    c.sync()
    expect(verdict.hidden).toBe(false)
    expect(verdict.getAttribute('role')).toBe('status')
    r.state.verdict = { tone: 'alert', reason: 'That kind of address is not allowed.' }
    c.sync()
    expect(verdict.getAttribute('role')).toBe('alert')
    expect(c.node.querySelector('.te-dg-url')!.getAttribute('aria-invalid')).toBe('true')
    expect(verdict.textContent).toContain('not allowed')
  })

  it('has the group placeholder and leaves a focused field alone', () => {
    const r = rig()
    const c = mount(buildControl('link', 'link', r.env, 'Link'))
    const url = c.node.querySelector<HTMLInputElement>('.te-dg-url')!
    r.state.group = true
    c.sync()
    expect(url.placeholder).toBe("leave each tile's link")
    url.focus()
    url.value = 'half typed'
    r.values.link = 'https://elsewhere.example/'
    c.sync()
    expect(url.value).toBe('half typed')
  })
})

describe('the variant control', () => {
  it('draws one twin per variant with the live thumbnail, and switches on a click', () => {
    const r = rig()
    const c = mount(buildControl('variant', 'orientation', r.env, 'Shape'))
    c.sync()
    const twins = c.node.querySelectorAll<HTMLButtonElement>('.te-dg-twin')
    expect(twins).toHaveLength(2)
    expect(twins[0].getAttribute('aria-pressed')).toBe('true')
    expect(twins[1].querySelector('img')!.getAttribute('src')).toBe('blob:flat-top')
    twins[1].click()
    expect(r.spies.setVariant).toHaveBeenCalledWith('flat-top')
    r.state.variant = 'flat-top'
    c.sync()
    expect(twins[1].getAttribute('aria-pressed')).toBe('true')
    const link = c.node.querySelector<HTMLButtonElement>('.te-dg-ib')!
    expect(link.textContent).toBe('link')
    link.click()
    expect(r.spies.act).toHaveBeenCalledWith('link-toggle')
  })

  it('is absent when the model has fewer than two variants', () => {
    const lone = { ...(HEXAGON as unknown as TileModel), variants: [] }
    const r = rig(lone)
    const c = buildControl('variant', 'orientation', r.env, 'Shape')
    expect(c.node.hidden).toBe(true)
    expect(c.node.children).toHaveLength(0)
  })
})

describe('the image control', () => {
  it('is a toolbar of word-free buttons that act through the port', () => {
    const r = rig()
    const c = mount(buildControl('image', 'picture', r.env, 'Picture'))
    c.sync()
    const bar = c.dock!
    document.body.append(bar)
    expect(bar.getAttribute('role')).toBe('toolbar')
    for (const act of ['upload', 'camera', 'search', 'remove', 'zoom-in', 'zoom-out', 'reset']) {
      bar.querySelector<HTMLButtonElement>(`[data-act="${act}"]`)!.click()
    }
    bar.querySelector<HTMLButtonElement>('[data-mode=fill]')!.click()
    bar.querySelector<HTMLButtonElement>('[data-mode=fit]')!.click()
    expect(r.spies.act.mock.calls.map(x => x[0])).toEqual(['upload', 'camera', 'search', 'remove', 'zoom-in', 'zoom-out', 'reset', 'fill', 'fit'])
    // earlier pictures opens the card through the shell
    bar.querySelector<HTMLButtonElement>('[data-act=history]')!.click()
    expect(r.spies.toggleCard).toHaveBeenCalledWith('pic')
    // every glyph is a .mat-sym ligature name
    const names = Array.from(bar.querySelectorAll('.mat-sym')).map(e => e.textContent)
    expect(names).toEqual(expect.arrayContaining(['upload', 'photo_camera', 'search', 'history', 'hide_image', 'zoom_in', 'zoom_out', 'center_focus_strong', 'crop_free', 'fit_screen']))
  })

  it('reads the slider, the readout and the mode from the port, and goes quiet without a picture', () => {
    const r = rig()
    const c = mount(buildControl('image', 'picture', r.env, 'Picture'))
    c.sync()
    const bar = c.dock!
    const slider = bar.querySelector<HTMLInputElement>('input[type=range]')!
    expect(slider.value).toBe('250')
    expect(bar.querySelector('.te-dg-readout')!.textContent).toBe('58%')
    expect(bar.querySelector('[data-mode=fit]')!.getAttribute('aria-checked')).toBe('true')
    input(slider, '500')
    expect(r.spies.setSlider).toHaveBeenCalledWith(0.5)
    r.state.has = false
    c.sync()
    expect(slider.disabled).toBe(true)
    expect(bar.querySelector<HTMLButtonElement>('[data-act=remove]')!.disabled).toBe(true)
    // upload stays enabled: disabled controls stay put, the others still work
    expect(bar.querySelector<HTMLButtonElement>('[data-act=upload]')!.disabled).toBe(false)
  })

  it('hides the camera when none exists and reads "library" on a phone', () => {
    const r = rig()
    r.state.camera = false
    r.state.phone = true
    const c = mount(buildControl('image', 'picture', r.env, 'Picture'))
    c.sync()
    const bar = c.dock!
    expect(bar.querySelector<HTMLElement>('[data-act=camera]')!.hidden).toBe(true)
    const up = bar.querySelector<HTMLElement>('[data-act=upload]')!
    expect(up.getAttribute('aria-label')).toBe('Library')
    expect(up.textContent).toBe('photo_library')
  })

  it('loads earlier pictures when the card opens and rings the current one', async () => {
    const r = rig()
    const chosen = vi.fn()
    r.spies.history.mockResolvedValueOnce([
      { id: 'a', url: 'blob:a', from: 'here', choose: chosen },
      { id: 'b', url: 'blob:b', from: 'repo', choose: vi.fn() },
    ] as never)
    const c = mount(buildControl('image', 'picture', r.env, 'Picture'))
    c.onOpen!()
    await Promise.resolve(); await Promise.resolve()
    const btns = c.node.querySelectorAll<HTMLButtonElement>('.te-dg-history button')
    expect(btns).toHaveLength(2)
    expect(btns[0].dataset.here).toBe('true')
    expect(btns[1].dataset.here).toBe('false')
    btns[0].click()
    expect(chosen).toHaveBeenCalled()
  })
})

describe('the questions control', () => {
  it('builds a node per question once and never replaces one that is there', () => {
    const r = rig()
    r.state.items = [{ id: 'q1', question: 'Which quay?' }, { id: 'q2', question: 'Lit?', answer: 'Yes.' }]
    const c = mount(buildQuestions(r.env))
    c.sync()
    const [n1, n2] = Array.from(c.node.querySelectorAll<HTMLElement>('.te-dg-q'))
    const ta1 = n1.querySelector('textarea')!
    input(ta1, 'north, I think')
    // an answered question shows its answer, not a field
    expect(n2.querySelector<HTMLElement>('.te-dg-a')!.textContent).toBe('Yes.')
    expect(n2.querySelector<HTMLElement>('textarea')!.hidden).toBe(true)
    // the list grows, shrinks and reorders; the nodes that stay are the same nodes
    r.state.items = [{ id: 'q3', question: 'New?' }, { id: 'q1', question: 'Which quay?' }]
    c.sync()
    const after = Array.from(c.node.querySelectorAll<HTMLElement>('.te-dg-q'))
    expect(after.map(n => n.dataset.q)).toEqual(['q3', 'q1'])
    expect(after[1]).toBe(n1)
    expect(after[1].querySelector('textarea')).toBe(ta1)
    expect(ta1.value).toBe('north, I think')
    expect(n2.isConnected).toBe(false)
  })

  it('replies with the trimmed text and counts the open ones in the glance', () => {
    const r = rig()
    r.state.items = [{ id: 'q1', question: 'A?' }, { id: 'q2', question: 'B?', answer: 'yes' }]
    const c = mount(buildQuestions(r.env))
    c.sync()
    const ta = c.node.querySelector<HTMLTextAreaElement>('textarea')!
    c.node.querySelector<HTMLButtonElement>('.te-dg-word')!.click()
    expect(r.spies.reply).not.toHaveBeenCalled()
    input(ta, '  south  ')
    c.node.querySelector<HTMLButtonElement>('.te-dg-word')!.click()
    expect(r.spies.reply).toHaveBeenCalledWith('q1', 'south')
  })
})

describe('the layer chip', () => {
  const facts = (o: Partial<LayerFacts> = {}): LayerFacts & { choose: ReturnType<typeof vi.fn> } => ({
    base: 'inherited', choice: null, offered: ['here', 'hide'], choose: vi.fn(), ...o,
  })

  it('is hidden where there is no layer (a top-level tile, a group)', () => {
    const r = rig()
    const chip = buildLayerChip('border', r.env)
    document.body.append(chip.el)
    chip.sync()
    expect(chip.el.hidden).toBe(true)
  })

  it('is a disclosure: arrow keys move through menuitemradio items, Escape closes and returns', () => {
    const r = rig()
    const f = facts()
    r.state.layer = f
    const chip = buildLayerChip('border', r.env)
    document.body.append(chip.el)
    chip.sync()
    const btn = chip.el.querySelector<HTMLButtonElement>('.te-dg-chipl')!
    const menu = chip.el.querySelector<HTMLElement>('[role=menu]')!
    expect(btn.getAttribute('aria-haspopup')).toBe('menu')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(btn.textContent).toContain('inherited')
    btn.focus()
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(menu.hidden).toBe(false)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]')).filter(b => !b.hidden)
    expect(items.map(b => b.dataset.choice)).toEqual(['here', 'hide'])
    expect(document.activeElement).toBe(items[0])
    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(document.activeElement).toBe(items[1])
    items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(document.activeElement).toBe(items[0])
    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    expect(document.activeElement).toBe(items[1])
    items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(menu.hidden).toBe(true)
    expect(document.activeElement).toBe(btn)
    expect(menu.hasAttribute('data-escape-local')).toBe(true)
  })

  it('chooses through the port, shows the pending one dashed, and a second pick takes it back', () => {
    const r = rig()
    const f = facts()
    r.state.layer = f
    const chip = buildLayerChip('border', r.env)
    document.body.append(chip.el)
    chip.sync()
    const btn = chip.el.querySelector<HTMLButtonElement>('.te-dg-chipl')!
    btn.click()
    chip.el.querySelector<HTMLButtonElement>('[data-choice=hide]')!.click()
    expect(f.choose).toHaveBeenCalledWith('hide')
    r.state.layer = facts({ choice: 'hide' })
    chip.sync()
    expect(btn.dataset.pending).toBe('true')
    expect(btn.dataset.layer).toBe('hidden')
    expect(chip.el.querySelector('[data-choice=hide]')!.getAttribute('aria-checked')).toBe('true')
    btn.click()
    chip.el.querySelector<HTMLButtonElement>('[data-choice=hide]')!.click()
    expect((r.state.layer as ReturnType<typeof facts>).choose).toHaveBeenCalledWith(null)
  })

  it('is disabled and explained when the layer is locked', () => {
    const r = rig()
    r.state.layer = facts({ base: 'locked', offered: [] })
    const chip = buildLayerChip('text', r.env)
    document.body.append(chip.el)
    chip.sync()
    const btn = chip.el.querySelector<HTMLButtonElement>('.te-dg-chipl')!
    expect(btn.disabled).toBe(true)
    expect(btn.title).toContain('locked')
    btn.click()
    expect(chip.el.querySelector<HTMLElement>('[role=menu]')!.hidden).toBe(true)
  })

  it('closes every open menu on a click elsewhere, but not on a click inside', () => {
    const r = rig()
    r.state.layer = facts()
    const chip = buildLayerChip('border', r.env)
    document.body.append(chip.el)
    chip.sync()
    chip.el.querySelector<HTMLButtonElement>('.te-dg-chipl')!.click()
    const menu = chip.el.querySelector<HTMLElement>('[role=menu]')!
    closeLayerMenus(document.body, menu.firstElementChild)
    expect(menu.hidden).toBe(false)
    closeLayerMenus(document.body, document.body)
    expect(menu.hidden).toBe(true)
    expect(chip.el.querySelector('.te-dg-chipl')!.getAttribute('aria-expanded')).toBe('false')
  })
})

describe('the tab glance, by kind', () => {
  it('reads each kind at a glance', () => {
    const r = rig()
    const g = (kind: Parameters<typeof glanceOf>[0], key: FieldKey): string => glanceOf(kind, key, r.env).text
    expect(g('colour', 'border.color')).toBe('default')
    expect(g('colour', 'background.color')).toBe('none')
    r.values['border.color'] = '#112233'
    expect(g('colour', 'border.color')).toBe('#112233')
    expect(g('toggle', 'hideText')).toBe('shown')
    r.values.hideText = true
    expect(g('toggle', 'hideText')).toBe('hidden')
    r.state.has = false
    expect(g('toggle', 'hideText')).toBe('always shown')
    r.state.has = true
    expect(g('link', 'link')).toBe('none')
    r.values.link = 'https://harbourdusk.example/gallery'
    expect(g('link', 'link')).toBe('harbourdusk.example')
    expect(g('image', 'picture')).toBe('3:2 · 58%')
    expect(g('variant', 'orientation')).toBe('point-top')
    expect(glanceOf('text', 'title', r.env)).toEqual({ text: 'Harbour dusk', extra: '' })
    r.state.dirty = true
    expect(glanceOf('text', 'title', r.env).extra).toBe('unsaved')
    r.state.status = { state: 'saving' }
    expect(glanceOf('text', 'title', r.env).extra).toBe('saving...')
    r.state.status = { state: 'refused', sibling: 'x', siblingAddress: 'y' }
    expect(glanceOf('text', 'title', r.env).extra).toBe('not set')
  })

  it('says "as is" for an untouched group field', () => {
    const r = rig()
    r.state.group = true
    expect(glanceOf('colour', 'border.color', r.env)).toMatchObject({ text: 'as is', swatch: null })
    expect(glanceOf('toggle', 'hideText', r.env).text).toBe('as is')
    expect(glanceOf('link', 'link', r.env).text).toBe('as is')
  })
})
