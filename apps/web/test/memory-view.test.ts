import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { answerLinks, type MemoryAnswer, type MemoryNode, radar, roleOf, scoreText } from '../src/memory-view.ts';

const node = (number: number, x: number, y: number) => ({ number, x, y, z: 0 }) as MemoryNode;
const answer: MemoryAnswer = {
  vectors: 'e5-small',
  point: { x: 0, y: 0, z: 0 },
  minScore: 0.83,
  scores: [
    { number: 1, score: 0.9 },
    { number: 2, score: 0.85 },
    { number: 3, score: 0.75 },
  ],
  found: [1, 2],
  linked: [3],
};

test('роль записи в ответе', () => {
  assert.equal(roleOf(1, answer), 'found');
  assert.equal(roleOf(3, answer), 'linked');
  assert.equal(roleOf(9, answer), 'rest');
  assert.equal(roleOf(1, null), 'rest');
});

test('сфера вопроса: ближе по смыслу — ближе к центру, направление — из облака, порог — кругом', () => {
  const r = radar([node(1, 1, 0), node(2, 0, 1), node(3, -1, 0)], answer);
  const p = new Map(r.points.map((x) => [x.number, x]));
  const dist = (n: number) => Math.hypot(p.get(n)!.x, p.get(n)!.y);
  assert.ok(dist(1) < dist(2) && dist(2) < dist(3));
  assert.ok(Math.abs(dist(3) - 1) < 1e-9, 'самая далёкая — на краю');
  assert.ok(p.get(1)!.x > 0 && Math.abs(p.get(1)!.y) < 1e-9, 'направление сохраняется');
  assert.ok(p.get(3)!.x < 0);
  assert.ok(r.threshold > dist(2) && r.threshold < dist(3), 'найденные — внутри круга порога');
});

test('связи ответа: только от найденных к подтянутым', () => {
  const links = [
    { from: 3, to: 1, type: 'derived_from', typeName: 'выведена из' },
    { from: 4, to: 5, type: 'answers', typeName: 'отвечает' },
    { from: 3, to: 4, type: 'answers', typeName: 'отвечает' },
  ];
  assert.deepEqual(answerLinks(links, answer).map((l) => [l.from, l.to]), [[3, 1]]);
  assert.deepEqual(answerLinks(links, null), []);
});

test('близость словами', () => {
  assert.equal(scoreText(0.873), '0,87');
});
