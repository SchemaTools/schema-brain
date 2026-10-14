// Токены доступа (docs/spec.md, раздел 2.1): приставка sbt_ и 43 знака
// (32 случайных байта, base64url). В базе — только SHA-256 и первые 8 знаков.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOKEN_PREFIX = 'sbt_';
const TOKEN_RE = /^sbt_[A-Za-z0-9_-]{43}$/;

export function generateToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

export const isTokenShape = (value: string) => TOKEN_RE.test(value);

export const hashToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

/** Первые 8 знаков после приставки — чтобы узнать токен в списке, не показывая его. */
export const tokenHint = (token: string) => token.slice(TOKEN_PREFIX.length, TOKEN_PREFIX.length + 8);

/** Сравнение хэшей за постоянное время. */
export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Токен из заголовка «Authorization: Bearer sbt_…». */
export function bearer(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return match && isTokenShape(match[1]) ? match[1] : null;
}
