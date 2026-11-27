// pools/domain-shelf.element.ts
//
// <hc-domain-shelf>: THE NODE SHELF. A second strip under the header, a
// sibling of the shelf (presentation/tiles/quick-tray.element.ts, A9), that
// shows the NODES pools are drawn from as chips that switch on and off, with
// a search field at its end. A node is where entries come from
// (pools/pool-node.ts): a host this hive follows, or a participant in the room
// that was joined. What is on is whom pools are taken from: selection, the
// first of the three gates (T5). In the relational reading
// (documentation/pools-as-relational-database.md) the chips are the FROM
// clause and the search is the WHERE.
//
// A CHIP IS A SMALL PLATE: two initials and nothing else, a count in its
// corner when somebody counted. The whole name (the domain, or what the
// participant calls themselves, or a short key when they gave none) is the
// chip's title and its accessible name, so a hover says who it is and a
// screen reader hears the name, never the initials; a chip reached by the
// keyboard says it under the strip. A domain's plate is square and a
// participant's is round, so the two kinds read apart without a legend.
//
// TWO GROUPS ON ONE STRIP: the domains, then, while a surface has announced
// who is in the room (`pools:sources-nodes`), a thin divider and the
// participants. The reader's own node is first in its group.
//
// A framework-free custom element contributed through the ShellSurfaceRegistry
// by DomainShelfDrone, so every shell mounts it. It takes the shell's
// vocabulary through custom properties that inherit across the shadow
// boundary, with local fallbacks: the shelf's material and height, its own
// accent (the "on" green, and the dark ink that reads on it in either theme),
// so the two strips read as siblings and not as one.
//
// IT SHOWS ONLY WHILE SOMEBODY WANTS IT. A surface asks with the transient
// `pools:domain-shelf` { owner, wanted }; the strip keeps the set of owners
// and, with none, renders nothing and reserves nothing. Pools mode is also
// read from its last value (`world:mode`), because a want sent before the
// strip mounted is never replayed. What the strip announces does not depend
// on being in view: the nodes drawn from are the same either way. The search
// words are the one thing that leaves with the view: they belong to the
// surfaces that asked for the strip, and go when the last of them does.
//
// IT STANDS UNDER THE SHELF. It measures the shelf's strip and sits below it,
// or in the shelf's place when the shelf is away, and it holds its own band on
// the canvas (`viewport:inset`, owner `domain-shelf`). It never reads the top
// inset to place itself, because it adds to it. While the selection shelf
// stands in the shelf's slot the band stays as last measured, as the shelf
// keeps its own: a selection never moves the canvas.
//
// ITS KEYS ARE ITS OWN. The hive's keymap reads every key off the window
// before the key gets here, and it does not see into a shadow root, so a
// handler in the strip cannot keep a key from it. While the strip holds the
// focus it asks the keymap to stand down (`keymap:suppress`), so a word typed
// in the field stays a word and an arrow along the row stays on the row.
// Escape pierces that, so the strip also says it answers Escape itself
// (`data-escape-local`, keyboard/escape-cascade.ts): in the field it clears
// the words and then leaves, on a chip it leaves the row, and the press that
// does either never also closes what is open in the hive.
//
// NOTHING HERE IS TRUTH. A host switched off is not unfollowed and nothing
// about it is forgotten (H4): the one thing kept is the list of exceptions in
// `pools:sources`, software-written state where only the current version
// counts (P6), local to this hive and never a federated fact (M3). A
// participant is switched for the session only: a participant is per room, and
// nothing about a room is written to the store. Following a host is the hosts
// window's act and joining a room is the room's; this strip offers neither.
//
// Every word a person reads goes through i18n with an English fallback, and
// every name that came from a person, a host, a file or a catalog reaches the
// page as text: the strip is built with the DOM, never from markup.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import {
  DOMAIN_SHELF_WANTED,
  LIGHTS_MODE,
  SOURCES_CHANGED,
  SOURCES_COUNTED,
  SOURCES_NODES,
  SOURCES_QUERY,
  type DomainShelfWanted,
  type LightsMode,
  type SourcesCounted,
  type SourcesNodes,
  type SourcesState,
} from './lights-contract.js'
import { poolNodeInitials, poolNodeKey, poolNodeTitle, type PoolNode } from './pool-node.js'
import {
  followedZones,
  readSourcesOff,
  sourceDomainNodes,
  sourceParticipantNodes,
  sourcesStateOf,
  toggleSource,
  toggleSourceNode,
  writeSourcesOff,
} from './pool-sources.js'

export const DOMAIN_SHELF_SURFACE = 'hc-domain-shelf'

