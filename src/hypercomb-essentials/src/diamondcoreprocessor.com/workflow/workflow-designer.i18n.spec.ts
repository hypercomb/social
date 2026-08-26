// workflow-designer.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years; a
// module-carried catalog must not inherit that. This pins the exact key set
// and its presence in every locale.
//
// `workflow.step.nested` and `workflow.step.unset` are SHARED with
// workflow-view.drone.ts — carried here, left in the shell.

import { describe, expect, it } from 'vitest'
import { WORKFLOW_DESIGNER_TRANSLATIONS } from './workflow-designer.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'workflow.apply',
  'workflow.close',
  'workflow.create',
  'workflow.create.label',
  'workflow.declare',
  'workflow.field.args',
  'workflow.field.args.placeholder',
  'workflow.field.command',
  'workflow.field.command.placeholder',
  'workflow.field.model',
  'workflow.field.model.placeholder',
  'workflow.field.text',
  'workflow.field.text.placeholder',
  'workflow.inspector.title',
  'workflow.intro',
  'workflow.log.asked',
  'workflow.log.title',
  'workflow.name.label',
  'workflow.name.placeholder',
  'workflow.palette.add',
  'workflow.palette.drag',
  'workflow.palette.more',
  'workflow.palette.retype',
  'workflow.palette.search',
  'workflow.root.hint',
  'workflow.run',
  'workflow.run.next',
  'workflow.run.progress',
  'workflow.run.stepwise',
  'workflow.run.stop',
  'workflow.run.title',
  'workflow.skills.hint',
  'workflow.skills.title',
  'workflow.step.nested',
  'workflow.step.unset',
  'workflow.steps.empty',
  'workflow.steps.title',
  'workflow.title',
  'workflow.tokens.hint',
].sort()

describe('workflow-designer catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(WORKFLOW_DESIGNER_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(WORKFLOW_DESIGNER_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(WORKFLOW_DESIGNER_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    const prefixes = ["workflow."]
    for (const catalog of Object.values(WORKFLOW_DESIGNER_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(prefixes.some(prefix => key.startsWith(prefix)), key).toBe(true)
      }
    }
  })
})
