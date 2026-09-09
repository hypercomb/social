// hypercomb-shim/src/host-panel.ts
//
// THE ONLY SURFACE THE SHIM OWNS. One card: what this origin is, where else it
// leads, add a domain, see what it publishes, click one. The middle two are
// the front door — staged content, absent on most hosts (see welcome.ts) — and
// the rest is the whole interaction, deliberately: every other panel in the
// system arrives as a behaviour, through the very package this card installs.
//
// It appears only when nothing is installed. A hive that already holds a
// package boots straight past it and never sees it — but on an origin that
// publishes for others to take, "nothing installed" is every first visit, so
// this card is also that origin's website and has to read like one.
//
// Framework-free by necessity, not taste. This runs BEFORE any bee exists, so
// there is nothing to render with but the DOM.

import { addHostZone, hostZone, listHostZones, removeHostZone } from './hosts'
import { installPackage, listHostPackages, type HostPackage } from './replicate'
import { readWelcome, type Welcome, type WelcomeDoor, type WelcomeLink } from './welcome'

const STYLE = `
:host { all: initial }
.card {
  box-sizing: border-box; position: fixed; inset: 0; z-index: 2147483100;
  display: grid; place-items: center; overflow: auto;
  background: radial-gradient(120% 90% at 50% 42%, #0c1018 0%, #05060a 60%, #030409 100%);
  font: 14px/1.55 Inter, system-ui, sans-serif; color: #dce7ef;
}
/* A front door is taller than the viewport, and a grid that centres taller
   content clips its top where it cannot be scrolled back. Start-align it. */
.card.door { place-items: start center; }
.panel { box-sizing: border-box; width: min(38rem, calc(100vw - 2rem)); margin: 6vh 0; }
.card.door .panel { width: min(44rem, calc(100vw - 2rem)); margin: 8vh 0 6vh; }
h1 { margin: 0 0 .35rem; font-size: 1.2rem; font-weight: 600; color: #f1f6fa; }
p.lede { margin: 0 0 1.5rem; color: #8fa3b4; }

/* the front door — the mark, the name, and what this is */
.brand { display: grid; justify-items: center; text-align: center; gap: .6rem; margin-bottom: 2.4rem; }
.brand svg { width: 4.25rem; height: 4.25rem; filter: drop-shadow(0 0 1.75rem rgba(242,182,50,.3)); }
.brand h1 {
  margin: 0; font-size: clamp(1.5rem, 5vw, 2rem); font-weight: 600;
  letter-spacing: .3em; text-indent: .3em; color: #f1f6fa;
}
.brand p { max-width: 34rem; margin: 0; color: #8fa3b4; }

/* section headings, and the label above the directory */
.lbl {
  margin: 0 0 .75rem; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 10px; font-weight: 500; letter-spacing: .28em; text-transform: uppercase; color: #6f8394;
}
section { margin-bottom: 2rem; }
section:last-of-type { margin-bottom: 0; }

/* chips: the places this origin sends you. A grid rather than a wrapping row —
   the directory is a list of equals and reads as one when the columns line up. */
.chips { display: grid; grid-template-columns: repeat(auto-fill, minmax(11.5rem, 1fr)); gap: .5rem; }
.chips.wide { grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); }
a.chip {
  display: flex; flex-direction: column; gap: .15rem; min-width: 0;
  padding: .6rem .85rem; text-decoration: none;
  border: 1px solid rgba(126,182,214,.20); border-radius: 6px;
  transition: border-color .2s, background .2s;
}
a.chip b { font-weight: 500; color: #eaf2f8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
a.chip span {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: .78em;
  color: #7d8f9e; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
a.chip:hover { border-color: rgba(126,182,214,.55); background: rgba(126,182,214,.10); }
a.chip:focus-visible { outline: 2px solid rgba(126,182,214,.75); outline-offset: 2px; }
a.chip.lead { border-color: rgba(242,182,50,.42); background: rgba(242,182,50,.07); }
a.chip.lead b { color: #f7d489; }
a.chip.lead:hover { border-color: rgba(242,182,50,.75); background: rgba(242,182,50,.13); }
a.chip.lead:focus-visible { outline-color: rgba(242,182,50,.8); }

form { display: flex; gap: .5rem; margin-bottom: 1.25rem; }
input {
  flex: 1; box-sizing: border-box; padding: .6rem .75rem; color: #eaf2f8;
  background: #090d12; border: 1px solid rgba(126,182,214,.32); border-radius: 5px;
  font: inherit;
}
input:focus { outline: none; border-color: rgba(126,182,214,.75); }
button {
  padding: .6rem .95rem; font: inherit; color: #dce7ef; cursor: pointer;
  background: rgba(126,182,214,.14); border: 1px solid rgba(126,182,214,.38);
  border-radius: 5px;
}
button:hover:not(:disabled) { background: rgba(126,182,214,.24); }
button:disabled { opacity: .5; cursor: default; }
.host { border: 1px solid rgba(126,182,214,.20); border-radius: 6px; margin-bottom: .75rem; }
.host > header {
  display: flex; align-items: center; gap: .5rem;
  padding: .6rem .75rem; background: rgba(126,182,214,.06);
}
.zone { flex: 1; font-weight: 600; color: #f1f6fa; }
.drop { background: none; border: none; padding: .2rem .4rem; color: #7d8f9e; }
.drop:hover { color: #d98b8b; }
ul { list-style: none; margin: 0; padding: 0; }
li { display: flex; align-items: center; gap: .75rem; padding: .55rem .75rem; border-top: 1px solid rgba(126,182,214,.12); }
.label { flex: 1; min-width: 0; }
.label b { display: block; font-weight: 500; color: #eaf2f8; }
.label span { color: #7d8f9e; font-size: .85em; font-variant-numeric: tabular-nums; }
.muted { padding: .55rem .75rem; color: #7d8f9e; border-top: 1px solid rgba(126,182,214,.12); }
.status { min-height: 1.4em; margin-top: 1rem; color: #8fa3b4; }
.status[data-tone="bad"] { color: #d98b8b; }
.status[data-tone="good"] { color: #8fbf9f; }
`

