// Поисковый запрос (docs/spec.md, раздел 6): до трёх формулировок через «|»;
// слова от двух знаков, каждое с префиксом; латинские буквы, похожие на русские,
// перед цифрой приводятся к русским («B25» → «В25»), как в Schema Teams.
// Результат — строки для to_tsquery('russian', …): сначала «все слова» (&),
// для добора — «любое слово» (|).

const LOOKALIKE: Record<string, string> = {
  A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У',
  a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у',
};

/** «B25», «A500С» → «В25», «А500С»: латиница перед цифрой — в кириллицу (и в тексте записи, и в запросе). */
export function cyrillicMarks(text: string): string {
  return text.replace(/(?<![\p{L}\d])([ABCEHKMOPTXYaceopxy]+)(?=\d)/gu, (letters: string) =>
    [...letters].map((ch) => LOOKALIKE[ch] ?? ch).join(''),
  );
}

export interface ParsedQuery {
  /** формулировки — каждая списком слов */
  phrasings: string[][];
}

export const MAX_PHRASINGS = 3;

export function parseQuery(query: string): ParsedQuery {
  const phrasings = cyrillicMarks(query)
    .split('|')
    .slice(0, MAX_PHRASINGS)
    .map((part) =>
      part
        .toLowerCase()
        .replace(/ё/g, 'е')
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => [...word].length >= 2),
    )
    .filter((words) => words.length > 0);
  return { phrasings };
}

const prefix = (word: string) => `${word}:*`;

/** tsquery «все слова формулировки» — по одной на формулировку. */
export const allWords = (words: string[]) => words.map(prefix).join(' & ');

/** tsquery «любое слово» — для добора, когда всех слов не нашлось. */
export const anyWord = (words: string[]) => words.map(prefix).join(' | ');

export const LIMIT_DEFAULT = 5;
export const LIMIT_MAX = 20;

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return LIMIT_DEFAULT;
  return Math.min(LIMIT_MAX, Math.max(1, Math.trunc(limit)));
}

/**
 * Слияние результатов формулировок и проходов: по наибольшему рангу,
 * без повторов, «все слова» выше «любого слова».
 */
export function mergeHits<T extends { id: string; rank: number; strict: boolean }>(lists: T[][], limit: number): T[] {
  const best = new Map<string, T>();
  for (const list of lists) {
    for (const hit of list) {
      const prev = best.get(hit.id);
      const better =
        !prev || (hit.strict && !prev.strict) || (hit.strict === prev.strict && hit.rank > prev.rank);
      if (better) best.set(hit.id, hit);
    }
  }
  return [...best.values()]
    .sort((a, b) => Number(b.strict) - Number(a.strict) || b.rank - a.rank || a.id.localeCompare(b.id))
    .slice(0, limit);
}
