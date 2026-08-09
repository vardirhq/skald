// A typed client for the GESH v1 HTTP API.
//
// Two conventions the protocol imposes and this file absorbs so callers never
// see them: request bodies are camelCase while response bodies are snake_case,
// and errors are only *sometimes* the documented `{"error": "..."}` shape —
// 413, 415 and 422 come from the framework layer with a plain-text body, so
// every response is parsed defensively.

import { assertHandle, assertIdentifier, normalizeEnrollmentCode } from './ids';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GeshClientOptions {
  baseUrl: string;
  /** Injected so tests and non-browser hosts can supply their own transport. */
  fetch?: FetchLike;
  /** Abandon a request after this long. Uploads get the same budget. */
  timeoutMs?: number;
}

/** Everything needed to address one root on one relay. */
export interface RootRef {
  appId: string;
  rootId: string;
}

export interface ProvisionedRoot {
  appId: string;
  rootId: string;
  handle: string | null;
  deviceId: string;
  rootToken: string;
  deviceToken: string;
}

export interface MintedEnrollment {
  code: string;
  expiresAtMs: number;
  /** null unless the operator set `GESH_PUBLIC_URL`. */
  pairingUri: string | null;
}

export interface RedeemedEnrollment {
  appId: string;
  rootId: string;
  deviceId: string;
  token: string;
}

export interface EnrolledDevice {
  deviceId: string;
  enrolledAtMs: number;
  lastSeenMs: number | null;
  ackCursor: number | null;
}

export interface EventMeta {
  cursor: number;
  appId: string;
  rootId: string;
  deviceId: string;
  eventId: string;
  createdAtMs: number;
  size: number;
}

export interface EventPage {
  events: EventMeta[];
  /** null when the page was empty — you are caught up. */
  nextCursor: number | null;
}

export interface AckResult {
  deviceId: string;
  ackCursor: number;
  lastSeenMs: number;
}

export type UploadOutcome = 'created' | 'duplicate';

