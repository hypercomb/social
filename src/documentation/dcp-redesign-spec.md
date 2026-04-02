# Diamond Core Processor — UI Redesign Specification

## Overview

Redesign the Diamond Core Processor from a single-column light-theme utility into a three-panel dark-mode developer tool. This spec defines the target layout, color system, component structure, and interaction patterns.

## Layout: Three-Panel Architecture

```
+------------------+-------------------------------+------------------+
|     NAVBAR       |          (full width)         |                  |
+------------------+-------------------------------+------------------+
|                  |         FILTER BAR            |                  |
|    SIDEBAR       |   [search] [chip] [chip]      |   DETAIL PANEL   |
|    (280px)       +-------------------------------+   (360px)        |
|                  |                               |                  |
|  Domain tree     |       CARD GRID               |  Selected item   |
|  Install input   |   (auto-fill, min 280px)      |  properties,     |
|  Collapsible     |   Module cards with           |  dependencies,   |
|  groups          |   badges, sigs, stats          |  actions         |
|                  |                               |                  |
+------------------+-------------------------------+------------------+
|                       STATUS BAR (28px)                             |
+--------------------------------------------------------------------+
```

### Panel Behavior

- **Sidebar** (280px, fixed): Domain tree navigation. Collapsible domain groups. Install input at top. Each tree item shows a color-coded dot by type.
- **Center content** (flex: 1): Filter bar at top with search input and filter chips. Below it, a responsive card grid (`grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`).
- **Detail panel** (360px, fixed): Shows when a module is selected. Properties, dependencies list, and action buttons (View Source, Edit Layer). Collapsible when nothing is selected.
- **Navbar** (56px height, full width): Logo, app title, tab navigation (Modules / Inspector / Code), settings icons.
- **Status bar** (28px, full width): Connection indicator, active domain, module counts.

## Color System

### Base Palette (Dark Theme)

| Token | Hex | Usage |
|-------|-----|-------|
| `--dcp-bg` | `#0f1117` | Page background, content area |
| `--dcp-surface` | `#161b22` | Cards, sidebar, panels, navbar |
| `--dcp-border` | `rgba(255,255,255,0.06)` | Subtle dividers |
| `--dcp-border-hover` | `rgba(255,255,255,0.12)` | Hover state borders |
| `--dcp-text-primary` | `#e6edf3` | Headings, names, values |
| `--dcp-text-secondary` | `#c9d1d9` | Body text |
| `--dcp-text-muted` | `#8b949e` | Labels, subtitles, meta |
| `--dcp-text-faint` | `#484f58` | Signatures, placeholders |
| `--dcp-accent` | `#4a6fa5` | Primary action, selection border, links |
| `--dcp-accent-hover` | `#5a7fb5` | Hover on accent elements |

### Type Colors (Color-Coded Module System)

| Type | Color | Hex | Tint (12% opacity) |
|------|-------|-----|---------------------|
| Bee | Purple | `#a371f7` | `rgba(163, 113, 247, 0.12)` |
| Worker | Green | `#3fb950` | `rgba(63, 185, 80, 0.12)` |
| Dependency | Gold | `#d29922` | `rgba(210, 153, 34, 0.12)` |

These colors are used consistently in: sidebar tree dots, card badges, filter chips, detail panel indicators.

### Interactive States

| State | Background | Border |
|-------|-----------|--------|
| Hover (generic) | `rgba(255,255,255,0.04)` | — |
| Hover (card) | — | `--dcp-border-hover` + `box-shadow: 0 4px 16px rgba(0,0,0,0.3)` + `translateY(-1px)` |
| Selected (card) | — | `1px solid --dcp-accent` + `box-shadow: 0 0 0 1px --dcp-accent` |
| Selected (tree item) | `rgba(74, 111, 165, 0.15)` | — |
| Active chip (bee) | `rgba(163, 113, 247, 0.15)` | transparent |
| Active chip (worker) | `rgba(63, 185, 80, 0.15)` | transparent |
| Active chip (dep) | `rgba(210, 153, 34, 0.15)` | transparent |
| Input focus | — | `border-color: --dcp-accent` |

## Typography

