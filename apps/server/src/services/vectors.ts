// Векторы смысла записей (решение 2026-11-06): расчёт, пересчёт устаревших, поиск по смыслу.
// Модель подключается при запуске (main.ts, cli.ts) или в тестах; нет модели — поиск только по словам.
// Векторы хранятся массивом real[] и сравниваются полным перебором (записей сотни и тысячи).
import { Prisma } from '../generated/prisma/client.ts';
import { dot } from '../../../../packages/core/src/index.ts';
import type { Db, Tx } from '../db/client.ts';
import type { Embedder } from '../embed/e5.ts';

let embedder: Embedder | null = null;

export function setEmbedder(e: Embedder | null) {
  embedder = e;
}

export function getEmbedder(): Embedder | null {
  return embedder;
}

/** Текст записи для вектора: сам вывод, «когда не применимо» и версия — они тоже про смысл. */
export function passageText(r: { text: string; notApplicable: string | null; softwareVersion: string | null }): string {
  return [r.text, r.notApplicable && `Не применимо: ${r.notApplicable}`, r.softwareVersion].filter(Boolean).join(' · ');
}

// один пересчёт за раз: запросы, пришедшие во время пересчёта, ждут его окончания
let running: Promise<number> | null = null;

/** Пересчитывает векторы записей без вектора или с устаревшим (другая модель, другой текст). Возвращает, сколько пересчитано. */
export function embedPending(db: Db): Promise<number> {
  if (!embedder) return Promise.resolve(0);
  if (running) return running;
  const e = embedder;
  running = (async () => {
    let done = 0;
    for (;;) {
      const rows = await db.$queryRaw<{ id: string; version: number; text: string; not_applicable: string | null; software_version: string | null }[]>`
        SELECT id::text AS id, version, text, not_applicable, software_version FROM record
        WHERE embedding IS NULL OR embedding_model IS DISTINCT FROM ${e.name} OR embedded_version IS DISTINCT FROM version
        ORDER BY number LIMIT 64`;
      if (!rows.length) return done;
      const vectors = await e.embed(
        rows.map((r) => passageText({ text: r.text, notApplicable: r.not_applicable, softwareVersion: r.software_version })),
        'passage',
      );
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!;
        // версия в условии — если запись успели изменить, вектор не записывается и посчитается заново
        await db.$executeRaw`
          UPDATE record SET embedding = ${Array.from(vectors[i]!)}::real[], embedding_model = ${e.name}, embedded_version = ${r.version}
          WHERE id = ${r.id}::uuid AND version = ${r.version}`;
      }
      done += rows.length;
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Векторы записей по условию SQL — для поиска и для картинки. */
export async function loadVectors(db: Db | Tx, where: Prisma.Sql): Promise<{ id: string; vector: number[] }[]> {
  if (!embedder) return [];
  return db.$queryRaw<{ id: string; vector: number[] }[]>`
    SELECT r.id::text AS id, r.embedding AS vector FROM record r
    WHERE r.embedding IS NOT NULL AND r.embedding_model = ${embedder.name} AND ${where}`;
}

/** Вектор вопроса. */
export async function queryVector(text: string): Promise<Float32Array | null> {
  if (!embedder) return null;
  const [v] = await embedder.embed([text], 'query');
  return v ?? null;
}

/** Ближайшие по смыслу записи (не ниже порога модели), от ближних к дальним. */
export function nearest(q: ArrayLike<number>, rows: readonly { id: string; vector: number[] }[], limit: number): { id: string; score: number }[] {
  const min = embedder?.minScore ?? 0;
  return rows
    .map((r) => ({ id: r.id, score: dot(q, r.vector) }))
    .filter((r) => r.score >= min)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}
