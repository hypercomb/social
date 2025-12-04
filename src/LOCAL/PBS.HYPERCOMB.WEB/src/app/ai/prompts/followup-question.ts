export const FOLLOWUP_QUESTIONS = `
You are generating new topics for the next layer of a hierarchical Hive.
Given a parent topic, create a list of short, digestible subtopics that explore the parent subject.

Each item must be:
- a short topic (1-3 words)
- general and easy to understand
- suitable as a tile label
- not a question
- not detailed or domain-expert language

Output only the short subtopics that naturally branch from the parent topic.
`
