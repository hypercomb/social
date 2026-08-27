const { createHash } = require('node:crypto')

const KEY_PROTOCOL = 'hypercomb-heuristic/v1'
const RESULT_PROTOCOL = 'hypercomb-heuristic-result/v1'

function canonical(value) {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}

function sign(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function algorithmArtifact(definition) {
  return Buffer.from(canonical({
    protocol: KEY_PROTOCOL,
    id: definition.id,
    version: definition.version,
    operands: definition.operands || (definition.usesPath ? ['content', 'path'] : ['content']),
    source: String(definition.run),
  }))
}

function algorithmSignature(definition) {
  return sign(algorithmArtifact(definition))
}

function operandSignatures(operands) {
  if (operands == null) return []
  return Array.isArray(operands) ? operands : [operands]
}

function heuristicKey(algorithmSig, operands) {
  return sign(Buffer.from(canonical({ protocol: KEY_PROTOCOL, algorithmSig, operands: operandSignatures(operands) })))
}

function resultEnvelope(algorithmSig, operands, outcome) {
  return {
    protocol: RESULT_PROTOCOL,
    algorithmSig,
    operands: operandSignatures(operands),
    status: 'ok',
    value: outcome.value,
  }
}

function answerArtifact(value) {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (typeof value === 'string') return Buffer.from(value)
  return Buffer.from(canonical(value))
}

module.exports = { KEY_PROTOCOL, RESULT_PROTOCOL, canonical, sign, algorithmArtifact, algorithmSignature, operandSignatures, heuristicKey, resultEnvelope, answerArtifact }
