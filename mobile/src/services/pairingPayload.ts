/**
 * The QR code only carries what the Controller needs to *start* pairing:
 *   peerview://pair?v=1&c=<6 digit code>&n=<one time nonce>
 *
 * The nonce is random, single use and expires with the code (5 minutes). It
 * gives QR pairing much more entropy than the 6 digits typed by hand. There are
 * no passwords, tokens, keys or user ids in here, so a photographed QR code is
 * useless once it expires, and even before that the Host still has to approve.
 */
export interface PairingPayload {
  code: string;
  nonce?: string;
}

const SCHEME = 'peerview://pair';

export function buildPairingUri(p: PairingPayload): string {
  const params = [`v=1`, `c=${encodeURIComponent(p.code)}`];
  if (p.nonce) params.push(`n=${encodeURIComponent(p.nonce)}`);
  return `${SCHEME}?${params.join('&')}`;
}

export function parsePairingUri(raw: string): PairingPayload | null {
  if (!raw.startsWith(`${SCHEME}?`)) return null;
  const query = raw.slice(SCHEME.length + 1);
  const params: Record<string, string> = {};
  for (const part of query.split('&')) {
    const [k, v = ''] = part.split('=');
    if (k) params[k] = decodeURIComponent(v);
  }
  if (params.v !== '1' || !/^\d{6}$/.test(params.c ?? '')) return null;
  if (params.n !== undefined && !/^[A-Za-z0-9_-]{16,64}$/.test(params.n)) return null;
  return { code: params.c, nonce: params.n };
}
