// presentation/tiles/layout-targets.view.ts
//
// THE TARGETS WINDOW — what belongs in each hole, and who is answering.
//
// The layout designer decides the SHAPE. This decides the INTERFACE: press a
// hole, give it a name, and the container starts advertising that hole to
// anything that can fill it. Two separate acts, so two windows — and the
// question this one answers ("what goes here?") is the one you ask once the
// shape is already right.
//
// ── THE CONTAINER IS THE INDEX OF ITS OWN HOLES ─────────────────────────
//
// There is no list of hole names down the side. The arrangement itself is
// drawn here, every fillable hole is a button, and pressing one selects it.
// A list would be the same arrangement said twice, and only one of the two
// can show you that the hole you are naming is the narrow one on the left.
//
// Each hole wears its own answer — its name if it has one, its slot number if
// it does not, and the child seated in it when something is — so the window
// is readable without pressing anything.
//
// ── NAMING IT IS DRAWING THE HIVE ───────────────────────────────────────
//
// A layout is a TREE, and the names on it are a hive waiting to be grown. A
// named SECTION — a hole with an arrangement in it — is the tile everything
// under it hangs from; a named LEAF is a tile at whatever level it finds
// itself; an unnamed section is transparent, an arrangement decision and not a
// place, so what is under it hangs from the nearest named ancestor.
//
// That is why sections are named here at all. They take no member and they
// never will, and for a long time that was read as "so they cannot be named" —
// which is true of a SEAT and false of a NAME. While it stood, every hive a
// design could grow was exactly one row deep.
//
// GROW is at the foot of the window: it says how many tiles the design is
// asking for, and it makes them through the one create door. Nothing here
// implements creation, and nothing here is undone by pressing it twice — a
// tile that is already there is already there.
//
// ── TWO KINDS OF "WHAT IS IN IT", NEVER MERGED ──────────────────────────
//
// SEATED is a fact: the child of this container whose enrolment position is
// this hole's slot. ANSWERING is an invitation: everything in the hive wearing
// this hole's name, nearly all of which is somewhere else. They are separate
// lines, because a list that mixed them would report a hole as filled when it
// is empty.
//
// ── AN ELEMENT, NOT A COMPONENT ─────────────────────────────────────────
//
// Shell chrome contributed by a module is a framework-free custom element
// added to the ShellSurfaceRegistry over IoC — never an Angular class in the
// shared barrel, which a doctrine ratchet holds shut. So the tool-window
// recipe is restated here in plain CSS, with the SHARED VALUES deliberately
// (the same panel band, the same accent hairline on the docking edge, the
// same panel-scale ladder) — the same way providers-window.view.ts does it.
//
// ── IT READS NOTHING ITSELF ─────────────────────────────────────────────
//
// TemplateAuthorDrone is the one reader of an arrangement. This window renders
// `targets:state` and emits `targets:name` / `targets:clear` back. A second
// reader would drift, and then the window and the page would disagree about
// the same hole.

import {
  EffectBus, I18N_IOC_KEY, attachDockedPanel, isPhoneViewport,
  type DockedPanel, type I18nProvider,
} from '@hypercomb/core'
import { TARGETS_OPEN, TARGETS_STATE, TARGETS_VIEW_STATE } from './template-author.drone.js'
import type { HoleState, TargetsState } from './template-author.drone.js'

const SURFACE = 'hc-layout-targets'
const STYLE_ID = 'hc-layout-targets-style'
const OWNER = '@diamondcoreprocessor.com/LayoutTargetsView'

/** The steel the shell's docked windows are edged in. Restated, not imported —
 *  a module cannot `@use` a shared stylesheet. */
const STEEL = '126, 182, 214'
/** The same steel taken deep for a bright theme — what `identity.deepen()`
 *  computes for #7eb6d6, restated for the same reason the steel is. */
const STEEL_DEEP = '39, 93, 124'
/** The designer's second colour: what is picked, named, or dropped on. */
const ACCENT = '201, 162, 39'
/** Whose edge reservation this is — see `#reserve`. */
const INSET_OWNER = 'layout-targets'

const ioc = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

/** A caption, or the plain-English stand-in. `t()` echoes the key back when it
 *  cannot resolve one, so every call guards — a key on a panel is worse than
 *  the English it was standing in for. */
const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  try {
    const text = ioc<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
    return text && text !== key ? text : interpolate(fallback, params)
  } catch { return interpolate(fallback, params) }
}

/** A hole path, safe inside an attribute selector. `CSS.escape` where the
 *  browser has it; the hole keys this ever sees are slugs, so the fallback
 *  only has to survive the ones that are not. */
