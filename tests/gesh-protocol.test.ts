import { describe, it, expect } from 'vitest';
import { GeshClient, GeshError } from '../src-shared/gesh/protocol';
import { createFakeGesh } from './helpers/fakeGesh';
import {
  isIdentifier,
  isHandle,
  newDeviceId,
  newEventId,
  normalizeEnrollmentCode,
} from '../src-shared/gesh/ids';

function clientFor(gesh = createFakeGesh()) {
  return { gesh, client: new GeshClient({ baseUrl: 'https://relay.test', fetch: gesh.fetch }) };
}

describe('identifiers', () => {
  it('accepts what GESH accepts and refuses what it refuses', () => {
    expect(isIdentifier('skald')).toBe(true);
    expect(isIdentifier('desktop_ab12')).toBe(true);
    expect(isIdentifier('a'.repeat(128))).toBe(true);
    expect(isIdentifier('a'.repeat(129))).toBe(false);
    expect(isIdentifier('')).toBe(false);
    expect(isIdentifier('has space')).toBe(false);
    expect(isIdentifier('../escape')).toBe(false);
    expect(isIdentifier('dots.are.out')).toBe(false);
  });

  it('holds handles to the narrower rule', () => {
    expect(isHandle('madsen-home')).toBe(true);
    expect(isHandle('ab')).toBe(false);
    expect(isHandle('Madsen')).toBe(false);
    expect(isHandle('under_score')).toBe(false);
  });

  it('normalizes a code the way a person would read one aloud', () => {
    expect(normalizeEnrollmentCode('79T54-26AJX')).toBe('79t5426ajx');
    expect(normalizeEnrollmentCode(' 79t54 26ajx ')).toBe('79t5426ajx');
  });

  it('generates identifiers the protocol will take', () => {
    for (let i = 0; i < 50; i++) {
      expect(isIdentifier(newDeviceId('desktop'))).toBe(true);
      expect(isIdentifier(newEventId())).toBe(true);
    }
    expect(newEventId()).not.toBe(newEventId());
  });

  it('refuses to build a client on a non-http address', () => {
    expect(() => new GeshClient({ baseUrl: 'ftp://relay.test' })).toThrow();
    expect(() => new GeshClient({ baseUrl: 'relay.test' })).toThrow();
  });
});

