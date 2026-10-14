// Выходные файлы для модерации: отчёт md, таблица csv и записи шага 0 по выбранным кандидатам.
import { parseRecord } from '../../../skills/vyvody/record.mjs';
import type { Candidate, Options } from './cluster.ts';
import type { Registry, Suggestion } from './registry.ts';

export interface Summary {
  date: string;
  registries: Registry[];
  candidates: Candidate[];
  /** группы, которым не хватило одного альбома до порога */
  nearly: Candidate[];
  suggestions: Suggestion[];
  options: Options;
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} ${one}`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
};
const albumsWord = (n: number) => plural(n, 'альбом', 'альбома', 'альбомов');
const remarksWord = (n: number) => plural(n, 'замечание', 'замечания', 'замечаний');

function title(c: Candidate): string {
  return [`К-${c.id}`, c.code, albumsWord(c.albums.length), remarksWord(c.remarks.length)]
    .filter(Boolean)
    .join(' · ');
}

function block(c: Candidate, full: boolean): string[] {
  const lines = [`### ${title(c)}`, ''];
  if (c.check) lines.push(`Вид проверки: ${c.check}`);
  if (c.normDocument) lines.push(`Норма: ${c.normDocument}`);
  lines.push(`Образец: ${c.sample}`);
  if (c.examples.length) {
    lines.push('', 'Другие формулировки:');
    for (const e of c.examples) lines.push(`- ${e}`);
  }
  lines.push('', `Альбомы: ${c.albums.join(', ')}`);
  if (full) lines.push('', `Черновик записи: ${c.draft}`);
  lines.push('');
  return lines;
}

export function markdown(s: Summary): string {
  const remarks = s.registries.reduce((n, r) => n + r.remarks.length, 0);
  const skipped = s.registries.flatMap((r) => r.skipped);
  const reasons = new Map<string, number>();
  for (const k of skipped) reasons.set(k.reason, (reasons.get(k.reason) ?? 0) + 1);
  const coded = s.candidates.filter((c) => c.code).length;

  const lines = [
    '# Кандидаты «типовая ошибка» из реестров проверок',
    '',
    `Дата разбора: ${s.date}. Реестров: ${s.registries.length}. Замечаний учтено: ${remarks}` +
      (skipped.length
        ? `; не учтено ${skipped.length} (${[...reasons].map(([k, n]) => `${k} — ${n}`).join(', ')})`
        : '') +
      '.',
    '',
    `Кандидат — замечание, которое встретилось в ${s.options.minAlbums} и более альбомах (решение 12). ` +
      `Похожие формулировки объединены автоматически (порог сходства ${s.options.threshold}); ` +
      'одно и то же «разными словами» может остаться в разных группах — объединяет Claude при разборе.',
    '',
    `Найдено: ${s.candidates.length} (утверждённых ТН — ${coded}, новых групп — ${s.candidates.length - coded}).`,
    '',
    'Как разобрать: попросить Claude пройтись по отчёту — объединить группы об одном и том же, ' +
      'поправить черновики записей; затем записать выбранные:',
    '',
    '```bash',
    'node tools/registry-scan/src/cli.ts <реестры> --out <папка> --records 1,4,7',
    '```',
    '',
    '## Кандидаты',
    '',
  ];
  if (!s.candidates.length) lines.push('Нет.', '');
  for (const c of s.candidates) lines.push(...block(c, true));

  if (s.nearly.length) {
    lines.push(`## Почти кандидаты — ${albumsWord(s.options.minAlbums - 1)}`, '');
    lines.push('Могут оказаться частью кандидата выше, если сформулированы иначе.', '');
    for (const c of s.nearly) lines.push(...block(c, false));
  }

  lines.push('## Предложения проверяющих «Кандидат в типовые находки»', '');
  if (!s.suggestions.length) lines.push('Нет.', '');
  for (const g of s.suggestions) {
    lines.push(`- ${g.text}${g.norm ? ` (норма: ${g.norm})` : ''} — ${g.album}`);
  }
  lines.push('');
  return lines.join('\n');
}

const csvCell = (value: string | number) => {
  const text = String(value);
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Таблица для Excel: разделитель «;», UTF-8 с меткой — открывается двойным щелчком. */
export function csv(candidates: Candidate[]): string {
  const head = ['№', 'Код ТН', 'Альбомов', 'Замечаний', 'Вид проверки', 'Норма', 'Образец', 'Черновик записи', 'Альбомы'];
  const rows = candidates.map((c) => [
    `К-${c.id}`,
    c.code,
    c.albums.length,
    c.remarks.length,
    c.check,
    c.normDocument,
    c.sample,
    c.draft,
    c.albums.join(', '),
  ]);
  return '﻿' + [head, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

/**
 * Запись шага 0 по кандидату — в формате навыка «Выводы».
 * confirmed_by_author: true — руководитель выбрал кандидата номером, это и есть подтверждение.
 */
export function recordFile(c: Candidate, date: string): { name: string; content: string } {
  const content = [
    '---',
    'type: вывод',
    'kind: факт',
    'core: Проектирование',
    'project:',
    `software_version: ${c.normDocument}`,
    'not_applicable:',
    `source: реестры проверок, ${albumsWord(c.albums.length)}, разбор ${date}${c.code ? `, ${c.code}` : ''}`,
    'confirmed_by_author: true',
    `created: ${date}`,
    '---',
    c.draft,
    '',
  ].join('\n');
  const { errors } = parseRecord(content);
  if (errors.length) throw new Error(`К-${c.id}: запись не проходит проверку формата — ${errors.join('; ')}`);
  return { name: `${date} — типовая ошибка К-${c.id}.md`, content };
}
