// Сотрудники, токены, сеансы веба (docs/spec.md, разделы 2.1, 2.2, 2.4).
import { randomBytes } from 'node:crypto';
import {
  CLIENTS,
  type Client,
  generateToken,
  hashToken,
  SCOPES,
  type Scope,
  tokenHint,
} from '../../../../packages/core/src/index.ts';
import { AppError, type Ctx, invalid, need, notFound } from '../context.ts';
import type { Db } from '../db/client.ts';

export const DEFAULT_SCOPES: Record<Client, Scope[]> = {
  web: ['read', 'propose', 'feedback'],
  claude: ['read', 'propose', 'feedback'],
  chatgpt: ['read', 'propose', 'feedback'],
  codex: ['read', 'propose', 'feedback'],
  local: ['read'],
  import: ['read', 'propose'],
};

const SESSION_DAYS = 30;

export async function addPerson(db: Db, label: string) {
  const clean = label.trim().replace(/\s+/g, ' ');
  if (!clean || [...clean].length > 60) throw invalid('Ярлык сотрудника — от 1 до 60 знаков, например «проектировщик АР-2»');
  if (await db.person.findUnique({ where: { label: clean } })) throw invalid(`Ярлык «${clean}» уже занят`);
  return db.person.create({ data: { label: clean } });
}

export async function findPerson(db: Db, label: string) {
  const person = await db.person.findUnique({ where: { label: label.trim() } });
  if (!person) throw notFound(`Сотрудник «${label}»`);
  return person;
}

export function listPersons(db: Db) {
  return db.person.findMany({
    orderBy: { label: 'asc' },
    include: { tokens: { where: { revoked: null }, select: { id: true, client: true, scopes: true, hint: true, note: true, lastUsed: true } } },
  });
}

/** Выпуск токена. Сам токен возвращается один раз — в базе только хэш. */
export async function issueToken(
  db: Db,
  personId: string,
  client: string,
  scopes?: string[],
  note = '',
): Promise<{ token: string; id: string }> {
  if (!CLIENTS.includes(client as Client)) throw invalid(`Клиент — один из: ${CLIENTS.join(', ')}`);
  const chosen = (scopes?.length ? scopes : DEFAULT_SCOPES[client as Client]) as Scope[];
  const wrong = chosen.filter((s) => !SCOPES.includes(s));
  if (wrong.length) throw invalid(`Неизвестные права: ${wrong.join(', ')}; допустимы ${SCOPES.join(', ')}`);
  const person = await db.person.findUnique({ where: { id: personId } });
  if (!person || !person.active) throw notFound('Сотрудник');
  const token = generateToken();
  const row = await db.token.create({
    data: { personId, client, scopes: [...new Set(chosen)], hash: hashToken(token), hint: tokenHint(token), note: note.slice(0, 100) },
  });
  return { token, id: row.id };
}

export async function revokeToken(db: Db, ctx: Ctx | null, tokenId: string) {
  if (ctx) need(ctx, 'moderate');
  const row = await db.token.findUnique({ where: { id: tokenId } });
  if (!row) throw notFound('Токен');
  await db.$transaction([
    db.token.update({ where: { id: tokenId }, data: { revoked: new Date() } }),
    db.session.deleteMany({ where: { tokenId } }),
  ]);
}

function toCtx(token: { id: string; client: string; scopes: string[]; person: { id: string; label: string } }): Ctx {
  return {
    personId: token.person.id,
    label: token.person.label,
    tokenId: token.id,
    client: token.client as Client,
    scopes: token.scopes as Scope[],
  };
}

/** Кто за токеном; null — токена нет, он отозван или сотрудник отключён. */
export async function authenticate(db: Db, token: string): Promise<Ctx | null> {
  const row = await db.token.findUnique({ where: { hash: hashToken(token) }, include: { person: true } });
  if (!row || row.revoked || !row.person.active) return null;
  // отметка «последнее использование» — не чаще раза в минуту
  if (!row.lastUsed || Date.now() - row.lastUsed.getTime() > 60_000) {
    await db.token.update({ where: { id: row.id }, data: { lastUsed: new Date() } });
  }
  return toCtx(row);
}

/** Вход в веб по токену: новый сеанс, его id — в cookie. */
export async function openSession(db: Db, token: string): Promise<{ id: string; ctx: Ctx; expires: Date }> {
  const ctx = await authenticate(db, token);
  if (!ctx) throw new AppError(401, 'unauthorized', 'Токен недействителен — попросите у модератора новый');
  const id = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.session.create({ data: { id: hashToken(id), personId: ctx.personId, tokenId: ctx.tokenId, expires } });
  return { id, ctx, expires };
}

export async function sessionCtx(db: Db, id: string): Promise<Ctx | null> {
  const row = await db.session.findUnique({
    where: { id: hashToken(id) },
    include: { token: { include: { person: true } } },
  });
  if (!row || row.expires < new Date() || row.token.revoked || !row.token.person.active) return null;
  return toCtx(row.token);
}

export async function closeSession(db: Db, id: string) {
  await db.session.deleteMany({ where: { id: hashToken(id) } });
}
