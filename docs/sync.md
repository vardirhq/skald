# Sync

Skald syncs vaults through [GESH](https://github.com/vardirhq/generic-encrypted-sync-hub),
a self-hostable relay that stores opaque encrypted blobs and hands them to your other
devices. It is not a backend. It never sees a note, cannot recover a lost key, and erases
each event once every device has collected it.

That division is deliberate, and it puts four jobs permanently on Skald's side of the line:
encryption, key management, conflict resolution, and durability. This document is how each
one is answered, and what a second Skald client — a phone, say — has to reimplement to join
the same root.

## Shape of the code

```text
src-shared/gesh/       portable, no Node and no Electron
  bytes.ts             base64 / base64url / UTF-8, hand-rolled for platform parity
  ids.ts               the identifier rules GESH enforces, checked before a round trip
  crypto.ts            AES-256-GCM sealing, content-key import/export, SHA-256
  pairing.ts           gesh:// pairing URIs, and the #k= fragment rule
  protocol.ts          the typed HTTP client for the v1 API

src-shared/sync/       portable, Skald-specific
  payload.ts           what goes inside an event, and the validation on the way out
  merge.ts             conflict resolution, as a pure function
  types.ts             the status shape the UI renders

src-main/              Electron only
  secrets.ts           credentials in the OS keystore, via safeStorage
  sync.ts              the engine: pull → apply → acknowledge → push
```

Everything under `src-shared/` is written against web platform globals — `fetch`,
WebCrypto, `TextEncoder` — and imports nothing from Node or Electron. A mobile client
should be able to take those five plus two files unchanged and supply its own storage.

## The two halves of pairing

GESH holds one half of the secret and never the other.

The relay knows a **root** and its **devices**. Provisioning returns two credentials: a
`root_token`, the authority that enrolls and revokes, and a `device_token`, the credential
used for every upload, list, download and acknowledgement. Skald keeps them apart exactly
as GESH intends — daily sync never touches the root token.

The **content key** is generated on the first device and never sent anywhere. It travels to
a second device only inside the fragment of a pairing URI:

```text
gesh://pair?s=https%3A%2F%2Fgesh.vardir.no&c=79T54-26AJX#k=<base64url AES-256 key>
```

A fragment is never transmitted to a server, so one QR code carries both halves while the
relay only ever receives the first. `src/ui/qr.tsx` renders that string locally — GESH
deliberately returns a string rather than an image, because the key has to be appended
first.

Credentials live in the OS keystore under the app's userData directory, never in the vault:
a vault folder is the thing most likely to end up in Dropbox or a git repository. They are
keyed by `appId:rootId:deviceId`, because one machine can hold two vaults enrolled on the
same root, and each is its own device.

## What an event contains

One event is a batch of whole-file operations, JSON, sealed with a fresh 96-bit nonce:

```jsonc
{
  "v": 1,
  "kind": "delta",          // or "snapshot"
  "device": "desktop_k3n8vq2wla",
  "ts": 1786270000000,
  "ops": [
    { "op": "put", "path": "Projects/Jormungandr.md", "rev": 4, "ts": 1786270000000,
      "content": "…", "hash": "<sha256 of the content>" },
    { "op": "del", "path": "Daily/2026-07-30.md", "rev": 2, "ts": 1786270000000 }
  ]
}
```

`rev` is a per-path logical clock, not a wall clock: the relay's `created_at_ms` is the
*server's* view and is never used for ordering. Pushes are split into batches well under
the relay's body limit; a note too large to fit is left in its own event so a `413` names
something a person can act on.

Every decrypted payload is fully re-validated before it is used — `path` in particular,
which is about to become a filename. Anything that could escape the vault, hide under
`.skald/`, or land on a reserved Windows name is refused.

Attachments and other non-Markdown files are **not** synced yet. The op shape has room for
them, and the size limit is the reason to do it as a separate kind of event rather than by
inlining bytes into these.

## Conflict resolution

`decideMerge` in `src-shared/sync/merge.ts` is a pure function of three things: the
incoming operation, the state this device last agreed on for that path, and the hash of
what is on disk right now.

Last writer wins, by `rev` first and by device id as the tiebreak, so two devices reach
the same answer without talking. What matters for a notes app is the loser: it is never
dropped. Before sync overwrites a note, the current content is forced into that note's
history — with reason `sync`, exempt from the coalescing that normally merges rapid edit
snapshots — so it stays one click away in the editor.

Absence is a state with a clock, not a missing entry, which is what stops a stale event
resurrecting a deleted note.

## The pass

Always pull → apply → acknowledge → push:

- **pull** pages the feed from a persisted opaque cursor, skips this device's own events,
  and decrypts each blob.
- **apply** merges op by op and writes to the vault.
- **acknowledge** happens only once the changes are on disk. Acknowledging is destructive:
  once every active peer is past an event, GESH erases it. Never ack after download, never
  after decrypt — after commit.
- **push** diffs the vault against the agreed state and publishes one or more events, and
  only records what actually shipped, so a failure part-way through leaves the rest to be
  retried.

An event that cannot be decrypted or parsed is skipped with a warning rather than allowed
to wedge the feed forever, and a `429` is honoured through its `Retry-After` rather than
retried in a loop. A `401` stops automatic syncing outright, because a revoked credential
will not start working on a timer.

## Retention, and the thing that catches people

Three timers the relay operator controls, none of which Skald can influence:

| Timer | Default | Consequence |
| --- | --- | --- |
| event TTL | 7 days | An event nobody collects is erased |
| device TTL | 30 days | A silent device stops holding data alive |
| tombstone TTL | 30 days | An erased event's id stays reserved |

So a device offline past the device TTL **cannot rebuild from the feed** — events it never
saw are gone, with no error to distinguish "nothing new" from "you missed it". Skald's
answer is the snapshot event: the whole vault republished as one `kind: "snapshot"` event.
It is sent automatically when a root is provisioned and before a pairing code is handed
out, and on demand from *Republish everything* in Settings → Sync.

## Bringing up a second client

To join an existing root, a new Skald client needs:

1. **`src-shared/gesh/` and `src-shared/sync/` unchanged.** WebCrypto is the only real
   dependency; React Native needs a polyfill for it, and `fetch` is already there.
2. **Somewhere to keep three secrets** — device token, content key, and (only on the device
   that provisioned the root) the root token. Keychain on iOS, Keystore on Android.
   Not app storage, and never the vault.
3. **A vault adapter.** The engine only ever asks the vault for five things: enumerate notes
   with their raw content, read one, write one, delete one, and force a history snapshot.
   `Vault.syncFiles / syncRead / syncWrite / syncDelete / captureVersion` are that whole
   surface; anything providing them can drive the same engine.
4. **Somewhere to persist sync state** — the cursor, the device id, and the per-path agreed
   state. On desktop that is `.skald/sync.json` inside the vault, which is the right place
   precisely because it belongs to that vault and not to the installation.
5. **A QR scanner**, which is the only genuinely new UI. Everything else is `parsePairingUri`
   plus `redeemEnrollment`.

`src-main/sync.ts` is the piece that is Electron-shaped, and only because of where it reads
and writes. The decisions it makes are all in the portable half.

## Testing

`tests/gesh-protocol.test.ts`, `tests/gesh-crypto.test.ts` and `tests/sync-merge.test.ts`
cover the client, the sealing, and the merge rules. `tests/sync-engine.test.ts` runs two
real vaults against an in-memory relay (`tests/helpers/fakeGesh.ts`) and asserts the whole
loop: pairing, propagation, deletion, conflict convergence, history preservation, backoff,
and restart.

That fake encodes how the protocol is *documented*. To check the documentation against a
running server:

```bash
GESH_URL=https://gesh.vardir.no npx vitest run tests/gesh-live.test.ts
```

It is skipped without `GESH_URL`. It provisions a root and leaves it behind, since GESH has
no delete-root endpoint, and revokes the devices it enrolled.
