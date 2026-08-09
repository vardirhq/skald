// An in-memory GESH relay, faithful to the parts of the protocol Skald depends
// on: two credentials per root, single-use pairing codes, immutable events,
// a monotonic cursor, and 409 on a reused event id.
//
// It exists so the sync engine can be tested end to end without a server, and
// so the rules the engine relies on are asserted somewhere rather than assumed.

import type { FetchLike } from '../../src-shared/gesh/protocol';

interface StoredEvent {
  cursor: number;
  deviceId: string;
  eventId: string;
  createdAtMs: number;
  body: Uint8Array;
}

interface Device {
  deviceId: string;
  enrolledAtMs: number;
  lastSeenMs: number | null;
  ackCursor: number | null;
  token: string;
}

interface Root {
  appId: string;
  rootId: string;
  handle: string | null;
  rootToken: string;
  devices: Map<string, Device>;
  events: StoredEvent[];
  /** Reserved for the lifetime of the root, exactly as a tombstone would. */
  usedEventIds: Set<string>;
  codes: Map<string, { deviceless: true; expiresAtMs: number }>;
  nextCursor: number;
}

export interface FakeGesh {
  fetch: FetchLike;
  roots: Map<string, Root>;
  /** Set to a status to make the next request fail with it. */
  failNextWith: number | null;
  /** Set to fail only the requests it matches, for as long as it is set. */
  failWhen: ((method: string, path: string) => number | null) | null;
  requestLog: string[];
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function err(status: number, message: string, headers: Record<string, string> = {}): Response {
  return json({ error: message }, status, headers);
}

let counter = 0;
function secret(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter}_${Math.random().toString(36).slice(2, 12)}`;
}

function makeCode(): string {
  // GESH's alphabet drops 0/O and 1/I so a code can be read aloud.
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let out = '';
  for (let i = 0; i < 10; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

function normalizeCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

async function bodyBytes(init?: RequestInit): Promise<Uint8Array> {
  const body = init?.body;
  if (!body) return new Uint8Array(0);
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  return new TextEncoder().encode(String(body));
}

async function bodyJson(init?: RequestInit): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(new TextDecoder().decode(await bodyBytes(init))) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function header(init: RequestInit | undefined, name: string): string | null {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const hit = Object.entries(headers).find(([k]) => k.toLowerCase() === name);
  return hit ? hit[1] : null;
}

function bearer(init?: RequestInit): string | null {
  const value = header(init, 'authorization');
  return value?.startsWith('Bearer ') ? value.slice(7) : null;
}

export function createFakeGesh(options: { publicUrl?: string | null } = {}): FakeGesh {
  const publicUrl = options.publicUrl === undefined ? 'https://relay.test' : options.publicUrl;
  const state: FakeGesh = {
    roots: new Map(),
    failNextWith: null,
    failWhen: null,
    requestLog: [],
    fetch: async () => new Response(null, { status: 500 }),
  };

  const key = (appId: string, rootId: string) => `${appId}:${rootId}`;

  state.fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const url = new URL(input);
    const path = url.pathname;
    state.requestLog.push(`${method} ${path}`);

    const matched = state.failWhen?.(method, path) ?? null;
    if (state.failNextWith !== null || matched !== null) {
      const status = matched ?? (state.failNextWith as number);
      state.failNextWith = null;
      if (status === 429) return err(429, 'slow down', { 'retry-after': '2' });
      if (status === 413) return new Response('payload too large', { status: 413 });
      return err(status, 'induced failure');
    }

    if (method === 'GET' && path === '/health') return json({ ok: true });

    if (method === 'POST' && path === '/v1/roots') {
      const body = await bodyJson(init);
      const appId = String(body['appId'] ?? '');
      const deviceId = String(body['deviceId'] ?? '');
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(appId) || !/^[A-Za-z0-9_-]{1,128}$/.test(deviceId)) {
        return err(400, 'bad identifier');
      }
      const rootId = `root_${secret('r')}`;
      const deviceToken = secret('dev');
      const root: Root = {
        appId,
        rootId,
        handle: typeof body['handle'] === 'string' ? body['handle'] : null,
        rootToken: secret('root'),
        devices: new Map([
          [deviceId, { deviceId, enrolledAtMs: Date.now(), lastSeenMs: null, ackCursor: null, token: deviceToken }],
        ]),
        events: [],
        usedEventIds: new Set(),
        codes: new Map(),
        nextCursor: 1,
      };
      state.roots.set(key(appId, rootId), root);
      return json(
        {
          app_id: appId,
          root_id: rootId,
          handle: root.handle,
          device_id: deviceId,
          root_token: root.rootToken,
          device_token: deviceToken,
        },
        201
      );
    }

    if (method === 'POST' && path === '/v1/enroll') {
      const body = await bodyJson(init);
      const code = normalizeCode(String(body['code'] ?? ''));
      const deviceId = String(body['deviceId'] ?? '');
      for (const root of state.roots.values()) {
        const found = root.codes.get(code);
        if (!found) continue;
        root.codes.delete(code); // single use
        if (found.expiresAtMs < Date.now()) return err(401, 'expired code');
        const token = secret('dev');
        // Re-enrolling an existing device id replaces its credential.
        root.devices.set(deviceId, {
          deviceId,
          enrolledAtMs: Date.now(),
          lastSeenMs: null,
          ackCursor: null,
          token,
        });
        return json({ app_id: root.appId, root_id: root.rootId, device_id: deviceId, token }, 201);
      }
      return err(401, 'unknown code');
    }

    const admin = /^\/v1\/admin\/([^/]+)\/([^/]+)(\/.*)?$/.exec(path);
    if (admin) {
      const root = state.roots.get(key(admin[1], admin[2]));
      if (!root) return err(404, 'no such root');
      const token = bearer(init);
      if (!token) return err(401, 'no credential');
      if (token !== root.rootToken) {
        const isDevice = [...root.devices.values()].some((d) => d.token === token);
        return err(isDevice ? 403 : 401, isDevice ? 'root credential required' : 'unknown credential');
      }
      const rest = admin[3] ?? '';

      if (method === 'POST' && rest === '/enrollments') {
        const code = makeCode();
        root.codes.set(normalizeCode(code), { deviceless: true, expiresAtMs: Date.now() + 600_000 });
        return json(
          {
            code,
            expires_at_ms: Date.now() + 600_000,
            pairing_uri: publicUrl
              ? `gesh://pair?s=${encodeURIComponent(publicUrl)}&c=${encodeURIComponent(code)}`
              : null,
          },
          201
        );
      }
      if (method === 'GET' && rest === '/devices') {
        return json(
          [...root.devices.values()]
            .sort((a, b) => a.enrolledAtMs - b.enrolledAtMs)
            .map((d) => ({
              device_id: d.deviceId,
              enrolled_at_ms: d.enrolledAtMs,
              last_seen_ms: d.lastSeenMs,
              ack_cursor: d.ackCursor,
            }))
        );
      }
      const revoke = /^\/devices\/([^/]+)$/.exec(rest);
      if (method === 'DELETE' && revoke) {
        if (!root.devices.delete(revoke[1])) return err(404, 'no such device');
        return new Response(null, { status: 204 });
      }
      if (method === 'PUT' && rest === '/handle') {
        const body = await bodyJson(init);
        root.handle = String(body['handle'] ?? '');
        return new Response(null, { status: 204 });
      }
      return err(404, 'no such admin route');
    }

    const sync = /^\/v1\/sync\/([^/]+)\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(path);
    if (sync) {
      const root = state.roots.get(key(sync[1], sync[2]));
      if (!root) return err(404, 'no such root');
      const token = bearer(init);
      if (!token) return err(401, 'no credential');
      const device = [...root.devices.values()].find((d) => d.token === token);
      const isRootToken = token === root.rootToken;
      if (!device && !isRootToken) return err(401, 'unknown credential');
      const [, , , deviceId, eventId] = sync;

      // A device credential speaks only for itself: it may not upload under
      // another device's path, nor report another device's ack. Downloads are
      // necessarily cross-device — the feed lists events by their author, and
      // collecting them is the entire point of the relay.
      if (device && method === 'PUT' && deviceId && deviceId !== device.deviceId) {
        return err(401, 'wrong device');
      }

      if (method === 'GET' && !deviceId) {
        const after = Number(url.searchParams.get('after') ?? '0');
        const limit = Number(url.searchParams.get('limit') ?? '100');
        if (!Number.isInteger(after) || after < 0) return err(400, 'bad cursor');
        if (!Number.isInteger(limit) || limit < 1 || limit > 500) return err(400, 'bad limit');
        const page = root.events.filter((e) => e.cursor > after).slice(0, limit);
        return json({
          events: page.map((e) => ({
            cursor: e.cursor,
            app_id: root.appId,
            root_id: root.rootId,
            device_id: e.deviceId,
            event_id: e.eventId,
            created_at_ms: e.createdAtMs,
            size: e.body.length,
          })),
          next_cursor: page.length ? page[page.length - 1].cursor : null,
        });
      }

      if (method === 'PUT' && deviceId && eventId) {
        if (header(init, 'content-type') !== 'application/octet-stream') return err(400, 'bad content type');
        if (root.usedEventIds.has(eventId)) return err(409, 'event exists');
        root.usedEventIds.add(eventId);
        root.events.push({
          cursor: root.nextCursor++,
          deviceId,
          eventId,
          createdAtMs: Date.now(),
          body: await bodyBytes(init),
        });
        return new Response(null, { status: 201 });
      }

      if (method === 'GET' && deviceId && eventId) {
        const found = root.events.find((e) => e.deviceId === deviceId && e.eventId === eventId);
        if (!found) return err(404, 'no such event');
        return new Response(found.body.slice().buffer as ArrayBuffer, {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        });
      }

      if (method === 'PUT' && deviceId && !eventId) {
        const body = await bodyJson(init);
        const ackCursor = Number(body['ackCursor']);
        if (!Number.isInteger(ackCursor) || ackCursor < 0) return err(400, 'bad ack cursor');
        const target = root.devices.get(deviceId);
        if (!target) return err(404, 'no such device');
        // Acknowledgements only ever move forward.
        target.ackCursor = Math.max(target.ackCursor ?? 0, ackCursor);
        target.lastSeenMs = Date.now();
        return json({
          device_id: deviceId,
          ack_cursor: target.ackCursor,
          last_seen_ms: target.lastSeenMs,
        });
      }
    }

    return err(404, 'no such route');
  };

  return state;
}
