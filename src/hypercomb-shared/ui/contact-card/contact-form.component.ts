// hypercomb-shared/ui/contact-card/contact-form.component.ts
//
// The "add a contact" form. Opened when a tile's contact icon is clicked
// (ContactDrone answers tile:action with `contact:form-open`), or when
// re-editing a single-card tile (the drone passes `prefill`). On save it
// emits `contact:form-submit`; the drone persists the card as a layer
// decoration. Shell UI — must NOT import essentials. The optional "import
// .vcf" button parses a vCard locally to prefill the fields.

import { Component, signal, type OnDestroy } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { fromVCard } from './vcard'

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

@Component({
  selector: 'hc-contact-form',
  standalone: true,
  imports: [TranslatePipe, FormsModule],
  templateUrl: './contact-form.component.html',
  styleUrls: ['./contact-form.component.scss'],
})
export class ContactFormComponent implements OnDestroy {

  readonly visible = signal(false)
  /** The tile's name (its grammar) — this IS the contact's name, shown
   *  read-only. The form never edits it; the drone derives it from the tile. */
  readonly cellLabel = signal<string>('')

  // Editable detail fields (bound via ngModel) — reset on each open. The NAME
  // is intentionally NOT here: a tile is a contact identified by its own
  // grammar, so you fill in details, you don't re-type the name.
  organization = ''
  title = ''
  phone = ''
  email = ''
  website = ''
  address = ''
  note = ''

  #segments: string[] = []
  #cleanups: (() => void)[] = []

  constructor() {
    this.#cleanups.push(EffectBus.on<{ label?: string; segments?: string[]; prefill?: ContactPayload | null }>('contact:form-open', (p) => {
      if (!p) return
      this.#segments = Array.isArray(p.segments) ? p.segments.map(String) : []
      this.cellLabel.set(p.label ?? '')
      this.#applyFields(p.prefill ?? null)
      this.visible.set(true)
      queueMicrotask(() => {
        document.querySelector<HTMLInputElement>('.contact-form-panel input[name="organization"]')?.focus()
      })
    }))
  }

  ngOnDestroy(): void {
    for (const c of this.#cleanups) c()
  }

  /** Fill the editable detail fields. The `name` is ignored — it always comes
   *  from the tile grammar, never from prefill or a vCard import. */
  #applyFields(c: ContactPayload | null): void {
    this.organization = c?.organization ?? ''
    this.title = c?.title ?? ''
    this.phone = c?.phone ?? ''
    this.email = c?.email ?? ''
    this.website = c?.website ?? ''
    this.address = c?.address ?? ''
    this.note = c?.note ?? ''
  }

  get canSave(): boolean {
    return this.cellLabel().trim().length > 0
  }

  save(): void {
    if (!this.canSave) return
    // Emit only the editable details — the drone sets `name` from the tile.
    const contact = {
      organization: this.organization.trim() || undefined,
      title: this.title.trim() || undefined,
      phone: this.phone.trim() || undefined,
      email: this.email.trim() || undefined,
      website: this.website.trim() || undefined,
      address: this.address.trim() || undefined,
      note: this.note.trim() || undefined,
    }
    EffectBus.emit('contact:form-submit', { segments: this.#segments, label: this.cellLabel(), contact })
    this.close()
  }

  close(): void {
    this.visible.set(false)
    this.#applyFields(null)
    this.#segments = []
  }

  onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); this.close() }
    else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); this.save() }
  }

  // ── vCard import ──────────────────────────────────────
  async onImport(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    try {
      const parsed = fromVCard(await file.text())
      if (parsed) this.#applyFields(parsed)
    } catch (err) {
      console.warn('[contact-form] vCard import failed', err)
    } finally {
      input.value = ''
    }
  }
}
