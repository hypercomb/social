const year = document.querySelector('#year')
if (year) year.textContent = new Date().getFullYear()

const menuButton = document.querySelector('.menu-button')
const siteNav = document.querySelector('#site-nav')

menuButton?.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true'
  menuButton.setAttribute('aria-expanded', String(open))
  menuButton.querySelector('.sr-only').textContent = open ? 'Close navigation' : 'Open navigation'
  siteNav?.classList.toggle('is-open', open)
})

siteNav?.addEventListener('click', event => {
  if (!(event.target instanceof HTMLAnchorElement)) return
  menuButton?.setAttribute('aria-expanded', 'false')
  siteNav.classList.remove('is-open')
})

const announceCopy = message => {
  document.querySelector('.copy-status')?.remove()
  const status = document.createElement('div')
  status.className = 'copy-status'
  status.setAttribute('role', 'status')
  status.textContent = message
  document.body.append(status)
  window.setTimeout(() => status.remove(), 1800)
}

document.querySelectorAll('[data-copy]').forEach(button => {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy)
      announceCopy(button.dataset.copied ?? 'SHA-256 copied')
    } catch {
      announceCopy('Could not copy automatically')
    }
  })
})

// ── The Windows installer, read from a pool of meaning ─────────────────────
//
// The row names a meaning and the hosts that may hold it. The pool's address
// is sign(meaning); its highest entry is the newest build. The entry names a
// RECORD; the record names the PARTS and the signature of the whole file.
// Every byte is checked against its own signature before it is kept, so the
// file is trusted for what it is, never for where it came from
// (documentation/windows-installer-pool.md). No pool, no answer, or one bad
// byte: the row stays as the page wrote it.

const hex = buffer => Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('')
const sha256 = async bytes => hex(await crypto.subtle.digest('SHA-256', bytes))

const fetchVerified = async (host, sig) => {
  const response = await fetch(`${host}/${sig}`)
  if (!response.ok) throw new Error(`${sig.slice(0, 8)} not held`)
  const bytes = await response.arrayBuffer()
  if (await sha256(bytes) !== sig) throw new Error(`${sig.slice(0, 8)} failed its signature`)
  return bytes
}

const readInstaller = async (meaning, host) => {
  const pool = await sha256(new TextEncoder().encode(meaning))
  const listing = await fetch(`${host}/${pool}/`, { cache: 'no-store' })
  if (!listing.ok) return null
  const text = await listing.text()
  if (text.includes('<')) return null
  const head = text.split('\n').filter(name => /^[0-9]{8}$/.test(name)).sort().at(-1)
  if (!head) return null
  const member = await fetch(`${host}/${pool}/${head}`, { cache: 'no-store' })
  if (!member.ok) return null
  const [recordSig] = (await member.text()).split('\n')
  if (!/^[0-9a-f]{64}$/.test(recordSig)) return null
  const record = JSON.parse(new TextDecoder().decode(await fetchVerified(host, recordSig)))
  const valid = record?.kind === 'hypercomb:windows@1'
    && /^[0-9a-f]{64}$/.test(record.sig)
    && Array.isArray(record.parts) && record.parts.length > 0
    && record.parts.every(part => /^[0-9a-f]{64}$/.test(part))
    && Number.isSafeInteger(record.size) && record.size > 0
  if (!valid) return null
  const date = member.headers.get('last-modified')
  return { host, record, date: date ? new Date(date) : null }
}

const offerInstaller = (row, { host, record, date }) => {
  const file = String(record.file || 'Hypercomb-setup.exe').replace(/[^\w.\-]+/g, '_')
  const megabytes = (record.size / 1048576).toFixed(1)
  const status = row.querySelector('.status')
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'get'
  button.textContent = `Download · ${megabytes} MB`
  status.replaceWith(button)

  row.querySelector('small').textContent = [
    'Preview build · setup executable',
    date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString(undefined, { dateStyle: 'medium' }) : null,
  ].filter(Boolean).join(' · ')

  const note = document.createElement('div')
  note.className = 'installer-note'
  note.innerHTML = '<p>This preview is not code-signed yet. Windows SmartScreen will warn: choose <strong>More info</strong>, then <strong>Run anyway</strong>. A PC with Smart App Control turned on will refuse it until it is signed.</p>'
    + '<details><summary>Verify file</summary><div class="checksum"><code></code><button type="button">Copy SHA-256</button></div></details>'
  note.querySelector('code').textContent = record.sig.toUpperCase()
  const copy = note.querySelector('.checksum button')
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(record.sig.toUpperCase())
      announceCopy('SHA-256 copied')
    } catch {
      announceCopy('Could not copy automatically')
    }
  })
  row.append(note)

  button.addEventListener('click', async () => {
    button.disabled = true
    try {
      const parts = []
      for (const [index, sig] of record.parts.entries()) {
        button.textContent = `Downloading ${Math.round((index / record.parts.length) * 100)}%`
        parts.push(await fetchVerified(host, sig))
      }
      button.textContent = 'Checking…'
      const blob = new Blob(parts, { type: 'application/vnd.microsoft.portable-executable' })
      if (blob.size !== record.size || await sha256(await blob.arrayBuffer()) !== record.sig) {
        throw new Error('the assembled file failed its signature')
      }
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = file
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(link.href), 60_000)
      button.textContent = `Download · ${megabytes} MB`
    } catch (error) {
      announceCopy(`Download stopped: ${error.message}`)
      button.textContent = 'Try again'
    } finally {
      button.disabled = false
    }
  })
}

document.querySelectorAll('[data-installer-pool]').forEach(async row => {
  const hosts = [location.origin, ...(row.dataset.installerHosts ?? '').split(/\s+/)]
    .filter(host => /^https?:\/\/[^/]+$/.test(host))
  for (const host of new Set(hosts)) {
    try {
      const found = await readInstaller(row.dataset.installerPool, host)
      if (found) { offerInstaller(row, found); return }
    } catch { /* the next host, or the row as written */ }
  }
})
