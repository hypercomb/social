// script:community-doors — one behaviour, no look of its own.
//
//   <community-doors words="coffee tea kava" hosts="roaster.example">
//     <button data-word="">All</button> <button data-word="coffee">Coffee</button>
//     <p data-doors-status></p>
//     <ul data-doors></ul>
//     <template data-door> … [data-door-link] [data-door-title] [data-door-host]
//                            [data-door-word] [data-door-points] … </template>
//     <template data-door-point> … [data-point-link] [data-point-title] … </template>
//     <div data-doors-empty> shown while no door is live </div>
//   </community-doors>
//
// WHAT IT ANSWERS. Which domains of a community open a door named by one of
// these words, and is that door live. A domain that hosts `coffee` serves it
// at `coffee.<domain>`; its ledger (`GET /publications.json`, the list every
// host already serves) says so, and says whether a publisher's head stands
// behind it. Nothing is listed here by hand: a house appears the moment its
// door goes live, and leaves when it is switched off.
//
// WHOSE COMMUNITY. In this order, joined:
//   1. `hosts` on the element — the domains the page's author names;
//   2. the domains the reader follows, when a hive is underneath
//      (`community:hosts`) — you see your whole network, a stranger sees 1 and 3;
//   3. the domain the page is served from, and the one above it.
// Each domain is asked once. One that does not answer is a gap, never an
// error, and never "nothing there".
//
// UNDER A DOOR. Whatever the same ledger lists beneath the word
// (`coffee/wholesale`, `coffee/roasters`) is drawn as that door's connection
// points, each a link to its own address.
//
// It carries no styling and names no class: every piece it draws is cloned
// from a template the page wrote, so the same module serves any site.

const TIMEOUT_MS = 6000
const FOLLOWED_POOL = 'community:hosts'

const zoneOf = raw => String(raw ?? '').trim().toLowerCase()
  .replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/\.$/, '')
const isLocal = host => /^(localhost|127\.|\[::1\])/.test(host) || host.endsWith('.localhost') || !host.includes('.')
const originOf = host => `${isLocal(host) ? 'http' : 'https'}://${host}`
const words = raw => String(raw ?? '').toLowerCase().split(/[\s,]+/).filter(Boolean)

/** The domains the reader follows, when a hive answers. */
async function followedZones() {
  const zones = []
  try {
    const store = window.ioc?.get?.('@hypercomb.social/Store')
    if (!store?.getPool) return zones
    await store.initialize?.()
    const pool = await store.getPool(FOLLOWED_POOL)
    for await (const [, handle] of pool.entries()) {
      if (handle.kind !== 'file') continue
      try {
        const meaning = String(JSON.parse(await (await handle.getFile()).text())?.meaning ?? '')
        if (meaning.startsWith('host:')) zones.push(zoneOf(meaning.slice(5)))
      } catch { /* a member that will not parse is not a host */ }
    }
  } catch { /* no hive underneath: the reader follows nothing here */ }
  return zones
}

/** The domain this page is served from, and the one above it. */
function servedFrom() {
  const host = zoneOf(location.hostname)
  if (!host || isLocal(host)) return []
  const labels = host.split('.')
  return labels.length > 2 ? [host, labels.slice(1).join('.')] : [host]
}

/** One host's ledger rows, or null when it did not answer. */
async function ledgerOf(zone) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(`${originOf(zone)}/publications.json`, {
      signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
    })
    if (!response.ok) return null
    const sites = (await response.json())?.sites
    return Array.isArray(sites) ? sites : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

const isLive = site => Array.isArray(site?.publishers) && site.publishers.some(p => typeof p?.head === 'string' && p.head)
const addressesOf = site => [site?.host, ...(Array.isArray(site?.hosts) ? site.hosts.map(h => h?.host) : [])]
  .map(zoneOf).filter(Boolean)

