// Проверка записи, присланной агентом или формой (docs/spec.md, разделы 3.1, 5.1, 7).
// Значения принимаются и кодом, и по-русски; ошибки — по-русски, их увидит агент.
import { type Core, fromRu, type Kind, type RecordType } from './enums.ts';
import { cyrillicMarks } from './search.ts';

export const TEXT_LIMIT = 300;
export const VERSION_LIMIT = 100;

export interface RecordInput {
  type: RecordType;
  kind: Kind | null;
  core: Core;
  project: string | null;
  softwareVersion: string | null;
  notApplicable: string | null;
  source: string;
  text: string;
}

const PRIVATE: [string, RegExp][] = [
  ['адрес почты', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ['путь к файлу', /(?:[A-Za-z]:\\|\\\\[A-Za-z0-9_.-]+\\|\/(?:home|Users)\/)/],
  ['IP-адрес', /\b(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/],
  ['телефон', /(?:\+7|\b8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}\b/],
  ['токен', /\b(?:stt|sbt)_[A-Za-z0-9_-]{20,}/],
];

const text = (value: unknown) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '');
const optional = (value: unknown) => text(value) || null;
const length = (value: string) => [...value].length;

/** Признаки личных или серверных данных в тексте; пусто — чисто. */
export function privateHits(...parts: (string | null)[]): string[] {
  return PRIVATE.filter(([, re]) => parts.some((part) => part && re.test(part))).map(([name]) => name);
}

export function validateRecord(raw: Record<string, unknown>): { value?: RecordInput; errors: string[] } {
  const errors: string[] = [];
  const type = fromRu('type', text(raw.type));
  if (!type) errors.push('type: «вывод» или «вопрос»');

  const kindRaw = text(raw.kind);
  const kind = kindRaw ? fromRu('kind', kindRaw) : undefined;
  if (kindRaw && !kind) errors.push('kind: «факт», «правило» или «гипотеза»');
  if (type === 'conclusion' && !kindRaw) errors.push('kind: у вывода нужен вид — факт, правило или гипотеза');
  if (type === 'question' && kindRaw) errors.push('kind: у вопроса вид не указывается');

  const core = fromRu('core', text(raw.core));
  if (!core) errors.push('core: «Проектирование», «BIM и Revit», «Процессы бюро» или «Инструменты»');

  const body = cyrillicMarks(text(raw.text));
  if (!body) errors.push('text: пустой текст');
  else if (length(body) > TEXT_LIMIT) errors.push(`text: ${length(body)} знаков, наибольшее — ${TEXT_LIMIT}`);

  const source = text(raw.source);
  if (!source) errors.push('source: откуда запись — например, «сессия 2026-10-15, задача …»');
  else if (length(source) > TEXT_LIMIT) errors.push(`source: длиннее ${TEXT_LIMIT} знаков`);

  const softwareVersion = optional(raw.software_version ?? raw.softwareVersion);
  if (softwareVersion && length(softwareVersion) > VERSION_LIMIT) {
    errors.push(`software_version: длиннее ${VERSION_LIMIT} знаков`);
  }
  const notApplicable = optional(raw.not_applicable ?? raw.notApplicable);
  if (notApplicable && length(notApplicable) > TEXT_LIMIT) errors.push(`not_applicable: длиннее ${TEXT_LIMIT} знаков`);

  if (raw.confirmed_by_author !== true && raw.confirmedByAuthor !== true) {
    errors.push('confirmed_by_author: запись отправляется только после «ок» автора — передайте true');
  }

  for (const hit of privateHits(body, notApplicable, source)) {
    errors.push(`похоже на личные или серверные данные (${hit}) — убрать`);
  }

  if (errors.length) return { errors };
  return {
    value: {
      type: type!,
      kind: kind ?? null,
      core: core!,
      project: optional(raw.project),
      softwareVersion,
      notApplicable,
      source,
      text: body,
    },
    errors,
  };
}
