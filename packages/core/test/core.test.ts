import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  agentLines,
  allWords,
  anyWord,
  bearer,
  checkText,
  clampLimit,
  clearsCheck,
  countMarks,
  cyrillicMarks,
  decide,
  fromRu,
  generateToken,
  hashToken,
  initialStatus,
  isFalse,
  isTokenShape,
  linkProblem,
  mergeHits,
  needsCheck,
  parseQuery,
  parseVersion,
  privateHits,
  queueOrder,
  type RecordRef,
  sameHash,
  score,
  tokenHint,
  trustState,
  trustText,
  validateRecord,
} from '../src/index.ts';

const day = (n: number) => new Date(Date.UTC(2026, 9, n));

test('перечисления: код или русское название, без учёта регистра и ё', () => {
  assert.equal(fromRu('core', 'BIM и Revit'), 'bim');
  assert.equal(fromRu('core', 'bim и revit'), 'bim');
  assert.equal(fromRu('core', 'tools'), 'tools');
  assert.equal(fromRu('kind', 'Правило'), 'rule');
  assert.equal(fromRu('type', 'вопрос'), 'question');
  assert.equal(fromRu('status', 'есть ответ'), 'answered');
  assert.equal(fromRu('core', 'Конструкции'), undefined);
});

test('отметки: по людям, последняя отметка человека, без автора', () => {
  const marks = [
    { personId: 'p1', worked: true, created: day(1) },
    { personId: 'p1', worked: false, created: day(3) }, // передумал — действует последняя
    { personId: 'p2', worked: true, created: day(2) },
    { personId: 'p2', worked: true, created: day(4) }, // второй агент того же человека — одна отметка
    { personId: 'author', worked: true, created: day(5) },
  ];
  assert.deepEqual(countMarks(marks, 'author'), { n: 1, b: 1 });
  assert.deepEqual(countMarks([], 'author'), { n: 0, b: 0 });
});

test('показатель доверия и порог «ложная» с двух отметок', () => {
  assert.equal(score(3, 0), 0.75);
  assert.equal(trustState(0, 0), 'none');
  assert.equal(trustState(0, 1), 'few'); // одна «не сработало» свежую запись не скрывает
  assert.equal(trustState(1, 0), 'few');
  assert.equal(trustState(0, 2), 'false');
  assert.equal(trustState(1, 2), 'false'); // 1/4 = 25 % — включительно
  assert.equal(trustState(1, 1), 'ok'); // 1/3
  assert.equal(isFalse(0, 2), true);
  assert.equal(isFalse(0, 2, { falseAt: 0.25, minMarks: 3 }), false);
});

test('показатель словами', () => {
  assert.equal(trustText(0, 0), 'нет отметок');
  assert.equal(trustText(0, 1), 'мало отметок · 0 за, 1 против');
  assert.equal(trustText(3, 0), '75 % · 3 за, 0 против');
  assert.equal(trustText(0, 2), 'ложная · 0 за, 2 против');
  assert.equal(trustText(2, 1), '50 % · 2 за, 1 против');
});

test('очередь модерации: противоречия → нужные агентам → остальные', () => {
  const item = (number: number, status: 'pending' | 'disputed' | 'accepted', requestsCount: number, d: number) => ({
    number, status, requestsCount, created: day(d),
  });
  const order = queueOrder([
    item(1, 'pending', 0, 1),
    item(2, 'pending', 5, 4),
    item(3, 'disputed', 0, 6),
    item(4, 'pending', 9, 5),
    item(5, 'accepted', 50, 1),
    item(6, 'disputed', 3, 2),
    item(7, 'pending', 0, 0),
  ]).map((x) => x.number);
  assert.deepEqual(order, [6, 3, 4, 2, 7, 1]);
});

test('версия: продукт и номер', () => {
  assert.deepEqual(parseVersion('Revit 2026'), { product: 'Revit', version: '2026' });
  assert.deepEqual(parseVersion('Schema.Tools 1.4'), { product: 'Schema.Tools', version: '1.4' });
  assert.deepEqual(parseVersion('Schema.Tools v1.4.2'), { product: 'Schema.Tools', version: '1.4.2' });
  assert.deepEqual(parseVersion('СП 70.13330.2012'), { product: 'СП 70.13330', version: '2012' });
  assert.deepEqual(parseVersion('ГОСТ Р 21.101-2026'), { product: 'ГОСТ Р 21.101', version: '2026' });
  assert.equal(parseVersion(''), null);
  assert.equal(parseVersion('2026'), null);
  assert.equal(parseVersion('без версии'), null);
});

