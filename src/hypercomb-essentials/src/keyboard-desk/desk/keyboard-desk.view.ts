// keyboard-desk/desk/keyboard-desk.view.ts
//
// THE KEYBOARD DESK: ONE FULL-SCREEN DESK, a keyboard in the middle. The same box
// as the tile editor: its own slim header, a list on the left, and a labelled
// drawing. Start at the keys: click one or press it, and its callouts say what
// it does and the strip below shows its lineup. Every binding is a lineup of one
// or more automatons: a row in the list joins the end, and the chord runs them in
// order. Or start at the list: the rows build a lineup, lighting the keys they
// land on, and the next key chosen binds it.
//
// This file is the piecing together and nothing else. It holds the session and
// what is chosen right now; every length, word and record belongs to a part
// (../parts.ts), and each part stands in its own folder.

import {
  EffectBus,
  I18N_IOC_KEY,
  attachDockedPanel,
  type DockedPanel,
  type I18nProvider,
  type KeyBinding,
  type KeyChord,
  type KeyMapLayer,
  type WindowSession,
} from '@hypercomb/core'
import { pressOfEvent, type Press } from '../../keyboard/chord-match.js'
import { ansiBoard } from '../board/board.js'
import { behavioursPart } from '../behaviours/behaviours.js'
import { bindingsPart } from '../bindings/bindings.js'
import { calloutsPart } from '../callouts/callouts.js'
import { chordPart } from '../chord/chord.js'
import { keycapPart } from '../keycap/keycap.js'
import { legendPart } from '../legend/legend.js'
import { lineupPart } from '../lineup/lineup.js'
import { listPart } from '../list/list.js'
import {
  LINEUPS_GROUP, NOTHING_HELD, fillParts, lineupCmd, lineupOf, wordOf,
  type Behaviour, type CalloutsHandle, type Cap, type Choice, type DeskParts, type Held,
  type ListHandle, type Modifier, type Say, type ShownBehaviour, type Step, type StripHandle,
} from '../parts.js'
import { stripPart } from '../strip/strip.js'
import { installKeyboardDeskStyles } from './keyboard-desk.styles.js'

const DESK = 'keyboard-desk'
const KEYS = {
  keymap: '@diamondcoreprocessor.com/KeyMapService',
  slash: '@diamondcoreprocessor.com/SlashBehaviourDrone',
  modes: '@diamondcoreprocessor.com/ModeRegistry',
  back: '@diamondcoreprocessor.com/BackGesture',
  gate: '@diamondcoreprocessor.com/InputGate',
} as const

const MODIFIERS: readonly Modifier[] = ['ctrl', 'shift', 'alt', 'meta']

type KeymapShape = { getEffective(): KeyBinding[]; addLayer(layer: KeyMapLayer): void }
type SlashShape = { entries(): readonly { name: string; description: string; hidden?: boolean }[] }
type ModesShape = { enter(mode: string, owner: string): void; exit(mode: string, owner: string): void; releaseOwner?(owner: string): void }
type BackShape = { register(entry: { owner: string; back: () => void; active?: () => boolean }): () => void }
type GateShape = { lock(reason: string): void; unlock(reason: string): void }

const ioc = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

const t: Say = (key, fallback, params) => {
  const fill = (text: string): string =>
    params ? text.replace(/\{(\w+)\}/g, (whole, name) => String(params[name] ?? whole)) : text
  try {
    const text = ioc<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
    return text && text !== key ? text : fill(fallback)
  } catch { return fill(fallback) }
}

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

/** The steps with one moved along by one. */
const moved = (steps: readonly Step[], index: number, by: -1 | 1): readonly Step[] => {
  const out = [...steps]
  const [step] = out.splice(index, 1)
  if (step) out.splice(index + by, 0, step)
  return out
}

const OWN: DeskParts = {
  board: ansiBoard,
  legend: legendPart,
  chord: chordPart,
  bindings: bindingsPart,
  behaviours: behavioursPart,
  lineup: lineupPart,
  keycap: keycapPart,
  callouts: calloutsPart,
  strip: stripPart,
  list: listPart,
}

