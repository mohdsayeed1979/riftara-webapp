import 'server-only';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { env } from '@/config/env';

/**
 * TOTP multi-factor authentication primitives (BRD §148-149).
 *
 * TOTP follows RFC 6238 / RFC 4226 using the Node standard-library HMAC-SHA1 —
 * no custom cryptography and no third-party auth dependency, matching the way
 * password hashing (scrypt) is implemented in this codebase. Secrets are
 * encrypted at rest with AES-256-GCM under a key derived from AUTH_SECRET, so a
 * database leak alone never exposes usable secrets. Recovery codes are stored
 * only as SHA-256 hashes (they are high-entropy tokens, hashed the same way the
 * app hashes session and API-key tokens), so the originals cannot be recovered.
 */

/* ------------------------------- Base32 ---------------------------------- */

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 (unpadded) — the encoding authenticator apps expect. */
export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += B32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/,'').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = B32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error('Invalid base32 character.');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/* -------------------------------- TOTP ----------------------------------- */

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Accept the adjacent step on each side to tolerate clock drift. */
export const TOTP_WINDOW = 1;

/** Generates a new base32 TOTP secret (160 bits, the RFC-recommended size). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function hotp(secretBase32: string, counter: number): string {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  // 64-bit big-endian counter.
  buf.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', key).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return (binary % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, '0');
}

/** Current TOTP for a secret (used in tests and for generating expected codes). */
export function generateTotp(secretBase32: string, atMs: number = Date.now()): string {
  return hotp(secretBase32, Math.floor(atMs / 1000 / TOTP_STEP_SECONDS));
}

/**
 * Verifies a 6-digit TOTP against the secret, allowing ±TOTP_WINDOW steps.
 * Constant-time digit comparison; rejects anything that is not exactly 6 digits.
 */
export function verifyTotp(secretBase32: string, token: string, atMs: number = Date.now()): boolean {
  const normalized = token.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  const counter = Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
  for (let error = -TOTP_WINDOW; error <= TOTP_WINDOW; error += 1) {
    const candidate = hotp(secretBase32, counter + error);
    const a = Buffer.from(candidate);
    const b = Buffer.from(normalized);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

/** Standard otpauth:// provisioning URI for QR codes and manual entry. */
export function buildOtpauthUri(secretBase32: string, accountName: string, issuer = 'RIFTARA'): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/* --------------------------- Secret encryption --------------------------- */

// A dedicated 32-byte key derived from AUTH_SECRET, so the raw TOTP secret is
// never stored in the clear. Derivation is fixed and deterministic.
const encryptionKey = scryptSync(env.AUTH_SECRET, 'riftara-mfa-secret-encryption-v1', 32);

/** AES-256-GCM. Output: iv(hex).authTag(hex).ciphertext(hex). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}.${authTag.toString('hex')}.${ciphertext.toString('hex')}`;
}

export function decryptSecret(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split('.');
  if (!ivHex || !tagHex || !dataHex) throw new Error('Malformed encrypted secret.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

/* ----------------------------- Recovery codes ---------------------------- */

export const RECOVERY_CODE_COUNT = 10;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I

/** Normalises a recovery code for hashing/comparison (case- and dash-insensitive). */
export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]+/g, '').toUpperCase();
}

/** Hash used for recovery-code storage — SHA-256, consistent with token hashing. */
export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

/** Generates display codes formatted `XXXX-XXXX`. Returns the plaintext codes. */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    let raw = '';
    for (let c = 0; c < 8; c += 1) raw += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return codes;
}
