# El Mercado — the Revolución storefront

A store page at `/revolucion/store`, a currency called **Embers**, and five
props it sells into the 3D lounge. Embers are **earned, never bought**: there
is no payment rail in this feature and none is planned.

## The ledger is the truth

`rev:embers:ledger` is an append-only list of entries in `localStorage`:

```js
{ k: 'leg:3', d: 75, w: 'a leg off the Colonel', t: 1754300000000 }
{ k: 'buy:slot-cart', d: -180, w: 'The drinks cart', t: 1754300500000 }
```

Everything else is **derived**, the same way the hive derives a root from its
markers:

| Derived | How |
|---|---|
| balance | sum of every `d` |
| inventory | a `buy:<slot-id>` entry exists |
| "already earned?" | the claim key is already in the list |

`k` is the **claim key**, and it names the occasion — a moment's timestamp, a
leg number, the sorted flavor set of a tasting. A key already in the ledger
never pays twice, which is what makes the lounge safe to re-scan the
concierge's stored moments and reservations on every single page load.

Cross-tab coherence comes from the `storage` event; spend in one tab and the
purse in the other is looking at the same list. Nothing is sent anywhere.

## Earning

Every source is something you do in the lounge:

| Occasion | Embers | Claim key |
|---|---|---|
| Walking in (first visit) | 120 | `welcome` |
| A moment journaled through the concierge | 40 | `moment:<at>` |
| A leg taken off the Colonel at 501 | 75 | `leg:<n>` |
| Three flavors stacked on the wheel plate | 25 | `tasting:<sorted set>` |
| A reservation out of the humidor | 20 | `reserve:<at>` |

The 501 game dispatches `lounge3d:leg` on `window` (not the host element —
`buildRoom` never sees the mount) with `{ who, legs, house }`; the page pays
only when `house` is false.

## The catalogue drives everything

`scripts/lounge3d/store-items.ts` is the single list, read by three consumers:

- the **store page** — the shop window, built from `SALE_ITEMS`
- the **lounge Decorate list** — owned items toggle, unowned show their price
  and unlock in place if you can afford them
- **`lounge-3d.ts`** — imports `SLOT` so the catalogue's ids and the room's
  slot ids can never drift apart. A mistyped id would otherwise sell a slot no
  renderer knows about.

`HOUSE_ITEMS` (price 0) are the eighteen things the room came with; they are
listed for sale nowhere and toggle freely. A good is nothing more than a slot
the page keeps dark until the ledger says it is yours — buying a thing and
switching a thing on are one mechanism, not two.

## The props

| Slot | Good | Price | Where |
|---|---|---|---|
| `slot-cart` | The drinks cart | 180 | left of the wingbacks |
| `slot-chess` | The chess table | 160 | by the shelves, back left |
| `slot-globe` | The globe bar | 200 | under the night window |
| `slot-victrola` | The victrola | 240 | back right, beside the band wall |
| `slot-bands` | The band wall | 140 | back wall, right of the chimney |

Each has a camera preset of the same name (minus `slot-`), and switching one
on **walks you in and looks at it** — a purchase that lands off-camera may as
well not have happened. Two placement lessons are baked into the positions:
props must sit inside the arc the presets actually frame, and a hemisphere
lid swung wide (the globe) reads as a crescent floating free of its object —
hinge it at the rim and open it a little.

## Where the code is

| File | What |
|---|---|
| `scripts/lounge3d/store-items.ts` | catalogue, earn rules, `EMBERS_JS` ledger runtime |
| `scripts/lounge3d/lounge-3d.ts` | the five props, their camera presets, `lounge3d:leg` |
| `scripts/intel-build-revolucion-site.ts` | the store page, the nav purse chip, the inventory-gated Decorate list, the earning hooks |

The ledger runtime is injected **before** the page body, not as a tail script:
the lounge's Decorate list reads `window.RevEmbers` while it parses.
