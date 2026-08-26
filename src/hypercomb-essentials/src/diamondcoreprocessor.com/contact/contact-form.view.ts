// contact-form.view.ts — THE "ADD A CONTACT" DIALOG, as a framework-free
// custom element (everything-is-a-beehavior Phase 2: Angular panels leave the
// shell and ship as signed modules).
//
// A straight port of shared/ui/contact-card/contact-form: same surface name
// (hc-contact-form), same order band (160), the same one effect in
// (`contact:form-open`) and the same one out (`contact:form-submit`). It now
// ships from the directory that owns the rest of the feature — contact.drone.ts
// is right beside this file, and the two are one beehavior.
//
// WHAT IT IS FOR. Clicking a tile's contact icon makes ContactDrone answer
// `tile:action` with `contact:form-open`, carrying the tile's own name and (for
// a tile that already holds exactly one card) that card as `prefill`. This is
// the form that opens. Fill in the details, press Save, and
// `contact:form-submit` goes back to the drone, which persists the card as a
// `contacts`-slot layer write — undoable, time-travelable, shareable.
//
// THE NAME IS NOT A FIELD. A tile IS one contact, identified by its own
// grammar, so the name is shown read-only and never edited here — not from the
// form, not from `prefill`, and not from an imported .vcf. `#applyFields()`
// deliberately ignores `name` on every path, exactly as the component did, and
// the drone re-derives it from the tile on save. Do not "fix" that.
//
// PERSONAL DATA. Everything in this dialog is somebody's phone number, address
// and email. It is never logged, never put in a URL, and never leaves this
// element except as the one `contact:form-submit` payload the drone asked for.
// The vCard import parses the file LOCALLY (vcard.ts, no network) and the only
// console line in the file logs the thrown error, never a field value — kept
// verbatim from the original for exactly that reason.
//
// LIFECYCLE NOTE. The Angular version wrapped the backdrop and the panel in
// `@if (visible())`, so neither node existed while the form was shut. A
// registry-fed element is mounted ONCE at boot and stays, so the two nodes are
// built once, kept, and genuinely DETACHED when the form is closed — a dialog
// left behind as `display:none` still answers `querySelector`, and this one
// would also keep eating clicks through its full-screen backdrop.
//
// WIDGET ZOOM. The template stamped `hcWidget="contact-form" anchor="center"`
// on the panel. Those mechanics now live in core (`attachWidgetZoom`), so the
// directive and this element zoom through the SAME code and the same persisted
// scale. Attached once to the panel node — it is only ever detached and
// re-attached, never rebuilt — and torn down on disconnect.
//
// Its strings ship WITH it (contact-form.i18n.ts, extracted from all 14 shell
// catalogs) and register under the 'app' namespace, so every key resolves
// exactly as before — the Phase 2 catalog split, another slice. Four of its
// keys (`contact.field.phone` / `.email` / `.website` / `.address`) are ALSO
// rendered by hc-contact-hover, so both catalogs carry them: a surface must
// carry everything it renders, and `registerTranslations` merges.

import { EffectBus, I18N_IOC_KEY, attachWidgetZoom, type I18nProvider } from '@hypercomb/core'
import { CONTACT_FORM_TRANSLATIONS } from './contact-form.i18n.js'
import { fromVCard } from './vcard.js'

const SURFACE_NAME = 'hc-contact-form'

/** Same widget id and anchor the template passed to `hcWidget`. Changing
 *  either would orphan the participant's persisted scale. */
const WIDGET_ID = 'contact-form'
const WIDGET_ANCHOR = 'center' as const

/** The EDITABLE detail fields, in template order. `name` is not one of them —
 *  see the header note. Each carries its input type and its i18n key so the
 *  build and the relabel read from one list. */
const FIELDS = [
  { name: 'organization', type: 'text', key: 'contact.field.organization', fallback: 'Organization' },
  { name: 'title', type: 'text', key: 'contact.field.title', fallback: 'Title' },
  { name: 'phone', type: 'tel', key: 'contact.field.phone', fallback: 'Phone' },
  { name: 'email', type: 'email', key: 'contact.field.email', fallback: 'Email' },
  { name: 'website', type: 'url', key: 'contact.field.website', fallback: 'Website' },
  { name: 'address', type: 'text', key: 'contact.field.address', fallback: 'Address' },
  { name: 'note', type: 'textarea', key: 'contact.field.note', fallback: 'Note' },
] as const

