HOW THIS PRESENTATION IS MADE

This tile is the production. Every tile beneath it is one SCENE, and they
compile, in order, into a single self-playing page.

The recipe is declared here once — the children only carry their own filling.
Edit one scene's instruction, recompile, and only that scene is rebuilt: the
narration audio is cached by the words themselves, so untouched scenes cost
nothing.

A scene instruction has these fields:

  eyebrow     the small uppercase line above the headline
  headline    the big line — wrap the emphasised words in *asterisks*
  sub         the calm sentence under it (optional)
  visual      one of:
                none          just words
                film:<clip>   a live screen capture (navigate, zoom, create, children)
                hexes         a row of hexagon badges — one "- glyph label" line each
                stack         stacked layer bars — one "- left | right" line each
                road          a milestone list — one "- title — detail" line each
                sig           a single monospace signature line
  link        an outbound call to action, "label -> url" (optional)
  narration   what the voice says; it is also the on-screen caption

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
