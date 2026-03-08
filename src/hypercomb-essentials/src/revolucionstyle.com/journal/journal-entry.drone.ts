// revolucionstyle.com/journal/journal-entry.drone.ts
// Orchestrator: wires journal:action effect -> open/save/cancel.
// Creates raw DOM form overlay (no Angular dependency).

import { EffectBus } from '@hypercomb/core'
import type { JournalService } from './journal.service.js'
import type { CigarRatings, FlavorProfile, Pairing } from './journal-entry.js'
import type { CigarCatalogService } from '../cigar/cigar-catalog.service.js'
import { FLAVOR_INDEX } from '../wheel/flavor-data.js'

// ── styling constants ────────────────────────────────────────────

const BG_DARK = '#1a1612'
const BG_INPUT = '#2a231c'
const TEXT = '#e0d5c8'
const TEXT_DIM = '#8a7e72'
const BORDER = '#3a322a'
const ACCENT = '#c8975a'
const ACCENT_DIM = '#6b5a3a'
const STAR_EMPTY = '#3a322a'
const STAR_FULL = '#c8975a'

type JournalActionPayload = {
  action: string
  sig?: string
}

export class JournalEntryDrone {

  #overlay: HTMLDivElement | null = null
  #flavorChipsContainer: HTMLDivElement | null = null

  constructor() {
    EffectBus.on<JournalActionPayload>('journal:action', this.#onAction)
    EffectBus.on<FlavorProfile>('wheel:selection-changed', this.#onFlavorChanged)
  }

  // ── effect handlers ────────────────────────────────────────────

  #onAction = (payload: JournalActionPayload): void => {
    if (payload.action === 'new') void this.#openNew()
    else if (payload.action === 'edit' && payload.sig) void this.#openExisting(payload.sig)
  }

  #onFlavorChanged = (profile: FlavorProfile): void => {
    const service = window.ioc.get<JournalService>('@revolucionstyle.com/JournalService')
    if (!service || service.mode !== 'editing') return
    service.setFlavors(profile)
    this.#updateFlavorChips(profile)
  }

  // ── open ───────────────────────────────────────────────────────