/** The services the strip works through. Each is resolved when it is used, so
 *  a spec can stand in for any of them; the live one answers for the rest. */
export interface DomainShelfSeams {
  /** Every host this hive may draw from, the participant's own first. */
  followedZones?: () => Promise<readonly string[]>
  /** The participant's own named host, '' for none. */
  ownZone?: () => Promise<string>
  /** The hosts switched off, as kept. */
  readSourcesOff?: () => Promise<readonly string[]>
  /** Keep the hosts switched off. False when it could not be written. */
  writeSourcesOff?: (off: readonly string[]) => Promise<boolean>
  /** Announce what is drawn from, and the words searched for. */
  say?: (state: SourcesState) => void
}

const LIVE: Required<DomainShelfSeams> = {
  followedZones: () => followedZones(),
  ownZone: async () => (await followedZones({ followed: async () => [] }))[0] ?? '',
  readSourcesOff: () => readSourcesOff(),
  writeSourcesOff: off => writeSourcesOff(undefined, off),
  say: state => EffectBus.emit(SOURCES_CHANGED, state),
}

type IocLike = { get?: (key: string) => unknown; whenReady?: (key: string, ready: (value: unknown) => void) => void }
const ioc = (): IocLike | undefined => (globalThis as { ioc?: IocLike }).ioc
const STORE_KEY = '@hypercomb.social/Store'

/** The shelf's tag, spelled here: importing even a constant from the shelf
 *  would carry the whole shelf into this module. */
const SHELF_TAG = 'hc-quick-tray'
/** Owner of the strip's reservation on the canvas (viewport:inset). */
const INSET_OWNER = 'domain-shelf'
/** The owner pools mode asks as (pools-mode.drone.ts), and the one its last value stands for. */
const LIGHTS_OWNER = 'pools-mode'
/** The reason the keymap stands down for while the strip holds the focus. */
const KEYS_REASON = 'domain-shelf'
/** Clear air under a strip before the next thing starts, in px. */
const INSET_GAP = 6
/** How long the field waits for the next key before it speaks. */
const TYPING_MS = 150
const QUERY_MAX = 80
/** Participants given a chip. The rest of a large room stay on and are counted in one last chip. */
const PEOPLE_SHOWN = 48

const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  let said: string | undefined
  try { said = (ioc()?.get?.(I18N_IOC_KEY) as I18nProvider | undefined)?.t(key, params) } catch { said = undefined }
  const text = said && said !== key ? said : fallback
  return params ? text.replace(/\{(\w+)\}/g, (hole, name: string) => Object.hasOwn(params, name) ? String(params[name]) : hole) : text
}

/** A seam's answer, or the fallback when it throws: a read that fails is an empty read. */
const quiet = async <T>(read: () => Promise<T>, otherwise: T): Promise<T> => {
  try { return await read() } catch { return otherwise }
}

