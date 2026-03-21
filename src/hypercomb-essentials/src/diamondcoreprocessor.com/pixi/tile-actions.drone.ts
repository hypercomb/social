// hypercomb-essentials/src/diamondcoreprocessor.com/pixi/tile-actions.drone.ts
// Registers the default tile overlay icons (edit, remove, search, add-sub, hide, adopt, block)
// via the `overlay:register-action` effect. Handles `tile:action` clicks for its own action names.

import { Drone, EffectBus, hypercomb } from '@hypercomb/core'
import type { OverlayActionDescriptor, OverlayTileContext } from './tile-overlay.drone.js'

// ── SVG icon markup ────────────────────────────────────────────────
// Path data from icon-tray.svg — each icon is a compound path (rounded-rect shell + icon cutout, evenodd fill).
// viewBox crops tightly to the icon's bounding box; rasterised at 48×48 for crisp display at small Pixi sizes.

const EDIT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="99.7 93.2 10.5 10.5" width="96" height="96"><path fill="white" fill-rule="evenodd" d="m 102.56634,99.825408 q 0.0295,0.02951 0.25579,0.245952 l 0.7477,0.75753 -0.34434,0.3345 h -0.364 v -0.62964 h -0.62964 v -0.36401 z m 2.71531,-2.5579 q 0.0984,0.08854 -0.0197,0.19676 l -1.90859,1.908588 q -0.10821,0.118057 -0.19676,0.02952 -0.0885,-0.08854 0.0197,-0.206599 l 1.90859,-1.908588 q 0.11806,-0.108219 0.19676,-0.01968 0,0 0,0 z m -1.79053,4.525512 q 0.10822,-0.10821 0.89527,-0.89526 l 2.66612,-2.666121 -1.88891,-1.888912 -3.56139,3.561386 v 1.888907 z m 3.98442,-3.984418 q 0.0197,-0.01967 0.15741,-0.157409 l 0.44271,-0.442714 q 0.18693,-0.186923 0.18693,-0.442714 0,-0.265628 -0.18693,-0.452551 l -0.99364,-0.993646 q -0.18692,-0.186923 -0.45255,-0.186923 -0.25579,0 -0.44272,0.186923 l -0.60012,0.600123 z m 2.51856,-2.518548 q 0,0.196761 0,1.574093 v 4.722273 q 0,0.77721 -0.56077,1.33798 -0.55094,0.55094 -1.32815,0.55094 h -6.29637 q -0.77721,0 -1.33798,-0.55094 -0.550929,-0.56077 -0.550929,-1.33798 v -6.296366 q 0,-0.777208 0.550929,-1.328141 0.56077,-0.56077 1.33798,-0.56077 h 6.29637 q 0.77721,0 1.32815,0.56077 0.56077,0.550933 0.56077,1.328141 z"/></svg>`

const GARBAGE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="112.2 93.2 10.4 10.5" width="96" height="96"><path fill="white" fill-rule="evenodd" d="m 114.23557,93.367129 c -0.51819,0 -0.96431,0.18841 -1.3382,0.564993 -0.36732,0.369975 -0.55093,0.815843 -0.55093,1.337773 v 6.342445 c 0,0.52192 0.18361,0.97127 0.55093,1.34786 0.37389,0.36997 0.82001,0.5549 1.3382,0.5549 h 6.29699 c 0.51819,0 0.96088,-0.18493 1.3282,-0.5549 0.37387,-0.37659 0.56094,-0.82594 0.56094,-1.34786 v -4.756922 -1.585523 c 0,-0.52193 -0.18707,-0.967798 -0.56094,-1.337773 -0.36732,-0.376583 -0.81001,-0.564993 -1.3282,-0.564993 z m 2.2286,1.368005 h 1.8398 c 0.12936,0.0048 0.23735,0.05074 0.32359,0.1376 0.0862,0.08685 0.13151,0.195289 0.13627,0.325582 v 0.926365 h 0.92008 0.91973 c 0.12936,0.0048 0.23735,0.05075 0.32358,0.1376 0.0863,0.08685 0.13185,0.195636 0.13663,0.32593 v 0.463183 h -0.46021 v 4.632516 c -0.004,0.13029 -0.0499,0.23909 -0.13628,0.32594 -0.0863,0.0868 -0.19423,0.1328 -0.32359,0.13761 h -5.51941 c -0.12935,-0.004 -0.23701,-0.0507 -0.32324,-0.13761 -0.0862,-0.0868 -0.13185,-0.19565 -0.13662,-0.32594 v -4.632516 h -0.45986 v -0.463183 c 0.004,-0.130294 0.0504,-0.239069 0.13661,-0.32593 0.0862,-0.08689 0.19389,-0.132793 0.32325,-0.1376 h 1.83981 v -0.926365 c 0.004,-0.130293 0.0504,-0.238719 0.13661,-0.325582 0.0862,-0.08688 0.19389,-0.132796 0.32325,-0.1376 z m 0.45986,0.926365 v 0.463182 h 0.92008 v -0.463182 h -0.45986 z m -1.83946,1.389895 v 4.169336 h 2.29968 2.29966 v -4.169336 z m 0.91974,0.926366 h 0.45986 0.45986 v 2.3166 h -0.91972 z m 1.8398,0 h 0.45986 0.45986 v 2.3166 h -0.91972 z"/></svg>`

