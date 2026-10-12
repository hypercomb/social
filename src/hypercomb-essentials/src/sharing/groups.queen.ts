// hypercomb-essentials/src/sharing/groups.queen.ts
//
// `groups` — the word for PUBLISH GROUPS (documentation/publish-groups.md).
// Every act has a word: the strip at the top of the hive is icons and taps,
// and a phone has no hover, a speaker no pointer, a model neither. The word
// acts on the layer you stand in, like the strip, and through the same acts
// (PublishGroupsDrone) — one implementation, two mouths.
//
//   groups                          this layer's groups and who is in them
//   groups on | off                 light or put out the strip here
//   groups new <name>               a new group — the selected tiles join it
//   groups add <group> [tiles]      tiles join (the selection when none named)
//   groups drop <group> [tiles]     tiles leave (the selection when none named)
//   groups rename <group> <name>
//   groups color <group> <colour>   blue amber green pink red violet, 1–6, #rrggbb
//   groups icon <group> <icon>
//   groups publish <group>          publish every member
//   groups ungroup <group>          take the group off the layer (undo brings it back)
//
// A group is named by its name, in any case; one with spaces is quoted —
// `groups add "my blog" one, two`. `rawArgs`: `publish` is itself a behaviour
// word, and the whole line is this word's.
//
// No `machine` grammar: publishing reaches outward, and default-deny stays
// the policy until someone decides a model may say it.
//
// No aliases: a behaviour declares none (aliases are the participant's own).

