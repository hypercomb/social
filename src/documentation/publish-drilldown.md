# The Publish window is a drilldown

jwize, 2026-11-04. The window answers one question — *what is switched on where* — and
nothing else.

```
Publish / <the tile you are on>                          ×
[ search domains and apps                              ]
[ Publish changes (3)                                  ]

DOMAINS                         (about two thirds)
  language  hypercomb.com        2 apps published here   ›
  language  jwize.com            2 apps published here   ›
  language  revolucionstyle.com  3 apps published here   ›

GROUPS                          (the shorter list below)
  folder    Cigar sites          2 domains               ›
  folder    Everything           3 domains               ›
```

## Going in

- **Press a domain** and you are in it: its creations, each a switch.
- **Press a group** and you are in the set of domains it holds.
- **Hold Ctrl (⌘), click several domains, let go** — the creations open for all of them
  together, right then. Release is the "open": there is no second button. Escape drops the
  held domains first.

## Inside

A creation is a switch across the domains the drilldown covers:

| state | meaning | a press |
|---|---|---|
| on | live on every domain of the set | turns it off everywhere |
| off | live on none | turns it on everywhere |
| mixed | live on some | syncs it **on** — and the row offers **Sync on / Sync off** |

One creation across a set is **one** signed index rewrite (`publish:doors`), and only the
domains that have to move are named — never a door per domain, which would find the row
busy after the first and refuse the rest. A row switched off stays listed (dimmed) until
the window closes, or it could not be switched back.

## The one input

Always at the top. It searches whatever list is showing (domains and groups by name; creations
by path). After **Save as group** — offered on a set of two or more domains that is not
already a group — it takes the group's name, with an **Add group** button (or Enter).

## Named groups

A group is a saved set of domains: a name and the zones it holds, kept as **one current
document** in the `community:host-groups` pool (declared a `document` beside
`community:hosts` in `pool-registry.ts` / `pool-kinds.ts`). The hosts drone is its one
writer (`hosts:group-save`, `hosts:group-remove`) and renders it on `hosts:render`; the
panel only reads that and names the acts. Saving under a name already held replaces that
group (the same name however it was spelled); removing a group leaves every host, and
everything published to them, as it was. No branch holds a group — what a branch publishes
to is still the `host:<zone>` marks it wears.

## Publish changes

At the top, always. It publishes every creation on the showing list that has moved on from
what the world is served (`drift`, `gone`) — inside a drilldown, those live on the
domains it covers — one after another, deepest first (`publish:run-many`). While a sweep is
still reading it says *checking*, never *nothing to publish*.

## What the window no longer holds

Tabs, the index line, re-check, manage hosts, per-domain own addresses, entrances, versions
and their hide/delete area, optimize, status, opens-as, promote, forget, the creation
groups shelf and the selection tray. The drone still answers those intents for the words
that send them; the window just has no buttons for them. The only loud thing left is the
"this host is serving an index that is not yours" banner.

Source: `hypercomb-shared/ui/publish-panel/` (pure answers in `publish-apps.ts`),
`hypercomb-essentials/src/sharing/{community-hosts,hosts.drone,publish-status.drone}.ts`.