describe('GeshClient', () => {
  it('sends camelCase and reads back snake_case', async () => {
    const { client } = clientFor();
    const root = await client.provisionRoot({ appId: 'skald', deviceId: 'desktop_a' });
    expect(root.rootId).toMatch(/^root_/);
    expect(root.rootToken).toBeTruthy();
    expect(root.deviceToken).toBeTruthy();
    expect(root.rootToken).not.toBe(root.deviceToken);
  });

  it('treats a reused event id as success on retry, not an error', async () => {
    const { client } = clientFor();
    const root = await client.provisionRoot({ appId: 'skald', deviceId: 'desktop_a' });
    const ref = { appId: root.appId, rootId: root.rootId };
    const body = new Uint8Array([1, 2, 3]);

    expect(await client.putEvent(ref, 'desktop_a', 'evt_1', body, root.deviceToken)).toBe('created');
    expect(await client.putEvent(ref, 'desktop_a', 'evt_1', body, root.deviceToken)).toBe('duplicate');
  });

  it('lists incrementally from an opaque cursor and downloads the blob unchanged', async () => {
    const { client } = clientFor();
    const root = await client.provisionRoot({ appId: 'skald', deviceId: 'desktop_a' });
    const ref = { appId: root.appId, rootId: root.rootId };
    for (const n of [1, 2, 3]) {
      await client.putEvent(ref, 'desktop_a', `evt_${n}`, new Uint8Array([n, n, n]), root.deviceToken);
    }

    const first = await client.listEvents(ref, root.deviceToken, { limit: 2 });
    expect(first.events.map((e) => e.eventId)).toEqual(['evt_1', 'evt_2']);
    expect(first.nextCursor).toBe(first.events[1].cursor);

    const second = await client.listEvents(ref, root.deviceToken, { after: first.nextCursor! });
    expect(second.events.map((e) => e.eventId)).toEqual(['evt_3']);

    const blob = await client.getEvent(ref, 'desktop_a', 'evt_2', root.deviceToken);
    expect(Array.from(blob!)).toEqual([2, 2, 2]);
  });

  it('reports an erased event as null rather than throwing', async () => {
    const { client } = clientFor();
    const root = await client.provisionRoot({ appId: 'skald', deviceId: 'desktop_a' });
    const ref = { appId: root.appId, rootId: root.rootId };
    expect(await client.getEvent(ref, 'desktop_a', 'evt_gone', root.deviceToken)).toBeNull();
  });

  it('moves an ack forward but never back', async () => {
    const { client } = clientFor();
    const root = await client.provisionRoot({ appId: 'skald', deviceId: 'desktop_a' });
    const ref = { appId: root.appId, rootId: root.rootId };
    expect((await client.ack(ref, 'desktop_a', root.deviceToken, 7)).ackCursor).toBe(7);
    expect((await client.ack(ref, 'desktop_a', root.deviceToken, 3)).ackCursor).toBe(7);
  });

  it('rejects a page limit the relay would refuse, without a round trip', async () => {
    const { gesh, client } = clientFor();
    const root = await client.provisionRoot({ appId: 'skald', deviceId: 'desktop_a' });
    const ref = { appId: root.appId, rootId: root.rootId };
    gesh.requestLog.length = 0;
    await expect(client.listEvents(ref, root.deviceToken, { limit: 900 })).rejects.toThrow(/between 1 and 500/);
    expect(gesh.requestLog).toHaveLength(0);
  });

  it('answers 403 to a device credential on the admin plane', async () => {
    const { client } = clientFor();
    const root = await client.provisionRoot({ appId: 'skald', deviceId: 'desktop_a' });
    const ref = { appId: root.appId, rootId: root.rootId };
    await expect(client.listDevices(ref, root.deviceToken)).rejects.toMatchObject({ status: 403 });
  });

  it('carries Retry-After through a 429', async () => {
    const { gesh, client } = clientFor();
    gesh.failNextWith = 429;
    const failure = await client.health().catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(GeshError);
    expect((failure as GeshError).status).toBe(429);
    expect((failure as GeshError).retryAfterMs).toBe(2000);
    expect((failure as GeshError).isTransient).toBe(true);
  });

  it('parses a plain-text framework error without assuming the JSON shape', async () => {
    const { gesh, client } = clientFor();
    gesh.failNextWith = 413;
    const failure = await client.health().catch((e: unknown) => e);
    expect((failure as GeshError).status).toBe(413);
    expect((failure as GeshError).message).toMatch(/larger than the relay accepts/);
  });

  it('reports an unreachable server as a plain failure, not a protocol error', async () => {
    const client = new GeshClient({
      baseUrl: 'https://relay.test',
      fetch: () => Promise.reject(new Error('ECONNREFUSED')),
    });
    await expect(client.health()).rejects.toThrow(/unreachable/);
  });

  it('pairs a second device without it knowing the root id', async () => {
    const { client } = clientFor();
    const root = await client.provisionRoot({ appId: 'skald', deviceId: 'desktop_a' });
    const ref = { appId: root.appId, rootId: root.rootId };
    const minted = await client.mintEnrollment(ref, root.rootToken);

    const enrolled = await client.redeemEnrollment({ code: minted.code, deviceId: 'phone_b' });
    expect(enrolled.rootId).toBe(root.rootId);
    expect(enrolled.token).not.toBe(root.rootToken);

    // Codes are single use.
    await expect(client.redeemEnrollment({ code: minted.code, deviceId: 'phone_c' })).rejects.toMatchObject({
      status: 401,
    });
  });

  it('revokes one device and leaves the rest alone', async () => {
    const { client } = clientFor();
    const root = await client.provisionRoot({ appId: 'skald', deviceId: 'desktop_a' });
    const ref = { appId: root.appId, rootId: root.rootId };
    const minted = await client.mintEnrollment(ref, root.rootToken);
    const phone = await client.redeemEnrollment({ code: minted.code, deviceId: 'phone_b' });

    await client.revokeDevice(ref, root.rootToken, 'phone_b');
    expect((await client.listDevices(ref, root.rootToken)).map((d) => d.deviceId)).toEqual(['desktop_a']);
    await expect(client.listEvents(ref, phone.token)).rejects.toMatchObject({ status: 401 });
  });
});
