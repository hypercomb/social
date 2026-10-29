// editor/diagram/controls.ts
//
// THE CONTROLS A CALLOUT HOLDS, one builder per field KIND. A part's primary
// field decides which builders run; a model never touches these and the
// builders never touch a service — everything they read and write goes through
// the TileSessionPort the shell hands the diagram. Each builder returns a node
// built ONCE and a `sync()` that repaints it in place from the port: it never
// replaces a node that has focus, and never writes into a native colour input
// while its popup may be open.
//
// Glyphs are `.mat-sym` spans whose text is the ligature name; every name used
// here ships in the icon subset.

import type { ModelGeometry, TileModel } from '../models/tile-model.js'
import type { FieldKey, FieldKind } from '../models/tile-model.js'
import type { EditorField } from '../tile-properties.js'
import type { TitleStatus } from '../tile-title.js'
import { FIELDS } from './fields.js'

// ── the port the shell gives the diagram (frozen) ───────────────────────────

export type FieldValue = string | boolean | undefined
export type { EditorField }
export type LayerChoice = 'here' | 'inherit' | 'hide'
export interface LayerFacts {
  readonly base: 'inherited' | 'here' | 'hidden' | 'locked'
  /** Pending, drawn dashed. */
  readonly choice: LayerChoice | null
  readonly offered: readonly LayerChoice[]
  /** Choosing the pending one again takes it back. */
  choose(choice: LayerChoice | null): void
}
export type { TitleStatus }

export interface TileSessionPort {
  readonly group: { readonly count: number; readonly labels: readonly string[] } | null
  /** Single tile, or the group form. */
  value(key: FieldKey): FieldValue
  /** Never 'title' (see name) and never 'picture' (see picture). */
  set(key: FieldKey, value: FieldValue): void
  fallback(key: FieldKey): string
  /** null: top-level tile, or a group. */
  layer(field: EditorField): LayerFacts | null
  readonly name: {
    /** The ONE in-place input (class te-title); the shell owns its events. */
    readonly input: HTMLInputElement
    readonly value: string
    readonly stored: string
    readonly address: string
    readonly locale: string
    readonly status: TitleStatus
    readonly dirty: boolean
    readonly throughPortal: boolean
    focus(): void
    undo(): void
  }
  readonly picture: {
    readonly has: boolean
    readonly mode: 'fill' | 'fit'
    readonly linked: boolean
    readonly noOriginal: boolean
    readonly percent: number
    readonly ratio: string
    readonly slider01: number
    readonly cameraAvailable: boolean
    readonly phone: boolean
    act(a: 'upload' | 'camera' | 'search' | 'remove' | 'fill' | 'fit' | 'zoom-in' | 'zoom-out' | 'reset' | 'link-toggle'): void
    setSlider01(t: number): void
    history(): Promise<readonly { readonly id: string; readonly url: string; readonly from: 'here' | 'repo' | 'variant'; choose(): void }[]>
    /** Object URL of the live hive-scale thumbnail (the exact bytes a save writes). */
    twinUrl(variant: string): string
    setVariant(id: string): void
  }
  readonly link: {
    readonly verdict: { tone: 'warn' | 'alert'; reason: string } | null
    check(): Promise<void>
    clearVerdict(): void
  }
  readonly questions: {
    readonly items: readonly { id: string; question: string; answer?: string }[]
    draft(id: string): string
    setDraft(id: string, text: string): void
    reply(id: string, text: string): void
  }
  /** Any service or model change; the diagram re-syncs in place. */
  onChange(cb: () => void): () => void
}

export type Translate = (key: string, fallback: string, params?: Record<string, string | number>) => string

/** What the builders read besides the port. */
export interface ControlEnv {
  readonly port: TileSessionPort
  readonly model: TileModel
  readonly t: Translate
  readonly group: boolean
  readonly geometry: () => ModelGeometry
  readonly fillLive: () => boolean
  readonly variant: () => string
  /** The Picture part's id, or null when the model has none. */
  readonly imagePart: () => string | null
  /** Open or close a part's card (the toolbar's "earlier pictures"). */
  readonly toggleCard: (partId: string) => void
  /** Unique within the page: ids built from it never collide between diagrams. */
  readonly uid: string
}

export interface Control {
  readonly node: HTMLElement
  sync(): void
  /** Move focus to the control's main field (a click on a drawn part with a card). */
  focus?(): void
  /** The card was opened. */
  onOpen?(): void
  /** The picture toolbar: a node that MOVES between homes, never rebuilt. */
  readonly dock?: HTMLElement
}

