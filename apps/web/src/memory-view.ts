// Расчёты экрана «Память» без React и без браузера — с тестами (apps/web/test/memory-view.test.ts).
import type { RecordView } from './api.ts';

export interface MemoryNode extends RecordView {
  x: number;
  y: number;
  z: number;
}
export interface MemoryLink {
  from: number;
  to: number;
  type: string;
  typeName: string;
}
export interface MemoryData {
  vectors: string | null;
  nodes: MemoryNode[];
  links: MemoryLink[];
}
export interface MemoryAnswer {
  vectors: string | null;
  point: { x: number; y: number; z: number } | null;
  minScore?: number;
  scores: { number: number; score: number }[];
  found: number[];
  linked: number[];
}

/** Роль записи в ответе на вопрос: найдена по смыслу, подтянута по связям или фон. */
export type Role = 'found' | 'linked' | 'rest';

export function roleOf(n: number, answer: MemoryAnswer | null): Role {
  if (!answer) return 'rest';
  if (answer.found.includes(n)) return 'found';
  if (answer.linked.includes(n)) return 'linked';
  return 'rest';
}

/**
 * Сфера вопроса (радар): вопрос — в центре, расстояние — «насколько не похоже» (1 − близость),
 * направление — то же, что в облаке (откуда запись видна из точки вопроса).
 * Масштаб — по самой далёкой записи; порог близости — отдельным кругом.
 */
export function radar(
  nodes: readonly MemoryNode[],
  answer: MemoryAnswer,
): { points: { number: number; x: number; y: number; score: number }[]; threshold: number; ring: (score: number) => number } {
  const q = answer.point ?? { x: 0, y: 0, z: 0 };
  const score = new Map(answer.scores.map((s) => [s.number, s.score]));
  const lowest = Math.min(...answer.scores.map((s) => s.score), answer.minScore ?? 1);
  const span = 1 - lowest || 1;
  const ring = (s: number) => Math.max(0, Math.min(1, (1 - s) / span));
  const points = nodes.flatMap((n) => {
    const s = score.get(n.number);
    if (s === undefined) return [];
    const dx = n.x - q.x;
    const dy = n.y - q.y;
    const len = Math.hypot(dx, dy) || 1;
    const r = ring(s);
    return [{ number: n.number, x: (dx / len) * r, y: (dy / len) * r, score: s }];
  });
  return { points, threshold: ring(answer.minScore ?? 0), ring };
}

/** Связи, которые показывают дорогу «найдена → связана» (только между найденными и подтянутыми). */
export function answerLinks(links: readonly MemoryLink[], answer: MemoryAnswer | null): MemoryLink[] {
  if (!answer) return [];
  const on = new Set([...answer.found, ...answer.linked]);
  return links.filter((l) => on.has(l.from) && on.has(l.to) && (answer.found.includes(l.from) || answer.found.includes(l.to)));
}

/** Близость словами: «0,87». */
export const scoreText = (s: number) => s.toFixed(2).replace('.', ',');
