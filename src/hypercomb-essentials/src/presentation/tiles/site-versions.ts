// presentation/tiles/site-versions.ts
//
// THE VERSIONS OF ONE PAGE, TOGGLED AND COMPARED (documentation/
// page-contributions.md, step 4; jwize 2026-11-12: "we want to develop across
// domains and toggle between them and compare").
//
// A small round button above the site's pencil says how many versions of this
// page are offered — the published one, then every contribution the hosts this
// reader follows hold for it (sharing/page-contributions.ts readContributions).
// Its panel lists them newest first: who, where, when, and whether it changes
// only words.
//
//   - Clicking a row SHOWS that version here, for this reader alone. Nothing is
//     published and nobody else sees it. Only a words-only version can be shown
//     live: it runs exactly what the published page runs. One that changes more
//     is compare-only until the activation gate has been asked about it.
//   - Ticking two rows COMPARES them: the visible text of each, diffed with the
//     same line diff the what-changed panel uses (assistant/line-diff.ts).

import { diffLines } from '../../assistant/line-diff.js'
import { inertPageText } from './page-run-gate.js'
import type { PageContribution } from '../../sharing/page-contributions.js'

const STYLE_ID = 'hc-site-versions-style'
const STYLE = `
#hc-site-versions-toggle{position:fixed;z-index:2147483600;width:2.25rem;height:2.25rem;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(12,17,24,.82);border:1px solid rgba(126,182,214,.42);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);box-shadow:0 2px 10px rgba(0,0,0,.45);color:#cfe2ee;cursor:pointer;font-family:'Material Symbols Outlined';font-size:1.1rem;line-height:1;padding:0;opacity:.6;transition:opacity .16s ease,background .16s ease}
#hc-site-versions-toggle:hover,#hc-site-versions-toggle:focus-visible,#hc-site-versions-toggle[aria-expanded="true"]{opacity:1;background:rgba(20,29,40,.94)}
#hc-site-versions-toggle .hc-sv-count{position:absolute;top:-4px;right:-4px;min-width:1.05rem;height:1.05rem;padding:0 3px;box-sizing:border-box;border-radius:999px;background:#7eb6d6;color:#0c1118;font:700 10px/1.05rem system-ui,sans-serif;text-align:center}
.hc-site-versions{position:fixed;z-index:2147483601;width:min(440px,calc(100vw - 32px));max-height:min(70vh,560px);display:flex;flex-direction:column;box-sizing:border-box;background:rgba(12,17,24,.96);border:1px solid rgba(126,182,214,.18);border-radius:3px;box-shadow:0 8px 28px rgba(0,0,0,.5);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);color:#dce7ef;font:13px/1.4 system-ui,sans-serif}
.hc-site-versions header{padding:9px 12px 6px;font-weight:600;color:#cfe2ee}
.hc-site-versions header small{display:block;font-weight:400;color:rgba(207,226,238,.55)}
.hc-sv-rows{overflow:auto;padding:0 6px 6px}
.hc-sv-row{display:flex;align-items:flex-start;gap:8px;padding:7px 6px;border-radius:2px;cursor:pointer}
.hc-sv-row:hover{background:rgba(126,182,214,.08)}
.hc-sv-row[aria-current="true"]{background:rgba(126,182,214,.16)}
.hc-sv-row[aria-disabled="true"]{cursor:default}
.hc-sv-row input{margin:2px 0 0;accent-color:#7eb6d6}
.hc-sv-main{flex:1;min-width:0}
.hc-sv-who{color:#dce7ef}
.hc-sv-meta{color:rgba(207,226,238,.55);font-size:12px}
.hc-sv-tag{display:inline-block;margin-left:6px;padding:0 5px;border-radius:2px;font-size:11px;background:rgba(126,182,214,.14);color:#9fcbe4}
.hc-sv-tag.more{background:rgba(214,160,126,.16);color:#e4b99f}
.hc-sv-diff{border-top:1px solid rgba(126,182,214,.18);max-height:40%;overflow:auto;padding:6px 10px 8px;font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
.hc-sv-diff .add{color:#9fd8a8}
.hc-sv-diff .remove{color:#e8a3a3;text-decoration:line-through;text-decoration-color:rgba(232,163,163,.5)}
.hc-sv-diff .same{color:rgba(220,231,239,.6)}
.hc-sv-diff .skip{color:rgba(207,226,238,.4);font-style:italic}
.hc-sv-hint{padding:4px 12px 9px;color:rgba(207,226,238,.5);font-size:12px}
.hc-sv-tag.picked{background:rgba(159,216,168,.16);color:#9fd8a8}
.hc-sv-pick{margin-top:4px;padding:2px 8px;border:1px solid rgba(126,182,214,.35);border-radius:2px;background:transparent;color:#9fcbe4;font:12px system-ui,sans-serif;cursor:pointer}
.hc-sv-pick:hover{background:rgba(126,182,214,.12)}
.hc-sv-pick[disabled]{opacity:.5;cursor:default}
`

