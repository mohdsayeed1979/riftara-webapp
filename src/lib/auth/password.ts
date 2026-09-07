import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

// promisify cannot resolve the overload that accepts scrypt options.
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * Password hashing with scrypt (RFC 7914) from the Node standard library.
 * No native build step, no third-party dependency, memory-hard by design.
 *
 * Stored format: scrypt$N$r$p$<salt-hex>$<hash-hex>
 */
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(plain.normalize('NFKC'), salt, KEY_LENGTH, {
    N,
    r: R,
    p: P,
    maxmem: 256 * 1024 * 1024,
  });
  return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(plain: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nRaw, rRaw, pRaw, saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');

  const derived = await scryptAsync(plain.normalize('NFKC'), salt, expected.length, {
    N: Number(nRaw),
    r: Number(rRaw),
    p: Number(pRaw),
    maxmem: 256 * 1024 * 1024,
  });

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export interface PasswordPolicyResult {
  valid: boolean;
  errors: string[];
}

/**
 * Strong password policy (BRD 148). Enforced on registration and on change.
 */
export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  const errors: string[] = [];
  if (password.length < 12) errors.push('Must be at least 12 characters long.');
  if (!/[a-z]/.test(password)) errors.push('Must contain a lowercase letter.');
  if (!/[A-Z]/.test(password)) errors.push('Must contain an uppercase letter.');
  if (!/[0-9]/.test(password)) errors.push('Must contain a digit.');
  if (!/[^A-Za-z0-9]/.test(password)) errors.push('Must contain a symbol.');
  if (/^(.)\1+$/.test(password)) errors.push('Must not be a single repeated character.');
  return { valid: errors.length === 0, errors };
}