| Element | Font | Size | Weight | Color |
|---------|------|------|--------|-------|
| Nav title | Inter | 15px | 600 | `--dcp-text-primary` |
| Nav tab | Inter | 12px | 500 | `--dcp-text-muted` / primary when active |
| Sidebar section title | Inter | 11px | 600 | `--dcp-text-muted`, uppercase, `letter-spacing: 0.8px` |
| Domain label | Inter | 12px | 600 | `--dcp-text-primary` |
| Tree item | Inter | 12px | 400 | `--dcp-text-muted` |
| Card name | Inter | 14px | 600 | `--dcp-text-primary` |
| Card kind | Inter | 10px | 500 | `--dcp-text-muted`, uppercase, `letter-spacing: 0.5px` |
| Card signature | Monospace | 10px | 400 | `--dcp-text-faint` |
| Card stat | Inter | 11px | 400/500 | muted / secondary |
| Detail title | Inter | 18px | 700 | `--dcp-text-primary`, `letter-spacing: -0.3px` |
| Detail section title | Inter | 11px | 600 | `--dcp-text-muted`, uppercase |
| Detail label | Inter | 13px | 400 | `--dcp-text-muted` |
| Detail value | Inter | 13px | 500 | `--dcp-text-primary` |
| Status bar | Inter | 11px | 400 | `--dcp-text-faint` |

## Border Radius Scale

| Element | Radius |
|---------|--------|
| Cards, panels | `10px` |
| Badges, inputs, buttons | `6-8px` |
| Chips | `20px` (pill) |
| Tree items | `4px` |
| Logo | `6px` |

## Component Specifications

### Navbar

- Height: 56px
- Background: `--dcp-surface`
- Bottom border: `--dcp-border`
- Left section: Logo (28x28, gradient `#7c5cbf` to `#4a6fa5`, 6px radius) + title
- Center: Tab group with background `rgba(255,255,255,0.04)`, 8px radius, 3px padding. Active tab gets `rgba(255,255,255,0.08)` background
- Right: Icon buttons (32x32, 6px radius)

### Sidebar

- Width: 280px
- Background: `--dcp-surface`
- Right border: `--dcp-border`
- Header: "DOMAINS" label + "+" button (24x24, dashed border)
- Install row: Input + blue "Install" button inline, below header
- Domain groups: Collapsible. Domain label row with colored dot (8x8 circle), name, and chevron. Tree items indented 20px with 6x6 type-colored dots
- Active tree item: blue tint background

### Module Cards

- Background: `--dcp-surface`
- Border: `--dcp-border`, radius 10px
- Padding: 16px
- Structure:
  - Top row: Badge (32x32, 8px radius, type-tinted background + type icon) + name + kind label
  - Signature: truncated monospace, faint color
  - Bottom row: Stats (deps count, effects count, workers count)
- Hover: border lightens, shadow appears, slight lift (`translateY(-1px)`)
- Selected: accent border + accent glow

### Detail Panel

- Width: 360px
- Background: `--dcp-surface`
- Left border: `--dcp-border`
- Header section: Large badge (40x40, 10px radius) + title (18px bold) + subtitle + full signature in monospace block
- Sections: Divided by `--dcp-border`, each with uppercase section title. Properties as label/value rows. Dependencies as list items with type dots.
- Actions: Pinned to bottom. Two buttons side by side — primary (accent bg) and secondary (subtle bg)

### Filter Bar

- Sits above card grid
- Bottom border: `--dcp-border`
- Padding: 12px 24px
- Contains: Search input (with search icon, dark bg, 8px radius) + filter chips
- Chips: Pill-shaped (20px radius), type-colored when active, gray border when inactive. Each has a 6x6 color dot + label

### Status Bar

- Height: 28px
- Background: `--dcp-surface`
- Top border: `--dcp-border`
- Content: Green connection dot + "Connected" + domain name + right-aligned module counts

## Transitions

All interactive state changes: `transition: all 0.15s`

Card hover lift uses `transition: all 0.15s` covering transform, border-color, and box-shadow simultaneously.

Chevron rotation on domain expand: `transition: transform 0.15s`

## Files to Modify

| File | Change |
|------|--------|
| `home.component.html` | Restructure into sidebar + content + detail layout. Add navbar, status bar, card grid, filter bar |
| `home.component.scss` | Complete restyle with dark theme, three-panel layout, card styles, all new component styles |
| `home.component.ts` | Add selected module state, panel toggle logic, view mode switching |
| `styles.scss` | Update Material 3 theme to dark, set body background to `--dcp-bg` |
| `index.html` | No changes needed (Inter font already loaded) |

## Implementation Notes

- The existing `dcp-tree-view`, `dcp-bee-inspector`, `dcp-layer-editor`, and `dcp-command-line` components can be adapted into the new layout — the tree view maps to the sidebar, the bee inspector maps to the detail panel.
- The `dcp-diamond` component icons should adopt the new type color system.
- Filter chips replace the existing `kind-toggle` diamond buttons.
- The card grid is a new view that doesn't exist today — it renders the same `section.items` data but as cards instead of tree rows.
- Consider keeping the existing tree view as an alternative "list view" toggle alongside the new card grid.
- The command line (`dcp-command-line`) can be integrated into the filter bar search input or kept as a separate overlay triggered by a keyboard shortcut.