// ── tiny DOM kit ────────────────────────────────────────────────────────────

type Attr = string | number | boolean | null | undefined
type Kid = Node | string | null | undefined | false

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, Attr> = {}, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue
    if (k === 'class') el.className = String(v)
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  for (const kid of kids) if (kid) el.append(kid)
  return el
}

/** A glyph: the ligature name is the element's text. */
export const glyph = (name: string): HTMLSpanElement => h('span', { class: 'mat-sym', 'aria-hidden': 'true' }, name)

/** Write an attribute only when it differs (an idempotent update touches nothing). */
export function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) { if (el.hasAttribute(name)) el.removeAttribute(name) } else if (el.getAttribute(name) !== value) el.setAttribute(name, value)
}

export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text
}

export const parseHex = (v: string): string | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(v.trim())
  return m ? '#' + m[1].toLowerCase() : null
}

const isTouchPointer = (): boolean => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

// ── glances: what a tab shows at rest ───────────────────────────────────────

export interface Glance { text: string; extra?: string; swatch?: string | null; unset?: boolean }

const hostOf = (v: string): string => {
  try { return new URL(v).host || v } catch { return v }
}

export function glanceOf(kind: FieldKind, key: FieldKey, env: ControlEnv): Glance {
  const { port, t, group } = env
  switch (kind) {
    case 'colour': {
      const v = typeof port.value(key) === 'string' ? (port.value(key) as string) : ''
      const spec = FIELDS[key]
      const fb = port.fallback(key)
      const word = t(spec.clearKey ?? 'editor.none', (spec.clearKey ?? 'editor.none') === 'editor.default' ? 'default' : 'none')
      return { swatch: v || (group ? null : fb || null), unset: !v, text: v || (group ? t('editor.group-as-is', 'as is') : fb ? word : t('editor.none', 'none')) }
    }
    case 'toggle': {
      const v = port.value(key)
      if (group) return { text: typeof v !== 'boolean' ? t('editor.group-as-is', 'as is') : v ? t('editor.glance-hidden', 'hidden') : t('editor.glance-shown', 'shown') }
      return { text: !port.picture.has ? t('editor.glance-always', 'always shown') : v === true ? t('editor.glance-hidden', 'hidden') : t('editor.glance-shown', 'shown') }
    }
    case 'text': {
      const n = port.name
      const s = n.status.state
      return {
        text: n.value.trim() || n.address,
        extra: s === 'saving' ? t('editor.saving', 'saving...') : s === 'refused' ? t('editor.glance-not-set', 'not set') : n.dirty ? t('editor.unsaved', 'unsaved') : '',
      }
    }
    case 'link': {
      const v = port.value(key)
      return { text: typeof v === 'string' && v ? hostOf(v) : group ? t('editor.group-as-is', 'as is') : t('editor.none', 'none') }
    }
    case 'image':
      return { text: port.picture.has ? `${port.picture.ratio} · ${Math.round(port.picture.percent)}%` : t('editor.none', 'none') }
    case 'variant': {
      const v = env.model.variants.find(x => x.id === env.variant())
      return { text: v ? t(v.labelKey, v.label) : env.variant() }
    }
  }
}

// ── the colour swatch that lives IN the tab (the native input, one click away)

export interface TabSwatch { readonly el: HTMLLabelElement; readonly input: HTMLInputElement; sync(): void }

export function buildTabSwatch(key: FieldKey, env: ControlEnv, label: string): TabSwatch {
  const { port, t } = env
  const input = h('input', { type: 'color', 'aria-label': t('editor.colour-of', '{field} colour', { field: label }) })
  const el = h('label', { class: 'te-dg-swc', title: t('editor.colour-pick', 'Choose a colour') }, input)
  let picking = false
  input.addEventListener('click', () => { picking = true })
  input.addEventListener('change', () => { picking = false })
  input.addEventListener('blur', () => { picking = false })
  input.addEventListener('input', () => port.set(key, input.value))
  el.addEventListener('click', e => e.stopPropagation())
  const sync = (): void => {
    const raw = port.value(key)
    const v = typeof raw === 'string' ? raw : ''
    const fb = port.fallback(key)
    const shown = v || (env.group ? '' : fb)
    el.style.setProperty('--sw', shown || 'transparent')
    setAttr(el, 'data-unset', String(!v && (env.group || !fb)))
    // never write into an input whose popup may be open
    if (!picking && el.ownerDocument.activeElement !== input) {
      const next = parseHex(v) ?? parseHex(fb) ?? '#000000'
      if (input.value !== next) input.value = next
    }
  }
  return { el, input, sync }
}

