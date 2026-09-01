# -*- coding: utf-8 -*-
# Which TRACKED files import a module that is NOT in the pushed tree?
# This is exactly what CI hits and a local build never can: the files are
# present on disk, so every local compile resolves them happily.
import subprocess, os, re, io

ROOT = 'C:/Projects/hypercomb/social'
REF = '740186201'
SEP = chr(92)  # backslash, kept out of a literal so no escaping games


def git(*a):
    return subprocess.run(['git', '-C', ROOT] + list(a), capture_output=True, text=True).stdout


tracked = set(git('ls-tree', '-r', '--name-only', REF).splitlines())
untracked = [l[3:] for l in git('status', '--porcelain', '-uall').splitlines() if l.startswith('?? ')]
missing = set(f for f in untracked if f not in tracked and f.endswith(('.ts', '.html', '.scss')))

IMPORT = re.compile(r"""(?:from|import)\s+['"](\.[^'"]+)['"]""")
bad = []

for t in sorted(tracked):
    if not t.endswith('.ts'):
        continue
    p = os.path.join(ROOT, t)
    if not os.path.exists(p):
        continue
    try:
        src = io.open(p, encoding='utf-8', errors='ignore').read()
    except Exception:
        continue
    base = os.path.dirname(t)
    for spec in IMPORT.findall(src):
        target = os.path.normpath(os.path.join(base, spec)).replace(SEP, '/')
        cands = [target, target + '.ts', target + '/index.ts']
        if target.endswith('.js'):
            cands.append(target[:-3] + '.ts')
        for c in cands:
            if c in missing:
                bad.append((t, spec, c))
                break

print('source files on disk but NOT in the pushed tree:', len(missing))
print('TRACKED files importing one of them:', len(bad))
for t, spec, c in bad:
    print('  %s' % t)
    print('      -> %s   (needs %s)' % (spec, c))
