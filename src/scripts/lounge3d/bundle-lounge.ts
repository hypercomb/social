// scripts/lounge3d/bundle-lounge.ts
//
// lounge-3d.ts → one minified classic script, the room's own sig-addressed
// resource (intel-build-revolucion-site.ts stores it; lounge-3d.spec.ts holds
// it to its promises). One place, so the build and the spec bundle the same way.
//
// TWO WAYS TO GET A PIXI.
//
// - `pixi: 'lent'` (what the hive stores). The page the room lands in already
//   has Pixi and its 3D: the hive's own (the site view lends both through
//   IoC, `PIXI_LENDER`), or a host page's import map naming `pixi.js` (the
//   vendored no-eval build, /vendor/pixi.runtime.js) and `@pixi/3d` (the
//   essentials vendor atom). So the room carries NEITHER. The script asks the
//   page for both — the lender, else `import()`, which a classic script may
//   use and the import map resolves — then runs the room against them.
//   About 1.1 MB lighter than carrying its own: only the room's source and
//   the three `@pixi/3d/extras` pieces it uses (OrbitCamera, PortalMaterial,
//   portalExitClipPlane) ride inside. Those three are bundled with their every
//   reach into `@pixi/3d`'s core sent to the lent module, so there is ONE copy
//   of the 3D classes on the page, never a second whose `instanceof` disagrees.
//   A page with no import map (or an older hive whose package has no `@pixi/3d`
//   atom) cannot lend; the room then shows its drawn fallback, and says why
//   in the console.
// - `pixi: 'own'` (the --preview pages, which have no import map). The old
//   self-contained IIFE: Pixi's `unsafe-eval` build and `@pixi/3d` inside.
//
// What both need from the bundler:
//
// - PIXI'S NO-EVAL TABLES. The room imports the polyfill's two private tables
//   by their file paths (`pixi.js/lib/unsafe-eval/...`), which Pixi's export
//   map does not list. Carrying its own Pixi, those paths resolve to the files
//   on disk, the way the web shell's vendor build reaches them
//   (build-pixi-vendor.ts). Lent a Pixi, they resolve to the tables that build
//   EXPORTS (`__noEvalUniformParserFunctions`, `__noEvalUboParserFunctions`);
//   a Pixi that evals (the dev shell's) exports neither, and the bridge then
//   has nothing to do.
// - NO THIRD-PARTY REQUEST. `@pixi/3d` names Google's CDN for its Draco
//   decoder. Nothing in the room loads a Draco model, but the URL is rewritten
//   to the local vendor path all the same, as the essentials vendor step does
//   (build-module.ts), so the bundle names no other host.
//
// Run from the monorepo root (`src/`) or from `scripts/`; this file runs as
// CJS under tsx, so it resolves from the working directory, not import.meta.

const DRACO_CDN = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/'
const DRACO_LOCAL = '/vendor/draco/'

/** Where the lent modules wait, between the page handing them over and the
 *  room's own code taking them. Deleted the moment the room has them. */
const LENT = '__revLoungePixi'

/** The hive's lender of its own Pixi and `@pixi/3d` (essentials
 *  presentation/tiles/pixi3d-lender.ts, registered by the site view). */
export const PIXI_LENDER = '@diamondcoreprocessor.com/Pixi3DLender'

export interface LoungeBundle {
  readonly text: string
  /** Every source file with bytes in the output, relative to the monorepo
   *  root — what the spec reads to prove a lent bundle carries no Pixi. */
  readonly inputs: readonly string[]
}

export interface BundleOptions {
  /** `lent` (default): borrow the page's Pixi and `@pixi/3d`. `own`: carry them. */
  readonly pixi?: 'lent' | 'own'
}

type Resolved = { path: string; namespace?: string }
type Plugin = {
  name: string
  setup(build: {
    onResolve(o: { filter: RegExp; namespace?: string }, cb: (a: { path: string; importer: string; resolveDir: string }) => Resolved | undefined): void
    onLoad(o: { filter: RegExp; namespace: string }, cb: (a: { path: string }) => { contents: string; loader: 'js' }): void
  }): void
}

