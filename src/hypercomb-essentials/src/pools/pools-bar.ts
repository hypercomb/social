// pools/pools-bar.ts
//
// THE POOLS BAR. Pools mode is the stage between private and the swarm: every
// tile is on or off, and what is on is offered (lights-contract.ts). This is
// the bar that says so in words while the mode is up: how many tiles are on
// here and in all, what Publish would leave in which pool, and the ways on
// from here: Publish, Join the swarm, Close. Under them, when the drone hands
// one in, the row of the leader's pools opened for posts
// (open-entries-panel.ts): a row of its own, so this builder knows nothing of it.
//
// A framework-free builder and nothing else. It registers nothing, listens to
// nothing and keeps nothing but the nodes it made: the drone
// (pools-mode.drone.ts) hands in the words (`say`), the callbacks and each new
// state, and mounts the element. Built ONCE and updated in place, because a
// control rebuilt under a finger loses the press (selection/select-mode.drone.ts).
//
// Publishing is a press and only a press (T5): the bar counts what the lit
// tiles would leave in a pool (T9, P6) and sends nothing. Every drawing is an
// inline SVG path, so no font and no host is asked for anything (T7), and
// every word a person, a file or a host supplied reaches the page as text,
// never as markup.

import { I18N_IOC_KEY, get, type I18nProvider } from '@hypercomb/core'
import type { LightsPublished } from './lights-contract.js'
import type { PoolContribution } from './pool-contributions.js'

/** The words for a key, with the English beside it for a catalog that lacks it. */
export type PoolsBarSay = (key: string, fallback: string, params?: Record<string, string | number>) => string

/** One pool Publish would leave, as the preview counts it. */
export interface PoolsBarPool {
  readonly meaning: string
  readonly count: number
  readonly label: PoolContribution['label']
}

export interface PoolsBarState {
  /** Tiles on this page that are on. */
  readonly here: number
  /** Tiles that are on in the whole hive, a lit branch counted with everything under it. */
  readonly total: number
  readonly pools: readonly PoolsBarPool[]
  /** A publish is running. */
  readonly busy: boolean
  /** What the last publish did, in words. Null before one, and once the lights change. */
  readonly outcome: { readonly text: string; readonly ok: boolean } | null
  /** Something on this page is off, so All on here has work to do. */
  readonly canOn: boolean
  /** Something on this page was turned on here, so All off here has work to do. */
  readonly canOff: boolean
  /** A finger is the pointer: the whole branch is a hold, not Shift. */
  readonly touch: boolean
}

export interface PoolsBarOptions {
  readonly say: PoolsBarSay
  onPublish(): void
  onJoin(): void
  onClose(): void
  onAllOn(): void
  onAllOff(): void
  /** A row of the drone's own to put under the others: the leader's pools opened for posts. */
  readonly posts?: HTMLElement
}

/** Above the reparented canvas and under the shell's chrome: the slot the
 *  select pill uses (selection/select-mode.drone.ts explains the number). The
 *  two never show together: the pools bar stands down while tiles are picked. */
const BAR_Z = 59992
/** The colour of a tile that is on, as the hover band and the badge draw it. */
const ON = '#6fd39a'

const BULB_PATH = 'M9 21c0 .5.4 1 1 1h4c.6 0 1-.5 1-1v-1H9v1zm3-19C8.1 2 5 5.1 5 9c0 2.4 1.2 4.5 3 5.7V17c0 .5.4 1 1 1h6c.6 0 1-.5 1-1v-2.3c1.8-1.3 3-3.4 3-5.7 0-3.9-3.1-7-7-7z'
const CLOSE_PATH = 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'
const LEAVE_PATH = 'M5 4v2h14V4H5zm0 10h4v6h6v-6h4l-7-7-7 7z'
const ONWARD_PATH = 'M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z'
const REFUSED_PATH = 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z'

