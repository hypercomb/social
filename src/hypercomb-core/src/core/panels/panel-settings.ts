// hypercomb-core/src/core/panels/panel-settings.ts
//
// The SETTINGS EDITOR — the small surface every docked tool window's gear
// opens, and the one place its chrome is drawn.
//
// The point of the file: adding a setting must be adding a ROW, not writing
// DOM. A window DECLARES what it has — a text field, a ladder of choices, a
// switch, a button — and this renders it, styles it, and keeps the editor's
// shape identical in every window. Before this, each setting hand-built its own
// elements with its own inline styles, so a fourth setting meant a fourth
// slightly-different section.
//
// It also puts the ONE idea the settings hang off where you can see it: a
// window's GROUP is just a string, and THE STRING NAMES A SETTINGS SET. Type
// the same string in another window and it is not "linked" to this one — it is
// running the same settings. So the string sits at the top of the editor and
// everything shared sits UNDER it, in a zone headed by the string itself; what
// cannot be shared (this window's own pair, its own launcher) is separated out
// and said plainly.
//
// Framework-free — the directive that owns the gear is imperative chrome, and
// nothing here should need Angular to render a popover.

import { STEEL } from './panel-groups.js'

/** One setting. The four shapes cover everything the windows have asked for so
 *  far; a fifth shape is added HERE and every window can use it at once. */
export type SettingRow =
  /** A free string — the group being the one that matters. Committed on
   *  Enter/blur, never per keystroke, so typing "team" doesn't pass through
   *  "t", "te", "tea" as three different settings sets. */
  | { kind: 'text'; key: string; label: string; value: string; placeholder?: string; hint?: string; commit: (value: string) => void }
  /** A short ladder, rendered as one segmented strip. Values are strings so the
   *  row stays plain data; the caller parses what it put in. */
  | { kind: 'choice'; key: string; label: string; value: string; options: readonly { value: string; label: string }[]; hint?: string; pick: (value: string) => void }
  /** A habit you keep or drop. Label left, toggle right. */
  | { kind: 'switch'; key: string; label: string; checked: boolean; hint?: string; toggle: (on: boolean) => void }
  /** Something that happens when you press it. `on` lights it when the thing it
   *  toggles is currently in effect. */
  | { kind: 'action'; key: string; label: string; on?: boolean; hint?: string; run: () => void }
  /** A choice you judge by LOOKING at it, not by reading its name — options
   *  stack one per line, each DRAWN IN WHAT IT DOES. A typeface forced it: its
   *  name, set in the editor's own font, tells you nothing whatever about the
   *  face it names, and five real names do not fit across a 272px strip
   *  anyway. `family` is the CSS font-family each option is drawn in.
   *
   *  The name and a mark for the one that is on — nothing else. Each entry
   *  used to carry a line of specimen text under it; five stacked samples
   *  turned a one-line question into a wall to read, and a name set in its own
   *  face already answers it.
   *
   *  `sample` is what the CLOSE-UP in the row's top-right corner says — one
   *  string for the whole ladder, because the question a ladder asks is the
   *  same for every face in it. The close-up shows the chosen face and follows
   *  the pointer down the list, which is how a name at reading size can stay
   *  the whole list and still let you look at a face properly. */
  | { kind: 'specimen'; key: string; label: string; value: string; sample?: string; options: readonly { value: string; label: string; family: string }[]; hint?: string; pick: (value: string) => void }

/** A titled run of rows. The title is what the rows APPLY TO — the group's
 *  string, or this window — which is the whole navigation of this editor.
 *
 *  `fold` makes the title a disclosure and starts the zone SHUT: settings for
 *  the few people who go looking for them, that everyone else should not have
 *  to read past. Open state is remembered while the tab lives (see `unfolded`)
 *  so a pick inside a fold does not slam it closed. */
export interface SettingsZone { key: string; title?: string; fold?: boolean; rows: readonly SettingRow[] }