import { QueenBee, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { drawsAsGlyph } from '../commands/material-glyph.js'
import type { PublishGroupView, PublishGroupsReading } from './publish-groups.drone.js'
import {
  GROUPS_WORDS, PUBLISH_GROUPS_KIND, parseGroupsLine, resolveGroupColor,
  type PublishGroupAppearance,
} from './publish-groups.js'

const PUBLISH_GROUPS_KEY = '@diamondcoreprocessor.com/PublishGroupsDrone'

/** The acts this word asks of the drone — structural, so a word never holds
 *  the module that draws the strip. */
type GroupActs = {
  groupsAt(segments: readonly string[]): Promise<PublishGroupsReading>
  groupNamesShown(): string[]
  createGroup(segments: readonly string[], opts: { name?: string; members?: readonly string[] }): Promise<PublishGroupAppearance>
  joinGroup(segments: readonly string[], meaning: string, labels: readonly string[]): Promise<void>
  leaveGroup(segments: readonly string[], meaning: string, labels: readonly string[]): Promise<void>
  editGroup(segments: readonly string[], meaning: string, patch: Partial<Omit<PublishGroupAppearance, 'meaning'>>): Promise<void>
  ungroupAt(segments: readonly string[], meaning: string): Promise<void>
  publishGroup(segments: readonly string[], meaning: string): Promise<{ total: number; failures: string[] } | null>
}

/** Sub-words that name a group next. */
const NAMES_A_GROUP = new Set(['add', 'drop', 'rename', 'color', 'icon', 'publish', 'ungroup'])

const get = <T,>(key: string): T | undefined => window.ioc?.get?.<T>(key)

export class GroupsQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'groups'
  override description = 'Publish groups on this layer — make them, fill them, name and colour them, publish them'
  override descriptionKey = 'slash.groups'
  override options = [
    'on', 'off', 'new <name>', 'add <group> [tiles]', 'drop <group> [tiles]', 'rename <group> <name>',
    'color <group> <colour>', 'icon <group> <icon>', 'publish <group>', 'ungroup <group>',
  ]
  override examples = [
    { input: '/groups new Blog', result: 'A group called Blog on this layer — the selected tiles join it' },
    { input: '/groups add blog one, two', result: 'one and two join Blog' },
    { input: '/groups publish blog', result: 'Publishes every tile in Blog' },
  ]

  // `publish` is itself a behaviour word — the whole line is this word's.
  override rawArgs = true

  override slashComplete(args: string): readonly string[] {
    const words = args.trimStart().split(/\s+/)
    const verb = (words[0] ?? '').toLowerCase()
    if (words.length === 1) {
      return GROUPS_WORDS.map(word => `${word} `).filter(word => word.startsWith(verb) && word.trim() !== verb)
    }
    if (words.length === 2 && NAMES_A_GROUP.has(verb)) {
      const typed = (words[1] ?? '').toLowerCase()
      const names = get<GroupActs>(PUBLISH_GROUPS_KEY)?.groupNamesShown() ?? []
      return names
        .map(name => /\s/.test(name) ? `"${name}" ` : `${name} `)
        .filter(name => name.toLowerCase().replace(/"/g, '').startsWith(typed) && name.trim().toLowerCase() !== typed)
    }
    return []
  }

  protected async execute(args: string): Promise<void> {
    const acts = get<GroupActs>(PUBLISH_GROUPS_KEY)
    if (!acts) return
    const here = (get<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)
    const act = parseGroupsLine(args)
    const reading = await acts.groupsAt(here)
    const named = (name: string): PublishGroupView | undefined =>
      reading.groups.find(g => g.name.toLowerCase() === name.trim().toLowerCase())

    switch (act.verb) {
      case 'list': {
        if (!reading.on) return this.#say(this.#t('groups.not-on', 'Publish groups is not on here — `groups on` lights it'))
        if (reading.dormant) return this.#say(this.#asleep())
        if (reading.groups.length === 0) return this.#say(this.#t('groups.none', 'No groups here yet — `groups new <name>` makes one'))
        return this.#say(reading.groups
          .map(g => `${g.name} (${g.members.length})${g.members.length ? ': ' + g.members.join(', ') : ''}`)
          .join(' · '))
      }

      case 'on':
      case 'off': {
        const on = act.verb === 'on'
        if (on === reading.on) {
          return this.#say(on ? this.#t('groups.on', 'Publish groups is on here') : this.#t('groups.off', 'Publish groups is off here'))
        }
        this.#light(here, on)
        return this.#say(on && reading.dormant ? this.#asleep()
          : on ? this.#t('groups.on', 'Publish groups is on here') : this.#t('groups.off', 'Publish groups is off here'))
      }

      case 'new': {
        // A group here means the strip belongs here.
        if (!reading.on) this.#light(here, true)
        const members = this.#selection().filter(label => reading.children.includes(label))
        const made = await acts.createGroup(here, { name: act.name || undefined, members })
        return this.#say(this.#t('groups.made', `Made ${made.name}`, { name: made.name }))
      }

      case 'add':
      case 'drop': {
        const group = named(act.group)
        if (!group) return this.#say(this.#noGroup(act.group))
        const tiles = act.tiles.length ? act.tiles : this.#selection()
        if (tiles.length === 0) return this.#say(this.#t('groups.no-tiles', 'Select tiles, or name them after the group'))
        const missing = tiles.filter(label => !reading.children.includes(label))
        if (missing.length) {
          return this.#say(this.#t('groups.not-here', `Not on this layer: ${missing.join(', ')}`, { names: missing.join(', ') }))
        }
        if (act.verb === 'add') {
          const joining = tiles.filter(label => !group.members.includes(label))
          await acts.joinGroup(here, group.meaning, joining)
          return this.#say(this.#t('groups.joined', `${joining.length} joined ${group.name}`, { count: joining.length, name: group.name }))
        }
        const leaving = tiles.filter(label => group.members.includes(label))
        await acts.leaveGroup(here, group.meaning, leaving)
        return this.#say(this.#t('groups.left', `${leaving.length} left ${group.name}`, { count: leaving.length, name: group.name }))
      }

      case 'rename':
      case 'color':
      case 'icon': {
        const group = named(act.group)
        if (!group) return this.#say(this.#noGroup(act.group))
        let patch: Partial<Omit<PublishGroupAppearance, 'meaning'>>
        if (act.verb === 'rename') {
          if (!act.name) return this.#say(this.#usage())
          patch = { name: act.name }
        } else if (act.verb === 'color') {
          const color = resolveGroupColor(act.value)
          if (!color) return this.#say(this.#t('groups.bad-color', 'Colours: blue, amber, green, pink, red, violet — or 1–6, or #rrggbb'))
          patch = { color }
        } else {
          // An icon the font cannot draw would be spelled out as a word on the
          // strip — refuse it here rather than paint a name.
          if (!act.value || drawsAsGlyph(act.value) === false) {
            return this.#say(this.#t('groups.bad-icon', `No icon called ${act.value}`, { icon: act.value }))
          }
          patch = { icon: act.value }
        }
        await acts.editGroup(here, group.meaning, patch)
        const name = patch.name ?? group.name
        return this.#say(this.#t('groups.changed', `${name} changed`, { name }))
      }

      case 'publish': {
        const group = named(act.group)
        if (!group) return this.#say(this.#noGroup(act.group))
        if (group.members.length === 0) return this.#say(this.#t('groups.empty', `No tiles in ${group.name} yet`, { name: group.name }))
        // The acts report how it went — the same toast the strip's button gets.
        await acts.publishGroup(here, group.meaning)
        return
      }

      case 'ungroup': {
        const group = named(act.group)
        if (!group) return this.#say(this.#noGroup(act.group))
        await acts.ungroupAt(here, group.meaning)
        return this.#say(this.#t('groups.ungrouped', `Ungrouped ${group.name}`, { name: group.name }))
      }

      default:
        return this.#say(this.#usage())
    }
  }

  /** Light or put out the strip here — the same deposit the Beehaviors panel
   *  writes, through its own intent; `silent` keeps the panel shut. */
  #light(segments: readonly string[], on: boolean): void {
    EffectBus.emit(on ? 'features:enable' : 'features:remove', {
      cell: segments[segments.length - 1] ?? '/',
      segments: [...segments],
      kind: PUBLISH_GROUPS_KIND,
      silent: true,
    })
  }

  #selection(): string[] {
    const selected = get<{ selected?: ReadonlySet<string> }>('@diamondcoreprocessor.com/SelectionService')?.selected
    return selected ? [...selected] : []
  }

  #asleep(): string {
    return this.#t('groups.asleep', 'Publish groups is switched off for this hive — light it in the Beehaviors pool')
  }

  #noGroup(name: string): string {
    return this.#t('groups.no-group', `No group called ${name} here`, { name })
  }

  #usage(): string {
    return this.#t('groups.usage', `groups: ${GROUPS_WORDS.join(', ')}`)
  }

  #say(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '▶' })
    EffectBus.emit('toast:show', { type: 'info', message })
  }

  #t(key: string, fallback: string, params?: Record<string, string | number>): string {
    const value = get<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
    return value && value !== key ? value : fallback
  }
}

const _groups = new GroupsQueenBee()
window.ioc.register('@diamondcoreprocessor.com/GroupsQueenBee', _groups)
