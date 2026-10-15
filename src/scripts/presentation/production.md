HOW THIS PRESENTATION IS MADE

This tile is the production. Every tile beneath it is one SCENE, and they
compile, in order, into a single self-playing page.

The recipe is declared here once — the children only carry their own filling.
Edit one scene's instruction, recompile, and only that scene is rebuilt: the
narration audio is cached by the words themselves, so untouched scenes cost
nothing.

A scene instruction has these fields:

  eyebrow     the small mono line above the headline — a topic noun, never a headline word
  headline    the big line — wrap the one emphasised word in *asterisks*
  sub         the calm sentence under it (optional; one line)
  visual      one of:
                none            just words
                film:<clip>     a live capture (navigate, zoom, create, children)
                                or a drawn concept clip (vocabulary, integrity, time)
                plate:<name>    a drawn SVG plate from plates.cjs — the first row is its title
                hexes           a row of hexagon badges — one "icon:<name> <label>" row each,
                                labels of at most 12 characters
                list            one block of rows — "left | right" each; "* " opens the head row
                stack           the same block, newest on top (history only)
                road:<state>    milestones — "title — detail" rows; state = landed | next | vision
  visualData  the rows the visual needs
  link        the one call to action, {href, label} — the last scene only
  sig         true stamps the caption's own signature on the figure strip
  narration   what the voice says; it is also the on-screen caption

Every figure sits in one frame with a strip beneath it — kind · title — and
nothing is drawn over a figure. Icons are named from the sprite (source, format,
platform, network, layers, resource, bee, deps, content); there are no glyphs.

Rules the compiler keeps:

  - The narration is the caption. Write it to be spoken, not to be read.
  - Never write a word in CAPITALS in the narration — the voice spells those
    out letter by letter. Put emphasis in the headline instead.
  - A pronunciation that comes out wrong is fixed once, in pronunciations.json,
    and every scene that says the phrase re-renders.
  - Anyone watching can highlight text and file an annotation against the scene
    it belongs to; those come back as notes here.

Chapters: what is hypercomb · why hypercomb · roadmap.
Compile with: node scripts/presentation/build.cjs
