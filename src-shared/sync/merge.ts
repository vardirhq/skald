// Conflict resolution. GESH orders events but never merges them, so this is
// entirely Skald's problem — and it is a pure function of three things: what a
// remote device says, what this device last agreed on, and what is on disk now.
//
// The rule is last-writer-wins on a per-path logical clock, with the device id
// breaking ties so every device reaches the same answer without talking to the
// others. What matters for a notes app is what happens to the loser: nothing is
// silently dropped. A local edit that loses is captured into the note's history
// first, so it stays one click away in the editor rather than gone.

import type { FileOp } from './payload';

/** The hash of a path that does not exist. Absence is a state, with a clock. */
export const ABSENT = '';

/** The last state this device agreed on for a path — either published or applied. */
export interface FileState {
  /** SHA-256 of the content, or `ABSENT` for a tombstone. */
  hash: string;
  /** Per-path logical clock. Only ever compared, never interpreted. */
  rev: number;
  /** Device that wrote this revision; the tiebreak at equal revisions. */
  writer: string;
}

export type MergeAction =
  /** The filesystem already agrees; do not touch it. */
  | 'noop'
  /** Write or delete locally. */
  | 'apply'
  /** The local copy wins; ignore the incoming op and let the next push carry it. */
  | 'keep-local';

export interface MergeResult {
  action: MergeAction;
  /** True when applying is about to overwrite an unpublished local edit. */
  preserveLocal: boolean;
  /** New bookkeeping state for the path, or undefined to leave it as it was. */
  record?: FileState;
}

export interface MergeInput {
  incoming: FileOp;
  /** The device that authored the revision — not necessarily the event's sender. */
  incomingWriter: string;
  /** Last synced state for this path, or null if this device has never seen it. */
  known: FileState | null;
  /** Hash of the file on disk right now, or `ABSENT` when it is not there. */
  localHash: string;
  /** This device's own id, used as the tiebreak against the incoming writer. */
  localDeviceId: string;
}

/** Higher revision wins; equal revisions are broken by device id, identically everywhere. */
export function beats(a: { rev: number; writer: string }, b: { rev: number; writer: string }): boolean {
  return a.rev !== b.rev ? a.rev > b.rev : a.writer > b.writer;
}

/** The revision this device should publish for a path it has just changed. */
export function nextRev(known: FileState | null): number {
  return (known?.rev ?? 0) + 1;
}

export function decideMerge({
  incoming,
  incomingWriter,
  known,
  localHash,
  localDeviceId,
}: MergeInput): MergeResult {
  const incomingHash = incoming.op === 'put' ? incoming.hash : ABSENT;
  const incomingState: FileState = { hash: incomingHash, rev: incoming.rev, writer: incomingWriter };
  const knownHash = known?.hash ?? ABSENT;

  // The filesystem already says what the incoming op says. Whether that happened
  // by sync or by two people typing the same thing, there is nothing to write —
  // but the clock may still need to move forward.
  if (localHash === incomingHash) {
    return {
      action: 'noop',
      preserveLocal: false,
      record: !known || beats(incomingState, known) ? incomingState : undefined,
    };
  }

  // Does the local copy carry an edit this device has not published yet?
  if (localHash === knownHash) {
    // No. The only reason not to apply is that the op is older than what we
    // already agreed on — a replay, or a page being re-read after a partial ack.
    if (known && !beats(incomingState, known)) return { action: 'noop', preserveLocal: false };
    return { action: 'apply', preserveLocal: false, record: incomingState };
  }

  // Yes. That edit will be published by this device at the next revision, so
  // that is the claim the incoming op has to beat.
  const localClaim = { rev: nextRev(known), writer: localDeviceId };
  return beats(incomingState, localClaim)
    ? { action: 'apply', preserveLocal: true, record: incomingState }
    : { action: 'keep-local', preserveLocal: false };
}
