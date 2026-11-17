# The Staging window: stage in a domain, publish in your community

jwize, 2026-11-04 (the drilldown), reshaped 2026-11-16: "You should have your own domain and the
community separate since you are feeding the community from all domains including yourself. Then there
are only on off no selected … This makes only two things you can do in the app here. Add to community
through domains and publish live. You stage and then publish in community. And you stage from the
hypercomb.io or your host. So locally the publishing should now be called staging."

```
Staging / <the tile you are on>                          ×
[ search domains and apps                              ]
[ Stage changes (3)                                    ]

  diversity_3  Your community · jwize.com   2 live · 3 staged   ›

DOMAINS
  home      jwize.com  YOURS     2 apps staged here      ›
  language  hypercomb.com        2 apps staged here      ›
  language  revolucionstyle.com  3 apps staged here      ›
```

## Two acts

- **Stage, in a domain.** Press a domain (yours first, then every host you carry) and its creations are
  switches, **on or off** and nothing else. On stages the creation on that domain — sealed, uploaded,
  its door opened, one signed index rewrite (`publish:doors` with that one zone). Off takes it off. A
  row switched off stays listed (dimmed) until the window closes, or it could not be switched back.
- **Publish, in your community.** Your community is apart, at the top, on your own domain (the public
  host you named). Everything on in any domain stands in it: **gray** while it is only staged, **lit**
  once it is live in the owners' signed `showcase:<zone>`. A press on a gray one publishes it live
  (your own creation is optimized first); a press on a lit one takes it out. **Both ways (jwize
  2026-11-16: "any bound items turn off on the domains … are bidirectional"):** one of your own taken out of
  the community is switched off on every domain it is on (one door rewrite), and a creation switched off on
  the last domain it was on comes out of the community too; another publisher's version only leaves the
  showcase. A name with several versions opens to them, and a press picks the one; any other live
  version of that name comes out in the same write (`publish:community`, `sharing/community-switch.ts`).

Nothing is selected: there are no groups, no Ctrl-held domains, no mixed state and no Sync in this
window (the groups stay in the hosts drone, `community:host-groups`, unused here). What feeds the
community and how it stays in step with the front door is in `showcase.md`, "The hive's Staging window".

## The one input

Always at the top. It searches whatever list is showing: domains by name, creations by path, the
community by name or by a domain a version is on.

## Stage changes

At the top, always. It stages again every creation on the showing list that has moved on from what
its domains serve (`drift`, `gone`) — inside a domain, those on there — one after another, deepest
first (`publish:run-many`). While a sweep is still reading it says *checking*, never *nothing to
stage*.

## Verified passively (jwize 2026-11-16)

The window never waits for the network before it shows. The drone reads the list while
nobody is looking: once after load, and again in the optimize phase whenever a commit, a
walk or a host change has made it stale (at most once every two minutes while the window is
closed). Opening paints that reading at once and looks again behind it only when a look is
owed — not over a look still running, and not over one under thirty seconds old with
nothing changed since.

A row keeps the verdict the last look proved — unlocked, its word shown — while the index
names the same head, until the new look reaches it. Only a new head, or a row never seen,
waits as *comparing*; such a row first shows the verdict an earlier session left on disk
for that head (`writeObservation`), when there is one. Rows are updated in place, so a
publish in progress keeps painting into the row on screen.

Closing or parking the window stops nothing: a look already running finishes, a look
already owed still runs, a publish goes on to its end, and the list keeps following the
hive, so the window comes back showing what is true now.

## What the window no longer holds

Tabs, the index line, re-check, manage hosts, per-domain own addresses, entrances, versions
and their hide/delete area, optimize, status, opens-as, promote, forget, the creation
groups shelf, the selection tray and, since 2026-11-16, the named domain groups, Ctrl-selection and Sync. The drone still answers those intents for the words
that send them; the window just has no buttons for them. The only loud thing left is the
"this host is serving an index that is not yours" banner.

Source: `hypercomb-shared/ui/publish-panel/` (pure answers in `publish-apps.ts`),
`hypercomb-essentials/src/sharing/{community-hosts,community-switch,publish-status.drone}.ts`.