const cssEscape = (value: string): string => {
  const escape = (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS?.escape
  return escape ? escape(value) : String(value).replace(/["\\]/g, '\\$&')
}

const interpolate = (text: string, params?: Record<string, string | number>): string =>
  params ? text.replace(/\{(\w+)\}/g, (whole, name) => String(params[name] ?? whole)) : text

export class LayoutTargetsElement extends HTMLElement {

  #panel: HTMLElement | null = null
  /** The part of the window a render redraws. The header is NOT in it — the
   *  docked-panel primitive pins its gear into the header and its grip onto
   *  the panel, and a render that rebuilt the whole window threw both away on
   *  the first state update. */
  #body: HTMLElement | null = null
  #subject: HTMLElement | null = null
  #stage: HTMLElement | null = null
  #props: HTMLElement | null = null
  #state: TargetsState | null = null
  /** The docked-panel primitive behind this window: its lane place, its grip
   *  and its gear. */
  #dock: DockedPanel | null = null

  /** Which hole is being named, as its path joined. Participant-local: what
   *  you are pointing at is not part of the design. */
  #picked = ''
  /** The editor's own two fields. Held here rather than read back off the DOM
   *  so a half-typed name survives the state re-publish that follows every
   *  edit — losing what you were typing to your own keystroke is the worst
   *  kind of surprise. */
  #family = ''
  #draft = ''

  #cleanup: (() => void)[] = []

  // What this window reserves of the right edge — see `#reserve`.
  #observer: ResizeObserver | null = null
  #offPoll: (() => void) | null = null
  #frame = 0
  #timer = 0

  connectedCallback(): void {
    ensureStyles()
    this.#cleanup.push(EffectBus.on<{ open?: boolean; at?: number }>(TARGETS_OPEN, payload => {
      // The bus replays its last value to late subscribers, so a reload would
      // otherwise re-deliver the last request and the window would open by
      // itself. The stamp separates "you just asked" from "you asked once".
      if (Math.abs(Date.now() - (payload?.at ?? 0)) > 10_000) return
      if (payload?.open === true) this.open()
      else this.close()
    }))
    // Closing the designer closes this with it: an interface editor for a
    // container nobody is looking at is a window in the way.
    this.#cleanup.push(EffectBus.on<{ open?: boolean }>('template:view-state', state => {
      if (state?.open === false) this.close()
    }))
    this.#cleanup.push(EffectBus.on<TargetsState>(TARGETS_STATE, state => {
      this.#state = state ?? null
      // A hole that is no longer there cannot stay selected. One that is keeps
      // its editor exactly as it was.
      const still = (state?.holes ?? []).some(hole => hole.path.join('/') === this.#picked)
      if (!still) { this.#picked = ''; this.#draft = '' }
      // ALWAYS a full redraw of the body. The state is what the window IS, and
      // it arrives AFTER the window opens — the drone computes nothing until it
      // is told somebody is looking. A path that only refreshed the properties
      // left the container undrawn, and the window read "nothing is plugged
      // in" over a container that plainly was.
      this.#render()
    }))
  }

  disconnectedCallback(): void {
    for (const off of this.#cleanup) off()
    this.#cleanup = []
    this.close()
  }

  open(): void {
    if (this.#panel) return
    const panel = document.createElement('aside')
    panel.className = 'hc-targets'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', t('targets.title', 'Targets'))
    panel.tabIndex = -1
    // The hive must not pan or zoom under a window being read.
    panel.setAttribute('data-consumes-wheel', '')
    panel.addEventListener('keydown', this.#onKey)
    panel.appendChild(this.#head())
    const body = document.createElement('div')
    body.className = 'hc-targets-body'
    panel.appendChild(body)
    this.appendChild(panel)
    this.#panel = panel
    this.#body = body

    // A DOCKED TOOL WINDOW, LIKE EVERY OTHER ONE. It was a fixed box pinned
    // just inboard of whatever else was docked on the right, which is how the
    // properties, the flex gallery and this window came to stack into one
    // another. Now it takes a place in the right-hand lane like its siblings,
    // resizes from its inner edge, carries the same gear, and says what it
    // takes of the edge so the design pane centres beside it rather than
    // under it.
    this.#dock = attachDockedPanel(panel, {
      id: 'layout-targets',
      dockSide: 'right',
      minWidth: 260,
      maxWidth: 520,
      defaultWidth: 340,
      onClose: () => this.close(),
    })
    this.#reserve()

    EffectBus.emit(TARGETS_VIEW_STATE, { open: true })
    this.#render()
  }

  close(): void {
    if (!this.#panel) return
    this.#panel.removeEventListener('keydown', this.#onKey)
    this.#dock?.dispose()
    this.#dock = null
    this.#release()
    this.#panel.remove()
    this.#panel = null
    this.#body = null
    this.#subject = null
    this.#stage = null
    this.#props = null
    EffectBus.emit(TARGETS_VIEW_STATE, { open: false })
  }

  /**
   * WHAT THIS WINDOW TAKES OF THE RIGHT EDGE — the job `hcDockInset` does for
   * the Angular windows, which a module cannot import.
   *
   * The same two rules that directive keeps: a timer races the frame, so a
   * window opened in a document that is not rendering still reserves; and a
   * box spanning the viewport (a phone sheet) reserves nothing at all, or the
   * canvas would be squeezed to zero behind it.
   */
  #reserve(): void {
    const panel = this.#panel
    if (!panel) return
    this.#observer = new ResizeObserver(this.#schedule)
    this.#observer.observe(panel)
    window.addEventListener('resize', this.#schedule)
    this.#offPoll = EffectBus.on('viewport:inset-poll', this.#schedule)
    this.#schedule()
  }

  readonly #schedule = (): void => {
    if (this.#frame || this.#timer) return
    this.#frame = requestAnimationFrame(this.#measure)
    this.#timer = window.setTimeout(this.#measure, 60)
  }

  readonly #measure = (): void => {
    if (this.#frame) { cancelAnimationFrame(this.#frame); this.#frame = 0 }
    if (this.#timer) { clearTimeout(this.#timer); this.#timer = 0 }
    const rect = this.#panel?.getBoundingClientRect()
    const spans = !rect || rect.width <= 0
      || (rect.left <= 1 && rect.right >= window.innerWidth - 1)
    const size = !rect || spans || isPhoneViewport()
      ? 0
      : Math.max(0, Math.round(window.innerWidth - rect.left))
    EffectBus.emit('viewport:inset', { owner: INSET_OWNER, side: 'right', size })
  }

  #release(): void {
    this.#observer?.disconnect()
    this.#observer = null
    window.removeEventListener('resize', this.#schedule)
    this.#offPoll?.()
    this.#offPoll = null
    if (this.#frame) cancelAnimationFrame(this.#frame)
    if (this.#timer) clearTimeout(this.#timer)
    this.#frame = 0
    this.#timer = 0
    EffectBus.emit('viewport:inset', { owner: INSET_OWNER, side: 'right', size: 0 })
  }

  /** One level back per press: drop the selection, then close. The same
   *  cascade every other window in the shell walks. */
  readonly #onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    if (this.#picked) { this.#pick(''); return }
    this.close()
  }

  // ── the drawing ─────────────────────────────────────────────────────────

  #render(): void {
    const body = this.#body
    if (!body) return
    body.replaceChildren()
    if (this.#subject) this.#subject.textContent = this.#state?.cell ?? ''

    const state = this.#state
    if (state?.dormant) {
      body.appendChild(note('hc-targets-quiet',
        t('layout.dormant', 'The layout behaviour is switched off for this branch.')))
    }
    if (!state?.layout) {
      body.appendChild(note('hc-targets-quiet', t('targets.unplugged',
        'Nothing is plugged in here yet. Give this container a layout first — a hole is what gets named, and there are none until there is a shape.')))
      return
    }

    // THE CONTAINER, mounted as raw HTML so the inline custom properties that
    // ARE the layout survive, then wired hole by hole.
    const stage = document.createElement('div')
    stage.className = 'hc-targets-stage'
    stage.innerHTML = state.container
    this.#bindHoles(stage, state.holes)
    body.appendChild(stage)
    this.#stage = stage

    const named = state.holes.filter(hole => !!hole.meaning).length
    body.appendChild(note('hc-targets-count', t('targets.named', '{named} of {of} holes named',
      { named, of: state.holes.length })))

    const props = document.createElement('div')
    props.className = 'hc-targets-props'
    body.appendChild(props)
    this.#props = props
    this.#renderProps()

    // THE HIVE THIS DESIGN IS ASKING FOR, at the foot of the WINDOW and not
    // inside the properties. It is a fact about the whole arrangement — every
    // name on it — so putting it under the selected hole would have made it
    // look like a property of that hole, and hidden it entirely while nothing
    // was selected, which is exactly when you want to see what you have built.
    this.#renderGrow(body)
  }

  #head(): HTMLElement {
    const head = document.createElement('header')
    head.className = 'hc-targets-head'
    const title = face('hc-targets-title', t('targets.title', 'Targets'))
    // Always present, empty until there is a container to name: the header is
    // built once, so the subject is a node the render writes into.
    const subject = face('hc-targets-subject', this.#state?.cell ?? '')
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'hc-targets-close'
    close.textContent = '×'
    close.setAttribute('aria-label', t('panel.close', 'Close'))
    close.addEventListener('click', () => this.close())
    head.append(title, subject, close)
    this.#subject = subject
    return head
  }

  /**
   * Make EVERY hole a button — seats and sections alike.
   *
   * It was `[data-hc-slot]` only, which is the composer's own mark for "a
   * member seats here". That is the right question to ask about a SEAT and the
   * wrong one to ask about a name: a section takes no member and is still the
   * tile its children hang from. The state's own hole list is the index now,
   * and it carries which is which, so this never has to know a layout.
   *
   * A section CONTAINS the holes inside it, so both are under the pointer at
   * once. The inner one wins — every handler stops the event — which is the
   * only reading that lets a section be pressed at all: its own name sits in
   * its margin, where none of its children are.
   */
  #bindHoles(stage: HTMLElement, holes: readonly HoleState[]): void {
    for (const hole of holes) {
      const path = hole.path.join('/')
      const node = stage.querySelector<HTMLElement>(
        `[data-hc-path="${cssEscape(path)}"]`,
      )
      if (!node) continue
      node.classList.add('hc-targets-hole')
      if (hole.section) node.classList.add('is-section')
      if (hole.meaning) node.classList.add('is-named')
      if (path === this.#picked) node.classList.add('is-picked')
      node.setAttribute('role', 'button')
      node.tabIndex = 0

      // THE HOLE SAYS WHAT IT IS: its name if it has one, its slot if it does
      // not — and a section has no slot to fall back on, so it says what it is
      // instead. Underneath, whatever is sitting in it.
      node.appendChild(face('hc-targets-hole-name',
        hole.meaning || (hole.section ? t('targets.section', 'section') : `#${hole.slot}`)))
      if (hole.filledBy) node.appendChild(face('hc-targets-hole-fill', hole.filledBy))

      node.addEventListener('click', event => {
        event.preventDefault()
        event.stopPropagation()
        this.#pick(path)
      })
      node.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        this.#pick(path)
      })
    }
  }

  /** THE ONE DOOR for selection. The editor is loaded from the hole rather
   *  than left showing the last one's name, and the highlight is PAINTED —
   *  pressing a hole must not tear down the element that was pressed. */
  #pick(path: string): void {
    this.#picked = path
    const hole = this.#hole()
    this.#family = hole?.family || this.#state?.families?.[0] || 'site'
    this.#draft = hole?.name ?? ''
    for (const node of Array.from(
      this.#stage?.querySelectorAll<HTMLElement>('.hc-targets-hole') ?? [],
    )) {
      node.classList.toggle('is-picked', (node.getAttribute('data-hc-path') ?? '') === path)
    }
    this.#renderProps()
  }

  #hole(): HoleState | null {
    return this.#state?.holes.find(hole => hole.path.join('/') === this.#picked) ?? null
  }

  #renderProps(): void {
    const props = this.#props
    if (!props) return
    props.replaceChildren()
    const hole = this.#hole()
    if (!hole) {
      props.appendChild(note('hc-targets-quiet',
        t('targets.pick', 'Press a hole above to say what belongs in it.')))
      return
    }

    // WHICH HOLE — where it sits, and which member position seats into it.
    // The slot is not a detail: it is the whole of how a child ends up here.
    const head = document.createElement('h3')
    head.className = 'hc-targets-hole-head'
    head.appendChild(face('hc-targets-where', hole.path.join(' › ')))
    head.appendChild(face('hc-targets-slot', hole.section
      ? t('targets.section.is', 'section — a branch')
      : t('targets.slot', 'member {n}', { n: hole.slot })))
    props.appendChild(head)

    // WHAT IT IS CALLED. A family and a name, because a meaning is always
    // scoped: `masthead` alone is a word somebody else is already using for
    // something else, and the colon is what keeps two hives that never met
    // from colliding.
    const family = document.createElement('select')
    family.className = 'hc-targets-input'
    for (const option of this.#state?.families ?? ['site']) {
      const item = document.createElement('option')
      item.value = option
      item.textContent = option
      item.selected = option === this.#family
      family.appendChild(item)
    }
    family.addEventListener('change', () => {
      this.#family = family.value
      this.#preview()
    })
    props.appendChild(field(t('targets.family', 'Family'), family))

    const name = document.createElement('input')
    name.className = 'hc-targets-input'
    name.type = 'text'
    name.value = this.#draft
    name.placeholder = t('targets.name.placeholder', 'masthead')
    name.addEventListener('input', () => { this.#draft = name.value; this.#preview() })
    name.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      this.#name()
    })
    props.appendChild(field(t('targets.name', 'Name'), name))

    // The meaning as it will actually be minted, folded the way the store will
    // fold it. A name is a signature the moment it is committed, so what is
    // about to be committed is shown first.
    const preview = document.createElement('p')
    preview.className = 'hc-targets-preview'
    props.appendChild(preview)

    const acts = document.createElement('div')
    acts.className = 'hc-targets-acts'
    const give = document.createElement('button')
    give.type = 'button'
    give.className = 'hc-targets-do'
    give.textContent = hole.meaning
      ? t('targets.rename', 'Rename it')
      : t('targets.give', 'Name this hole')
    give.addEventListener('click', () => this.#name())
    acts.appendChild(give)
    if (hole.meaning) {
      const clear = document.createElement('button')
      clear.type = 'button'
      clear.className = 'hc-targets-do is-quiet'
      clear.textContent = t('targets.clear', 'Unname it')
      clear.addEventListener('click', () => {
        EffectBus.emit('targets:clear', { segments: this.#state?.segments ?? [], path: hole.path })
        this.#draft = ''
      })
      acts.appendChild(clear)
    }
    props.appendChild(acts)

    // THE ADDRESS the name derives to — what the composer writes onto the hole
    // and what a stranger's artifact has to wear to answer it. Short, because
    // the other 52 characters say nothing the first eight do not; the whole of
    // it is on the title.
    if (hole.target) {
      const row = rowOf(t('targets.address', 'Address'))
      const sig = face('hc-targets-sig', `${hole.target.slice(0, 8)}…${hole.target.slice(-4)}`)
      sig.title = hole.target
      row.appendChild(sig)
      props.appendChild(row)
    }

    // WHAT IS IN IT — a fact. A SECTION is filled by the arrangement nested in
    // it, which is a different fact and never a member, so it is said
    // separately rather than reported as an empty seat.
    if (hole.section) {
      const holds = rowOf(t('targets.holds', 'It holds'))
      holds.appendChild(face('hc-targets-answer', t('targets.holds.what',
        'an arrangement — name it and the tiles below it hang from this one')))
      props.appendChild(holds)
      return
    }
    const seated = rowOf(t('targets.seated', 'In it now'))
    if (hole.filledBy) {
      const visit = document.createElement('button')
      visit.type = 'button'
      visit.className = 'hc-targets-visit'
      visit.textContent = hole.filledBy
      visit.title = t('targets.visit', 'Go to it')
      visit.addEventListener('click', () => this.#visit(hole))
      seated.appendChild(visit)
    } else {
      seated.appendChild(face('hc-targets-empty', t('targets.seated.none',
        'nothing — the child at position {n} fills this', { n: hole.slot })))
    }
    props.appendChild(seated)

    // WHAT COULD FILL IT — an invitation, kept apart from the fact above, and
    // now an invitation you can ACCEPT.
    //
    // These were dot-joined text. Reading "three things answer this" and having
    // no way to put one of them in is what made naming a hole feel like
    // bookkeeping: the hole advertised an interface into a void. Each answerer
    // is a button now, and pressing it seats that artifact at this hole's slot.
    if (hole.meaning) {
      const answers = rowOf(t('targets.answering', 'Could fill it'))
      if (hole.answers.length) {
        const list = document.createElement('div')
        list.className = 'hc-targets-answers'
        for (const answer of hole.answers) {
          const put = document.createElement('button')
          put.type = 'button'
          put.className = 'hc-targets-put'
          put.textContent = answer.name
          // A SECTION takes no member, so it is never offered one. The drone
          // refuses it too — this only keeps the offer honest on the way in.
          put.disabled = hole.section
          put.title = hole.section
            ? t('targets.put.section', 'A section holds an arrangement, not a part')
            : t('targets.put', 'Put {name} in this hole', { name: answer.name })
          put.addEventListener('click', () => {
            EffectBus.emit('targets:seat', {
              segments: this.#state?.segments ?? [],
              path: hole.path,
              part: answer.segments,
            })
          })
          list.appendChild(put)
        }
        answers.appendChild(list)
      } else {
        answers.appendChild(face('hc-targets-empty',
          t('targets.answering.none', 'nothing in this hive wears this name yet')))
      }
      props.appendChild(answers)

      // WHAT TO MAKE — the decoration an artifact wears to be this kind of
      // thing at all. Guidance, never a gate: the hole accepts anything that
      // declares its meaning, however it was made.
      const guide = document.createElement('p')
      guide.className = 'hc-targets-guide'
      guide.textContent = t('targets.guidance',
        'Anything that declares this name can answer it. A {family} artifact carries',
        { family: hole.family })
      guide.appendChild(document.createTextNode(' '))
      guide.appendChild(face('hc-targets-kind', hole.artifactKind))
      props.appendChild(guide)
    }

    this.#preview()
  }

  /**
   * THE HIVE THIS DESIGN IS ASKING FOR, and the one press that makes it.
   *
   * It reads the outline the one reader derived — every named hole as a tile
   * path, sections included — and says it back as the tree it is before
   * anything is made. A button that only said "grow" would be asking for a
   * yes to a question it had not put.
   *
   * Absent while nothing is named. There is no honest version of this control
   * for a design that has said nothing yet, and an empty one would be a
   * control in the way.
   */
  #renderGrow(host: HTMLElement): void {
    const outline = this.#state?.outline ?? []
    if (!outline.length) return

    const section = document.createElement('section')
    section.className = 'hc-targets-grow'

    const head = document.createElement('h4')
    head.className = 'hc-targets-grow-head'
    head.textContent = t('targets.grow.head', 'The hive this asks for')
    section.appendChild(head)

    const list = document.createElement('ul')
    list.className = 'hc-targets-outline'
    for (const path of outline) {
      const row = document.createElement('li')
      // INDENTED BY DEPTH, because the indent IS the answer: it says which
      // tile each one hangs from, which is the whole thing a name on a section
      // decides.
      row.style.paddingLeft = `${(path.length - 1) * 0.7}rem`
      row.textContent = path[path.length - 1] ?? ''
      list.appendChild(row)
    }
    section.appendChild(list)

    const grow = document.createElement('button')
    grow.type = 'button'
    grow.className = 'hc-targets-do is-grow'
    grow.textContent = t('targets.grow', 'Grow {n} tiles', { n: outline.length })
    grow.addEventListener('click', () => {
      EffectBus.emit('targets:grow', { segments: this.#state?.segments ?? [] })
    })
    section.appendChild(grow)

    // Pressing it twice makes nothing twice — a tile that is already there is
    // already there — and saying so is cheaper than the participant finding
    // out by trying it.
    const note = document.createElement('p')
    note.className = 'hc-targets-guide'
    note.textContent = t('targets.grow.again',
      'Tiles this design already named are left alone.')
    section.appendChild(note)

    host.appendChild(section)
  }

  /** The line under the two fields, kept in step with them without redrawing
   *  the editor — a field that rebuilt itself on every keystroke would lose
   *  the caret on every keystroke. */
  #preview(): void {
    const line = this.#props?.querySelector<HTMLElement>('.hc-targets-preview')
    const give = this.#props?.querySelector<HTMLButtonElement>('.hc-targets-do')
    const name = slug(this.#draft)
    const meaning = name ? `${slug(this.#family) || 'site'}:${name}` : ''
    if (line) line.textContent = meaning
    if (give) give.disabled = !meaning
  }

  #name(): void {
    const hole = this.#hole()
    if (!hole || !slug(this.#draft)) return
    EffectBus.emit('targets:name', {
      segments: this.#state?.segments ?? [],
      path: hole.path,
      family: this.#family,
      name: this.#draft,
    })
  }

  /** Walk to whatever is sitting in the hole — through Navigation's own door,
   *  the way every other surface walks. */
  #visit(hole: HoleState): void {
    if (!hole.filledAt.length) return
    ioc<{ goRaw?(s: readonly string[]): void }>('@hypercomb.social/Navigation')
      ?.goRaw?.([...hole.filledAt])
  }
}

// ── plain DOM helpers ─────────────────────────────────────────────────────

function face(className: string, text: string): HTMLElement {
  const span = document.createElement('span')
  span.className = className
  span.textContent = text
  return span
}

function note(className: string, text: string): HTMLElement {
  const p = document.createElement('p')
  p.className = className
  p.textContent = text
  return p
}

function field(label: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement('label')
  wrap.className = 'hc-targets-field'
  wrap.appendChild(face('hc-targets-label', label))
  wrap.appendChild(control)
  return wrap
}

function rowOf(label: string): HTMLElement {
  const row = document.createElement('p')
  row.className = 'hc-targets-row'
  row.appendChild(face('hc-targets-label', label))
  return row
}

/** The same fold every meaning in this system gets, applied here only so the
 *  preview tells the truth about what will be minted. The authority is still
 *  the drone — this never decides anything. */
function slug(value: string): string {
  return String(value ?? '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    /* THE SAME MATERIAL AS EVERY OTHER TOOL WINDOW, NAMED BY ROLE. A module
       cannot @use the shared stylesheet, so the recipe is restated — and it
       names ROLES, never colours. It used to paint from dark literals (a
       near-black pane, near-white ink), which read on the dark theme and
       vanished on every bright one. The pane, the ink and the grounds come from
       the themed tokens on :root now, and the identity is declared here the way
       tw.panel() declares it: the steel, taken deep under a bright look. */
    ${SURFACE} { display: contents; }
    .hc-targets {
      --acc: ${STEEL};
      --hc-window-accent: rgb(var(--acc));
      --hc-window-accent-quiet: rgb(var(--acc));
      --hc-window-wash: rgba(var(--acc), 0.10);
      --hc-window-wash-strong: rgba(var(--acc), 0.20);
      --hc-window-edge: rgba(var(--acc), 0.28);
      --hc-window-edge-firm: rgba(var(--acc), 0.62);
      --hc-window-on-accent: rgb(var(--hc-panel-pane));
      /* The designer's second colour — what is picked, named, or dropped on —
         brought down to this ground the way tw.ink() brings a colour down. */
      --hc-targets-mark: color-mix(in srgb, rgb(${ACCENT}), rgb(var(--hc-panel-ink)) var(--hc-deepen, 0%));
      position: fixed;
      top: max(calc(2.3rem * var(--hc-header-zoom, 1.0)), var(--hc-header-anchor, 0px));
      /* The lane writes the real edge inline — beside the control bar, and
         inboard of whatever else is docked on this side. */
      right: 0;
      bottom: 0;
      width: 340px; min-width: 260px; max-width: calc(100vw - 1.5rem);
      box-sizing: border-box; display: flex; flex-direction: column;
      z-index: 100002;
      background: rgba(var(--hc-panel-pane), 0.975);
      backdrop-filter: blur(14px) saturate(1.04);
      -webkit-backdrop-filter: blur(14px) saturate(1.04);
      border: 0; border-left: 1px solid rgba(var(--acc), 0.38); border-radius: 0;
      box-shadow: -14px 0 44px rgba(var(--hc-panel-shadow), 0.46);
      color: var(--hc-panel-text);
      font-family: var(--hc-mono, system-ui);
      font-size: calc(0.8125rem * var(--hc-panel-scale, 1));
      line-height: 1.45; overflow: hidden; outline: none;
    }
    :is([data-theme="light"],[data-theme="honey"],[data-theme="bloom"],[data-theme="sherbet"]) .hc-targets { --acc: ${STEEL_DEEP}; }
    @media (prefers-color-scheme: light) { :root:not([data-theme]) .hc-targets { --acc: ${STEEL_DEEP}; } }

    /* The shared header BAND — the same 2.875rem every docked window uses, so
       a row of them has one horizon. rem, not em: chrome height must not move
       when panel content scales. */
    .hc-targets-head {
      flex: 0 0 auto; box-sizing: border-box; display: flex; align-items: center;
      gap: 0.5rem; height: 2.875rem; min-height: 2.875rem; padding: 0 0.75rem;
      line-height: 1;
      background: linear-gradient(180deg, rgba(var(--hc-panel-sheen), 0.018), rgba(var(--hc-panel-sheen), 0.006));
      border-bottom: 1px solid var(--hc-window-edge);
    }
    .hc-targets-title {
      font-weight: 600; font-size: 0.9em; letter-spacing: 0.06em;
      text-transform: uppercase; color: var(--hc-window-accent);
    }
    .hc-targets-subject {
      flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap; color: var(--hc-window-ink-quiet);
    }
    .hc-targets-close {
      display: inline-grid; place-items: center;
      width: 1.75rem; height: 1.75rem; padding: 0;
      background: none; border: 0; border-radius: var(--hc-radius-control, 2px);
      color: var(--hc-window-ink-faint); font: inherit; font-size: 1.125rem;
      line-height: 1; cursor: pointer;
    }
    .hc-targets-close:hover { color: var(--hc-panel-text); background-color: rgba(var(--hc-panel-ink), 0.075); }
    .hc-targets-close:focus-visible { outline: 1px solid var(--hc-window-edge-firm); outline-offset: 1px; }

    .hc-targets-body {
      flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden;
    }

    .hc-targets-quiet {
      margin: 0; padding: 0.7rem 0.75rem;
      color: var(--hc-window-ink-quiet); font-size: 0.85em; line-height: 1.55;
    }

    /* THE CONTAINER, at reading size. It keeps its place while the properties
       below it scroll — a picture that scrolls out from under the panel naming
       it is a picture you have to hunt for. */
    .hc-targets-stage {
      flex: 0 0 auto; display: flex; margin: 0.6rem; padding: 0.35rem;
      min-height: 9rem; box-sizing: border-box;
      border: 1px solid var(--hc-window-line); border-radius: var(--hc-radius-card, 3px);
      background: var(--hc-window-tint); overflow: hidden;
    }
    /* THE CONTAINER IS DRAWN AT READING SIZE, and that has to be asked for.
       A layout's height is INTRINSIC by doctrine, so an arrangement with
       nothing seated in it collapses to one pixel. The height is given by the
       STAGE and taken by stretching, never by a min-height on the container:
       every level carries an inline min-height:0, and an inline declaration
       beats any rule here. */
    .hc-targets-stage > [data-hc-container] { flex: 1 1 auto; }
    .hc-targets-hole {
      position: relative; min-height: 2.4rem;
      border: 1px dashed var(--hc-window-edge); border-radius: var(--hc-radius-control, 2px);
      cursor: pointer; transition: background 120ms ease, border-color 120ms ease;
    }
    .hc-targets-hole:hover { background: var(--hc-window-wash); }
    .hc-targets-hole:focus-visible { outline: 1px solid var(--hc-targets-mark); outline-offset: -2px; }
    /* NAMED IS A SOLID EDGE — a declared interface. Dashed is a gap nobody has
       decided about yet. */
    .hc-targets-hole.is-named {
      border-style: solid;
      border-color: color-mix(in srgb, var(--hc-targets-mark) 75%, transparent);
    }
    .hc-targets-hole.is-picked {
      background: color-mix(in srgb, var(--hc-targets-mark) 16%, transparent);
      border-color: var(--hc-targets-mark);
    }
    .hc-targets-hole-name {
      position: absolute; top: 2px; left: 3px; right: 3px;
      font-size: 0.72em; color: var(--hc-window-ink-plain);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      pointer-events: none;
    }
    /* What is actually sitting in the hole, under its name. */
    .hc-targets-hole-fill {
      position: absolute; bottom: 2px; left: 3px; right: 3px;
      font-size: 0.7em; color: var(--hc-targets-mark);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      pointer-events: none;
    }

    /* A SECTION is not a seat. It is drawn as the branch it is — a quiet frame
       around the holes inside it, its name in its own margin where none of its
       children are. */
    .hc-targets-hole.is-section {
      border-style: solid; border-color: var(--hc-window-line-firm);
      padding-top: 0.9rem;
    }
    .hc-targets-hole.is-section.is-named {
      border-color: color-mix(in srgb, var(--hc-targets-mark) 45%, transparent);
    }
    .hc-targets-hole.is-section:hover { background: var(--hc-window-tint); }
    .hc-targets-hole.is-section > .hc-targets-hole-name {
      color: var(--hc-targets-mark);
      font-size: 0.68em; letter-spacing: 0.1em; text-transform: uppercase;
    }

    /* EVERY ANSWER IS A DOOR — a row of small chips, and a disabled one still
       shows, because "this cannot be filled that way" is an answer. */
    .hc-targets-answers {
      display: flex; flex-wrap: wrap; gap: 0.25rem; min-width: 0;
    }
    .hc-targets-put {
      padding: 0.15rem 0.4rem;
      background: color-mix(in srgb, var(--hc-targets-mark) 12%, transparent);
      border: 1px solid color-mix(in srgb, var(--hc-targets-mark) 45%, transparent);
      border-radius: var(--hc-radius-control, 2px);
      color: var(--hc-window-ink-loud);
      font: inherit; font-size: 0.78em; line-height: 1.4;
      cursor: pointer; transition: background 120ms ease, border-color 120ms ease;
    }
    .hc-targets-put:hover:not(:disabled) {
      background: color-mix(in srgb, var(--hc-targets-mark) 26%, transparent);
      border-color: var(--hc-targets-mark);
    }
    .hc-targets-put:disabled { opacity: 0.4; cursor: default; }

    .hc-targets-count {
      flex: 0 0 auto; margin: 0; padding: 0 0.75rem 0.5rem;
      color: var(--hc-window-ink-quiet);
      font-size: 0.72em; letter-spacing: 0.1em; text-transform: uppercase;
      border-bottom: 1px solid var(--hc-window-line);
    }

    /* WHAT THE DESIGN WOULD GROW. The indent is the answer — it says which
       tile each name hangs from. */
    .hc-targets-grow {
      flex: 0 0 auto;
      margin: 0; padding: 0.6rem 0.75rem 0.8rem;
      border-top: 1px solid var(--hc-window-line);
    }
    .hc-targets-grow-head {
      margin: 0 0 0.4rem; font-size: 0.72em; font-weight: 600;
      letter-spacing: 0.1em; text-transform: uppercase;
      color: var(--hc-window-ink-quiet);
    }
    .hc-targets-outline {
      list-style: none; margin: 0 0 0.6rem; padding: 0;
      max-height: 9rem; overflow-y: auto;
    }
    .hc-targets-outline li {
      position: relative;
      padding-top: 1px; padding-bottom: 1px;
      font-size: 0.8em; color: var(--hc-targets-mark);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .hc-targets-do.is-grow { width: 100%; }

    .hc-targets-props {
      flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden;
      padding: 0.6rem 0.75rem 1rem;
    }
    .hc-targets-hole-head {
      display: flex; align-items: baseline; justify-content: space-between;
      gap: 0.5rem; margin: 0 0 0.6rem; font-size: 0.92em; font-weight: 600;
    }
    .hc-targets-where {
      min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      color: var(--hc-targets-mark);
    }
    .hc-targets-slot {
      color: var(--hc-window-ink-quiet); font-size: 0.85em;
      font-variant-numeric: tabular-nums;
    }

    .hc-targets-field {
      display: grid; grid-template-columns: 4.5rem 1fr; align-items: center;
      gap: 0.5rem; margin-bottom: 0.4rem;
    }
    .hc-targets-label {
      font-size: 0.7em; letter-spacing: 0.14em; text-transform: uppercase;
      color: var(--hc-window-ink-quiet);
    }
    .hc-targets-input {
      width: 100%; min-width: 0; box-sizing: border-box; padding: 0.3rem 0.4rem;
      background: var(--hc-window-tint);
      border: 1px solid var(--hc-window-line-firm); border-radius: var(--hc-radius-control, 2px);
      color: inherit; font: inherit; font-size: 0.95em;
    }
    .hc-targets-input:focus-visible {
      outline: 1px solid var(--hc-targets-mark); outline-offset: -1px;
    }
    .hc-targets-preview {
      margin: 0.1rem 0 0.5rem; min-height: 1em; text-align: right;
      font-size: 0.85em; color: var(--hc-targets-mark);
    }

    .hc-targets-acts { display: flex; gap: 0.35rem; margin-bottom: 0.7rem; }
    .hc-targets-do {
      flex: 1 1 0; padding: 0.35rem 0.5rem;
      background: var(--hc-window-tint);
      border: 1px solid var(--hc-window-line-firm); border-radius: var(--hc-radius-control, 2px);
      color: inherit; font: inherit; font-size: 0.85em; letter-spacing: 0.06em;
      cursor: pointer;
    }
    .hc-targets-do:hover:not(:disabled) { border-color: var(--hc-targets-mark); }
    .hc-targets-do:disabled { opacity: 0.45; cursor: default; }
    .hc-targets-do.is-quiet { flex: 0 0 auto; }

    .hc-targets-row, .hc-targets-guide {
      margin: 0 0 0.45rem; font-size: 0.85em; line-height: 1.5;
      color: var(--hc-window-ink-plain);
    }
    .hc-targets-row .hc-targets-label { display: block; }
    .hc-targets-sig, .hc-targets-kind {
      font-family: var(--hc-mono, ui-monospace), monospace;
      color: var(--hc-window-ink-loud);
    }
    .hc-targets-empty { color: var(--hc-window-ink-quiet); font-style: italic; }
    .hc-targets-visit {
      padding: 0; background: none; border: 0;
      border-bottom: 1px solid color-mix(in srgb, var(--hc-targets-mark) 50%, transparent);
      color: var(--hc-targets-mark); font: inherit; cursor: pointer;
    }
    .hc-targets-guide {
      margin-top: 0.6rem; padding-top: 0.5rem;
      border-top: 1px solid var(--hc-window-line);
      color: var(--hc-window-ink-quiet);
    }
  `
  document.head.appendChild(style)
}

// Contribute the surface the doctrine way: define the element, then add it to
// the registry — never a tag in either app.html, and never an Angular class in
// the shared barrel.
;(window as { ioc?: { whenReady?: (k: string, cb: (v: { add(s: unknown): void }) => void) => void } })
  .ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', registry => {
    if (!customElements.get(SURFACE)) customElements.define(SURFACE, LayoutTargetsElement)
    try {
      registry.add({ name: SURFACE, owner: OWNER, element: SURFACE, order: 138 })
    } catch {
      // duplicate add (hot reload) — the mounted surface is already live
    }
  })