const STYLE = `
.hc-pools-bar{position:fixed;left:50%;transform:translateX(-50%);z-index:${BAR_Z};
  bottom:calc(max(var(--hc-controls-bottom, 0px), env(safe-area-inset-bottom,0px)) + var(--hc-mobile-row-lift, 0px) + 0.6rem);
  box-sizing:border-box;width:min(54rem,94vw);padding:0.6rem 0.7rem 0.5rem 0.85rem;display:grid;gap:0.3rem;
  border-radius:var(--hc-radius-floating,4px);background:rgba(var(--hc-panel-pane,12,19,27),0.94);backdrop-filter:blur(10px);
  border:1px solid var(--hc-window-line,rgba(227,237,245,0.16));border-top:2px solid ${ON};box-shadow:0 10px 30px rgba(0,0,0,0.45);
  font-family:var(--hc-font,system-ui,sans-serif);font-size:calc(0.9rem * var(--hc-panel-scale,1));line-height:1.35;
  color:var(--hc-window-ink-plain,rgba(227,237,245,0.86));pointer-events:auto;}
.hc-pools-bar svg{flex:none;width:1.05rem;height:1.05rem;fill:currentColor;}
.hc-pools-row{display:flex;align-items:center;gap:0.55rem;flex-wrap:wrap;}
.hc-pools-bulb{flex:none;display:inline-flex;color:${ON};}
.hc-pools-bulb svg{width:1.35rem;height:1.35rem;}
.hc-pools-title{flex:none;font-family:var(--hc-mono,ui-monospace,monospace);font-size:0.72em;letter-spacing:0.16em;text-transform:uppercase;color:${ON};}
.hc-pools-say{flex:1 1 14rem;min-width:0;color:var(--hc-window-ink-loud,#eef2f5);overflow-wrap:anywhere;}
.hc-pools-refused{flex:none;display:inline-flex;color:var(--hc-status-alert,var(--hc-window-ink-loud,#eef2f5));}
.hc-pools-refused[hidden]{display:none;}
.hc-pools-say[data-tone="refused"]{color:var(--hc-status-warn,var(--hc-window-ink-loud,#eef2f5));font-weight:600;}
.hc-pools-counts{flex:1 1 14rem;min-width:0;padding-left:1.9rem;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;}
.hc-pools-quiet{padding-left:1.9rem;gap:0.2rem 0.75rem;font-size:0.84em;color:var(--hc-window-ink-quiet,rgba(227,237,245,0.68));}
.hc-pools-bar button{appearance:none;font:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:0.4rem;white-space:nowrap;
  min-height:2.1rem;padding:0 0.8rem;border-radius:var(--hc-radius-control,2px);background:transparent;
  border:1px solid var(--hc-window-line,rgba(227,237,245,0.18));color:var(--hc-window-ink-loud,#eef2f5);}
.hc-pools-bar button:hover,.hc-pools-bar button:focus-visible{border-color:${ON};outline:none;}
.hc-pools-bar button[disabled]{opacity:0.5;cursor:default;border-color:var(--hc-window-line,rgba(227,237,245,0.18));}
.hc-pools-bar button.hc-pools-publish{background:${ON};border-color:transparent;color:#04180f;font-weight:600;}
.hc-pools-bar button.hc-pools-text{min-height:1.5rem;padding:0;border:0;color:inherit;text-decoration:underline;text-underline-offset:0.2em;}
.hc-pools-bar button.hc-pools-text:hover,.hc-pools-bar button.hc-pools-text:focus-visible{color:${ON};}
.hc-pools-bar button.hc-pools-text[disabled]{text-decoration:none;}
`

/** The words for a key from the hive's catalog, the English when it has none, with `{name}` holes filled either way. */
export const poolsSay: PoolsBarSay = (key, fallback, params) => {
  let said: string | undefined
  try { said = get<I18nProvider>(I18N_IOC_KEY)?.t(key, params) } catch { said = undefined }
  const text = said && said !== key ? said : fallback
  return params ? text.replace(/\{(\w+)\}/g, (hole, name: string) => name in params ? String(params[name]) : hole) : text
}

/** A count of one pool's members in that pool's own words: "2 recipe templates". */
const counted = (say: PoolsBarSay, label: PoolContribution['label'], count: number): string =>
  say(label.key, count === 1 ? label.one : label.other, { count })

/** One pool's members named without a number: its plural words with the count taken out. */
const uncounted = (say: PoolsBarSay, label: PoolContribution['label']): string =>
  say(`${label.key}.other`, label.other).replace(/\{count\}/g, '').replace(/\s+/g, ' ').trim()

/**
 * The live line: how many are on here, how many in all, and what Publish would
 * leave. What is on here is on in all, so the whole is never said below its
 * part: the page is counted at once and the hive a moment later, and the
 * hive's walk stops at a limit a long page can pass.
 */
export function poolsBarCounts(say: PoolsBarSay, state: Pick<PoolsBarState, 'here' | 'total' | 'pools'>): string {
  const leaving = state.pools.filter(pool => pool.count > 0).map(pool => counted(say, pool.label, pool.count))
  return [
    say('pools.bar.here', '{count} on here', { count: state.here }),
    say('pools.bar.total', '{count} on in all', { count: Math.max(state.total, state.here) }),
    leaving.length
      ? say('pools.bar.leaves', 'leaves {what}', { what: leaving.join(', ') })
      : say('pools.bar.nothing', 'nothing to leave in a pool yet'),
  ].join(' · ')
}

/**
 * What a publish did, in sentences: one for each pool it left or took back,
 * then the reason when it did not all happen. `labelOf` gives a pool's words;
 * a pool nobody has words for is named by its meaning.
 */
export function poolsBarOutcome(
  say: PoolsBarSay,
  published: LightsPublished,
  labelOf: (meaning: string) => PoolContribution['label'] | undefined,
): string {
  const host = published.host
  const sentences = published.pools.map(pool => {
    const label = labelOf(pool.meaning)
    return pool.count > 0
      ? say('pools.bar.left', 'Left {what} in your pool at {host}', { what: label ? counted(say, label, pool.count) : `${pool.count} ${pool.meaning}`, host })
      : say('pools.bar.back', 'Took your {what} back from {host}', { what: label ? uncounted(say, label) : pool.meaning, host })
  })
  if (!published.ok) sentences.push(published.reason || say('pools.bar.failed', 'Publishing did not finish'))
  else if (!sentences.length) sentences.push(say('pools.bar.unneeded', 'Nothing that is on belongs in a pool yet, so nothing was left'))
  return sentences.map(sentence => sentence.trim().replace(/\.+$/, '')).filter(Boolean).join('. ') + '.'
}

