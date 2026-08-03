// diamondcoreprocessor.com/presentation/tiles/viewer-scroller.ts
//
// THE SCROLLER — the browser's own vertical scrolling as a viewer surface.
//
// A phone already has a perfect gesture for "more of this": the flick. The
// paged stage answers it with a synthetic threshold-and-commit step; this
// module answers it with a REAL scroller — native momentum, one full-viewport
// section per item, mandatory snap so a flick lands exactly one item on. The
// sideways axis is deliberately left alone (`touch-action: pan-y`), so a
// viewer can keep the tile walk (viewer-walk.ts bindAxes `sideways`) bound on
// its host: a vertical drag scrolls natively (the browser cancels the pointer
// stream, so bindAxes never sees a release to commit), a horizontal drag is
// NOT handled by the scroller and reaches the walk untouched. The two axes of
// the orthogonal grammar keep their meanings — ↕ is simply native now.
//
// GENERIC ON PURPOSE. Any viewer whose vertical axis means "the next thing
// inside what I'm looking at" can mount one of these and become a scroller:
// hand it sections, listen for the index. The slides/lightbox viewer is the
// first adopter (mobile); nothing here knows what a slide is.
//
// MEDIA DISCIPLINE (the feed rules):
//   • content resolves LAZILY — a section builds its element when it nears
//     the viewport (about one viewport ahead), never all up front, so a
//     hundred-slide deck opens as fast as a three-slide one
//   • whatever plays, STOPS when its section scrolls away (pause on leave) —
//     nothing keeps sounding from off-screen
//   • an EMBED (iframe) never mounts on scroll: a full-viewport iframe both
//     swallows the scroll gesture over it and only stops playing when it
//     leaves the DOM. It mounts on TAP (a placeholder card shows first) and
//     unmounts again when its section scrolls away.

export type ScrollerSection = {
  /** Stable identity — the content sig or URL. `setSections` with the same
   *  key sequence is a no-op, so a refresh never jolts the scroll position. */
  readonly key: string
  /** Shown on the tap-to-load placeholder (deferred sections only). */
  readonly title: string
  /** Build the section's element. Called once, when the section first nears
   *  the viewport (or is tapped, when deferred). Null = nothing to show. */
  readonly resolve: () => Promise<HTMLElement | null>
  /** Mount on TAP instead of on approach, and unmount again on leave — the
   *  iframe rule above. */
  readonly deferToTap?: boolean
}

export type ScrollerHandle = {
  /** The scroll container — append it to the viewer's host. */
  readonly element: HTMLElement
  /** Replace the sections. Same key sequence = no-op (refresh-safe). */
  setSections(sections: readonly ScrollerSection[]): void
  /** Scroll to a section (clamped) — the programmatic twin of a flick. */
  show(index: number): void
  /** The section the participant is currently on. */
  current(): number
  /** A section's cell element (its content mounts inside), for callers that
   *  need to ask about what is on screen — e.g. "is a player up right now". */
  sectionElement(index: number): HTMLElement | null
  /** Stop everything and disconnect the observers. The caller owns removing
   *  `element` from the DOM. */
  destroy(): void
}

type SectionState = {
  readonly section: ScrollerSection
  /** The full-viewport snap cell; content mounts inside it. */
  readonly el: HTMLElement
  content: HTMLElement | null
  placeholder: HTMLElement | null
  resolving: boolean
}

/** Steel/dim accents shared with the slides chrome — cold/clean, no glow. */
const STEEL = 'rgba(126,182,214,0.92)'
const DIM = 'rgba(207,226,238,0.55)'

