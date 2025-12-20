// src/app/core/diamond-core/diamond-core.processor.ts

import { Injectable, signal } from '@angular/core'
import {
  IntentParticle,
  IntentFieldSnapshot,
  SafetyClass
} from '../intent/models/intent-field.model'
import { ActiveContext } from './active-content.model'
import { reinforce, decay } from './diamond-core-helpers'
import { DiamondCommit } from './diamond-core.model'
import { selectIntentFieldContext } from './intent-field.selector'
import { SafetyPolicy } from '../safety/safety-policy.service'
import { OPERATION_SAFETY_OVERRIDES } from '../safety/operation-safety.registry'
import { OperationResult } from '../operations/operation-result.model'
import { OPERATIONS } from '../operations/operation.registry'
import { LiveExecutionSink } from '../execution/live-execution.sink'
import { PreflightRunner } from '../preflight/preflight.runner'
import { CommitDraft } from './commit-draft.model'

@Injectable({ providedIn: 'root' })
export class DiamondCoreProcessor {

  // ─────────────────────────────────────────────
  // internal state
  // ─────────────────────────────────────────────

  private particles: IntentParticle[] = []
  private active?: ActiveContext

  // ─────────────────────────────────────────────
  // observable snapshot
  // ─────────────────────────────────────────────

  private readonly _snapshot = signal<IntentFieldSnapshot>({
    particles: [],
    pendingBridge: false,
    timestamp: performance.now()
  })

  public readonly snapshot = this._snapshot.asReadonly()

  constructor(
    private readonly safetyPolicy: SafetyPolicy,
    private readonly preflight: PreflightRunner,
    private readonly executionSink: LiveExecutionSink
  ) {}

  // ─────────────────────────────────────────────
  // sensing
  // ─────────────────────────────────────────────

  public sense(
    particle: Omit<IntentParticle, 'weight' | 'ageMs' | 'lastUpdated'>
  ): void {
    const now = performance.now()

    const existing = this.particles.find(p =>
      p.intent.key === particle.intent.key &&
      p.plane === particle.plane &&
      p.source === particle.source
    )

    if (existing) {
      existing.weight = reinforce(existing.weight, particle.intent.confidence)
      existing.lastUpdated = now
      existing.ageMs = 0
    } else {
      this.particles.push({
        ...particle,
        weight: particle.intent.confidence,
        ageMs: 0,
        lastUpdated: now
      })
    }

    this._snapshot.set({
      particles: [...this.particles],
      pendingBridge: false,
      timestamp: now
    })
  }

  // ─────────────────────────────────────────────
  // commit (draft → resolved → execute)
  // ─────────────────────────────────────────────

  public commit(draft: CommitDraft): void {
    this.applyDecay()

    const snapshot = this._snapshot()
    const intent = selectIntentFieldContext(snapshot)

    const operationKey = intent.dominantIntent
    if (!operationKey) {
      this.collapse()
      return
    }

    // ── safety resolution ──────────────────────

    const baseSafety = this.resolveSafety(snapshot.particles)
    const effectiveSafety = this.resolveEffectiveSafety(
      baseSafety,
      operationKey
    )

    if (effectiveSafety === 'unsafe') {
      this.collapse()
      return
    }

    if (
      effectiveSafety === 'restricted' &&
      !this.safetyPolicy.allows({
        lineage: draft.lineage,
        operationKey
      })
    ) {
      this.collapse()
      return
    }

    // ── promote draft → commit ─────────────────

    const commit: DiamondCommit = {
      lineage: draft.lineage,
      intent,
      selection: draft.selection
    }

    // ── preflight (capabilities + shaping) ─────

    const preflight = this.preflight.run(commit)
    if (!preflight.allowed) {
      this.collapse()
      return
    }

    // ── execution ──────────────────────────────

    this.resolveActive(commit)
    this.execute(commit, operationKey)
    this.collapse()
  }

  // ─────────────────────────────────────────────
  // execution
  // ─────────────────────────────────────────────

  private execute(commit: DiamondCommit, operationKey: string): void {
    const operation = OPERATIONS.find(op => op.key === operationKey)
    if (!operation) return
    if (!operation.canRun(commit)) return

    const result = operation.run(commit)
    this.applyOperationResult(result, commit)

    // side-effect sink (live or sandbox)
    this.executionSink.execute(commit)
  }

  private applyOperationResult(
    result: OperationResult | void,
    commit: DiamondCommit
  ): void {
    if (!result) return

    if (result.promoteActiveId) {
      this.setActive({
        key: result.promoteActiveId,
        kind: 'tile',
        lineage: commit.lineage,
        source: 'operation',
        expiresOnCommit: false
      })
    }

    if (result.clearActive) {
      this.active = undefined
    }
  }

  // ─────────────────────────────────────────────
  // safety helpers
  // ─────────────────────────────────────────────

  private resolveSafety(particles: IntentParticle[]): SafetyClass {
    if (particles.some(p => p.safetyClass === 'unsafe')) return 'unsafe'
    if (particles.some(p => p.safetyClass === 'restricted')) return 'restricted'
    return 'safe'
  }

  private resolveEffectiveSafety(
    base: SafetyClass,
    operationKey: string
  ): SafetyClass {
    const override = OPERATION_SAFETY_OVERRIDES.find(
      o => o.operationKey === operationKey
    )

    if (!override) return base
    if (override.safety === 'unsafe') return 'unsafe'
    if (override.safety === 'restricted' && base === 'safe') return 'restricted'
    return base
  }

  // ─────────────────────────────────────────────
  // active + lifecycle
  // ─────────────────────────────────────────────

  private resolveActive(commit: DiamondCommit): void {
    if (commit.selection?.primarySeed) {
      this.setActive({
        key: commit.selection.primarySeed,
        kind: 'tile',
        lineage: commit.lineage,
        source: 'selection'
      })
      return
    }

    if (this.active?.lineage === commit.lineage) return
    this.active = undefined
  }

  private setActive(next: ActiveContext): void {
    if (this.active?.locked) return
    this.active = next
  }

  private applyDecay(): void {
    const now = performance.now()

    this.particles = this.particles
      .map(p => {
        const age = now - p.lastUpdated
        return {
          ...p,
          weight: decay(p.weight, age / 1000),
          ageMs: age,
          lastUpdated: now
        }
      })
      .filter(p => p.weight > 0.05)
  }

  private collapse(): void {
    this.particles = []
    if (this.active?.expiresOnCommit !== false) {
      this.active = undefined
    }
  }
}
