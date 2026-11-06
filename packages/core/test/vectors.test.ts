import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { dot, fuse, principalAxes, projectPoint, scaleToUnit, unitVector } from '../src/index.ts';

test('векторы: длина 1 и близость', () => {
  const a = unitVector([3, 4]);
  assert.ok(Math.abs(dot(a, a) - 1) < 1e-6);
  assert.ok(Math.abs(dot(a, unitVector([4, -3]))) < 1e-6, 'перпендикулярные — близость 0');
  assert.deepEqual([...unitVector([0, 0])], [0, 0], 'нулевой вектор не делится на ноль');
});

test('слияние: смысл важнее слов, найденные обоими — выше', () => {
  assert.deepEqual(fuse(['a', 'b', 'c'], []), ['a', 'b', 'c']);
  assert.deepEqual(fuse([], ['x', 'y']), ['x', 'y']);
  // «c» третья по смыслу, но её нашли и слова — она выше записей, найденных только смыслом
  assert.deepEqual(fuse(['a', 'b', 'c'], ['c']), ['c', 'a', 'b']);
  // запись только по словам — ниже первых по смыслу
  assert.equal(fuse(['a', 'b'], ['z']).at(-1), 'z');
});

test('главные оси: облако вдоль одной оси ложится на первую координату, повторяемо', () => {
  const pts = [[0, 0, 1], [2, 0.1, 1], [4, -0.1, 1], [6, 0, 1]];
  const basis = principalAxes(pts, 2);
  const first = pts.map((p) => projectPoint(p, basis)[0]!);
  const spread = Math.max(...first) - Math.min(...first);
  assert.ok(spread > 5.9, `разброс по первой оси ${spread}`);
  const second = pts.map((p) => Math.abs(projectPoint(p, basis)[1]!));
  assert.ok(Math.max(...second) < 0.2);
  assert.deepEqual(principalAxes(pts, 2).axes.map((a) => [...a]), basis.axes.map((a) => [...a]), 'без случайностей');
  const { points } = scaleToUnit(pts.map((p) => projectPoint(p, basis)));
  assert.ok(points.every((p) => p.every((x) => Math.abs(x) <= 1 + 1e-9)));
});
