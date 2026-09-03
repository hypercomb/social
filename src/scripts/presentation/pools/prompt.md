# PROMPT — "Pools of Meaning": an interactive 90-second animation

Paste everything below this line into a fresh session (any model). It is
self-contained. Doctrine it dramatizes: `documentation/hypergraph-molecule-lineage.md`.

---

Build **`scripts/presentation/pools/hypercomb-story-pools.jsx`** — the
Hypercomb *pools of meaning* story as ONE continuous 1920×1080 composition,
~90 s, interactive (scrub, pause, loop; a chrome rail like the original), then
wire it into the existing pipeline so it narrates and ships exactly like the
ecosystem story. **Follow the structure of the replication presentation**
(`scripts/presentation/ecosystem/hypercomb-story-bloom.jsx` + `ecosystem.cjs`)
to the letter — read both first, and `scripts/presentation/README.md`
("The ecosystem composition, narrated").

## Non-negotiable structure (mirror the bloom story)

- Built on `animations-v3.jsx` (`CompositionStage` / `useComposition`) +
  `tweaks-panel.jsx`; shell = `ecosystem/bloom-shell.html` (React, Babel,
  fonts inlined; **no third-party requests** at runtime).
- Same palette object `C` (bloom tokens), `HEAD`/`BODY`/`MONO`, `R`, the
  three motion helpers only (`MOTION.enter/draw/pop`), `hexD`/`rings`/`axialXY`,
  `fakeSig`/`short`, `Slot` (SLOT = 2200 px apart), `Kicker`, `Mono`, `Pill`,
  `ToolWindow`, `Row`, `Glyph`, `Chrome`, `camera()` — copy them verbatim.
- `window.OM_SCENES` = `[{name, dur, desc}]`, one per scene; a `NAMES` array,
  a `PUSH` map (camera push per scene), `CMDS` (the slash command each scene
  "types"), `TOASTS`. One continuous camera move across the Slots.
- **The narration IS the caption.** One `{scene, say, lead?, caption?}` per
  scene in a new `pools.cjs` (copy `ecosystem.cjs`, change the story asset,
  shell and deliverable names) — same `audio-cache/<h16>.mp3`, same key
  `sha256(voice|rate|spoken(say))`, same `LEAD 0.35 / TAIL 0.35 / MAX_RATE 1.4`,
  same `nat`→`dur` retiming ("the silence is what gets cut, never the speech").
  `<Narration>` reads `window.OM_NARRATION`; with none present the piece is
  silent and identical to the canvas export.
- Deliverable: `dist/hypercomb-pools-bloom.html`. Commands: `node pools.cjs`,
  `--check`, `--times`. Deploy like the others (`deploy-azure.cjs` pattern).
- Beats are timed to sentence boundaries of the cached mp3 (silencedetect),
  as `concepts.cjs` does. Editing a `say` re-times that scene alone.
- Tile-art rule: **no text inside a hex** — words live in Kicker/Mono/Pill.

## The ten scenes (~90 s authored; the retime will play it ~77 s)

| # | name | dur | what is drawn | say (the caption) |
|---|---|---|---|---|
| 1 | Atom | 6 | one hex, its bytes hash to a 64-hex sig that types out; the sig becomes the file name at the root | "An atom is content with a signature. The signature is its name — the same on every machine." |
| 2 | Word | 8 | the word `people` typed; `sha-256 → sign('people')`; a directory appears at the root named by that hash; three atoms drift into it | "A word is hashed too. sign('people') is a place — and everything gathered under that word lives there." |
| 3 | Molecule | 9 | the `people` dir zooms out to become ONE hex; it slides into a bigger dir `sign('business')`; camera pulls back: atom → molecule → molecule, rings outward | "A group of atoms is a molecule. A molecule is an atom one level up. Outward and inward, without end." |
| 4 | Route | 9 | a command line types `/business/people`; a walking cursor hops `business` → `people` → in; a struck-out `sha256("business/people")` fades | "Slash business slash people is a route you walk, not an address you store. Every entity is one step from the root." |
| 5 | Order | 10 | inside `sign('people')`: the set (unordered hexes, jittering), then two participants each mint an ordered meta atom — a small card `{children:[…]}` with its own sig; two `000x` pointers; neither moves the other | "The set has no order. Order is a point of view — a meta atom, signed like everything else. Yours and mine sit side by side; no one is clobbered." |
| 6 | Federate | 10 | three host cards (jwize.com · revolucionstyle.com · susan.hypercomb.com); each shows `GET /<sign('people')>/`; listings fly in and union on the reader's side; same sig lands once | "A pool doesn't live on your computer. Every host that serves the word is part of it. Reading is your replica plus the hosts you choose." |
| 7 | Search | 10 | a word is typed at random (`authors`), hashed, three hosts answer; then `people ∩ authors` — two oases overlap; the overlap glows | "Say a word, hash it, ask your hosts. No index, no schema — the listing is the holding. Two words overlap: that's a relationship across domains that never met." |
| 8 | Forward | 9 | timeline: two old heads (path-keyed) stay in place; a new meta atom appears AHEAD of them with `refs →` arrows back; an undo cursor walks back through the seam and lands on the old head unchanged | "Data never heals. It moves forward. The new head remembers the old ones, and undo walks straight through." |
| 9 | Compatible | 9 | one meta atom; two pointers advance to it — `sign('people')/0007` and the old path bag `/0007`; an "older version" reader resolves the old bag and shows the same head; nothing is deleted (a trash icon greys out) | "One atom, two pointers. Older versions read the same head. Nothing is ever deleted." |
| 10 | Close | 7 | everything folds back into one hex; 92 px type: **"The name is the address."**; caption `''` | "The name is the address." |

Scene `CMDS`: Atom `/add cell` · Word `/people` · Molecule `/business` ·
Route `/business/people` · Order `/order` · Federate `/hosts` · Search
`/search authors` · Forward `/undo` · Compatible `/history` · Close ``.

Interactivity (same as the original + these): scrubbing the chrome rail;
hover a host card in **Federate** to dim the others and show its listing alone;
in **Search**, the typed word is a tweak (`TweakSection` "word") so a viewer can
type any word and watch the hash + listings recompute (fake but deterministic
via `fakeSig(hashOf(word))`).

## Acceptance

1. `node pools.cjs --check` lists ten fresh lines; `node pools.cjs` fills the
   cache and writes `dist/hypercomb-pools-bloom.html`; `--times` prints the
   retime table with every scene's `picture ×rate ≤ 1.4`.
2. Open the dist file offline: it contacts nobody (DevTools network empty).
3. Every caption equals its `say` byte-for-byte except Close (`caption: ''`).
4. Playwright shot per scene at its `at` (reuse `capture-clips.cjs` pattern) →
   `pools/frames/` and one contact sheet; verify no text inside any hex.
5. Finish with a report file (`pools/REPORT.md`) linking the dist page, the
   contact sheet, and the retime table — a link, not chat prose.

Do not touch `ecosystem/*` except to copy from it. Do not create a `docs/`
folder. Put nothing in `documentation/` except a one-line link from
`hypergraph-molecule-lineage.md` → "Artifacts" to the dist page.