const make = (tag: string, className: string, text?: string): HTMLElement => {
  const element = document.createElement(tag)
  element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

/** Marks drawn inline: an icon font does not reach into a shadow root. */
const drawn = (d: string): SVGSVGElement => {
  const space = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(space, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(space, 'path')
  path.setAttribute('fill', 'currentColor')
  path.setAttribute('d', d)
  svg.append(path)
  return svg
}
/** Sources: two machines, one above the other. */
const DOMAINS_PATH = 'M20 13H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1v-6c0-.55-.45-1-1-1zM7 19c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM20 3H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1V4c0-.55-.45-1-1-1zM7 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z'
/** The search: a magnifier. */
const SEARCH_PATH = 'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z'

// One step under the shelf (59998), so a row the shelf lifts and its ghost stay
// above this strip; above the canvas, banners and the participants' hive.
const STYLE = `
:host{position:fixed;inset:0;z-index:59997;pointer-events:none;
  --domains:111,211,154;--domains-ink:12,28,46;
  --shelf-left:calc(max(var(--hc-controls-left,0px),var(--hc-inset-left,0px),var(--hc-seam-right,0px)) + 0.5rem);
  --shelf-right:calc(var(--hc-inset-right,0px) + 0.5rem);}
[hidden]{display:none !important;}
.strip{pointer-events:auto;position:absolute;top:var(--domains-top,calc(var(--hc-header-anchor,0px) + 0.375rem));
  left:var(--shelf-left);right:var(--shelf-right);
  height:2.75rem;box-sizing:border-box;display:flex;align-items:center;
  gap:0.75rem;padding:0 0.75rem 0 0.95rem;border-radius:var(--hc-radius-floating,4px);
  background:rgba(var(--hc-panel-pane,12,28,46),0.9);
  backdrop-filter:blur(10px) saturate(1.1);-webkit-backdrop-filter:blur(10px) saturate(1.1);
  box-shadow:inset 0 0 2.75rem -1.25rem rgba(var(--domains),0.5),0 8px 28px rgba(var(--hc-panel-shadow,0,0,0),0.28);
  font-family:var(--hc-font,system-ui);font-size:0.85rem;font-weight:400;color:var(--hc-window-ink-loud,currentColor);user-select:none;}
.strip::before{content:'';position:absolute;inset:0.25rem;pointer-events:none;border-radius:var(--hc-radius-control,2px);
  --cut:rgba(var(--domains),0.5);
  background-image:repeating-linear-gradient(90deg,var(--cut) 0 7px,transparent 7px 14px),
    repeating-linear-gradient(90deg,var(--cut) 0 7px,transparent 7px 14px),
    repeating-linear-gradient(180deg,var(--cut) 0 7px,transparent 7px 14px),
    repeating-linear-gradient(180deg,var(--cut) 0 7px,transparent 7px 14px);
  background-size:100% 1px,100% 1px,1px 100%,1px 100%;background-position:0 0,0 100%,0 0,100% 0;background-repeat:no-repeat;}
.legend{position:relative;flex:0 0 auto;display:inline-flex;align-items:center;gap:0.45rem;letter-spacing:0.12em;text-transform:uppercase;
  font-family:var(--hc-mono,ui-monospace,monospace);font-size:0.68rem;font-weight:600;color:rgb(var(--domains));white-space:nowrap;}
.legend svg{width:1rem;height:1rem;display:block;flex:0 0 auto;}
.count{height:1.4em;box-sizing:border-box;display:inline-grid;place-items:center;padding:0 0.45em;
  border-radius:var(--hc-radius-control,2px);background:rgba(var(--domains),0.16);color:var(--hc-window-ink-loud,currentColor);
  font-variant-numeric:tabular-nums;letter-spacing:0.04em;text-transform:none;}
.chips{position:relative;flex:1 1 0;display:flex;align-items:center;gap:0.6rem;min-width:0;height:100%;box-sizing:border-box;
  padding:0 1.5rem 0 0.3rem;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;
  mask-image:linear-gradient(90deg,#000 calc(100% - 1.5rem),transparent);-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 1.5rem),transparent);}
.chips::-webkit-scrollbar{display:none;}
.group{flex:0 0 auto;display:inline-flex;align-items:center;gap:0.4rem;}
.divider{flex:0 0 auto;width:1px;height:1.4rem;background:rgba(var(--domains),0.45);}
.chip{position:relative;flex:0 0 auto;appearance:none;display:inline-grid;place-items:center;width:1.9rem;height:1.9rem;
  box-sizing:border-box;padding:0;border-radius:var(--hc-radius-control,2px);border:1px dashed rgba(var(--domains),0.7);
  background:transparent;color:var(--hc-window-ink-plain,currentColor);opacity:0.6;cursor:pointer;outline:none;
  font-family:var(--hc-mono,ui-monospace,monospace);font-size:0.68rem;font-weight:600;line-height:1;letter-spacing:0.04em;white-space:nowrap;
  transition:border-color 120ms ease,background-color 120ms ease,opacity 120ms ease;}
.chip.person{border-radius:50%;}
.chip[aria-pressed="true"]{opacity:1;color:var(--hc-window-ink-loud,currentColor);
  background:rgba(var(--domains),0.24);border-style:solid;border-color:rgba(var(--domains),0.65);}
.chip.you{box-shadow:0 0 0 1px rgba(var(--domains),0.9);border-color:rgba(var(--domains),0.9);}
.chip:hover{opacity:1;border-color:rgb(var(--domains));}
.chip:focus-visible{opacity:1;outline:2px solid rgb(var(--domains));outline-offset:2px;}
.badge{position:absolute;top:-0.35rem;right:-0.4rem;min-width:0.95rem;height:0.95rem;box-sizing:border-box;display:grid;place-items:center;
  padding:0 0.2rem;border-radius:var(--hc-radius-control,2px);background:rgb(var(--domains));color:rgb(var(--domains-ink));
  font-size:0.56rem;font-weight:700;letter-spacing:0;font-variant-numeric:tabular-nums;}
.more{flex:0 0 auto;display:inline-grid;place-items:center;height:1.9rem;padding:0 0.25rem;color:var(--hc-window-ink-plain,currentColor);
  font-family:var(--hc-mono,ui-monospace,monospace);font-size:0.68rem;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;}
.empty{color:var(--hc-window-ink-plain,currentColor);opacity:0.8;white-space:nowrap;}
.tip{position:absolute;top:calc(100% + 0.35rem);left:0;transform:translateX(-50%);box-sizing:border-box;max-width:min(22rem,80vw);
  padding:0.2rem 0.5rem;border-radius:var(--hc-radius-control,2px);border:1px solid rgba(var(--domains),0.55);
  background:rgba(var(--hc-panel-pane,12,28,46),0.96);color:var(--hc-window-ink-loud,currentColor);
  font-size:0.78rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;}
.search{position:relative;flex:0 1 15rem;min-width:6rem;display:inline-flex;align-items:center;gap:0.35rem;color:rgba(var(--domains),0.9);}
.search svg{width:0.95rem;height:0.95rem;display:block;flex:0 0 auto;}
.query{flex:1 1 auto;width:100%;min-width:0;box-sizing:border-box;background:transparent;color:var(--hc-window-ink-loud,currentColor);
  border:0;border-bottom:1px solid var(--hc-window-line,currentColor);font:inherit;padding:0.15em 0.3em;outline:none;}
.query:focus{border-bottom-color:rgb(var(--domains));}
.query::placeholder{color:var(--hc-window-ink-plain,currentColor);opacity:0.6;}
@media (prefers-reduced-motion:reduce){.chip{transition:none;}}
@media (max-width:640px){.strip{gap:0.5rem;padding-left:0.75rem;}.legend .word{display:none;}.search{flex-basis:8rem;min-width:4rem;}}
`

/** Where a key takes the chip in hand along the row, or null when it moves nothing. */
const chipStep = (key: string, at: number, last: number): number | null => {
  if (key === 'ArrowRight') return Math.min(at + 1, last)
  if (key === 'ArrowLeft') return Math.max(at - 1, 0)
  if (key === 'Home') return 0
  if (key === 'End') return last
  return null
}

/** Whether the chip holds the focus because of a key. Where the question cannot be asked, it does. */
const keyed = (chip: Element): boolean => {
  try { return chip.matches(':focus-visible') } catch { return true }
}

type StripParts = { count: HTMLElement; chips: HTMLElement; input: HTMLInputElement; tip: HTMLElement }
type Chip = { node: PoolNode; button: HTMLButtonElement; badge: HTMLElement }

export class DomainShelfElement extends HTMLElement {
  #root: ShadowRoot
  #seams: DomainShelfSeams = {}
  #offs: Array<() => void> = []
  /** The surfaces that want the strip in view. None, and it shows nothing. */
  #owners = new Set<string>()
  /** Every host drawn from or switched off, the participant's own first. */
  #all: readonly string[] = []
  /** The hosts switched off: the one list that is kept. */
  #off: readonly string[] = []
  #own = ''
  /** The room's participants as a surface last announced them, the reader's own first. */
  #people: readonly PoolNode[] = []
  /** The participants switched off, by node key. Held for the session and never kept. */
  #offPeople: readonly string[] = []
  /** The search field's words, as typed. */
  #query = ''
  /** How many members each node offers of the pool on screen, when somebody counted. */
  #counts = new Map<string, number>()
  /** The strip as built, while it is in view. */
  #parts: StripParts | null = null
  /** The chips on the row by node key, in the order shown. */
  #chips = new Map<string, Chip>()
  /** The nodes the row was last laid out for, so it is laid again only when they change. */
  #laid = ''
  /** The chip the Tab key lands on: one stop for the row, arrows move along it. */
  #cursor = ''
  /** Whether the keymap was asked to stand down, so it is asked and released once each. */
  #hushed = false
  /** The latest read wins; one begun earlier no longer speaks. */
  #turn = 0
  #loaded = false
  /** What was last announced, so the same state is said once. */
  #said = ''
  /** The off list here is newer than the one kept: a read must not put the old one back. */
  #held = false
  #kept: Promise<void> = Promise.resolve()
  #typing: ReturnType<typeof setTimeout> | undefined
  #frame = 0
  /** The top band last reserved on the canvas, in px. */
  #reserved = -1
  /** The band last measured with the shelf itself above, kept while a selection stands there. */
  #band = 0
  #watched: ShadowRoot | null = null
  #observer: MutationObserver | null = null

  constructor() {
    super()
    this.#root = this.attachShadow({ mode: 'open' })
  }

  /** Stand in for the live services. Set before the element is connected. */
  set seams(seams: DomainShelfSeams) { this.#seams = seams }

  /** What the strip announces: read by specs, never written from outside. */
  get state(): SourcesState {
    const offDomains = this.#off.map(zone => poolNodeKey({ kind: 'domain', id: zone }))
    return sourcesStateOf(sourceDomainNodes(this.#all, this.#own), this.#people, [...offDomains, ...this.#offPeople], this.#query)
  }

  /** Whether any surface wants the strip in view. */
  get wanted(): boolean { return this.#owners.size > 0 }

  connectedCallback(): void {
    // Read by the escape cascade off the focused element, which from outside a
    // shadow root is this element whenever anything inside it holds the focus.
    this.setAttribute('data-escape-local', '')
    // A want is a command, sent transient: a strip that mounts later never
    // replays one and stands there for a surface long gone.
    this.#offs.push(EffectBus.on<DomainShelfWanted | undefined>(DOMAIN_SHELF_WANTED, (p) => {
      if (typeof p?.owner !== 'string' || !p.owner) return
      if (p.wanted) this.#owners.add(p.owner)
      else this.#owners.delete(p.owner)
      this.#render()
    }))
    // Pools mode is last-value state, so it is heard however late the strip
    // mounts: up is pools mode wanting the strip, down is pools mode leaving.
    this.#offs.push(EffectBus.on<LightsMode | undefined>(LIGHTS_MODE, (mode) => {
      if (typeof mode?.active !== 'boolean') return
      if (mode.active) this.#owners.add(LIGHTS_OWNER)
      else this.#owners.delete(LIGHTS_OWNER)
      this.#render()
    }))
    // Who a surface found in the joined room. Last-value: a surface that
    // leaves announces nobody, and the participants go with it.
    this.#offs.push(EffectBus.on<SourcesNodes | undefined>(SOURCES_NODES, (p) => {
      this.#people = sourceParticipantNodes(p?.nodes)
      this.#paint()
      this.#announce()
    }))
    // Words put in the field from elsewhere: set, never focused, said at once.
    this.#offs.push(EffectBus.on<{ query?: unknown } | undefined>(SOURCES_QUERY, (p) => {
      if (typeof p?.query !== 'string') return
      clearTimeout(this.#typing)
      this.#typing = undefined
      this.#query = p.query.trim().slice(0, QUERY_MAX)
      const input = this.#parts?.input
      if (input && input.value !== this.#query) input.value = this.#query
      this.#announce()
    }))
    // Last-value state, so a replay is the count as it stands, not an act.
    this.#offs.push(EffectBus.on<SourcesCounted | undefined>(SOURCES_COUNTED, (p) => {
      this.#counts = new Map(Object.entries(p?.counts ?? {})
        .filter(([, count]) => typeof count === 'number' && Number.isFinite(count) && count >= 0)
        .map(([node, count]) => [node.toLowerCase(), Math.floor(count)]))
      this.#paint()
    }))
    // The hosts window's list is the change signal for who is followed.
    this.#offs.push(EffectBus.on('hosts:render', () => { void this.#load() }))
    // A canvas owner that started late asks for every reservation again.
    this.#offs.push(EffectBus.on('viewport:inset-poll', () => { this.#reserved = -1; this.#place() }))
    this.#offs.push(EffectBus.on('shelf:changed', () => { this.#place() }))
    window.addEventListener('resize', this.#onResize)
    this.#render()
    void this.#load()
    // The store may arrive after the strip mounts: what it keeps is read then.
    const container = ioc()
    if (!container?.get?.(STORE_KEY)) container?.whenReady?.(STORE_KEY, () => { if (this.isConnected) void this.#load() })
  }

  disconnectedCallback(): void {
    for (const off of this.#offs.splice(0)) off()
    window.removeEventListener('resize', this.#onResize)
    if (this.#typing !== undefined) this.#typed()
    this.#turn++
    cancelAnimationFrame(this.#frame)
    this.#watch(null)
    this.#clear()
    this.#band = 0
    this.#reserved = -1
    EffectBus.emit('viewport:inset', { owner: INSET_OWNER, side: 'top', size: 0 })
  }

  // ── what is drawn from ───────────────────────────────────────────────────

  #seam<K extends keyof DomainShelfSeams>(name: K): Required<DomainShelfSeams>[K] {
    return (this.#seams[name] ?? LIVE[name]) as Required<DomainShelfSeams>[K]
  }

  /** Read who is followed and who is switched off, then paint and say it. */
  async #load(): Promise<void> {
    const turn = ++this.#turn
    const [all, own] = await Promise.all([
      quiet(() => this.#seam('followedZones')(), [] as readonly string[]),
      quiet(() => this.#seam('ownZone')(), ''),
    ])
    // A press still being kept is waited for, so the read sees it.
    await this.#kept
    const off = await quiet(() => this.#seam('readSourcesOff')(), [] as readonly string[])
    if (turn !== this.#turn) return
    this.#all = [...new Set(all)]
    this.#own = own
    if (!this.#held) this.#off = [...off]
    this.#loaded = true
    this.#paint()
    this.#announce()
  }

  /** A chip pressed: the node switches and the change is said. A domain's
   *  exception is kept; a participant's lasts the session and is written nowhere. */
  #toggle(node: PoolNode): void {
    if (node.kind === 'participant') this.#offPeople = toggleSourceNode(this.#offPeople, node)
    else this.#keep(toggleSource(this.#off, node.id))
    this.#paint()
    this.#announce()
  }

  /** Hold the hosts switched off, and keep the list behind the one before it. */
  #keep(off: readonly string[]): void {
    this.#off = off
    this.#held = true
    this.#kept = this.#kept.then(async () => {
      const kept = await quiet(() => this.#seam('writeSourcesOff')(off), false)
      if (kept && off === this.#off) this.#held = false
    })
  }

  /** Say what is drawn from, once per state. Nothing is said before the first read lands. */
  #announce(): void {
    if (!this.#loaded) return
    const state = this.state
    const key = JSON.stringify(state)
    if (key === this.#said) return
    this.#said = key
    this.#seam('say')(state)
  }

  /** The field's words as they stand now, said without waiting. */
  #typed(): void {
    clearTimeout(this.#typing)
    this.#typing = undefined
    if (this.#parts) this.#query = this.#parts.input.value
    this.#announce()
  }

  // ── paint ────────────────────────────────────────────────────────────────

  /**
   * Bring the strip up for its first owner, take it away with its last. The
   * words go with the last owner, typed out or not, and that is said: the
   * state is a last value, so words left behind would filter whichever
   * surface asked for the strip next, on a search it never made.
   */
  #render(): void {
    if (this.wanted && !this.#parts) this.#build()
    if (!this.wanted && this.#parts) {
      clearTimeout(this.#typing)
      this.#typing = undefined
      this.#query = ''
      this.#clear()
      this.#announce()
    }
    this.#paint()
    this.#place()
  }

  /** Take the strip off the page. Who is drawn from stays as it is. */
  #clear(): void {
    // A strip taken away while it held the focus tells nobody it lost it.
    this.#hush(false)
    this.#parts = null
    this.#chips = new Map()
    this.#laid = ''
    this.#root.replaceChildren()
  }

  /** Ask the hive's keymap to stand down while the strip holds the focus, and to come back after. */
  #hush(held: boolean): void {
    if (held === this.#hushed) return
    this.#hushed = held
    EffectBus.emitTransient(held ? 'keymap:suppress' : 'keymap:unsuppress', { reason: KEYS_REASON })
  }

  #build(): void {
    const style = document.createElement('style')
    style.textContent = STYLE
    const strip = make('section', 'strip')
    strip.setAttribute('role', 'toolbar')
    strip.setAttribute('aria-label', t('pools.domains.nodes-label', 'Domains and people you draw pools from'))
    strip.setAttribute('data-consumes-wheel', '')
    const count = make('span', 'count')
    const legend = make('span', 'legend')
    legend.append(drawn(DOMAINS_PATH), make('span', 'word', t('pools.domains.from', 'From')), count)
    const chips = make('div', 'chips')
    const words = t('pools.domains.search', 'search what they offer')
    const input = document.createElement('input')
    input.className = 'query'
    input.type = 'text'
    input.spellcheck = false
    input.autocomplete = 'off'
    input.maxLength = QUERY_MAX
    input.placeholder = words
    input.setAttribute('aria-label', words)
    input.value = this.#query
    const search = make('label', 'search')
    search.append(drawn(SEARCH_PATH), input)
    // The name of the chip the keyboard holds, said under it. A screen reader
    // already has the chip's own name, so this is for the eye alone.
    const tip = make('span', 'tip')
    tip.setAttribute('aria-hidden', 'true')
    tip.hidden = true
    strip.append(legend, chips, search, tip)

    strip.addEventListener('focusin', () => { this.#hush(true) })
    strip.addEventListener('focusout', (e) => {
      if (!strip.contains(e.relatedTarget as Node | null)) this.#hush(false)
    })
    input.addEventListener('input', () => {
      clearTimeout(this.#typing)
      this.#typing = setTimeout(() => this.#typed(), TYPING_MS)
    })
    // Keys typed here are words, kept from anything listening above the
    // strip. Escape clears the words first, and leaves the field only when
    // there are none.
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (!input.value) { input.blur(); return }
      input.value = ''
      this.#typed()
    })
    // One Tab stop for the row; arrows, Home and End move along it. Space and
    // Enter press the chip in hand, Escape lets go of the row, and none of
    // them reaches the hive.
    chips.addEventListener('keydown', (e) => {
      const from = (e.target as HTMLElement | null)?.closest?.('.chip') as HTMLButtonElement | null
      if (!from) return
      if (e.key === ' ' || e.key === 'Enter') { e.stopPropagation(); return }
      if (e.key === 'Escape') { e.stopPropagation(); from.blur(); return }
      const row = [...this.#chips.values()].map(chip => chip.button)
      const to = chipStep(e.key, row.indexOf(from), row.length - 1)
      if (to === null) return
      e.preventDefault()
      e.stopPropagation()
      row[to]?.focus()
    })
    chips.addEventListener('focusout', () => { tip.hidden = true })
    // The row moved under the name: the name follows the chip it is for.
    chips.addEventListener('scroll', () => {
      const held = this.#root.activeElement
      if (!tip.hidden && held instanceof HTMLButtonElement) this.#tell(held)
    }, { passive: true })
    // A wheel anywhere over the strip scrolls the chips sideways, so a long
    // row reads with a mouse and the hive under it does not pan.
    strip.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      chips.scrollLeft += e.deltaY
      e.preventDefault()
    }, { passive: false })

    this.#root.replaceChildren(style, strip)
    this.#parts = { count, chips, input, tip }
  }

  /** What hovering a node says: its whole name, and that it is the reader's own. */
  #named(node: PoolNode): string {
    const name = poolNodeTitle(node)
    return node.you ? t('pools.domains.yours', '{name} (you)', { name }) : name
  }

  /** One chip: a plate of two initials, square for a domain and round for a
   *  participant, its whole name on hover and to a screen reader, and a count
   *  in its corner when one is known. */
  #chip(node: PoolNode): Chip {
    const key = poolNodeKey(node)
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `chip ${node.kind === 'participant' ? 'person' : 'place'}${node.you ? ' you' : ''}`
    const named = this.#named(node)
    button.title = named
    button.setAttribute('aria-label', named)
    const badge = make('span', 'badge')
    badge.hidden = true
    button.append(make('span', 'initials', poolNodeInitials(node)), badge)
    button.addEventListener('click', () => this.#toggle(node))
    button.addEventListener('focus', () => {
      this.#cursor = key
      for (const [other, chip] of this.#chips) chip.button.tabIndex = other === key ? 0 : -1
      if (keyed(button)) this.#tell(button)
    })
    return { node, button, badge }
  }

  /** Say the chip's name under it, for somebody who came by the keyboard and has no hover. */
  #tell(button: HTMLButtonElement): void {
    const tip = this.#parts?.tip
    const strip = tip?.parentElement
    if (!tip || !strip) return
    const chip = button.getBoundingClientRect()
    tip.textContent = button.title
    tip.style.left = `${Math.round(chip.left + chip.width / 2 - strip.getBoundingClientRect().left)}px`
    tip.hidden = false
  }

  /** A group of chips with a name a screen reader hears on the way in. */
  #group(className: string, label: string, chips: readonly HTMLElement[]): HTMLElement {
    const group = make('span', `group ${className}`)
    group.setAttribute('role', 'group')
    group.setAttribute('aria-label', label)
    group.append(...chips)
    return group
  }

  /** Lay the row out again: the domains, then a divider and the room's
   *  participants while any are known, or the words that say how a node appears. */
  #layChips(parts: StripParts, all: readonly PoolNode[]): void {
    const row = parts.chips
    const held = row.contains(this.#root.activeElement)
    const places = all.filter(node => node.kind === 'domain')
    const people = all.filter(node => node.kind === 'participant')
    const shown = people.slice(0, PEOPLE_SHOWN)
    this.#chips = new Map([...places, ...shown].map(node => [poolNodeKey(node), this.#chip(node)]))
    parts.tip.hidden = true
    if (this.#chips.size === 0) {
      row.replaceChildren(make('span', 'empty', t('pools.domains.none', 'Nobody to draw from yet. Follow a host in the hosts window, or join a room, and they appear here.')))
      return
    }
    const buttons = (nodes: readonly PoolNode[]): HTMLElement[] =>
      nodes.flatMap(node => this.#chips.get(poolNodeKey(node))?.button ?? [])
    const laid: HTMLElement[] = []
    if (places.length) laid.push(this.#group('places', t('pools.domains.group-domains', 'Domains'), buttons(places)))
    if (places.length && shown.length) {
      const divider = make('span', 'divider')
      divider.setAttribute('role', 'separator')
      divider.setAttribute('aria-orientation', 'vertical')
      laid.push(divider)
    }
    if (shown.length) {
      const group = this.#group('people', t('pools.domains.group-people', 'People in the room'), buttons(shown))
      const rest = people.length - shown.length
      if (rest > 0) {
        // Not a switch: the people past the last chip stay on.
        const more = make('span', 'more', t('pools.domains.more', '+{n}', { n: rest }))
        more.title = t('pools.domains.more-title', 'And {n} more in the room, all drawn from', { n: rest })
        group.append(more)
      }
      laid.push(group)
    }
    row.replaceChildren(...laid)
    if (!this.#chips.has(this.#cursor)) this.#cursor = this.#chips.keys().next().value ?? ''
    if (held) this.#chips.get(this.#cursor)?.button.focus()
  }

  /** How many members a node offers, when somebody counted: by its key, or by its bare zone or key. */
  #counted(key: string, node: PoolNode): number | undefined {
    return this.#counts.get(key.toLowerCase()) ?? this.#counts.get(node.id.toLowerCase())
  }

  /** Bring what is on the strip level with what is known. The row is laid out
   *  again only when the nodes changed, so a press in flight is never lost.
   *  Nothing here changes the strip's own box, so nothing is measured again. */
  #paint(): void {
    const parts = this.#parts
    if (!parts) return
    const state = this.state
    const all = state.allNodes ?? []
    const on = new Set((state.nodes ?? []).map(poolNodeKey))
    parts.count.hidden = all.length === 0
    parts.count.textContent = t('pools.domains.count', '{on} of {all}', { on: on.size, all: all.length })
    const nodes = JSON.stringify(all.map(node => [poolNodeKey(node), node.name ?? '', node.you === true]))
    if (nodes !== this.#laid || !parts.chips.firstChild) {
      this.#layChips(parts, all)
      this.#laid = nodes
    }
    for (const [key, { node, button, badge }] of this.#chips) {
      button.setAttribute('aria-pressed', String(on.has(key)))
      button.tabIndex = key === this.#cursor ? 0 : -1
      const count = this.#counted(key, node)
      const offers = count === undefined ? '' : t('pools.domains.offers', '{domain} offers {n}', { domain: poolNodeTitle(node), n: count })
      badge.hidden = count === undefined
      badge.textContent = count === undefined ? '' : String(count)
      badge.title = offers
      if (offers) button.setAttribute('aria-description', offers)
      else button.removeAttribute('aria-description')
    }
  }

  // ── where it stands ──────────────────────────────────────────────────────

  /** Follow the shelf's own repaints while the strip is in view: the shelf
   *  can come up, fold or change hands with no word on the bus. */
  #watch(shelf: ShadowRoot | null): void {
    if (shelf === this.#watched) return
    this.#observer?.disconnect()
    this.#observer = null
    this.#watched = shelf
    if (!shelf || typeof MutationObserver === 'undefined') return
    this.#observer = new MutationObserver(() => { this.#place() })
    this.#observer.observe(shelf, { childList: true })
  }

  /** Stand under the shelf, or in its place when it is away, and hold the
   *  band down to this strip's bottom on the canvas. Measured after layout. */
  #place(): void {
    cancelAnimationFrame(this.#frame)
    this.#frame = requestAnimationFrame(() => {
      const strip = this.#root.querySelector('.strip')
      this.#watch(strip ? document.querySelector(SHELF_TAG)?.shadowRoot ?? null : null)
      if (!strip) { this.#band = 0; this.#reserve(0); return }
      const shelf = this.#watched?.querySelector('.shelf') ?? null
      if (shelf) this.style.setProperty('--domains-top', `${Math.round(shelf.getBoundingClientRect().bottom + INSET_GAP)}px`)
      else this.style.removeProperty('--domains-top')
      // The selection shelf lays over the canvas and moves nothing: under it
      // this strip lays over too, and the band stays as it was.
      if (!shelf?.classList.contains('picks')) this.#band = Math.round(strip.getBoundingClientRect().bottom + INSET_GAP)
      this.#reserve(this.#band)
    })
  }

  #reserve(size: number): void {
    if (size === this.#reserved) return
    this.#reserved = size
    EffectBus.emit('viewport:inset', { owner: INSET_OWNER, side: 'top', size })
  }

  #onResize = (): void => { this.#place() }
}

/** Define the element once; safe under hot reload and in specs. */
export const defineDomainShelf = (): void => {
  if (!customElements.get(DOMAIN_SHELF_SURFACE)) customElements.define(DOMAIN_SHELF_SURFACE, DomainShelfElement)
}
