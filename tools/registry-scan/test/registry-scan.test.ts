import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseRecord } from '../../../skills/vyvody/record.mjs';
import { clusterRemarks, draftText, findCandidates, similarity } from '../src/cluster.ts';
import { listFiles, readRegistry, skipReason, type Remark } from '../src/registry.ts';
import { csv, markdown, recordFile } from '../src/report.ts';
import { normDocument, stem, stripSheetRefs, tokens } from '../src/text.ts';
import { MISSING_LIST, SINGLES, SPEC_TOTAL, sampleSet, tempFolder, writeRegistry } from './fixtures.ts';

const remark = (text: string, album = 'А', extra: Partial<Remark> = {}): Remark => ({
  album, file: `${album}.xlsx`, row: 2, text, norm: '', check: '', code: '', category: '', ...extra,
});

test('основы слов: падежи и числа сводятся к одной основе', () => {
  assert.equal(stem('ведомости'), stem('ведомость'));
  assert.equal(stem('ведомостей'), stem('ведомость'));
  assert.equal(stem('ссылочных'), stem('ссылочные'));
  assert.equal(stem('документов'), stem('документы'));
  assert.equal(stem('спецификации'), stem('спецификация'));
});

test('слова замечания: без чисел, служебных слов; «отсутствует» и «не указан» → «нет»', () => {
  assert.deepEqual(tokens('Отсутствует ведомость на листе 12'), ['нет', stem('ведомость')]);
  assert.deepEqual(tokens('Не указана отметка'), ['нет', stem('отметка')]);
  assert.deepEqual(tokens('Ё-моё: Пр-15, 3х100 = 200'), [stem('моё'.replace('ё', 'е'))]);
});

test('документ нормы без пункта', () => {
  assert.equal(normDocument('СП 63.13330.2018, п. 10.3.14'), 'СП 63.13330.2018');
  assert.equal(normDocument('ГОСТ Р 21.101-2026, п. 4.3.1'), 'ГОСТ Р 21.101-2026');
  assert.equal(normDocument('гост р 21.101–2026'), 'ГОСТ Р 21.101-2026');
  assert.equal(normDocument('—'), '');
  assert.equal(normDocument('стандарт бюро'), '');
});

test('ссылки на листы убираются из образца', () => {
  assert.equal(stripSheetRefs('Отсутствует ведомость (л. 1, 3).'), 'Отсутствует ведомость.');
  assert.equal(stripSheetRefs('Итог не равен сумме на листе 12.'), 'Итог не равен сумме.');
  assert.equal(stripSheetRefs('Ошибка в цепочке л. 7–9, ось А'), 'Ошибка в цепочке, ось А');
});

test('какие замечания не считаются', () => {
  assert.equal(skipReason('Ложное', ''), 'ложное');
  assert.equal(skipReason('неверно', 'Открыто'), 'ложное');
  assert.equal(skipReason('Игнорировать на проекте', ''), 'игнорировать на проекте');
  assert.equal(skipReason('', 'Снято'), 'снято');
  assert.equal(skipReason('', 'Отклонено'), 'отклонено проектировщиком');
  assert.equal(skipReason('Верное', 'Отклонено'), '');
  assert.equal(skipReason('Верное', 'Принято'), '');
  assert.equal(skipReason('', 'Открыто'), '');
});

test('сходство: одно замечание разными словами — высокое, разные — низкое', () => {
  const corpus = [...MISSING_LIST, ...SPEC_TOTAL, ...SINGLES].map((t) => remark(t));
  const [a, b, c] = corpus;
  assert.ok(similarity(a, b, corpus) >= 0.45, `a~b ${similarity(a, b, corpus)}`);
  assert.ok(similarity(a, c, corpus) >= 0.45, `a~c ${similarity(a, c, corpus)}`);
  assert.ok(similarity(corpus[3], corpus[4], corpus) >= 0.45, 'итог спецификации');
  for (const single of corpus.slice(5)) assert.ok(similarity(a, single, corpus) < 0.2);
});

test('группы не зависят от порядка замечаний', () => {
  const items = [...MISSING_LIST, ...SPEC_TOTAL, ...SINGLES].map((t, i) => remark(t, `А${i}`));
  const key = (groups: Remark[][]) =>
    groups.map((g) => g.map((r) => r.text).sort().join('|')).sort().join('\n');
  assert.equal(key(clusterRemarks(items)), key(clusterRemarks([...items].reverse())));
  assert.equal(clusterRemarks(items).length, 5);
});

test('чтение реестра: столбцы по названию, шифр, пропуски, ТН, предложения проверяющих', async () => {
  const folder = tempFolder();
  const [first, , third, old] = await sampleSet(folder);
  const r1 = (await readRegistry(first))!;
  assert.equal(r1.album, 'Х-01-АР1');
  assert.equal(r1.remarks.length, 9);
  assert.equal(r1.remarks[0].norm, 'ГОСТ Р 21.101-2026, п. 4.3.1');
  assert.equal(r1.remarks.find((r) => r.code)?.code, 'ТН-07');
  assert.deepEqual(r1.suggestions.map((s) => s.text), ['Высотные отметки на разрезах не совпадают с планами.']);
  const r3 = (await readRegistry(third))!;
  assert.deepEqual(r3.skipped.map((s) => s.reason), ['ложное']);
  const r4 = (await readRegistry(old))!;
  assert.equal(r4.album, 'Х-04-ОВ1');
  assert.equal(r4.remarks.length, 0);
  assert.deepEqual(r4.skipped.map((s) => s.reason).sort(), ['игнорировать на проекте', 'снято']);
});