/** The view's IoC face: the shell's surface host makes the element, so a wish
 *  to open can come before the element does. */
export const keyboardDeskFacade = {
  current: null as KeyboardDeskElement | null,
  wanted: false,
  open(): void {
    facade.wanted = true
    facade.current?.open()
  },
}
const facade = keyboardDeskFacade

export class KeyboardDeskElement extends HTMLElement {

  #parts: DeskParts = OWN
  #panel: HTMLElement | null = null
  #dock: DockedPanel | null = null
  #modes: ModesShape | null = null
  #releaseBack: (() => void) | null = null
  #openCleanup: (() => void)[] = []

  #caps = new Map<string, HTMLElement>()
  #callouts: CalloutsHandle | null = null
  #strip: StripHandle | null = null
  #list: ListHandle | null = null
  #drawing: HTMLElement | null = null
  #tag: HTMLElement | null = null
  #address: HTMLElement | null = null
  #then: HTMLButtonElement | null = null
  #live: HTMLElement | null = null

  #choices: readonly Choice[] = []
  /** Modifiers latched by clicking them, and the ones physically down. */
  #latched: Held = NOTHING_HELD
  #pressed: Held = NOTHING_HELD
  /** The chord being built, one entry per step. */
  #steps: KeyChord[] = []
  /** The next key chosen is another step, not a replacement. */
  #adding = false
  #selected: Cap | null = null
  /** The automatons in hand: the chosen chord's, or a draft waiting for a key. */
  #lineup: readonly Step[] = []
  /** Bumped by anything that decides the lineup, so an older read cannot land. */
  #loading = 0
  /** Writes go one at a time, each reading what the last one left. */
  #writing: Promise<unknown> = Promise.resolve()
  /** What the pointer is on: its keys light without anything being chosen. */
  #peek: string | null = null
  #note = ''
  #parked = false

