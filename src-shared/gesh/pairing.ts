// Pairing URIs, parsed and built by hand rather than through `URL`, because
// `gesh:` is not a special scheme and platforms disagree about what they do
// with the authority and fragment of one.
//
// The shape is:
//
//   gesh://pair?s=<server>&c=<code>#k=<base64url content key>
//
// The query half is what the relay minted. The fragment half is ours, and is
// the reason one QR code can carry both without GESH ever receiving the key —
// a fragment is never transmitted to a server.

import { normalizeEnrollmentCode } from './ids';

export interface PairingInvite {
  /** Base URL of the GESH relay, e.g. `https://gesh.vardir.no`. */
  server: string;
  /** The pairing code, normalized. */
  code: string;
  /** base64url content key from the fragment, or null when the URI carried none. */
  contentKey: string | null;
}

const PAIRING_RE = /^gesh:\/\/pair\?([^#]*)(?:#(.*))?$/i;

function parsePairs(input: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const chunk of input.split('&')) {
    if (!chunk) continue;
    const eq = chunk.indexOf('=');
    const key = eq === -1 ? chunk : chunk.slice(0, eq);
    const value = eq === -1 ? '' : chunk.slice(eq + 1);
    try {
      out.set(decodeURIComponent(key), decodeURIComponent(value.replace(/\+/g, ' ')));
    } catch {
      // A malformed escape makes the whole parameter unusable; skip it and let
      // the caller fail on the missing field with a clearer message.
    }
  }
  return out;
}

/** Build the query half ourselves, for a relay that has no `GESH_PUBLIC_URL` set. */
export function buildPairingUri(server: string, code: string): string {
  const clean = server.replace(/\/+$/, '');
  return `gesh://pair?s=${encodeURIComponent(clean)}&c=${encodeURIComponent(code)}`;
}

/**
 * Append the content key as a fragment. This is the only place the key is ever
 * allowed to appear in a URI — a query parameter or a header would hand it
 * straight to the relay and lose the entire security model.
 */
export function withContentKey(pairingUri: string, contentKeyBase64Url: string): string {
  if (!contentKeyBase64Url) throw new Error('A pairing URI needs a content key');
  const base = pairingUri.split('#')[0];
  return `${base}#k=${contentKeyBase64Url}`;
}

export function parsePairingUri(uri: string): PairingInvite {
  const match = PAIRING_RE.exec(uri.trim());
  if (!match) throw new Error('That does not look like a Skald pairing link');
  const query = parsePairs(match[1]);
  const fragment = parsePairs(match[2] ?? '');

  const server = (query.get('s') ?? '').trim();
  const rawCode = (query.get('c') ?? '').trim();
  if (!/^https?:\/\/[^\s]+$/i.test(server)) throw new Error('The pairing link has no usable server address');
  const code = normalizeEnrollmentCode(rawCode);
  if (!code) throw new Error('The pairing link has no pairing code');

  const key = (fragment.get('k') ?? '').trim();
  return {
    server: server.replace(/\/+$/, ''),
    code,
    contentKey: key || null,
  };
}

/** Formats a normalized code back into the grouped shape GESH prints. */
export function formatEnrollmentCode(code: string): string {
  const clean = normalizeEnrollmentCode(code).toUpperCase();
  if (clean.length !== 10) return clean;
  return `${clean.slice(0, 5)}-${clean.slice(5)}`;
}