const HIDE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96"><path fill="white" d="M48 28c-18 0-33 12-40 20 3.5 4 8.2 8.5 14 12l5.5-5.5C23 51 20 48 20 48s12-14 28-14c3 0 5.8.6 8.4 1.6l6-6C57.8 27 53 28 48 28zm0 40c18 0 33-12 40-20-3.5-4-8.2-8.5-14-12l-5.5 5.5C73 45 76 48 76 48S64 62 48 62c-3 0-5.8-.6-8.4-1.6l-6 6C38.2 69 43 68 48 68z"/><circle fill="white" cx="48" cy="48" r="10"/><rect fill="white" x="46" y="16" width="4" height="64" rx="2" transform="rotate(-45 48 48)"/></svg>`

const BLOCK_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96"><path fill="white" fill-rule="evenodd" d="M48 12c-19.9 0-36 16.1-36 36s16.1 36 36 36 36-16.1 36-36-16.1-36-36-36zm0 8c6.5 0 12.5 2.2 17.3 6L25 66.3C21.2 61.5 20 55.5 20 48c0-15.5 12.5-28 28-28zm0 56c-6.5 0-12.5-2.2-17.3-6L71 29.7C74.8 34.5 76 40.5 76 48c0 15.5-12.5 28-28 28z"/></svg>`

const ADD_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96"><path fill="white" d="M50 18h-4v28H18v4h28v28h4V50h28v-4H50z"/></svg>`

const SEARCH_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96"><circle cx="40" cy="40" r="20" fill="none" stroke="white" stroke-width="8"/><line x1="54" y1="54" x2="78" y2="78" stroke="white" stroke-width="8" stroke-linecap="round"/></svg>`

const ADD_SUB_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 15.1 15.1" width="96" height="96"><path fill="white" fill-rule="evenodd" d="M2.83 0C2.054 0 1.385.28.825.84.275 1.39 0 2.054 0 2.83v9.432c0 .776.275 1.445.825 2.005.56.55 1.229.825 2.005.825h9.432c.776 0 1.44-.275 1.99-.825.56-.56.84-1.229.84-2.005V2.83c0-.776-.28-1.44-.84-1.99C13.702.28 13.039 0 12.262 0H2.83zm-1.316 2.316h11.064c.117 0 .214.041.29.122.075.082.113.186.113.313v9.589c0 .127-.038.231-.113.313-.075.082-.173.122-.29.122H1.514c-.117 0-.214-.04-.29-.122-.075-.082-.113-.186-.113-.313V2.752c0-.127.038-.232.113-.313.076-.082.173-.123.29-.123zm.804.871c-.1 0-.193.041-.276.123-.076.091-.113.191-.113.3v7.845c0 .127.037.232.113.313.075.082.173.123.29.123h10.457c.117 0 .213-.041.289-.123.075-.081.113-.186.113-.313V3.624c0-.128-.038-.232-.113-.314-.076-.081-.173-.122-.29-.122H2.318zM3.11 4.06c.1 0 .193.04.277.122l.767.845.779.845c.034.009.063.027.088.054.075.091.113.195.113.313 0 .118-.038.222-.113.313-.025.027-.054.05-.088.068L3.387 8.295c-.084.082-.176.123-.277.123-.1 0-.193-.041-.276-.123-.076-.09-.113-.19-.113-.3 0-.108.037-.209.113-.3l1.358-1.457L2.834 4.78c-.076-.09-.113-.19-.113-.3 0-.109.037-.214.113-.286.084-.09.176-.135.277-.135zM6.34 7.546h2.413c.117 0 .214.041.29.123.075.081.113.186.113.313 0 .127-.038.231-.113.313-.076.082-.173.122-.29.122H6.34c-.117 0-.214-.04-.29-.122-.075-.082-.112-.186-.112-.313 0-.127.037-.232.112-.313.076-.082.173-.123.29-.123z"/></svg>`

