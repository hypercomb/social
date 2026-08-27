const strategies = [
  { id: 'repo/file-role', dimension: 'intent', target: 'Classify a file before deciding whether and how deeply to read it.', saving: 'Avoids spending model context on generated, vendored, fixture, or otherwise low-value content.' },
  { id: 'repo/language-format', dimension: 'representation', target: 'Identify the language and whether the bytes are useful as text.', saving: 'Selects the right parser or prompt path without rediscovering the format.' },
  { id: 'repo/generated-file', dimension: 'provenance', target: 'Detect generated files from stable path, extension, and banner signals.', saving: 'Skips analysis that should be performed on the source rather than regenerated output.' },
  { id: 'repo/symbol-inventory', dimension: 'public-surface', target: 'Cache the named program concepts exposed by a content signature.', saving: 'Answers common code-navigation questions without rereading the file.' },
  { id: 'repo/dependency-edges', dimension: 'topology', target: 'Cache imports, exports, requires, and dynamic-import edges.', saving: 'Builds dependency context by lookup instead of repeated source scans.' },
  { id: 'repo/test-signals', dimension: 'validation', target: 'Recognize tests and their framework signals.', saving: 'Finds validation coverage and relevant test commands without repeated classification.' },
  { id: 'repo/entrypoint-signals', dimension: 'execution', target: 'Recognize likely application, package, server, and CLI entry points.', saving: 'Lets agents begin investigation at high-information files.' },
]

const compositions = [
  { id: 'safe-skip', inputs: ['repo/file-role', 'repo/language-format', 'repo/generated-file'], result: 'Decide whether reading the content is useful before allocating model context.' },
  { id: 'best-starting-point', inputs: ['repo/file-role', 'repo/symbol-inventory', 'repo/entrypoint-signals'], result: 'Rank high-information files for a new investigation.' },
  { id: 'change-impact', inputs: ['repo/symbol-inventory', 'repo/dependency-edges', 'repo/test-signals'], result: 'Estimate what a change affects and which validation is relevant.' },
  { id: 'execution-map', inputs: ['repo/dependency-edges', 'repo/entrypoint-signals'], result: 'Trace likely runtime flow without rereading every file.' },
  { id: 'confidence-by-agreement', inputs: ['repo/file-role', 'repo/generated-file', 'repo/test-signals'], result: 'Use independent signals to strengthen or challenge a classification.' },
]

const scoutTargets = [
  { id: 'math/set-algebra', dimension: 'set-theory', opportunity: 'Cache unions, intersections, differences, containment, and membership over signed sets.', use: 'Compose symbol, dependency, test, and history facts without rescanning their source documents.' },
  { id: 'math/graph-closure', dimension: 'graph-theory', opportunity: 'Cache reachability, transitive closure, strongly connected components, and topological layers for signed graphs.', use: 'Answer impact, ownership, dependency, and execution-flow questions by lookup.' },
  { id: 'math/decision-table', dimension: 'boolean-algebra', opportunity: 'Cache canonical truth-table and rule-normalization results.', use: 'Resolve repeated policy, feature-flag, capability, and routing decisions exactly.' },
  { id: 'math/sequence-diff', dimension: 'sequence-algebra', opportunity: 'Cache exact ordered differences and accumulated changes between signed histories.', use: 'Explain branch evolution while reusing unchanged historical comparisons.' },
  { id: 'math/normal-form', dimension: 'algebra', opportunity: 'Cache canonical normal forms for expressions, paths, constraints, and schemas.', use: 'Recognize equivalent inputs and collapse them onto one reusable result.' },
  { id: 'math/table-lookup', dimension: 'finite-functions', opportunity: 'Materialize frequently repeated finite computations when verified lookup costs less than evaluation.', use: 'Optimize even very small computations; retain atomic signatures while coalescing tiny answer bytes into indexed immutable packs.' },
]

module.exports = { strategies, compositions, scoutTargets }
