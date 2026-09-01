import { describe, expect, it } from 'vitest'
import {
  keywordGenerationPrompt,
  normalizeKeywordGroups,
  parseKeywordProposal,
} from './keyword-proposals.js'

describe('keyword proposals', () => {
  it('parses grouped fenced JSON, de-duplicates globally, and cleans labels', () => {
    const groups = parseKeywordProposal(`
Here are the proposals:
\`\`\`json
{"groups":[
  {"name":"Themes","keywords":[" spatial knowledge ","AI","#AI"]},
  {"name":"Actions","keywords":["ship mobile","spatial knowledge"]}
]}
\`\`\`
`)
    expect(groups).toEqual([
      { name: 'Themes', keywords: ['spatial knowledge', 'AI'] },
      { name: 'Actions', keywords: ['ship mobile'] },
    ])
  })

  it('accepts a bare keyword array as one logical group', () => {
    expect(normalizeKeywordGroups(['alpha', 'beta'])).toEqual([
      { name: 'Keywords', keywords: ['alpha', 'beta'] },
    ])
  })

  it('asks for bounded JSON without giving the model write authority', () => {
    const prompt = keywordGenerationPrompt('we discussed launch timing')
    expect(prompt).toContain('Return ONLY JSON')
    expect(prompt).toContain('Do not invent')
    expect(prompt).toContain('we discussed launch timing')
  })
})