type FieldName = typeof FIELDS[number]['name']

/** The card shape the drone sends as `prefill` and the form sends back. */
type ContactPayload = {
  name: string
  organization?: string
  title?: string
  phone?: string
  email?: string
  website?: string
  address?: string
  note?: string
}

type FormOpenPayload = { label?: string; segments?: string[]; prefill?: ContactPayload | null }

// Same contract as the shell pipe: the live provider resolves the key, and the
// fallback is the English catalog text so a bare host with no i18n reads
// identically. None of this panel's twelve keys take params.
const t = (key: string, fallback: string): string => {
  const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t(key)
  return value && value !== key ? value : fallback
}

// The dialog's strings travel with it — registered as soon as the i18n service
// is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(CONTACT_FORM_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
// No shadow DOM (the tutorial-overlay + landing-badge precedent), so Angular's
// `:host` becomes the tag name and every other selector is prefixed with it —
// nothing can leak out of the dialog. `$accent: #a8ffd8` (the mint that matches
// the contact overlay icon's hoverTint) is expanded to literal
// rgba(168,255,216,…); `var(--hc-mono)` is left alone. No @keyframes here, so
// nothing to namespace. `-webkit-backdrop-filter` is written by hand — Angular's
// build autoprefixed, a document-level sheet does not.
//
// TWO MIXINS ARE EXPANDED IN PLACE:
//   • `@include tw.floating-panel(#a8ffd8)` on `.contact-form-panel` — the
//     shared floating/modal shell (material, edge, elevation, typography, the
//     4px `$radius-floating` rung, and the four `--hc-window-*` custom
//     properties the shell publishes). It is written FIRST in the original
//     rule, so the layout declarations after it win; none of them collide.
//   • `@include tw.header` on `.contact-form-header` — the one tool-window
//     header BAND (2.875rem, rem-anchored so panel scaling never moves the
//     chrome) plus its `> button` hit-area rules. Those nested rules are the
//     reason the × reads 1.125rem and rgba(238,244,248,.62) rather than the
//     1.4rem / rgba(255,255,255,.7) written just below in `.contact-form-close`:
//     `.contact-form-header > button[class*='close']` is the more specific
//     selector and it WINS. Both rules are carried across with their relative
//     specificity intact (the tag prefix adds one type selector to every
//     compound equally), so the cascade lands on the same values it always did
//     — rather than pre-resolving it and leaving a reader wondering where the
//     1.4rem went.
const CSS = `
${SURFACE_NAME}{position:fixed;inset:0;z-index:100004;pointer-events:none}
${SURFACE_NAME} .contact-form-backdrop{pointer-events:auto;position:absolute;inset:0;background:rgba(4,6,10,.45);backdrop-filter:blur(1.5px);-webkit-backdrop-filter:blur(1.5px)}
${SURFACE_NAME} .contact-form-panel{--hc-window-accent:#a8ffd8;--hc-window-radius-control:2px;--hc-window-radius-card:3px;--hc-window-radius-floating:4px;background:rgba(13,15,21,.98);border:1px solid rgba(168,255,216,.38);border-radius:4px;box-shadow:0 18px 54px rgba(0,0,0,.55),inset 0 1px rgba(255,255,255,.03);font-family:var(--hc-mono,system-ui);color:#eef2f5;outline:none;pointer-events:auto;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(420px,calc(100vw - 2rem));max-height:calc(100vh - 3rem);display:flex;flex-direction:column}
${SURFACE_NAME} .contact-form-header{flex:0 0 auto;box-sizing:border-box;display:flex;align-items:center;gap:.5rem;height:2.875rem;min-height:2.875rem;padding:0 .75rem;line-height:1;background:linear-gradient(180deg,rgba(255,255,255,.018),rgba(255,255,255,.006));border-bottom:1px solid rgba(168,255,216,.22)}
${SURFACE_NAME} .contact-form-header>button,${SURFACE_NAME} .contact-form-header>[class*='actions']>button{box-sizing:border-box;display:inline-grid;place-items:center;min-width:1.75rem;height:1.75rem;padding:0 .25rem;border-radius:2px;line-height:1;transition:color 120ms ease,background-color 120ms ease,border-color 120ms ease}
${SURFACE_NAME} .contact-form-header>button:hover,${SURFACE_NAME} .contact-form-header>[class*='actions']>button:hover{background-color:rgba(255,255,255,.055)}
${SURFACE_NAME} .contact-form-header>button:focus-visible,${SURFACE_NAME} .contact-form-header>[class*='actions']>button:focus-visible{outline:1px solid color-mix(in srgb,var(--hc-window-accent) 72%,white);outline-offset:1px}
${SURFACE_NAME} .contact-form-header>button[class*='close'],${SURFACE_NAME} .contact-form-header>button.close,${SURFACE_NAME} .contact-form-header>[class*='actions']>button[class*='close']{width:1.75rem;min-width:1.75rem;padding:0;font-size:1.125rem;color:rgba(238,244,248,.62)}
${SURFACE_NAME} .contact-form-header>button[class*='close']:hover,${SURFACE_NAME} .contact-form-header>button.close:hover,${SURFACE_NAME} .contact-form-header>[class*='actions']>button[class*='close']:hover{color:#fff;background-color:rgba(255,255,255,.075)}
${SURFACE_NAME} .contact-form-title{font-size:.9rem;letter-spacing:.05em;color:rgba(168,255,216,.95)}
${SURFACE_NAME} .contact-form-cell{flex:1;font-size:.8rem;color:rgba(255,255,255,.55);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .contact-form-close{background:transparent;border:none;color:rgba(255,255,255,.7);font-size:1.4rem;line-height:1;cursor:pointer;padding:0 .25rem}
${SURFACE_NAME} .contact-form-close:hover{color:#a8ffd8}
${SURFACE_NAME} .contact-form-body{min-height:0;display:flex;flex-direction:column;gap:.7rem;padding:1rem;overflow-y:auto;overscroll-behavior:contain}
${SURFACE_NAME} .contact-row{display:flex;gap:.7rem}
${SURFACE_NAME} .contact-row .contact-field{flex:1;min-width:0}
${SURFACE_NAME} .contact-field{display:flex;flex-direction:column;gap:.3rem}
${SURFACE_NAME} .contact-label{font-size:.7rem;letter-spacing:.04em;text-transform:uppercase;color:rgba(255,255,255,.5)}
${SURFACE_NAME} input,${SURFACE_NAME} textarea{font-family:inherit;font-size:.85rem;color:#f3f3f3;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.14);border-radius:2px;padding:.45rem .55rem;outline:none;transition:border-color 150ms ease,background 150ms ease}
${SURFACE_NAME} input:focus,${SURFACE_NAME} textarea:focus{border-color:rgba(168,255,216,.7);background:rgba(168,255,216,.06)}
${SURFACE_NAME} textarea{resize:vertical}
${SURFACE_NAME} .contact-name-value{font-size:1rem;font-weight:600;color:#fff;padding:.4rem .55rem;border-radius:2px;background:rgba(168,255,216,.08);border:1px solid rgba(168,255,216,.22);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .contact-form-footer{display:flex;align-items:center;gap:.5rem;padding:.75rem 1rem;border-top:1px solid rgba(255,255,255,.08)}
${SURFACE_NAME} .contact-form-spacer{flex:1}
${SURFACE_NAME} .contact-import{cursor:pointer;font-size:.75rem;color:rgba(168,255,216,.85);border:1px dashed rgba(168,255,216,.4);border-radius:2px;padding:.35rem .6rem;transition:background 150ms ease,border-color 150ms ease}
${SURFACE_NAME} .contact-import:hover{background:rgba(168,255,216,.1);border-color:rgba(168,255,216,.7)}
${SURFACE_NAME} .contact-btn{font-family:inherit;font-size:.8rem;cursor:pointer;border-radius:2px;padding:.4rem .85rem;transition:background 150ms ease,color 150ms ease,border-color 150ms ease}
${SURFACE_NAME} .contact-btn.ghost{background:transparent;border:1px solid rgba(255,255,255,.18);color:rgba(255,255,255,.7)}
${SURFACE_NAME} .contact-btn.ghost:hover{border-color:rgba(255,255,255,.4);color:#fff}
${SURFACE_NAME} .contact-btn.primary{background:rgba(168,255,216,.16);border:1px solid rgba(168,255,216,.6);color:#a8ffd8}
${SURFACE_NAME} .contact-btn.primary:hover:not(:disabled){background:rgba(168,255,216,.28);color:#fff;border-color:#a8ffd8}
${SURFACE_NAME} .contact-btn.primary:disabled{opacity:.4;cursor:not-allowed}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-contact-form', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

export class ContactFormElement extends HTMLElement {

  #offs: Array<() => void> = []

  // ── state (lives here, never in the DOM) ───────────────────────────────
  /** `visible()` — whether the dialog is up. */
  #visible = false
  /** The tile's name (its grammar). This IS the contact's name, shown
   *  read-only; the form never edits it. */
  #cellLabel = ''
  /** The location the drone will write to, carried straight back on submit. */
  #segments: string[] = []
  /** The editable detail fields — the ngModel half. Kept in sync from each
   *  input's `input` event, so a re-label never has to read the DOM back. */
  #fields: Record<FieldName, string> = {
    organization: '', title: '', phone: '', email: '', website: '', address: '', note: '',
  }

  // ── chrome, built once and kept ────────────────────────────────────────
  #backdrop: HTMLDivElement | null = null
  #panel: HTMLElement | null = null
  #title: HTMLSpanElement | null = null
  #cell: HTMLSpanElement | null = null
  #closeBtn: HTMLButtonElement | null = null
  #nameLabel: HTMLSpanElement | null = null
  #nameValue: HTMLSpanElement | null = null
  #importBox: HTMLLabelElement | null = null
  #importText: HTMLSpanElement | null = null
  #cancel: HTMLButtonElement | null = null
  #saveBtn: HTMLButtonElement | null = null
  #inputs = new Map<FieldName, HTMLInputElement | HTMLTextAreaElement>()
  #labels = new Map<FieldName, HTMLSpanElement>()

  /** attachWidgetZoom's teardown — the effect subscription would otherwise
   *  outlive the node it scales. */
  #zoomOff: (() => void) | null = null

  connectedCallback(): void {
    installCss()
    this.#build()
    this.#offs.push(
      // The drone's one way in. Last-value replay means a late mount receives
      // whatever `contact:form-open` was last emitted; the Angular component
      // subscribed in its constructor and had exactly the same exposure, so
      // the (unguarded) replay is carried across rather than newly guarded —
      // see the surface note at the bottom of the file.
      EffectBus.on<FormOpenPayload>('contact:form-open', (payload) => this.#open(payload)),
      // THE PIPE WAS IMPURE. The Angular original resolved all twelve strings
      // through the `t` pipe, declared `pure: false`, so every change-detection
      // tick re-read them and `/language ja` re-labelled an OPEN dialog on the
      // spot — the title, every field label, Import/Cancel/Save and both
      // aria-labels. An element renders when it decides to, so the locale
      // switch has to BE a reason to re-resolve. `#relabel()` and not a full
      // rebuild, deliberately: the inputs hold half-typed personal data and a
      // rebuilt field is a lost caret.
      EffectBus.on('locale:changed', () => this.#relabel()),
    )
    // Hidden until `contact:form-open` says otherwise — a dialog that flashes
    // on boot is a regression, and this one would flash a full-screen backdrop.
    this.#render()
  }

  disconnectedCallback(): void {
    this.#offs.forEach(off => off())
    this.#offs = []
    this.#zoomOff?.()
    this.#zoomOff = null
    // Node-local listeners (the panel's keydown, every button's click, the
    // file input's change) go with the nodes; nothing here reaches document
    // or window, so there is nothing else to unhook.
    this.#backdrop = null
    this.#panel = null
    this.#title = null
    this.#cell = null
    this.#closeBtn = null
    this.#nameLabel = null
    this.#nameValue = null
    this.#importBox = null
    this.#importText = null
    this.#cancel = null
    this.#saveBtn = null
    this.#inputs.clear()
    this.#labels.clear()
    this.#visible = false
    this.#segments = []
    this.#cellLabel = ''
    this.#applyFieldsState(null)
    this.replaceChildren()
  }

  // ── the one effect in ──────────────────────────────────────────────────

  #open(p?: FormOpenPayload): void {
    // `if (!p) return` — the component's own guard, kept. A falsy payload is
    // not an open.
    if (!p) return
    this.#segments = Array.isArray(p.segments) ? p.segments.map(String) : []
    this.#cellLabel = p.label ?? ''
    this.#applyFields(p.prefill ?? null)
    this.#visible = true
    this.#render()
    // The component's queueMicrotask focus, scoped to this element rather than
    // the whole document (the panel is the only `.contact-form-panel` there
    // has ever been, so this selects the same node). By now `#render()` has
    // already attached the panel synchronously, so the focus always lands.
    queueMicrotask(() => { this.#inputs.get('organization')?.focus() })
  }

  // ── fields ─────────────────────────────────────────────────────────────

  /** Fill the editable detail fields, model AND inputs. The `name` is ignored
   *  — it always comes from the tile grammar, never from prefill or a vCard
   *  import. */
  #applyFields(c: ContactPayload | null): void {
    this.#applyFieldsState(c)
    for (const field of FIELDS) {
      const input = this.#inputs.get(field.name)
      if (!input) continue
      const value = this.#fields[field.name]
      // Assigning an identical value is a no-op in every engine we care about,
      // but the guard makes that a promise rather than a hope: this runs while
      // somebody may be mid-word in the field.
      if (input.value !== value) input.value = value
    }
  }

  /** The model half of `#applyFields`, split out so teardown can reset state
   *  without touching nodes it has already dropped. */
  #applyFieldsState(c: ContactPayload | null): void {
    for (const field of FIELDS) {
      this.#fields[field.name] = c?.[field.name] ?? ''
    }
  }

  /** `get canSave()` — the tile must have a name for the drone to write to.
   *  Copied in the original's direction (`> 0`), never re-derived by negating
   *  it: both forms are false for a non-string label, and the negated one
   *  falls through. */
  #canSave(): boolean {
    return this.#cellLabel.trim().length > 0
  }

  // ── the one effect out — every exit answers at most once ───────────────
  //
  // `save()` is the ONLY path that emits. The ×, Cancel, the backdrop and
  // Escape all fall through to `#closeForm()`, which answers nothing — the
  // drone treats "no submit" as "nothing changed", exactly as before. And
  // `#save()` closes after emitting, so a second Enter cannot send twice.

  #save(): void {
    if (!this.#canSave()) return
    // Emit only the editable details — the drone sets `name` from the tile.
    const contact = {
      organization: this.#fields.organization.trim() || undefined,
      title: this.#fields.title.trim() || undefined,
      phone: this.#fields.phone.trim() || undefined,
      email: this.#fields.email.trim() || undefined,
      website: this.#fields.website.trim() || undefined,
      address: this.#fields.address.trim() || undefined,
      note: this.#fields.note.trim() || undefined,
    }
    EffectBus.emit('contact:form-submit', { segments: this.#segments, label: this.#cellLabel, contact })
    this.#closeForm()
  }

  #closeForm(): void {
    this.#visible = false
    this.#applyFields(null)
    this.#segments = []
    this.#render()
  }

  /** The panel's own `(keydown)` binding — NOT a `keydown.escape`
   *  HostListener. The original bound a raw keydown on the section and tested
   *  `event.key === 'Escape'`, so a modifier-held Escape closed it too; adding
   *  the KeyEventsPlugin modifier guard here would itself be the regression.
   *  It is scoped to the panel, so it only ever sees presses made with focus
   *  inside the dialog. */
  #onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') { event.preventDefault(); this.#closeForm() }
    else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); this.#save() }
  }

  // ── vCard import (parsed locally; nothing leaves the browser) ───────────
  #onImport = async (event: Event): Promise<void> => {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    try {
      const parsed = fromVCard(await file.text())
      if (parsed) this.#applyFields(parsed)
    } catch (err) {
      // The thrown error only — never a parsed field. Verbatim from the
      // original, and it stays that way: this dialog holds personal data.
      console.warn('[contact-form] vCard import failed', err)
    } finally {
      input.value = ''
    }
  }

  // ── chrome (built once, detached) ──────────────────────────────────────
  #build(): void {
    if (this.#panel) return

    const backdrop = document.createElement('div')
    backdrop.className = 'contact-form-backdrop'
    backdrop.addEventListener('click', () => { this.#closeForm() })

    const panel = document.createElement('section')
    panel.className = 'contact-form-panel'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-modal', 'true')
    panel.addEventListener('keydown', this.#onKey)

    // ── header ──
    const header = document.createElement('header')
    header.className = 'contact-form-header'

    const title = document.createElement('span')
    title.className = 'contact-form-title'

    const cell = document.createElement('span')
    cell.className = 'contact-form-cell'

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'contact-form-close'
    // U+00D7 — the template's literal ×.
    close.textContent = '×'
    close.addEventListener('click', () => { this.#closeForm() })

    header.append(title, cell, close)

    // ── body ──
    const body = document.createElement('div')
    body.className = 'contact-form-body'

    // Name is the tile's own grammar — read-only, not an input.
    const nameField = document.createElement('div')
    nameField.className = 'contact-field contact-name-fixed'
    const nameLabel = document.createElement('span')
    nameLabel.className = 'contact-label'
    const nameValue = document.createElement('span')
    nameValue.className = 'contact-name-value'
    nameField.append(nameLabel, nameValue)
    body.appendChild(nameField)

    // Two paired rows, then three full-width fields — the template's shape.
    const orgRow = document.createElement('div')
    orgRow.className = 'contact-row'
    orgRow.append(this.#buildField('organization'), this.#buildField('title'))

    const contactRow = document.createElement('div')
    contactRow.className = 'contact-row'
    contactRow.append(this.#buildField('phone'), this.#buildField('email'))

    body.append(
      orgRow,
      contactRow,
      this.#buildField('website'),
      this.#buildField('address'),
      this.#buildField('note'),
    )

    // ── footer ──
    const footer = document.createElement('footer')
    footer.className = 'contact-form-footer'

    const importBox = document.createElement('label')
    importBox.className = 'contact-import'

    const file = document.createElement('input')
    file.type = 'file'
    file.accept = '.vcf,text/vcard,text/x-vcard'
    file.hidden = true
    file.addEventListener('change', (event) => { void this.#onImport(event) })

    const importText = document.createElement('span')
    importBox.append(file, importText)

    const spacer = document.createElement('span')
    spacer.className = 'contact-form-spacer'

    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.className = 'contact-btn ghost'
    cancel.addEventListener('click', () => { this.#closeForm() })

    const save = document.createElement('button')
    save.type = 'button'
    save.className = 'contact-btn primary'
    save.addEventListener('click', () => { this.#save() })

    footer.append(importBox, spacer, cancel, save)

    panel.append(header, body, footer)

    // The `hcWidget` stamp, same id and anchor. On the PANEL, where the
    // directive sat, once — the node is only detached and re-attached, never
    // rebuilt, so there is nothing to re-stamp.
    this.#zoomOff = attachWidgetZoom(panel, WIDGET_ID, WIDGET_ANCHOR)

    this.#backdrop = backdrop
    this.#panel = panel
    this.#title = title
    this.#cell = cell
    this.#closeBtn = close
    this.#nameLabel = nameLabel
    this.#nameValue = nameValue
    this.#importBox = importBox
    this.#importText = importText
    this.#cancel = cancel
    this.#saveBtn = save
    // Built DETACHED — `#render` attaches both nodes only when the form is
    // open, so nothing flashes on the way through mount.
  }

  /** One `<label class="contact-field">`: its caption span and its control.
   *  The control writes straight back into `#fields`, which is what ngModel's
   *  two-way binding did. */
  #buildField(name: FieldName): HTMLLabelElement {
    const spec = FIELDS.find(f => f.name === name)!
    const label = document.createElement('label')
    label.className = 'contact-field'

    const caption = document.createElement('span')
    caption.className = 'contact-label'

    // `<textarea rows="2">` for the note, `<input type="…" autocomplete="off">`
    // for the rest — the template's own split. autocomplete is OFF on every
    // field on purpose: this dialog is filling in SOMEBODY ELSE's details, and
    // the browser offering the participant's own saved address would be both
    // wrong and a small privacy leak.
    let control: HTMLInputElement | HTMLTextAreaElement
    if (spec.type === 'textarea') {
      const area = document.createElement('textarea')
      area.rows = 2
      control = area
    } else {
      const input = document.createElement('input')
      input.type = spec.type
      input.autocomplete = 'off'
      control = input
    }
    control.name = name
    // The ngModel half: the model is the truth, the input is the view, and
    // every keystroke writes back. `#relabel()` therefore never reads the DOM.
    const field = control
    control.addEventListener('input', () => { this.#fields[name] = field.value })

    label.append(caption, control)
    this.#labels.set(name, caption)
    this.#inputs.set(name, control)
    return label
  }

  // ── rendering ──────────────────────────────────────────────────────────

  /** Open/closed, plus the strings. There are no repeating rows here, so
   *  there is nothing to rebuild: the whole dialog is chrome that survives,
   *  and every render is a re-label plus an attach/detach. */
  #render(): void {
    const backdrop = this.#backdrop
    const panel = this.#panel
    if (!backdrop || !panel) return

    // `@if (visible())` — a truthiness test, so `!this.#visible` is its exact
    // complement. Closed means GONE, not `display:none`: the template removed
    // both nodes, `querySelector('.contact-form-panel')` is a contract a
    // driver may assert on, and a backdrop left behind would keep swallowing
    // every click on the hive. Detaching rather than rebuilding keeps the
    // inputs, the buttons and their listeners alive.
    if (!this.#visible) {
      panel.remove()
      backdrop.remove()
      return
    }

    this.#relabel()

    // Back in, if they were out — in template order, backdrop beneath the
    // panel. Guarded, so an already-attached node is never re-inserted (which
    // would be a remove + insert, and would drop the focus inside it).
    if (backdrop.parentNode !== this) this.appendChild(backdrop)
    if (panel.parentNode !== this) this.appendChild(panel)
  }

  /** Re-resolve every string in place. Called on open and on `locale:changed`
   *  — it touches captions, buttons and aria-labels only, never an input's
   *  value, so a half-typed phone number survives a language switch. */
  #relabel(): void {
    const heading = t('contact.form.title', 'Contact card')
    this.#panel?.setAttribute('aria-label', heading)
    if (this.#title) this.#title.textContent = heading

    // The tile's name, in both places the template printed it.
    if (this.#cell) this.#cell.textContent = this.#cellLabel
    if (this.#nameValue) this.#nameValue.textContent = this.#cellLabel

    const cancel = t('contact.form.cancel', 'Cancel')
    this.#closeBtn?.setAttribute('aria-label', cancel)
    if (this.#cancel) this.#cancel.textContent = cancel

    const importLabel = t('contact.form.import', 'Import .vcf')
    this.#importBox?.setAttribute('title', importLabel)
    if (this.#importText) this.#importText.textContent = importLabel

    if (this.#saveBtn) {
      this.#saveBtn.textContent = t('contact.form.save', 'Save')
      // `[disabled]="!canSave"` — the original's expression, copied.
      this.#saveBtn.disabled = !this.#canSave()
    }

    if (this.#nameLabel) this.#nameLabel.textContent = t('contact.field.name', 'Name')
    for (const field of FIELDS) {
      const caption = this.#labels.get(field.name)
      if (caption) caption.textContent = t(field.key, field.fallback)
    }
  }
}

// ── shell surface registration — the externalization path ────────────────
// Same name, same order band the Angular component held; the module-side
// `element:` shape (documentation/shell-surfaces.md). This is the FIRST of the
// contact folder's two surfaces — hc-contact-hover registers separately at 170,
// and the two must stay apart: the orders are what stack the details card over
// this dialog's backdrop.
//
// DEFINED AT MODULE SCOPE, registered when a registry appears. A host with no
// ShellSurfaceRegistry (diamond-core-processor mounts tags directly in its own
// template) still needs the tag to be a real element rather than an inert
// unknown one — so the define cannot wait on the registry. Only the ADD does.
if (!customElements.get(SURFACE_NAME)) {
  customElements.define(SURFACE_NAME, ContactFormElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/ContactFormElement',
    element: SURFACE_NAME,
    order: 160,
  })
})
