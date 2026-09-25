// setup/arrival-trial.ts
//
// TRY AN ARRIVAL BEFORE PUBLISHING IT. The Publish window's Optimize section
// opens a published site as `…/?arrival=ViewBee,WebsiteQueenBee,…`: this one
// visit arrives on those bees instead of the publisher's signed plan, and says
// in a corner what it saw — how long until the page was on screen, how many
// modules came before it, which named bees the package does not carry, errors,
// and what woke on the approach into the hive. Nothing is published; the next
// reader gets the signed plan as before.

type BusLike = { on: (effect: string, handler: (payload: any) => void) => unknown }
type I18nLike = { t: (key: string, params?: Record<string, string | number>) => string }

const NAME_RE = /^(@[^\s/]+\/)?[A-Za-z][A-Za-z0-9]*$/
const MODULE_RE = /\/[0-9a-f]{64}$/
const STUCK_MS = 20_000

let errors = 0

/** The trial this visit carries: bees by class or IoC key, or null. Read
 *  before the boot graph; it also starts counting what the badge reports. */
export const readArrivalTrial = (): string[] | null => {
  const raw = new URLSearchParams(location.search).get('arrival')
  if (raw === null) return null
  const names = [...new Set(raw.split(/[\s,]+/).filter(name => NAME_RE.test(name)))].slice(0, 64)
  if (!names.length) return null
  // Every module is a resource entry; the default buffer holds 250.
  performance.setResourceTimingBufferSize?.(5000)
  window.addEventListener('error', () => { errors++ })
  window.addEventListener('unhandledrejection', () => { errors++ })
  return names
}

const modulesSoFar = (): number => performance.getEntriesByType('resource')
  .filter(entry => { try { return MODULE_RE.test(new URL(entry.name).pathname) } catch { return false } }).length

const seconds = (ms: number): string => (ms / 1000).toFixed(1)

/** Show what the trial arrival came to, and keep it current. */
export const startArrivalTrial = (bus: BusLike, names: readonly string[]): void => {
  const t = (key: string, fallback: string, params: Record<string, string | number> = {}): string => {
    const i18n = (window as { ioc?: { get?: (key: string) => unknown } }).ioc?.get?.('@hypercomb.social/I18n') as I18nLike | undefined
    const said = i18n?.t?.(`arrival-trial.${key}`, params)
    return said && said !== `arrival-trial.${key}`
      ? said
      : fallback.replace(/\{(\w+)\}/g, (_, token) => String(params[token] ?? `{${token}}`))
  }

  const state: {
    plan: { now: number; passive: number; missing: string[] } | null
    arrived: { ms: number; modules: number } | null
    stuck: boolean
    approach: { ms: number; modules: number } | null
  } = { plan: null, arrived: null, stuck: false, approach: null }

  const badge = document.createElement('aside')
  badge.setAttribute('role', 'status')
  badge.setAttribute('aria-live', 'polite')
  badge.style.cssText = [
    'position:fixed', 'left:12px', 'bottom:12px', 'z-index:2147483647',
    'max-width:min(360px, calc(100vw - 24px))', 'box-sizing:border-box',
    'font:12px/1.45 system-ui, sans-serif',
    'color:var(--hc-panel-text, #eef0f4)', 'background:var(--hc-panel-bg, rgba(14, 16, 22, 0.92))',
    'border:1px solid rgba(255, 255, 255, 0.18)', 'border-radius:4px', 'padding:8px 28px 8px 10px',
  ].join(';')
  const body = document.createElement('div')
  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = '✕'
  close.setAttribute('aria-label', t('close', 'Close'))
  close.style.cssText = 'position:absolute;top:4px;right:4px;background:none;border:none;color:inherit;cursor:pointer;font:inherit;padding:2px 6px'
  close.addEventListener('click', () => badge.remove())
  badge.append(body, close)

  const line = (text: string, strong = false): HTMLDivElement => {
    const row = document.createElement('div')
    row.textContent = text
    if (strong) row.style.fontWeight = '600'
    return row
  }

  const render = (): void => {
    const rows: HTMLDivElement[] = [line(t('title', 'Trying an arrival — not published'), true)]
    rows.push(line(names.join(' ')))
    if (state.plan?.missing.length) rows.push(line(t('missing', 'Not in the package: {names}', { names: state.plan.missing.join(', ') }), true))
    if (state.plan && state.plan.now === 0) rows.push(line(t('whole', 'None of these bees is in the package, so the whole package loaded.')))
    else if (state.plan) rows.push(line(t('plan', '{now} bees now, {passive} wait for the approach', { now: state.plan.now, passive: state.plan.passive })))
    if (state.arrived) rows.push(line(t('arrived', 'Page on screen in {seconds} s · {modules} modules', { seconds: seconds(state.arrived.ms), modules: state.arrived.modules })))
    else if (state.stuck) rows.push(line(t('stuck', 'No page after {seconds} s — this plan is likely missing a bee the page needs.', { seconds: seconds(STUCK_MS) }), true))
    else rows.push(line(t('waiting', 'Waiting for the page…')))
    if (state.approach) rows.push(line(t('approach', 'Hive woke in {seconds} s · {modules} modules', { seconds: seconds(state.approach.ms), modules: state.approach.modules })))
    if (errors) rows.push(line(t('errors', '{count} errors on this page', { count: errors }), true))
    rows.push(line(t('hint', 'Use the page as a reader would, then step into the hive. Readers still get your published arrival.')))
    body.replaceChildren(...rows)
  }

  const mount = (): void => { if (!badge.isConnected) document.body.append(badge); render() }
  if (document.body) mount()
  else document.addEventListener('DOMContentLoaded', mount, { once: true })

  bus.on('loader:arrival', (payload: { now?: number; passive?: number; missing?: string[] }) => {
    state.plan = {
      now: Number(payload?.now ?? 0),
      passive: Number(payload?.passive ?? 0),
      missing: Array.isArray(payload?.missing) ? payload.missing.map(String) : [],
    }
    render()
  })

  // The page is on screen when the takeover surface covers the hive; the
  // approach is that cover lifting again.
  let approachedAt = 0
  const watch = new MutationObserver(() => {
    const covered = document.body.classList.contains('hc-view-covered')
    if (covered && !state.arrived) {
      state.arrived = { ms: performance.now(), modules: modulesSoFar() }
      render()
    } else if (!covered && state.arrived && !approachedAt) {
      approachedAt = performance.now()
      // The rest wakes over a few seconds: report when modules stop arriving.
      let count = modulesSoFar()
      let changedAt = approachedAt
      const settle = setInterval(() => {
        const now = performance.now()
        const next = modulesSoFar()
        if (next !== count) { count = next; changedAt = now }
        if (now - changedAt < 1500 && now - approachedAt < 30_000) return
        clearInterval(settle)
        state.approach = { ms: changedAt - approachedAt, modules: count }
        render()
      }, 250)
    }
  })
  watch.observe(document.body ?? document.documentElement, { attributes: true, attributeFilter: ['class'], subtree: !document.body })
  setTimeout(() => { if (!state.arrived) { state.stuck = true; render() } }, STUCK_MS)
  // Errors arrive on their own time; keep the count honest.
  let shown = 0
  setInterval(() => { if (errors !== shown && badge.isConnected) { shown = errors; render() } }, 1000)
}
