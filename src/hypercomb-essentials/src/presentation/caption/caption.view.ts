// presentation/caption/caption.view.ts
//
// THE CAPTION — one quiet place for "what am I looking at / what does this do",
// top-centre, just under the command line. A hovered icon used to open its own
// dropdown pill on the canvas, which sat on top of the tiles it explained and
// moved with the camera; the images wall drew its own title in the scene. Both
// now SAY it here, and anything else that has a sentence for the participant
// can do the same without drawing it.
//
//   EffectBus 'caption:show'  { source, title?, text? }   — put words up
//   EffectBus 'caption:clear' { source }                  — take them down
//
// `source` names who is speaking, so two speakers never erase each other: each
// owns one slot, the most recent show is the one on screen, and clearing a
// source shows whichever slot spoke before it (or nothing). The words are drawn
// as text, never markup. The caption never takes the pointer.
//
// A dependency: it exports the element; the caption's bee (caption.drone.ts)
// defines it and adds it to the ShellSurfaceRegistry.

import { EffectBus } from '@hypercomb/core'

export const CAPTION_SURFACE = 'hc-caption'
export const CAPTION_OWNER = '@diamondcoreprocessor.com/CaptionView'

/** `icon` is a source's own SVG markup, drawn as a mask (so it takes the theme's ink and can run no script). */
export type CaptionShow = { source: string; title?: string; text?: string; icon?: string }
export type CaptionClear = { source: string }

const STYLE_ID = 'hc-caption-style'

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    ${CAPTION_SURFACE} { display: contents; }
    .hc-caption {
      position: fixed;
      top: calc(var(--hc-header-anchor, 2.3rem) + 0.6rem);
      left: 50%; transform: translateX(-50%);
      display: flex; align-items: center; gap: 1rem;
      max-width: min(52rem, calc(100vw - 2rem));
      box-sizing: border-box; padding: 0.55rem 1.25rem 0.6rem 1.35rem;
      z-index: 100001; pointer-events: none; user-select: none;
      text-align: left;
      background: rgba(var(--hc-panel-pane, 12, 19, 27), 0.9);
      backdrop-filter: blur(12px) saturate(1.05); -webkit-backdrop-filter: blur(12px) saturate(1.05);
      border: 1px solid var(--hc-window-line, rgba(227, 237, 245, 0.14));
      border-bottom: 2px solid var(--hc-window-accent, #7eb6d6);
      border-radius: 0.25rem;
      box-shadow: 0 0.6rem 1.8rem rgba(0, 0, 0, 0.28);
      color: var(--hc-window-ink-plain, rgba(227, 237, 245, 0.86));
      /* the hive's own light face — the words are quiet, the picture is the loud thing */
      font-family: var(--hc-font, system-ui, sans-serif); font-weight: 300;
    }
    /* the corner mark: a lit triangle where the label starts */
    .hc-caption::before {
      content: ''; position: absolute; left: 0; top: 0; width: 0; height: 0;
      border-style: solid; border-width: 0.7rem 0.7rem 0 0;
      border-color: var(--hc-window-accent, #7eb6d6) transparent transparent transparent;
      opacity: 0.9;
    }
    .hc-caption[hidden] { display: none; }
    .hc-caption-title {
      flex: 0 0 auto; max-width: 24rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-size: calc(1.6rem * var(--hc-panel-scale, 1)); font-weight: 300; line-height: 1.1; letter-spacing: 0.03em;
      color: var(--hc-window-ink-loud, #eef2f5);
    }
    .hc-caption-icon {
      flex: none; width: 1.5rem; height: 1.5rem; background: var(--hc-window-accent, #7eb6d6);
      -webkit-mask: var(--hc-caption-icon) center / contain no-repeat; mask: var(--hc-caption-icon) center / contain no-repeat;
    }
    .hc-caption-text {
      flex: 1 1 auto; min-width: 0; max-width: 26rem;
      padding-left: 1rem; border-left: 1px solid var(--hc-window-line, rgba(227, 237, 245, 0.22));
      font-size: calc(0.95rem * var(--hc-panel-scale, 1)); font-weight: 300; line-height: 1.4; letter-spacing: 0.01em;
      color: var(--hc-window-ink-quiet, rgba(227, 237, 245, 0.68));
    }
    .hc-caption-title[hidden], .hc-caption-icon[hidden], .hc-caption-text[hidden] { display: none; }
  `
  document.head.appendChild(style)
}

export class CaptionElement extends HTMLElement {
  /** What each source last said, oldest first — the last entry is on screen. */
  #slots = new Map<string, CaptionShow>()
  #box: HTMLDivElement | null = null
  #title: HTMLDivElement | null = null
  #icon: HTMLSpanElement | null = null
  #text: HTMLDivElement | null = null
  #off: Array<() => void> = []

  connectedCallback(): void {
    ensureStyles()
    const box = document.createElement('div')
    box.className = 'hc-caption'
    box.hidden = true
    box.setAttribute('role', 'status')
    box.setAttribute('aria-live', 'polite')
    this.#title = document.createElement('div')
    this.#title.className = 'hc-caption-title'
    this.#icon = document.createElement('span')
    this.#icon.className = 'hc-caption-icon'
    this.#icon.setAttribute('aria-hidden', 'true')
    this.#text = document.createElement('div')
    this.#text.className = 'hc-caption-text'
    // label, then its icon, then what it says — the explanation sits to the right
    box.append(this.#title, this.#icon, this.#text)
    this.append(box)
    this.#box = box
    this.#off = [
      EffectBus.on<CaptionShow>('caption:show', (p) => this.#show(p)),
      EffectBus.on<CaptionClear>('caption:clear', (p) => this.#clear(p)),
    ]
  }

  disconnectedCallback(): void {
    for (const off of this.#off) off()
    this.#off = []
    this.#slots.clear()
    this.replaceChildren()
    this.#box = this.#title = this.#icon = this.#text = null
  }

  #show(p: CaptionShow | undefined): void {
    const source = String(p?.source ?? '').trim()
    const title = String(p?.title ?? '').trim()
    const text = String(p?.text ?? '').trim()
    const icon = String(p?.icon ?? '')
    if (!source) return
    if (!title && !text) { this.#clear({ source }); return }
    // Saying the same thing again changes nothing — a source repeating itself on
    // every pointer move must not climb over a newer speaker.
    const held = this.#slots.get(source)
    if (held && held.title === title && held.text === text && held.icon === icon) return
    // Saying something new moves the source to the newest place, so it is the one shown.
    this.#slots.delete(source)
    this.#slots.set(source, { source, title, text, icon })
    this.#paint()
  }

  #clear(p: CaptionClear | undefined): void {
    if (!this.#slots.delete(String(p?.source ?? '').trim())) return
    this.#paint()
  }

  #paint(): void {
    if (!this.#box || !this.#title || !this.#icon || !this.#text) return
    const now = [...this.#slots.values()].pop()
    this.#box.hidden = !now
    this.#title.textContent = now?.title ?? ''
    this.#title.hidden = !now?.title
    // The icon is the source's own SVG as a data-URI MASK: inert (no script runs
    // from a mask) and drawn in the theme's ink.
    this.#icon.hidden = !now?.icon
    if (now?.icon) this.#icon.style.setProperty('--hc-caption-icon', `url("data:image/svg+xml;utf8,${encodeURIComponent(now.icon)}")`)
    this.#text.textContent = now?.text ?? ''
    this.#text.hidden = !now?.text
  }
}