// ── one builder per field kind ──────────────────────────────────────────────

function colourControl(key: FieldKey, env: ControlEnv, label: string): Control {
  const { port, t } = env
  const spec = FIELDS[key]
  const pick = h('input', { type: 'color', 'aria-label': label })
  const sw = h('label', { class: 'te-dg-swatch' }, pick)
  const hex = h('input', { class: 'te-dg-input te-dg-hex', type: 'text', maxlength: 7, spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', 'aria-label': label })
  const clear = h('button', { type: 'button', class: 'te-dg-word' })
  let picking = false
  // A garbage hex stays flagged (and as typed) until the next input: the sync that
  // follows the blur would otherwise put the stored value back and clear the flag.
  let invalid = false
  let seen = ''
  pick.addEventListener('click', () => { picking = true })
  pick.addEventListener('change', () => { picking = false })
  pick.addEventListener('blur', () => { picking = false })
  pick.addEventListener('input', () => { invalid = false; hex.removeAttribute('aria-invalid'); port.set(key, pick.value) })
  hex.addEventListener('input', () => {
    invalid = false
    hex.removeAttribute('aria-invalid')              // the next blur says again whether it is still garbage
    const p = parseHex(hex.value)
    if (p) port.set(key, p)
  })
  hex.addEventListener('blur', () => {
    const v = hex.value.trim()
    if (!v) port.set(key, '')
    else if (parseHex(v)) port.set(key, parseHex(v)!)
    else { invalid = true; hex.setAttribute('aria-invalid', 'true') }   // garbage writes nothing
  })
  clear.addEventListener('click', () => { invalid = false; hex.removeAttribute('aria-invalid'); port.set(key, '') })
  const note = spec.dormantKey
    ? h('div', { class: 'te-dg-status' }, h('span', {}, t(spec.dormantKey, 'Seen behind a picture set to Fit.')),
        h('button', { type: 'button', class: 'te-dg-word', 'data-act': 'fit' }, t('editor.fit', 'Fit')))
    : null
  note?.querySelector('button')?.addEventListener('click', () => port.picture.act('fit'))
  const node = h('div', { class: 'te-dg-fld' }, h('div', { class: 'te-dg-rowf' }, sw, hex, clear), note)
  const sync = (): void => {
    const raw = port.value(key)
    const v = typeof raw === 'string' ? raw : ''
    const fb = port.fallback(key)
    if (note) note.hidden = env.group || env.fillLive()
    if (v !== seen) { seen = v; invalid = false }   // another value arrived (another tile, an undo)
    if (invalid) hex.setAttribute('aria-invalid', 'true')
    else if (hex.ownerDocument.activeElement !== hex) { if (hex.value !== v) hex.value = v; hex.removeAttribute('aria-invalid') }
    if (!picking && pick.ownerDocument.activeElement !== pick) {
      const next = parseHex(v) ?? parseHex(fb) ?? '#000000'
      if (pick.value !== next) pick.value = next
    }
    sw.style.setProperty('--sw', v || (env.group ? '' : fb) || 'transparent')
    setAttr(sw, 'data-unset', String(!v && (env.group || !fb)))
    setAttr(hex, 'placeholder', env.group ? t('editor.group-as-is', 'as is') : fb)
    const word = env.group ? t('editor.group-leave', 'leave as is') : t(spec.clearKey ?? 'editor.none', (spec.clearKey ?? 'editor.none') === 'editor.default' ? 'default' : 'none')
    setText(clear, word)
    clear.hidden = !v
  }
  return { node, sync, focus: () => hex.focus() }
}

function toggleControl(key: FieldKey, env: ControlEnv): Control {
  const { port, t } = env
  const state = h('span', { class: 'te-dg-state' })
  const btn = h('button', { type: 'button', class: 'te-dg-switch', role: 'switch' }, h('span', { class: 'te-dg-track' }, h('span', { class: 'te-dg-knob' })), state)
  const leave = h('button', { type: 'button', class: 'te-dg-word' }, t('editor.group-leave', 'leave as is'))
  btn.addEventListener('click', () => {
    const v = port.value(key)
    if (env.group) port.set(key, v === undefined ? false : !v)
    else port.set(key, !v)
  })
  leave.addEventListener('click', () => port.set(key, undefined))
  const node = h('div', { class: 'te-dg-rowf te-dg-between' }, btn, leave)
  const sync = (): void => {
    const v = port.value(key)
    btn.disabled = !env.group && !port.picture.has
    if (env.group) {
      setAttr(btn, 'aria-checked', typeof v !== 'boolean' ? 'mixed' : v ? 'false' : 'true')
      setText(state, typeof v !== 'boolean' ? t('editor.group-as-is', 'as is') : v ? t('editor.name-hidden', 'hidden over the picture') : t('editor.name-shown', 'shown over the picture'))
      leave.hidden = typeof v !== 'boolean'
    } else {
      const shows = v !== true || !port.picture.has
      setAttr(btn, 'aria-checked', String(shows))
      setText(state, !port.picture.has ? t('editor.show-name-hint', 'always shown without a picture') : shows ? t('editor.name-shown', 'shown over the picture') : t('editor.name-hidden', 'hidden over the picture'))
      leave.hidden = true
    }
  }
  return { node, sync, focus: () => btn.focus() }
}

/** The reading cut where the band cuts it: measured by a hidden span, never a canvas. */
function nameFit(env: ControlEnv, probe: HTMLElement, text: string): { cut: boolean; shown: string } {
  const g = env.geometry()
  const t = text.trim()
  if (!t || !g.nameBox) return { cut: false, shown: t }
  const w = (s: string): number => {
    probe.style.fontSize = `${g.nameFont}px`
    probe.textContent = s
    return probe.getBoundingClientRect().width
  }
  const room = g.nameBox.w - 0.4 * g.nameFont
  if (w(t) <= room) return { cut: false, shown: t }
  let n = t.length
  while (n > 1 && w(t.slice(0, n) + '…') > room) n--
  return { cut: true, shown: t.slice(0, n).trimEnd() + '…' }
}

function textControl(env: ControlEnv): Control {
  const { port, t } = env
  const chip = h('span', { class: 'te-dg-localechip', title: t('editor.name-locale-hint', 'The language this reading is for') })
  const edit = h('button', { type: 'button', class: 'te-dg-word', title: t('editor.name-edit-on-tile', 'edit on tile') }, t('editor.name-edit-on-tile', 'edit on tile'))
  edit.addEventListener('click', () => port.name.focus())
  const status = h('div', { class: 'te-dg-status', role: 'status', id: `te-dg-${env.uid}-name-status` })
  const fit = h('div', { class: 'te-dg-status', hidden: true })
  const via = h('div', { class: 'te-dg-status' }, glyph('link'), h('span', {}, t('editor.portal-name', 'This edits the original tile.')))
  const probe = h('span', { 'aria-hidden': 'true', class: 'te-dg-probe' })
  const addrCode = h('code', {})
  const addr = h('div', { class: 'te-dg-addr', title: t('editor.address-hint', 'The address never changes.') }, h('span', {}, t('editor.address', 'address')), addrCode)
  const node = h('div', { class: 'te-dg-fld te-dg-col' }, h('div', { class: 'te-dg-rowf te-dg-between' }, chip, edit), status, fit, via, addr, probe)
  let lastKey = ''
  const sync = (): void => {
    const n = port.name
    setText(chip, n.locale)
    setText(addrCode, n.address)
    via.hidden = !n.throughPortal
    const s = n.status
    const tone = s.state === 'refused' || s.state === 'failed' ? 'alert' : s.state === 'saved' || s.state === 'saving' ? 'ok' : ''
    const key = [s.state, s.state === 'refused' ? s.sibling + '|' + s.siblingAddress : '', n.dirty, n.stored, n.locale, n.address].join('\u0001')
    setAttr(status, 'data-tone', tone || null)
    setAttr(status, 'role', tone === 'alert' ? 'alert' : 'status')
    if (key !== lastKey) {
      lastKey = key
      status.replaceChildren()
      if (s.state === 'saving') status.append(t('editor.name-saving', 'saving the name...'))
      else if (s.state === 'saved') status.append(glyph('check'), t('editor.name-saved', 'name saved'))
      else if (s.state === 'refused') {
        const undo = h('button', { type: 'button', class: 'te-dg-word', 'data-act': 'undo' }, t('editor.name-undo', 'undo'))
        undo.addEventListener('click', () => port.name.undo())
        status.append(glyph('warning'),
          h('span', { class: 'te-dg-grow' }, t('editor.name-taken-by', '"{name}" is taken. The tile {address} already reads that way here.', { name: s.sibling, address: s.siblingAddress })),
          undo)
      } else if (s.state === 'failed') status.append(glyph('warning'), t('editor.name-failed', 'Could not save the name.'))
      else if (n.dirty) status.append(t('editor.name-dirty', 'not saved yet'))
      else status.append(t('editor.name-reads', 'reads "{name}" in {locale}', { name: n.stored || n.address, locale: n.locale }))
    }
    const f = nameFit(env, probe, n.input.value || n.value)
    fit.hidden = !f.cut
    setText(fit, f.cut ? t('editor.name-fit', 'the tile shows "{shown}"', { shown: f.shown }) : '')
  }
  return { node, sync, focus: () => port.name.focus() }
}

function linkControl(key: FieldKey, env: ControlEnv): Control {
  const { port, t } = env
  const input = h('input', {
    class: 'te-dg-input te-dg-url', type: 'url', name: 'tile-link', inputmode: 'url', autocomplete: 'off', spellcheck: 'false',
    autocapitalize: 'off', enterkeyhint: 'done', 'aria-label': t('editor.link', 'Link'),
  })
  const verdict = h('div', { class: 'te-dg-status', role: 'status' })
  input.addEventListener('input', () => { port.link.clearVerdict(); port.set(key, input.value.trim()) })
  input.addEventListener('blur', () => { void port.link.check() })
  const node = h('div', { class: 'te-dg-fld' }, h('div', { class: 'te-dg-rowf' }, input), verdict)
  let lastVerdict = ''
  const sync = (): void => {
    const raw = port.value(key)
    const v = typeof raw === 'string' ? raw : ''
    if (input.ownerDocument.activeElement !== input && input.value !== v) input.value = v
    setAttr(input, 'placeholder', env.group ? t('editor.group-link', "leave each tile's link") : t('editor.link-placeholder', 'https://...'))
    const vd = port.link.verdict
    verdict.hidden = !vd
    const sig = vd ? vd.tone + '\u0001' + vd.reason : ''
    if (sig !== lastVerdict) {
      lastVerdict = sig
      verdict.replaceChildren(...(vd ? [glyph('warning'), h('span', {}, vd.reason)] : []))
    }
    setAttr(verdict, 'data-tone', vd ? vd.tone : null)
    setAttr(verdict, 'role', vd?.tone === 'alert' ? 'alert' : 'status')
    setAttr(input, 'aria-invalid', vd?.tone === 'alert' ? 'true' : null)
  }
  return { node, sync, focus: () => input.focus() }
}

function variantControl(env: ControlEnv): Control {
  const { port, model, t } = env
  const node = h('div', { class: 'te-dg-twins' })
  if (model.variants.length < 2) { node.hidden = true; return { node, sync: () => undefined } }
  const twins = model.variants.map(v => {
    const img = h('img', { class: 'te-dg-twface', alt: '', 'aria-hidden': 'true', draggable: 'false' })
    const b = h('button', { type: 'button', class: 'te-dg-twin', 'data-variant': v.id, 'aria-pressed': 'false' }, img, h('span', {}, t(v.labelKey, v.label)))
    b.addEventListener('click', () => port.picture.setVariant(v.id))
    return b
  })
  const link = h('button', { type: 'button', class: 'te-dg-ib', 'aria-pressed': 'true' })
  link.addEventListener('click', () => port.picture.act('link-toggle'))
  node.append(twins[0], link, ...twins.slice(1))
  const sync = (): void => {
    for (const b of twins) {
      const id = b.dataset['variant']!
      setAttr(b, 'aria-pressed', String(env.variant() === id))
      const img = b.querySelector('img')!
      const url = port.picture.twinUrl(id)
      if (url && img.getAttribute('src') !== url) img.setAttribute('src', url)
    }
    const linked = port.picture.linked
    setAttr(link, 'aria-pressed', String(linked))
    const glyphName = linked ? 'link' : 'link_off'
    if (link.firstElementChild?.textContent !== glyphName) link.replaceChildren(glyph(glyphName))
    const lab = linked ? t('editor.frame-apart', 'frame each shape apart') : t('editor.frame-together', 'frame both shapes together')
    setAttr(link, 'aria-label', lab)
    setAttr(link, 'title', lab)
  }
  return { node, sync }
}

function imageControl(env: ControlEnv): Control {
  const { port, t } = env
  const ib = (name: string, label: string, act: Parameters<TileSessionPort['picture']['act']>[0]): HTMLButtonElement => {
    const b = h('button', { type: 'button', class: 'te-dg-ib', 'data-act': act, 'aria-label': label, title: label }, glyph(name))
    return b
  }
  const upload = ib('upload', t('editor.upload', 'Upload'), 'upload')
  const camera = ib('photo_camera', t('editor.camera', 'Camera'), 'camera')
  const search = ib('search', t('editor.search-google', 'Search for pictures'), 'search')
  search.dataset['action'] = 'search'
  const past = h('button', { type: 'button', class: 'te-dg-ib', 'data-act': 'history', 'aria-label': t('editor.picture-history', 'Earlier pictures'), title: t('editor.picture-history', 'Earlier pictures') }, glyph('history'))
  const remove = ib('hide_image', t('editor.remove-picture', 'Remove picture'), 'remove')
  for (const b of [upload, camera, search, remove]) b.addEventListener('click', () => port.picture.act(b.dataset['act'] as 'upload'))
  past.addEventListener('click', () => { const id = env.imagePart(); if (id) env.toggleCard(id) })
  const fill = h('button', { type: 'button', role: 'radio', 'data-mode': 'fill', 'aria-label': t('editor.fill', 'Fill'), title: t('editor.fill', 'Fill') }, glyph('crop_free'))
  const fitB = h('button', { type: 'button', role: 'radio', 'data-mode': 'fit', 'aria-label': t('editor.fit', 'Fit'), title: t('editor.fit', 'Fit') }, glyph('fit_screen'))
  fill.addEventListener('click', () => port.picture.act('fill'))
  fitB.addEventListener('click', () => port.picture.act('fit'))
  const seg = h('div', { class: 'te-dg-seg', role: 'radiogroup', 'aria-label': t('editor.framing', 'Framing') }, fill, fitB)
  const zout = ib('zoom_out', t('editor.zoom-out', 'Zoom out'), 'zoom-out')
  const zin = ib('zoom_in', t('editor.zoom-in', 'Zoom in'), 'zoom-in')
  const reset = ib('center_focus_strong', t('editor.reset', 'Reset framing'), 'reset')
  for (const b of [zout, zin, reset]) b.addEventListener('click', () => port.picture.act(b.dataset['act'] as 'reset'))
  const slider = h('input', { type: 'range', min: 0, max: 1000, step: 1, 'aria-label': t('editor.zoom', 'Zoom') })
  slider.addEventListener('input', () => port.picture.setSlider01(Number(slider.value) / 1000))
  const readout = h('span', { class: 'te-dg-readout' })
  const toolbar = h('div', { class: 'te-dg-toolbar', role: 'toolbar', 'aria-label': t('editor.picture-tools', 'Picture') },
    h('div', { class: 'te-dg-grp', role: 'group', 'aria-label': t('editor.picture-source', 'Where the picture comes from') }, upload, camera, search, past, remove),
    h('span', { class: 'te-dg-sep' }), seg, h('span', { class: 'te-dg-sep' }),
    h('div', { class: 'te-dg-zoom' }, zout, slider, zin, readout), reset)

  // the card the Picture label opens: every picture this name has worn, and the quiet "no original" line
  const strip = h('div', { class: 'te-dg-history', role: 'group', 'aria-label': t('editor.picture-history', 'Earlier pictures') })
  const histNote = h('div', { class: 'te-dg-status' })
  const noOriginal = h('div', { class: 'te-dg-status', role: 'status' }, t('editor.no-original', 'This picture has no original here, so it cannot be re-framed. Choose a picture to frame it.'))
  const node = h('div', { class: 'te-dg-fld te-dg-col' }, h('span', { class: 'te-dg-sub' }, t('editor.picture-history', 'Earlier pictures')), strip, histNote, noOriginal)
  let generation = 0
  const loadHistory = (): void => {
    const mine = ++generation
    setText(histNote, t('editor.picture-history.loading', 'Loading...'))
    histNote.hidden = false
    void port.picture.history().then(list => {
      if (mine !== generation) return
      strip.replaceChildren(...list.map((it, k) => {
        const b = h('button', { type: 'button', 'data-here': String(k === 0), 'aria-label': t('editor.earlier-picture', 'Earlier picture {n}', { n: k + 1 }) },
          h('img', { src: it.url, alt: '', draggable: 'false' }))
        b.addEventListener('click', () => it.choose())
        return b
      }))
      histNote.hidden = list.length > 0
      setText(histNote, t('editor.picture-history.empty', 'No earlier pictures.'))
    }, () => { if (mine === generation) { histNote.hidden = false; setText(histNote, t('editor.picture-history.empty', 'No earlier pictures.')) } })
  }
  const sync = (): void => {
    const p = port.picture
    const has = p.has && !env.group
    for (const b of [fill, fitB]) { setAttr(b, 'aria-checked', String(b.dataset['mode'] === p.mode)); b.disabled = !has }
    for (const b of [zin, zout, reset, remove]) b.disabled = !has
    slider.disabled = !has
    if (slider.ownerDocument.activeElement !== slider) {
      const v = String(Math.round(Math.min(1, Math.max(0, p.slider01)) * 1000))
      if (slider.value !== v) slider.value = v
    }
    setText(readout, has ? `${Math.round(p.percent)}%` : '')
    camera.hidden = !p.cameraAvailable
    // on a phone the upload button is the photo library
    const uploadName = p.phone ? 'photo_library' : 'upload'
    if (upload.firstElementChild?.textContent !== uploadName) upload.replaceChildren(glyph(uploadName))
    const uploadLabel = p.phone ? t('editor.library', 'Library') : t('editor.upload', 'Upload')
    setAttr(upload, 'aria-label', uploadLabel)
    setAttr(upload, 'title', uploadLabel)
    noOriginal.hidden = !p.noOriginal
  }
  return { node, dock: toolbar, sync, onOpen: loadHistory }
}

// ── Questions: a shell callout with no part ─────────────────────────────────

interface QNodes { item: HTMLElement; ans: HTMLElement; ta: HTMLTextAreaElement; reply: HTMLElement; ask: HTMLElement }

function questionsControl(env: ControlEnv): Control {
  const { port, t } = env
  const node = h('div', { class: 'te-dg-fld te-dg-col te-dg-qs' })
  const nodes = new Map<string, QNodes>()
  const make = (id: string): QNodes => {
    const ta = h('textarea', { rows: 2, placeholder: t('editor.qa.answer-placeholder', 'type your answer...'), 'aria-label': t('editor.qa.answer-label', 'Answer') })
    ta.value = port.questions.draft(id)
    ta.addEventListener('input', () => port.questions.setDraft(id, ta.value))
    const replyBtn = h('button', { type: 'button', class: 'te-dg-word' }, t('editor.qa.reply', 'reply'))
    replyBtn.addEventListener('click', () => { const v = ta.value.trim(); if (v) port.questions.reply(id, v) })
    const reply = h('div', { class: 'te-dg-rowf te-dg-end' }, replyBtn)
    const ask = h('p', {})
    const ans = h('p', { class: 'te-dg-a' })
    const item = h('div', { class: 'te-dg-q', 'data-q': id }, ask, ans, ta, reply)
    return { item, ans, ta, reply, ask }
  }
  const sync = (): void => {
    const live = new Set<string>()
    let at = 0
    for (const q of port.questions.items) {
      live.add(q.id)
      let n = nodes.get(q.id)
      if (!n) { n = make(q.id); nodes.set(q.id, n) }
      // placed in order without disturbing a node that is already there
      if (node.children[at] !== n.item) node.insertBefore(n.item, node.children[at] ?? null)
      at++
      setText(n.ask, q.question)
      const a = q.answer ?? ''
      n.ans.hidden = !a
      setText(n.ans, a)
      n.ta.hidden = !!a
      n.reply.hidden = !!a
      if (!a && n.ta.ownerDocument.activeElement !== n.ta) { const d = port.questions.draft(q.id); if (n.ta.value !== d) n.ta.value = d }
    }
    for (const [id, n] of nodes) if (!live.has(id)) { n.item.remove(); nodes.delete(id) }
  }
  return { node, sync, focus: () => node.querySelector('textarea:not([hidden])')?.dispatchEvent(new Event('focus')) }
}

export const buildQuestions = (env: ControlEnv): Control => questionsControl(env)

/** The open count the Questions tab shows: `2 . 1 open`. */
export function questionsGlance(env: ControlEnv): string {
  const items = env.port.questions.items
  const open = items.filter(q => !(q.answer ?? '')).length
  return env.t('editor.glance-questions', '{count} · {open} open', { count: items.length, open })
}

/** One builder per field kind. `label` is the part's visible label. */
export function buildControl(kind: FieldKind, key: FieldKey, env: ControlEnv, label: string): Control {
  switch (kind) {
    case 'colour': return colourControl(key, env, label)
    case 'toggle': return toggleControl(key, env)
    case 'text': return textControl(env)
    case 'link': return linkControl(key, env)
    case 'variant': return variantControl(env)
    case 'image': return imageControl(env)
  }
}

// ── the layer chip: a disclosure with menuitemradio and arrow keys ──────────

export interface LayerChip { readonly el: HTMLElement; sync(): void; close(): void }

const LAYER_WORD: Record<LayerFacts['base'], [string, string]> = {
  inherited: ['editor.layer.inherited', 'inherited'],
  here: ['editor.layer.here', 'only here'],
  hidden: ['editor.layer.hidden', 'hidden here'],
  locked: ['editor.layer.locked', 'locked'],
}
const CHOICE_WORD: Record<LayerChoice, [string, string]> = {
  here: ['editor.layer.do.here', 'keep only here'],
  inherit: ['editor.layer.do.inherit', 'inherit again'],
  hide: ['editor.layer.do.hide', 'hide here'],
}
const CHOICE_LAYER: Record<LayerChoice, LayerFacts['base']> = { here: 'here', inherit: 'inherited', hide: 'hidden' }

export function buildLayerChip(field: EditorField, env: ControlEnv): LayerChip {
  const { port, t } = env
  const chipId = `te-dg-${env.uid}-layer-${field}`
  const label = h('span', {})
  const caret = glyph('expand_more')
  const chip = h('button', { type: 'button', class: 'te-dg-chipl', id: chipId, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, label, caret)
  const menu = h('span', { class: 'te-dg-lmenu', role: 'menu', 'aria-labelledby': chipId, hidden: true, 'data-escape-local': '' })
  const items = (['here', 'inherit', 'hide'] as const).map(choice => {
    const b = h('button', { type: 'button', role: 'menuitemradio', 'aria-checked': 'false', tabindex: '-1', 'data-choice': choice }, t(CHOICE_WORD[choice][0], CHOICE_WORD[choice][1]))
    b.addEventListener('click', e => {
      e.stopPropagation()
      const f = port.layer(field)
      if (f) f.choose(f.choice === choice ? null : choice)
      close()
      chip.focus()
    })
    menu.append(b)
    return b
  })
  const visible = (): HTMLButtonElement[] => items.filter(b => !b.hidden)
  const close = (): void => { menu.hidden = true; chip.setAttribute('aria-expanded', 'false') }
  const open = (at: 'first' | 'last' = 'first'): void => {
    menu.hidden = false
    chip.setAttribute('aria-expanded', 'true')
    const list = visible()
    ;(at === 'first' ? list[0] : list[list.length - 1])?.focus()
  }
  chip.addEventListener('click', e => { e.stopPropagation(); if (chip.disabled) return; menu.hidden ? open() : close() })
  chip.addEventListener('keydown', e => {
    if (chip.disabled) return
    if (e.key === 'ArrowDown') { e.preventDefault(); open('first') }
    else if (e.key === 'ArrowUp') { e.preventDefault(); open('last') }
  })
  menu.addEventListener('keydown', e => {
    const list = visible()
    const at = list.indexOf(menu.ownerDocument.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(at + 1) % list.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(at - 1 + list.length) % list.length]?.focus() }
    else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus() }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus() }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); chip.focus() }
    else if (e.key === 'Tab') close()
  })
  const el = h('span', { class: 'te-dg-layer' }, chip, menu)
  const sync = (): void => {
    const f = port.layer(field)
    el.hidden = !f
    if (!f) { close(); return }
    const shown = f.choice ? CHOICE_LAYER[f.choice] : f.base
    const [k, fb] = LAYER_WORD[shown]
    setText(label, t(k, fb))
    setAttr(chip, 'data-layer', shown)
    setAttr(chip, 'data-pending', String(!!f.choice))
    chip.disabled = f.base === 'locked'
    setAttr(chip, 'title', f.base === 'locked' ? t('editor.layer.locked-why', "locked by the name - it can't be changed here") : null)
    caret.hidden = f.offered.length === 0
    for (const b of items) {
      const c = b.dataset['choice'] as LayerChoice
      b.hidden = !f.offered.includes(c) && f.choice !== c
      setAttr(b, 'aria-checked', String(f.choice === c))
    }
  }
  return { el, sync, close }
}

/** Close every open layer menu under `root` (a click elsewhere). */
export function closeLayerMenus(root: ParentNode, except?: Node | null): void {
  for (const m of Array.from(root.querySelectorAll<HTMLElement>('.te-dg-lmenu:not([hidden])'))) {
    if (except && m.parentElement?.contains(except)) continue
    m.hidden = true
    m.parentElement?.querySelector('.te-dg-chipl')?.setAttribute('aria-expanded', 'false')
  }
}

/** True on a coarse pointer: the first tap on a drawn part pins it, the second acts. */
export const coarsePointer = isTouchPointer
