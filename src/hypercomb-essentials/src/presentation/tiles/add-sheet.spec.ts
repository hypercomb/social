// add-sheet.spec.ts — the phone's Add sheet, driven through its doors.
//
//   · `add:sheet-open` opens it (phone only, never under a view); again
//     closes; it reports `add:sheet-state` both ways and closes the deck
//   · name it → `command:submit {text}` — the command line's executor —
//     and the sheet stays up with an empty, focused field
//   · camera closes and asks for the shutter; paste a link submits a URL
//     from the clipboard and says so when there was none; say it toggles
//     the voice service and the door reads "listening"
//   · the way out: backdrop, Escape, BACK (popstate), the deck opening,
//     a view taking the screen, the phone stopping being a phone

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const registered: Record<string, unknown> = {}
const services: Record<string, unknown> = {}
let mobileActive = true
let viewActiveNow = false
let surfaceAdded: unknown = null
let segments: string[] = ['honey-garden']
const voice = { toggle: vi.fn(), stop: vi.fn(), active: false }

;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registered[key] = value },
  get: (key: string) => registered[key] ?? services[key],
  has: (key: string) => key in registered || key in services,
  whenReady: (key: string, cb: (v: unknown) => void) => {
    if (key === '@hypercomb.social/ShellSurfaceRegistry') cb({ add: (s: unknown) => { surfaceAdded = s } })
  },
}
services['@diamondcoreprocessor.com/MobileMode'] = { get active() { return mobileActive } }
services['@diamondcoreprocessor.com/ModeRegistry'] = { isActive: () => viewActiveNow }
services['@hypercomb.social/Lineage'] = { explorerSegments: () => segments }
services['@hypercomb.social/VoiceInputService'] = voice

const out = { submit: vi.fn(), create: vi.fn(), link: vi.fn(), camera: vi.fn(), state: vi.fn(), deckClose: vi.fn() }
EffectBus.on('command:submit', out.submit)
EffectBus.on<{ name: string; accept: () => void; complete: (e?: unknown) => void }>('command:create-cells', p => {
  out.create(p.name)
  if (p.name !== 'refuse-me') p.accept()
})
EffectBus.on('link:intake', out.link)
EffectBus.on('camera:capture-open', out.camera)
EffectBus.on('add:sheet-state', out.state)
EffectBus.on('layer:deck-close', out.deckClose)

const { ADD_SHEET_KEY, ADD_SHEET_SURFACE } = await import('./add-sheet.drone.js')

type DroneShape = { pulse(g: string): Promise<void>; open(): void; close(): void; readonly open_: boolean }
const drone = registered[ADD_SHEET_KEY] as DroneShape
await drone.pulse('')

const el = document.createElement(ADD_SHEET_SURFACE)
document.body.appendChild(el)

const sheet = () => el.querySelector('[data-role="add-sheet"]') as HTMLElement | null
const field = () => el.querySelector('[data-action="name"]') as HTMLInputElement
const door = (action: string) => el.querySelector(`[data-action="${action}"]`) as HTMLButtonElement
const isOpen = () => el.style.display !== 'none' && !!sheet()
const open = () => { EffectBus.emit('add:sheet-open', {}) }

beforeEach(() => {
  drone.close()
  mobileActive = true
  viewActiveNow = false
  segments = ['honey-garden']
  for (const spy of Object.values(out)) spy.mockClear()
  voice.toggle.mockClear()
  EffectBus.emit('voice:active', { active: false })
})

describe('the surface', () => {
  it('is contributed to the registry as an element over the bar, hidden until asked', () => {
    expect(surfaceAdded).toMatchObject({ name: ADD_SHEET_SURFACE, element: ADD_SHEET_SURFACE, order: 710 })
    expect(el.style.zIndex).toBe('100003')
    expect(isOpen()).toBe(false)
  })
})