export type SiteVersionsOptions = {
  readonly base: string
  readonly baseHtml: string
  readonly contributions: readonly PageContribution[]
  /** This reader's own key, to say "you". */
  readonly me: string
  /** The signature shown now: the base, or a contribution's. */
  readonly shown: string
  readonly show: (contribution: PageContribution | null) => void
  /** The version everyone is shown — the publisher's pick — or null for the published page. */
  readonly picked?: () => string | null
  /** The key holder's act: make this version what everyone sees (null = the
   *  published page again). Absent for everyone else. Resolves to why not, or null. */
  readonly pick?: (contribution: PageContribution | null) => Promise<string | null>
  readonly t: (key: string, fallback: string) => string
  /** Where the button sits from the bottom (CSS length). */
  readonly bottom: string
}

type Row = { readonly sig: string; readonly html: string; readonly contribution: PageContribution | null }

/** The button and the panel for one mounted page. */
export class SiteVersions {
  readonly #o: SiteVersionsOptions
  readonly #toggle: HTMLButtonElement
  #panel: HTMLDivElement | null = null
  readonly #ticked: string[] = []

  constructor(options: SiteVersionsOptions) {
    this.#o = options
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = STYLE
      document.head.appendChild(style)
    }
    const toggle = document.createElement('button')
    toggle.id = 'hc-site-versions-toggle'
    toggle.type = 'button'
    toggle.textContent = 'layers'
    const count = document.createElement('span')
    count.className = 'hc-sv-count'
    count.textContent = String(options.contributions.length)
    toggle.appendChild(count)
    const label = this.#label()
    toggle.title = label
    toggle.setAttribute('aria-label', label)
    toggle.setAttribute('aria-expanded', 'false')
    toggle.style.bottom = options.bottom
    toggle.style.right = 'calc(0.75rem + env(safe-area-inset-right, 0px))'
    toggle.addEventListener('click', () => (this.#panel ? this.#close() : this.#open()))
    document.body.appendChild(toggle)
    this.#toggle = toggle
  }

  /** Seat the button at the chrome corner's right edge. */
  place(right: string): void {
    this.#toggle.style.right = right
    if (this.#panel) this.#panel.style.right = right
  }

  dispose(): void {
    this.#close()
    this.#toggle.remove()
  }

  #label(): string {
    return this.#o.t('site-versions.open', 'Versions of this page ({count})').replace('{count}', String(this.#o.contributions.length + 1))
  }

  #rows(): Row[] {
    return [
      { sig: this.#o.base, html: this.#o.baseHtml, contribution: null },
      ...this.#o.contributions.map(c => ({ sig: c.sig, html: c.html, contribution: c })),
    ]
  }

  #open(): void {
    const panel = document.createElement('div')
    panel.className = 'hc-site-versions'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', this.#label())
    panel.style.right = this.#toggle.style.right
    panel.style.bottom = `calc(${this.#o.bottom} + 2.75rem)`
    const header = document.createElement('header')
    header.textContent = this.#label()
    const sub = document.createElement('small')
    sub.textContent = this.#o.t('site-versions.local', 'What you pick shows here for you alone; nothing is published.')
    header.appendChild(sub)
    const rows = document.createElement('div')
    rows.className = 'hc-sv-rows'
    for (const row of this.#rows()) rows.appendChild(this.#rowElement(row))
    const hint = document.createElement('div')
    hint.className = 'hc-sv-hint'
    hint.textContent = this.#o.t('site-versions.compare', 'Tick two to compare them.')
    const diff = document.createElement('div')
    diff.className = 'hc-sv-diff'
    diff.hidden = true
    panel.append(header, rows, hint, diff)
    document.body.appendChild(panel)
    this.#panel = panel
    this.#toggle.setAttribute('aria-expanded', 'true')
    this.#renderDiff()
  }

  #close(): void {
    this.#panel?.remove()
    this.#panel = null
    this.#toggle.setAttribute('aria-expanded', 'false')
  }

