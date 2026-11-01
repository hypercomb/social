// assistant/doctrine-window.view.ts
//
// THE DOCTRINE VIEWER — choose which rules every model is sent.
//
// Opened by `/doctrine` (or the `doctrine:open` effect). The codex is a list of
// axioms that each stand alone, so the doctrine is whatever set of them the
// participant chooses: tick any rule, any tier, in any combination. Nothing is
// refused. A rule whose ground is left out is flagged and can pull its ground
// in with one word, but that is advice, not a gate. Rules the hive wrote itself
// (sections the codex does not own) are never touched.
//
// Applying is a forward commit to the `system:doctrine` bag, like every other
// doctrine act, so `doctrine back` undoes it. `copy` puts the composed text on
// the clipboard for any agent outside the hive.
//
// A panel, not a takeover — cold chrome, DOM singleton, no Angular; the same
// shape as skills-window.view.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { ANATOMY_IOC_KEY, type AnatomyLike } from './anatomy/anatomy.service.js'
import { ANATOMY_CODEX, ANATOMY_MECHANICS, ANATOMY_SECTIONS } from './anatomy/anatomy.generated.js'
import { composeAnatomy } from './anatomy/doctrine.js'
import {
  composeSelection, foreignSections, groundOf, looseGround, parseCodex, restingOn, selectedIds, withGround,
  type CodexTier,
} from './anatomy/codex.js'

const STYLE_ID = 'hc-doctrine-styles'
const STEEL = '126, 182, 214'
const AMBER = '224, 178, 92'
const MIN_WIDTH = 320

const ioc = <T,>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => a.size === b.size && [...a].every(id => b.has(id))

export class DoctrineWindowView extends EventTarget {
  #panel: HTMLDivElement | null = null
  #tiers: CodexTier[] = parseCodex(ANATOMY_CODEX)
  #chosen = new Set<string>()
  #head = new Set<string>()
  #foreign: string[] = []
  #open: number | null = null
  #resizeCleanup: (() => void) | null = null

