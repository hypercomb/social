// hive-say-door.cjs — one sentence said at a door that has no command line.
//
// A try- door carries no interface, so neither of hive-say's other ways works
// there: a call from outside (`external:call`) waits for an Enter on a command
// line the door does not mount, and the participant's door (`command:submit`)
// is that command line. What a door does hear is the machine door
// (`command-line:remote-submit`, hypercomb-shared/ui/command-line/
// remote-door.headless.ts): a behaviour word, judged by core's admission gate
// against the grant that origin holds.
//
// THE DOOR'S OWN POLICY IS LEFT AS IT IS. A door's page may not dial this
// machine (its connect-src, documentation/module-sandbox.md "Door safety"),
// so the bridge broker is not how a sentence reaches it. The browser that
// hive-say drives is the carrier: this function is evaluated in the door's
// page, by the person who opened that browser.
//
// It is self-contained on purpose: Playwright sends its source to the page.

/** In the page: say one line through the machine door and wait for its
 *  outcome. Always settles: nobody listening, or no answer inside the
 *  deadline, is said as such. */
const sayAtDoor = ({ text, deadlineMs }) => new Promise(resolve => {
  const bus = globalThis.__hypercombEffectBus
  let heard = false
  let settled = false
  const settle = outcome => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    resolve(outcome)
  }
  const timer = setTimeout(
    () => settle({ kind: 'unknown', reason: 'the door did not answer in time' }),
    deadlineMs,
  )
  if (!bus) { settle({ kind: 'refused', reason: 'this page has no hive running in it' }); return }
  bus.emitTransient('command-line:remote-submit', { text, accept: () => { heard = true }, complete: settle })
  if (!heard) settle({ kind: 'refused', reason: 'nothing on this page hears a machine’s sentence: it mounts no command line and no door listener' })
})

module.exports = { sayAtDoor }
