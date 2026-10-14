// Группы похожих замечаний и кандидаты «типовая ошибка» (решение 12: повтор ≥ 3).
// Повтор считается по разным альбомам: одно замечание на десяти листах одного
// альбома — ошибка альбома, а не бюро.
//
// Без векторной модели (решение 2026-10-15): сходство — косинус по весам слов
// (TF-IDF по основам) плюс небольшая прибавка за общий документ нормы. Тонкое
// объединение «по смыслу» — за Claude при разборе отчёта.
import type { Remark, Suggestion } from './registry.ts';
import { normDocument, stripSheetRefs, tokens } from './text.ts';

export interface Options {
  /** во скольких разных альбомах должно встретиться замечание */
  minAlbums: number;
  /** порог сходства для одной группы, 0…1 */
  threshold: number;
}

export const DEFAULTS: Options = { minAlbums: 3, threshold: 0.45 };
const NORM_BONUS = 0.1;

export interface Candidate {
  id: number;
  /** код ТН-xx — уже утверждённая типовая находка; пусто — новая группа */
  code: string;
  albums: string[];
  remarks: Remark[];
  /** самое типичное замечание группы */
  sample: string;
  /** другие формулировки — из других альбомов */
  examples: string[];
  check: string;
  normDocument: string;
  /** черновик текста записи Schema Brain, до 300 знаков */
  draft: string;
}

type Vector = Map<string, number>;

function vectorize(texts: string[][]): Vector[] {
  const df = new Map<string, number>();
  for (const words of texts) for (const w of new Set(words)) df.set(w, (df.get(w) ?? 0) + 1);
  const n = texts.length;
  return texts.map((words) => {
    const v: Vector = new Map();
    for (const w of words) v.set(w, (v.get(w) ?? 0) + 1);
    let norm = 0;
    for (const [w, tf] of v) {
      const weight = tf * Math.log((n + 1) / ((df.get(w) ?? 0) + 0.5));
      v.set(w, weight);
      norm += weight * weight;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [w, weight] of v) v.set(w, weight / norm);
    return v;
  });
}

function dot(a: Vector, b: Vector): number {
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let sum = 0;
  for (const [w, x] of small) sum += x * (large.get(w) ?? 0);
  return sum;
}

function unit(v: Vector): Vector {
  let norm = 0;
  for (const x of v.values()) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return new Map([...v].map(([w, x]) => [w, x / norm]));
}

function add(sum: Vector, v: Vector) {
  for (const [w, x] of v) sum.set(w, (sum.get(w) ?? 0) + x);
}

