import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { RecordView } from '../src/api.ts';
import { elements } from '../src/graph-elements.ts';

const rec = (number: number, patch: Partial<RecordView> = {}): RecordView => ({
  number, type: 'conclusion', kind: 'fact', core: 'bim', coreName: 'BIM и Revit', project: null, status: 'accepted',
  statusName: 'принята', text: 'Вымышленная запись', softwareVersion: null, notApplicable: null, source: 'тест', author: 'автор',
  worked: 0, failed: 0, trust: 'нет отметок', needsCheck: false, requestsCount: 0, askedCount: 0, version: 1,
  created: '', updated: '', ...patch,
});

const data = {
  nodes: [
    rec(1, { needsCheck: true, requestsCount: 20 }),
    rec(2, { kind: 'hypothesis', trust: 'ложная · 0 за, 2 против' }),
    rec(3, { kind: 'rule', core: 'design', status: 'pending' }),
    rec(4, { type: 'question', kind: null, core: 'process', status: 'open' }),
  ],
  edges: [
    { from: 1, to: 2, type: 'contradicts' },
    { from: 3, to: 4, type: 'answers' },
  ],
};

test('узлы сгруппированы по ядрам, классы — по виду и состоянию', () => {
  const all = elements(data, { core: '', acceptedOnly: false });
  const ids = all.map((e) => e.data.id);
  assert.deepEqual(ids.filter((id) => String(id).startsWith('core-')), ['core-design', 'core-bim', 'core-process']);
  const byId = new Map(all.map((e) => [e.data.id, e]));
  assert.equal(byId.get('r1')?.data.parent, 'core-bim');
  assert.match(byId.get('r1')?.classes ?? '', /check/);
  assert.equal(byId.get('r1')?.data.size, 22 + 30, 'размер ограничен');
  assert.match(byId.get('r2')?.classes ?? '', /hypothesis.*faded/);
  assert.match(byId.get('r3')?.classes ?? '', /waiting/);
  assert.equal(byId.get('r4')?.data.color, '#d99100');
  assert.equal(all.filter((e) => e.data.source).length, 2);
});

test('фильтры: ядро и «только принятые» — рёбра только между показанными', () => {
  const bim = elements(data, { core: 'bim', acceptedOnly: false });
  assert.deepEqual(bim.map((e) => e.data.id), ['core-bim', 'r1', 'r2', 'e1-2-contradicts']);
  const accepted = elements(data, { core: '', acceptedOnly: true });
  assert.ok(!accepted.some((e) => e.data.id === 'r3'));
  assert.ok(!accepted.some((e) => e.data.source === 'r3'), 'ребро к скрытой записи не рисуется');
});
