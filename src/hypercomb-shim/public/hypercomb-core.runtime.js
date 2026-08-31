// hypercomb-shim/public/hypercomb-core.runtime.js
// The angular-free runtime ABI. resolveImportMap() pins '@hypercomb/core' at
// this path, so every bee's core import resolves here rather than through a
// bundler. `core/dist` is produced by scripts/build-vendor.mjs.

export * from './core/dist/index.js'
