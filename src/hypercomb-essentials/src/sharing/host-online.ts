// sharing/host-online.ts
//
// HOST YOUR HIVE FROM THIS COMPUTER — the walkthrough (jwize 2026-10-18:
// "make everything automated because we want to be able to walk people
// through how it's done so they can do it themselves easily";
// documentation/becoming-a-host.md, the "This computer" path).
//
// Three steps in the hosts window, each saying what it needs, doing it, and
// saying what happened — never a terminal command:
//
//   1. TRY IT NOW      the app starts serving, fetches Cloudflare's tunnel
//                      program, and the hive answers at a temporary
//                      `https://<words>.trycloudflare.com` address
//   2. YOUR DOMAIN     type it; the browser opens to sign in to Cloudflare,
//                      and the app creates the tunnel and points the domain
//   3. CHECK IT        the page you stand on is served there (`serve at`),
//                      and the address is fetched to prove it opens it
//
// The desktop app does the work (hypercomb-client tunnel.rs) and asks in a
// native dialog before anything goes online — the page cannot answer for
// the person. On the web there is no machine to serve from, so this block
// is not drawn.

import { EffectBus } from '@hypercomb/core'

type NativeInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

export type TunnelState = { kind: 'quick' | 'named'; host: string }
type Status = { serving?: string | null; tunnel?: TunnelState | null }

type Helpers = {
  t: (key: string, fallback: string, params?: Record<string, string | number>) => string
  make: <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K]
  button: (className: string, text: string, label?: string) => HTMLButtonElement
  /** Draw the block again (the hosts window's own repaint). */
  repaint: () => void
}

const nativeInvoke = (): NativeInvoke | null => {
  const invoke = (globalThis as { __TAURI__?: { core?: { invoke?: NativeInvoke } } }).__TAURI__?.core?.invoke
  return typeof invoke === 'function' ? invoke : null
}

/** Is this the desktop app — a machine that can serve? */
export const canHostHere = (): boolean => nativeInvoke() !== null

type Ioc = { get?: (key: string) => unknown }
const SERVE_KEY = '@diamondcoreprocessor.com/ServeQueenBee'

/** Say `serve at <host>` — the same act a person types: the page you stand
 *  on, sealed, becomes what that hostname opens. */
const serveHere = async (host: string): Promise<void> => {
  const queen = (globalThis as { ioc?: Ioc }).ioc?.get?.(SERVE_KEY) as { invoke?: (args: string) => Promise<void> } | undefined
  await queen?.invoke?.(`at ${host}`)
}

/** CHECK IT — fetch the address the way a visitor does, and see that it
 *  carries the door to a page. True when it does. */
export const opensAPage = async (host: string, fetcher: typeof fetch = fetch): Promise<boolean> => {
  try {
    const response = await fetcher(`https://${host}/`, { cache: 'no-store' })
    if (!response.ok) return false
    return (await response.text()).includes('id="hc-door"')
  } catch { return false }
}

/** What this block remembers between paints. */
const state: {
  status: Status | null
  busy: '' | 'try' | 'domain' | 'stop'
  said: string
  checked: { host: string; ok: boolean } | null
} = { status: null, busy: '', said: '', checked: null }

const refresh = async (repaint: () => void): Promise<void> => {
  const invoke = nativeInvoke()
  if (!invoke) return
  try { state.status = await invoke('tunnel_status') as Status } catch { state.status = null }
  repaint()
}

const bringOnline = async (
  helpers: Helpers, command: 'tunnel_try' | 'tunnel_domain', args?: Record<string, unknown>,
): Promise<void> => {
  const invoke = nativeInvoke()
  if (!invoke) return
  const { t, repaint } = helpers
  state.busy = command === 'tunnel_try' ? 'try' : 'domain'
  state.said = command === 'tunnel_try'
    ? t('host-online.trying', 'Putting your hive online — the first time, this downloads Cloudflare\'s tunnel program…')
    : t('host-online.signing-in', 'Your browser opens to sign in to Cloudflare. Pick the account your domain is in, then come back here…')
  state.checked = null
  repaint()
  try {
    const online = await invoke(command, args) as TunnelState
    state.said = t('host-online.serving-page', 'Online at {host}. Serving the page you are on there…', { host: online.host })
    repaint()
    await serveHere(online.host)
    const ok = await opensAPage(online.host)
    state.checked = { host: online.host, ok }
    state.said = ok
      ? t('host-online.checked', '{host} opens your page. Anyone can visit it now.', { host: online.host })
      : t('host-online.not-yet', '{host} does not open your page yet — a new domain can take a few minutes to answer. Check again soon.', { host: online.host })
    EffectBus.emit('activity:log', { message: state.said, icon: '⌂' })
  } catch (error) {
    const why = String((error as { message?: string })?.message ?? error)
    state.said = why === 'cancelled' ? '' : why
  } finally {
    state.busy = ''
    await refresh(repaint)
  }
}

