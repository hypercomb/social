import { Intent } from "../intent.js";

export const SAMPLE_INTENT: Intent = {
  signature: 'intent.navigate.create',

  title: 'Create or Navigate to Path',

  summary: 'Navigates to a path, creating it if it does not already exist.',

  effects: [
    'history',
    'filesystem',
    'render'
  ],

  grammar: [
    {
      example: 'docs/api',
      meaning: 'Navigate to or create the docs/api path'
    },
    {
      example: 'notes/today',
      meaning: 'Open today’s notes, creating them if needed'
    }
  ],
  sources: [
    {
      label: 'Hypercomb Core',
      url: 'https://hypercomb.io',
      trust: 'official'
    }
  ]
}
