# The change channel — a change asked for elsewhere, answered here

**Status: built 2026-10-30.** The local half (one record per act in the
`changes:log` pool, addressed to this hive's channel) existed before; this adds
the remote half: sealing, the relay transport, the `changes` word, and a sender
any machine can run.

A change made by the hive you sit in front of, and a change built for you on
another machine, are the same kind of thing: a set of updates addressed to a
hive, which that hive files and asks you about. The change channel carries the
second kind. A session on another machine, a script, or one of your other
devices asks for a change; your hive files it as asked for and tells you;
nothing runs until you accept it; and your answer goes back.

## Setting it up

Both ends share one secret. Make a long, random one:

```
node scripts/change-send.cjs --new-secret
```

In the hive, set it once, in the browser console of the hive tab:

```js
localStorage.setItem('hc:change-channel:secret', '<the secret>')
```

That is the switch: with a secret set, the hive listens on the channel the
secret derives and can send its answers; without one, nothing is subscribed or
sent, and the channel stays private to this install. No word sets the secret,
on purpose: it is a credential, and a sentence would leave it in history.

On the other end, give the same secret to the sender through the environment:

```
HC_CHANGE_SECRET=<the secret> node scripts/change-send.cjs --task "plant the presentation" --file sentences.txt
```

## Asking for a change

`scripts/change-send.cjs` reads a file of sentences, one per line, as the
hive's command line takes them. It seals them into one change record, sends it
to the relay (`wss://hypercomb.com` unless `--relay` names another), and then
listens for the hive's answer for up to `--wait` seconds (120 by default):
`applied` exits 0, `declined` exits 3, and no answer leaves the change asked
for, so the hive can still answer it later. Behind a proxy (`HTTPS_PROXY`), it
dials through the proxy.

The living presentation's planting script prints its sentences ready for this:

```
npm run living:plant -- --all --sentences --publish hypercomb.com > sentences.txt
```

## Answering it

When a change arrives, the hive says so in a toast and the activity log. Then:

```
changes                  the changes waiting for an answer, then the latest
changes show <id>        the sentences a change would say
changes accept <id>      say them on this command line, one at a time,
                         and send back that it was applied
changes decline <id>     say nothing, and send back that it was declined
```

An id may be shortened to its first characters while it stays unique.
Accepting says each sentence through the same door Enter uses, so every act is
admitted, undone, and consented to exactly as if you had typed it: a publish
still asks for its own consent. `applied` means the sentences were said; what
each one did is in the hive as usual.

## Why it is safe to leave on

- **The seal is the authority.** Every record crosses the relay sealed:
  encrypted and authenticated under a key derived from the secret. A record
  that was not sealed with the secret, was sealed for another channel, or was
  altered on the way does not open, and is dropped without a word.
- **What opens is still checked.** A record must be a change, addressed to this
  channel, with plain sentences (at most 500, each at most 4000 characters);
  fields it does not know are dropped.
- **Nothing runs on arrival.** A change is filed as `requested` and you are told.
  Its sentences run only when you accept it.
- **Only a person can accept.** The `changes` word declares no machine grammar,
  so no model can say it, and a change that asks to answer changes itself is
  refused.
- **The relay sees only that something passed.** It carries the sealed text and
  the channel id. The channel id is a hash of the secret in the clear, so a
  short secret could be guessed from it offline: use a long, random secret.

## The format

So any program can speak it:

- **channel** = hex SHA-256 of `"hc:change-channel\0" + secret`
- **key** = HKDF-SHA-256 over the secret, salt `"hc:change-channel:salt"`, info
  `"hc:change-channel:key"`, to AES-256-GCM
- **sealed** = `"v1." + base64(12-byte iv) + "." + base64(ciphertext and tag)`,
  with the channel id as additional data, over the record as JSON
- **event** = Nostr kind `30219`, tags `x` = the channel, `d` = `c:` + hex
  SHA-256 of the sealed text, `expiration` = seven days on; content
  `{"v":1,"sealed":"…"}`; signed by any key, since the seal, not the signer, is
  what the hive trusts
- **record** = `{ kind: "change", channel, id, task, scope, at, status,
  touched, sentences?, note?, compensates?, from? }`, as in `changes.ts`. A
  request has `status: "requested"` and its `sentences`; an answer carries the
  same `id` with `applied` or `declined` and a `note`.

## What is not built

- **No resend.** The relay keeps a request for seven days and replays it when
  the hive comes back, but the sender does not republish what it still waits
  on.
- **No panel.** Changes are reviewed and answered in words; there is no window
  listing them yet.

## Files

- `hypercomb-essentials/src/assistant/change-channel.ts`: the channel address
- `hypercomb-essentials/src/assistant/change-seal.ts`: the seal
- `hypercomb-essentials/src/assistant/change-record.ts`: the check before filing
- `hypercomb-essentials/src/assistant/change-channel.drone.ts`: the transport
- `hypercomb-essentials/src/assistant/changes.queen.ts`: the `changes` word
- `hypercomb-essentials/src/assistant/changes.ts`: the log and its one writer
- `scripts/change-send.cjs`: the sender

## Related

- [feedback-channel.md](feedback-channel.md): the other relay channel, for the
  feedback loop's own records, on a fixed public rendezvous
- [speak-dont-bridge.md](speak-dont-bridge.md): why every act is a sentence
