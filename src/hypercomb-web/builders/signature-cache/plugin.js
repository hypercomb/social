// builders/signature-cache/plugin.js
// Esbuild plugin: signature-addressed compiled output cache.
// Maintains a persistent registry of { sourceSignature -> compiledBytes }.
// Cache hits skip compilation entirely. Only new/changed source files compile.

const { createHash } = require('crypto')
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('fs')
const { dirname, join, relative } = require('path')

function sign(content) {
  return createHash('sha256').update(content).digest('hex')
}

function loadManifest(manifestPath) {
  if (!existsSync(manifestPath)) return { version: 1, entries: {} }
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    return { version: 1, entries: {} }
  }
}

function saveManifest(manifestPath, manifest) {
  mkdirSync(dirname(manifestPath), { recursive: true })
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
}

/**
 * @param {{ cacheDirectory: string, verbose?: boolean }} options
 * @returns {import('esbuild').Plugin}
 */
function signatureCachePlugin(options) {
  const { cacheDirectory, verbose = false } = options
  const chunksDir = join(cacheDirectory, 'chunks')
  const manifestPath = join(cacheDirectory, 'manifest.json')

  mkdirSync(chunksDir, { recursive: true })

  const manifest = loadManifest(manifestPath)
  let hits = 0
  let misses = 0
  let dirty = false

  return {
    name: 'signature-cache',
    setup(build) {
      // Track source signatures for files that miss the cache.
      // On build end, we capture their compiled output and cache it.
      const pendingResults = new Map()

      build.onLoad({ filter: /\.[cm]?[tj]sx?$/ }, async (args) => {
        // Skip node_modules — stable between builds
        if (args.path.includes('node_modules')) return undefined

        let sourceContent
        try {
          sourceContent = readFileSync(args.path, 'utf8')
        } catch {
          return undefined
        }

        const sourceSignature = sign(sourceContent)

        const cached = manifest.entries[args.path]
        if (cached && cached.sourceSignature === sourceSignature) {
          // Cache hit — serve pre-compiled bytes
          const chunkPath = join(chunksDir, `${cached.outputSignature}.js`)
          if (existsSync(chunkPath)) {
            hits++
            if (verbose) console.log(`[sig-cache] HIT  ${relative(process.cwd(), args.path)}`)
            return {
              contents: readFileSync(chunkPath, 'utf8'),
              loader: args.path.endsWith('.tsx') || args.path.endsWith('.jsx') ? 'jsx' : 'js',
            }
          }
        }

        // Cache miss — let the pipeline handle it, record for post-build caching
        misses++
        if (verbose) console.log(`[sig-cache] MISS ${relative(process.cwd(), args.path)}`)
        pendingResults.set(args.path, sourceSignature)

        return undefined
      })

      build.onEnd((result) => {
        // After build completes, cache outputs from files we missed on
        if (result.metafile) {
          for (const [outputPath, outputMeta] of Object.entries(result.metafile.outputs)) {
            for (const inputPath of Object.keys(outputMeta.inputs)) {
              const sourceSignature = pendingResults.get(inputPath)
              if (!sourceSignature) continue

              try {
                const outputContent = readFileSync(outputPath, 'utf8')
                const outputSignature = sign(outputContent)
                const chunkPath = join(chunksDir, `${outputSignature}.js`)

                if (!existsSync(chunkPath)) {
                  writeFileSync(chunkPath, outputContent, 'utf8')
                }

                manifest.entries[inputPath] = {
                  sourceSignature,
                  outputSignature,
                  byteLength: Buffer.byteLength(outputContent, 'utf8'),
                }
                dirty = true
              } catch {
                // Output may not exist for virtual modules
              }
            }
          }
        }

        if (dirty) {
          saveManifest(manifestPath, manifest)
          dirty = false
        }

        console.log(`[sig-cache] ${hits} hits, ${misses} misses (${Object.keys(manifest.entries).length} cached)`)
        hits = 0
        misses = 0
        pendingResults.clear()
      })
    },
  }
}

module.exports = { signatureCachePlugin }
