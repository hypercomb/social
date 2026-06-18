// hypercomb-shared/ui/contact-card/vcard.ts
//
// Minimal, dependency-free vCard 3.0 read/write. Used by the contact form
// to IMPORT a .vcf (prefill the fields) and by the hover panel to EXPORT a
// card so a viewer can add the shared contact to their own address book —
// the "import your contact information" round-trip.

export interface ContactFields {
  name: string
  organization?: string
  title?: string
  phone?: string
  email?: string
  website?: string
  address?: string
  note?: string
}

/** Escape a value for a vCard text field (RFC 6350 §3.4). */
function esc(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
}

/** Unescape a vCard text field value. */
function unesc(v: string): string {
  return v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\')
}

/** Build a vCard 3.0 string from a contact. */
export function toVCard(c: ContactFields): string {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0']
  lines.push(`FN:${esc(c.name || 'contact')}`)
  // N is required by 3.0 — derive a rough family/given split from FN.
  const parts = (c.name || '').trim().split(/\s+/)
  const given = parts.shift() ?? ''
  const family = parts.join(' ')
  lines.push(`N:${esc(family)};${esc(given)};;;`)
  if (c.organization) lines.push(`ORG:${esc(c.organization)}`)
  if (c.title) lines.push(`TITLE:${esc(c.title)}`)
  if (c.phone) lines.push(`TEL;TYPE=CELL:${esc(c.phone)}`)
  if (c.email) lines.push(`EMAIL;TYPE=INTERNET:${esc(c.email)}`)
  if (c.website) lines.push(`URL:${esc(c.website)}`)
  if (c.address) lines.push(`ADR;TYPE=HOME:;;${esc(c.address)};;;;`)
  if (c.note) lines.push(`NOTE:${esc(c.note)}`)
  lines.push('END:VCARD')
  return lines.join('\r\n')
}

/** Parse the first VCARD in a .vcf text into contact fields. Best-effort —
 *  unknown lines are ignored; returns null if no FN/N found. */
export function fromVCard(text: string): ContactFields | null {
  // Unfold continued lines (a leading space/tab continues the previous line).
  const unfolded = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '')
  const lines = unfolded.split(/\r\n|\n|\r/)
  const out: ContactFields = { name: '' }
  let nFallback = ''
  for (const raw of lines) {
    const idx = raw.indexOf(':')
    if (idx < 0) continue
    const head = raw.slice(0, idx)
    const value = unesc(raw.slice(idx + 1).trim())
    const prop = head.split(';')[0].toUpperCase()
    if (!value) continue
    switch (prop) {
      case 'FN': out.name = value; break
      case 'N': {
        // family;given;additional;prefix;suffix → "given family"
        const [family = '', given = ''] = value.split(';')
        nFallback = [given, family].filter(Boolean).join(' ').trim()
        break
      }
      case 'ORG': out.organization = value.split(';')[0]; break
      case 'TITLE': out.title = value; break
      case 'TEL': if (!out.phone) out.phone = value; break
      case 'EMAIL': if (!out.email) out.email = value; break
      case 'URL': if (!out.website) out.website = value; break
      case 'ADR': {
        // PO;ext;street;locality;region;postal;country
        if (!out.address) out.address = value.split(';').filter(Boolean).join(', ')
        break
      }
      case 'NOTE': out.note = value; break
      default: break
    }
  }
  if (!out.name) out.name = nFallback
  return out.name ? out : null
}

/** Trigger a browser download of a .vcf for the given contact. */
export function downloadVCard(c: ContactFields): void {
  const blob = new Blob([toVCard(c)], { type: 'text/vcard;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(c.name || 'contact').replace(/[^\w.-]+/g, '_')}.vcf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
