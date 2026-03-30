// builders/signature-cache/index.js
// Custom Angular builder: wraps @angular/build:application and dev-server,
// injecting the signature-cache esbuild plugin for byte-level compiled output caching.

const { createBuilder } = require('@angular-devkit/architect')
const { join } = require('path')
const { signatureCachePlugin } = require('./plugin')

async function* runBuild(options, context) {
  const cacheDirectory = join(context.workspaceRoot, '.angular', 'signature-cache')

  const cachePlugin = signatureCachePlugin({
    cacheDirectory,
    verbose: !!process.env['SIG_CACHE_VERBOSE'],
  })

  const { buildApplication } = await import('@angular/build')
  yield* buildApplication(options, context, {
    codePlugins: [cachePlugin],
  })
}

async function* runDevServer(options, context) {
  const cacheDirectory = join(context.workspaceRoot, '.angular', 'signature-cache')

  const cachePlugin = signatureCachePlugin({
    cacheDirectory,
    verbose: !!process.env['SIG_CACHE_VERBOSE'],
  })

  const { executeDevServer } = await import('@angular/build/src/builders/dev-server')
  yield* executeDevServer(options, context, {
    buildPlugins: [cachePlugin],
  })
}

module.exports = createBuilder((options, context) => runBuild(options, context))

module.exports.serveApplication = createBuilder((options, context) =>
  runDevServer(options, context)
)
