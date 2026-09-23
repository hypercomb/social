# The production console

*2026-09-23. jwize, reading hypercomb.io's console: "we cannot have these in
production… we are getting thousands of messages."*

A shell, its bees and its dependencies share one `console`, and between them
they narrate everything. That trail is for whoever is developing; on a public
origin it buries the one line a participant needs.

## What a quiet origin says

`hypercomb-shared/core/quiet-console.ts` is the FIRST module both shells
evaluate. On any origin that is not loopback it makes `console.log`,
`console.info` and `console.debug` no-ops. `console.warn` and `console.error`
always print — the break-repair loop reads errors, and a warning is a fact.

The boot trail still records every mark in `window.__hcBootMarks`; the console
gets one line, at first paint: `[hypercomb] ready +Nms`.

## Turning the trail back on

```
localStorage['hc:verbose'] = '1'
```

and reload. Remove the key to go quiet again. Loopback origins (the dev
servers, `*.localhost` sandbox doors) are always verbose.

## The requests that were the other half of the noise

Two client fan-outs produced the 404 wall the console gate does not touch,
because a failed request is logged by the browser, not by code:

- **Warm-ups never leave the machine.** `Store.preheatResource` is now
  memory → OPFS only. The tile-picture warm-up reads the legacy tile-props
  index, which still names resources that exist nowhere; each one used to fan
  out to every carried host, three URL shapes each. A consumer that needs the
  bytes reads on demand through `getResource`, which still falls back to hosts.
- **Atoms come from the base that answered.** `hostBases(zone)` returns only
  the base the pool probe settled for that zone (remembered in
  `hc:host-base:<zone>`), instead of all four faces. The probe itself still
  walks every base, settled-first, so a host whose layout moved is found again.
