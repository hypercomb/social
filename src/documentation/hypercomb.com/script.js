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
      announceCopy('SHA-256 copied')
    } catch {
      announceCopy('Could not copy automatically')
    }
  })
})