/** Everything the editor draws: who it belongs to, and what it holds. */
export interface SettingsView { eyebrow: string; title: string; zones: readonly SettingsZone[] }

/** Where the caret was, so a re-render (a mate joined the group, a size
 *  changed) doesn't throw you out of the field you are typing in. */
export interface FocusSnapshot { key: string; start: number | null; end: number | null }

/** The editor's stylesheet, and the gear that opens it.
 *
 *  A real sheet rather than inline styles on every element: `:hover`, `:focus`
 *  and the selected segment cannot be expressed inline, the rules are shared by
 *  every window, and a row's markup stays readable enough to see what it is.
 *  Installed once, into the document — the elements are created imperatively,
 *  so no component's (encapsulated) SCSS would ever reach them.
 *
 *  The gear's RESTING colour stays a custom property set inline by the
 *  directive (a grouped window's gear is steel, an ungrouped one dim); an
 *  inline `color` would outrank the `:hover` rule and kill the effect. */
const SETTINGS_CSS = `
[data-hc-panel-settings] { color: var(--hc-gear, #6e8290); opacity: 1; pointer-events: auto; }
[data-hc-panel-settings]:hover,
[data-hc-panel-settings]:focus-visible,
[data-hc-panel-settings][aria-expanded='true'] { color: #cfe3ef; background-color: rgba(${STEEL}, 0.09) !important; }
[data-hc-panel-settings]:focus-visible { outline: 1px solid rgba(${STEEL}, 0.72); outline-offset: 1px; }
/* Touch: widen the target into space the header ALREADY reserves for it (the
   close button's margin is one gear slot), so nothing moves a pixel and the
   glyph stays the same size — only the hit area grows, to a full-height band.
   A rule rather than a JS branch: the gear is built imperatively and carries no
   _ngcontent attribute, so no panel's own touch-target SCSS can reach it. */
@media (pointer: coarse) {
  [data-hc-panel-settings] { width: 30px; height: 100%; min-height: 38px; }
}

.hc-settings {
  width: min(272px, calc(100% - 20px));
  box-sizing: border-box;
  padding: 0;
  background: rgba(11, 16, 21, 0.985);
  border: 1px solid rgba(${STEEL}, 0.3);
  border-radius: var(--hc-radius-floating, 4px);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
  font: 400 11.5px/1.45 system-ui, sans-serif;
  color: #c8d6de;
  -webkit-font-smoothing: antialiased;
}
.hc-settings-head {
  display: flex; align-items: baseline; gap: 0.5rem;
  padding: 0.55rem 0.75rem 0.5rem;
  border-bottom: 1px solid rgba(${STEEL}, 0.16);
}
.hc-settings-eyebrow {
  font-size: 9.5px; letter-spacing: 0.09em; text-transform: uppercase; color: #6f8492;
}
.hc-settings-name {
  margin-left: auto; font-size: 11px; color: #cfe3ef; text-transform: capitalize;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 55%;
}
.hc-settings-zone { padding: 0.6rem 0.75rem 0.65rem; }
.hc-settings-zone + .hc-settings-zone { border-top: 1px solid rgba(${STEEL}, 0.16); }
.hc-settings-zone-title {
  font-size: 9.5px; letter-spacing: 0.09em; text-transform: uppercase; color: #6f8492;
  margin: 0 0 0.5rem;
}
.hc-settings-row + .hc-settings-row { margin-top: 0.65rem; }
.hc-settings-label { display: block; font-size: 10.5px; color: #93a8b6; margin-bottom: 0.35rem; }
.hc-settings-hint { margin-top: 0.4rem; font-size: 10.5px; line-height: 1.4; color: #728896; }

.hc-settings input.hc-settings-field {
  width: 100%; box-sizing: border-box; height: 26px; padding: 0 0.45rem;
  font: inherit; color: #dcecf5;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(${STEEL}, 0.26); border-radius: 4px;
  outline: none;
}
.hc-settings input.hc-settings-field:focus { border-color: rgba(${STEEL}, 0.6); background: rgba(255, 255, 255, 0.055); }
.hc-settings input.hc-settings-field::placeholder { color: #5d7280; }

/* A list of names, each set in the face it names — no boxes, no sample lines,
   nothing standing between the names. The face is the answer and the name is
   already drawn in it; the rest was chrome charging rent on a 272px popover. */
.hc-settings-specimens { display: flex; flex-direction: column; }
.hc-settings-specimens > button {
  display: flex; align-items: center; gap: 0.45rem;
  width: 100%; text-align: left; min-height: 22px; padding: 2px 5px;
  background: none; border: 0; border-radius: 3px;
  font-size: 12px; line-height: 1.35; color: #93a8b6; cursor: pointer;
  /* The name is drawn with the window's own ligature setting, so a preview can
     never promise a shape the code block will not draw. */
  font-variant-ligatures: var(--hc-code-ligatures, none);
  transition: background 0.12s ease, color 0.12s ease;
}
/* The selection, and the only mark on the row: a lit dot in a gutter every
   entry reserves, so the names stay in one column and the list reads as the
   one-of-these choice it is. A CSS shape rather than a glyph — a tick drawn in
   the face being previewed is at the mercy of that face's coverage. */
.hc-settings-specimens > button::before {
  content: ''; flex: 0 0 auto; width: 5px; height: 5px; border-radius: 999px;
  background: transparent; transition: background 0.12s ease;
}
.hc-settings-specimens > button:hover { background: rgba(255, 255, 255, 0.05); color: #dcecf5; }
.hc-settings-specimens > button[aria-pressed='true'] { color: #eaf5fb; }
.hc-settings-specimens > button[aria-pressed='true']::before { background: #cfe3ef; }
.hc-settings-specimen-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* The row's own head: its name on the left, its close-up on the right. The
   only place in the editor where a control has something to say to the RIGHT
   of its label — and the label may be absent, when a folded zone's title has
   already asked the question. */
.hc-settings-specimen-head {
  display: flex; align-items: flex-end; gap: 0.5rem; margin-bottom: 0.35rem; min-height: 20px;
}
.hc-settings-specimen-head > .hc-settings-label { margin: 0; }
/* The close-up. Set at nearly twice the list's size, in the face being pointed
   at, over a pane of its own — a face at 12px in a 272px popover is a name you
   can read and a shape you cannot judge. It carries the window's ligature
   setting for the same reason the names do: a preview that promises a shape
   the code block will not draw is worse than no preview. */
.hc-settings-loupe {
  margin-left: auto; flex: 0 1 auto; min-width: 0;
  padding: 2px 7px 3px; border-radius: 3px;
  background: rgba(255, 255, 255, 0.045); border: 1px solid rgba(${STEEL}, 0.22);
  font-size: 17px; line-height: 1.25; color: #eaf5fb;
  font-variant-ligatures: var(--hc-code-ligatures, none);
  white-space: nowrap; overflow: hidden; text-overflow: clip;
}

/* A folded zone. The title stays exactly the title it was — same size, same
   letter-spacing — and gains a caret and a hit area; a fold that restyles its
   heading reads as a different KIND of thing rather than the same thing shut. */
.hc-settings-zone[data-hc-fold] > summary {
  display: flex; align-items: center; gap: 0.4rem;
  list-style: none; cursor: pointer; margin: 0; padding: 1px 0;
  color: #6f8492; transition: color 0.12s ease;
}
.hc-settings-zone[data-hc-fold] > summary::-webkit-details-marker { display: none; }
.hc-settings-zone[data-hc-fold] > summary:hover { color: #cfe3ef; }
.hc-settings-zone[data-hc-fold] > summary:focus-visible { outline: 1px solid rgba(${STEEL}, 0.72); outline-offset: 2px; }
.hc-settings-zone[data-hc-fold] > summary > .hc-settings-zone-title { margin: 0; color: inherit; }
.hc-settings-zone[data-hc-fold] > summary::after {
  content: ''; flex: 0 0 auto;
  width: 5px; height: 5px; margin-bottom: 1px;
  border-right: 1px solid currentColor; border-bottom: 1px solid currentColor;
  transform: rotate(-45deg); transition: transform 0.14s ease;
}
.hc-settings-zone[data-hc-fold][open] > summary::after { transform: rotate(45deg); margin-bottom: 3px; }
.hc-settings-zone[data-hc-fold][open] > summary { margin-bottom: 0.5rem; }

/* One strip, divided — a ladder reads as one control with a position on it,
   which a row of separate buttons never does. */
.hc-settings-seg {
  display: flex; width: 100%; overflow: hidden;
  border: 1px solid rgba(${STEEL}, 0.26); border-radius: 4px;
}
.hc-settings-seg > button {
  flex: 1 1 0; min-width: 0; height: 26px; padding: 0 0.2rem;
  font: inherit; font-size: 10.5px; color: #a9bcc9;
  background: transparent; border: 0; border-left: 1px solid rgba(${STEEL}, 0.2);
  cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  transition: background 0.12s ease, color 0.12s ease;
}
.hc-settings-seg > button:first-child { border-left: 0; }
.hc-settings-seg > button:hover { background: rgba(255, 255, 255, 0.05); color: #dcecf5; }
.hc-settings-seg > button[aria-pressed='true'] { background: rgba(${STEEL}, 0.2); color: #eaf5fb; }

.hc-settings-switchrow {
  display: flex; align-items: center; gap: 0.6rem; cursor: pointer;
  font-size: 11px; color: #c8d6de;
}
.hc-settings-switchrow > span:first-child { flex: 1 1 auto; }
.hc-settings-switch {
  flex: 0 0 auto; position: relative; width: 26px; height: 14px; border-radius: 999px;
  background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(${STEEL}, 0.26);
  transition: background 0.14s ease, border-color 0.14s ease;
}
.hc-settings-switch::after {
  content: ''; position: absolute; top: 2px; left: 2px; width: 8px; height: 8px;
  border-radius: 999px; background: #7f95a3; transition: transform 0.14s ease, background 0.14s ease;
}
.hc-settings-switchrow[aria-checked='true'] .hc-settings-switch { background: rgba(${STEEL}, 0.3); border-color: rgba(${STEEL}, 0.55); }
.hc-settings-switchrow[aria-checked='true'] .hc-settings-switch::after { transform: translateX(12px); background: #dcecf5; }

.hc-settings button.hc-settings-action {
  width: 100%; height: 26px; padding: 0 0.5rem;
  font: inherit; font-size: 11px; color: #c8d6de; cursor: pointer;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(${STEEL}, 0.26); border-radius: 4px;
  transition: background 0.12s ease, color 0.12s ease;
}
.hc-settings button.hc-settings-action:hover { background: rgba(255, 255, 255, 0.06); color: #dcecf5; }
.hc-settings button.hc-settings-action[data-on='true'] { background: rgba(${STEEL}, 0.18); border-color: rgba(${STEEL}, 0.5); color: #eaf5fb; }
`

