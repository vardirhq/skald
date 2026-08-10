import { useCallback, useEffect, useRef, useState } from 'react';
import type { PairingTicket, SyncDeviceInfo, SyncStatus } from '../../src-shared/sync/types';
import { api } from '../api';
import { useStore, relTimeLong } from '../store';
import { QrCode } from '../ui/qr';

/**
 * Sync is off until someone turns it on, and the wording here says what is
 * actually true: the relay stores encrypted blobs it cannot read, briefly, and
 * the key never leaves these devices.
 */
export function SyncPane() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  /** Which action is in flight, so its own button can say so. */
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const showToast = useStore((s) => s.showToast);
  const errorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void api.syncStatus().then(setStatus);
    return api.onSyncChanged(setStatus);
  }, []);

  // A failure that happens below the fold is a failure nobody sees.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest' });
  }, [error]);

  /**
   * Every action here crosses a network, so they all go through this: one
   * in-flight action at a time, named so its button can show it is working, and
   * any failure surfaced rather than swallowed.
   *
   * Each action also returns the authoritative status, and callers apply it
   * directly. The `sync:changed` push exists to catch background passes — a
   * button must not depend on it, or a lost event makes a successful action
   * look like a dead control.
   */
  const run = useCallback(
    async <T,>(label: string, action: () => Promise<T>, done?: (result: T) => void): Promise<void> => {
      setPending(label);
      setError(null);
      try {
        done?.(await action());
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setPending(null);
      }
    },
    []
  );

  if (!status) return <div className="empty-note">Reading sync state…</div>;

  return (
    <>
      <h1 className="settings__title">Sync</h1>
      <p className="settings__lede">
        Skald syncs through <span className="mono">GESH</span>, a relay that holds encrypted blobs just long
        enough to hand them to your other devices. Notes and their attachments are encrypted on this machine
        before they leave it, and the key never reaches the server — so the relay can pass your vault along, and
        cannot read it.
      </p>

      {error && (
        <div className="sync-banner sync-banner--bad" role="alert" ref={errorRef}>
          {error}
        </div>
      )}

      {status.configured ? (
        <ConnectedPanes
          status={status}
          pending={pending}
          run={run}
          applyStatus={setStatus}
          showToast={showToast}
        />
      ) : (
        <SetupPanes pending={pending} run={run} applyStatus={setStatus} />
      )}
    </>
  );
}

type Run = <T>(label: string, action: () => Promise<T>, done?: (result: T) => void) => Promise<void>;

// ---------- not connected yet ----------

function SetupPanes({
  pending,
  run,
  applyStatus,
}: {
  pending: string | null;
  run: Run;
  applyStatus: (status: SyncStatus) => void;
}) {
  const busy = pending !== null;
  const [serverUrl, setServerUrl] = useState('https://gesh.vardir.no');
  const [handle, setHandle] = useState('');
  const [pairingUri, setPairingUri] = useState('');

  return (
    <>
      <div className="settings__row">
        <div className="settings__row__l">
          <h3>Start syncing this vault</h3>
          <p>
            Creates a sync root on the relay and generates this vault's content key. Do this on the device that
            already holds your notes — it becomes the one that can add and remove other devices.
          </p>
        </div>
        <div className="settings__row__r" style={{ width: 340 }}>
          <label className="sync-field">
            <span>Relay address</span>
            <input
              className="settings__text-input"
              value={serverUrl}
              spellCheck={false}
              placeholder="https://gesh.example.com"
              onChange={(e) => setServerUrl(e.target.value)}
            />
          </label>
          <label className="sync-field">
            <span>Name (optional)</span>
            <input
              className="settings__text-input"
              value={handle}
              spellCheck={false}
              placeholder="madsen-home"
              onChange={(e) => setHandle(e.target.value)}
            />
          </label>
          <button
            className="btn btn--accent"
            disabled={busy || !serverUrl.trim()}
            onClick={() =>
              void run(
                'connect',
                () =>
                  api.syncConnect({
                    serverUrl: serverUrl.trim(),
                    ...(handle.trim() ? { handle: handle.trim() } : {}),
                  }),
                applyStatus
              )
            }
          >
            {pending === 'connect' ? 'Reaching the relay…' : 'Create sync root'}
          </button>
        </div>
      </div>

      <div className="settings__row">
        <div className="settings__row__l">
          <h3>Join a vault that already syncs</h3>
          <p>
            Paste the pairing link from the device that started the sync. It carries the relay address, a
            one-time code, and the content key — treat it like a password until it is used.
          </p>
        </div>
        <div className="settings__row__r" style={{ width: 340 }}>
          <label className="sync-field">
            <span>Pairing link</span>
            <input
              className="settings__text-input"
              value={pairingUri}
              spellCheck={false}
              placeholder="gesh://pair?s=…&c=…#k=…"
              onChange={(e) => setPairingUri(e.target.value)}
            />
          </label>
          <button
            className="btn"
            disabled={busy || !pairingUri.trim()}
            onClick={() => void run('pair', () => api.syncPair(pairingUri.trim()), applyStatus)}
          >
            {pending === 'pair' ? 'Pairing…' : 'Pair this device'}
          </button>
        </div>
      </div>
    </>
  );
}

