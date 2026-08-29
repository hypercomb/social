#!/usr/bin/env python
"""skin-panels — route the tool windows' hardcoded light-on-dark values onto
the panel roles, so a theme can actually reach them.

Every tool window was drawn for ONE ground. `rgba(255,255,255,0.06)` means
"a whisper of the pane's opposite" and `rgba(0,0,0,0.46)` means "the depth
under a floating thing" — both perfectly sensible, both only true while the
pane is dark. This rewrites them as the roles they already were:

    rgba($accent, a)          -> rgba(var(--acc), a)          identity
    color/border/background   -> rgba(var(--hc-panel-ink), a) the pane's opposite
    box-shadow, not inset     -> rgba(var(--hc-panel-shadow), a)
    box-shadow, inset white   -> LEFT ALONE                   a bevel, not text
    dark background           -> rgba(var(--hc-panel-pane), a)
    solid white-ish text      -> var(--hc-panel-text)

THE PROPERTY DECIDES, not the colour. White at 6% is ink when it is a hover
wash and a bevel when it is an inset shadow, and no amount of matching on the
value can tell those apart — which is why this reads the declaration it sits
in. Anything it cannot place is left untouched and reported, so what it
skipped is visible rather than silently half-done.

    python scripts/skin-panels.py            # dry run: report only
    python scripts/skin-panels.py --write
"""
import re
import sys
from pathlib import Path

UI = Path('hypercomb-shared/ui')

# Light-on-dark inks used across the panels. All of them mean "the opposite of
# the pane at N%"; none of them survives the pane changing.
INK_TRIPLES = [
    (255, 255, 255), (245, 245, 245), (238, 244, 248),
    (216, 230, 238), (234, 240, 244), (230, 238, 244),
]
SOLID_TEXT = ['#eef2f5', '#fff', '#ffffff', 'whitesmoke', 'ghostwhite', '#f5f5f5']

# Properties whose colour is FOREGROUND — text, rules, washes. These flip.
INK_PROPS = re.compile(
    r'\b(color|background|background-color|border|border-[a-z-]*color|border-[a-z]+|'
    r'outline|outline-color|fill|stroke|caret-color|text-decoration-color|column-rule-color)\s*:')
SHADOW_PROPS = re.compile(r'\b(box-shadow|text-shadow|filter|drop-shadow)\s*:')
BG_PROPS = re.compile(r'\b(background|background-color)\s*:')


def luminance(r, g, b):
    def ch(v):
        v = v / 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def panel_files():
    """The tool windows, and only them. A panel is a file that names an accent
    or pulls in the shared docked-shell mixin; the canvas, the header and the
    website surfaces are deliberately NOT in this set."""
    out = []
    for f in sorted(UI.rglob('*.scss')):
        if f.name in ('_toolwindow.scss', '_panel-identity.scss', '_header-bar.scss'):
            continue
        text = f.read_text(encoding='utf-8')
        if re.search(r'^\$accent\s*:', text, re.M) or 'tw.panel(' in text or '@include tw.' in text:
            out.append(f)
    return out


def skin(text):
    """Rewrite one stylesheet. Returns (new_text, changes, skipped)."""
    changes, skipped = [], []
    lines = text.split('\n')
    out = []

    for line in lines:
        original = line
        is_ink = bool(INK_PROPS.search(line))
        is_shadow = bool(SHADOW_PROPS.search(line))
        is_bg = bool(BG_PROPS.search(line))
        # An inset shadow's light is a BEVEL. It is the one white in these
        # files that must not flip: on a light pane a white bevel is simply
        # invisible, which is correct, while an ink one would draw a dark
        # line along the top edge of every panel.
        insets_only = is_shadow and 'inset' in line

        # ── the identity ──────────────────────────────────────────────
        if 'rgba($accent' in line:
            line = re.sub(r'rgba\(\$accent,\s*([^)]+)\)', r'rgba(var(--acc), \1)', line)
        # a bare `$accent` used as a whole colour value
        line = re.sub(r'(?<![-\w$])\$accent(?![-\w])(?!\s*:)', 'rgb(var(--acc))', line)

        # ── shadows ───────────────────────────────────────────────────
        if is_shadow:
            line = re.sub(r'rgba\(0,\s*0,\s*0,\s*([0-9.]+)\)',
                          r'rgba(var(--hc-panel-shadow), \1)', line)

        # ── ink ───────────────────────────────────────────────────────
        if is_ink and not insets_only:
            for (r, g, b) in INK_TRIPLES:
                line = re.sub(
                    rf'rgba\(\s*{r},\s*{g},\s*{b},\s*([0-9.]+)\)',
                    r'rgba(var(--hc-panel-ink), \1)', line)
            for solid in SOLID_TEXT:
                line = re.sub(rf'(:\s*){re.escape(solid)}\b(?=\s*[;!])',
                              r'\1var(--hc-panel-text)', line, flags=re.I)

        # ── the pane itself ───────────────────────────────────────────
        if is_bg:
            def pane(m):
                r, g, b, a = int(m.group(1)), int(m.group(2)), int(m.group(3)), m.group(4)
                # Only a genuinely dark, near-opaque fill is a PANE. A dark
                # colour at 4% is a wash and belongs to ink; swapping it would
                # make every hover state jump when the theme changed.
                if luminance(r, g, b) < 0.06 and float(a) > 0.5:
                    return f'rgba(var(--hc-panel-pane), {a})'
                return m.group(0)
            line = re.sub(r'rgba\((\d+),\s*(\d+),\s*(\d+),\s*([0-9.]+)\)', pane, line)

        if line != original:
            changes.append((original.strip(), line.strip()))
        elif insets_only and re.search(r'rgba\(255,\s*255,\s*255', original):
            skipped.append(('bevel kept white', original.strip()))
        out.append(line)

    return '\n'.join(out), changes, skipped


def ensure_identity(text, path):
    """A file that declares an accent must also publish it as `--acc`."""
    m = re.search(r'^\$accent\s*:\s*([^;]+);', text, re.M)
    if not m or 'panel-identity' in text:
        return text, False
    depth = len(path.relative_to(UI).parts) - 1
    up = '../' * depth
    use = f"@use '{up}panel-identity' as identity;\n"
    # after the last @use, so the module block stays together
    uses = list(re.finditer(r'^@use .*$', text, re.M))
    at = uses[-1].end() + 1 if uses else 0
    return text[:at] + use + text[at:], True


def main():
    write = '--write' in sys.argv
    files = panel_files()
    total_changes = total_skips = 0
    print(f'{len(files)} panel stylesheets\n')
    for f in files:
        text = f.read_text(encoding='utf-8')
        new, changes, skipped = skin(text)
        new, added_use = ensure_identity(new, f)
        if not changes and not added_use:
            continue
        total_changes += len(changes)
        total_skips += len(skipped)
        print(f'  {f.relative_to(UI)}: {len(changes)} rewritten'
              + (f', {len(skipped)} bevels kept' if skipped else '')
              + (', +identity' if added_use else ''))
        if write:
            f.write_text(new, encoding='utf-8')
    print(f'\n{total_changes} declarations rewritten, {total_skips} bevels left white')
    if not write:
        print('(dry run — pass --write)')


if __name__ == '__main__':
    main()
