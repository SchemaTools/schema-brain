// HTTP API (docs/spec.md, раздел 8). Токен — «Authorization: Bearer sbt_…» или cookie сеанса веба.
// Ответы — JSON; у ответов для агента есть поле text — готовые короткие строки (раздел 7).
import { existsSync } from 'node:fs';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { bearer } from '../../../packages/core/src/index.ts';
import { AppError, type Ctx, need } from './context.ts';
import type { Db } from './db/client.ts';
import { closeSession, listPersons, addPerson, issueToken, openSession, revokeToken, authenticate, sessionCtx } from './services/people.ts';
import * as records from './services/records.ts';

export interface AppOptions {
  db: Db;
  version: string;
  cookieSecure?: boolean;
  /** журнал запросов: false — выключен, иначе уровень (info, warn, …) */
  logger?: false | { level: string };
  /** отправок в час с одного токена (раздел 12) */
  proposeLimit?: number;
  /** папка собранного веба (apps/web/dist); нет папки — только API */
  webDir?: string;
}

const SESSION_COOKIE = 'sb_session';

declare module 'fastify' {
  interface FastifyRequest {
    ctx?: Ctx;
  }
}

export function buildApp(opts: AppOptions) {
  const { db } = opts;
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 64 * 1024 });
  app.register(cookie);
  if (opts.webDir && existsSync(opts.webDir)) {
    const webDir = opts.webDir;
    // wildcard: true — файлы ищутся на диске при каждом запросе (а не только те, что были при запуске)
    app.register(fastifyStatic, { root: webDir, wildcard: true });
    // адреса веба — через #, но на всякий случай любой не-API адрес отдаёт страницу приложения
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) return reply.sendFile('index.html', webDir);
      return reply.status(404).send({ error: 'not_found', message: 'Нет такого адреса' });
    });
  }

  const proposals = new Map<string, number[]>();
  const proposeLimit = opts.proposeLimit ?? 30;
  function throttle(ctx: Ctx) {
    const now = Date.now();
    const recent = (proposals.get(ctx.tokenId) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= proposeLimit) {
      throw new AppError(429, 'too_many', `Не больше ${proposeLimit} отправок в час с одного токена`);
    }
    recent.push(now);
    proposals.set(ctx.tokenId, recent);
  }

  app.setErrorHandler((error: Error & { statusCode?: number; validation?: unknown }, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.status).send({ error: error.code, message: error.message, details: error.details });
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: 'invalid', message: 'Неверный запрос', details: [error.message] });
    }
    request.log.error(error);
    return reply.status(500).send({ error: 'internal', message: 'Внутренняя ошибка сервиса' });
  });

  async function auth(request: FastifyRequest): Promise<Ctx> {
    if (request.ctx) return request.ctx;
    const token = bearer(request.headers.authorization);
    let ctx: Ctx | null = null;
    if (token) ctx = await authenticate(db, token);
    else if (request.cookies[SESSION_COOKIE]) ctx = await sessionCtx(db, request.cookies[SESSION_COOKIE]!);
    if (!ctx) throw new AppError(401, 'unauthorized', 'Нужен действующий токен доступа');
    request.ctx = ctx;
    // журнал: ярлык и клиент, без текста записей (раздел 12)
    request.log.info({ who: ctx.label, client: ctx.client }, 'запрос');
    return ctx;
  }

  const body = (request: FastifyRequest) => (request.body ?? {}) as Record<string, unknown>;
  const query = (request: FastifyRequest) => (request.query ?? {}) as Record<string, string | undefined>;
  const num = (request: FastifyRequest) => records.parseNumber((request.params as { number: string }).number);
  const int = (value: string | undefined) => (value === undefined || value === '' ? undefined : Number(value));
  const flag = (value: string | undefined) => value === 'true' || value === '1';

  app.get('/api/health', async () => {
    await db.$queryRaw`SELECT 1`;
    return { ok: true, version: opts.version };
  });

  // --- вход в веб ---
  app.post('/api/session', async (request, reply) => {
    const token = String(body(request).token ?? '').trim();
    const session = await openSession(db, token);
    reply.setCookie(SESSION_COOKIE, session.id, {
      httpOnly: true,
      sameSite: 'strict',
      secure: opts.cookieSecure ?? false,
      path: '/',
      expires: session.expires,
    });
    return { label: session.ctx.label, scopes: session.ctx.scopes };
  });
  app.delete('/api/session', async (request, reply) => {
    const id = request.cookies[SESSION_COOKIE];
    if (id) await closeSession(db, id);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
  app.get('/api/me', async (request) => {
    const ctx = await auth(request);
    return { label: ctx.label, client: ctx.client, scopes: ctx.scopes };
  });

  // --- записи ---
  app.get('/api/search', async (request) => {
    const q = query(request);
    return records.search(db, await auth(request), {
      query: q.q ?? '',
      core: q.core,
      project: q.project,
      type: q.type,
      limit: int(q.limit),
      includeFalse: flag(q.false),
    });
  });
  app.get('/api/records', async (request) => {
    const q = query(request);
    return records.list(db, await auth(request), {
      q: q.q,
      core: q.core,
      project: q.project,
      type: q.type,
      status: q.status,
      page: int(q.page),
      pageSize: int(q.pageSize),
      needsCheck: flag(q.needs_check),
    });
  });
  app.get('/api/records/:number', async (request) =>
    records.getRecord(db, await auth(request), num(request), { history: flag(query(request).history) }),
  );
  app.post('/api/records', async (request, reply) => {
    const ctx = await auth(request);
    need(ctx, 'propose');
    throttle(ctx);
    const result = await records.propose(db, ctx, body(request));
    return reply.status(result.existing ? 200 : 201).send(result);
  });
  app.patch('/api/records/:number', async (request) => {
    const b = body(request);
    const { version, ...edits } = b;
    return records.edit(db, await auth(request), num(request), edits, version);
  });
  app.post('/api/records/:number/feedback', async (request) => {
    const b = body(request);
    return records.feedback(db, await auth(request), num(request), {
      worked: b.worked,
      comment: b.comment,
      software_version: b.software_version,
    });
  });
  app.post('/api/records/:number/moderate', async (request) => {
    const b = body(request);
    return records.moderate(db, await auth(request), num(request), {
      decision: b.decision,
      target: b.target,
      edits: b.edits,
      comment: b.comment,
    });
  });
  app.post('/api/links', async (request) => {
    const b = body(request);
    return records.link(db, await auth(request), { from: b.from, to: b.to, type: b.type, remove: b.remove });
  });
  app.get('/api/queue', async (request) => records.queue(db, await auth(request), int(query(request).limit)));
  app.get('/api/graph', async (request) => {
    const q = query(request);
    return records.graph(db, await auth(request), q.center ? records.parseNumber(q.center) : undefined, int(q.depth));
  });

  // --- справочники ---
  app.get('/api/cores', async (request) => {
    await auth(request);
    return db.core.findMany({ orderBy: { sort: 'asc' }, select: { code: true, name: true, description: true } });
  });
  app.get('/api/projects', async (request) => {
    await auth(request);
    const q = (query(request).q ?? '').trim();
    return db.project.findMany({
      where: {
        active: true,
        ...(q ? { OR: [{ code: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }] } : {}),
      },
      orderBy: { code: 'asc' },
      select: { code: true, name: true },
    });
  });
  app.get('/api/software', async (request) => {
    await auth(request);
    return records.software(db);
  });
  app.put('/api/software', async (request) => {
    const b = body(request);
    return records.setSoftware(db, await auth(request), String(b.product ?? ''), String(b.version ?? ''));
  });

  // --- сотрудники и токены (модератор) ---
  app.get('/api/persons', async (request) => {
    need(await auth(request), 'moderate');
    return listPersons(db);
  });
  app.post('/api/persons', async (request, reply) => {
    need(await auth(request), 'moderate');
    const person = await addPerson(db, String(body(request).label ?? ''));
    return reply.status(201).send({ id: person.id, label: person.label });
  });
  app.post('/api/persons/:id/tokens', async (request, reply) => {
    need(await auth(request), 'moderate');
    const b = body(request);
    const issued = await issueToken(
      db,
      (request.params as { id: string }).id,
      String(b.client ?? ''),
      Array.isArray(b.scopes) ? b.scopes.map(String) : undefined,
      String(b.note ?? ''),
    );
    return reply.status(201).send({ ...issued, notice: 'Токен показывается один раз — сохраните его' });
  });
  app.delete('/api/tokens/:id', async (request) => {
    await revokeToken(db, await auth(request), (request.params as { id: string }).id);
    return { ok: true };
  });

  return app;
}

export type App = ReturnType<typeof buildApp>;
export type { FastifyReply };