  async #openNew(): Promise<void> {
    const service = window.ioc.get<JournalService>('@revolucionstyle.com/JournalService')
    if (!service) return
    service.open()
    this.#buildOverlay()
  }

  async #openExisting(sig: string): Promise<void> {
    const service = window.ioc.get<JournalService>('@revolucionstyle.com/JournalService')
    if (!service) return
    const entry = await service.loadEntry(sig)
    if (!entry) return
    service.open(entry, sig)
    this.#buildOverlay()
  }

  // ── save / cancel ──────────────────────────────────────────────

  readonly #save = async (): Promise<void> => {
    const service = window.ioc.get<JournalService>('@revolucionstyle.com/JournalService')
    if (!service) return

    const catalog = window.ioc.get<CigarCatalogService>('@revolucionstyle.com/CigarCatalogService')
    if (catalog) await catalog.add(service.entry.cigar)

    await service.save()
    this.#destroyOverlay()
  }

  readonly #cancel = (): void => {
    const service = window.ioc.get<JournalService>('@revolucionstyle.com/JournalService')
    service?.close()
    this.#destroyOverlay()
  }

  // ── DOM overlay ────────────────────────────────────────────────

  #buildOverlay(): void {
    if (this.#overlay) this.#destroyOverlay()

    const service = window.ioc.get<JournalService>('@revolucionstyle.com/JournalService')
    if (!service) return

    this.#overlay = this.#el('div', {
      position: 'fixed', inset: '0', zIndex: '70000',
      backgroundColor: 'rgba(0, 0, 0, 0.82)',
      overflowY: 'auto',
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      color: TEXT,
    })

    const container = this.#el('div', {
      width: '480px', margin: '40px auto',
      backgroundColor: BG_DARK, borderRadius: '12px', padding: '24px',
      border: `1px solid ${BORDER}`,
    })

    container.appendChild(this.#buildHeader(service.isNew ? 'New Journal Entry' : 'Edit Journal Entry'))
    container.appendChild(this.#buildCigarSection(service))
    container.appendChild(this.#buildRatingsSection(service))
    container.appendChild(this.#buildFlavorSection(service))
    container.appendChild(this.#buildNotesSection(service))
    container.appendChild(this.#buildPairingsSection(service))
    container.appendChild(this.#buildMetaSection(service))
    container.appendChild(this.#buildActions())

    this.#overlay.appendChild(container)
    this.#overlay.addEventListener('click', (e) => {
      if (e.target === this.#overlay) this.#cancel()
    })
    document.body.appendChild(this.#overlay)
  }

  #destroyOverlay(): void {
    if (this.#overlay) {
      document.body.removeChild(this.#overlay)
      this.#overlay = null
      this.#flavorChipsContainer = null
    }
  }

  // ── form sections ──────────────────────────────────────────────

  #buildHeader(title: string): HTMLElement {
    const h = this.#el('h2', {
      margin: '0 0 20px 0', fontSize: '20px', fontWeight: '600', color: ACCENT,
    })
    h.textContent = title
    return h
  }

  #buildCigarSection(service: JournalService): HTMLElement {
    const section = this.#section('Cigar')
    const grid = this.#el('div', {
      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px',
    })

    grid.appendChild(this.#inputField('Brand', service.entry.cigar.brand, (v) => service.setCigar({ brand: v })))
    grid.appendChild(this.#inputField('Line', service.entry.cigar.line, (v) => service.setCigar({ line: v })))
    grid.appendChild(this.#inputField('Name', service.entry.cigar.name, (v) => service.setCigar({ name: v }), '1 / -1'))
    grid.appendChild(this.#selectField('Vitola', service.entry.cigar.vitola, [
      'robusto', 'toro', 'corona', 'churchill', 'lancero', 'gordo',
      'belicoso', 'torpedo', 'perfecto', 'petit corona', 'lonsdale', 'panatela', 'other',
    ], (v) => service.setCigar({ vitola: v })))
    grid.appendChild(this.#selectField('Wrapper', service.entry.cigar.wrapper, [
      'natural', 'maduro', 'oscuro', 'claro', 'colorado', 'colorado maduro',
      'connecticut', 'habano', 'sumatra', 'other',
    ], (v) => service.setCigar({ wrapper: v })))
    grid.appendChild(this.#inputField('Origin', service.entry.cigar.origin, (v) => service.setCigar({ origin: v })))
    grid.appendChild(this.#selectField('Strength', service.entry.cigar.strength, [
      'mild', 'mild-medium', 'medium', 'medium-full', 'full',
    ], (v) => service.setCigar({ strength: v as any })))

    section.appendChild(grid)
    return section
  }

  #buildRatingsSection(service: JournalService): HTMLElement {
    const section = this.#section('Ratings')
    const fields: (keyof CigarRatings)[] = ['draw', 'burn', 'construction', 'flavor', 'overall']

    for (const field of fields) {
      const row = this.#el('div', {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '8px',
      })

      const label = this.#el('span', { fontSize: '13px', textTransform: 'capitalize' })
      label.textContent = field

      const stars = this.#el('div', { display: 'flex', gap: '4px' })

      for (let i = 1; i <= 5; i++) {
        const star = this.#el('div', {
          width: '24px', height: '24px', borderRadius: '50%', cursor: 'pointer',
          backgroundColor: i <= service.entry.ratings[field] ? STAR_FULL : STAR_EMPTY,
          transition: 'background-color 0.15s',
          border: `1px solid ${ACCENT_DIM}`,
        })
        star.addEventListener('click', () => {
          const current = service.entry.ratings[field]
          service.setRating(field, current === i ? i - 1 : i)
          // update all stars in this row
          const allStars = stars.children
          for (let j = 0; j < allStars.length; j++) {
            ;(allStars[j] as HTMLElement).style.backgroundColor =
              j < service.entry.ratings[field] ? STAR_FULL : STAR_EMPTY
          }
        })
        stars.appendChild(star)
      }

      row.appendChild(label)
      row.appendChild(stars)
      section.appendChild(row)
    }

    return section
  }

  #buildFlavorSection(service: JournalService): HTMLElement {
    const section = this.#section('Flavor Notes')

    const row = this.#el('div', {
      display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px',
    })

    const btn = this.#el('button', {
      padding: '8px 16px', border: `1px solid ${ACCENT}`, borderRadius: '6px',
      backgroundColor: BG_INPUT, color: ACCENT, fontSize: '13px',
      cursor: 'pointer', fontFamily: "'Segoe UI', system-ui, sans-serif",
    })
    btn.textContent = 'Open Flavor Wheel'
    btn.addEventListener('click', () => {
      EffectBus.emit('wheel:open', { profile: service.entry.flavors })
    })

    const badge = this.#el('span', { fontSize: '12px', color: TEXT_DIM })
    badge.textContent = service.entry.flavors.selected.length > 0
      ? `${service.entry.flavors.selected.length} selected`
      : 'none selected'

    row.appendChild(btn)
    row.appendChild(badge)
    section.appendChild(row)

    // chips container
    this.#flavorChipsContainer = this.#el('div', {
      display: 'flex', flexWrap: 'wrap', gap: '6px',
    }) as HTMLDivElement
    this.#renderFlavorChips(service.entry.flavors)
    section.appendChild(this.#flavorChipsContainer)

    return section
  }

  #renderFlavorChips(profile: FlavorProfile): void {
    if (!this.#flavorChipsContainer) return
    this.#flavorChipsContainer.innerHTML = ''

    for (const id of profile.selected) {
      const info = FLAVOR_INDEX.get(id)
      if (!info) continue

      const chip = this.#el('span', {
        display: 'inline-block', padding: '3px 10px', borderRadius: '12px',
        fontSize: '11px', color: TEXT,
        backgroundColor: `#${info.category.color.toString(16).padStart(6, '0')}`,
        opacity: '0.85',
      })
      chip.textContent = info.note.label
      this.#flavorChipsContainer!.appendChild(chip)
    }
  }

  #updateFlavorChips(profile: FlavorProfile): void {
    this.#renderFlavorChips(profile)

    // update badge text if overlay exists
    if (!this.#overlay) return
    const badge = this.#overlay.querySelector('[data-flavor-badge]') as HTMLElement
    if (badge) {
      badge.textContent = profile.selected.length > 0
        ? `${profile.selected.length} selected`
        : 'none selected'
    }
  }

  #buildNotesSection(service: JournalService): HTMLElement {
    const section = this.#section('Notes')

    const textarea = document.createElement('textarea')
    Object.assign(textarea.style, {
      width: '100%', minHeight: '80px', padding: '10px', boxSizing: 'border-box',
      backgroundColor: BG_INPUT, color: TEXT, border: `1px solid ${BORDER}`,
      borderRadius: '6px', fontSize: '13px', fontFamily: "'Segoe UI', system-ui, sans-serif",
      resize: 'vertical',
    })
    textarea.value = service.entry.notes
    textarea.placeholder = 'Tasting notes, observations...'
    textarea.addEventListener('input', () => service.setNotes(textarea.value))

    section.appendChild(textarea)
    return section
  }

  #buildPairingsSection(service: JournalService): HTMLElement {
    const section = this.#section('Pairings')

    const listContainer = this.#el('div', { marginBottom: '8px' })
    const renderList = () => {
      listContainer.innerHTML = ''
      service.entry.pairings.forEach((p: Pairing, i: number) => {
        const row = this.#el('div', {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '4px 8px', marginBottom: '4px',
          backgroundColor: BG_INPUT, borderRadius: '4px', fontSize: '12px',
        })
        const text = this.#el('span', {})
        text.textContent = `${p.type}: ${p.name}`
        const removeBtn = this.#el('button', {
          background: 'none', border: 'none', color: TEXT_DIM, cursor: 'pointer',
          fontSize: '14px', padding: '0 4px',
        })
        removeBtn.textContent = '\u00d7'
        removeBtn.addEventListener('click', () => {
          service.removePairing(i)
          renderList()
        })
        row.appendChild(text)
        row.appendChild(removeBtn)
        listContainer.appendChild(row)
      })
    }
    renderList()
    section.appendChild(listContainer)

    // add pairing row
    const addRow = this.#el('div', { display: 'flex', gap: '8px' })
    const typeSelect = this.#createSelect([
      'coffee', 'whiskey', 'rum', 'wine', 'beer', 'tea', 'water', 'food', 'other',
    ], 'coffee')
    const nameInput = this.#createInput('Name...', '')
    const addBtn = this.#el('button', {
      padding: '6px 12px', border: `1px solid ${BORDER}`, borderRadius: '4px',
      backgroundColor: BG_INPUT, color: TEXT, cursor: 'pointer', fontSize: '12px',
      fontFamily: "'Segoe UI', system-ui, sans-serif", whiteSpace: 'nowrap',
    })
    addBtn.textContent = '+ Add'
    addBtn.addEventListener('click', () => {
      const name = (nameInput as HTMLInputElement).value.trim()
      if (!name) return
      service.addPairing({ type: (typeSelect as HTMLSelectElement).value, name })
      ;(nameInput as HTMLInputElement).value = ''
      renderList()
    })

    addRow.appendChild(typeSelect)
    addRow.appendChild(nameInput)
    addRow.appendChild(addBtn)
    section.appendChild(addRow)

    return section
  }

  #buildMetaSection(service: JournalService): HTMLElement {
    const section = this.#section('Details')
    const grid = this.#el('div', {
      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px',
    })

    // duration
    grid.appendChild(this.#inputField(
      'Duration (min)', String(service.entry.durationMinutes ?? ''),
      (v) => service.setDuration(parseInt(v) || 0), undefined, 'number',
    ))

    // occasion
    grid.appendChild(this.#selectField('Occasion', service.entry.occasion ?? '', [
      '', 'celebration', 'relaxation', 'social', 'tasting', 'review',
    ], (v) => service.setOccasion(v)))

    section.appendChild(grid)
    return section
  }

  #buildActions(): HTMLElement {
    const row = this.#el('div', {
      display: 'flex', justifyContent: 'flex-end', gap: '12px',
      marginTop: '20px', paddingTop: '16px', borderTop: `1px solid ${BORDER}`,
    })

    const cancelBtn = this.#el('button', {
      padding: '10px 20px', border: `1px solid ${BORDER}`, borderRadius: '6px',
      backgroundColor: 'transparent', color: TEXT_DIM, fontSize: '14px',
      cursor: 'pointer', fontFamily: "'Segoe UI', system-ui, sans-serif",
    })
    cancelBtn.textContent = 'Cancel'
    cancelBtn.addEventListener('click', this.#cancel)

    const saveBtn = this.#el('button', {
      padding: '10px 24px', border: 'none', borderRadius: '6px',
      backgroundColor: ACCENT, color: BG_DARK, fontSize: '14px',
      fontWeight: '600', cursor: 'pointer',
      fontFamily: "'Segoe UI', system-ui, sans-serif",
    })
    saveBtn.textContent = 'Save Entry'
    saveBtn.addEventListener('click', () => void this.#save())

    row.appendChild(cancelBtn)
    row.appendChild(saveBtn)
    return row
  }

  // ── DOM helpers ────────────────────────────────────────────────

  #el(tag: string, styles: Record<string, string>): HTMLElement {
    const el = document.createElement(tag)
    Object.assign(el.style, styles)
    return el
  }

  #section(title: string): HTMLElement {
    const section = this.#el('div', { marginBottom: '20px' })
    const label = this.#el('div', {
      fontSize: '11px', fontWeight: '600', textTransform: 'uppercase',
      letterSpacing: '0.08em', color: TEXT_DIM, marginBottom: '10px',
    })
    label.textContent = title
    section.appendChild(label)
    return section
  }

  #createInput(placeholder: string, value: string): HTMLElement {
    const input = document.createElement('input')
    input.type = 'text'
    input.placeholder = placeholder
    input.value = value
    Object.assign(input.style, {
      flex: '1', padding: '8px 10px', backgroundColor: BG_INPUT,
      color: TEXT, border: `1px solid ${BORDER}`, borderRadius: '4px',
      fontSize: '13px', fontFamily: "'Segoe UI', system-ui, sans-serif",
      outline: 'none', boxSizing: 'border-box',
    })
    return input
  }

  #createSelect(options: string[], value: string): HTMLElement {
    const select = document.createElement('select')
    Object.assign(select.style, {
      padding: '8px 10px', backgroundColor: BG_INPUT, color: TEXT,
      border: `1px solid ${BORDER}`, borderRadius: '4px', fontSize: '13px',
      fontFamily: "'Segoe UI', system-ui, sans-serif", outline: 'none',
    })
    for (const opt of options) {
      const option = document.createElement('option')
      option.value = opt
      option.textContent = opt || '(none)'
      if (opt === value) option.selected = true
      select.appendChild(option)
    }
    return select
  }

  #inputField(
    label: string, value: string, onChange: (v: string) => void,
    gridColumn?: string, type = 'text',
  ): HTMLElement {
    const wrapper = this.#el('div', { display: 'flex', flexDirection: 'column', gap: '4px' })
    if (gridColumn) wrapper.style.gridColumn = gridColumn

    const lbl = this.#el('label', { fontSize: '11px', color: TEXT_DIM })
    lbl.textContent = label

    const input = document.createElement('input')
    input.type = type
    input.value = value
    Object.assign(input.style, {
      padding: '8px 10px', backgroundColor: BG_INPUT, color: TEXT,
      border: `1px solid ${BORDER}`, borderRadius: '4px', fontSize: '13px',
      fontFamily: "'Segoe UI', system-ui, sans-serif", outline: 'none',
    })
    input.addEventListener('input', () => onChange(input.value))

    wrapper.appendChild(lbl)
    wrapper.appendChild(input)
    return wrapper
  }

  #selectField(
    label: string, value: string, options: string[], onChange: (v: string) => void,
  ): HTMLElement {
    const wrapper = this.#el('div', { display: 'flex', flexDirection: 'column', gap: '4px' })

    const lbl = this.#el('label', { fontSize: '11px', color: TEXT_DIM })
    lbl.textContent = label

    const select = this.#createSelect(options, value) as HTMLSelectElement
    select.addEventListener('change', () => onChange(select.value))

    wrapper.appendChild(lbl)
    wrapper.appendChild(select)
    return wrapper
  }
}

window.ioc.register(
  '@revolucionstyle.com/JournalEntryDrone',
  new JournalEntryDrone(),
)