test('файл без вкладки «Замечания» пропускается; временные файлы Excel — мимо', async () => {
  const folder = tempFolder();
  const file = await writeRegistry(folder, 'нет-замечаний.xlsx', 'Х', []);
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Другое');
  await wb.xlsx.writeFile(join(folder, 'другое.xlsx'));
  await wb.xlsx.writeFile(join(folder, '~$временный.xlsx'));
  assert.deepEqual(listFiles([folder]).map((f) => f.slice(folder.length + 1)), ['другое.xlsx', 'нет-замечаний.xlsx']);
  assert.equal(await readRegistry(join(folder, 'другое.xlsx')), null);
  assert.equal((await readRegistry(file))!.remarks.length, 0);
});

test('кандидаты: повтор в трёх альбомах — да; в двух или в одном альбоме пять раз — нет', async () => {
  const folder = tempFolder();
  const registries = await Promise.all((await sampleSet(folder)).map((f) => readRegistry(f)));
  const remarks = registries.flatMap((r) => r!.remarks);
  const candidates = findCandidates(remarks);
  assert.equal(candidates.length, 2);

  const coded = candidates.find((c) => c.code === 'ТН-07')!;
  assert.deepEqual(coded.albums, ['Х-01-АР1', 'Х-02-КЖ1', 'Х-03-АС1']);

  const missing = candidates.find((c) => !c.code)!;
  assert.deepEqual(missing.albums, ['Х-01-АР1', 'Х-02-КЖ1', 'Х-03-АС1']);
  assert.equal(missing.remarks.length, 3);
  assert.equal(missing.normDocument, 'ГОСТ Р 21.101-2026');
  assert.equal(missing.examples.length, 2);
  assert.ok(MISSING_LIST.includes(missing.sample));
  assert.deepEqual(candidates.map((c) => c.id), [1, 2]);

  const nearly = findCandidates(remarks, { minAlbums: 2, threshold: 0.45 });
  assert.ok(nearly.some((c) => !c.code && c.remarks.some((r) => r.text === SPEC_TOTAL[0])));
  assert.ok(!nearly.some((c) => c.sample.includes('подписи')), 'пять раз в одном альбоме — не кандидат');
});

test('черновик записи — до 300 знаков, без ссылок на листы', () => {
  const short = draftText('Отсутствует ведомость ссылочных документов (л. 1).', 4);
  assert.equal(short, 'Частое замечание проверок альбомов (4 альб.): Отсутствует ведомость ссылочных документов. Проверять до выпуска.');
  const long = draftText('Слово '.repeat(80), 12);
  assert.ok([...long].length <= 300);
  assert.ok(long.endsWith('…'));
});

test('отчёт, таблица и запись шага 0', async () => {
  const folder = tempFolder();
  const registries = (await Promise.all((await sampleSet(folder)).map((f) => readRegistry(f)))).map((r) => r!);
  const candidates = findCandidates(registries.flatMap((r) => r.remarks));
  const md = markdown({
    date: '2026-10-15', registries, candidates, nearly: [], options: { minAlbums: 3, threshold: 0.45 },
    suggestions: registries.flatMap((r) => r.suggestions),
  });
  assert.match(md, /Реестров: 4\. Замечаний учтено: 16; не учтено 3/);
  assert.match(md, /### К-2 · ТН-07 · 3 альбома · 3 замечания/);
  assert.match(md, /Высотные отметки на разрезах/);

  const table = csv(candidates);
  assert.ok(table.startsWith('﻿№;Код ТН;'));
  assert.equal(table.trim().split('\r\n').length, 3);

  for (const c of candidates) {
    const { name, content } = recordFile(c, '2026-10-15');
    assert.match(name, /^2026-10-15 — типовая ошибка К-\d+\.md$/);
    const { record, errors } = parseRecord(content, name);
    assert.deepEqual(errors, []);
    assert.equal(record?.kind, "fact");
    assert.equal(record?.core, "design");
  }
});

test('командная строка: отчёт, таблица и записи по номерам', async () => {
  const input = tempFolder();
  await sampleSet(input);
  const out = join(tempFolder(), 'результат');
  const cli = new URL('../src/cli.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const log = execFileSync(process.execPath, [cli, input, '--out', out, '--records', '1,К-2,9', '--date', '2026-10-15'], {
    encoding: 'utf8',
  });
  assert.match(log, /Реестров: 4, замечаний учтено: 16, кандидатов: 2/);
  assert.match(log, /✕ К-9: нет такого кандидата/);
  assert.deepEqual(readdirSync(out).sort(), ['записи', 'кандидаты.csv', 'кандидаты.md']);
  assert.equal(readdirSync(join(out, 'записи')).length, 2);
  assert.match(readFileSync(join(out, 'кандидаты.md'), 'utf8'), /^# Кандидаты/);
});
