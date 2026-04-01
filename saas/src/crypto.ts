import crypto from 'crypto';

// ── AES-256-GCM encryption ────────────────────────────────────
// Clave maestra desde ENCRYPTION_KEY env var (32 bytes hex = 64 chars)
// Los API keys nunca se almacenan en texto plano en la base de datos.

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;    // 96 bits (recomendado para GCM)
const TAG_LEN = 16;   // 128 bits auth tag

function getMasterKey(): Buffer {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) {
    throw new Error(
      'ENCRYPTION_KEY debe ser una cadena hexadecimal de 64 chars (32 bytes). ' +
      'Generar con: openssl rand -hex 32'
    );
  }
  return Buffer.from(keyHex, 'hex');
}

export function encrypt(plaintext: string): string {
  if (!plaintext) return '';
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Formato: iv(12) + tag(16) + ciphertext → base64
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decrypt(ciphertext: string): string {
  if (!ciphertext) return '';
  const key = getMasterKey();
  const buf = Buffer.from(ciphertext, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const encrypted = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

// Devuelve string vacío en lugar de lanzar error si el valor está vacío
export function safeDecrypt(ciphertext: string | null | undefined): string {
  if (!ciphertext) return '';
  try {
    return decrypt(ciphertext);
  } catch {
    return '';
  }
}
