// Экран «Память» (решение 2026-11-06, по визуализации RAG из личного хаба): записи облаком по смыслу,
// вопрос — точкой в том же облаке, найденные по смыслу и подтянутые по связям.
// Координаты — главные оси векторов (3 оси: первые две — плоское облако, третья — объём).
import { Prisma } from '../generated/prisma/client.ts';
import { dot, principalAxes, projectPoint, RU, scaleToUnit } from '../../../../packages/core/src/index.ts';
import { invalid, need, type Ctx } from '../context.ts';
import type { Db } from '../db/client.ts';
import { view } from './records.ts';
import { embedPending, getEmbedder, loadVectors, queryVector } from './vectors.ts';

const SHOWN = ['accepted', 'pending', 'disputed', 'open', 'answered'];
const LIMIT = 2000;
const withRefs = { core: true, project: true, author: { select: { label: true } } } as const;

async function cloud(db: Db) {
  await embedPending(db);
  const rows = await loadVectors(db, Prisma.sql`r.status IN (${Prisma.join(SHOWN)})`);
  const vectors = rows.slice(0, LIMIT);
  const basis = principalAxes(
    vectors.map((r) => r.vector),
    3,
  );
  const raw = vectors.map((r) => projectPoint(r.vector, basis));
  const { points, scale } = scaleToUnit(raw);
  return { vectors, basis, points, scale };
}

/** Облако записей: координаты, вид, связи. Без модели векторов — пустое облако и признак `vectors: null`. */
export async function memory(db: Db, ctx: Ctx) {
  need(ctx, 'read');
  const embedder = getEmbedder();
  if (!embedder) return { vectors: null, nodes: [], links: [] };
  const { vectors, points } = await cloud(db);
  const ids = vectors.map((v) => v.id);
  const [records, links] = await Promise.all([
    db.record.findMany({ where: { id: { in: ids } }, include: withRefs }),
    db.link.findMany({
      where: { fromId: { in: ids }, toId: { in: ids } },
      include: { from: { select: { number: true } }, to: { select: { number: true } } },
    }),
  ]);
  const byId = new Map(records.map((r) => [r.id, r]));
  return {
    vectors: embedder.name,
    nodes: vectors.flatMap((v, i) => {
      const r = byId.get(v.id);
      if (!r) return [];
      const [x = 0, y = 0, z = 0] = points[i]!;
      return [{ ...view(r), x, y, z }];
    }),
    links: links.map((l) => ({ from: l.from.number, to: l.to.number, type: l.type, typeName: RU.link[l.type as keyof typeof RU.link] })),
  };
}

/**
 * Вопрос в облаке: его точка, близость каждой записи, найденные (смысл, не ниже порога) и подтянутые
 * по связям на один шаг. Найденные — тем же правилом, что поиск агентов, но среди всех показанных записей.
 */
export async function memoryQuery(db: Db, ctx: Ctx, q: string, limit = 5) {
  need(ctx, 'read');
  if (!q.trim()) throw invalid('Пустой вопрос');
  const embedder = getEmbedder();
  if (!embedder) return { vectors: null, point: null, scores: [], found: [], linked: [] };
  const { vectors, basis, scale } = await cloud(db);
  const qv = await queryVector(q);
  if (!qv) return { vectors: null, point: null, scores: [], found: [], linked: [] };
  const numbers = new Map(
    (await db.record.findMany({ where: { id: { in: vectors.map((v) => v.id) } }, select: { id: true, number: true } })).map((r) => [r.id, r.number]),
  );
  const scores = vectors
    .map((v) => ({ number: numbers.get(v.id) ?? 0, score: dot(qv, v.vector) }))
    .filter((s) => s.number)
    .sort((a, b) => b.score - a.score);
  const found = scores
    .filter((s) => s.score >= embedder.minScore)
    .slice(0, Math.min(20, Math.max(1, limit)))
    .map((s) => s.number);
  const links = found.length
    ? await db.link.findMany({
        where: { OR: [{ from: { number: { in: found } } }, { to: { number: { in: found } } }] },
        include: { from: { select: { number: true, status: true } }, to: { select: { number: true, status: true } } },
      })
    : [];
  const linked = [
    ...new Set(
      links
        .flatMap((l) => [l.from, l.to])
        .filter((r) => SHOWN.includes(r.status) && !found.includes(r.number))
        .map((r) => r.number),
    ),
  ];
  const [x = 0, y = 0, z = 0] = projectPoint(qv, basis).map((c) => c * scale);
  return {
    vectors: embedder.name,
    point: { x, y, z },
    minScore: embedder.minScore,
    scores: scores.map((s) => ({ number: s.number, score: Math.round(s.score * 1000) / 1000 })),
    found,
    linked,
  };
}