export class GeshError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;
  readonly detail: string;

  constructor(status: number, detail: string, retryAfterMs: number | null = null) {
    super(messageFor(status, detail));
    this.name = 'GeshError';
    this.status = status;
    this.detail = detail;
    this.retryAfterMs = retryAfterMs;
  }

  /** Worth trying again later on its own; a 401 or 409 never is. */
  get isTransient(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

function messageFor(status: number, detail: string): string {
  switch (status) {
    case 400:
      return `The relay rejected the request as malformed (${detail || 'bad request'})`;
    case 401:
      return 'The relay did not accept this credential — the device may have been revoked, or the pairing code is wrong or expired';
    case 403:
      return 'That action needs the root credential, and this device only holds its own';
    case 404:
      return 'The relay has no such root, device or event';
    case 409:
      return 'That identifier is already taken on this root';
    case 413:
      return 'The change is larger than the relay accepts in one event';
    case 415:
      return 'The relay rejected the content type of the request';
    case 422:
      return `The relay could not read a required field (${detail || 'unprocessable'})`;
    case 429:
      return 'The relay is rate limiting this client — wait before trying again';
    default:
      return status >= 500
        ? 'The relay failed to store or read the request'
        : `The relay answered ${status}${detail ? ` (${detail})` : ''}`;
  }
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

async function errorFrom(res: Response): Promise<GeshError> {
  let detail = '';
  try {
    const text = await res.text();
    if (text) {
      try {
        const parsed = JSON.parse(text) as { error?: unknown };
        detail = typeof parsed?.error === 'string' ? parsed.error : text;
      } catch {
        detail = text;
      }
    }
  } catch {
    // A body we cannot read is not worth failing differently over.
  }
  return new GeshError(res.status, detail.slice(0, 200), parseRetryAfter(res.headers.get('retry-after')));
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`The relay omitted "${field}"`);
  return value;
}

export class GeshClient {
  readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: GeshClientOptions) {
    const trimmed = options.baseUrl.trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^\s]+$/i.test(trimmed)) {
      throw new Error('A sync server address must be an http(s) URL');
    }
    this.baseUrl = trimmed;
    const injected = options.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!injected) throw new Error('No fetch implementation available');
    this.fetchImpl = injected;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  // ---------- transport ----------

  private async request(
    method: string,
    path: string,
    opts: {
      token?: string;
      json?: unknown;
      body?: Uint8Array;
      accept?: 'json' | 'bytes' | 'none';
      allowStatus?: number[];
    } = {}
  ): Promise<{ status: number; json?: unknown; bytes?: Uint8Array }> {
    const headers: Record<string, string> = {};
    if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;

    let body: BodyInit | undefined;
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.json);
    } else if (opts.body) {
      headers['Content-Type'] = 'application/octet-stream';
      // Copy into a plain ArrayBuffer: a subarray view would otherwise upload
      // the whole backing buffer.
      body = opts.body.slice().buffer as ArrayBuffer;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
    } catch (err) {
      const reason = err instanceof Error && err.name === 'AbortError' ? 'timed out' : 'is unreachable';
      throw new Error(`The sync server ${reason} (${this.baseUrl})`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok && !(opts.allowStatus ?? []).includes(res.status)) throw await errorFrom(res);

    if (opts.accept === 'bytes') {
      return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()) };
    }
    if (opts.accept === 'none' || res.status === 204) {
      return { status: res.status };
    }
    try {
      return { status: res.status, json: await res.json() };
    } catch {
      return { status: res.status };
    }
  }

  // ---------- unauthenticated ----------

  async health(): Promise<boolean> {
    const { json } = await this.request('GET', '/health');
    return (json as { ok?: unknown } | undefined)?.ok === true;
  }

  /**
   * Creates the root and returns both credentials. This response is the only
   * time either token exists in readable form — there is no endpoint that
   * returns them again.
   */
  async provisionRoot(input: {
    appId: string;
    deviceId: string;
    handle?: string;
    provisioningSecret?: string;
  }): Promise<ProvisionedRoot> {
    assertIdentifier('An app id', input.appId);
    assertIdentifier('A device id', input.deviceId);
    if (input.handle !== undefined) assertHandle(input.handle);

    const { json } = await this.request('POST', '/v1/roots', {
      token: input.provisioningSecret,
      json: input.handle
        ? { appId: input.appId, deviceId: input.deviceId, handle: input.handle }
        : { appId: input.appId, deviceId: input.deviceId },
    });
    const body = (json ?? {}) as Record<string, unknown>;
    return {
      appId: str(body['app_id'], 'app_id'),
      rootId: str(body['root_id'], 'root_id'),
      handle: typeof body['handle'] === 'string' ? body['handle'] : null,
      deviceId: str(body['device_id'], 'device_id'),
      rootToken: str(body['root_token'], 'root_token'),
      deviceToken: str(body['device_token'], 'device_token'),
    };
  }

  /** Trade a pairing code for this device's own sync credential. */
  async redeemEnrollment(input: {
    code: string;
    deviceId: string;
    handle?: string;
  }): Promise<RedeemedEnrollment> {
    assertIdentifier('A device id', input.deviceId);
    const code = normalizeEnrollmentCode(input.code);
    if (!code) throw new Error('A pairing code is required');
    const path = input.handle ? `/v1/roots/${assertHandle(input.handle)}/enroll` : '/v1/enroll';

    const { json } = await this.request('POST', path, { json: { code, deviceId: input.deviceId } });
    const body = (json ?? {}) as Record<string, unknown>;
    return {
      appId: str(body['app_id'], 'app_id'),
      rootId: str(body['root_id'], 'root_id'),
      deviceId: str(body['device_id'], 'device_id'),
      token: str(body['token'], 'token'),
    };
  }

  /** Resolve a typed name. Returns null when no root holds it. */
  async resolveHandle(handle: string): Promise<RootRef | null> {
    assertHandle(handle);
    try {
      const { json } = await this.request('GET', `/v1/roots/${handle}`);
      const body = (json ?? {}) as Record<string, unknown>;
      return { appId: str(body['app_id'], 'app_id'), rootId: str(body['root_id'], 'root_id') };
    } catch (err) {
      if (err instanceof GeshError && err.status === 404) return null;
      throw err;
    }
  }

  // ---------- admin plane (root token only) ----------

  async setHandle(ref: RootRef, rootToken: string, handle: string): Promise<void> {
    assertHandle(handle);
    await this.request('PUT', `${this.adminBase(ref)}/handle`, {
      token: rootToken,
      json: { handle },
      accept: 'none',
    });
  }

  async mintEnrollment(ref: RootRef, rootToken: string): Promise<MintedEnrollment> {
    const { json } = await this.request('POST', `${this.adminBase(ref)}/enrollments`, {
      token: rootToken,
    });
    const body = (json ?? {}) as Record<string, unknown>;
    return {
      code: str(body['code'], 'code'),
      expiresAtMs: num(body['expires_at_ms']) ?? Date.now() + 600_000,
      pairingUri: typeof body['pairing_uri'] === 'string' ? body['pairing_uri'] : null,
    };
  }

  async listDevices(ref: RootRef, rootToken: string): Promise<EnrolledDevice[]> {
    const { json } = await this.request('GET', `${this.adminBase(ref)}/devices`, { token: rootToken });
    const rows = Array.isArray(json) ? json : [];
    return rows.map((row) => {
      const r = (row ?? {}) as Record<string, unknown>;
      return {
        deviceId: str(r['device_id'], 'device_id'),
        enrolledAtMs: num(r['enrolled_at_ms']) ?? 0,
        lastSeenMs: num(r['last_seen_ms']),
        ackCursor: num(r['ack_cursor']),
      };
    });
  }

  async revokeDevice(ref: RootRef, rootToken: string, deviceId: string): Promise<void> {
    assertIdentifier('A device id', deviceId);
    await this.request('DELETE', `${this.adminBase(ref)}/devices/${deviceId}`, {
      token: rootToken,
      accept: 'none',
    });
  }

  // ---------- sync plane (device token) ----------

  /**
   * Uploads one immutable event. A `409` means this event ID is already on the
   * root, which on a retry after a network failure is success, not an error —
   * the previous attempt landed.
   */
  async putEvent(
    ref: RootRef,
    deviceId: string,
    eventId: string,
    ciphertext: Uint8Array,
    token: string
  ): Promise<UploadOutcome> {
    assertIdentifier('A device id', deviceId);
    assertIdentifier('An event id', eventId);
    const { status } = await this.request(
      'PUT',
      `${this.syncBase(ref)}/${deviceId}/${eventId}`,
      { token, body: ciphertext, accept: 'none', allowStatus: [409] }
    );
    return status === 409 ? 'duplicate' : 'created';
  }

  async listEvents(
    ref: RootRef,
    token: string,
    opts: { after?: number; limit?: number; deviceId?: string } = {}
  ): Promise<EventPage> {
    const params = new URLSearchParams();
    if (opts.after !== undefined) {
      if (!Number.isInteger(opts.after) || opts.after < 0) throw new Error('A cursor must be a non-negative integer');
      params.set('after', String(opts.after));
    }
    if (opts.limit !== undefined) {
      if (!Number.isInteger(opts.limit) || opts.limit < 1 || opts.limit > 500) {
        throw new Error('A page limit must be between 1 and 500');
      }
      params.set('limit', String(opts.limit));
    }
    if (opts.deviceId) params.set('deviceId', assertIdentifier('A device id', opts.deviceId));

    const query = params.toString();
    const { json } = await this.request(
      'GET',
      `${this.syncBase(ref)}${query ? `?${query}` : ''}`,
      { token }
    );
    const body = (json ?? {}) as Record<string, unknown>;
    const rows = Array.isArray(body['events']) ? (body['events'] as unknown[]) : [];
    return {
      events: rows.map((row) => {
        const r = (row ?? {}) as Record<string, unknown>;
        return {
          cursor: num(r['cursor']) ?? 0,
          appId: str(r['app_id'], 'app_id'),
          rootId: str(r['root_id'], 'root_id'),
          deviceId: str(r['device_id'], 'device_id'),
          eventId: str(r['event_id'], 'event_id'),
          createdAtMs: num(r['created_at_ms']) ?? 0,
          size: num(r['size']) ?? 0,
        };
      }),
      nextCursor: num(body['next_cursor']),
    };
  }

  /** Returns null for an event the relay has already erased. */
  async getEvent(
    ref: RootRef,
    deviceId: string,
    eventId: string,
    token: string
  ): Promise<Uint8Array | null> {
    assertIdentifier('A device id', deviceId);
    assertIdentifier('An event id', eventId);
    try {
      const { bytes } = await this.request(
        'GET',
        `${this.syncBase(ref)}/${deviceId}/${eventId}`,
        { token, accept: 'bytes' }
      );
      return bytes ?? new Uint8Array(0);
    } catch (err) {
      if (err instanceof GeshError && err.status === 404) return null;
      throw err;
    }
  }

  /**
   * Reports the feed consumed up to and including `ackCursor`, and registers
   * this device as an active peer. Acknowledging is destructive — once every
   * peer is past an event the relay erases it — so only call this after the
   * change is durably applied.
   */
  async ack(ref: RootRef, deviceId: string, token: string, ackCursor: number): Promise<AckResult> {
    assertIdentifier('A device id', deviceId);
    if (!Number.isInteger(ackCursor) || ackCursor < 0) throw new Error('An ack cursor must be a non-negative integer');
    const { json } = await this.request('PUT', `${this.syncBase(ref)}/${deviceId}`, {
      token,
      json: { ackCursor },
    });
    const body = (json ?? {}) as Record<string, unknown>;
    return {
      deviceId: str(body['device_id'], 'device_id'),
      ackCursor: num(body['ack_cursor']) ?? ackCursor,
      lastSeenMs: num(body['last_seen_ms']) ?? Date.now(),
    };
  }

  // ---------- paths ----------

  private syncBase(ref: RootRef): string {
    assertIdentifier('An app id', ref.appId);
    assertIdentifier('A root id', ref.rootId);
    return `/v1/sync/${ref.appId}/${ref.rootId}`;
  }

  private adminBase(ref: RootRef): string {
    assertIdentifier('An app id', ref.appId);
    assertIdentifier('A root id', ref.rootId);
    return `/v1/admin/${ref.appId}/${ref.rootId}`;
  }
}
