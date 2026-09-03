# Tool-window chrome — the one standard

Every tool window takes the same shell, the same header band, the same close
button and the same rollovers. Colour is covered by
[tool-window-colour-roles.md](tool-window-colour-roles.md); this page is the
GEOMETRY and the CONTROLS. A window that departs from any line here is a bug,
not a style.

## The shell

- Docked: `<aside hcDockInset="right" hcDockedPanel="<id>" dockSide="right"
  [minWidth] [maxWidth] [defaultWidth]>` whose root SCSS is
  `@include tw.panel($accent, $side)`. Floating: `@include tw.floating-panel($accent)`.
- The primitive (`hypercomb-core/src/core/panels/docked-panel.ts`) injects the
  resize grip, the settings gear, the lane placement and the window session.
  A window adds none of those itself.
- Fonts come from the shell (`var(--hc-mono)`). No panel re-declares a font
  stack; `--hc-read` / `--hc-code` are the only sanctioned alternatives, on the
  surfaces built for reading or code.

## The header band

- One `<header class="<x>-header">` as the FIRST child of the root, styled with
  `@include tw.header` and nothing about its height, padding or divider.
- The divider is the mixin's: `border-bottom: 1px solid var(--hc-window-edge)`.
  Twenty-two panels used to draw it twenty-two ways; none draws it now.
- Order inside the band: identity (glyph + title) → the window's own controls
  → the settings gear (injected, reserved slot) → the close button LAST. The
  gear anchors to `header.lastElementChild`, so nothing may follow the close.

## The close button

```html
<button class="<x>-close" type="button" (click)="close()"
        [attr.aria-label]="'panel.close' | t" [title]="'panel.close' | t">×</button>
```

- The glyph is the text `×` (U+00D7), never a `mat-sym` `close`, never `✕`.
- The class contains `close` — that is what the mixin's
  `> button[class*='close']` sizes.
- `panel.close` is the ONE key; a window does not mint its own close label.

## Rollovers

- Every button in a header carries BOTH `[attr.aria-label]` and `[title]`,
  bound to the same expression. One without the other is a rollover that a
  screen reader or a mouse cannot see.
- The control rail's rollover is not a `title`: it is ONE fixed element at the
  controls-bar root (`.rail-tip`), placed from the hovered button's box. A CSS
  `::after` on a rail button is never visible — the icon list scrolls and clips
  its overflow, and the pill's `backdrop-filter` is the containing block for
  anything positioned inside it. Beside a docked rail the tip takes the
  button's exact top and bottom and stands on the canvas side with no gap and
  no edge on the rail side; the floating horizontal pill keeps a chip above the
  icon. Its text is the button's `aria-label`, so a rail button never carries a
  `title` as well (that would show twice).

## Escape

- A window never registers its own Escape listener. It declares `dismiss()` /
  `close()` on its `WindowSession` and the cascade knocks
  (`selection-tool-windows.md`, `core/panels/tool-windows.ts`).
- Known holdouts, recorded 2026-09-02 and not yet migrated: chat-window
  (root keydown, session without `dismiss`), contact-form (no session at all),
  notes-viewer (session without `dismiss`), markup-overlay (window-capture
  keydown). Each is a behaviour change, not a mechanical edit.

## Proof

- `npx vitest run doctrine.spec.ts` — the ratchets.
- `node scripts/drive-toolwindow-contrast.cjs --themes honey,light,sherbet,dark`
  — every window's text measured over its real ground.
- `node scripts/check-icon-subset.cjs && node scripts/check-icon-render.cjs`
  — every `mat-sym` name ships and resolves (a missing one renders as a WORD).
