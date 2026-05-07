// Build the Hypercomb Field Manual via the bridge.
//
// A self-documenting hex grid: every cell is a Hypercomb primitive,
// authored through the same `update` + `note-add` ops the runtime uses
// for any other content. The bridge plays the role of "external author"
// — same end result as a user typing into the command line, just done
// programmatically. Two-phase commit:
//   (1) tile structure via op `update` with { name, children }
//   (2) notes via op `note-add` (NotesService.addAtSegments)
//
// Run after `start:relay` (bridge on :2401) and a hypercomb shell with
// `?claudeBridge=1`. Re-running is idempotent — the layer-as-primitive
// `update` op replaces children atomically, and notes upsert by id.

import { send } from '../hypercomb-cli/src/bridge/client.js'

interface ManualNode {
  name: string
  notes?: string[]
  children?: ManualNode[]
}

const MANUAL: ManualNode = {
  name: 'field-manual',
  notes: [
    'A self-referential tour of Hypercomb. Each cell explains a primitive of the architecture in one paragraph, authored through the same bridge any external system would use.',
    'Read top-down or click any tile — every concept stands alone but composes with its siblings.',
  ],
  children: [
    {
      name: 'architecture',
      notes: [
        'The static structure: how a Hypercomb instance is shaped before anything runs. Five primitives — layer, signature, cell, slot, lineage — are enough to describe everything else.',
      ],
      children: [
        {
          name: 'layer',
          notes: [
            'The merkle primitive. A layer is canonical JSON describing a node\'s slots, signed by SHA-256 of its bytes. Identity = bytes; bytes change → new sig → new identity.',
            'Layers are immutable. "Editing" means committing a new layer whose sig replaces the old one in the parent\'s slot list. The chain of replacements becomes history.',
          ],
        },
        {
          name: 'signature',
          notes: [
            'SHA-256 content addressing — the universal reference. 64 hex chars; same bytes anywhere produce the same sig.',
            'Hypercomb references are signatures, never inline data. A note\'s body is a signature pointing to a resource. A cell\'s children is a list of signatures pointing to participant layers. This is what makes the system shareable, dedup-able, and time-travelable.',
          ],
        },
        {
          name: 'cell',
          notes: [
            'User-facing terminology for a tile. A cell is the rendered surface of a layer at a specific lineage path. Click a cell, you see its layer state.',
            'Cells are layers. The distinction is presentation: cell = noun in UX, layer = noun in protocol.',
          ],
        },
        {
          name: 'slot',
          notes: [
            'A named field on a layer that holds an array of signatures. children, notes, tags — each is a slot. Adding capability = registering a new slot via LayerSlotRegistry.',
            'Empty array wipes the slot. Absent ≡ empty. The committer treats the slot map as the full desired state — partial updates aren\'t a thing.',
          ],
        },
        {
          name: 'lineage',
          notes: [
            'The path a user took to get here, sequence of segments from root. Two cells with the same name at different lineages are different cells; their location-sigs differ.',
            'Lineage is the address space. Same as the user\'s breadcrumb but content-addressed at every step.',
          ],
        },
      ],
    },
    {
      name: 'runtime',
      notes: [
        'The dynamic system: services, message bus, lifecycle. Drones plug in; the IoC resolves them; the EffectBus carries cross-cutting events.',
      ],
      children: [
        {
          name: 'drone',
          notes: [
            'A self-contained module: lifecycle (sense → heartbeat → dispose), declared deps/listens/emits, self-registers in IoC at module load. The unit of feature externalization — every capability lives in one.',
          ],
        },
        {
          name: 'bee',
          notes: [
            'A drone after esbuild — flat JS bundle, named by SHA-256 of its bytes, lives in OPFS at __bees__/<sig>.js. The runtime\'s import map maps namespaces to bee URLs.',
            'Bees are signed. Hand someone the manifest, they fetch the same bytes, they run the same code.',
          ],
        },
        {
          name: 'ioc',
          notes: [
            'window.ioc — the global service locator. Drones register themselves; consumers call get(\'@scope/Name\'). whenReady(key, callback) handles load-order races.',
            'Keys follow @namespace/Name. The namespace is the domain that owns the service.',
          ],
        },
        {
          name: 'effect-bus',
          notes: [
            'Pub/sub with last-value replay. on(name, handler) — late subscribers immediately receive the most recent emit, so order-of-construction races dissolve.',
            'Used for cross-drone signaling without coupling: cell:added, notes:changed, command:enter-mode, render:set-pivot.',
          ],
        },
      ],
    },
    {
      name: 'pipeline',
      notes: [
        'How a write becomes a new merkle root. update → cascade → history. One canonical path; no slot-specific delta APIs.',
      ],
      children: [
        {
          name: 'update',
          notes: [
            'The canonical write. update(segments, layer) takes the FULL new layer state at this position; the committer replaces the existing layer atomically. Add/remove are special cases of "the new children list is X".',
            'Notes, tags, future participants — all flow through update. One write surface.',
          ],
        },
        {
          name: 'cascade',
          notes: [
            'When a layer commits, its parent\'s children slot now references a new sig — so the parent re-commits, then its parent, all the way to root. The cascade is what makes merkle work: any deep change is observable as a new root sig.',
          ],
        },
        {
          name: 'history',
          notes: [
            'Per-lineage append-only chain of layer commits. Each entry is a marker file naming the layer sig at that lineage at that moment.',
            'History is linear. Scrubbing back is view-only; "make HEAD" appends a compensating op promoting any past state to the top.',
          ],
        },
        {
          name: 'warmup',
          notes: [
            'Async hydration of the read cache before the UI asks. NotesService.warmup() walks every layer, decodes participant bodies into the in-memory cache, so subsequent itemsAt() reads are sync.',
            'The wrong way around the warmup race produces "data exists but reads return empty" — the bug we kept hitting on web.',
          ],
        },
      ],
    },
    {
      name: 'persistence',
      notes: [
        'OPFS is the substrate. Three flat directories — bees, dependencies, layers — and one user content tree. Everything else is derived.',
      ],
      children: [
        {
          name: 'opfs',
          notes: [
            'Origin Private File System. Per-origin, persistent, no permission prompt. Browser-managed but truly user-owned for the duration of the origin.',
            'Hypercomb\'s OPFS layout: __bees__/, __dependencies__/, __layers__/, __resources__/, __history__/, hypercomb.io/. The first three are install cache; the rest are user data — never wiped on routine ops.',
          ],
        },
        {
          name: 'resources',
          notes: [
            'Signature-addressed blobs in __resources__/<sig>. A note body, a renamed cell\'s cell-list snapshot, a settings preset — anything content-addressed lives here.',
            'Same sig anywhere = same bytes. Stored once, referenced from many layers.',
          ],
        },
        {
          name: 'install',
          notes: [
            'manifest.json names a package by sig; the package lists the bee/dep/layer sigs that constitute it. Install fetches each, writes to OPFS, registers the import map. Stale-detection compares bundled sig vs cached and re-installs on drift.',
          ],
        },
      ],
    },
    {
      name: 'interface',
      notes: [
        'Where the human meets the merkle tree. Selection drives focus; notes carry context; the command line and tile strip are the conversational surfaces.',
      ],
      children: [
        {
          name: 'selection',
          notes: [
            'A SelectionService tracks active (the focal cell) and selected (the multi-tile set). Both fire change events; the strip + context menu read those to drive the UI.',
          ],
        },
        {
          name: 'notes',
          notes: [
            'Free-text annotations attached to a cell. Each note is its own participant layer at sign([...parent, \'__notes__\', noteId]) — same merkle pattern as cells. The cell\'s notes slot lists participant layer sigs.',
          ],
        },
        {
          name: 'command-line',
          notes: [
            'The slash interface above every cell. /help, /language, /view-current — each maps to a slash behavior registered at boot.',
            'Note capture also lives here: type, hit Enter, the text becomes a participant layer attached to the active cell.',
          ],
        },
        {
          name: 'strip',
          notes: [
            'The thin overlay below the command line that surfaces context for the currently selected cell(s). Single-cell mode: a list of notes. Multi-cell mode: an accordion grouped per cell, with a footer for selected cells that have no notes yet.',
          ],
        },
      ],
    },
    {
      name: 'tools',
      notes: [
        'External-author surfaces. The bridge speaks the same protocol the runtime speaks; the CLI lets a developer drive it from the terminal; the SDK lets other apps embed the build pipeline.',
      ],
      children: [
        {
          name: 'bridge',
          notes: [
            'WebSocket relay on :2401 between the CLI and a running shell. Ops: update, note-add, list, inspect, history, submit. Activated on a shell with ?claudeBridge=1.',
            'Same write paths the user goes through — bridge ops just call the same EffectBus events and committer methods. No special privileges.',
          ],
        },
        {
          name: 'cli',
          notes: [
            'hypercomb build, hypercomb inspect, hypercomb bridge. Wraps the SDK for terminal use. Most pipelines just do hypercomb build and ship the dist/.',
          ],
        },
        {
          name: 'sdk',
          notes: [
            'Env-agnostic facade re-exporting the core types and the build API. Consumers (CLI, third-party tools, CI integrations) import from @hypercomb/sdk; the same surface works in Node, Bun, browsers.',
          ],
        },
      ],
    },
  ],
}