const mostCommon = (values: string[]) => {
  const count = new Map<string, number>();
  for (const v of values) if (v) count.set(v, (count.get(v) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '';
};

/** Сходство двух формулировок, 0…1 (для тестов и отладки порога). */
export function similarity(a: Remark, b: Remark, corpus: Remark[] = [a, b]): number {
  const vectors = vectorize(corpus.map((r) => tokens(r.text)));
  const va = vectors[corpus.indexOf(a)];
  const vb = vectors[corpus.indexOf(b)];
  const docA = normDocument(a.norm);
  return dot(va, vb) + (docA && docA === normDocument(b.norm) ? NORM_BONUS : 0);
}

/** Группы похожих замечаний без кода ТН. Порядок входа не важен: замечания сортируются. */
export function clusterRemarks(remarks: Remark[], threshold = DEFAULTS.threshold): Remark[][] {
  const items = [...remarks].sort(
    (a, b) => a.album.localeCompare(b.album) || a.file.localeCompare(b.file) || a.row - b.row,
  );
  const vectors = vectorize(items.map((r) => tokens(r.text)));
  const docs = items.map((r) => normDocument(r.norm));

  let assignment = new Array<number>(items.length).fill(-1);
  const build = () => {
    const groups = new Map<number, number[]>();
    assignment.forEach((g, i) => {
      if (g >= 0) groups.set(g, [...(groups.get(g) ?? []), i]);
    });
    return [...groups.values()].map((members) => {
      const sum: Vector = new Map();
      for (const i of members) add(sum, vectors[i]);
      return { members, centroid: unit(sum), doc: mostCommon(members.map((i) => docs[i])) };
    });
  };
  const score = (i: number, g: { centroid: Vector; doc: string }) =>
    dot(vectors[i], g.centroid) + (docs[i] && docs[i] === g.doc ? NORM_BONUS : 0);

  // проход 1: каждое замечание — в самую похожую группу или в новую
  const growing: { sum: Vector; centroid: Vector; doc: string; docs: string[] }[] = [];
  items.forEach((_, i) => {
    if (vectors[i].size === 0) return;
    let best = -1;
    let bestScore = threshold;
    growing.forEach((g, k) => {
      const s = score(i, g);
      if (s >= bestScore) {
        best = k;
        bestScore = s;
      }
    });
    if (best < 0) {
      growing.push({ sum: new Map(vectors[i]), centroid: vectors[i], doc: docs[i], docs: [docs[i]] });
      best = growing.length - 1;
    } else {
      const g = growing[best];
      add(g.sum, vectors[i]);
      g.centroid = unit(g.sum);
      g.docs.push(docs[i]);
      g.doc = mostCommon(g.docs);
    }
    assignment[i] = best;
  });

  // проход 2: уточнить — каждое замечание к лучшей из готовых групп
  const groups = build();
  assignment = items.map((_, i) => {
    if (vectors[i].size === 0) return -1;
    let best = -1;
    let bestScore = threshold;
    groups.forEach((g, k) => {
      const s = score(i, g);
      if (s >= bestScore) {
        best = k;
        bestScore = s;
      }
    });
    return best;
  });

  return build().map(({ members }) => members.map((i) => items[i]));
}

function medoid(group: Remark[]): Remark {
  if (group.length <= 2) return group[0];
  const vectors = vectorize(group.map((r) => tokens(r.text)));
  const sum: Vector = new Map();
  for (const v of vectors) add(sum, v);
  const centroid = unit(sum);
  let best = 0;
  vectors.forEach((v, i) => {
    if (dot(v, centroid) > dot(vectors[best], centroid)) best = i;
  });
  return group[best];
}

/** Черновик записи: суть замечания без ссылок на листы, до 300 знаков. */
export function draftText(sample: string, albums: number): string {
  const core = stripSheetRefs(sample).replace(/[.;\s]+$/, '');
  const prefix = `Частое замечание проверок альбомов (${albums} альб.): `;
  const text = `${prefix}${core}. Проверять до выпуска.`;
  if ([...text].length <= 300) return text;
  const room = 300 - [...prefix].length - 1;
  const cut = [...core].slice(0, room).join('').replace(/\s+\S*$/, '');
  return `${prefix}${cut}…`;
}

function toCandidate(code: string, group: Remark[]): Omit<Candidate, 'id'> {
  const albums = [...new Set(group.map((r) => r.album))].sort();
  const sample = medoid(group);
  const examples: string[] = [];
  for (const r of group) {
    if (examples.length >= 3) break;
    if (r !== sample && r.album !== sample.album && !examples.includes(r.text)) examples.push(r.text);
  }
  return {
    code,
    albums,
    remarks: group,
    sample: sample.text,
    examples,
    check: mostCommon(group.map((r) => r.check)),
    normDocument: mostCommon(group.map((r) => normDocument(r.norm))),
    draft: draftText(sample.text, albums.length),
  };
}

/** Кандидаты: утверждённые ТН-xx и новые группы, встретившиеся в minAlbums и более альбомах. */
export function findCandidates(remarks: Remark[], options: Options = DEFAULTS): Candidate[] {
  const byCode = new Map<string, Remark[]>();
  for (const r of remarks) if (r.code) byCode.set(r.code, [...(byCode.get(r.code) ?? []), r]);
  const coded = [...byCode].map(([code, group]) => toCandidate(code, group));
  const clusters = clusterRemarks(
    remarks.filter((r) => !r.code),
    options.threshold,
  ).map((group) => toCandidate('', group));

  return [...coded, ...clusters]
    .filter((c) => c.albums.length >= options.minAlbums)
    .sort(
      (a, b) =>
        b.albums.length - a.albums.length ||
        b.remarks.length - a.remarks.length ||
        a.code.localeCompare(b.code) ||
        a.sample.localeCompare(b.sample),
    )
    .map((c, i) => ({ ...c, id: i + 1 }));
}

/** Предложения проверяющих «Кандидат в типовые находки» — без порога, как есть. */
export function suggestionsOf(registries: { suggestions: Suggestion[] }[]): Suggestion[] {
  return registries.flatMap((r) => r.suggestions);
}
