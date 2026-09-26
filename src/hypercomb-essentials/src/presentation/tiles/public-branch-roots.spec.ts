// public-branch-roots.spec.ts — what a swarm join publishes: the public-branch
// roots that are direct children of the location you stand in, never a deeper
// branch, never a single public tile (documentation/deployment-stages.md §4.2).
import { beforeEach, describe, expect, it } from 'vitest'
import { publicBranchRootsAt, setBranchPublic, setCellPublic } from './tile-public.js'

beforeEach(() => { localStorage.clear() })

describe('publicBranchRootsAt', () => {
  it('lists the public branches directly under the location, as segments', () => {
    setBranchPublic('/', 'Site', true)
    setBranchPublic('/', 'blog', true)
    setBranchPublic('/site', 'deep', true)      // a branch one level down — not a root here
    setCellPublic('/', 'note', true)            // a single public tile — never published by a join
    expect(publicBranchRootsAt('/')).toEqual([['site'], ['blog']])
    // Standing INSIDE the public branch `site`: that branch is offered, and
    // so is the public branch directly under where you stand.
    expect(publicBranchRootsAt('/site')).toEqual([['site'], ['site', 'deep']])
    expect(publicBranchRootsAt('/Site')).toEqual([['site'], ['site', 'deep']])   // raw and normalized paths agree
    expect(publicBranchRootsAt('/site/deep/page')).toEqual([['site'], ['site', 'deep']])
  })

  it('is empty where nothing is a public branch', () => {
    expect(publicBranchRootsAt('/')).toEqual([])
    setBranchPublic('/', 'site', true)
    expect(publicBranchRootsAt('/elsewhere')).toEqual([])
  })
})
