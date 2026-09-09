// hypercomb-shim/src/host-panel.ts
//
// THE ONLY SURFACE THE SHIM OWNS. One card, and it is every host's front door:
// the mark and the host's name, a sentence about what this is, what THIS
// origin publishes, the domains you carry and what they publish, and where
// the platform explains itself. An operator stages more on top (welcome.ts):
// their own title and sentence, the links that belong on their front page,
// the hives live on their zone. That is the whole interaction, deliberately:
// every other panel in the system arrives as a behaviour, through the very
// package this card replicates.
//
// It appears only when nothing is held. A hive that already holds a package
// boots straight past it and never sees it — but on an origin that publishes
// for others to take, "nothing held" is every first visit, so this card is
// also that origin's website and has to read like one.
//
// Framework-free by necessity, not taste. This runs BEFORE any bee exists, so
// there is nothing to render with but the DOM.

import { addHostZone, hostZone, listHostZones, removeHostZone } from './hosts'
import { installPackage, type HostPackage } from './replicate'
import { askHostPackages } from '@hypercomb/runtime/host-packages'
import { frontDoorOf, readWelcome, type FrontDoor, type Welcome, type WelcomeDoor, type WelcomeLink } from './welcome'

const STYLE = `
:host { all: initial }
.card {
  box-sizing: border-box; position: fixed; inset: 0; z-index: 2147483100;
  display: grid; place-items: start center; overflow: auto;
  background: radial-gradient(120% 90% at 50% 42%, #0c1018 0%, #05060a 60%, #030409 100%);
  font: 14px/1.55 Inter, system-ui, sans-serif; color: #dce7ef;
}
/* A front door is taller than the viewport, and a grid that centres taller
   content clips its top where it cannot be scrolled back — so it starts at
   the top, with the brand's own margin as the breathing room. */
.panel { box-sizing: border-box; width: min(44rem, calc(100vw - 2rem)); margin: 8vh 0 6vh; }
h1 { margin: 0 0 .35rem; font-size: 1.2rem; font-weight: 600; color: #f1f6fa; }
p.lede { margin: 0 0 1.25rem; color: #8fa3b4; }

/* the front door — the mark, the name, and what this is */
.brand { display: grid; justify-items: center; text-align: center; gap: .6rem; margin-bottom: 2.4rem; }
.brand svg { width: 4.25rem; height: 4.25rem; filter: drop-shadow(0 0 1.75rem rgba(242,182,50,.3)); }
.brand h1 {
  margin: 0; font-size: clamp(1.5rem, 5vw, 2rem); font-weight: 600;
  letter-spacing: .3em; text-indent: .3em; color: #f1f6fa; overflow-wrap: anywhere;
}
.brand p { max-width: 34rem; margin: 0; color: #8fa3b4; }

/* section headings, and the label above the directory */
.lbl {
  margin: 0 0 .75rem; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 10px; font-weight: 500; letter-spacing: .28em; text-transform: uppercase; color: #6f8394;
}
section { margin-bottom: 2rem; }
.panel > section:last-of-type { margin-bottom: 0; }

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
a.chip b i { font-style: normal; margin-left: .35em; color: #7d8f9e; }
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
/* the host you are standing on: the same box, gold-edged, nothing to drop */
.host.self { border-color: rgba(242,182,50,.30); }
.host.self > header { background: rgba(242,182,50,.06); }
.host.self .tag {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 10px; letter-spacing: .2em; text-transform: uppercase; color: #a98a4a;
}
.zone { flex: 1; font-weight: 600; color: #f1f6fa; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.drop { background: none; border: none; padding: .2rem .4rem; color: #7d8f9e; }
.drop:hover { color: #d98b8b; }
ul { list-style: none; margin: 0; padding: 0; }
li { display: flex; align-items: center; gap: .75rem; padding: .55rem .75rem; border-top: 1px solid rgba(126,182,214,.12); }
.label { flex: 1; min-width: 0; }
.label b { display: block; font-weight: 500; color: #eaf2f8; }
.label span { color: #7d8f9e; font-size: .85em; font-variant-numeric: tabular-nums; }
.muted { padding: .55rem .75rem; margin: 0; color: #7d8f9e; border-top: 1px solid rgba(126,182,214,.12); }
.status { min-height: 1.4em; margin: 1rem 0 0; color: #8fa3b4; }
.status[data-tone="bad"] { color: #d98b8b; }
.status[data-tone="good"] { color: #8fbf9f; }

/* the footer — where the platform explains itself, on every host */
footer {
  display: flex; flex-wrap: wrap; align-items: center; gap: .4rem 1.1rem;
  margin-top: 2.5rem; padding-top: 1rem; border-top: 1px solid rgba(126,182,214,.12);
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 11px;
  letter-spacing: .12em; color: #6f8394;
}
footer .made { display: inline-flex; align-items: center; gap: .45rem; margin-right: auto; }
footer .made svg { width: 1rem; height: 1rem; }
footer a { color: #8fa3b4; text-decoration: none; border-bottom: 1px solid transparent; }
footer a:hover { color: #f7d489; border-bottom-color: rgba(242,182,50,.5); }
footer a:focus-visible { outline: 2px solid rgba(126,182,214,.75); outline-offset: 2px; }
`

