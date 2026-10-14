// Проекты из Schema Teams (docs/spec.md, раздел 9.2): список активных объектов по API Schema Teams.
// Берутся только номер, код и название — заказчик, ГИП и прочие поля с именами не читаются.
// Объекты, которых больше нет среди активных, помечаются неактивными; записи по ним остаются.
// Проекты, добавленные вручную (без номера Schema Teams), синхронизация не трогает.
import { AppError } from '../context.ts';
import type { Db } from '../db/client.ts';

export interface SchemaTeamsOptions {
  url: string;
  token: string;
  fetch?: typeof fetch;
}

export interface SyncResult {
  added: number;
  updated: number;
  deactivated: number;
  text: string;
}

interface ObjectCard {
  id: number;
  code: string;
  name: string;
}

export async function fetchObjects(opts: SchemaTeamsOptions): Promise<ObjectCard[]> {
  const base = opts.url.replace(/\/+$/, '');
  let response: Response;
  try {
    response = await (opts.fetch ?? fetch)(`${base}/api/objects?status=active`, {
      headers: { authorization: `Bearer ${opts.token}` },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new AppError(502, 'schema_teams', `Schema Teams не отвечает: ${(error as Error).message}`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new AppError(502, 'schema_teams', 'Schema Teams не принял токен — нужен токен руководителя с правом видеть все объекты');
  }
  if (!response.ok) throw new AppError(502, 'schema_teams', `Schema Teams ответил ошибкой ${response.status}`);
  const body = (await response.json()) as { objects?: unknown };
  if (!Array.isArray(body.objects)) throw new AppError(502, 'schema_teams', 'Schema Teams вернул неожиданный ответ');
  return body.objects
    .filter((o): o is ObjectCard => typeof o === 'object' && o !== null && typeof (o as ObjectCard).id === 'number' && typeof (o as ObjectCard).code === 'string')
    .map((o) => ({ id: o.id, code: o.code.trim(), name: String(o.name ?? '').trim() }));
}

export async function syncProjects(db: Db, opts: SchemaTeamsOptions): Promise<SyncResult> {
  const objects = await fetchObjects(opts);
  return db.$transaction(async (tx) => {
    let added = 0;
    let updated = 0;
    const seen: string[] = [];
    for (const o of objects) {
      const externalId = String(o.id);
      seen.push(externalId);
      const existing =
        (await tx.project.findUnique({ where: { externalId } })) ?? (await tx.project.findUnique({ where: { code: o.code } }));
      if (!existing) {
        await tx.project.create({ data: { externalId, code: o.code, name: o.name } });
        added += 1;
      } else if (existing.externalId !== externalId || existing.code !== o.code || existing.name !== o.name || !existing.active) {
        await tx.project.update({ where: { id: existing.id }, data: { externalId, code: o.code, name: o.name, active: true } });
        updated += 1;
      }
    }
    const { count: deactivated } = await tx.project.updateMany({
      where: { externalId: { not: null, notIn: seen }, active: true },
      data: { active: false },
    });
    return {
      added,
      updated,
      deactivated,
      text: `Проекты из Schema Teams: новых ${added}, обновлено ${updated}, неактивных ${deactivated}`,
    };
  });
}
