// Разбор и проверка md-записи шага 0 (формат — docs/data-model.md и references/format.md навыка).
// Тот же разбор потом берёт импорт сервиса (docs/spec.md, раздел 9.1), поэтому
// русские значения сразу сопоставляются с кодами сервиса (раздел 3.8).

export const TEXT_LIMIT = 300;

export const TYPES = { вывод: 'conclusion', вопрос: 'question' };
export const KINDS = { факт: 'fact', правило: 'rule', гипотеза: 'hypothesis' };
export const CORES = {
  проектирование: 'design',
  'bim и revit': 'bim',
  'процессы бюро': 'process',
  инструменты: 'tools',
};

const FIELDS = [
  'type',
  'kind',
  'core',
  'project',
  'software_version',
  'not_applicable',
  'source',
  'confirmed_by_author',
  'created',
];
const REQUIRED = ['type', 'core', 'source', 'confirmed_by_author', 'created'];

// личное и серверное в записи недопустимо (CLAUDE.md, «деперсонализация»)
const PRIVATE = [
  ['адрес почты', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ['путь к файлу', /(?:[A-Za-z]:\\|\\\\[A-Za-z0-9_.-]+\\|\/(?:home|Users)\/)/],
  ['IP-адрес', /\b(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/],
  ['телефон', /(?:\+7|\b8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}\b/],
  ['токен', /\b(?:stt|sbt)_[A-Za-z0-9_-]{20,}|\b(?:ghp|sk)-?[A-Za-z0-9_]{20,}/],
];

const lookup = (table, value) =>
  table[value] ?? (Object.values(table).includes(value) ? value : undefined);

/**
 * @typedef {object} ParsedRecord — запись с кодами сервиса
 * @property {'conclusion' | 'question'} type
 * @property {'fact' | 'rule' | 'hypothesis' | null} kind
 * @property {'design' | 'bim' | 'process' | 'tools'} core
 * @property {string | null} project
 * @property {string | null} software_version
 * @property {string | null} not_applicable
 * @property {string} source
 * @property {true} confirmed_by_author
 * @property {string} created
 * @property {string} text
 */

/**
 * Разбирает текст md-записи.
 * @param {string} source — содержимое файла
 * @param {string} [fileName] — имя файла, для проверки вида имени
 * @returns {{ record: ParsedRecord | null, errors: string[], warnings: string[] }}
 */
export function parseRecord(source, fileName) {
  const errors = [];
  const warnings = [];
  const text0 = source.replace(/^﻿/, '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(text0);
  if (!match) {
    return { record: null, errors: ['нет заголовка между строками ---'], warnings };
  }

  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const found = /^([A-Za-z_]+)\s*:\s*(.*)$/.exec(line);
    if (!found) {
      errors.push(`непонятная строка заголовка: «${line.trim()}»`);
      continue;
    }
    const [, key, raw] = found;
    // «type: вывод   # вывод | вопрос» — подсказка после # не входит в значение
    const value = raw.replace(/\s+#.*$/, '').trim();
    if (!FIELDS.includes(key)) warnings.push(`лишнее поле «${key}» — сервис его не возьмёт`);
    else if (key in fields) errors.push(`поле «${key}» указано дважды`);
    else fields[key] = value;
  }
  for (const key of REQUIRED) {
    if (!fields[key]) errors.push(`не заполнено обязательное поле «${key}»`);
  }

  const type = fields.type ? lookup(TYPES, fields.type.toLowerCase()) : undefined;
  if (fields.type && !type) errors.push(`type: «${fields.type}» — нужно «вывод» или «вопрос»`);

  const kind = fields.kind ? lookup(KINDS, fields.kind.toLowerCase()) : undefined;
  if (fields.kind && !kind) {
    errors.push(`kind: «${fields.kind}» — нужно «факт», «правило» или «гипотеза»`);
  }
  if (type === 'conclusion' && !fields.kind) errors.push('kind: у вывода нужен вид — факт, правило или гипотеза');
  if (type === 'question' && fields.kind) errors.push('kind: у вопроса вид не указывается');

  const core = fields.core ? lookup(CORES, fields.core.toLowerCase()) : undefined;
  if (fields.core && !core) {
    errors.push(
      `core: «${fields.core}» — нужно «Проектирование», «BIM и Revit», «Процессы бюро» или «Инструменты»`,
    );
  }

  if (fields.confirmed_by_author && fields.confirmed_by_author !== 'true') {
    errors.push('confirmed_by_author: запись не подтверждена автором — нужно true после «ок»');
  }

  if (fields.created && !isDate(fields.created)) {
    errors.push(`created: «${fields.created}» — нужна дата ГГГГ-ММ-ДД`);
  }

  const text = match[2].trim().replace(/\s*\r?\n\s*/g, ' ');
  const length = [...text].length;
  if (!text) errors.push('нет текста записи под заголовком');
  else if (length > TEXT_LIMIT) errors.push(`текст — ${length} знаков, наибольшее — ${TEXT_LIMIT}`);
  const sentences = text.split(/[.!?…]+(?:\s|$)/).filter((part) => part.trim()).length;
  if (sentences > 3) warnings.push(`в тексте ${sentences} фраз — лучше одна-три`);
  for (const key of ['not_applicable', 'source', 'software_version']) {
    const limit = key === 'software_version' ? 100 : TEXT_LIMIT;
    if (fields[key] && [...fields[key]].length > limit) {
      errors.push(`${key}: длиннее ${limit} знаков`);
    }
  }

  for (const [name, pattern] of PRIVATE) {
    const where = [text, ...Object.values(fields)].find((part) => pattern.test(part));
    if (where) errors.push(`похоже на личные или серверные данные (${name}) — убрать`);
  }

  if (fileName !== undefined && !/^\d{4}-\d{2}-\d{2} — .+\.md$/.test(fileName)) {
    warnings.push('имя файла — лучше «ГГГГ-ММ-ДД — кратко.md»');
  }

  const record = errors.length
    ? null
    : {
        type,
        kind: kind ?? null,
        core,
        project: fields.project || null,
        software_version: fields.software_version || null,
        not_applicable: fields.not_applicable || null,
        source: fields.source,
        confirmed_by_author: true,
        created: fields.created,
        text,
      };
  return { record, errors, warnings };
}

function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}