describe('opening', () => {
  it('add:sheet-open opens the sheet, names where it adds to, reports its state and closes the deck; again closes', () => {
    open()
    expect(isOpen()).toBe(true)
    expect(sheet()?.textContent).toContain('honey-garden')
    expect(out.state).toHaveBeenLastCalledWith({ open: true })
    expect(out.deckClose).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(field())
    open()
    expect(isOpen()).toBe(false)
    expect(out.state).toHaveBeenLastCalledWith({ open: false })
  })

  it('refuses when the phone is not a phone, or a view holds the screen', () => {
    mobileActive = false
    open()
    expect(isOpen()).toBe(false)
    mobileActive = true
    viewActiveNow = true
    open()
    expect(isOpen()).toBe(false)
  })

  it('pushes one history entry and pops it on a close that was not BACK', () => {
    const push = vi.spyOn(window.history, 'pushState')
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    open()
    expect(push).toHaveBeenCalledTimes(1)
    drone.close()
    expect(back).toHaveBeenCalledTimes(1)
    back.mockClear()
    open()
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(isOpen()).toBe(false)
    expect(back).not.toHaveBeenCalled()
    push.mockRestore()
    back.mockRestore()
  })

  it('goes away when the deck opens, a view takes the screen, or the phone stops being a phone', () => {
    open()
    EffectBus.emit('layer:deck-open', {})
    expect(isOpen()).toBe(false)
    open()
    EffectBus.emit('view:active', { active: true })
    expect(isOpen()).toBe(false)
    EffectBus.emit('view:active', { active: false })
    open()
    EffectBus.emit('mobile:mode', { active: false })
    expect(isOpen()).toBe(false)
    EffectBus.emit('mobile:mode', { active: true })
  })
})

describe('the doors', () => {
  it('name it makes a tile through the create door, whatever stance the prompt is in, and keeps the sheet up with an empty field', () => {
    open()
    field().value = '  pollen-2 '
    door('submit').click()
    expect(out.create).toHaveBeenCalledWith('pollen-2')
    expect(out.submit).not.toHaveBeenCalled()
    expect(isOpen()).toBe(true)
    expect(field().value).toBe('')
    field().value = ''
    door('submit').click()
    expect(out.create).toHaveBeenCalledTimes(1)
  })

  it('a URL is a link, a slash line is a command, a reserved word is refused in place, a refused create keeps the words', () => {
    open()
    field().value = 'https://example.com/x'
    door('submit').click()
    expect(out.link).toHaveBeenCalledWith({ url: 'https://example.com/x' })
    field().value = '/help'
    door('submit').click()
    expect(out.submit).toHaveBeenCalledWith({ text: '/help' })
    field().value = 'bees'
    door('submit').click()
    expect(out.create).not.toHaveBeenCalledWith('bees')
    expect(el.querySelector('[data-role="add-hint"]')?.textContent).toContain('reserved')
    expect(field().value).toBe('bees')
    field().value = 'refuse-me'
    door('submit').click()
    expect(field().value).toBe('refuse-me')
    expect(el.querySelector('[data-role="add-hint"]')?.textContent).toContain('could not')
  })

  it('the camera closes the sheet and asks for the shutter', () => {
    open()
    door('camera').click()
    expect(isOpen()).toBe(false)
    expect(out.camera).toHaveBeenCalledTimes(1)
  })

  it('paste a link submits a URL from the clipboard, and says so when there was none', async () => {
    const clip = { readText: vi.fn(async () => 'https://example.com/a?b=1') }
    Object.defineProperty(navigator, 'clipboard', { value: clip, configurable: true })
    open()
    door('link').click()
    await new Promise(r => setTimeout(r, 0))
    expect(out.link).toHaveBeenCalledWith({ url: 'https://example.com/a?b=1' })
    clip.readText.mockImplementation(async () => 'just some words')
    door('link').click()
    await new Promise(r => setTimeout(r, 0))
    expect(out.link).toHaveBeenCalledTimes(1)
    expect(field().value).toBe('just some words')
    expect(el.querySelector('[data-role="add-hint"]')?.textContent).toContain('no link')
  })

  it('say it toggles the voice service; while listening the door says so and interim words fill the field', () => {
    open()
    door('voice').click()
    expect(voice.toggle).toHaveBeenCalledTimes(1)
    EffectBus.emit('voice:active', { active: true })
    expect(door('voice').textContent).toContain('Listening')
    EffectBus.emit('voice:interim', { text: 'bloom two' })
    expect(field().value).toBe('bloom two')
    EffectBus.emit('voice:active', { active: false })
    expect(door('voice').textContent).toContain('Say it')
    expect(field().value).toBe('')
  })
})