const drawn = (path: string): SVGSVGElement => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  shape.setAttribute('d', path)
  svg.append(shape)
  return svg
}

const piece = <K extends keyof HTMLElementTagNameMap>(tag: K, name: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  node.className = name
  return node
}

/** The 2px frame around the whole viewport that says the mode is up. It takes no pointer. */
export function poolsFrame(): HTMLElement {
  const frame = document.createElement('div')
  frame.id = 'hc-pools-frame'
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText =
    `position:fixed;inset:0;z-index:${BAR_Z - 1};pointer-events:none;border:2px solid ${ON};` +
    'box-shadow:inset 0 0 0 1px rgba(111,211,154,0.25), inset 0 0 34px rgba(111,211,154,0.13);'
  return frame
}

/**
 * Build the bar. `element` is ready to mount, `update` puts a state on the
 * same nodes, `dispose` takes the element away. Every word is asked of
 * `options.say`, and every press is handed to its callback.
 */
export function poolsBar(options: PoolsBarOptions): { element: HTMLElement; update(state: PoolsBarState): void; dispose(): void } {
  const { say } = options
  const element = piece('div', 'hc-pools-bar')
  element.id = 'hc-pools-bar'
  element.setAttribute('role', 'region')
  element.setAttribute('aria-label', say('pools.bar.title', 'Pools'))
  const style = document.createElement('style')
  style.textContent = STYLE

  const button = (name: string, onPress: () => void, path?: string): { node: HTMLButtonElement; text: HTMLSpanElement } => {
    const node = piece('button', name)
    node.type = 'button'
    const text = document.createElement('span')
    if (path) node.append(drawn(path))
    node.append(text)
    node.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); if (!node.disabled) onPress() })
    return { node, text }
  }

  const bulb = piece('span', 'hc-pools-bulb')
  bulb.append(drawn(BULB_PATH))
  const title = piece('span', 'hc-pools-title')
  // A refusal is told by a mark as well as by its tone: colour alone says nothing to some eyes.
  const refused = piece('span', 'hc-pools-refused')
  refused.setAttribute('aria-hidden', 'true')
  refused.hidden = true
  refused.append(drawn(REFUSED_PATH))
  const lead = piece('span', 'hc-pools-say')
  lead.setAttribute('role', 'status')
  const close = button('hc-pools-close', options.onClose, CLOSE_PATH)
  const top = piece('div', 'hc-pools-row')
  top.append(bulb, title, refused, lead, close.node)

  const counts = piece('span', 'hc-pools-counts')
  counts.setAttribute('aria-live', 'polite')
  const publish = button('hc-pools-publish', options.onPublish, LEAVE_PATH)
  const join = button('hc-pools-join', options.onJoin, ONWARD_PATH)
  const middle = piece('div', 'hc-pools-row')
  middle.append(counts, publish.node, join.node)

  const allOn = button('hc-pools-text hc-pools-all-on', options.onAllOn)
  const allOff = button('hc-pools-text hc-pools-all-off', options.onAllOff)
  const hint = piece('span', 'hc-pools-hint')
  const quiet = piece('div', 'hc-pools-row hc-pools-quiet')
  quiet.append(allOn.node, allOff.node, hint)

  element.append(style, top, middle, quiet)
  if (options.posts) element.append(options.posts)

  const update = (state: PoolsBarState): void => {
    title.textContent = say('pools.bar.title', 'Pools')
    lead.textContent = state.busy
      ? say('pools.bar.busy', 'Leaving what is on in your pools...')
      : state.outcome?.text ?? say('pools.bar.lead', 'Tap a tile to turn it on. What is on is yours to offer.')
    const refusal = !state.busy && !!state.outcome && !state.outcome.ok
    if (refusal) lead.dataset['tone'] = 'refused'
    else delete lead.dataset['tone']
    refused.hidden = !refusal
    counts.textContent = poolsBarCounts(say, state)
    close.text.textContent = say('pools.bar.close', 'Close')
    publish.text.textContent = state.busy ? say('pools.bar.publishing', 'Publishing...') : say('pools.bar.publish', 'Publish')
    publish.node.disabled = state.busy
    join.text.textContent = say('pools.bar.join', 'Join the swarm')
    allOn.text.textContent = say('pools.bar.all-on', 'All on here')
    allOn.node.disabled = !state.canOn
    allOff.text.textContent = say('pools.bar.all-off', 'All off here')
    allOff.node.disabled = !state.canOff
    hint.textContent = state.touch
      ? say('pools.bar.hint.hold', 'Hold a tile: the whole branch')
      : say('pools.bar.hint.shift', 'Shift-tap: the whole branch')
  }

  return { element, update, dispose: () => element.remove() }
}
