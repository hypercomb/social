// sharing/keep-alive.queen.ts
//
// `keep-alive` — keep this hive in the swarm while you are away from the
// computer (jwize 2026-10-09: "a keep-swarm-alive beehavior that can toggle
// it so I can leave it as a host for some data and go away from my computer").
//
//   keep-alive        toggle
//   keep-alive on     keep this hive awake and in the swarm
//   keep-alive off    let the computer sleep as usual
//
// Being idle never drops a participant: no code watches for input, and the
// swarm beacon refreshes on its own timer. What drops one is the computer
// sleeping (the relay reaps the socket and others see you leave) and the
// browser freezing a tab it thinks nobody is using. So while it is on:
//
//   1. THE SCREEN WAKE LOCK — the operating system does not dim, lock or sleep
//      while this tab is showing. The browser releases the lock whenever the
//      tab is hidden, so it is asked for again the moment the tab shows.
//   2. A PULSE every 25 s — the beats that only run on the processor's pulse
//      (the meeting's 30 s availability, hive-meeting.drone.ts) keep running
//      with nobody touching the page.
//   3. REMEMBERED ON THIS DEVICE — a pool document (`swarm:keep-alive`), so a
//      reload or an update keeps it on. It is this machine's setting: it never
//      travels with content and no other device reads it.
//
// What it cannot do, and says so: keep a HIDDEN tab awake (leave the hive
// showing — a covering screensaver inside the hive is fine), or overrule a
// closed laptop lid.

