// The two private tables of Pixi's no-eval build, imported by lounge-3d.ts
// for the uniform-parser bridge. They sit outside Pixi's export map, so the
// site build resolves the paths itself (intel-build-revolucion-site.ts,
// bundleLounge); these declarations only give them a type.

declare module 'pixi.js/lib/unsafe-eval/uniforms/uniformSyncFunctions.mjs' {
  export const uniformParserFunctions: unknown[]
}

declare module 'pixi.js/lib/unsafe-eval/ubo/uboSyncFunctions.mjs' {
  export const uboParserFunctions: unknown[]
}