let cssInstalled = false

/** Install the editor's stylesheet once. Idempotent; safe on every open. */
export const installSettingsCss = (): void => {
  if (cssInstalled || typeof document === 'undefined') return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-panel-settings-css', '')
  style.textContent = SETTINGS_CSS
  document.head.appendChild(style)
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const hintOf = (row: SettingRow): HTMLElement | null =>
  row.hint ? el('div', 'hc-settings-hint', row.hint) : null

/** One row, by shape. Every branch tags the control `data-hc-row` so a
 *  re-render can put the caret back, and the row `data-hc-setting` so probes
 *  and tests can find a setting by name. */
const renderRow = (row: SettingRow): HTMLElement => {
  const wrap = el('div', 'hc-settings-row')
  wrap.setAttribute('data-hc-setting', row.key)

  if (row.kind === 'switch') {
    // Label and toggle on one line — a habit is a yes/no, and stacking it
    // under a caption would make it read as a bigger decision than it is.
    const line = el('label', 'hc-settings-switchrow')
    line.setAttribute('role', 'switch')
    line.setAttribute('aria-checked', row.checked ? 'true' : 'false')
    line.appendChild(el('span', undefined, row.label))
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = row.checked
    box.dataset['hcRow'] = row.key
    Object.assign(box.style, { position: 'absolute', opacity: '0', pointerEvents: 'none', width: '0', height: '0' } as Partial<CSSStyleDeclaration>)
    // Paint the switch from the box's own state as it flips, so it moves under
    // the finger whether or not the caller re-renders anything.
    box.addEventListener('change', () => {
      line.setAttribute('aria-checked', box.checked ? 'true' : 'false')
      row.toggle(box.checked)
    })
    line.appendChild(box)
    line.appendChild(el('span', 'hc-settings-switch'))
    wrap.appendChild(line)
    const hint = hintOf(row)
    if (hint) wrap.appendChild(hint)
    return wrap
  }

  if (row.kind === 'action') {
    const button = el('button', 'hc-settings-action', row.label)
    button.type = 'button'
    button.dataset['hcRow'] = row.key
    if (row.on) button.dataset['on'] = 'true'
    button.addEventListener('click', () => { row.run() })
    wrap.appendChild(button)
    const hint = hintOf(row)
    if (hint) wrap.appendChild(hint)
    return wrap
  }

  // An empty label means the row is already named by what encloses it — a
  // folded zone whose title IS the question. Drawing it twice is noise.
  // A specimen row draws its own head, because its label shares that line.
  if (row.label && row.kind !== 'specimen') wrap.appendChild(el('div', 'hc-settings-label', row.label))

  if (row.kind === 'text') {
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'hc-settings-field'
    input.value = row.value
    // Attribute as well as property, so the field's contents are visible in the
    // serialised DOM — what a probe or a copied `outerHTML` shows is then the
    // group the window is actually in, not a blank box.
    input.setAttribute('value', row.value)
    input.dataset['hcRow'] = row.key
    if (row.placeholder) input.placeholder = row.placeholder
    input.setAttribute('aria-label', row.label)
    input.addEventListener('change', () => { row.commit(input.value) })
    wrap.appendChild(input)
  } else if (row.kind === 'specimen') {
    const head = el('div', 'hc-settings-specimen-head')
    if (row.label) head.appendChild(el('span', 'hc-settings-label', row.label))
    // Decorative to a screen reader: it says nothing the names do not, and a
    // close-up that announced itself on every hover would be noise in the ear.
    const loupe = row.sample ? el('span', 'hc-settings-loupe', row.sample) : null
    const chosen = row.options.find(option => option.value === row.value)
    const showFace = (family: string | undefined): void => {
      if (loupe && family) loupe.style.fontFamily = family
    }
    if (loupe) {
      loupe.setAttribute('aria-hidden', 'true')
      showFace(chosen?.family)
      head.appendChild(loupe)
    }
    if (head.childElementCount) wrap.appendChild(head)

    const list = el('div', 'hc-settings-specimens')
    // Pointing at a name is asking to see it; leaving the list is the question
    // going away, and the close-up goes back to the face you are actually in.
    list.addEventListener('pointerleave', () => { showFace(chosen?.family) })
    list.addEventListener('focusout', () => { showFace(chosen?.family) })
    list.setAttribute('role', 'group')
    list.setAttribute('aria-label', row.label)
    for (const option of row.options) {
      const button = el('button')
      button.type = 'button'
      button.dataset['hcRow'] = `${row.key}:${option.value}`
      button.setAttribute('aria-pressed', option.value === row.value ? 'true' : 'false')
      // The face is set on the BUTTON, so the name is drawn in the thing being
      // chosen — which is the entire preview.
      button.style.fontFamily = option.family
      button.appendChild(el('span', 'hc-settings-specimen-name', option.label))
      // Keyboard as well as pointer: tabbing the list must show the same
      // close-up that hovering it does.
      button.addEventListener('pointerenter', () => { showFace(option.family) })
      button.addEventListener('focus', () => { showFace(option.family) })
      button.addEventListener('click', () => { row.pick(option.value) })
      list.appendChild(button)
    }
    wrap.appendChild(list)
  } else {
    const strip = el('div', 'hc-settings-seg')
    strip.setAttribute('role', 'group')
    strip.setAttribute('aria-label', row.label)
    for (const option of row.options) {
      const button = el('button', undefined, option.label)
      button.type = 'button'
      button.dataset['hcRow'] = `${row.key}:${option.value}`
      button.title = option.label
      button.setAttribute('aria-pressed', option.value === row.value ? 'true' : 'false')
      button.addEventListener('click', () => { row.pick(option.value) })
      strip.appendChild(button)
    }
    wrap.appendChild(strip)
  }

  const hint = hintOf(row)
  if (hint) wrap.appendChild(hint)
  return wrap
}

/** Which folded zones are open, by zone key. View state, not a setting: it
 *  lives for the tab and is deliberately shared by every window's editor —
 *  somebody who opened the code fonts once is somebody who cares about code
 *  fonts. It exists at all because the editor re-renders WHOLE on every pick,
 *  and a fold that shut under the click you just made would be unusable. */
const unfolded = new Set<string>()

/** Draw the editor's body. The caller owns the popover element (position,
 *  dismissal); this owns everything inside it, and can be re-rendered whole. */
export const renderSettings = (view: SettingsView): HTMLElement => {
  const body = el('div', 'hc-settings-body')

  const head = el('div', 'hc-settings-head')
  head.appendChild(el('span', 'hc-settings-eyebrow', view.eyebrow))
  head.appendChild(el('span', 'hc-settings-name', view.title))
  body.appendChild(head)

  for (const zone of view.zones) {
    if (!zone.rows.length) continue
    const title = zone.title
    if (zone.fold && title) {
      const details = el('details', 'hc-settings-zone')
      details.setAttribute('data-hc-zone', zone.key)
      details.setAttribute('data-hc-fold', '')
      details.open = unfolded.has(zone.key)
      const summary = el('summary')
      summary.appendChild(el('span', 'hc-settings-zone-title', title))
      details.appendChild(summary)
      details.addEventListener('toggle', () => {
        if (details.open) unfolded.add(zone.key)
        else unfolded.delete(zone.key)
      })
      for (const row of zone.rows) details.appendChild(renderRow(row))
      body.appendChild(details)
      continue
    }
    const section = el('div', 'hc-settings-zone')
    section.setAttribute('data-hc-zone', zone.key)
    if (title) section.appendChild(el('div', 'hc-settings-zone-title', title))
    for (const row of zone.rows) section.appendChild(renderRow(row))
    body.appendChild(section)
  }

  return body
}

/** What has focus in the editor right now, if anything. */
export const focusSnapshot = (root: HTMLElement): FocusSnapshot | null => {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !root.contains(active)) return null
  const key = active.dataset['hcRow']
  if (!key) return null
  const field = active as HTMLInputElement
  const text = field.type === 'text'
  return { key, start: text ? field.selectionStart : null, end: text ? field.selectionEnd : null }
}

/** Put it back after a re-render, caret and all. A settings set that anyone in
 *  the group can change means somebody else's change can repaint the editor
 *  under your hands — it must not cost you the field you are in. */
export const restoreFocus = (root: HTMLElement, snap: FocusSnapshot | null): void => {
  if (!snap) return
  const next = root.querySelector(`[data-hc-row="${CSS.escape(snap.key)}"]`)
  if (!(next instanceof HTMLElement)) return
  next.focus()
  if (snap.start === null || !(next instanceof HTMLInputElement)) return
  try { next.setSelectionRange(snap.start, snap.end ?? snap.start) } catch { /* not a text field any more */ }
}
