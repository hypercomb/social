import { describe, expect, it } from 'vitest'
import { sourceDocuments } from './dev-source-catalog.js'

describe('development source catalog', () => {
  it('keeps current workspace TypeScript and excludes dependencies and tests', () => {
    expect(sourceDocuments({
      sources: [
        '../hypercomb-essentials/src/assistant/hive-tree-reader.ts',
        'src/app/app.ts',
        '../../../node_modules/rxjs/index.ts',
        '../hypercomb-core/src/store.spec.ts',
        '../hypercomb-shared/types.d.ts',
      ],
      sourcesContent: ['reader source', 'app source', 'dependency', 'test', 'types'],
    })).toEqual([
      { name: 'hypercomb-essentials/src/assistant/hive-tree-reader.ts', text: 'reader source' },
      { name: 'hypercomb-dev/src/app/app.ts', text: 'app source' },
    ])
  })
})