// ---------- connected ----------

function ConnectedPanes({
  status,
  pending,
  run,
  applyStatus,
  showToast,
}: {
  status: SyncStatus;
  pending: string | null;
  run: Run;
  applyStatus: (status: SyncStatus) => void;
  showToast: (msg: string) => void;
}) {
  const busy = pending !== null;
  const [ticket, setTicket] = useState<PairingTicket | null>(null);
  const [devices, setDevices] = useState<SyncDeviceInfo[] | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  useEffect(() => {
    if (status.isRoot) void api.syncDevices().then(setDevices).catch(() => setDevices(null));
  }, [status.isRoot, status.lastSyncMs]);

  const copy = (text: string, label: string) => {
    void navigator.clipboard.writeText(text).then(
      () => showToast(`${label} copied`),
      () => showToast('Could not reach the clipboard')
    );
  };

  return (
    <>
      <Status status={status} />

      {!status.secretsProtected && (
        <div className="sync-banner sync-banner--bad">
          This system has no keystore Skald can use, so sync credentials cannot be stored safely here.
        </div>
      )}

      <div className="settings__row">
        <div className="settings__row__l">
          <h3>Automatic sync</h3>
          <p>Publishes changes a few seconds after you stop typing, and checks for others every minute.</p>
        </div>
        <div className="settings__row__r">
          <div className="toggle-group">
            <button
              aria-selected={status.enabled}
              disabled={busy}
              onClick={() => void run('enable', () => api.syncSetEnabled(true), applyStatus)}
            >
              On
            </button>
            <button
              aria-selected={!status.enabled}
              disabled={busy}
              onClick={() => void run('enable', () => api.syncSetEnabled(false), applyStatus)}
            >
              Off
            </button>
          </div>
        </div>
      </div>

      <div className="settings__row">
        <div className="settings__row__l">
          <h3>Sync now</h3>
          <p>
            Collect anything waiting, then publish this vault's changes — notes and attachments alike. A full
            republish is what a device that has been away for weeks needs, since the relay does not keep a log
            to replay.
          </p>
        </div>
        <div className="settings__row__r">
          <div className="sync-actions">
            <button className="btn" disabled={busy} onClick={() => void run('now', () => api.syncNow(), applyStatus)}>
              {pending === 'now' ? 'Syncing…' : 'Sync now'}
            </button>
            <button className="btn" disabled={busy} onClick={() => void run('snapshot', () => api.syncPushSnapshot(), applyStatus)}>
              {pending === 'snapshot' ? 'Republishing…' : 'Republish everything'}
            </button>
          </div>
        </div>
      </div>

      {status.isRoot ? (
        <>
          <div className="settings__row">
            <div className="settings__row__l">
              <h3>Add a device</h3>
              <p>
                Mints a code that is good once, for ten minutes. Scan the square on the other device, or type the
                code in. The key rides in the part of the link no server ever receives.
              </p>
            </div>
            <div className="settings__row__r" style={{ width: 340 }}>
              <button
                className="btn btn--accent"
                disabled={busy}
                onClick={() => void run('mint', () => api.syncMintPairing(), setTicket)}
              >
                {pending === 'mint' ? 'Preparing…' : ticket ? 'New pairing code' : 'Pair a device…'}
              </button>
            </div>
          </div>

          {ticket && <Ticket ticket={ticket} onCopy={copy} />}

          <Devices devices={devices} pending={pending} run={run} setDevices={setDevices} />
        </>
      ) : (
        <div className="settings__row">
          <div className="settings__row__l">
            <h3>Devices</h3>
            <p>
              This device was paired in, so it syncs but holds no authority. Adding and removing devices happens
              on the one that created the sync root.
            </p>
          </div>
          <div className="settings__row__r">
            <span className="settings__kv">{status.deviceId}</span>
          </div>
        </div>
      )}

      <div className="settings__row">
        <div className="settings__row__l">
          <h3>Disconnect</h3>
          <p>
            Forgets the relay and this device's credentials. Notes stay exactly where they are, and your other
            devices keep syncing with each other. To stop this device syncing for good, revoke it from the device
            that holds the root.
          </p>
        </div>
        <div className="settings__row__r">
          {confirmDisconnect ? (
            <div className="sync-actions">
              <button
                className="btn btn--danger"
                disabled={busy}
                onClick={() =>
                  void run('disconnect', () => api.syncDisconnect(), (next) => {
                    applyStatus(next);
                    setConfirmDisconnect(false);
                  })
                }
              >
                Disconnect
              </button>
              <button className="btn" onClick={() => setConfirmDisconnect(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="btn" onClick={() => setConfirmDisconnect(true)}>
              Disconnect…
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function Status({ status }: { status: SyncStatus }) {
  const tone =
    status.phase === 'error' ? 'bad' : status.phase === 'syncing' ? 'busy' : status.enabled ? 'good' : 'idle';
  const label =
    status.phase === 'error'
      ? 'Needs attention'
      : status.phase === 'syncing'
        ? 'Syncing…'
        : status.enabled
          ? 'Up to date'
          : 'Paused';

  return (
    <div className="sync-status">
      <div className="sync-status__head">
        <span className={`sync-dot sync-dot--${tone}`} />
        <strong>{status.pending > 0 && status.phase !== 'syncing' ? `${status.pending} waiting to publish` : label}</strong>
        <span className="sync-status__when">
          {status.lastSyncMs ? `last synced ${relTimeLong(status.lastSyncMs)}` : 'not synced yet'}
        </span>
      </div>
      {status.lastError && <div className="sync-status__error">{status.lastError}</div>}
      {status.oversize.length > 0 && (
        <div className="sync-status__warn">
          {status.oversize.length === 1
            ? '1 attachment is too large for the relay to carry:'
            : `${status.oversize.length} attachments are too large for the relay to carry:`}{' '}
          <span className="mono">{status.oversize.slice(0, 4).join(', ')}</span>
          {status.oversize.length > 4 && ` and ${status.oversize.length - 4} more`}. Everything else still syncs.
        </div>
      )}
      <div className="sync-status__facts">
        <span>{status.serverUrl}</span>
        <span>{status.tracked} files tracked</span>
        <span className="mono">{status.deviceId}</span>
        {status.isRoot && <span className="sync-tag">this device holds the root</span>}
      </div>
    </div>
  );
}

function Ticket({ ticket, onCopy }: { ticket: PairingTicket; onCopy: (text: string, label: string) => void }) {
  const [remaining, setRemaining] = useState(ticket.expiresAtMs - Date.now());
  useEffect(() => {
    setRemaining(ticket.expiresAtMs - Date.now());
    const timer = setInterval(() => setRemaining(ticket.expiresAtMs - Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticket]);

  const minutes = Math.floor(Math.max(0, remaining) / 60_000);
  const seconds = Math.floor((Math.max(0, remaining) % 60_000) / 1000);

  return (
    <div className="sync-ticket">
      <QrCode value={ticket.uri} size={188} />
      <div className="sync-ticket__body">
        <div className="sync-ticket__code">{ticket.displayCode}</div>
        <p>
          {remaining > 0
            ? `Good once, for another ${minutes}:${String(seconds).padStart(2, '0')}.`
            : 'This code has expired — mint another.'}
        </p>
        <p className="sync-ticket__warn">
          Anyone who reads this square gets your notes. Show it to the device you are pairing and nothing else.
        </p>
        {ticket.uriIsLocal && (
          <p className="sync-ticket__warn">
            The relay has no public address configured, so this link points at the address this device uses. If
            the other device reaches the relay differently, type the code there instead.
          </p>
        )}
        <div className="sync-actions">
          <button className="btn" onClick={() => onCopy(ticket.uri, 'Pairing link')}>
            Copy link
          </button>
          <button className="btn" onClick={() => onCopy(ticket.displayCode, 'Code')}>
            Copy code
          </button>
        </div>
      </div>
    </div>
  );
}

function Devices({
  devices,
  pending,
  run,
  setDevices,
}: {
  devices: SyncDeviceInfo[] | null;
  pending: string | null;
  run: Run;
  setDevices: (devices: SyncDeviceInfo[]) => void;
}) {
  const busy = pending !== null;
  return (
    <div className="settings__row settings__row--stack">
      <div className="settings__row__l">
        <h3>Devices on this vault</h3>
        <p>
          Revoking one leaves every other credential untouched. It stops that device talking to the relay; it does
          not reach back into whatever it already downloaded.
        </p>
      </div>
      <div className="set-table" style={{ marginTop: 12 }}>
        {(devices ?? []).map((device) => (
          <div key={device.deviceId} className="row" style={{ gridTemplateColumns: '1fr 150px auto' }}>
            <span className="mono" style={{ fontSize: 12, color: 'var(--tx-1)' }}>
              {device.deviceId}
              {device.isThisDevice && <span className="sync-tag">this device</span>}
            </span>
            <span style={{ color: 'var(--tx-3)', fontSize: 12 }}>
              {device.lastSeenMs ? `seen ${relTimeLong(device.lastSeenMs)}` : 'never synced'}
            </span>
            {device.isThisDevice ? (
              <span style={{ color: 'var(--tx-3)', fontSize: 12 }}>—</span>
            ) : (
              <button
                className="btn btn--danger btn--small"
                disabled={busy}
                onClick={() => void run(`revoke:${device.deviceId}`, () => api.syncRevoke(device.deviceId), setDevices)}
              >
                {pending === `revoke:${device.deviceId}` ? 'Revoking…' : 'Revoke'}
              </button>
            )}
          </div>
        ))}
        {devices?.length === 0 && <div className="empty-note">No devices enrolled yet.</div>}
        {devices === null && <div className="empty-note">Could not read the device list.</div>}
      </div>
    </div>
  );
}
