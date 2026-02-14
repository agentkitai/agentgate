/**
 * AES-256-GCM encryption for webhook secrets at rest.
 * Format: enc:<iv_hex>.<auth_tag_hex>.<ciphertext_hex>
 */
import crypto from 'crypto';

const PREFIX = 'enc:';
const IV_BYTES = 12; // GCM standard
// TAG_BYTES = 16 (AES-GCM auth tag length, used implicitly by Node crypto)

/**
 * Derive a 32-byte key from an arbitrary string using SHA-256.
 */
export function deriveKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Check whether a value is already encrypted (has the enc: prefix).
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

/**
 * Encrypt plaintext using AES-256-GCM.
 * Returns `enc:<iv_hex>.<tag_hex>.<ciphertext_hex>`
 */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('hex')}.${tag.toString('hex')}.${encrypted.toString('hex')}`;
}

/**
 * Decrypt a value. If it doesn't have the enc: prefix, return as-is (backward compat).
 */
export function decrypt(value: string, key: Buffer): string {
  if (!isEncrypted(value)) {
    return value; // plaintext fallback
  }

  const body = value.slice(PREFIX.length);
  const parts = body.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted format');
  }

  const [ivHex, tagHex, ciphertextHex] = parts;
  if (!ivHex || !tagHex || ciphertextHex === undefined) {
    throw new Error('Invalid encrypted format: missing components');
  }
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}
