// Кто делает запрос и что ему можно (docs/spec.md, раздел 2).
import type { Client, Scope } from '../../../packages/core/src/index.ts';

export interface Ctx {
  personId: string;
  label: string;
  tokenId: string;
  client: Client;
  scopes: Scope[];
}

/** Ошибка для человека или агента: код для программы, сообщение — по-русски. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: string[];
  constructor(status: number, code: string, message: string, details: string[] = []) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what: string) => new AppError(404, 'not_found', `${what} не найдена`);
export const invalid = (message: string, details: string[] = []) =>
  new AppError(400, 'invalid', message, details);
export const conflict = (message: string) => new AppError(409, 'conflict', message);

const SCOPE_RU: Record<Scope, string> = {
  read: 'чтение',
  propose: 'отправку записей',
  feedback: 'отметки',
  moderate: 'модерацию',
};

export function need(ctx: Ctx, scope: Scope) {
  if (!ctx.scopes.includes(scope)) {
    throw new AppError(403, 'forbidden', `У токена нет права на ${SCOPE_RU[scope]}`);
  }
}

/** Действие от имени сервиса (команды на сервере: импорт, выгрузка, настройка). */
export function systemCtx(personId: string, label: string, scopes: Scope[] = ['read', 'propose', 'feedback', 'moderate']): Ctx {
  return { personId, label, tokenId: '', client: 'import', scopes };
}