export async function bundleLoungeWith(options: BundleOptions = {}): Promise<LoungeBundle> {
  const lent = (options.pixi ?? 'lent') === 'lent'
  const esbuild = await import('esbuild')
  const { existsSync } = await import('node:fs')
  const path = await import('node:path')
  const fromCwd = (...candidates: string[]): string | undefined =>
    candidates.map(p => path.resolve(process.cwd(), p)).find(existsSync)
  const entry = fromCwd('scripts/lounge3d/lounge-3d.ts', 'lounge3d/lounge-3d.ts')
  if (!entry) throw new Error('lounge-3d.ts not found — run from the monorepo root (src/)')
  const pixiDir = fromCwd('node_modules/pixi.js', '../node_modules/pixi.js')
  if (!pixiDir) throw new Error('pixi.js is not installed')
  const p3dDist = fromCwd('node_modules/@pixi/3d/dist', '../node_modules/@pixi/3d/dist')
  if (!p3dDist) throw new Error('@pixi/3d is not installed')
  const extrasDir = path.join(p3dDist, 'extras') + path.sep
  const monorepo = path.resolve(path.dirname(entry), '..', '..')

  const ownPixi: Plugin = {
    name: 'pixi-no-eval-tables',
    setup(build) {
      build.onResolve({ filter: /^pixi\.js\/lib\/unsafe-eval\// }, args => ({
        path: path.resolve(pixiDir, args.path.slice('pixi.js/'.length)),
      }))
    },
  }

  // Each lent module is a CommonJS stand-in reading what the page handed over,
  // so the room's `import { Application } from 'pixi.js'` becomes a property
  // read on the page's own module at the moment the room's code runs.
  const STANDINS: Record<string, string> = {
    pixi: `module.exports = window.${LENT}.pixi`,
    p3d: `module.exports = window.${LENT}.p3d`,
    'uniform-table': `module.exports = { uniformParserFunctions: window.${LENT}.pixi.__noEvalUniformParserFunctions }`,
    'ubo-table': `module.exports = { uboParserFunctions: window.${LENT}.pixi.__noEvalUboParserFunctions }`,
    // The page's Pixi is already whichever build its policy needs.
    'unsafe-eval': '',
  }
  const lentPixi: Plugin = {
    name: 'lent-pixi',
    setup(build) {
      const to = (name: string): Resolved => ({ path: name, namespace: 'lent' })
      build.onResolve({ filter: /^pixi\.js$/ }, () => to('pixi'))
      build.onResolve({ filter: /^@pixi\/3d$/ }, () => to('p3d'))
      build.onResolve({ filter: /^pixi\.js\/unsafe-eval$/ }, () => to('unsafe-eval'))
      build.onResolve({ filter: /^pixi\.js\/lib\/unsafe-eval\/uniforms\/uniformSyncFunctions\.mjs$/ }, () => to('uniform-table'))
      build.onResolve({ filter: /^pixi\.js\/lib\/unsafe-eval\/ubo\/uboSyncFunctions\.mjs$/ }, () => to('ubo-table'))
      // The extras reach into `@pixi/3d`'s core by relative path. Every such
      // reach goes to the lent module instead — each name they take is one
      // the package's main entry exports (lounge-3d.spec.ts checks).
      build.onResolve({ filter: /^\.\.?\// }, args => {
        if (!args.importer.startsWith(extrasDir)) return undefined
        const target = path.resolve(args.resolveDir, args.path)
        return target.startsWith(extrasDir) ? undefined : to('p3d')
      })
      build.onLoad({ filter: /.*/, namespace: 'lent' }, args => {
        const contents = STANDINS[args.path]
        if (contents === undefined) throw new Error(`no lent stand-in for ${args.path}`)
        return { contents, loader: 'js' }
      })
    },
  }

  const out = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    minify: true,
    target: 'es2020',
    platform: 'browser',
    write: false,
    legalComments: 'none',
    metafile: true,
    plugins: [lent ? lentPixi : ownPixi],
  })
  const room = out.outputFiles?.[0]?.text
  if (!room) throw new Error('lounge bundle produced no output')
  // Only what made it into the output (tree-shaken files are listed with 0 bytes).
  const included = Object.values(out.metafile?.outputs ?? {})[0]?.inputs ?? {}
  const inputs = Object.entries(included)
    .filter(([p, use]) => use.bytesInOutput > 0 && !p.startsWith('lent:'))
    .map(([p]) => p)
    .map(p => path.relative(monorepo, path.resolve(process.cwd(), p)).split(path.sep).join('/'))
  if (!lent) return { text: room.split(DRACO_CDN).join(DRACO_LOCAL), inputs }

  // The lending: ask the page for both, hand them over, run the room. The
  // hive's lender comes first (`PIXI_LENDER`, registered by the site view):
  // it works in the dev shell too, which has no runtime import map and
  // bundles its Pixi. The page's import map is the second ask (a host's page
  // with no hive behind it). A page that can do neither shows the drawn room
  // the bundle would have shown for a missing WebGL — same fallback, same
  // switches.
  const text =
    '(function(){' +
    'function fail(e){console.warn("[lounge3d] this page has no Pixi to lend the room: no ' + PIXI_LENDER + ', and its import map names no pixi.js or @pixi/3d",e);' +
    'var c=window.REV_LOUNGE||{},q=function(s){return s?document.querySelector(s):null},' +
    's=q(c.mount||"#lounge3d"),b=q(c.controls),f=q(c.fallback||"#loungeFallback");' +
    'if(s)s.hidden=true;if(b)b.hidden=true;if(f)f.hidden=false}' +
    'var l;try{l=window.ioc&&window.ioc.get&&window.ioc.get("' + PIXI_LENDER + '")}catch(e){l=null}' +
    'var p=l&&typeof l.lend==="function"?Promise.resolve().then(function(){return l.lend()}):' +
    'Promise.all([import("pixi.js"),import("@pixi/3d")]).then(function(m){return{pixi:m[0],p3d:m[1]}});' +
    'p.then(function(m){' +
    `window.${LENT}={pixi:m.pixi,p3d:m.p3d};` +
    `try{${room.trim()}}finally{delete window.${LENT}}` +
    '},fail)})();\n'
  return { text, inputs }
}

/** The bundle the hive stores: the room, borrowing the page's Pixi. */
export async function bundleLounge(options: BundleOptions = {}): Promise<string> {
  return (await bundleLoungeWith(options)).text
}