  #onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.#panel) { event.stopPropagation(); this.close() }
  }

  constructor() {
    super()
    EffectBus.on('doctrine:open', () => { void this.show() })
  }

  #t(key: string, fallback: string, params?: Record<string, string | number>): string {
    const value = ioc<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
    const text = value && value !== key ? value : fallback
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
  }

  #toast(message: string, type = 'info'): void { EffectBus.emit('toast:show', { type, message }) }

  async show(): Promise<void> {
    if (this.#panel) { this.close(); return }
    const doctrine = ioc<AnatomyLike>(ANATOMY_IOC_KEY)?.doctrine
    if (!doctrine) { this.#toast(this.#t('doctrine.unavailable', 'The doctrine is not available here.'), 'warning'); return }
    await doctrine.ready
    this.#adopt(doctrine.texts())
    this.#build()
    this.#render()
  }

  /** Read the head: which rules it carries, and the sections that are the hive's own. */
  #adopt(sections: readonly string[]): void {
    this.#head = selectedIds(sections, this.#tiers)
    this.#chosen = new Set(this.#head)
    this.#foreign = foreignSections(sections, this.#tiers)
  }

  #sections(): string[] { return composeSelection(this.#tiers, this.#chosen, this.#foreign) }
  #dirty(): boolean { return !sameSet(this.#chosen, this.#head) }

  #build(): void {
    this.#ensureStyles()
    const panel = document.createElement('div')
    panel.className = 'hc-doctrine'

    const resize = document.createElement('div')
    resize.className = 'hc-doctrine-resize'
    resize.setAttribute('aria-hidden', 'true')
    resize.addEventListener('pointerdown', event => this.#beginResize(event))

    const head = document.createElement('div')
    head.className = 'hc-doctrine-head'
    const title = document.createElement('div')
    title.className = 'hc-doctrine-title'
    title.textContent = this.#t('doctrine.title', 'Doctrine')
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'hc-doctrine-close'
    close.textContent = '×'
    close.setAttribute('aria-label', this.#t('doctrine.close', 'Close'))
    close.addEventListener('click', () => this.close())
    head.append(title, close)

    panel.append(resize, head)
    document.body.appendChild(panel)
    this.#panel = panel
    document.addEventListener('keydown', this.#onKey, true)
  }

  #render(): void {
    const panel = this.#panel
    if (!panel) return
    panel.querySelectorAll('.hc-doctrine-sum, .hc-doctrine-body, .hc-doctrine-foot').forEach(node => node.remove())

    const total = this.#tiers.reduce((sum, tier) => sum + tier.axioms.length, 0)
    const loose = looseGround(this.#tiers, this.#chosen)
    const tokens = Math.round(composeAnatomy(ANATOMY_MECHANICS, this.#sections()).length / 4)

    const sum = document.createElement('div')
    sum.className = 'hc-doctrine-sum'
    const count = document.createElement('span')
    count.textContent = this.#t('doctrine.count', '{chosen} of {total} rules · about {tokens} tokens', { chosen: this.#chosen.size, total, tokens })
    sum.appendChild(count)
    if (loose.length) {
      const warn = document.createElement('button')
      warn.type = 'button'
      warn.className = 'hc-doctrine-word hc-doctrine-warn'
      warn.textContent = this.#t('doctrine.loose', '{n} rest on rules you left out — include them', { n: loose.length })
      warn.addEventListener('click', () => { this.#chosen = withGround(this.#tiers, this.#chosen); this.#render() })
      sum.appendChild(warn)
    }

    const body = document.createElement('div')
    body.className = 'hc-doctrine-body'
    this.#tiers.forEach((tier, at) => body.appendChild(this.#tierNode(tier, at)))

    const foot = document.createElement('div')
    foot.className = 'hc-doctrine-foot'
    const word = (label: string, title: string, run: () => void, on = true, primary = false): HTMLButtonElement => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `hc-doctrine-word${primary ? ' hc-doctrine-primary' : ''}`
      button.textContent = label
      button.title = title
      button.disabled = !on
      button.addEventListener('click', run)
      return button
    }
    foot.append(
      word(this.#t('doctrine.apply', 'apply'), this.#t('doctrine.apply-title', 'Commit this choice as the doctrine; it applies from the next message'), () => void this.#apply(), this.#dirty() && this.#chosen.size > 0, true),
      word(this.#t('doctrine.reset', 'reset'), this.#t('doctrine.reset-title', 'Back to the doctrine the hive runs now'), () => { this.#chosen = new Set(this.#head); this.#render() }, this.#dirty()),
      word(this.#t('doctrine.build', 'build'), this.#t('doctrine.build-title', 'Choose what this build ships'), () => { this.#chosen = selectedIds(ANATOMY_SECTIONS, this.#tiers); this.#render() }),
      word(this.#t('doctrine.all', 'all'), this.#t('doctrine.all-title', 'Choose every rule, the builders’ tier too'), () => { this.#chosen = new Set(this.#tiers.flatMap(tier => tier.axioms.map(axiom => axiom.id))); this.#render() }),
      word(this.#t('doctrine.copy', 'copy'), this.#t('doctrine.copy-title', 'Copy the anatomy this choice makes, for any agent'), () => void this.#copy()),
    )
    panel.append(sum, body, foot)
  }

  #tierNode(tier: CodexTier, at: number): HTMLElement {
    const ids = tier.axioms.map(axiom => axiom.id)
    const on = ids.filter(id => this.#chosen.has(id)).length
    const wrap = document.createElement('div')
    wrap.className = 'hc-doctrine-tier'

    const row = document.createElement('div')
    row.className = 'hc-doctrine-tierhead'
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = on === ids.length
    box.indeterminate = on > 0 && on < ids.length
    box.setAttribute('aria-label', tier.title)
    box.addEventListener('change', () => {
      for (const id of ids) box.checked ? this.#chosen.add(id) : this.#chosen.delete(id)
      this.#render()
    })
    const name = document.createElement('button')
    name.type = 'button'
    name.className = 'hc-doctrine-tiername'
    name.textContent = tier.title + (tier.scope === 'all' ? '' : ` · ${tier.scope}`)
    name.addEventListener('click', () => { this.#open = this.#open === at ? null : at; this.#render() })
    const tally = document.createElement('span')
    tally.className = 'hc-doctrine-tally'
    tally.textContent = `${on}/${ids.length}`
    row.append(box, name, tally)
    wrap.appendChild(row)

    if (this.#open === at) for (const axiom of tier.axioms) wrap.appendChild(this.#axiomNode(axiom.id, axiom.rule, axiom.needs))
    return wrap
  }

  #axiomNode(id: string, rule: string, needs: readonly string[]): HTMLElement {
    const row = document.createElement('label')
    row.className = 'hc-doctrine-axiom'
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = this.#chosen.has(id)
    box.addEventListener('change', () => { box.checked ? this.#chosen.add(id) : this.#chosen.delete(id); this.#render() })
    const text = document.createElement('span')
    text.className = 'hc-doctrine-text'
    const tag = document.createElement('span')
    tag.className = 'hc-doctrine-id'
    tag.textContent = id
    text.append(tag, ` ${rule}`)
    if (needs.length) {
      const rests = document.createElement('span')
      rests.className = 'hc-doctrine-needs'
      const ground = groundOf(this.#tiers, id)
      const left = this.#chosen.has(id) ? ground.filter(need => !this.#chosen.has(need)) : []
      rests.classList.toggle('hc-doctrine-loose', left.length > 0)
      rests.textContent = this.#t('doctrine.rests', 'rests on {ids}', { ids: needs.join(' ') })
      const resting = restingOn(this.#tiers, id).filter(other => this.#chosen.has(other))
      if (!this.#chosen.has(id) && resting.length) rests.textContent += ` · ${this.#t('doctrine.leftout', '{ids} rest on it', { ids: resting.join(' ') })}`
      text.appendChild(rests)
    }
    row.append(box, text)
    return row
  }

  async #apply(): Promise<void> {
    const doctrine = ioc<AnatomyLike>(ANATOMY_IOC_KEY)?.doctrine
    if (!doctrine) return
    const outcome = await doctrine.replace(this.#sections())
    if (!outcome.ok) { this.#toast(outcome.error, 'error'); return }
    this.#adopt(doctrine.texts())
    this.#toast(this.#t('doctrine.changed', '{what} The doctrine has {count} sections; it applies from the next message.', {
      what: this.#t('doctrine.chosen', 'Doctrine chosen.'), count: outcome.state.sections.length,
    }), 'success')
    this.#render()
  }

  async #copy(): Promise<void> {
    const text = composeAnatomy(ANATOMY_MECHANICS, this.#sections())
    try {
      await navigator.clipboard.writeText(text)
      this.#toast(this.#t('doctrine.copied', 'Copied the anatomy this choice makes.'), 'success')
    } catch {
      this.#toast(this.#t('doctrine.copy-failed', 'The clipboard would not take it.'), 'warning')
    }
  }

  close(): void {
    document.removeEventListener('keydown', this.#onKey, true)
    this.#resizeCleanup?.()
    this.#resizeCleanup = null
    this.#panel?.remove()
    this.#panel = null
    this.#open = null
  }

  #beginResize(event: PointerEvent): void {
    const panel = this.#panel
    if (!panel) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = panel.getBoundingClientRect().width
    const move = (next: PointerEvent): void => {
      const right = Math.max(16, window.innerWidth - panel.getBoundingClientRect().right)
      const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - right - 16)
      panel.style.width = `${Math.min(maxWidth, Math.max(MIN_WIDTH, startWidth + startX - next.clientX))}px`
    }
    const finish = (): void => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', finish, true)
      window.removeEventListener('pointercancel', finish, true)
      this.#resizeCleanup = null
    }
    this.#resizeCleanup?.()
    this.#resizeCleanup = finish
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', finish, true)
    window.addEventListener('pointercancel', finish, true)
  }

  #ensureStyles(): void {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
.hc-doctrine{position:fixed;z-index:99999;display:flex;flex-direction:column;gap:0.55rem;
  right:calc(var(--hc-controls-right, 0px) + 1rem);bottom:1rem;width:min(26rem,calc(100vw - 2rem));
  max-height:min(38rem,80vh);padding:0.75rem 0.85rem;box-sizing:border-box;
  background:rgba(6,9,14,0.96);border:1px solid rgba(${STEEL},0.35);border-radius:var(--hc-radius-floating, 4px);}
.hc-doctrine-resize{position:absolute;z-index:1;inset:0 auto 0 -0.35rem;width:0.7rem;cursor:ew-resize;}
.hc-doctrine-resize::after{content:"";position:absolute;top:42%;bottom:42%;left:0.25rem;
  border-left:1px solid rgba(${STEEL},0.42);}
.hc-doctrine-head{display:flex;align-items:center;gap:0.5rem;flex:0 0 auto;}
.hc-doctrine-title{flex:1 1 auto;font-family:var(--hc-mono,monospace);font-size:0.76rem;font-weight:600;
  letter-spacing:0.1em;text-transform:uppercase;color:rgba(${STEEL},0.95);}
.hc-doctrine-close{width:2rem;height:2rem;border:none;background:none;color:rgba(245,245,245,0.4);
  font-size:1.3rem;line-height:1;cursor:pointer;border-radius:var(--hc-radius-control, 2px);}
.hc-doctrine-close:hover{color:whitesmoke;background:rgba(255,255,255,0.07);}
.hc-doctrine-sum{display:flex;flex-wrap:wrap;gap:0.2rem 0.8rem;flex:0 0 auto;font-size:0.76rem;color:rgba(216,230,238,0.62);}
.hc-doctrine-body{flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:0.15rem;
  font-size:0.85rem;color:rgba(238,244,250,0.9);}
.hc-doctrine-tierhead{display:flex;align-items:center;gap:0.5rem;padding:0.1rem 0.2rem;}
.hc-doctrine-tierhead:hover{background:rgba(255,255,255,0.045);}
.hc-doctrine-tiername{flex:1 1 auto;min-width:0;border:0;background:none;text-align:left;font:inherit;font-size:0.78rem;
  letter-spacing:0.06em;text-transform:uppercase;color:rgba(${STEEL},0.85);cursor:pointer;padding:0.25rem 0;}
.hc-doctrine-tally{flex:0 0 auto;font-family:var(--hc-mono,monospace);font-size:0.7rem;color:rgba(216,230,238,0.5);}
.hc-doctrine-axiom{display:flex;align-items:flex-start;gap:0.5rem;margin:0 0 0.1rem 1.4rem;padding:0.2rem 0.3rem;
  border-radius:var(--hc-radius-control, 2px);cursor:pointer;}
.hc-doctrine-axiom:hover{background:rgba(255,255,255,0.045);}
.hc-doctrine-axiom input,.hc-doctrine-tierhead input{margin:0.2rem 0 0;flex:0 0 auto;accent-color:rgb(${STEEL});}
.hc-doctrine-tierhead input{margin:0;}
.hc-doctrine-text{flex:1 1 auto;min-width:0;font-size:0.8rem;line-height:1.45;word-break:break-word;color:rgba(238,244,250,0.86);}
.hc-doctrine-id{font-family:var(--hc-mono,monospace);font-size:0.7rem;color:rgba(${STEEL},0.9);}
.hc-doctrine-needs{display:block;font-size:0.7rem;color:rgba(216,230,238,0.42);}
.hc-doctrine-loose{color:rgba(${AMBER},0.95);}
.hc-doctrine-foot{display:flex;flex-wrap:wrap;gap:0.2rem 1rem;flex:0 0 auto;}
.hc-doctrine-word{border:0;background:none;padding:0.2rem 0;font:inherit;font-size:0.76rem;letter-spacing:0.06em;
  text-transform:uppercase;color:rgba(${STEEL},0.8);cursor:pointer;}
.hc-doctrine-word:hover:not(:disabled){color:whitesmoke;}
.hc-doctrine-word:disabled{opacity:0.35;cursor:default;}
.hc-doctrine-primary:not(:disabled){color:rgb(${STEEL});font-weight:600;}
.hc-doctrine-warn{text-transform:none;letter-spacing:0;color:rgba(${AMBER},0.95);}
`
    document.head.appendChild(style)
  }
}