/** THE BLOCK — drawn at the foot of the hosts window, on the desktop only. */
export const hostOnlineBlock = (helpers: Helpers): HTMLElement | null => {
  if (!canHostHere()) return null
  const { t, make, button, repaint } = helpers
  if (state.status === null && !state.busy) void refresh(repaint)

  const block = make('section', 'hd-online')
  block.append(
    make('h3', 'hd-online-title', t('host-online.title', 'Host your hive from this computer')),
    make('p', 'hd-note', t('host-online.lead',
      'Your hive is served from this computer while the app is open — free, through Cloudflare\'s tunnel. Try it in seconds, then give it your own domain.')),
  )

  const online = state.status?.tunnel ?? null
  if (online) {
    const line = make('p', 'hd-online-live')
    const link = make('a', 'hd-online-link', `https://${online.host}`)
    link.href = `https://${online.host}`
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    line.append(make('span', '', t('host-online.live', 'Online at ')), link)
    if (online.kind === 'quick') line.append(make('span', 'hd-note', t('host-online.temporary', ' — a temporary address')))
    block.append(line)
    const actions = make('div', 'hd-online-actions')
    const check = button('hd-quiet', t('host-online.check', 'Check it'))
    check.disabled = !!state.busy
    check.addEventListener('click', async () => {
      state.busy = 'try'
      repaint()
      const ok = await opensAPage(online.host)
      state.checked = { host: online.host, ok }
      state.said = ok
        ? t('host-online.checked', '{host} opens your page. Anyone can visit it now.', { host: online.host })
        : t('host-online.not-yet', '{host} does not open your page yet — a new domain can take a few minutes to answer. Check again soon.', { host: online.host })
      state.busy = ''
      repaint()
    })
    const serve = button('hd-quiet', t('host-online.serve-this', 'Serve this page there'))
    serve.disabled = !!state.busy
    serve.addEventListener('click', async () => { await serveHere(online.host); state.checked = null; repaint() })
    const stop = button('hd-quiet', t('host-online.stop', 'Take it offline'))
    stop.disabled = !!state.busy
    stop.addEventListener('click', async () => {
      state.busy = 'stop'
      repaint()
      try { await nativeInvoke()?.('tunnel_stop') } catch { /* already down */ }
      state.busy = ''
      state.said = t('host-online.offline', 'Your hive is off the internet. This computer still serves your own network until you stop serving.')
      await refresh(repaint)
    })
    actions.append(check, serve, stop)
    block.append(actions)
  } else {
    const steps = make('ol', 'hd-online-steps')
    const first = make('li', '')
    const tryIt = button('hd-quiet', state.busy === 'try' ? t('host-online.trying-short', 'Going online…') : t('host-online.try', 'Try it now'))
    tryIt.disabled = !!state.busy
    tryIt.addEventListener('click', () => void bringOnline(helpers, 'tunnel_try'))
    first.append(tryIt, make('span', 'hd-note', t('host-online.try-what', ' a temporary address, no account')))

    const second = make('li', '')
    const form = make('form', 'hd-add')
    const field = make('input', 'hd-add-input')
    field.type = 'text'
    field.autocomplete = 'off'
    field.spellcheck = false
    field.placeholder = t('host-online.domain-placeholder', 'your domain, e.g. example.org')
    field.setAttribute('aria-label', t('host-online.domain', 'Your domain'))
    const go = make('button', 'hd-quiet', state.busy === 'domain' ? t('host-online.trying-short', 'Going online…') : t('host-online.use-domain', 'Use my domain'))
    go.type = 'submit'
    go.disabled = !!state.busy
    form.append(field, go)
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const domain = field.value.trim()
      if (!domain) { field.setAttribute('aria-invalid', 'true'); field.focus(); return }
      void bringOnline(helpers, 'tunnel_domain', { domain })
    })
    second.append(form, make('p', 'hd-note', t('host-online.domain-what',
      'Needs a free Cloudflare account with your domain in it. Your browser opens to sign in; the app does the rest.')))
    steps.append(first, second)
    block.append(steps)
  }
  if (state.said) block.append(make('p', `hd-note hd-online-said${state.checked?.ok ? ' ok' : ''}`, state.said))
  return block
}

/** Forget what the block remembered — tests, and a window torn down. */
export const resetHostOnline = (): void => {
  state.status = null
  state.busy = ''
  state.said = ''
  state.checked = null
}
