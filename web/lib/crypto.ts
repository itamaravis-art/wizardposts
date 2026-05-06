/**
 * AES-256-GCM symmetric encryption for at-rest secrets stored in our DB.
 *
 * Used for Facebook Page access tokens. The token itself comes from
 * Meta's Graph API and lets the holder publish to the user's Page;
 * leaking it would let an attacker post on behalf of the user, so we
 * never store the raw token — only the ciphertext from `encrypt()`.
 *
 * Why GCM (and not e.g. CBC + HMAC):
 *   - GCM provides authenticated encryption (AEAD): the auth tag
 *     guarantees the ciphertext + IV haven't been tampered with.
 *     Any flipped bit in the DB row makes decrypt() throw.
 *   - Single primitive, single key. Simpler reasoning than encrypt-
 *     then-MAC compositions.
 *
 * Storage format (single string, base64url throughout, NO padding):
 *   <iv:12 bytes>.<auth_tag:16 bytes>.<ciphertext:variable>
 * Splitting on '.' is safe because base64url has no '.' character.
 *
 * The key is read once at module load from `ENCRYPTION_KEY` (a 64-char
 * hex string = 32 bytes). Generate one with:
 *   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
 *
 * If you ever rotate the key, store the old key under a versioned
 * suffix (e.g. ENCRYPTION_KEY_V1) and add a `kid` prefix to the
 * ciphertext format. Out of scope today — we have one key.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCMTypes,
} from 'node:crypto';

const ALGORITHM: CipherGCMTypes = 'aes-256-gcm';
const KEY_BYTES = 32; // 256 bits
const IV_BYTES = 12; // GCM standard nonce length
const AUTH_TAG_BYTES = 16;

let keyCache: Buffer | null = null;

function getKey(): Buffer {
  if (keyCache) return keyCache;
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY env var is not set. Generate with: ' +
        'node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  // Accept hex (64 chars) or base64. Hex is the documented format.
  let buf: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw.trim())) {
    buf = Buffer.from(raw.trim(), 'hex');
  } else {
    buf = Buffer.from(raw.trim(), 'base64');
  }
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes (got ${buf.length})`,
    );
  }
  keyCache = buf;
  return buf;
}

function b64u(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64uDecode(s: string): Buffer {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

/**
 * Encrypt a UTF-8 string. Output is opaque base64url (`iv.tag.ct`).
 * Safe to store in a `text` column.
 */
export function encrypt(plaintext: string): string {
  if (typeof plaintext !== 'string') {
    throw new TypeError('encrypt() expects a string');
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${b64u(iv)}.${b64u(tag)}.${b64u(ct)}`;
}

/**
 * Decrypt a string produced by `encrypt()`. Throws if the input is
 * malformed, the IV/tag are corrupt, or the ciphertext was tampered
 * with — never silently returns wrong plaintext.
 */
export function decrypt(payload: string): string {
  if (typeof payload !== 'string') {
    throw new TypeError('decrypt() expects a string');
  }
  const parts = payload.split('.');
  if (parts.length !== 3) {
    throw new Error('decrypt: malformed payload (expected iv.tag.ct)');
  }
  const [ivStr, tagStr, ctStr] = parts;
  const iv = b64uDecode(ivStr!);
  const tag = b64uDecode(tagStr!);
  const ct = b64uDecode(ctStr!);
  if (iv.length !== IV_BYTES) {
    throw new Error(`decrypt: IV length ${iv.length}, expected ${IV_BYTES}`);
  }
  if (tag.length !== AUTH_TAG_BYTES) {
    throw new Error(
      `decrypt: auth tag length ${tag.length}, expected ${AUTH_TAG_BYTES}`,
    );
  }
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

/**
 * Convenience: try-decrypt that returns null on any failure. Use only
 * when you genuinely don't care whether the value was tampered with
 * (e.g. logging the prefix of a token for debugging).
 */
export function tryDecrypt(payload: string | null | undefined): string | null {
  if (!payload) return null;
  try {
    return decrypt(payload);
  } catch {
    return null;
  }
}
