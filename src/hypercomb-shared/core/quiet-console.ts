// hypercomb-shared/core/quiet-console.ts
//
// A PRODUCTION CONSOLE SAYS ALMOST NOTHING.
//
// Every shell, bee and dependency shares one `console`, and between them they
// narrate boot, navigation, replication, every effect and every idle pump —
// thousands of lines on hypercomb.io per session. That trail is for whoever
// is developing, and it is worth nothing to a participant reading the console
// to find out why something failed: the one line that matters is buried.
//
// So the FIRST module a shell evaluates decides, once, whether this origin is
// quiet. Quiet means `console.log`, `console.info` and `console.debug` are
// no-ops; `console.warn` and `console.error` always print — the break-repair
// loop reads errors, and a warning is a fact the participant may need.
//
// Verbose again, on any origin: `localStorage['hc:verbose'] = '1'` and reload.
// A loopback origin (the dev servers, `*.localhost` sandbox doors) is always
// verbose — that is where the trail is read.
//
// `announce` prints regardless: the one or two lines a production boot may
// say (that it is ready, and how long that took).

const VERBOSE_KEY = 'hc:verbose'

const isLoopback = (host: string): boolean =>
  /^((?:[a-z0-9-]+\.)*localhost|127(?:\.\d+){3}|\[::1\])$/i.test(host)

const wantsVerbose = (): boolean => {
  try {
    const flag = globalThis.localStorage?.getItem(VERBOSE_KEY)
    return flag === '1' || flag === 'true'
  } catch { return false }
}

const origin = typeof location === 'undefined' ? '' : location.hostname

/** True when this origin's console has been quieted. */
export const consoleIsQuiet: boolean = !isLoopback(origin) && !wantsVerbose()

const loud = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  debug: console.debug.bind(console),
}

/** Print even on a quiet origin. For the lines a participant should see. */
export const announce = (...args: unknown[]): void => { loud.info(...args) }

if (consoleIsQuiet) {
  const silent = (): void => {}
  console.log = silent
  console.info = silent
  console.debug = silent
}
