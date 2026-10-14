// Импорт md-записей шага 0 и выгрузки: датасет JSONL, страница для справки Schema Teams
// (docs/spec.md, разделы 9.1, 9.3, 10.1).
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseRecord } from '../../../../skills/vyvody/record.mjs';
import { fromRu, isFalse, RU } from '../../../../packages/core/src/index.ts';
import { AppError, type Ctx, invalid } from '../context.ts';
import type { Db } from '../db/client.ts';
import { imported, propose } from './records.ts';

export const DATASET_FORMAT = 1;

export interface ImportReport {
  accepted: { file: string; number: number; existing: boolean }[];
  skipped: { file: string; reason: string }[];
  failed: { file: string; errors: string[] }[];
}

/** Импорт папки md-записей одного сотрудника: повторный запуск безопасен (раздел 9.1). */
export async function importFolder(db: Db, ctx: Ctx, folder: string): Promise<ImportReport> {
  const report: ImportReport = { accepted: [], skipped: [], failed: [] };
  const files = readdirSync(folder)
    .filter((name) => name.toLowerCase().endsWith('.md'))
    .sort();
  for (const name of files) {
    const source = readFileSync(join(folder, name), 'utf8');
    const { record, errors } = parseRecord(source, name);
    if (!record) {
      report.failed.push({ file: name, errors });
      continue;
    }
    // повтор — тот же текст того же сотрудника
    const hash = createHash('sha256').update(`${ctx.personId}\n${record.text}`).digest('hex');
    if (await imported(db, hash)) {
      report.skipped.push({ file: name, reason: 'уже импортирована' });
      continue;
    }
    try {
      const result = await propose(db, ctx, {
        type: record.type,
        kind: record.kind ?? '',
        core: record.core,
        project: record.project,
        software_version: record.software_version,
        not_applicable: record.not_applicable,
        source: `${record.source}; импорт md: ${basename(name)}`.slice(0, 300),
        text: record.text,
        confirmed_by_author: true,
        import_hash: hash,
      });
      report.accepted.push({ file: name, number: result.record.number, existing: result.existing });
    } catch (error) {
      const e = error as AppError;
      report.failed.push({ file: name, errors: [e.message, ...(e.details ?? [])] });
    }
  }
  return report;
}

const jsonl = (rows: object[]) => rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');

/** Датасет для дообучения: пять файлов, вместо людей — ярлыки, без токенов (раздел 10.1). */
export async function exportDataset(db: Db, folder: string, serviceVersion: string) {
  mkdirSync(folder, { recursive: true });
  const people = new Map((await db.person.findMany()).map((p) => [p.id, p.label]));
  const label = (id: string | null) => (id ? (people.get(id) ?? '') : '');

  const records = await db.record.findMany({ include: { core: true, project: true }, orderBy: { number: 'asc' } });
  const byId = new Map(records.map((r) => [r.id, r.number]));
  const recordRows = records.map((r) => ({
    number: r.number,
    type: r.type,
    kind: r.kind,
    core: r.core.code,
    project: r.project?.code ?? null,
    text: r.text,
    software_version: r.softwareVersion,
    not_applicable: r.notApplicable,
    source: r.source,
    refs: r.refs,
    author: label(r.authorId),
    author_client: r.authorClient,
    status: r.status,
    worked: r.worked,
    failed: r.failed,
    false: r.type === 'conclusion' && isFalse(r.worked, r.failed),
    needs_check: r.needsCheck,
    requests_count: r.requestsCount,
    asked_count: r.askedCount,
    created: r.created.toISOString(),
    updated: r.updated.toISOString(),
  }));
  const links = (await db.link.findMany({ orderBy: { created: 'asc' } })).map((l) => ({
    from: byId.get(l.fromId),
    to: byId.get(l.toId),
    type: l.type,
    created_by: label(l.createdBy),
    created: l.created.toISOString(),
  }));
  const feedback = (await db.feedback.findMany({ orderBy: { created: 'asc' } })).map((f) => ({
    record: byId.get(f.recordId),
    person: label(f.personId),
    client: f.client,
    worked: f.worked,
    comment: f.comment,
    software_version: f.softwareVersion,
    created: f.created.toISOString(),
  }));
  const events = (await db.recordEvent.findMany({ orderBy: { id: 'asc' } })).map((e) => ({
    record: byId.get(e.recordId),
    person: label(e.personId),
    client: e.client,
    kind: e.kind,
    data: e.data,
    created: e.created.toISOString(),
  }));

  writeFileSync(join(folder, 'records.jsonl'), jsonl(recordRows));
  writeFileSync(join(folder, 'links.jsonl'), jsonl(links));
  writeFileSync(join(folder, 'feedback.jsonl'), jsonl(feedback));
  writeFileSync(join(folder, 'events.jsonl'), jsonl(events));
  const meta = {
    format: DATASET_FORMAT,
    service_version: serviceVersion,
    exported: new Date().toISOString(),
    counts: { records: recordRows.length, links: links.length, feedback: feedback.length, events: events.length },
  };
  writeFileSync(join(folder, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  return meta;
}

/**
 * Страница справки по ядру: принятые правила и факты выше порога (раздел 9.3).
 * Публикует руководитель через Claude и MCP Schema Teams — сервис только готовит текст.
 */
export async function wikiPage(db: Db, coreInput: string): Promise<string> {
  const code = fromRu('core', coreInput);
  if (!code) throw invalid(`Ядро «${coreInput}» не найдено`);
  const core = await db.core.findUnique({ where: { code } });
  if (!core) throw invalid(`Ядро «${coreInput}» не найдено`);
  const rows = await db.record.findMany({
    where: { coreId: core.id, type: 'conclusion', status: 'accepted', kind: { in: ['rule', 'fact'] } },
    include: { project: true },
    orderBy: { number: 'asc' },
  });
  const good = rows.filter((r) => !isFalse(r.worked, r.failed) && !r.project);
  const date = new Date().toLocaleDateString('sv-SE'); // ГГГГ-ММ-ДД по местному времени
  const lines = [
    `# ${core.name}: выводы Schema Brain`,
    '',
    `Кратко. Подтверждённые правила бюро и факты ядра «${core.name}» из Schema Brain на ${date}. ` +
      'Номер — запись в Schema Brain; там же отметки «сработало» и история.',
    '',
  ];
  for (const kind of ['rule', 'fact'] as const) {
    const part = good.filter((r) => r.kind === kind);
    if (!part.length) continue;
    lines.push(`## ${kind === 'rule' ? 'Правила бюро' : 'Факты'}`, '');
    for (const r of part) {
      const extra = [r.softwareVersion, r.notApplicable ? `не применимо: ${r.notApplicable}` : '', r.needsCheck ? 'проверить на текущей версии' : '']
        .filter(Boolean)
        .join('; ');
      lines.push(`- **№ ${r.number}.** ${r.text}${extra ? ` _(${extra})_` : ''}`);
    }
    lines.push('');
  }
  if (!good.length) lines.push(`Пока нет принятых правил и фактов по ядру «${RU.core[code]}».`, '');
  return lines.join('\n');
}
