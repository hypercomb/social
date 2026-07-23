# Transcript — Jaime, 2026-07-20: context behaviors + /dashboard toggle

(Condensed conversation transcript for the meaning loop. Design doc:
documentation/context-behaviors.md. The /dashboard toggle itself is BUILT.)

Typing /dashboard did nothing — it should toggle the dashboard. You should be
able to go back just by right-click, as normal navigation does.

Where does the hive owner turn things on globally, or at any node? Say
dashboard is one of the options: there's no button on that page, so I should
be able to turn dashboard on or off in a global sense, from anywhere —
whatever the best experience is, one that makes it available — and then the
/dashboard toggle shows the questions.

Since there's no tile for the current context, you should be able to manage
the current context's behaviors instead of clicking a tile and setting
behaviors on the tile like we do. When you go to manage the current context it
shows two things: the Features panel, AND a tile on an empty canvas — a
filtered view for the features that have been selected and turned on. You
literally get tiles per feature. Since those markers are in the history, we
can use them logically to create those tiles. Nothing fancy — it should all be
minimal. We disappear the normal tiles temporarily and show the feature tiles
plus the Behaviors panel, so you are always logically in context of what you
want to update.

Return semantics: when you update a CHILD's behaviors, you come back to the
parent context. When you update the CURRENT context (by a shortcut or an
icon), you come back to yourself — it was an update on only the context, not
on one of the tiles.
