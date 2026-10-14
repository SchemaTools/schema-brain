// Вымышленные реестры для тестов: шифры, замечания и нормы придуманы,
// реальные реестры бюро в репозиторий не попадают.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';

export interface Row {
  text: string;
  norm?: string;
  check?: string;
  code?: string;
  category?: string;
  status?: string;
  verdict?: string;
}

const V3 = ['№', 'Лист', 'Стр. PDF', 'Раздел / элемент', 'Замечание', 'Норма / основание', 'Вид проверки',
  'Тип находки', 'Категория', 'Рекомендация', 'Уверенность', 'Статус', 'Ответ проектировщика',
  'Вердикт проверяющего', 'Место'];

/** Реестр шаблона v3; old — столбцы в другом порядке и без «Об альбоме», как в ранних реестрах. */
export async function writeRegistry(
  folder: string,
  name: string,
  album: string,
  rows: Row[],
  extra: { old?: boolean; feedback?: { type: string; text: string; norm?: string }[] } = {},
): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Замечания');
  const header = extra.old
    ? ['Категория', 'Замечание', 'Вид', 'Норма', 'Статус', 'Вердикт']
    : V3;
  ws.addRow(header);
  rows.forEach((r, i) => {
    const byName: Record<string, string | number> = {
      '№': i + 1,
      Лист: String(i + 1),
      'Раздел / элемент': 'Общие данные',
      Замечание: r.text,
      'Норма / основание': r.norm ?? '—',
      Норма: r.norm ?? '',
      'Вид проверки': r.check ?? 'Оформление',
      Вид: r.check ?? 'Оформление',
      'Тип находки': r.code ?? '',
      Категория: r.category ?? 'Существенно',
      Рекомендация: 'Исправить',
      Уверенность: 'Высокая',
      Статус: r.status ?? 'Открыто',
      'Вердикт проверяющего': r.verdict ?? '',
      Вердикт: r.verdict ?? '',
    };
    ws.addRow(header.map((h) => byName[h] ?? ''));
  });
  if (!extra.old) {
    const about = wb.addWorksheet('Об альбоме');
    about.addRow(['Объект', 'Вымышленный объект']);
    about.addRow(['Шифр', album]);
    about.addRow(['Проверяющий', 'Проверяющий 1']);
  }
  const fb = wb.addWorksheet('Обратная связь');
  fb.addRow(['№', 'Тип записи', 'Описание', 'Лист / пример', 'Норма (документ, редакция, пункт)', 'Предложение для навыка или базы', 'Автор']);
  for (const [i, f] of (extra.feedback ?? []).entries()) fb.addRow([i + 1, f.type, f.text, '', f.norm ?? '', '', 'Проверяющий 1']);
  const file = join(folder, name);
  await wb.xlsx.writeFile(file);
  return file;
}

export const tempFolder = () => mkdtempSync(join(tmpdir(), 'registry-scan-'));

// Одно и то же замечание разными словами — в трёх альбомах
export const MISSING_LIST = [
  'Нет ведомости ссылочных и прилагаемых документов в общих данных.',
  'Отсутствует ведомость ссылочных документов (л. 1).',
  'В общих данных не приведена ведомость ссылочных и прилагаемых документов.',
];
// Другое замечание — только в двух альбомах
export const SPEC_TOTAL = [
  'Итог спецификации не равен сумме строк по этажам.',
  'Итоговое количество в спецификации не совпадает с суммой строк по этажам на листе 12.',
];
// Разовые замечания
export const SINGLES = [
  'Размерная цепочка по оси 3 не замыкается на габарит здания.',
  'Класс бетона в общих указаниях не совпадает со спецификацией материалов.',
  'Не указана отметка верха монолитной плиты перекрытия.',
];

/** Набор из четырёх альбомов для проверки кандидатов. */
export async function sampleSet(folder: string): Promise<string[]> {
  const norm = 'ГОСТ Р 21.101-2026, п. 4.3.1';
  return Promise.all([
    writeRegistry(folder, 'А-01_реестр-замечаний.xlsx', 'Х-01-АР1', [
      { text: MISSING_LIST[0], norm },
      { text: SPEC_TOTAL[0], check: 'Арифметика' },
      { text: 'Итог ведомости расхода стали не равен сумме по элементам.', check: 'Арифметика', code: 'ТН-07' },
      ...Array.from({ length: 5 }, () => ({ text: 'Нет подписи разработчика в штампе.' })),
      { text: SINGLES[0], check: 'Увязка' },
    ], {
      feedback: [
        { type: 'Кандидат в типовые находки', text: 'Высотные отметки на разрезах не совпадают с планами.' },
        { type: 'Ложное — причина', text: 'Узел дан в другом альбоме.' },
      ],
    }),
    writeRegistry(folder, 'А-02_реестр-замечаний.xlsx', 'Х-02-КЖ1', [
      { text: MISSING_LIST[1], norm: 'ГОСТ Р 21.101-2026' },
      { text: SPEC_TOTAL[1], check: 'Арифметика' },
      { text: 'Сумма в ведомости расхода не сходится.', check: 'Арифметика', code: 'ТН-07' },
      { text: SINGLES[1], check: 'Увязка' },
    ]),
    writeRegistry(folder, 'А-03_реестр-замечаний.xlsx', 'Х-03-АС1', [
      { text: MISSING_LIST[2], norm },
      { text: 'Итог спецификации арматуры не равен сумме.', check: 'Арифметика', code: 'ТН-07' },
      { text: SINGLES[2] },
      { text: 'Нет подписи разработчика в штампе.', verdict: 'Ложное' },
    ]),
    // ранний реестр: другой порядок столбцов, шифр — из имени файла
    writeRegistry(folder, 'Х-04-ОВ1_реестр.xlsx', '', [
      { text: 'Нет подписи разработчика в штампе.', verdict: 'Игнорировать на проекте' },
      { text: 'Отсутствует ведомость ссылочных документов.', status: 'Снято' },
    ], { old: true }),
  ]);
}
