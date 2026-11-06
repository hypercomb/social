// mail-address.js — what counts as an address this host will name, and the pool it files under.
// Pure: no node imports, so the mail Worker bundles it as it is and mail-inbox.js shares it.

// A plain address: dot-separated atoms before the @ (no leading, trailing or doubled dot),
// a dotted hostname after it. No quotes, comments, spaces or routing.
const ATEXT = "[a-z0-9!#$%&'*+/=?^_`{|}~-]+"
const LABEL = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?'
const ADDRESS_RE = new RegExp(`^${ATEXT}(?:\\.${ATEXT})*@${LABEL}(?:\\.${LABEL})+$`)

/** A lowercase address, or null when it is not one this host will name. */
export function normalizeAddress(value) {
  const address = String(value ?? '').trim().toLowerCase()
  if (address.length > 254 || !ADDRESS_RE.test(address)) return null
  return address.indexOf('@') <= 64 ? address : null
}

/** The meaning an address's messages are filed under; the pool is the sha256 of this. */
export const poolMeaning = (address, folder = 'box') => (folder === 'sent' ? `mail-sent:${address}` : `mail:${address}`)
