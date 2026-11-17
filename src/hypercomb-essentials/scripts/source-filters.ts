// hypercomb-essentials/scripts/source-filters.ts
//
// WHICH FILES UNDER src/ ARE THE PACKAGE'S OWN SOURCE. The build decides it
// (build-module.ts discoverSources) and so does the TypeScript the package
// hosts beside itself (typescript-atoms.ts), and the two must never disagree:
// a generated index.ts or a keys file is git-ignored, so carrying one would
// sign a file no other checkout has into the package's root.
//
// This file imports nothing, so anything may import it.

export const isSource = (f: string): boolean =>
  (f.endsWith('.ts') || f.endsWith('.js')) && !f.endsWith('.d.ts')

// exclude test files from artifact pipeline. spec files import vitest;
// when bundled into a namespace dep and loaded in the browser, vitest
// throws "failed to find the runner" at the first beforeEach call,
// crashing every consumer of that namespace. selftest files are NODE
// harnesses (run via tsx) that execute their whole suite at module load
// and may call process.exit — bundling the arkanoid selftest into the
// games/arkanoid namespace dep made the bare `process` throw at import
// time in the browser and took the whole dependency down (the 2026-07-16
// "ReferenceError: process is not defined" dependency-loader failure).
export const isSpecFile = (f: string): boolean =>
  f.endsWith('.spec.ts') || f.endsWith('.spec.js') ||
  f.endsWith('.test.ts') || f.endsWith('.test.js') ||
  f.endsWith('selftest.ts') || f.endsWith('selftest.js')

// exclude key-only files from artifact pipeline
export const isKeysFile = (f: string): boolean => {
  if (f.endsWith('.keys.ts') || f.endsWith('.keys.js') || f.endsWith('-keys.ts') || f.endsWith('-keys.js')) return true
  const base = f.replace(/\\/g, '/').split('/').pop() ?? ''
  return base === 'essentials-keys.ts' || base === 'essentials-keys.js'
}

export const isEntry = (f: string): boolean =>
  f.endsWith('.entry.ts') || f.endsWith('.entry.js')

export const isIndexFile = (f: string): boolean => {
  const base = f.replace(/\\/g, '/').split('/').pop() ?? ''
  return base === 'index.ts' || base === 'index.js'
}

/** THE TYPESCRIPT THE PACKAGE HOSTS (owner, 2026-11-16: "Host the package's
 *  TypeScript without installing it, fetched only when a file is opened").
 *  `rel` is a path under src/ with forward slashes. The rule is the build's
 *  own discovery filter and nothing else, so what a person reads is the file
 *  the compiled module came from. A file directly in src/ is not carried, as
 *  the build's discovery drops it: those are the effect barrels
 *  scripts/prepare.ts rewrites, and a publish builds without running prepare,
 *  so a stale one would move the package's root. The name half of this rule
 *  is mirrored for the device in src/assistant/package-typescript.ts
 *  (typescriptCarries); source-filters.spec.ts holds the two to one answer. */
export const isCarriedSource = (rel: string, excludedDomains: readonly string[]): boolean =>
  rel.includes('/')
  && rel.endsWith('.ts') && isSource(rel) && !isSpecFile(rel) && !isKeysFile(rel) && !isIndexFile(rel) && !isEntry(rel)
  && !rel.startsWith('types/') && !excludedDomains.includes(rel.split('/')[0]!)
