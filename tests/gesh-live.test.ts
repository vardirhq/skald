// A smoke test against a real GESH relay, skipped unless one is named:
//
//   GESH_URL=https://gesh.vardir.no npx vitest run tests/gesh-live.test.ts
//
// Everything else in the suite runs against an in-memory relay that encodes how
// the protocol is *documented*. This one checks the documentation against a
// running server, which is the only way to catch a divergence between them.
//
// It provisions a root, so it leaves one behind — GESH has no delete-root
// endpoint. It revokes the devices it enrolled on the way out.

import { describe, it, expect } from 'vitest';
import { GeshClient } from '../src-shared/gesh/protocol';
import { newDeviceId, newEventId } from '../src-shared/gesh/ids';
import { generateContentKey, openEvent, sealEvent } from '../src-shared/gesh/crypto';
import { utf8Decode, utf8Encode } from '../src-shared/gesh/bytes';
import { parsePairingUri, withContentKey, buildPairingUri } from '../src-shared/gesh/pairing';

const baseUrl = process.env.GESH_URL;

describe.skipIf(!baseUrl)('a real GESH relay', () => {
  const client = new GeshClient({ baseUrl: baseUrl ?? 'https://unused.test' });

  it('is alive', async () => {
    expect(await client.health()).toBe(true);
  });

  it('carries an encrypted note from one device to another', async () => {
    const deviceA = newDeviceId('smoke-a');
    const root = await client.provisionRoot({
      appId: 'skald',
      deviceId: deviceA,
      ...(process.env.GESH_PROVISIONING_SECRET
        ? { provisioningSecret: process.env.GESH_PROVISIONING_SECRET }
        : {}),
    });
    const ref = { appId: root.appId, rootId: root.rootId };
    const key = await generateContentKey();

    // Device A publishes.
    const plaintext = utf8Encode('# Smoke\n\nWritten by the live test.\n');
    const eventId = newEventId();
    expect(await client.putEvent(ref, deviceA, eventId, await sealEvent(key, plaintext), root.deviceToken)).toBe(
      'created'
    );
    // The same id again is the retry case, and must not read as an error.
    expect(await client.putEvent(ref, deviceA, eventId, new Uint8Array([0]), root.deviceToken)).toBe('duplicate');

    // Device B pairs in and collects it.
    const minted = await client.mintEnrollment(ref, root.rootToken);
    const invite = parsePairingUri(
      withContentKey(minted.pairingUri ?? buildPairingUri(client.baseUrl, minted.code), 'unused')
    );
    const deviceB = newDeviceId('smoke-b');
    const enrolled = await client.redeemEnrollment({ code: invite.code, deviceId: deviceB });
    expect(enrolled.rootId).toBe(root.rootId);

    const page = await client.listEvents(ref, enrolled.token, { limit: 10 });
    const mine = page.events.find((e) => e.eventId === eventId);
    expect(mine, 'the uploaded event should appear in the feed').toBeTruthy();

    // The download is cross-device by necessity: the feed names the author.
    const blob = await client.getEvent(ref, mine!.deviceId, mine!.eventId, enrolled.token);
    expect(blob).toBeTruthy();
    expect(utf8Decode(await openEvent(key, blob!))).toBe('# Smoke\n\nWritten by the live test.\n');

    await client.ack(ref, deviceB, enrolled.token, mine!.cursor);

    // The device credential must not reach the admin plane.
    await expect(client.listDevices(ref, enrolled.token)).rejects.toMatchObject({ status: 403 });

    for (const id of [deviceB, deviceA]) {
      await client.revokeDevice(ref, root.rootToken, id).catch(() => {});
    }
  }, 60_000);
});
