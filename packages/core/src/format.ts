// Короткий ответ агенту (docs/spec.md, раздел 7): строки, без JSON, чтобы не раздувать контекст.
//
//   № 128 · правило · BIM и Revit · 75 % (3 за, 0 против)
//   При копировании листов … по шаблонному виду.
//   Не применимо: для связанных файлов с общими уровнями.
//   Проверить: записано для Revit 2026, текущая — Revit 2027.
//   Противоречит: № 130 (60 % · 3 за, 1 против)
import { type Core, type Kind, type RecordType, RU, type Status } from './enums.ts';
import { trustText } from './trust.ts';

export interface AgentRecord {
  number: number;
  type: RecordType;
  kind: Kind | null;
  core: Core;
  project: string | null;
  status: Status;
  text: string;
  notApplicable: string | null;
  worked: number;
  failed: number;
  /** готовая строка «Проверить: …», если есть пометка */
  check?: string;
  rivals?: { number: number; worked: number; failed: number }[];
  answers?: number[];
}

export function agentLines(r: AgentRecord): string {
  const head = [`№ ${r.number}`, r.kind ? RU.kind[r.kind] : RU.type[r.type], RU.core[r.core]];
  if (r.project) head.push(`проект ${r.project}`);
  if (r.type === 'conclusion') head.push(trustText(r.worked, r.failed));
  else head.push(RU.status[r.status]);
  if (r.status === 'pending' || r.status === 'disputed') head.push(RU.status[r.status]);

  const lines = [head.join(' · '), r.text];
  if (r.notApplicable) lines.push(`Не применимо: ${r.notApplicable}`);
  if (r.check) lines.push(r.check);
  if (r.rivals?.length) {
    lines.push(
      `Противоречит: ${r.rivals.map((x) => `№ ${x.number} (${trustText(x.worked, x.failed)})`).join('; ')}`,
    );
  }
  if (r.answers?.length) lines.push(`Ответы: ${r.answers.map((n) => `№ ${n}`).join(', ')}`);
  return lines.join('\n');
}

export const agentList = (records: AgentRecord[], empty = 'Ничего не найдено.') =>
  records.length ? records.map(agentLines).join('\n\n') : empty;
