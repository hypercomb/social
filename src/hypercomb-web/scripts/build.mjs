import { createHash } from 'node:crypto'
import {
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
import * as sass from 'sass'

const HERE = dirname(fileURLToPath(import.meta.url))
export const WEB_ROOT = resolve(HERE, '..')
export const SOURCE_ROOT = resolve(WEB_ROOT, '..')
export const OUTPUT_ROOT = join(WEB_ROOT, 'dist', 'hypercomb-web', 'browser')

const MAIN_ENTRY = join(WEB_ROOT, 'src', 'main.ts')
const WORKER_ENTRY = join(SOURCE_ROOT, 'hypercomb-shared', 'core', 'packed-store.worker.ts')
const TSCONFIG = join(WEB_ROOT, 'tsconfig.app.json')

const STYLE_INPUTS = [
  join(WEB_ROOT, 'src', 'styles.scss'),
  join(WEB_ROOT, 'src', 'app', 'app.scss'),
  join(WEB_ROOT, 'src', 'app', 'header', 'header.scss'),
]

const copyTree = async (source, destination) => {
  try {
    await cp(source, destination, { recursive: true, force: true })
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

const copyMarkdown = async (source, destination) => {
  let entries
  try { entries = await readdir(source, { withFileTypes: true }) }
  catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    const from = join(source, entry.name)
    const to = join(destination, entry.name)
    if (entry.isDirectory()) await copyMarkdown(from, to)
    else if (entry.name.endsWith('.md')) {
      await mkdir(dirname(to), { recursive: true })
      await cp(from, to, { force: true })
    }
  }
}

const copyFonts = async () => {
  const fonts = join(SOURCE_ROOT, 'hypercomb-shared', 'fonts')
  for (const entry of await readdir(fonts, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(?:otf|ttf|woff2?)$/i.test(entry.name)) continue
    await cp(join(fonts, entry.name), join(OUTPUT_ROOT, entry.name), { force: true })
  }
}

/**
 * Publish the content-addressed package namespace at the domain root.
 *
 * `/content` remains the bundled compatibility mirror, but the runtime
 * contract is `<origin>/<signature>`. Keeping the flat leaves in compiler
 * output means the plain local server and a static production deployment
 * exercise the same resolution path instead of producing a normal-but-noisy
 * root 404 before falling back to `/content/<signature>`.
 */
const copySignatureNamespace = async () => {
  const bundled = join(WEB_ROOT, 'public', 'content')
  let entries
  try { entries = await readdir(bundled, { withFileTypes: true }) }
  catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    if (!/^[a-f0-9]{64}$/i.test(entry.name)) continue
    await cp(join(bundled, entry.name), join(OUTPUT_ROOT, entry.name), {
      recursive: entry.isDirectory(),
      force: true,
    })
  }
}

const copyStaticAssets = async () => {
  await copyTree(join(WEB_ROOT, 'public'), OUTPUT_ROOT)
  await copySignatureNamespace()
  await copyTree(join(SOURCE_ROOT, 'shared-public'), OUTPUT_ROOT)
  await copyTree(
    join(SOURCE_ROOT, 'hypercomb-shared', 'tracks'),
    join(OUTPUT_ROOT, 'tracks'),
  )
  await copyMarkdown(
    join(SOURCE_ROOT, 'documentation'),
    join(OUTPUT_ROOT, 'documentation'),
  )
  await copyFonts()
}

const packedWorkerUrlPlugin = {
  name: 'packed-worker-url',
  setup(build) {
    build.onLoad({ filter: /[\\/]packed-bridge\.ts$/ }, async ({ path }) => {
      const source = await readFile(path, 'utf8')
      const marker = "new URL('./packed-store.worker', import.meta.url)"
      if (!source.includes(marker)) {
        throw new Error(`packed worker URL marker changed in ${path}`)
      }
      return {
        contents: source.replace(
          marker,
          "new URL('/packed-store.worker.js', location.origin)",
        ),
        loader: 'ts',
      }
    })
  },
}

const compileStyles = async production => {
  const style = production ? 'compressed' : 'expanded'
  const parts = STYLE_INPUTS.map(file => sass.compile(file, {
    loadPaths: [SOURCE_ROOT],
    quietDeps: true,
    sourceMap: !production,
    style,
  }).css)
  const css = parts.join('\n')
  const name = 'styles.css'
  const digest = createHash('sha256').update(css).digest()
  const integrity = `sha256-${digest.toString('base64')}`
  const version = digest.toString('hex').slice(0, 16)
  await writeFile(join(OUTPUT_ROOT, name), css, 'utf8')
  return { name, integrity, version }
}

const findMainOutput = metafile => {
  for (const [output, metadata] of Object.entries(metafile.outputs)) {
    if (!metadata.entryPoint) continue
    if (resolve(SOURCE_ROOT, metadata.entryPoint) === MAIN_ENTRY) return basename(output)
  }
  throw new Error('esbuild did not report a main entry output')
}

const writeIndex = async ({ mainName, mainVersion, styleName, styleIntegrity, styleVersion }) => {
  let html = await readFile(join(WEB_ROOT, 'src', 'index.html'), 'utf8')
  html = html.replace(
    '</head>',
    `    <link rel="stylesheet" href="/${styleName}?v=${styleVersion}" integrity="${styleIntegrity}" />\n  </head>`,
  )
  html = html.replace(
    '</body>',
    `    <script type="module" src="/${mainName}?v=${mainVersion}"></script>\n  </body>`,
  )
  await writeFile(join(OUTPUT_ROOT, 'index.html'), html, 'utf8')
}

export const buildWeb = async ({
  production = true,
  clean = true,
  copyStatic = true,
} = {}) => {
  const started = performance.now()
  await mkdir(OUTPUT_ROOT, { recursive: true })
  if (clean) {
    // Preserve the directory itself: a preview server may have it as its CWD
    // on Windows, which permits replacing every child but refuses rmdir.
    for (const entry of await readdir(OUTPUT_ROOT)) {
      await rm(join(OUTPUT_ROOT, entry), { recursive: true, force: true })
    }
  }
  if (copyStatic) await copyStaticAssets()

  await esbuild.build({
    absWorkingDir: SOURCE_ROOT,
    bundle: true,
    entryPoints: [WORKER_ENTRY],
    format: 'esm',
    legalComments: 'none',
    logLevel: 'warning',
    minify: production,
    outfile: join(OUTPUT_ROOT, 'packed-store.worker.js'),
    platform: 'browser',
    sourcemap: production ? false : 'inline',
    target: ['es2022'],
    tsconfig: TSCONFIG,
  })

  const result = await esbuild.build({
    absWorkingDir: SOURCE_ROOT,
    assetNames: 'media/[name]-[hash]',
    bundle: true,
    // Only compiler-owned lazy chunks receive generated names. Runtime
    // signature URLs stay external and are imported verbatim from /opfs/**.
    chunkNames: 'chunk-[name]-[hash]',
    entryNames: '[name]',
    entryPoints: [MAIN_ENTRY],
    format: 'esm',
    legalComments: 'none',
    loader: {
      '.gif': 'file',
      '.jpeg': 'file',
      '.jpg': 'file',
      '.png': 'file',
      '.svg': 'file',
      '.ttf': 'file',
      '.webp': 'file',
      '.woff': 'file',
      '.woff2': 'file',
    },
    logLevel: 'warning',
    metafile: true,
    minify: production,
    outdir: OUTPUT_ROOT,
    platform: 'browser',
    plugins: [packedWorkerUrlPlugin],
    sourcemap: production ? false : 'inline',
    splitting: true,
    target: ['es2022'],
    treeShaking: true,
    tsconfig: TSCONFIG,
  })

  const { name: styleName, integrity: styleIntegrity, version: styleVersion } = await compileStyles(production)
  const mainName = findMainOutput(result.metafile)
  const mainVersion = createHash('sha256')
    .update(await readFile(join(OUTPUT_ROOT, mainName)))
    .digest('hex')
    .slice(0, 16)
  await writeIndex({ mainName, mainVersion, styleName, styleIntegrity, styleVersion })

  const mainStats = await stat(join(OUTPUT_ROOT, mainName))
  const styleStats = await stat(join(OUTPUT_ROOT, styleName))
  console.log(
    `[web-build] ${production ? 'production' : 'development'} ready in `
    + `${Math.round(performance.now() - started)}ms — `
    + `${mainName} ${(mainStats.size / 1024).toFixed(1)}KB, `
    + `${styleName} ${(styleStats.size / 1024).toFixed(1)}KB`,
  )
  return { mainName, styleName }
}

const invokedDirectly = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  buildWeb({ production: !process.argv.includes('--development') })
    .catch(error => {
      console.error('[web-build] failed', error)
      process.exitCode = 1
    })
}
