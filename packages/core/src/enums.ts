// Перечисления Schema Brain: коды — в базе и API, русские названия — в md-файлах,
// вебе и ответах агентам (docs/spec.md, раздел 3.8).

export const RECORD_TYPES = ['conclusion', 'question'] as const;
export const KINDS = ['fact', 'rule', 'hypothesis'] as const;
export const CORES = ['design', 'bim', 'process', 'tools'] as const;
export const STATUSES = [
  'pending',
  'disputed',
  'accepted',
  'rejected',
  'merged',
  'replaced',
  'open',
  'answered',
  'closed',
] as const;
export const LINK_TYPES = ['contradicts', 'answers', 'derived_from', 'replaces', 'merged_into'] as const;
export const CLIENTS = ['web', 'claude', 'chatgpt', 'codex', 'local', 'import'] as const;
export const SCOPES = ['read', 'propose', 'feedback', 'moderate'] as const;

export type RecordType = (typeof RECORD_TYPES)[number];
export type Kind = (typeof KINDS)[number];
export type Core = (typeof CORES)[number];
export type Status = (typeof STATUSES)[number];
export type LinkType = (typeof LINK_TYPES)[number];
export type Client = (typeof CLIENTS)[number];
export type Scope = (typeof SCOPES)[number];

export const RU = {
  type: { conclusion: 'вывод', question: 'вопрос' },
  kind: { fact: 'факт', rule: 'правило', hypothesis: 'гипотеза' },
  core: {
    design: 'Проектирование',
    bim: 'BIM и Revit',
    process: 'Процессы бюро',
    tools: 'Инструменты',
  },
  status: {
    pending: 'на модерации',
    disputed: 'противоречие, на модерации',
    accepted: 'принята',
    rejected: 'отклонена',
    merged: 'объединена',
    replaced: 'заменена',
    open: 'открыт',
    answered: 'есть ответ',
    closed: 'закрыт',
  },
  link: {
    contradicts: 'противоречит',
    answers: 'отвечает на',
    derived_from: 'выведена из',
    replaces: 'заменяет',
    merged_into: 'объединена с',
  },
} as const satisfies {
  type: Record<RecordType, string>;
  kind: Record<Kind, string>;
  core: Record<Core, string>;
  status: Record<Status, string>;
  link: Record<LinkType, string>;
};

const normalize = (value: string) => value.trim().toLowerCase().replace(/ё/g, 'е');

/**
 * Код по коду или русскому названию, без учёта регистра: «BIM и Revit», «bim» → 'bim'.
 * undefined — значения нет в списке.
 */
export function fromRu<K extends keyof typeof RU>(
  field: K,
  value: string,
): keyof (typeof RU)[K] | undefined {
  const table = RU[field] as Record<string, string>;
  const v = normalize(value);
  for (const [code, label] of Object.entries(table)) {
    if (normalize(code) === v || normalize(label) === v) return code as keyof (typeof RU)[K];
  }
  return undefined;
}

export const isConclusion = (type: RecordType) => type === 'conclusion';