export function mountViewerScroller(opts: {
  /** The participant arrived on another section — fires for NATIVE scrolling
   *  and `show()` alike. Sync chrome here; never re-scroll from it. */
  readonly onIndexChange?: (index: number) => void
  /** Label under the play glyph on a deferred section's placeholder. */
  readonly tapHint?: string
} = {}): ScrollerHandle {
  const container = document.createElement('div')
  container.style.cssText =
    'position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;' +
    'overscroll-behavior:contain;scroll-snap-type:y mandatory;' +
    'touch-action:pan-y;scrollbar-width:none;'

  let states: SectionState[] = []
  let index = 0
  /** Bumped by every rebuild; a resolve that lands from a previous section
   *  set must not mount into the new one. */
  let generation = 0

  const pauseWithin = (el: HTMLElement): void => {
    el.querySelectorAll('video, audio').forEach(media => {
      try { (media as HTMLMediaElement).pause() } catch { /* already gone */ }
    })
  }

  const mountContent = (state: SectionState, gen: number): void => {
    if (state.content || state.resolving) return
    state.resolving = true
    void state.section.resolve().then(el => {
      state.resolving = false
      if (gen !== generation || !el) return
      state.content = el
      state.el.replaceChildren(el)
    }).catch(() => { state.resolving = false })
  }

  const buildPlaceholder = (state: SectionState): HTMLElement => {
    const card = document.createElement('button')
    card.type = 'button'
    card.style.cssText =
      'display:flex;flex-direction:column;align-items:center;gap:14px;' +
      `border:1px solid rgba(126,182,214,0.35);border-radius:14px;` +
      'background:rgba(255,255,255,0.04);color:#eaf3f9;cursor:pointer;' +
      'padding:2.2rem 2.6rem;max-width:82vw;font-family:inherit;'
    const glyph = document.createElement('div')
    glyph.textContent = '▶'
    glyph.style.cssText = `font-size:2.2rem;color:${STEEL};line-height:1;`
    const title = document.createElement('div')
    title.textContent = state.section.title
    title.style.cssText =
      'font-size:15px;font-weight:600;max-width:100%;overflow:hidden;' +
      'text-overflow:ellipsis;white-space:nowrap;'
    const hint = document.createElement('div')
    hint.textContent = opts.tapHint ?? 'Tap to play'
    hint.style.cssText = `font-size:12px;color:${DIM};`
    card.append(glyph, title, hint)
    card.addEventListener('click', () => mountContent(state, generation))
    return card
  }

  const stateAt = (target: Element): SectionState | undefined =>
    states[Number((target as HTMLElement).dataset['index'])]

  // NEAR — mounts content about one viewport before it arrives, so arriving
  // never shows a blank frame. Deferred sections wait for their tap instead.
  const near = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const state = stateAt(entry.target)
      if (!state || !entry.isIntersecting || state.section.deferToTap) continue
      mountContent(state, generation)
    }
  }, { root: container, rootMargin: '120% 0px' })

  // CURRENT — majority-visible is the section the participant is on. Leaving
  // it pauses whatever it was playing; a deferred section also unmounts back
  // to its placeholder (an iframe only stops when it leaves the DOM).
  const current = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const state = stateAt(entry.target)
      if (!state) continue
      if (entry.isIntersecting) {
        const at = states.indexOf(state)
        if (at >= 0 && at !== index) { index = at; opts.onIndexChange?.(at) }
        continue
      }
      pauseWithin(state.el)
      if (state.section.deferToTap && state.content && state.placeholder) {
        state.content = null
        state.el.replaceChildren(state.placeholder)
      }
    }
  }, { root: container, threshold: 0.6 })

  const setSections = (sections: readonly ScrollerSection[]): void => {
    const sameKeys = sections.length === states.length
      && sections.every((section, i) => section.key === states[i].section.key)
    if (sameKeys) return
    generation++
    near.disconnect()
    current.disconnect()
    for (const state of states) pauseWithin(state.el)
    states = sections.map((section, i) => {
      const el = document.createElement('div')
      el.dataset['index'] = String(i)
      el.style.cssText =
        'height:100%;scroll-snap-align:start;scroll-snap-stop:always;' +
        'position:relative;display:flex;align-items:center;justify-content:center;' +
        'overflow:hidden;'
      const state: SectionState = { section, el, content: null, placeholder: null, resolving: false }
      if (section.deferToTap) {
        state.placeholder = buildPlaceholder(state)
        el.appendChild(state.placeholder)
      }
      return state
    })
    container.replaceChildren(...states.map(state => state.el))
    for (const state of states) { near.observe(state.el); current.observe(state.el) }
    index = Math.min(index, Math.max(0, states.length - 1))
  }

  return {
    element: container,
    setSections,
    show: (i: number): void => {
      const n = states.length
      if (!n) return
      const at = Math.max(0, Math.min(i, n - 1))
      // Sections are exactly one container-height each, so the snap offset is
      // arithmetic — no element measurement, no layout thrash.
      container.scrollTo({ top: at * container.clientHeight, behavior: 'smooth' })
    },
    current: (): number => index,
    sectionElement: (i: number): HTMLElement | null => states[i]?.el ?? null,
    destroy: (): void => {
      near.disconnect()
      current.disconnect()
      for (const state of states) pauseWithin(state.el)
    },
  }
}
