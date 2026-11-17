// hypercomb-shared/ui/docs-overlay/docs-index.ts
//
// The docs browser's index: the documents its sidebar lists, by category.
// Every file here must exist under documentation/ (docs-markdown.spec.ts
// holds it to that), and any document can still be opened by a link from
// another, listed or not.

/** The hive's own doctrine: not a file, the page the anatomy writes from the
 *  `/doctrine` tiles — exactly what every model is sent. */
export const DOCTRINE_PAGE = 'doctrine'

export interface DocEntry {
  title: string
  file: string
  category: string
}

export const DOC_INDEX: DocEntry[] = [
  // The doctrine, first: read from this hive's tiles, never from a file.
  { category: 'Doctrine', title: 'Doctrine', file: DOCTRINE_PAGE },

  // Architecture & Core Design
  { category: 'Architecture & Core Design', title: 'Core Processor Architecture', file: 'core-processor-architecture.md' },
  { category: 'Architecture & Core Design', title: 'Universal History Plan', file: 'universal-history-plan.md' },

  // Cryptographic & Content Addressing
  { category: 'Cryptographic & Content Addressing', title: 'Signature System', file: 'signature-system.md' },
  { category: 'Cryptographic & Content Addressing', title: 'Signature Algebra', file: 'signature-algebra.md' },
  { category: 'Cryptographic & Content Addressing', title: 'Signature Node Pattern', file: 'signature-node-pattern.md' },
  { category: 'Cryptographic & Content Addressing', title: 'Collapsed Compute', file: 'collapsed-compute.md' },
  { category: 'Cryptographic & Content Addressing', title: 'Deterministic Computation', file: 'deterministic-computation.md' },
  { category: 'Cryptographic & Content Addressing', title: 'Revision Mode', file: 'revision-mode.md' },

  // Protocol & Wire Format
  { category: 'Protocol & Wire Format', title: 'Byte Protocol', file: 'byte-protocol.md' },
  { category: 'Protocol & Wire Format', title: 'Protocol Spec', file: 'protocol-spec.md' },
  { category: 'Protocol & Wire Format', title: 'Dependency Signing', file: 'dependency-signing.md' },

  // Concepts & Domain Model
  { category: 'Concepts & Domain Model', title: 'Glossary', file: 'glossary.md' },
  { category: 'Concepts & Domain Model', title: 'DNA', file: 'dna.md' },
  { category: 'Concepts & Domain Model', title: 'Trail Capsule', file: 'trail-capsule.md' },
  { category: 'Concepts & Domain Model', title: 'LLM Primitive', file: 'llm-primitive.md' },
  { category: 'Concepts & Domain Model', title: 'Emergence', file: 'emergence.md' },

  // UI & Rendering
  { category: 'UI & Rendering', title: 'Tile Overlay Architecture', file: 'tile-overlay-architecture.md' },

  // Developer Guides
  { category: 'Developer Guides', title: 'Getting Started', file: 'getting-started.md' },
  { category: 'Developer Guides', title: 'Contributing', file: 'contributing.md' },
  { category: 'Developer Guides', title: 'Command Line Reference', file: 'command-line-reference.md' },
  { category: 'Developer Guides', title: 'Slash Behaviour Reference', file: 'slash-behaviour-reference.md' },
  { category: 'Developer Guides', title: 'Slash Command Authoring', file: 'slash-command-authoring.md' },
  { category: 'Developer Guides', title: 'Simple Naming Initiative', file: 'simple-naming-initiative.md' },

  // Infrastructure
  { category: 'Infrastructure', title: 'Infrastructure', file: 'infrastructure.md' },
  { category: 'Infrastructure', title: 'Meadowverse Pipeline', file: 'lets-discover-meadowverse-pipeline.md' },

  // Security & Governance
  { category: 'Security & Governance', title: 'Security', file: 'security.md' },
  { category: 'Security & Governance', title: 'Social Governance', file: 'social-governance.md' },
  { category: 'Security & Governance', title: 'Meetings and Quorum', file: 'meetings-and-quorum.md' },
  { category: 'Security & Governance', title: 'Code of Conduct', file: 'code-of-conduct.md' },

  // Legal & Licensing
  { category: 'Legal & Licensing', title: 'Licensing', file: 'licensing.md' },
  { category: 'Legal & Licensing', title: 'Contributor Agreement', file: 'contributor-agreement.md' },
  { category: 'Legal & Licensing', title: 'Trademarks', file: 'trademarks.md' },

  // Bee Story
  { category: 'Bee Story', title: 'The Bee', file: 'bee-story/the-bee.md' },
  { category: 'Bee Story', title: 'The Colony', file: 'bee-story/the-colony.md' },
  { category: 'Bee Story', title: 'The Dance', file: 'bee-story/the-dance.md' },
  { category: 'Bee Story', title: 'The Economy', file: 'bee-story/the-economy.md' },
  { category: 'Bee Story', title: 'The Hive', file: 'bee-story/the-hive.md' },
  { category: 'Bee Story', title: 'The Memory', file: 'bee-story/the-memory.md' },
  { category: 'Bee Story', title: 'The Scent', file: 'bee-story/the-scent.md' },
  { category: 'Bee Story', title: 'The Seal', file: 'bee-story/the-seal.md' },
  { category: 'Bee Story', title: 'The Swarm', file: 'bee-story/the-swarm.md' },
]
