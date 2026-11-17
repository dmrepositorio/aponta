import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// AES-256-GCM: iv (12) + etiqueta (16) + texto cifrado, em base64.
export function encryptText(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

/** Lança se o texto foi adulterado ou a chave é outra. */
export function decryptText(stored: string, key: Buffer): string {
  const raw = Buffer.from(stored, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
