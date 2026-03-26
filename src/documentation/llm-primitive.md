# The Hypercomb Primitive

This is the hypergraph primitive that gives Hypercomb its name.

## Hypergraph, Not Graph

A graph connects two nodes with an edge. A **hypergraph** connects any number of nodes with a single **hyperedge** — an edge that relates an arbitrary set of vertices in one operation.

In Hypercomb:

- **Vertices** are signatures — content-addressed nodes (tiles, resources, lineages, LLM responses). Every piece of content has a deterministic SHA-256 identity.
- **Hyperedges** are LLM commands — a single invocation that reads from N input signatures and writes to M output signatures through an intelligence transform.

```
/select[tile-a, tile-b, tile-c]/opus('[lineage1, sig2, sig3]')
```

This single command is a hyperedge connecting **six vertices**: three context sources (input) and three target tiles (output). The result — a new signature stored in `__resources__/` — becomes a seventh vertex, immediately available as input to future hyperedges.

A traditional graph edge is binary: A → B. A hyperedge is N-ary: {A, B, C} → {D, E, F}. This is what makes it a **hyper**comb, not just a comb.

```
         ┌─────────────┐
 sig₁ ───┤             ├─── tile-a ← response sig
 sig₂ ───┤  /opus      ├─── tile-b ← response sig
 sig₃ ───┤  hyperedge  ├─── tile-c ← response sig
         └─────────────┘
                │
                ▼
         __resources__/{SHA-256(response)}
         (new vertex in the hypergraph)
```

## Why This Matters

In a regular graph, sharing context between nodes requires explicit pairwise connections — O(n²) links. In a hypergraph, a single hyperedge captures the relationship between all participants at once. The LLM is the transform function at the center of the hyperedge, turning many inputs into many outputs in one atomic operation.

Because the output is itself a signature, it can participate in the next hyperedge. The hypergraph grows through composition:

```
Hyperedge 1:  {lineage/cigars, lineage/wine} → {summary-tile}     → sig_A
Hyperedge 2:  {sig_A, lineage/recipes}        → {pairing-tile}     → sig_B
Hyperedge 3:  {sig_B, sig_A}                  → {recommendation}   → sig_C
```

Each step reads the output of previous steps without any coupling between them. The signatures are the only contract. The hypergraph is the emergent structure — never declared, always derivable from the signatures and the operations that produced them.

## The Comb

The hexagonal grid is not decoration. A honeycomb is a tessellation where every cell shares walls with its neighbors — a spatial hypergraph where adjacency is the default relationship. The hex grid is the visual projection of the hypergraph: each tile is a vertex, and the LLM commands that flow between them are hyperedges rendered as spatial relationships.

The comb is the data structure. The hyper is the intelligence.

## How It Works

A user selects tiles and invokes one of three model commands:

```
/select[tile-a, tile-b]/opus('[cigars/brands, abc123...sig]')
/select[tile]/sonnet('[lineage-path]')
/select[tile]/haiku('[sig1, sig2]')
```

The system:

1. **Gathers context** from the referenced lineages (folder trees) and signatures (content-addressed blobs)
2. **Sends** the assembled context to the chosen Claude model via the Anthropic Messages API
3. **Stores the response** as a content-addressed resource: `__resources__/{SHA-256(response)}`
4. **Writes the response signature** into each selected tile's properties

The response is now a first-class vertex in the hypergraph.

## Recursive Composition

Because signatures reference other signatures, and lineages expand to trees of seeds (each with their own properties and signatures), the context surface of any hyperedge is unbounded.

A single `/opus('[cigars/brands]')` pulls in an entire subtree. The response signature from that call becomes input to the next:

```
/select[summary]/sonnet('[{first-response-sig}]')
```

This is hyperedge chaining. Each step's output vertex feeds the next step's input set. No coupling. No coordination. Just signatures.

## Cross-Domain Reach

Any domain that publishes content to the same signature-addressed OPFS becomes a vertex source. A peer on `meadowverse.ca` publishes a lineage — you reference its signature in your `/opus` call — and the hyperedge spans domains without either party building an integration.

No API contracts. No negotiation. The signature IS the integration point. The hypergraph is not bounded by any single domain, instance, or runtime.

## Toward Hyper-Runtime

The command syntax is an instruction set for hyperedge construction:

- **select** targets output vertices (tiles)
- **model** chooses the transform function (opus/sonnet/haiku)
- **context refs** declare input vertices (lineages/signatures)

A sequence of these commands is a program. A program that writes vertices which feed subsequent programs is a runtime. A runtime where every intermediate result is a content-addressed, verifiable, shareable signature is a **hyper-runtime** — computation as a growing hypergraph.

## Provider Pattern

The harness is extensible. Model selection is the first dimension of the hyperedge transform. Future providers add:

- Structured request types (typed output schemas — constrained hyperedges)
- System prompt templates (domain-specific transforms)
- Multi-step chains (hyperedge pipelines)
- Output routing (create child seeds, update properties, emit effects)

All composable with the same signature-based vertex mechanism.

## API Key

The Anthropic API key is stored in the browser's `localStorage` under `hc:anthropic-api-key`. It never enters the codebase or OPFS. Each user connects their own account at runtime:

```js
localStorage.setItem('hc:anthropic-api-key', 'sk-ant-...')
```

## Available Models

| Command | Alias | Model ID | Role |
|---------|-------|----------|------|
| `/opus` | `/o` | `claude-opus-4-6` | Deep reasoning, complex synthesis |
| `/sonnet` | `/s` | `claude-sonnet-4-6` | Balanced intelligence and speed |
| `/haiku` | `/h` | `claude-haiku-4-5-20251001` | Fast, lightweight transforms |

The model choice is a property of the hyperedge — the same input and output vertices can be connected through different transforms depending on the depth of intelligence required.
