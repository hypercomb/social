// src/intents/global/portal.open.intent.ts

import { Intent } from '../intent.js'

export const PORTAL_OPEN_INTENT: Intent = {
  signature: 'portal.open',

  scope: 'global',
  implicit: true,

  title: 'Open Creation Portal',

  summary: 'Opens the global creation portal.',

  description:
    'This action represents the canonical entry into Hypercomb’s intent space. ' +
    'It is implicitly invoked when the user types `#`. ' +
    'Execution is handled by the Diamond Core Processor and produces no side effects. ' +
    'The portal exposes available actions and links to documentation for creating new ones.',

  grammar: [
    {
      example: '#',
      meaning: 'Enter creation mode and open the global action portal'
    }
  ],

  links: [
    {
      label: 'Diamond Core Processor',
      url: 'https://diamondcoreprocessor.com',
      trust: 'official',
      purpose: 'Learn how intents are evaluated and how to author new actions'
    }
  ]
}
