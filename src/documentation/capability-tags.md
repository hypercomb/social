# Capability Tags — Seed Vocabulary

Companion to [`feature-tuning-garage.md`](feature-tuning-garage.md). This is the **seed vocabulary** for the optional `capability?: string` field on `Bee.base` and the `tag` field in a `feature:manifest`.

A capability tag exists **only to mark workers that genuinely compete for one slot**. If a bee does not contend with another bee for the same responsibility, **it must not carry a `capability` tag** — it runs unconditionally (run-all default). Tagging a co-operating cohort is a bug: it would put essential, complementary drones through one-winner selection.

> Do **not** confuse `capability` with `genotype`. `genotype` is a coarse subsystem-cohort label used for the cohort *visibility* toggle (`genotype:set-visible`); one `genotype` spans many co-operating drones (`sharing` = 9 drones). `capability` is fine-grained and competitive. They are orthogonal axes; a bee may carry both, one, or neither.

## Grammar

```
tag        := family ':' noun ( ':' qualifier )*
family     := lowercase word
noun       := lowercase word
qualifier  := lowercase word        # optional, for sub-variants
```

- All lowercase, `:`-separated, no spaces.
- The **family** is the bench accordion group ("part bin").
- The **noun** identifies the contested slot.
- Two providers with the **same full tag** compete; the resolver picks one (pin → lexically-lowest sig).

## Validation rule (decision 1)

At manifest-write time, validate each declared tag against this document:
- **Exact match** → accept.
- **Near-miss** (e.g. `file:dropbox` vs the listed `files:dropbox`, or an unknown family) → **warn**, write through unchanged. The warning is the dedup safety net; without it, `file:` and `files:` silently both run.
- New legitimate tags → add them here in the same PR that introduces the competing provider.

No runtime registry, no alias auto-rewrite (deferred — see open items in the design doc).

## Seed families and tags

These are the **candidate** contested slots. A tag belongs here only once a *second* competing provider is plausible. Mark each as `exclusive: true` in the manifest.

| Family | Tag | Contested slot |
|---|---|---|
| `render` | `render:tiles` | the primary tile/cell renderer (`ShowCellDrone`-class) |
| `render` | `render:background` | the substrate/background renderer |
| `input` | `input:pointer` | pointer/mouse driver |
| `input` | `input:touch` | multi-touch gesture driver |
| `input` | `input:keyboard` | keymap / shortcut owner |
| `nav` | `nav:zoom` | zoom arbiter (wheel/pinch) |
| `nav` | `nav:pan` | pan driver |
| `editor` | `editor:tile` | tile content editor |
| `editor` | `editor:image` | image manipulation editor |
| `clipboard` | `clipboard:core` | copy/cut/paste owner |
| `files` | `files:dropbox` | drop-target / attachment capability |
| `visual` | `visual:substrate` | substrate image fill |
| `visual` | `visual:screensaver` | idle screensaver |
| `assistant` | `assistant:bridge` | Claude bridge transport |

## Explicitly NOT tagged (run-all cohorts)

These subsystems are **co-operating**, not competing. They must remain untagged so every member runs. (They keep their `genotype` cohort label for visibility, which is a different mechanism.)

- **`sharing`** — swarm, nostr-mesh, content-broker, follow, mesh-adapter, avatar-swarm, ambient-presence, subscribe-consent, swarm-adopt (9 drones, all required).
- **`assistant`** orchestration drones beyond the single contested transport slot.
- **`meeting`** — meeting/queen drones (5, complementary).
- **`movement`** — move + layout.queen + move-preview (complementary).
- **`history`**, **`selection`**, **`format`** — single-owner subsystems with no competing alternative today.

If a second implementation of any of these ever appears and genuinely contends for one slot, introduce a fine-grained `capability` tag for *that specific slot only* — never tag the whole cohort.
