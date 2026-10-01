import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// scrypt from node:crypto: no native dependency. N=2^15, r=8 needs 32 MiB per hash.
const PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } satisfies ScryptOptions;
const KEY_LEN = 32;

function derive(password: string, salt: Buffer, opts: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEY_LEN, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** `scrypt$N$r$p$salt$hash` (base64url), so the parameters can change later. */
export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string) {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const key = await derive(password, Buffer.from(salt, 'base64url'), { N: Number(n), r: Number(r), p: Number(p), maxmem: PARAMS.maxmem });
  return key.length === expected.length && timingSafeEqual(key, expected);
}
