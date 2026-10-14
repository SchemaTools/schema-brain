import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { test } from 'node:test';
import { checkSkill, crc32, exampleRecords, zip } from './pack.mjs';
import { parseRecord } from './record.mjs';

const head = (fields) =>
  `---\n${Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')}\n---\n`;

const base = {
  type: 'вывод',
  kind: 'факт',
  core: 'BIM и Revit',
  project: '',
  software_version: 'Revit 2026',
  not_applicable: '',
  source: 'сессия 2026-10-15, задача «оси»',
  confirmed_by_author: 'true',
  created: '2026-10-15',
};
const TEXT = 'При копировании листов оси обрезаются, если у видов разные зоны обрезки.';

const errorsOf = (fields, text = TEXT, name) => parseRecord(head(fields) + text, name).errors;

test('годная запись → коды сервиса', () => {
  const { record, errors, warnings } = parseRecord(
    head(base) + TEXT,
    '2026-10-15 — оси обрезаются.md',
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.deepEqual(record, {
    type: 'conclusion',
    kind: 'fact',
    core: 'bim',
    project: null,
    software_version: 'Revit 2026',
    not_applicable: null,
    source: 'сессия 2026-10-15, задача «оси»',
    confirmed_by_author: true,
    created: '2026-10-15',
    text: TEXT,
  });
});

test('все примеры из references/format.md проходят', () => {
  const format = readFileSync(new URL('./vyvody/references/format.md', import.meta.url), 'utf8');
  const examples = exampleRecords(format);
  assert.equal(examples.length, 4);
  for (const example of examples) assert.deepEqual(parseRecord(example).errors, []);
});

test('пример из docs/data-model.md с подсказками после # проходит', () => {
  const model = readFileSync(new URL('../../docs/data-model.md', import.meta.url), 'utf8');
  const [example] = exampleRecords(model);
  const { record, errors } = parseRecord(example);
  assert.deepEqual(errors, []);
  assert.equal(record.type, 'conclusion');
  assert.equal(record.not_applicable, 'для связанных файлов с общими уровнями');
});

test('CRLF, BOM и коды вместо русских значений', () => {
  const source = '\uFEFF' + (head({ ...base, type: 'conclusion', kind: 'rule', core: 'tools' }) + TEXT).replace(/\n/g, '\r\n');
  const { record, errors } = parseRecord(source);
  assert.deepEqual(errors, []);
  assert.equal(record.kind, 'rule');
  assert.equal(record.core, 'tools');
});

test('регистр значений не важен', () => {
  assert.deepEqual(errorsOf({ ...base, type: 'Вывод', kind: 'Факт', core: 'bim и revit' }), []);
});

test('вопрос — без вида; вывод — с видом', () => {
  assert.deepEqual(errorsOf({ ...base, type: 'вопрос', kind: '' }, 'Как в бюро называть виды?'), []);
  assert.match(errorsOf({ ...base, type: 'вопрос' }).join(), /у вопроса вид не указывается/);
  assert.match(errorsOf({ ...base, kind: '' }).join(), /у вывода нужен вид/);
});

test('неизвестные значения перечислений', () => {
  assert.match(errorsOf({ ...base, type: 'заметка' }).join(), /type/);
  assert.match(errorsOf({ ...base, kind: 'мнение' }).join(), /kind/);
  assert.match(errorsOf({ ...base, core: 'Конструкции' }).join(), /core/);
});

test('без подтверждения автора запись не годится', () => {
  assert.match(errorsOf({ ...base, confirmed_by_author: 'false' }).join(), /не подтверждена автором/);
  const { confirmed_by_author, ...rest } = base;
  assert.match(errorsOf(rest).join(), /confirmed_by_author/);
});

test('обязательные поля и дата', () => {
  assert.match(errorsOf({ ...base, source: '' }).join(), /«source»/);
  assert.match(errorsOf({ ...base, created: '15.10.2026' }).join(), /ГГГГ-ММ-ДД/);
  assert.match(errorsOf({ ...base, created: '2026-02-30' }).join(), /ГГГГ-ММ-ДД/);
});

test('длина текста: 300 знаков можно, 301 — нет', () => {
  assert.deepEqual(errorsOf(base, 'ё'.repeat(300)), []);
  assert.match(errorsOf(base, 'ё'.repeat(301)).join(), /301 знаков/);
  assert.match(errorsOf(base, '').join(), /нет текста/);
});

test('текст в несколько строк склеивается в одну', () => {
  const { record } = parseRecord(head(base) + 'Первая фраза.\n  Вторая фраза.\n');
  assert.equal(record.text, 'Первая фраза. Вторая фраза.');
});

test('больше трёх фраз — замечание, не ошибка', () => {
  const { errors, warnings } = parseRecord(head(base) + 'Раз. Два. Три. Четыре.');
  assert.deepEqual(errors, []);
  assert.match(warnings.join(), /4 фраз/);
});

test('личные и серверные данные — ошибка', () => {
  // образцы собраны из частей, чтобы scripts/check-private-data.sh не принял их за настоящие
  const slash = '\\';
  for (const text of [
    'Спросить у name@example.com.',
    `Шаблон лежит в C:${slash}Projects${slash}шаблон.rte.`,
    `Файл на ${slash}${slash}fileserver${slash}share.`,
    `Сервер ${['192', '168', '1', '20'].join('.')} отвечает медленно.`,
    'Звонить +7 900 123-45-67.',
  ]) {
    assert.ok(errorsOf(base, text).some((e) => e.startsWith('похоже на личные')), text);
  }
  assert.deepEqual(errorsOf({ ...base, software_version: 'СП 70.13330.2012' }), []);
});

test('нет заголовка, дубль поля, лишнее поле', () => {
  assert.match(parseRecord(TEXT).errors.join(), /нет заголовка/);
  assert.match(parseRecord(head(base).replace('---\n', '---\ntype: вывод\n') + TEXT).errors.join(), /дважды/);
  assert.match(parseRecord(head({ ...base, author: 'кто-то' }) + TEXT).warnings.join(), /лишнее поле/);
});

test('имя файла', () => {
  assert.match(parseRecord(head(base) + TEXT, 'вывод.md').warnings.join(), /имя файла/);
});

test('фронтматтер SKILL.md', () => {
  const skill = readFileSync(new URL('./vyvody/SKILL.md', import.meta.url), 'utf8');
  assert.equal(checkSkill(skill).name, 'vyvody');
  assert.throws(() => checkSkill('# без заголовка'), /фронтматтера/);
  assert.throws(() => checkSkill('---\nname: Vyvody\ndescription: x\n---\n'), /name/);
});

test('zip: файлы читаются обратно', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  const data = Buffer.from('Выводы — общая память', 'utf8');
  const archive = zip({ 'vyvody/SKILL.md': data });
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  const nameLength = archive.readUInt16LE(26);
  assert.equal(archive.subarray(30, 30 + nameLength).toString('utf8'), 'vyvody/SKILL.md');
  const packedLength = archive.readUInt32LE(18);
  const packed = archive.subarray(30 + nameLength, 30 + nameLength + packedLength);
  assert.deepEqual(inflateRawSync(packed), data);
  assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50);
});
