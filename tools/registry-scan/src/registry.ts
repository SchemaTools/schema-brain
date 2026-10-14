// Чтение xlsx-реестров замечаний единого формата бюро (шаблон v3 и ранние).
// Столбцы ищутся по началу названия, а не по номеру: так читаются и реестры
// прежних версий шаблона. Имена проверяющих и проектировщиков не читаются.
import { readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import ExcelJS from 'exceljs';

export interface Remark {
  /** альбом: шифр со вкладки «Об альбоме», иначе имя файла */
  album: string;
  file: string;
  row: number;
  text: string;
  norm: string;
  /** вид проверки: «Оформление», «Арифметика», … */
  check: string;
  /** код типовой находки ТН-xx, если проставлен */
  code: string;
  category: string;
}

export interface Suggestion {
  album: string;
  file: string;
  text: string;
  norm: string;
}

export interface Registry {
  file: string;
  album: string;
  remarks: Remark[];
  /** замечания, не взятые в разбор, — с причиной */
  skipped: { row: number; reason: string }[];
  /** «Обратная связь» с типом «Кандидат в типовые находки» */
  suggestions: Suggestion[];
}

const SHEET_REMARKS = 'замечания';

/** Вердикт или статус, при котором замечание не считается. */
export function skipReason(verdict: string, status: string): string {
  const v = verdict.trim().toLowerCase();
  const s = status.trim().toLowerCase();
  if (/^(ложн|не\s*верн|неверн|ошибка$|нет$)/.test(v)) return 'ложное';
  if (v.startsWith('игнорир')) return 'игнорировать на проекте';
  if (s === 'снято') return 'снято';
  if (s === 'отклонено' && !v.startsWith('верн')) return 'отклонено проектировщиком';
  return '';
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if ('text' in value) return String(value.text);
    if ('result' in value) return value.result === undefined ? '' : String(value.result);
    if (value instanceof Date) return value.toISOString().slice(0, 10);
  }
  return String(value).trim();
}

function findColumn(header: string[], ...keys: string[]): number {
  for (const key of keys) {
    const index = header.findIndex((name) => name.toLowerCase().startsWith(key));
    if (index >= 0) return index;
  }
  return -1;
}

function rowValues(sheet: ExcelJS.Worksheet, row: number, width: number): string[] {
  const r = sheet.getRow(row);
  return Array.from({ length: width }, (_, i) => cellText(r.getCell(i + 1).value));
}

function albumOf(workbook: ExcelJS.Workbook, file: string): string {
  const about = workbook.worksheets.find((s) => s.name.toLowerCase() === 'об альбоме');
  if (about) {
    for (let r = 1; r <= about.rowCount; r += 1) {
      const [key, value] = rowValues(about, r, 2);
      if (key.toLowerCase() === 'шифр' && value) return value;
    }
  }
  return basename(file).replace(/\.xlsx$/i, '').replace(/[_ ]?реестр.*$/i, '');
}

/** Реестр из файла; null — в файле нет вкладки «Замечания». */
export async function readRegistry(file: string): Promise<Registry | null> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const sheet = workbook.worksheets.find((s) => s.name.toLowerCase() === SHEET_REMARKS);
  if (!sheet) return null;

  const album = albumOf(workbook, file);
  const width = sheet.columnCount;
  const header = rowValues(sheet, 1, width);
  const col = {
    text: findColumn(header, 'замечание'),
    norm: findColumn(header, 'норма'),
    check: findColumn(header, 'вид проверки', 'вид'),
    code: findColumn(header, 'тип находки'),
    category: findColumn(header, 'категория'),
    status: findColumn(header, 'статус'),
    verdict: findColumn(header, 'вердикт'),
  };
  if (col.text < 0) throw new Error(`${basename(file)}: на вкладке «Замечания» нет столбца «Замечание»`);

  const remarks: Remark[] = [];
  const skipped: Registry['skipped'] = [];
  const get = (values: string[], index: number) => (index >= 0 ? values[index] ?? '' : '');
  for (let r = 2; r <= sheet.rowCount; r += 1) {
    const values = rowValues(sheet, r, width);
    const text = get(values, col.text);
    if (!text) continue;
    const reason = skipReason(get(values, col.verdict), get(values, col.status));
    if (reason) {
      skipped.push({ row: r, reason });
      continue;
    }
    const code = /ТН-\d+/i.exec(get(values, col.code))?.[0].toUpperCase() ?? '';
    remarks.push({
      album,
      file: basename(file),
      row: r,
      text,
      norm: get(values, col.norm).replace(/^—$/, ''),
      check: get(values, col.check),
      code,
      category: get(values, col.category),
    });
  }

  const suggestions: Suggestion[] = [];
  const feedback = workbook.worksheets.find((s) => s.name.toLowerCase() === 'обратная связь');
  if (feedback) {
    const fbHeader = rowValues(feedback, 1, feedback.columnCount);
    const fb = {
      type: findColumn(fbHeader, 'тип'),
      text: findColumn(fbHeader, 'описание'),
      norm: findColumn(fbHeader, 'норма'),
    };
    for (let r = 2; r <= feedback.rowCount; r += 1) {
      const values = rowValues(feedback, r, feedback.columnCount);
      if (!/кандидат в типовые/i.test(get(values, fb.type))) continue;
      const text = get(values, fb.text);
      if (text) suggestions.push({ album, file: basename(file), text, norm: get(values, fb.norm) });
    }
  }

  return { file: basename(file), album, remarks, skipped, suggestions };
}

/** Все *.xlsx из папок (с подпапками) и отдельных файлов; временные файлы Excel «~$…» — мимо. */
export function listFiles(paths: string[]): string[] {
  return paths.flatMap((path) => {
    if (!statSync(path).isDirectory()) return [path];
    return readdirSync(path, { recursive: true, encoding: 'utf8' })
      .filter((name) => /\.xlsx$/i.test(name) && !basename(name).startsWith('~$'))
      .map((name) => join(path, name))
      .sort();
  });
}