  #rowElement(row: Row): HTMLElement {
    const c = row.contribution
    const live = !c || c.textOnly
    const el = document.createElement('div')
    el.className = 'hc-sv-row'
    el.setAttribute('aria-current', row.sig === this.#o.shown ? 'true' : 'false')
    if (!live) el.setAttribute('aria-disabled', 'true')
    const tick = document.createElement('input')
    tick.type = 'checkbox'
    tick.checked = this.#ticked.includes(row.sig)
    tick.setAttribute('aria-label', this.#o.t('site-versions.tick', 'Compare this version'))
    tick.addEventListener('click', e => e.stopPropagation())
    tick.addEventListener('change', () => this.#tick(row.sig, tick.checked))
    const main = document.createElement('div')
    main.className = 'hc-sv-main'
    const who = document.createElement('div')
    who.className = 'hc-sv-who'
    who.textContent = !c
      ? this.#o.t('site-versions.published', 'Published')
      : c.pubkey === this.#o.me ? this.#o.t('site-versions.you', 'You') : `${c.pubkey.slice(0, 8)}…`
    const picked = this.#o.picked?.() ?? null
    if (c && c.sig === picked) {
      const everyone = document.createElement('span')
      everyone.className = 'hc-sv-tag picked'
      everyone.textContent = this.#o.t('site-versions.picked', 'everyone sees this')
      who.appendChild(everyone)
    }
    if (c) {
      const tag = document.createElement('span')
      tag.className = c.textOnly ? 'hc-sv-tag' : 'hc-sv-tag more'
      tag.textContent = c.textOnly
        ? this.#o.t('site-versions.words', 'words only')
        : this.#o.t('site-versions.more', 'changes more than words — compare only')
      who.appendChild(tag)
    }
    const meta = document.createElement('div')
    meta.className = 'hc-sv-meta'
    meta.textContent = c ? `${c.host} · ${new Date(c.at * 1000).toLocaleString()}` : row.sig.slice(0, 12)
    main.append(who, meta)
    // The key holder's button: on every version that may be shown, but not on
    // the one everyone already sees (the published page when nothing is picked).
    const pick = this.#o.pick
    if (pick && live && row.sig !== (picked ?? this.#o.base)) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'hc-sv-pick'
      button.textContent = this.#o.t('site-versions.pick', 'Use for everyone')
      button.addEventListener('click', e => {
        e.stopPropagation()
        button.disabled = true
        void pick(c).then(failed => {
          if (!failed) { this.#close(); return }
          button.disabled = false
          const hint = this.#panel?.querySelector<HTMLDivElement>('.hc-sv-hint')
          if (hint) { hint.hidden = false; hint.textContent = failed }
        })
      })
      main.appendChild(button)
    }
    el.append(tick, main)
    if (live) {
      el.addEventListener('click', () => {
        if (row.sig === this.#o.shown) return
        this.#close()
        this.#o.show(c)
      })
    }
    return el
  }

  #tick(sig: string, on: boolean): void {
    const at = this.#ticked.indexOf(sig)
    if (on && at < 0) this.#ticked.push(sig)
    if (!on && at >= 0) this.#ticked.splice(at, 1)
    // Two at most: a third tick lets the oldest go.
    while (this.#ticked.length > 2) this.#ticked.shift()
    this.#panel?.querySelectorAll<HTMLInputElement>('.hc-sv-row input').forEach((input, i) => {
      input.checked = this.#ticked.includes(this.#rows()[i]?.sig ?? '')
    })
    this.#renderDiff()
  }

  #renderDiff(): void {
    const panel = this.#panel
    if (!panel) return
    const diff = panel.querySelector<HTMLDivElement>('.hc-sv-diff')!
    const hint = panel.querySelector<HTMLDivElement>('.hc-sv-hint')!
    const rows = this.#rows()
    const [a, b] = this.#ticked.map(sig => rows.find(r => r.sig === sig)).filter((r): r is Row => !!r)
    if (!a || !b) { diff.hidden = true; hint.hidden = false; return }
    hint.hidden = true
    diff.hidden = false
    diff.replaceChildren()
    const result = diffLines(inertPageText(a.html), inertPageText(b.html), { context: 1 })
    if (!result.added && !result.removed) {
      diff.textContent = this.#o.t('site-versions.same', 'Their words are the same.')
      return
    }
    for (const row of result.rows) {
      const line = document.createElement('div')
      line.className = row.kind
      line.textContent = row.kind === 'skip'
        ? this.#o.t('site-versions.skip', '… {count} lines the same').replace('{count}', String(row.count))
        : `${row.kind === 'add' ? '+ ' : row.kind === 'remove' ? '− ' : '  '}${row.text}`
      diff.appendChild(line)
    }
  }
}

/** Every version a set of hosts holds of one page, one row per signature
 *  (the newest sighting kept), newest first. */
export function mergeContributions(lists: readonly (readonly PageContribution[])[]): PageContribution[] {
  const bySig = new Map<string, PageContribution>()
  for (const list of lists) for (const c of list) {
    const held = bySig.get(c.sig)
    if (!held || c.at > held.at) bySig.set(c.sig, c)
  }
  return [...bySig.values()].sort((a, b) => b.at - a.at)
}