/** Every live door the community's ledgers name for these words. */
export async function readDoors(zones, wanted) {
  const asked = [...new Set(zones.map(zoneOf).filter(Boolean))]
  const answers = await Promise.all(asked.map(async zone => ({ zone, sites: await ledgerOf(zone) })))
  const doors = new Map()
  for (const { sites } of answers) {
    for (const site of sites ?? []) {
      if (!isLive(site)) continue
      for (const address of addressesOf(site)) {
        const [word, ...rest] = address.split('.')
        const zone = rest.join('.')
        if (!wanted.includes(word) || !asked.includes(zone) || doors.has(address)) continue
        // What the same ledger lists beneath the word: the door's connection points.
        const points = (sites ?? [])
          .filter(other => isLive(other) && String(other?.lineage ?? '').toLowerCase().startsWith(word + '/'))
          .map(other => ({ title: String(other.title || other.lineage), url: String(other.url || originOf(zoneOf(other.host)) + '/') }))
        doors.set(address, { word, zone, address, title: String(site.title || zone), url: `${originOf(address)}/`, points })
      }
    }
  }
  return {
    doors: [...doors.values()].sort((a, b) => a.zone.localeCompare(b.zone) || a.word.localeCompare(b.word)),
    asked: asked.length,
    silent: answers.filter(a => a.sites === null).map(a => a.zone),
  }
}

const fill = (root, selector, text) => { const node = root.querySelector(selector); if (node) node.textContent = text }
const point = (root, selector, url) => { const node = root.querySelector(selector); if (node) { node.setAttribute('href', url); node.setAttribute('rel', 'noopener') } }

class CommunityDoors extends HTMLElement {
  #doors = []
  #word = ''
  #run = 0

  connectedCallback() {
    this.addEventListener('click', this.#onClick)
    void this.refresh()
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.#onClick)
    this.#run++
  }

  #onClick = event => {
    const button = event.target instanceof Element ? event.target.closest('[data-word]') : null
    if (!button || !this.contains(button)) return
    this.#word = button.getAttribute('data-word') ?? ''
    this.#press()
    this.#draw()
  }

  /** The pressed look and the resting look are read off the page's own
   *  buttons, once, so the module never names a class. */
  #press() {
    const buttons = [...this.querySelectorAll('[data-word]')]
    if (!this.pressedLook) {
      this.pressedLook = buttons.find(b => b.getAttribute('aria-pressed') === 'true')?.className ?? ''
      this.restingLook = buttons.find(b => b.getAttribute('aria-pressed') !== 'true')?.className ?? ''
    }
    for (const button of buttons) {
      const on = (button.getAttribute('data-word') ?? '') === this.#word
      button.setAttribute('aria-pressed', String(on))
      if (this.pressedLook && this.restingLook) button.className = on ? this.pressedLook : this.restingLook
    }
  }

  async refresh() {
    const run = ++this.#run
    const wanted = words(this.getAttribute('words'))
    const zones = [...words(this.getAttribute('hosts')), ...await followedZones(), ...servedFrom()]
    if (run !== this.#run) return
    if (wanted.length === 0 || zones.length === 0) { this.#say(''); return }
    this.#say(`Asking ${new Set(zones).size} ${new Set(zones).size === 1 ? 'domain' : 'domains'}…`)
    const result = await readDoors(zones, wanted)
    if (run !== this.#run) return
    this.#doors = result.doors
    const houses = result.doors.length
    this.#say(`${houses} ${houses === 1 ? 'house' : 'houses'} live across ${result.asked} ${result.asked === 1 ? 'domain' : 'domains'}`
      + (result.silent.length ? ` · ${result.silent.length} did not answer` : ''))
    this.#draw()
  }

  #say(text) { fill(this, '[data-doors-status]', text) }

  #draw() {
    const list = this.querySelector('[data-doors]')
    const row = this.querySelector('template[data-door]')
    const empty = this.querySelector('[data-doors-empty]')
    if (!list || !row) return
    const shown = this.#doors.filter(door => !this.#word || door.word === this.#word)
    list.replaceChildren(...shown.map(door => {
      const node = row.content.cloneNode(true)
      fill(node, '[data-door-title]', door.title)
      fill(node, '[data-door-host]', door.address)
      fill(node, '[data-door-word]', door.word)
      point(node, '[data-door-link]', door.url)
      const points = node.querySelector('[data-door-points]')
      const pointRow = this.querySelector('template[data-door-point]')
      if (points && pointRow && door.points.length) {
        points.replaceChildren(...door.points.map(entry => {
          const piece = pointRow.content.cloneNode(true)
          fill(piece, '[data-point-title]', entry.title)
          point(piece, '[data-point-link]', entry.url)
          return piece
        }))
      } else points?.remove()
      return node
    }))
    list.hidden = shown.length === 0
    if (empty) empty.hidden = shown.length > 0
  }
}

if (!customElements.get('community-doors')) customElements.define('community-doors', CommunityDoors)