// The mark, drawn rather than fetched: this card renders before this origin
// holds any content, so it cannot depend on a file it has not got. A constant
// — no data from anywhere reaches this string.
const MARK = '<svg viewBox="-52 -52 104 104" aria-hidden="true" focusable="false">' +
  '<polygon points="50,0 25,43.3 -25,43.3 -50,0 -25,-43.3 25,-43.3" fill="none" stroke="#f2b632" stroke-width="2.5"/>' +
  '<polygon points="30,0 15,26 -15,26 -30,0 -15,-26 15,-26" fill="none" stroke="#f2b632" stroke-width="1.2" opacity=".5"/>' +
  '<circle r="4" fill="#f2b632"/></svg>'

class HostPanelElement extends HTMLElement {
  readonly #root = this.attachShadow({ mode: 'open' })
  #busy = false
  /** Undefined until read once; null when this host stages no front door. */
  #welcome: Welcome | null | undefined = undefined

  connectedCallback(): void {
    void this.#render()
  }

  #say(message: string, tone: 'neutral' | 'good' | 'bad' = 'neutral'): void {
    const status = this.#root.querySelector('.status')
    if (!status) return
    status.textContent = message
    status.setAttribute('data-tone', tone)
  }

  async #render(): Promise<void> {
    // The front door is read once per card, not once per render: adding a
    // domain must not re-ask the origin for a file that cannot have changed.
    if (this.#welcome === undefined) this.#welcome = await readWelcome()
    const welcome = this.#welcome
    const zones = await listHostZones()
    this.#root.replaceChildren()

    const style = document.createElement('style')
    style.textContent = STYLE

    const card = document.createElement('div')
    card.className = welcome ? 'card door' : 'card'
    const panel = document.createElement('div')
    panel.className = 'panel'

    if (welcome) panel.append(...this.#frontDoor(welcome))

    const form = document.createElement('form')
    const input = document.createElement('input')
    input.placeholder = 'hypercomb.com'
    input.spellcheck = false
    input.autocapitalize = 'off'
    input.setAttribute('aria-label', 'Domain to add')
    const add = document.createElement('button')
    add.type = 'submit'
    add.textContent = 'Add'
    form.append(input, add)
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      void this.#add(input.value)
    })

    const list = document.createElement('div')
    for (const zone of zones) list.append(this.#hostRow(zone))
    if (zones.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'muted'
      empty.style.border = 'none'
      empty.textContent = 'No domains yet.'
      list.append(empty)
    }

    const status = document.createElement('p')
    status.className = 'status'

    // With a front door above it, adding a domain is one section of a page and
    // takes a section label; on a bare host it IS the page and keeps the h1.
    const adding = document.createElement('section')
    const heading = document.createElement(welcome ? 'h2' : 'h1')
    heading.textContent = 'Add a domain'
    if (welcome) heading.className = 'lbl'
    const lede = document.createElement('p')
    lede.className = 'lede'
    lede.textContent = 'A host publishes packages. Add one, then choose what to take: replication fetches the whole closure of that signature, and every byte is verified against its own name before it is admitted.'
    adding.append(heading, lede, form, list, status)

    panel.append(adding)
    card.append(panel)
    this.#root.append(style, card)
    // Focus belongs in the field only when the field is the point. On a front
    // door it would scroll the page past everything the visitor came to read.
    if (!welcome) input.focus()
  }

  #frontDoor(welcome: Welcome): HTMLElement[] {
    const parts: HTMLElement[] = []

    const brand = document.createElement('div')
    brand.className = 'brand'
    const mark = document.createElement('div')
    mark.innerHTML = MARK
    brand.append(mark.firstElementChild ?? mark)
    const title = document.createElement('h1')
    title.textContent = welcome.title || location.hostname
    brand.append(title)
    if (welcome.tagline) {
      const tagline = document.createElement('p')
      tagline.textContent = welcome.tagline
      brand.append(tagline)
    }
    parts.push(brand)

    if (welcome.links.length > 0) {
      const links = document.createElement('section')
      const row = document.createElement('div')
      row.className = 'chips wide'
      // The first link leads: it is the one thing this origin most wants read.
      welcome.links.forEach((link, index) => row.append(this.#linkChip(link, index === 0)))
      links.append(row)
      parts.push(links)
    }

    if (welcome.doors.length > 0) {
      const directory = document.createElement('section')
      const label = document.createElement('p')
      label.className = 'lbl'
      label.textContent = welcome.doorsLabel ||
        `${welcome.doors.length} ${welcome.doors.length === 1 ? 'hive' : 'hives'} live here`
      const row = document.createElement('div')
      row.className = 'chips'
      for (const door of welcome.doors) row.append(this.#doorChip(door))
      directory.append(label, row)
      parts.push(directory)
    }

    return parts
  }

  #linkChip(link: WelcomeLink, lead: boolean): HTMLElement {
    const anchor = document.createElement('a')
    anchor.className = lead ? 'chip lead' : 'chip'
    anchor.href = link.href
    // Somewhere else on the web opens in its own tab; somewhere on this origin
    // is this site still, and replaces the page it was clicked from.
    if (anchor.origin !== location.origin) {
      anchor.target = '_blank'
      anchor.rel = 'noopener'
    }
    const label = document.createElement('b')
    label.textContent = link.label
    anchor.append(label)
    if (link.note) {
      const note = document.createElement('span')
      note.textContent = link.note
      anchor.append(note)
    }
    return anchor
  }

  /** A door is a place to go, and it opens in its own tab — leaving is not
   *  the same as losing the origin you were standing on. */
  #doorChip(door: WelcomeDoor): HTMLElement {
    const anchor = document.createElement('a')
    anchor.className = 'chip'
    anchor.href = `https://${door.host}/`
    anchor.target = '_blank'
    anchor.rel = 'noopener'
    const title = document.createElement('b')
    title.textContent = door.title
    const host = document.createElement('span')
    host.textContent = door.host
    anchor.append(title, host)
    return anchor
  }

  #hostRow(zone: string): HTMLElement {
    const host = document.createElement('section')
    host.className = 'host'

    const header = document.createElement('header')
    const name = document.createElement('span')
    name.className = 'zone'
    name.textContent = zone
    const drop = document.createElement('button')
    drop.className = 'drop'
    drop.type = 'button'
    drop.title = `Remove ${zone}`
    drop.textContent = '✕'
    drop.addEventListener('click', () => { void this.#remove(zone) })
    header.append(name, drop)

    const body = document.createElement('div')
    const loading = document.createElement('p')
    loading.className = 'muted'
    loading.textContent = 'Asking…'
    body.append(loading)

    host.append(header, body)
    void this.#fillPackages(zone, body)
    return host
  }

  async #fillPackages(zone: string, body: HTMLElement): Promise<void> {
    let packages: HostPackage[] = []
    try { packages = await listHostPackages(zone) } catch { packages = [] }
    body.replaceChildren()
    if (packages.length === 0) {
      const none = document.createElement('p')
      none.className = 'muted'
      none.textContent = 'Nothing published here, or the host did not answer.'
      body.append(none)
      return
    }
    const list = document.createElement('ul')
    for (const pkg of packages) list.append(this.#packageRow(pkg))
    body.append(list)
  }

  #packageRow(pkg: HostPackage): HTMLElement {
    const row = document.createElement('li')

    const label = document.createElement('div')
    label.className = 'label'
    const title = document.createElement('b')
    title.textContent = pkg.label
    const detail = document.createElement('span')
    const atoms = pkg.bees.length + pkg.dependencies.length + pkg.layers.length
    detail.textContent =
      `${pkg.packageSig.slice(0, 12)}… · ${atoms} atoms · ` +
      `${pkg.bees.length} bees, ${pkg.dependencies.length} deps, ${pkg.layers.length} layers`
    label.append(title, detail)

    const take = document.createElement('button')
    take.type = 'button'
    take.textContent = 'Replicate'
    take.addEventListener('click', () => { void this.#install(pkg, take) })

    row.append(label, take)
    return row
  }

  async #add(raw: string): Promise<void> {
    if (this.#busy) return
    const zone = hostZone(raw)
    if (!zone) { this.#say(`"${raw.trim()}" is not a hostname.`, 'bad'); return }
    const added = await addHostZone(zone)
    if (!added) { this.#say(`Could not add ${zone}.`, 'bad'); return }
    await this.#render()
    this.#say(`Added ${added}.`, 'good')
  }

  async #remove(zone: string): Promise<void> {
    if (this.#busy) return
    await removeHostZone(zone)
    await this.#render()
    this.#say(`Removed ${zone}.`)
  }

  async #install(pkg: HostPackage, button: HTMLButtonElement): Promise<void> {
    if (this.#busy) return
    this.#busy = true
    for (const other of this.#root.querySelectorAll('button')) other.disabled = true
    button.textContent = 'Replicating…'
    this.#say(`Replicating ${pkg.packageSig.slice(0, 12)}… from ${pkg.zone}.`)

    const outcome = await installPackage(pkg)
    if (!outcome.ok) {
      this.#busy = false
      for (const other of this.#root.querySelectorAll('button')) other.disabled = false
      button.textContent = 'Replicate'
      this.#say(outcome.error ?? 'Replication failed.', 'bad')
      console.warn('[shim] replication incomplete', outcome)
      return
    }

    this.#say(`Held ${outcome.fetched + outcome.present} atoms (${outcome.fetched} fetched). Starting…`, 'good')
    console.log('[shim] replication complete', outcome)
    // A reload, and only here. The import map has to be live BEFORE the first
    // module script evaluates, and the bees that just landed are exactly those
    // module scripts — so the honest move after a cold install is to start the
    // boot again with the heap full, rather than to patch a running graph.
    // This is not the reload-once import-map dance the shim refuses to carry;
    // it is one deliberate restart at the end of a one-time act.
    setTimeout(() => location.reload(), 400)
  }
}

const TAG = 'hc-shim-hosts'

/** Put the card up. Idempotent — a second call is a no-op, so a caller may
 *  ask on any path without tracking whether it already asked. */
export const showHostPanel = (): void => {
  if (!customElements.get(TAG)) customElements.define(TAG, HostPanelElement)
  if (document.querySelector(TAG)) return
  document.body.append(document.createElement(TAG))
}
