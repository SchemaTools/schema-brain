import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { RecordView } from '../src/api.ts';
import { around, defaultState, elements, problems, visible } from '../src/graph-elements.ts';

const rec = (number: number, patch: Partial<RecordView> = {}): RecordView => ({
  number, type: 'conclusion', kind: 'fact', core: 'bim', coreName: 'BIM и Revit', project: null, status: 'accepted',
  statusName: 'принята', text: `Вымышленная запись ${number}`, softwareVersion: null, notApplicable: null, source: 'тест',
  author: 'автор', worked: 0, failed: 0, trust: 'нет отметок', needsCheck: false, requestsCount: 0, askedCount: 0,
  version: 1, created: '', updated: '', ...patch,
});

// 1 и 2 спорят; 3 — ложная; 4 — «проверить»; 5 — на модерации; 6 — открытый вопрос;
// 7 — ответ на закрытый вопрос 8; 9 — заменённое правило, 10 его заменяет; 11 — выведена из 1; 12 — особняком
const data = {
  nodes: [
    rec(1, { requestsCount: 20 }),
    rec(2, { kind: 'hypothesis' }),
    rec(3, { trust: 'ложная · 0 за, 2 против' }),
    rec(4, { needsCheck: true }),
    rec(5, { status: 'pending', core: 'tools' }),
    rec(6, { type: 'question', kind: null, status: 'open', core: 'process' }),
    rec(7, { core: 'process' }),
    rec(8, { type: 'question', kind: null, status: 'answered', core: 'process' }),
    rec(9, { kind: 'rule', status: 'replaced', core: 'design' }),
    rec(10, { kind: 'rule', core: 'design' }),
    rec(11),
    rec(12),
  ],
  edges: [
    { from: 1, to: 2, type: 'contradicts' },
    { from: 7, to: 8, type: 'answers' },
    { from: 10, to: 9, type: 'replaces' },
    { from: 11, to: 1, type: 'derived_from' },
  ],
};

test('проблемы: противоречие, ложная, «проверить», на модерации, вопрос без ответа', () => {
  const p = problems(data);
  assert.deepEqual([...p.keys()].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(p.get(1), ['противоречие']);
  assert.deepEqual(p.get(6), ['вопрос без ответа']);
  // спор с заменённой записью решён
  const settled = { ...data, edges: [...data.edges, { from: 9, to: 4, type: 'contradicts' }] };
  assert.deepEqual(problems(settled).get(4), ['проверить']);
});

test('режим «Проблемы» показывает проблемные и их соседей, «Обзор» — всё', () => {
  const s = defaultState();
  assert.deepEqual(visible(data, s).map((r) => r.number), [1, 2, 3, 4, 5, 6, 11]);
  assert.equal(visible(data, { ...s, mode: 'overview' }).length, 12);
});

test('«Вокруг записи»: расстояния по связям, глубина, типы связей', () => {
  const all = defaultState().links;
  assert.deepEqual([...around(data.edges, 11, 1, all)], [[11, 0], [1, 1]]);
  assert.deepEqual([...around(data.edges, 11, 2, all)], [[11, 0], [1, 1], [2, 2]]);
  assert.deepEqual([...around(data.edges, 11, 2, new Set(['answers']))], [[11, 0]]);
  const s = { ...defaultState(), mode: 'around' as const, center: 11, depth: 2 };
  assert.deepEqual(visible(data, s).map((r) => r.number), [1, 2, 11]);
  // центр виден, даже если его ядро снято фильтром
  assert.deepEqual(visible(data, { ...s, cores: new Set(['tools']) }).map((r) => r.number), [11]);
});

test('фильтры: ядро, вид, состояние', () => {
  const s = { ...defaultState(), mode: 'overview' as const };
  assert.deepEqual(visible(data, { ...s, cores: new Set(['design']) }).map((r) => r.number), [9, 10]);
  assert.deepEqual(visible(data, { ...s, kinds: new Set(['question' as const]) }).map((r) => r.number), [6, 8]);
  const noFalse = visible(data, { ...s, states: new Set(['accepted' as const, 'pending' as const, 'check' as const]) });
  assert.ok(!noFalse.some((r) => r.number === 3 || r.number === 9));
});

test('узлы: цвет — ядро, форма — вид, классы состояния, группы ядер без рамок', () => {
  const els = elements(data, { ...defaultState(), mode: 'overview' });
  const by = new Map(els.map((e) => [e.data.id, e]));
  assert.deepEqual(els.filter((e) => e.classes === 'core').map((e) => e.data.id), ['core-design', 'core-bim', 'core-process', 'core-tools']);
  assert.equal(by.get('r1')?.data.color, '#0e7c63');
  assert.equal(by.get('r1')?.data.size, 26 + 32);
  assert.equal(by.get('r1')?.data.parent, 'core-bim');
  assert.match(String(by.get('r1')?.data.full), /^№ 1\nВымышленная запись 1$/);
  assert.match(by.get('r2')?.classes ?? '', /hypothesis/);
  assert.match(by.get('r3')?.classes ?? '', /faded/);
  assert.match(by.get('r4')?.classes ?? '', /check/);
  assert.match(by.get('r5')?.classes ?? '', /pending/);
  assert.match(by.get('r6')?.classes ?? '', /question/);
  assert.equal(els.filter((e) => e.data.source).length, 4);
});

test('«Проблемы»: соседи бледные; «Вокруг»: без групп, центр отмечен', () => {
  const p = new Map(elements(data, defaultState()).map((e) => [e.data.id, e.classes ?? '']));
  assert.match(p.get('r11') ?? '', /context/);
  assert.doesNotMatch(p.get('r1') ?? '', /context/);
  const a = elements(data, { ...defaultState(), mode: 'around', center: 11, depth: 1 });
  assert.ok(!a.some((e) => e.classes === 'core'));
  assert.match(a.find((e) => e.data.id === 'r11')?.classes ?? '', /center/);
});
