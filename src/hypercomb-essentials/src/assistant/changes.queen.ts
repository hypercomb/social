// assistant/changes.queen.ts
//
// `changes` — the changes asked for from elsewhere, and the participant's
// answer to each (change-channel.drone.ts, documentation/change-channel.md).
//
//   changes                  the changes waiting for an answer, then the latest
//   changes show <id>        the sentences a change would say
//   changes accept <id>      say them on this command line, one at a time,
//                            and send back that it was applied
//   changes decline <id>     say nothing, and send back that it was declined
//
// An id may be shortened to its first characters while it stays unique.
//
// Accepting is the participant's act. This word declares no machine grammar,
// so no model can say it: a change from elsewhere runs only when a person
// accepts it here. Each sentence goes through the same door Enter uses, so
// every act it asks for is admitted, undone and consented to exactly as if it
// had been typed; a publish still asks for its own consent.

import { EffectBus, QueenBee } from '@hypercomb/core'
import { normalizeChangeRecord } from './change-record.js'
import { changeChannelId } from './change-channel.js'
import { appendChangeRecord, listChanges, type ChangeRecord, type ChangeStatus } from './changes.js'

const say = (type: string, message: string): void => {
  EffectBus.emit('toast:show', { type, title: 'changes', message, duration: 8000 })
}
const log = (message: string): void => { EffectBus.emit('activity:log', { message, icon: '⇄' }) }
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

type ChannelDrone = { send?: (record: ChangeRecord) => Promise<boolean> }
const drone = (): ChannelDrone | undefined =>
  (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc?.get<ChannelDrone>('@diamondcoreprocessor.com/ChangeChannelDrone')

/** The newest record for each change id, newest first. */
const latestById = (records: readonly ChangeRecord[]): ChangeRecord[] => {
  const seen = new Map<string, ChangeRecord>()
  for (const r of records) if (!seen.has(r.id) || seen.get(r.id)!.at < r.at) seen.set(r.id, r)
  return [...seen.values()].sort((a, b) => b.at - a.at)
}

const short = (id: string): string => id.slice(0, 12)

export class ChangesQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'changes'
  override description = 'The changes asked for from your other machines — review one, then accept or decline it'
  override examples = [
    { input: 'changes', result: 'Lists the changes waiting for an answer' },
    { input: 'changes show 3fa9c2', result: 'Shows the sentences that change would say' },
    { input: 'changes accept 3fa9c2', result: 'Says its sentences here, one at a time, and sends back that it was applied' },
    { input: 'changes decline 3fa9c2', result: 'Says nothing and sends back that it was declined' },
  ]

  // The sentences a change carries are its own; the whole line is this word's.
  override rawArgs = true

  protected async execute(args: string): Promise<void> {
    const [verb = '', target = ''] = args.trim().split(/\s+/).filter(Boolean)
    const latest = latestById(await listChanges())

    if (!verb) { this.#list(latest); return }

    const found = target.length >= 6 ? latest.filter(r => r.id.startsWith(target)) : []
    if (found.length !== 1) {
      say('warning', found.length > 1
        ? `"${target}" names more than one change; give more of its id.`
        : `No change starts with "${target || '…'}". Say changes to see them.`)
      return
    }
    const change = found[0]!

    if (verb === 'show') {
      const lines = change.sentences ?? []
      log(`${short(change.id)} "${change.task}" — ${change.status}${lines.length ? '' : ', no sentences'}`)
      for (const line of lines) log(`  ${line}`)
      say('info', `${lines.length} sentence${lines.length === 1 ? '' : 's'} in "${change.task}" — listed in the activity log.`)
      return
    }
    if (verb === 'accept' || verb === 'decline') {
      if (change.status !== 'requested') {
        say('warning', `"${change.task}" is already ${change.status}.`)
        return
      }
      if (verb === 'decline') { await this.#answer(change, 'declined', 'declined by the participant'); return }
      const lines = change.sentences ?? []
      if (lines.some(line => /^\/?changes\b/i.test(line.trim()))) {
        say('error', `"${change.task}" asks to answer changes itself, so it was not run.`)
        return
      }
      say('info', `Saying ${lines.length} sentence${lines.length === 1 ? '' : 's'} from "${change.task}"…`)
      // After this line has finished: each sentence then goes through the same
      // door Enter uses, one at a time, so each commit lands before the next.
      setTimeout(() => void this.#run(change, lines), 0)
      return
    }
    say('warning', 'Say changes, or changes show, accept or decline followed by a change id.')
  }

  #list(latest: readonly ChangeRecord[]): void {
    const waiting = latest.filter(r => r.status === 'requested')
    if (!latest.length) { say('info', 'No changes on record yet.'); return }
    for (const r of [...waiting, ...latest.filter(r => r.status !== 'requested').slice(0, 10)]) {
      const count = r.sentences?.length
      log(`${short(r.id)} ${r.status}${r.from ? ' from elsewhere' : ''} — "${r.task}"${count ? `, ${count} sentences` : ''}`)
    }
    say('info', waiting.length
      ? `${waiting.length} change${waiting.length === 1 ? '' : 's'} waiting for an answer — listed in the activity log.`
      : 'Nothing is waiting for an answer; the latest changes are in the activity log.')
  }

  async #run(change: ChangeRecord, lines: readonly string[]): Promise<void> {
    for (const line of lines) {
      const text = line.trim().startsWith('/') ? line.trim() : `/${line.trim()}`
      EffectBus.emit('command:submit', { text })
      await sleep(text.startsWith('/go ') ? 1200 : 900)
    }
    await this.#answer(change, 'applied', `${lines.length} sentence${lines.length === 1 ? '' : 's'} said on the command line`)
  }

  async #answer(change: ChangeRecord, status: ChangeStatus, note: string): Promise<void> {
    const channel = await changeChannelId()
    const record = normalizeChangeRecord({
      kind: 'change',
      channel,
      id: change.id,
      task: change.task,
      scope: change.scope,
      at: Date.now(),
      status,
      touched: [],
      note,
    }, channel)
    if (!record) return
    await appendChangeRecord(record)
    const sent = await drone()?.send?.(record)
    say('success', `"${change.task}" ${status}.${sent ? ' The answer was sent back.' : ' The answer is on record here; it could not be sent back.'}`)
  }
}

const _changes = new ChangesQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ChangesQueenBee', _changes)