import { EffectBus, QueenBee, hypercomb, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'

export const KEEP_ALIVE_POOL = 'swarm:keep-alive'
/** Under the meeting's 30 s availability, so it never lapses between pulses. */
export const KEEP_ALIVE_PULSE_MS = 25_000

type WakeLockSentinelLike = { released: boolean; release(): Promise<void> }
type WakeLockLike = { request(type: 'screen'): Promise<WakeLockSentinelLike> }
type StoreLike = {
  initialize?: () => Promise<void>
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
  openPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
  getPoolDoc?: (pool: FileSystemDirectoryHandle | undefined) => Promise<ArrayBuffer | null>
  putPoolDoc?: (pool: FileSystemDirectoryHandle, bytes: ArrayBuffer) => Promise<string | null>
}

const get = <T>(key: string): T | undefined => (window as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

const t = (key: string, fallback: string): string => get<I18nProvider>(I18N_IOC_KEY)?.t(key) ?? fallback

const wakeLock = (): WakeLockLike | undefined =>
  (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock

/** The keeper: one per tab, on or off. */
export class KeepAlive {
  #on = false
  #lock: WakeLockSentinelLike | null = null
  #pulse: ReturnType<typeof setInterval> | null = null

  get on(): boolean { return this.#on }
  /** Holding the screen awake right now (false while the tab is hidden). */
  get awake(): boolean { return !!this.#lock && !this.#lock.released }

  async start(): Promise<void> {
    if (this.#on) return
    this.#on = true
    document.addEventListener('visibilitychange', this.#visibility)
    this.#pulse = setInterval(() => { void new hypercomb().act() }, KEEP_ALIVE_PULSE_MS)
    await this.#hold()
    this.#announce()
  }

  async stop(): Promise<void> {
    if (!this.#on) return
    this.#on = false
    document.removeEventListener('visibilitychange', this.#visibility)
    if (this.#pulse) clearInterval(this.#pulse)
    this.#pulse = null
    const lock = this.#lock
    this.#lock = null
    await lock?.release().catch(() => {})
    this.#announce()
  }

  /** Ask for the screen lock while the tab shows; the browser drops it when hidden. */
  async #hold(): Promise<void> {
    if (!this.#on || document.visibilityState !== 'visible' || this.awake) return
    try { this.#lock = await wakeLock()?.request('screen') ?? null } catch { this.#lock = null }
    if (!this.#on) { await this.#lock?.release().catch(() => {}); this.#lock = null }
  }

  readonly #visibility = (): void => {
    if (document.visibilityState !== 'visible') return
    void this.#hold().then(() => this.#announce())
    // Back on screen after a stretch away: one pulse now, not at the next tick.
    void new hypercomb().act()
  }

  #announce(): void {
    EffectBus.emit('swarm:keep-alive', { on: this.#on, awake: this.awake })
  }
}

const keeper = new KeepAlive()

async function remembered(): Promise<boolean> {
  const store = get<StoreLike>('@hypercomb.social/Store')
  // The store is registered before its root is open; ask once it is. A read
  // never creates the pool: a hive that never kept alive grows no directory.
  await store?.initialize?.().catch(() => {})
  const pool = await store?.openPool?.(KEEP_ALIVE_POOL).catch(() => null)
  const bytes = pool ? await store?.getPoolDoc?.(pool).catch(() => null) : null
  if (!bytes) return false
  try { return (JSON.parse(new TextDecoder().decode(bytes)) as { on?: unknown }).on === true } catch { return false }
}

async function remember(on: boolean): Promise<void> {
  const store = get<StoreLike>('@hypercomb.social/Store')
  await store?.initialize?.().catch(() => {})
  const pool = await store?.getPool?.(KEEP_ALIVE_POOL).catch(() => null)
  if (!pool || !store?.putPoolDoc) return
  const bytes = new TextEncoder().encode(JSON.stringify({ on })).buffer as ArrayBuffer
  await store.putPoolDoc(pool, bytes).catch(() => null)
}

const say = (message: string, type: 'info' | 'error' = 'info'): void => {
  EffectBus.emit('activity:log', { message, icon: '☕' })
  EffectBus.emit('toast:show', { type, message })
}

export class KeepAliveQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'keep-alive'
  override description = 'Keep this hive awake and in the swarm while you are away'
  override descriptionKey = 'slash.keep-alive'
  override options = ['on', 'off']
  override examples = [
    { input: '/keep-alive', result: 'Turns keeping alive on, or off when it is on' },
    { input: '/keep-alive on', result: 'This computer stays awake and in the swarm while the hive is showing' },
    { input: '/keep-alive off', result: 'The computer sleeps as usual' },
  ]

  protected async execute(args: string): Promise<void> {
    const word = String(args ?? '').trim().toLowerCase()
    if (word && word !== 'on' && word !== 'off') {
      say(t('keep-alive.usage', 'keep-alive: say "keep-alive", "keep-alive on" or "keep-alive off"'), 'error')
      return
    }
    const want = word === 'on' ? true : word === 'off' ? false : !keeper.on
    if (want) await keeper.start()
    else await keeper.stop()
    await remember(want)
    if (!want) { say(t('keep-alive.off', 'Keep-alive is off — this computer sleeps as usual.')); return }
    // Three honest answers: holding the screen now; able to, once the hive
    // shows (a hidden tab cannot hold it); or this browser cannot at all.
    say(keeper.awake
      ? t('keep-alive.on', 'Keep-alive is on — this computer stays awake and in the swarm while the hive is showing.')
      : wakeLock() && document.visibilityState !== 'visible'
        ? t('keep-alive.on-hidden', 'Keep-alive is on — it holds the screen awake as soon as the hive is showing.')
        : t('keep-alive.on-no-lock', 'Keep-alive is on, but this browser cannot hold the screen awake — set the computer not to sleep.'))
  }
}

window.ioc.register('@diamondcoreprocessor.com/KeepAliveQueenBee', new KeepAliveQueenBee())
window.ioc.register('@diamondcoreprocessor.com/KeepAlive', keeper)

// A hive that was keeping alive keeps doing so after a reload or an update.
window.ioc.whenReady('@hypercomb.social/Store', () => {
  void remembered().then(on => { if (on) void keeper.start() })
})
