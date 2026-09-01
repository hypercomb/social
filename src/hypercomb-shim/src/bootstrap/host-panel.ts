// hypercomb-shim/src/host-panel.ts
//
// THE ONLY SURFACE THE SHIM OWNS. One card: add a domain, see what it
// publishes, click one. That is the whole interaction, and it is deliberately
// the whole interaction — every other panel in the system arrives as a
// behaviour, through the very package this card installs.
//
// It appears only when nothing is installed. A hive that already holds a
// package boots straight past it and never sees it, which is why this can
// afford to be plain: it is the first ten seconds of a node's life, once.
//
// Framework-free by necessity, not taste. This runs BEFORE any bee exists, so
// there is nothing to render with but the DOM.

import { addHostZone, hostZone, listHostZones, removeHostZone } from './hosts'
import { installPackage, listHostPackages, type HostPackage } from './replicate'

const STYLE = `
:host { all: initial }
.card {
  box-sizing: border-box; position: fixed; inset: 0; z-index: 2147483100;
  display: grid; place-items: center; overflow: auto;
  background: radial-gradient(120% 90% at 50% 42%, #0c1018 0%, #05060a 60%, #030409 100%);
  font: 14px/1.55 Inter, system-ui, sans-serif; color: #dce7ef;
}
.panel { width: min(38rem, calc(100vw - 2rem)); margin: 6vh 0; }
h1 { margin: 0 0 .35rem; font-size: 1.2rem; font-weight: 600; color: #f1f6fa; }
p.lede { margin: 0 0 1.5rem; color: #8fa3b4; }
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

class HostPanelElement extends HTMLElement {
  readonly #root = this.attachShadow({ mode: 'open' })
  #busy = false

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
    const zones = await listHostZones()
    this.#root.replaceChildren()

    const style = document.createElement('style')
    style.textContent = STYLE

    const card = document.createElement('div')
    card.className = 'card'
    const panel = document.createElement('div')
    panel.className = 'panel'

    const heading = document.createElement('h1')
    heading.textContent = 'Add a domain'
    const lede = document.createElement('p')
    lede.className = 'lede'
    lede.textContent = 'A host publishes packages. Add one, then choose what to take from it — every byte is verified against its own signature before it is admitted.'

    const form = document.createElement('form')
    const input = document.createElement('input')
    input.placeholder = 'hypercomb.com'
    input.spellcheck = false
    input.autocapitalize = 'off'
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

    panel.append(heading, lede, form, list, status)
    card.append(panel)
    this.#root.append(style, card)
    input.focus()
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
    take.textContent = 'Install'
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
    button.textContent = 'Installing…'
    this.#say(`Replicating ${pkg.packageSig.slice(0, 12)}… from ${pkg.zone}.`)

    const outcome = await installPackage(pkg)
    if (!outcome.ok) {
      this.#busy = false
      for (const other of this.#root.querySelectorAll('button')) other.disabled = false
      button.textContent = 'Install'
      this.#say(outcome.error ?? 'Install failed.', 'bad')
      console.warn('[shim] install incomplete', outcome)
      return
    }

    this.#say(`Held ${outcome.fetched + outcome.present} atoms (${outcome.fetched} fetched). Starting…`, 'good')
    console.log('[shim] install complete', outcome)
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