  readonly #session: WindowSession = {
    park: () => { this.#parked = true; this.#close() },
    unpark: () => { if (this.#parked) { this.#parked = false; this.open() } },
    dismiss: () => this.dismissInner(),
    close: () => this.#close(),
  }

  connectedCallback(): void {
    installKeyboardDeskStyles()
    facade.current = this
    if (facade.wanted) this.open()
  }

  disconnectedCallback(): void {
    if (this.#panel) this.#teardown()
    if (facade.current === this) facade.current = null
  }

  open(): void {
    facade.wanted = true
    if (this.#panel) return
    this.#build()
    void this.#parts.bindings.load().then(choices => {
      this.#choices = choices
      this.#paint()
    })
  }

  /** Unwind one level: what is in hand first, then the desk. */
  dismissInner(): boolean {
    if (this.#adding) { this.#adding = false; this.#paint(); return true }
    if (!this.#steps.length && this.#lineup.length) { this.#lineup = []; this.#paint(); return true }
    if (this.#selected || this.#steps.length) {
      this.#loading++
      this.#selected = null
      this.#steps = []
      this.#lineup = []
      this.#latched = NOTHING_HELD
      this.#note = ''
      this.#paint()
      return true
    }
    if (MODIFIERS.some(modifier => this.#latched[modifier])) {
      this.#latched = NOTHING_HELD
      this.#paint()
      return true
    }
    return false
  }

  // ── the session ───────────────────────────────────────────────

  #build(): void {
    this.#parts = fillParts(OWN, key => ioc(key))
    const parts = this.#parts

    const panel = make('div', 'kb-panel')
    panel.tabIndex = -1
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', t('keyboard.title', 'keyboard'))
    panel.dataset['hcSheet'] = 'full'
    this.#panel = panel

    const list = parts.list.create({
      onPick: behaviour => this.#pick(behaviour),
      onHover: behaviour => this.#hover(behaviour),
    }, t)
    this.#list = list

    const callouts = parts.callouts.create({
      onUnbind: cmd => this.#unbind(cmd),
      onHover: cmd => { this.#peek = cmd; this.#paintCaps() },
    }, t)
    this.#callouts = callouts

    const board = make('div', 'kb-board')
    board.style.aspectRatio = `${parts.board.width} / ${parts.board.height}`
    this.#caps.clear()
    for (const cap of parts.board.caps) {
      const el = parts.keycap.create(cap, parts.board)
      el.addEventListener('click', event => this.#clickCap(cap, event))
      el.addEventListener('pointerenter', () => { this.#peek = null })
      this.#caps.set(cap.id, el)
      board.append(el)
    }
    const drawing = make('div', 'kb-drawing')
    drawing.append(callouts.el, board)
    this.#drawing = drawing

    const strip = parts.strip.create({
      onRemove: index => this.#setLineup(this.#lineup.filter((_, at) => at !== index)),
      onMove: (index, by) => this.#setLineup(moved(this.#lineup, index, by)),
      onScript: text => this.#setLineup([...this.#lineup, ...this.#parts.lineup.stepsOfScript(text)]),
    }, t)
    this.#strip = strip

    const tag = make('div', 'kb-tag')
    tag.setAttribute('aria-live', 'polite')
    this.#tag = tag
    const vp = make('div', 'kb-vp')
    vp.setAttribute('data-consumes-wheel', '')
    vp.append(tag, drawing, strip.el)

    const body = make('div', 'kb-body')
    body.append(list.el, vp)

    const live = make('div', 'kb-live')
    live.setAttribute('role', 'status')
    this.#live = live
    panel.append(this.#buildHeader(), body, live)
    this.appendChild(panel)

    this.#dock = attachDockedPanel(panel, {
      id: DESK,
      dockSide: 'right',
      dockExclusive: false,
      ownsSize: false,
      sizeOwner: { panelWidth: () => 400, setPanelWidth: () => undefined },
      defaultText: 1,
      hcSession: this.#session,
      onClose: () => this.#close(),
    })

    this.#claimModes(panel)
    EffectBus.emit('keymap:suppress', { reason: DESK })
    EffectBus.emit('keymap:hold', { reason: DESK })
    ioc<GateShape>(KEYS.gate)?.lock(DESK)
    this.#releaseBack = ioc<BackShape>(KEYS.back)?.register({
      owner: DESK,
      active: () => this.#panel !== null,
      back: () => { if (!this.dismissInner()) this.#close() },
    }) ?? null

    // On the window and capturing, so a press names a chord before anything
    // else on the page hears it.
    window.addEventListener('keydown', this.#onKeyDown, { capture: true })
    window.addEventListener('keyup', this.#onKeyUp, { capture: true })
    window.addEventListener('blur', this.#onBlur)
    this.#openCleanup.push(
      () => window.removeEventListener('keydown', this.#onKeyDown, { capture: true }),
      () => window.removeEventListener('keyup', this.#onKeyUp, { capture: true }),
      () => window.removeEventListener('blur', this.#onBlur),
      EffectBus.on('keymap:changed', () => this.#paint()),
    )
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => this.#paintCallouts())
      observer.observe(panel)
      this.#openCleanup.push(() => observer.disconnect())
    }

    this.#paint()
    requestAnimationFrame(() => {
      if (this.#panel !== panel) return
      this.#paintCallouts()
      panel.focus({ preventScroll: true })
    })
  }

  #buildHeader(): HTMLElement {
    // The header IS the actions row: its last child is the close button, which
    // is where the docked-panel chrome puts the text-size gear beside.
    const head = make('header', 'kb-head kb-actions')
    const reading = make('span', 'kb-reading', t('keyboard.title', 'keyboard'))
    const address = make('span', 'kb-address')
    this.#address = address

    const then = make('button', 'kb-btn', t('keyboard.add-step', 'then…'))
    then.type = 'button'
    then.title = t('keyboard.add-step-hint', 'Add another key after this one')
    then.addEventListener('click', () => { this.#adding = !this.#adding; this.#paint(); this.#panel?.focus({ preventScroll: true }) })
    this.#then = then

    const reset = make('button', 'kb-btn', t('keyboard.reset', 'defaults'))
    reset.type = 'button'
    reset.title = t('keyboard.reset-hint', 'Put every key back. Your earlier keymaps stay kept.')
    reset.addEventListener('click', () => this.#reset())

    const done = make('button', 'kb-btn kb-btn-primary', t('keyboard.done', 'done'))
    done.type = 'button'
    done.addEventListener('click', () => this.#close())

    const close = make('button', 'kb-icon-btn close')
    close.type = 'button'
    close.setAttribute('aria-label', t('keyboard.close', 'close'))
    close.title = t('keyboard.close', 'close')
    const glyph = make('span', 'mat-sym', 'close')
    glyph.setAttribute('aria-hidden', 'true')
    close.append(glyph)
    close.addEventListener('click', () => this.#close())

    head.append(reading, address, make('span', 'kb-grow'), then, reset, done, close)
    return head
  }

  #close(): void {
    facade.wanted = false
    if (this.#panel) this.#teardown()
  }

  #teardown(): void {
    const attempt = (what: () => void): void => {
      try { what() } catch (error) { console.warn('[keyboard-desk] teardown step failed', error) }
    }
    attempt(() => this.#releaseModes())
    attempt(() => EffectBus.emit('keymap:release', { reason: DESK }))
    attempt(() => EffectBus.emit('keymap:unsuppress', { reason: DESK }))
    attempt(() => ioc<GateShape>(KEYS.gate)?.unlock(DESK))
    attempt(() => this.#releaseBack?.())
    this.#releaseBack = null
    for (const off of this.#openCleanup.splice(0)) attempt(() => off?.())
    attempt(() => this.#dock?.dispose?.())
    this.#dock = null
    this.#panel?.remove()
    this.#panel = null
    this.#caps.clear()
    this.#latched = this.#pressed = NOTHING_HELD
    this.#steps = []
    this.#selected = null
    this.#lineup = []
    this.#loading++
    this.#adding = false
    this.#peek = null
    this.#note = ''
  }

  #claimModes(panel: HTMLElement): void {
    const claim = (modes: ModesShape): void => {
      this.#modes = modes
      modes.enter('view:keeps-controls', DESK)
      modes.enter('view:active', DESK)
    }
    const modes = ioc<ModesShape>(KEYS.modes)
    if (modes) { claim(modes); return }
    ;(window as { ioc?: { whenReady?: (k: string, cb: (v: unknown) => void) => void } }).ioc
      ?.whenReady?.(KEYS.modes, value => { if (this.#panel === panel && !this.#modes) claim(value as ModesShape) })
  }

  #releaseModes(): void {
    const modes = this.#modes
    this.#modes = null
    if (!modes) return
    if (modes.releaseOwner) { modes.releaseOwner(DESK); return }
    modes.exit('view:active', DESK)
    modes.exit('view:keeps-controls', DESK)
  }

  // ── keys ──────────────────────────────────────────────────────

  get #held(): Held {
    const held = { ...NOTHING_HELD }
    for (const modifier of MODIFIERS) held[modifier] = this.#latched[modifier] || this.#pressed[modifier]
    return held
  }

  #readModifiers(event: KeyboardEvent): void {
    const pressed = { ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey, meta: event.metaKey }
    if (MODIFIERS.every(modifier => pressed[modifier] === this.#pressed[modifier])) return
    this.#pressed = pressed
    this.#paint()
  }

  #onKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing) return
    const target = event.target
    const typing = target instanceof HTMLElement && !!target.closest('input, textarea, [contenteditable="true"]')
    const plain = !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey

    if (event.key === 'Escape' && plain) {
      event.preventDefault()
      event.stopPropagation()
      if (typing) (target as HTMLElement).blur()
      else if (!this.dismissInner()) this.#close()
      return
    }
    if (typing) return
    if (event.key === 'Tab') return
    const inside = target instanceof HTMLElement && this.#panel?.contains(target) && target !== this.#panel
    if (inside && plain && (event.key === 'Enter' || event.key === ' ')) return

    event.preventDefault()
    event.stopPropagation()
    this.#readModifiers(event)
    const press = pressOfEvent(event)
    const cap = this.#parts.board.caps.find(item => item.code === press.code)
    if (!cap || cap.modifier || event.repeat) return
    this.#choose(cap, press)
  }

  #onKeyUp = (event: KeyboardEvent): void => {
    this.#readModifiers(event)
    if (event.key === 'Alt') event.preventDefault()
  }

  #onBlur = (): void => {
    this.#pressed = NOTHING_HELD
    this.#paint()
  }

  #clickCap(cap: Cap, event: MouseEvent): void {
    if (cap.modifier) {
      this.#latched = { ...this.#latched, [cap.modifier]: !this.#latched[cap.modifier] }
      this.#paint()
    } else {
      this.#choose(cap, this.#parts.chord.pressOfCap(cap, this.#held))
    }
    // A pointer leaves focus here: Space would press this key again, not name Space.
    if (event.detail > 0) this.#panel?.focus({ preventScroll: true })
  }

  #choose(cap: Cap, press: Press): void {
    const draft = this.#steps.length ? [] : this.#lineup
    const chord = this.#parts.chord.chordOfPress(press)
    this.#steps = this.#adding ? [...this.#steps, chord] : [chord]
    this.#adding = false
    this.#selected = cap
    // The board stays on the layer the chord is in, with its modifiers down.
    this.#latched = { ctrl: press.ctrl, shift: press.shift, alt: press.alt, meta: press.meta }
    this.#note = ''
    if (draft.length) { this.#setLineup(draft); return }
    this.#lineup = []
    this.#paint()
    void this.#loadLineup()
  }

  // ── behaviours ────────────────────────────────────────────────

  #pick(behaviour: Behaviour): void {
    if (behaviour.locked) return
    this.#setLineup([...this.#lineup, this.#parts.lineup.stepOf(behaviour.id)])
  }

  #hover(behaviour: Behaviour | null): void {
    this.#peek = behaviour?.id ?? null
    this.#paintCaps()
  }

  // ── lineups ───────────────────────────────────────────────────

  /** The lineup the chord in hand already runs, or nothing. */
  async #loadLineup(): Promise<void> {
    const loading = ++this.#loading
    const chord = [...this.#steps]
    await this.#writing
    const cmd = this.#bindingOn(chord)?.cmd
    const sig = lineupOf(cmd)
    const steps = !cmd ? [] : sig ? await this.#parts.lineup.read(sig) ?? [] : [this.#parts.lineup.stepOf(cmd)]
    if (loading !== this.#loading || !this.#panel) return
    this.#lineup = steps
    this.#paint()
  }

  #bindingOn(chord: readonly KeyChord[]): KeyBinding | null {
    return chord.length ? this.#parts.legend.bindingOn(chord, this.#bindings(), this.#mine()) : null
  }

  /** The lineup changed. With a chord in hand it is bound at once; with none it
   *  is a draft for the next key. A chord Escape owns stays Escape's. */
  #setLineup(steps: readonly Step[]): void {
    const chord = [...this.#steps]
    const held = this.#bindingOn(chord)?.cmd
    if (held && this.#behaviours(this.#bindings()).some(item => item.behaviour.id === held && item.behaviour.locked)) return
    this.#loading++
    this.#lineup = steps
    this.#note = ''
    this.#paint()
    if (chord.length) this.#inTurn(() => this.#writeLineup(steps, chord))
  }

  #inTurn(act: () => Promise<void>): void {
    this.#writing = this.#writing.then(act).catch(error => console.warn('[keyboard-desk] write failed', error))
  }

  async #writeLineup(steps: readonly Step[], chord: readonly KeyChord[]): Promise<void> {
    const parts = this.#parts
    if (!steps.length) {
      const bound = this.#bindingOn(chord)
      if (bound) this.#commit(parts.bindings.unbind(this.#choices, bound.cmd), t('keyboard.unbound', 'taken off the key'))
      // What was underneath may be a default, and the strip should say so.
      await this.#reread()
      return
    }
    const tiles = this.#behaviours(this.#bindings())
    const labels = steps.map(step => this.#stepLabel(step, tiles)).join(' › ')
    let id = parts.lineup.commandOf(steps)
    if (!id) {
      const sig = await parts.lineup.keep(steps)
      if (!sig) { this.#saveFailed(); return }
      id = lineupCmd(sig)
    }
    const behaviour = tiles.find(item => item.behaviour.id === id)?.behaviour
      ?? { id, name: labels, description: labels, group: LINEUPS_GROUP, locked: false }
    const name = this.#wordsOf(chord)
    this.#commit(
      parts.bindings.assign(this.#choices, behaviour, chord),
      t('keyboard.bound', '{chord} runs {name}', { chord: name, name: labels }),
    )
  }

  /** The chord's lineup again, from inside a write: awaiting the writes here
   *  would wait on this one. */
  async #reread(): Promise<void> {
    const loading = ++this.#loading
    const cmd = this.#bindingOn(this.#steps)?.cmd
    const sig = lineupOf(cmd)
    const steps = !cmd ? [] : sig ? await this.#parts.lineup.read(sig) ?? [] : [this.#parts.lineup.stepOf(cmd)]
    if (loading !== this.#loading || !this.#panel) return
    this.#lineup = steps
    this.#paint()
  }

  #unbind(cmd: string): void {
    this.#inTurn(async () => {
      this.#commit(this.#parts.bindings.unbind(this.#choices, cmd), t('keyboard.unbound', 'taken off the key'))
      await this.#reread()
    })
  }

  #reset(): void {
    this.#inTurn(async () => {
      this.#commit([], t('keyboard.reset-done', 'every key is back to its default'))
      await this.#reread()
    })
  }

  #saveFailed(): void {
    this.#note = t('keyboard.save-failed', 'This works until you reload: it could not be saved.')
    this.#paint()
  }

  /** Runs at once, then saves. The keymap and the document never wait on each other. */
  #commit(choices: readonly Choice[], said: string): void {
    this.#choices = choices
    ioc<KeymapShape>(KEYS.keymap)?.addLayer(this.#parts.bindings.layerOf(choices))
    this.#note = said
    this.#paint()
    if (this.#live) this.#live.textContent = said
    void this.#parts.bindings.save(choices).then(sig => {
      if (!sig) this.#saveFailed()
    })
  }

  // ── paint ─────────────────────────────────────────────────────

  #bindings(): readonly KeyBinding[] {
    return ioc<KeymapShape>(KEYS.keymap)?.getEffective() ?? []
  }

  #mine(): ReadonlySet<string> {
    return new Set(this.#choices.filter(choice => choice.sequence.length).map(choice => choice.cmd))
  }

  #behaviours(bindings: readonly KeyBinding[]): readonly ShownBehaviour[] {
    const words = ioc<SlashShape>(KEYS.slash)?.entries() ?? []
    const byCmd = new Map(bindings.map(binding => [binding.cmd, binding]))
    return this.#parts.behaviours.list({ bindings, words }, t).map(behaviour => {
      const binding = byCmd.get(behaviour.id)
      const keys = binding?.sequence.length
        ? this.#parts.chord.read(binding.sequence.map(step => step[0]!)).map(step => step.join('+'))
        : []
      return { behaviour, keys, chosen: this.#lineup.some(step => this.#parts.lineup.commandOf([step]) === behaviour.id) }
    })
  }

  #nameOf(bindings: readonly KeyBinding[], cmd: string): string {
    const word = wordOf(cmd)
    if (word) return word
    const binding = bindings.find(item => item.cmd === cmd)
    const said = binding?.descriptionKey ? t(binding.descriptionKey, binding.description ?? cmd) : binding?.description
    return said ?? cmd
  }

  #paint(): void {
    if (!this.#panel) return
    const bindings = this.#bindings()
    const tiles = this.#behaviours(bindings)
    const chord = this.#wordsOf(this.#steps)
    this.#list?.show(tiles)
    this.#strip?.show(this.#lineup.map(step => this.#stepLabel(step, tiles)), chord)
    this.#paintCaps()
    this.#paintCallouts()

    if (this.#address) this.#address.textContent = chord ? `/${chord}` : ''
    if (this.#then) {
      this.#then.hidden = !this.#steps.length
      this.#then.setAttribute('aria-pressed', String(this.#adding))
    }
    this.#paintTag(chord)
  }

  /** A chord in plain words. */
  #wordsOf(chord: readonly KeyChord[]): string {
    return this.#parts.chord.read(chord).map(step => step.join('+')).join(` ${t('keyboard.then', 'then')} `)
  }

  /** What a step reads as: the sentence without its slash, or the behaviour's name. */
  #stepLabel(step: Step, tiles: readonly ShownBehaviour[]): string {
    if ('say' in step) return step.say.replace(/^\//, '')
    return tiles.find(item => item.behaviour.id === step.cmd)?.behaviour.name
      ?? (lineupOf(step.cmd) ? t('keyboard.lineup', 'lineup') : step.cmd)
  }

  #paintTag(chord: string): void {
    const tag = this.#tag
    if (!tag) return
    const held = MODIFIERS.filter(modifier => this.#held[modifier])
    const layer = held.length ? held.join('+') : t('keyboard.layer-none', 'no modifier')
    const hint = this.#note
      || (this.#adding ? t('keyboard.hint-next', 'Press the next key of {chord}', { chord })
        : chord ? t('keyboard.hint-chosen', 'Choose from the list to add to {chord}', { chord })
          : this.#lineup.length ? t('keyboard.hint-armed', 'Press a key for this lineup')
            : t('keyboard.hint-start', 'Click a key or press it'))
    tag.replaceChildren(
      `${t('keyboard.tag-board', 'board')} `, make('b', '', this.#parts.board.id),
      ` · ${t('keyboard.tag-layer', 'layer')} `, make('b', '', layer),
      ` · ${hint}`,
    )
  }

  #paintCaps(): void {
    const bindings = this.#bindings()
    const mine = this.#mine()
    const held = this.#held
    const parts = this.#parts
    // What the pointer is on, or else a draft's steps: where they already land.
    const looking = this.#peek ? [this.#peek]
      : this.#steps.length ? []
        : this.#lineup.flatMap(step => parts.lineup.commandOf([step]) ?? [])
    const lit = new Set(bindings
      .filter(binding => looking.includes(binding.cmd))
      .flatMap(binding => parts.legend.capsOf(binding, parts.board).map(({ cap }) => cap.id)))

    for (const cap of parts.board.caps) {
      const el = this.#caps.get(cap.id)
      if (!el) continue
      const legend = cap.modifier ? null : parts.legend.legendOf(parts.chord.pressOfCap(cap, held), bindings, mine)[0] ?? null
      parts.keycap.paint(el, cap, {
        legend,
        name: legend ? this.#shortName(legend.cmd, bindings) : '',
        selected: this.#selected?.id === cap.id,
        lit: lit.has(cap.id),
        down: !!cap.modifier && held[cap.modifier],
      })
    }
  }

  /** What fits on a key: the behaviour's name, never its sentence. */
  #shortName(cmd: string, bindings: readonly KeyBinding[]): string {
    const behaviour = this.#behaviours(bindings).find(item => item.behaviour.id === cmd)?.behaviour
    return behaviour?.name ?? wordOf(cmd) ?? ''
  }

  #paintCallouts(): void {
    const drawing = this.#drawing
    const callouts = this.#callouts
    if (!drawing || !callouts) return
    const cap = this.#selected
    const bindings = this.#bindings()
    const mine = this.#mine()
    const rows = cap ? this.#parts.legend.bindingsOn(cap, bindings).map(binding => ({
      cmd: binding.cmd,
      keys: this.#parts.chord.read(binding.sequence.map(step => step[0]!)),
      text: this.#nameOf(bindings, binding.cmd),
      mine: mine.has(binding.cmd),
      locked: binding.cmd === 'global.escape',
    })) : []
    callouts.show(rows, cap ? this.#caps.get(cap.id) ?? null : null, drawing)
  }
}
