// diamondcoreprocessor.com/tutorial/lessons/lesson-kit.ts
//
// The handful of moves every lesson needs, so no lesson has to depend on
// another one having run first. A lesson may be run ALONE (`/tutorial select`)
// or as the fifth step of a course — it must behave the same either way, so it
// asks the stage what is on the page and makes what it needs.

import type { TutorialStage } from '../tutorial-stage.js'
import { lessonCoverImage } from '../tutorial-images.js'

/** A cover factory bound to a hue seed — deterministic per lesson tile. */
export const cover = (seed: number) => (): Promise<Blob> => lessonCoverImage(seed)

/**
 * A tile to work on. Reuses whatever is already on the page (so a course's
 * later lessons build on the earlier ones' work) and creates one otherwise
 * (so the lesson stands alone).
 */
export const subject = async (stage: TutorialStage, name: string, seed = 0): Promise<string> => {
  const have = stage.labels().filter(Boolean)
  if (have.length > 0) return have[0]
  return stage.create(name, cover(seed))
}

/**
 * At least `n` tiles on the page, creating the shortfall in ONE bracket commit.
 * Returns the labels to work with, existing ones first.
 */
export const subjects = async (
  stage: TutorialStage,
  n: number,
  names: readonly string[],
  seed = 0,
): Promise<string[]> => {
  const have = stage.labels().filter(Boolean)
  if (have.length >= n) return have.slice(0, n)
  const missing = names.slice(0, n - have.length)
  const made = missing.length ? await stage.createMany(missing, i => lessonCoverImage(seed + i)) : []
  return [...have, ...made].slice(0, n)
}

/** Fly beside a cell, ring it, and drop the ring again after the beat. */
export const showCell = async (stage: TutorialStage, label: string): Promise<void> => {
  await stage.flyToCell(label)
}

/**
 * Is a slash behaviour registered in THIS build? A lesson teaching a behaviour
 * that was never installed — or has been retired — must drop out of the course
 * rather than leave a broken step. Answers optimistically before the registry
 * is up: the course gates again when the lesson actually runs.
 */
export const hasBehaviour = (name: string): boolean => {
  const drone = window.ioc.get<{ entries?: () => { name: string; hidden?: boolean }[] }>(
    '@diamondcoreprocessor.com/SlashBehaviourDrone')
  const entries = drone?.entries?.()
  if (!entries) return true
  return entries.some(e => e?.name === name)
}

/**
 * Is a WINDOW mounted in this build? The same question `hasBehaviour` asks, one
 * layer up: the windows course teaches one tool window per lesson, and a shell
 * that never registered a surface must lose that lesson rather than open
 * nothing and narrate over an empty screen.
 *
 * `name` is the surface's registered name — its selector by convention
 * (`hc-tags-viewer`). Answers optimistically before the registry is up; the
 * course gates again when the lesson actually runs.
 */
export const hasWindow = (name: string): boolean => {
  const registry = window.ioc.get<{ all?: () => { name: string }[] }>(
    '@hypercomb.social/ShellSurfaceRegistry')
  const surfaces = registry?.all?.()
  if (!surfaces) return true
  return surfaces.some(s => s?.name === name)
}