test('пометка «проверить»: тот же продукт, другая версия; снимает «сработало» на текущей', () => {
  const current = { product: 'Revit', version: '2027' };
  assert.equal(needsCheck('Revit 2026', current), true);
  assert.equal(needsCheck('revit 2026', current), true);
  assert.equal(needsCheck('Revit 2027', current), false);
  assert.equal(needsCheck('Schema.Tools 1.4', current), false);
  assert.equal(needsCheck(null, current), false);
  assert.equal(clearsCheck(true, 'Revit 2027', current), true);
  assert.equal(clearsCheck(false, 'Revit 2027', current), false);
  assert.equal(clearsCheck(true, 'Revit 2026', current), false);
  assert.equal(clearsCheck(true, undefined, current), false);
  assert.equal(checkText('Revit 2026', current), 'Проверить: записано для Revit 2026, текущая — Revit 2027.');
});

const ref = (type: RecordRef['type'], kind: RecordRef['kind'], status: RecordRef['status'] = 'accepted'): RecordRef => ({
  type, kind, status,
});

test('связи: противоречие — только факты и гипотезы; у правила соперников нет', () => {
  const fact = ref('conclusion', 'fact');
  const hyp = ref('conclusion', 'hypothesis');
  const rule = ref('conclusion', 'rule');
  const question = ref('question', null, 'open');
  assert.equal(linkProblem('contradicts', fact, hyp, false), '');
  assert.match(linkProblem('contradicts', fact, rule, false), /у правила бюро соперников нет/);
  // запись на модерации может указать на правило — это сигнал модератору
  assert.equal(linkProblem('contradicts', ref('conclusion', 'fact', 'disputed'), rule, false), '');
  assert.match(linkProblem('contradicts', fact, question, false), /только между выводами/);
  assert.equal(linkProblem('answers', fact, question, false), '');
  assert.match(linkProblem('answers', question, fact, false), /от вывода к вопросу/);
  assert.equal(linkProblem('replaces', rule, rule, false), '');
  assert.match(linkProblem('replaces', fact, rule, false), /правило/);
  assert.match(linkProblem('derived_from', fact, fact, true), /саму себя/);
});

test('состояние при отправке', () => {
  assert.equal(initialStatus('conclusion', false), 'pending');
  assert.equal(initialStatus('conclusion', true), 'disputed');
  assert.equal(initialStatus('question', false), 'open');
});

test('решения модератора по выводу', () => {
  const pending = ref('conclusion', 'fact', 'pending');
  const accepted = ref('conclusion', 'fact');
  assert.deepEqual(decide(pending, 'accept'), { status: 'accepted' });
  assert.deepEqual(decide(ref('conclusion', 'fact', 'disputed'), 'reject'), { status: 'rejected' });
  assert.deepEqual(decide(pending, 'merge', accepted), { status: 'merged', link: 'merged_into' });
  assert.deepEqual(decide(ref('conclusion', 'rule', 'disputed'), 'replace', ref('conclusion', 'rule')), {
    status: 'accepted',
    targetStatus: 'replaced',
    link: 'replaces',
  });
  assert.deepEqual(decide(ref('conclusion', 'fact', 'rejected'), 'reopen'), { status: 'pending' });

  assert.throws(() => decide(accepted, 'accept'), /только запись на модерации/);
  assert.throws(() => decide(pending, 'merge'), /с какой записью/);
  assert.throws(() => decide(pending, 'merge', ref('conclusion', 'fact', 'pending')), /с принятой/);
  assert.throws(() => decide(pending, 'replace', ref('conclusion', 'rule')), /правило правилом/);
  assert.throws(() => decide(ref('conclusion', 'fact', 'disputed'), 'accept', undefined, true), /противоречит правилу/);
  assert.throws(() => decide(pending, 'close'), /только для вопроса/);
});

test('решения модератора по вопросу', () => {
  assert.deepEqual(decide(ref('question', null, 'open'), 'close'), { status: 'closed' });
  assert.deepEqual(decide(ref('question', null, 'answered'), 'close'), { status: 'closed' });
  assert.deepEqual(decide(ref('question', null, 'open'), 'reject'), { status: 'rejected' });
  assert.deepEqual(decide(ref('question', null, 'closed'), 'reopen'), { status: 'open' });
  assert.throws(() => decide(ref('question', null, 'open'), 'accept'), /для вопроса/);
});

test('токены: вид, хэш, подсказка, заголовок', () => {
  const token = generateToken();
  assert.ok(isTokenShape(token), token.length.toString());
  assert.equal(token.length, 47);
  assert.notEqual(generateToken(), token);
  assert.equal(hashToken(token).length, 64);
  assert.ok(sameHash(hashToken(token), hashToken(token)));
  assert.ok(!sameHash(hashToken(token), hashToken(generateToken())));
  assert.equal(tokenHint(token), token.slice(4, 12));
  assert.equal(bearer(`Bearer ${token}`), token);
  assert.equal(bearer('Bearer чужое'), null);
  assert.equal(bearer(undefined), null);
});

test('поиск: латиница перед цифрой — в кириллицу', () => {
  assert.equal(cyrillicMarks('Бетон B25, арматура A500С, B 25'), 'Бетон В25, арматура А500С, B 25');
  assert.equal(cyrillicMarks('Revit 2026, BIM'), 'Revit 2026, BIM');
});