// The mark, drawn rather than fetched: this card renders before this origin
// holds any content, so it cannot depend on a file it has not got. A constant
// — no data from anywhere reaches this string.
const MARK = '<svg viewBox="-52 -52 104 104" aria-hidden="true" focusable="false">' +
  '<polygon points="50,0 25,43.3 -25,43.3 -50,0 -25,-43.3 25,-43.3" fill="none" stroke="#f2b632" stroke-width="2.5"/>' +
  '<polygon points="30,0 15,26 -15,26 -30,0 -15,-26 15,-26" fill="none" stroke="#f2b632" stroke-width="1.2" opacity=".5"/>' +
  '<circle r="4" fill="#f2b632"/></svg>'

const mark = (): Element => {
  const holder = document.createElement('div')
  holder.innerHTML = MARK
  return holder.firstElementChild ?? holder
}

/** What a door answered, kept for the life of the card: the origin's own
 *  packages cannot change between two renders of the same page. */
type Answer = { packages: HostPackage[]; answered: boolean }

class HostPanelElement extends HTMLElement {
  readonly #root = this.attachShadow({ mode: 'open' })
  #busy = false
  /** Undefined until read once; null when this host stages no front door. */
  #welcome: Welcome | null | undefined = undefined
  /** The origin you are standing on, as a zone — `` when it is not one
   *  (a file:// preview, an address with no dots that is not loopback). */
  readonly #self = hostZone(location.host)
  #selfAnswer: Promise<Answer> | undefined = undefined

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
    // Named as the zone it is — `localhost:4270` on a machine, the hostname
    // everywhere else — so the title and the box below it agree.
    const door = frontDoorOf(this.#welcome, this.#self || location.hostname, location.origin)
    // The tab is named for the place, not for the shell that drew it.
    document.title = door.title
    const zones = (await listHostZones()).filter(zone => zone !== this.#self)
    this.#root.replaceChildren()

    const style = document.createElement('style')
    style.textContent = STYLE

    const card = document.createElement('div')
    card.className = 'card'
    const panel = document.createElement('div')
    panel.className = 'panel'

    panel.append(...this.#frontDoor(door))
    if (this.#self) panel.append(this.#published())
    panel.append(this.#carried(zones))
    if (door.footer.length > 0) panel.append(this.#footer(door.footer))

    card.append(panel)
    this.#root.append(style, card)
  }

  #frontDoor(door: FrontDoor): HTMLElement[] {
    const parts: HTMLElement[] = []

    const brand = document.createElement('div')
    brand.className = 'brand'
    brand.append(mark())
    const title = document.createElement('h1')
    title.textContent = door.title
    brand.append(title)
    const tagline = document.createElement('p')
    tagline.textContent = door.tagline
    brand.append(tagline)
    parts.push(brand)

    if (door.links.length > 0) {
      const links = document.createElement('section')
      const row = document.createElement('div')
      row.className = 'chips wide'
      // The first link leads: it is the one thing this origin most wants read.
      door.links.forEach((link, index) => row.append(this.#linkChip(link, index === 0)))
      links.append(row)
      parts.push(links)
    }

    if (door.doors.length > 0) {
      const directory = document.createElement('section')
      const label = document.createElement('p')
      label.className = 'lbl'
      label.textContent = door.doorsLabel ||
        `${door.doors.length} ${door.doors.length === 1 ? 'hive' : 'hives'} live here`
      const row = document.createElement('div')
      row.className = 'chips'
      for (const place of door.doors) row.append(this.#doorChip(place))
      directory.append(label, row)
      parts.push(directory)
    }

    return parts
  }

  #linkChip(link: WelcomeLink, lead: boolean): HTMLElement {
    const anchor = document.createElement('a')
    anchor.className = lead ? 'chip lead' : 'chip'
    anchor.href = link.href
    const label = document.createElement('b')
    label.textContent = link.label
    // Somewhere else on the web opens in its own tab and says so; somewhere on
    // this origin is this site still, and replaces the page it was clicked from.
    if (anchor.origin !== location.origin) {
      anchor.target = '_blank'
      anchor.rel = 'noopener'
      const out = document.createElement('i')
      out.setAttribute('aria-hidden', 'true')
      out.textContent = '↗'
      label.append(out)
    }
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

  /** What THIS origin publishes — the presentation of a host is what it
   *  holds, so it is on the page before anyone types anything. */
  #published(): HTMLElement {
    const section = document.createElement('section')
    const label = document.createElement('p')
    label.className = 'lbl'
    label.textContent = 'Published here'
    const box = this.#hostBox(this.#self, true)
    section.append(label, box)
    this.#selfAnswer ??= this.#ask(this.#self)
    void this.#fill(box, this.#selfAnswer, 'Nothing published here yet.')
    return section
  }

  /** The domains you carry, and the field that adds one. */
  #carried(zones: string[]): HTMLElement {
    const section = document.createElement('section')
    const heading = document.createElement('h2')
    heading.className = 'lbl'
    heading.textContent = 'Add a domain'
    const lede = document.createElement('p')
    lede.className = 'lede'
    lede.textContent = 'Carry another host and what it publishes appears here. Replication fetches the whole closure of a signature, and every byte is verified against its own name before it is admitted.'

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
    for (const zone of zones) {
      const box = this.#hostBox(zone, false)
      void this.#fill(box, this.#ask(zone), 'Nothing published here.')
      list.append(box)
    }

    const status = document.createElement('p')
    status.className = 'status'

    section.append(heading, lede, form, list, status)
    return section
  }

  #footer(links: readonly WelcomeLink[]): HTMLElement {
    const footer = document.createElement('footer')
    const made = document.createElement('span')
    made.className = 'made'
    made.append(mark(), document.createTextNode('hypercomb'))
    footer.append(made)
    for (const link of links) {
      const anchor = document.createElement('a')
      anchor.href = link.href
      anchor.textContent = link.label
      if (link.note) anchor.title = link.note
      if (anchor.origin !== location.origin) {
        anchor.target = '_blank'
        anchor.rel = 'noopener'
      }
      footer.append(anchor)
    }
    return footer
  }

  #hostBox(zone: string, self: boolean): HTMLElement {
    const host = document.createElement('section')
    host.className = self ? 'host self' : 'host'

    const header = document.createElement('header')
    const name = document.createElement('span')
    name.className = 'zone'
    name.textContent = zone
    header.append(name)
    if (self) {
      const tag = document.createElement('span')
      tag.className = 'tag'
      tag.textContent = 'this host'
      header.append(tag)
    } else {
      const drop = document.createElement('button')
      drop.className = 'drop'
      drop.type = 'button'
      drop.title = `Remove ${zone}`
      drop.textContent = '✕'
      drop.addEventListener('click', () => { void this.#remove(zone) })
      header.append(drop)
    }

    const body = document.createElement('div')
    body.className = 'body'
    const loading = document.createElement('p')
    loading.className = 'muted'
    loading.textContent = 'Asking…'
    body.append(loading)

    host.append(header, body)
    return host
  }

  async #ask(zone: string): Promise<Answer> {
    try { return await askHostPackages(zone) } catch { return { packages: [], answered: false } }
  }

  /** "Publishes nothing" and "did not answer" are different facts, and only
   *  the second is about reachability — the box says which. */
  async #fill(box: HTMLElement, pending: Promise<Answer>, nothing: string): Promise<void> {
    const { packages, answered } = await pending
    const body = box.querySelector('.body')
    if (!body) return
    body.replaceChildren()
    if (packages.length === 0) {
      const none = document.createElement('p')
      none.className = 'muted'
      none.textContent = answered ? nothing : 'The host did not answer.'
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
    detail.textContent = atoms > 0
      ? `${pkg.packageSig.slice(0, 12)}… · ${atoms} atoms · ` +
        `${pkg.bees.length} bees, ${pkg.dependencies.length} deps, ${pkg.layers.length} layers`
      : `${pkg.packageSig.slice(0, 12)}…${pkg.at ? ` · ${pkg.at.slice(0, 10)}` : ''}`
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
    if (zone === this.#self) { this.#say(`${zone} is this host — what it publishes is already on the page.`); return }
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
