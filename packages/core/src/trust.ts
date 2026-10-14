// Отметки «сработало / не сработало» и показатель доверия (docs/spec.md, разделы 5.2–5.3).
//
// n и b — число сотрудников (не агентов): у сотрудника одна действующая отметка —
// последняя по времени, через любого его агента. Отметка автора в n и b не входит.
// score = n / (n + b + 1); «ложная» — score ≤ 25 % при n + b ≥ 2 (решение 2026-10-15).

export interface Mark {
  personId: string;
  worked: boolean;
  created: Date;
}

export interface TrustSettings {
  /** при каком показателе запись ложная, включительно */
  falseAt: number;
  /** с какого числа отметок применять порог */
  minMarks: number;
}

export const TRUST: TrustSettings = { falseAt: 0.25, minMarks: 2 };

/** Последняя отметка каждого сотрудника, кроме автора → n и b. */
export function countMarks(marks: Mark[], authorId: string): { n: number; b: number } {
  const latest = new Map<string, Mark>();
  for (const mark of marks) {
    if (mark.personId === authorId) continue;
    const prev = latest.get(mark.personId);
    if (!prev || mark.created.getTime() >= prev.created.getTime()) latest.set(mark.personId, mark);
  }
  let n = 0;
  let b = 0;
  for (const mark of latest.values()) {
    if (mark.worked) n += 1;
    else b += 1;
  }
  return { n, b };
}

export const score = (n: number, b: number) => n / (n + b + 1);

export type TrustState = 'none' | 'few' | 'ok' | 'false';

export function trustState(n: number, b: number, settings: TrustSettings = TRUST): TrustState {
  const total = n + b;
  if (total === 0) return 'none';
  if (total < settings.minMarks) return 'few';
  return score(n, b) <= settings.falseAt ? 'false' : 'ok';
}

/** Ложная запись агентам по умолчанию не выдаётся. */
export const isFalse = (n: number, b: number, settings: TrustSettings = TRUST) =>
  trustState(n, b, settings) === 'false';

/** «75 % · 3 за, 0 против», «нет отметок», «мало отметок · 0 за, 1 против», «ложная · 0 за, 2 против». */
export function trustText(n: number, b: number, settings: TrustSettings = TRUST): string {
  const marks = `${n} за, ${b} против`;
  switch (trustState(n, b, settings)) {
    case 'none':
      return 'нет отметок';
    case 'few':
      return `мало отметок · ${marks}`;
    case 'false':
      return `ложная · ${marks}`;
    case 'ok':
      return `${Math.round(score(n, b) * 100)} % · ${marks}`;
  }
}