interface TileSpec {
  segments: string[]
  name: string
  children: string[]
  notes: string[]
}

function collect(node: ManualNode, segments: string[], out: TileSpec[]): void {
  const childNames = (node.children ?? []).map(c => c.name)
  out.push({
    segments: segments.slice(),
    name: node.name,
    children: childNames,
    notes: node.notes ?? [],
  })
  for (const child of node.children ?? []) {
    collect(child, [...segments, child.name], out)
  }
}

async function main(): Promise<void> {
  const tiles: TileSpec[] = []
  collect(MANUAL, [], tiles)

  const totalNotes = tiles.reduce((n, t) => n + t.notes.length, 0)
  console.log(`[field-manual] phase 1: ${tiles.length} tile structures`)
  console.log(`[field-manual] phase 2: ${totalNotes} notes`)
  console.log('')

  // Phase 1 — tile structure via update.
  let okStruct = 0, failStruct = 0
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i]
    const path = t.segments.length === 0 ? '(root)' : t.segments.join('/')
    process.stdout.write(`[struct ${i + 1}/${tiles.length}] ${path} ← ${t.children.length} children ... `)
    const layer: { name: string; children?: string[] } = { name: t.name }
    if (t.children.length) layer.children = t.children
    const res = await send({ op: 'update', segments: t.segments, layer })
    if (res.ok) { okStruct++; console.log('ok') }
    else { failStruct++; console.log(`FAIL: ${res.error}`) }
  }
  console.log('')
  console.log(`[field-manual] phase 1: ${okStruct} ok, ${failStruct} failed`)
  console.log('')

  // Phase 2 — notes via NotesService.addAtSegments.
  let okNotes = 0, failNotes = 0, noteIdx = 0
  for (const t of tiles) {
    if (!t.notes.length) continue
    if (t.segments.length === 0) {
      for (const text of t.notes) {
        noteIdx++
        const res = await send({ op: 'note-add', segments: [], cell: 'field-manual', text })
        if (res.ok) okNotes++
        else { failNotes++; console.log(`[note ${noteIdx}/${totalNotes}] root ← FAIL: ${res.error}`) }
      }
      continue
    }
    const parentSegments = t.segments.slice(0, -1)
    const cellLabel = t.segments[t.segments.length - 1]
    for (const text of t.notes) {
      noteIdx++
      process.stdout.write(`[note ${noteIdx}/${totalNotes}] ${t.segments.join('/')} ... `)
      const res = await send({ op: 'note-add', segments: parentSegments, cell: cellLabel, text })
      if (res.ok) { okNotes++; console.log('ok') }
      else { failNotes++; console.log(`FAIL: ${res.error}`) }
    }
  }
  console.log('')
  console.log(`[field-manual] phase 2: ${okNotes} ok, ${failNotes} failed`)
  console.log('')
  console.log(`[field-manual] DONE — ${okStruct} tiles + ${okNotes} notes`)
}

main().catch(err => { console.error(err); process.exit(1) })
