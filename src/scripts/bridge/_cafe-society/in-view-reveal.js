// script:in-view-reveal — one behaviour, no look of its own.
//
//   <in-view-reveal> … <div data-reveal>…</div> … </in-view-reveal>
//
// WHAT IT DOES. A block marked `data-reveal` waits until a quarter of it is on
// screen, then plays its entrance once. Blocks that share a parent enter one
// after another.
//
// THE PAGE IS WHOLE WITHOUT IT. The stylesheet plays every entrance on load by
// itself, so with no script nothing is ever left hidden. This module only
// HOLDS the blocks that are not on screen yet (`data-wait`) and lets each go
// when it arrives; a block already on screen is left alone, so nothing that
// can be seen is ever hidden and shown again.
//
// The motion itself — distance, time, curve — is the stylesheet's. This names
// no class and sets one variable, `--reveal-delay`.

const QUARTER = 0.25
const STEP_MS = 80
const LONGEST_MS = 400

class InViewReveal extends HTMLElement {
  #observer = null

  connectedCallback() {
    if (!('IntersectionObserver' in window)) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    this.#observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.removeAttribute('data-wait')
        this.#observer?.unobserve(entry.target)
      }
    }, { threshold: QUARTER })

    const height = window.innerHeight || document.documentElement.clientHeight
    for (const block of this.querySelectorAll('[data-reveal]')) {
      const box = block.getBoundingClientRect()
      // On screen already: its entrance is playing, or has played.
      if (box.top < height && box.bottom > 0) continue
      const earlier = [...(block.parentElement?.children ?? [])].filter(el => el.hasAttribute('data-reveal'))
      const turn = Math.max(0, earlier.indexOf(block))
      block.style.setProperty('--reveal-delay', `${Math.min(turn * STEP_MS, LONGEST_MS)}ms`)
      block.setAttribute('data-wait', '')
      this.#observer.observe(block)
    }
  }

  disconnectedCallback() {
    this.#observer?.disconnect()
    this.#observer = null
  }
}

if (!customElements.get('in-view-reveal')) customElements.define('in-view-reveal', InViewReveal)