test('поиск: формулировки, слова, tsquery', () => {
  const q = parseQuery('Зона обрезки | crop region | обрезка вида | лишняя');
  assert.deepEqual(q.phrasings, [['зона', 'обрезки'], ['crop', 'region'], ['обрезка', 'вида']]);
  assert.equal(allWords(q.phrasings[0]), 'зона:* & обрезки:*');
  assert.equal(anyWord(q.phrasings[0]), 'зона:* | обрезки:*');
  assert.deepEqual(parseQuery("класс B25: что-то'; drop").phrasings, [['класс', 'в25', 'что', 'то', 'drop']]);
  assert.deepEqual(parseQuery('  |  ').phrasings, []);
  assert.equal(clampLimit(undefined), 5);
  assert.equal(clampLimit(100), 20);
  assert.equal(clampLimit(0), 1);
});

test('поиск: слияние формулировок — «все слова» выше, без повторов', () => {
  const hits = mergeHits(
    [
      [{ id: 'a', rank: 0.2, strict: true }, { id: 'b', rank: 0.9, strict: false }],
      [{ id: 'b', rank: 0.1, strict: true }, { id: 'c', rank: 0.5, strict: false }, { id: 'a', rank: 0.5, strict: true }],
    ],
    3,
  );
  assert.deepEqual(hits.map((h) => [h.id, h.rank, h.strict]), [['a', 0.5, true], ['b', 0.1, true], ['c', 0.5, false]]);
});

test('ответ агенту — короткие строки', () => {
  const text = agentLines({
    number: 128, type: 'conclusion', kind: 'rule', core: 'bim', project: null, status: 'accepted',
    text: 'Перед копированием выровнять зоны обрезки по шаблонному виду.',
    notApplicable: 'для связанных файлов с общими уровнями', worked: 3, failed: 0,
    check: 'Проверить: записано для Revit 2026, текущая — Revit 2027.',
    rivals: [{ number: 130, worked: 3, failed: 1 }],
  });
  assert.equal(
    text,
    [
      '№ 128 · правило · BIM и Revit · 75 % · 3 за, 0 против',
      'Перед копированием выровнять зоны обрезки по шаблонному виду.',
      'Не применимо: для связанных файлов с общими уровнями',
      'Проверить: записано для Revit 2026, текущая — Revit 2027.',
      'Противоречит: № 130 (60 % · 3 за, 1 против)',
    ].join('\n'),
  );
  const question = agentLines({
    number: 12, type: 'question', kind: null, core: 'process', project: 'Х-01', status: 'answered',
    text: 'Как называть виды?', notApplicable: null, worked: 0, failed: 0, answers: [40, 41],
  });
  assert.equal(question, '№ 12 · вопрос · Процессы бюро · проект Х-01 · есть ответ\nКак называть виды?\nОтветы: № 40, № 41');
});

const good = {
  type: 'вывод', kind: 'факт', core: 'BIM и Revit', text: 'Оси обрезаются при копировании листов.',
  source: 'сессия 2026-10-15', confirmed_by_author: true,
};

test('запись от агента: годная — коды и чистый текст', () => {
  const { value, errors } = validateRecord({ ...good, text: '  Бетон  B25 — класс\nпо проекту. ', software_version: 'Revit 2026' });
  assert.deepEqual(errors, []);
  assert.deepEqual(value, {
    type: 'conclusion', kind: 'fact', core: 'bim', project: null, softwareVersion: 'Revit 2026',
    notApplicable: null, source: 'сессия 2026-10-15', text: 'Бетон В25 — класс по проекту.',
  });
});

test('запись от агента: ошибки', () => {
  const errorsOf = (patch: Record<string, unknown>) => validateRecord({ ...good, ...patch }).errors.join('\n');
  assert.match(errorsOf({ confirmed_by_author: false }), /только после «ок» автора/);
  assert.match(errorsOf({ confirmed_by_author: 'true' }), /только после «ок» автора/);
  assert.match(errorsOf({ kind: '' }), /у вывода нужен вид/);
  assert.match(errorsOf({ type: 'вопрос' }), /у вопроса вид не указывается/);
  assert.match(errorsOf({ core: 'Конструкции' }), /core/);
  assert.match(errorsOf({ text: 'ё'.repeat(301) }), /301 знаков/);
  assert.equal(errorsOf({ text: 'ё'.repeat(300) }), '');
  assert.match(errorsOf({ source: '' }), /source/);
  assert.match(errorsOf({ text: 'Писать на name@example.com' }), /адрес почты/);
});

test('личные данные', () => {
  const slash = '\\';
  assert.deepEqual(privateHits(`Лежит в C:${slash}Projects${slash}x`), ['путь к файлу']);
  assert.deepEqual(privateHits(`Сервер ${['10', '0', '0', '5'].join('.')}`), ['IP-адрес']);
  assert.deepEqual(privateHits('СП 70.13330.2012, Revit 2026'), []);
  assert.deepEqual(privateHits(null, 'Звонить +7 900 123-45-67'), ['телефон']);
});