// ── Icon positions ─────────────────────────────────────────────────
const ICON_Y = 5

const ACTIONS: OverlayActionDescriptor[] = [
  // ── private profile ──
  { name: 'add-sub', svgMarkup: ADD_SUB_ICON_SVG, x: -12.625, y: ICON_Y, hoverTint: 0xa8ffd8, profile: 'private' },
  { name: 'edit', svgMarkup: EDIT_ICON_SVG, x: -2, y: ICON_Y, hoverTint: 0xc8d8ff, profile: 'private' },
  { name: 'remove', svgMarkup: GARBAGE_ICON_SVG, x: 8.625, y: ICON_Y, hoverTint: 0xffc8c8, profile: 'private' },
  {
    name: 'search',
    svgMarkup: SEARCH_ICON_SVG,
    x: 19.25, y: ICON_Y,
    hoverTint: 0xc8ffc8,
    profile: 'private',
    visibleWhen: (ctx: OverlayTileContext) => ctx.noImage,
  },
  // ── public-own profile ──
  { name: 'hide', svgMarkup: HIDE_ICON_SVG, x: 8.625, y: ICON_Y, hoverTint: 0xffd8a8, profile: 'public-own' },
  // ── public-external profile ──
  { name: 'adopt', svgMarkup: ADD_ICON_SVG, x: 8.625, y: ICON_Y, hoverTint: 0xa8ffd8, profile: 'public-external' },
  { name: 'block', svgMarkup: BLOCK_ICON_SVG, x: -2, y: ICON_Y, hoverTint: 0xffc8c8, profile: 'public-external' },
]

// ── Action names this bee handles ──────────────────────────────────
const HANDLED_ACTIONS = new Set(['edit', 'remove', 'search', 'add-sub', 'hide', 'adopt', 'block'])

type TileActionPayload = { action: string; label: string; q: number; r: number; index: number }

export class TileActionsDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'registers default tile overlay icons and handles their click actions'

  protected override deps = {
    lineage: '@hypercomb.social/Lineage',
  }

  protected override listens = ['render:host-ready', 'tile:action']
  protected override emits = ['overlay:register-action', 'search:prefill', 'tile:hidden', 'tile:blocked']

  #registered = false
  #effectsRegistered = false

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#effectsRegistered) {
      this.#effectsRegistered = true

      // Register all icons as a batch once the pixi host is ready
      this.onEffect('render:host-ready', () => {
        if (this.#registered) return
        this.#registered = true
        this.emitEffect('overlay:register-action', ACTIONS)
      })

      // Handle clicks on our own actions
      this.onEffect<TileActionPayload>('tile:action', (payload) => {
        if (!HANDLED_ACTIONS.has(payload.action)) return
        this.#handleAction(payload)
      })
    }
  }

  #handleAction(payload: TileActionPayload): void {
    const { action, label } = payload

    switch (action) {
      case 'edit':
        // tile:action already emitted by overlay — editor listens for it
        break

      case 'remove':
        EffectBus.emit('seed:removed', { seed: label })
        break

      case 'search':
        window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(label)}`, '_blank')
        break

      case 'add-sub':
        EffectBus.emit('search:prefill', { value: label + '/' })
        break

      case 'hide':
        this.#hideOrBlock(label, 'hc:hidden-tiles', 'tile:hidden')
        break

      case 'adopt':
        EffectBus.emit('seed:added', { seed: label })
        void new hypercomb().act()
        break

      case 'block':
        this.#hideOrBlock(label, 'hc:blocked-tiles', 'tile:blocked')
        break
    }
  }

  #hideOrBlock(label: string, storagePrefix: string, effect: string): void {
    const lineage = this.resolve<{ explorerLabel(): string }>('lineage')
    const location = lineage?.explorerLabel() ?? '/'
    const key = `${storagePrefix}:${location}`
    const existing: string[] = JSON.parse(localStorage.getItem(key) ?? '[]')
    if (!existing.includes(label)) existing.push(label)
    localStorage.setItem(key, JSON.stringify(existing))
    EffectBus.emit(effect, { seed: label, location })
    void new hypercomb().act()
  }
}

const _tileActions = new TileActionsDrone()
window.ioc.register('@diamondcoreprocessor.com/TileActionsDrone', _tileActions)
