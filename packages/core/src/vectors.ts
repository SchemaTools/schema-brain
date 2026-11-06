// Векторы смысла (решение 2026-11-06): близость, слияние со словами, проекция для картинки.
// Векторы — длины 1 (их так отдаёт модель), близость — скалярное произведение.

export function unitVector(v: Float32Array | number[]): Float32Array {
  const out = Float32Array.from(v);
  let sum = 0;
  for (const x of out) sum += x * x;
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < out.length; i++) out[i] = out[i]! / norm;
  return out;
}

/** Скалярное произведение; для векторов длины 1 — косинусная близость. */
export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}

/** Слияние смысла и слов (как в хабе): 1/(k+место), у слов — меньший вес. */
export const FUSION = { k: 60, wordsWeight: 0.2 } as const;

export function fuse(semantic: readonly string[], words: readonly string[], settings: { k: number; wordsWeight: number } = FUSION): string[] {
  const score = new Map<string, number>();
  const add = (ids: readonly string[], weight: number) =>
    ids.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + weight / (settings.k + i + 1)));
  add(semantic, 1);
  add(words, settings.wordsWeight);
  // при равенстве — кого нашли оба способа, затем порядок смысла
  return [...score.entries()].sort((a, b) => b[1] - a[1] || semantic.indexOf(a[0]) - semantic.indexOf(b[0])).map(([id]) => id);
}

/**
 * Главные оси облака (метод главных компонент степенным способом): точки — в `dims` координатах.
 * Без случайностей: одинаковые векторы дают одинаковую картинку. Возвращает и оси — чтобы поставить вопрос туда же.
 */
export function principalAxes(vectors: readonly ArrayLike<number>[], dims: number): { mean: Float64Array; axes: Float64Array[] } {
  const n = vectors.length;
  const d = n ? vectors[0]!.length : 0;
  const mean = new Float64Array(d);
  for (const v of vectors) for (let j = 0; j < d; j++) mean[j]! += v[j]! / n;
  const centered = vectors.map((v) => Float64Array.from({ length: d }, (_, j) => v[j]! - mean[j]!));
  const axes: Float64Array[] = [];
  for (let a = 0; a < Math.min(dims, d); a++) {
    // начальное направление — по номеру оси, чтобы результат был повторяемым
    let w = Float64Array.from({ length: d }, (_, j) => Math.sin((j + 1) * (a + 1)));
    for (let iter = 0; iter < 60; iter++) {
      const next = new Float64Array(d);
      for (const x of centered) {
        let p = 0;
        for (let j = 0; j < d; j++) p += x[j]! * w[j]!;
        for (let j = 0; j < d; j++) next[j]! += p * x[j]!;
      }
      for (const prev of axes) {
        let p = 0;
        for (let j = 0; j < d; j++) p += next[j]! * prev[j]!;
        for (let j = 0; j < d; j++) next[j]! -= p * prev[j]!;
      }
      let norm = 0;
      for (const x of next) norm += x * x;
      norm = Math.sqrt(norm);
      if (!norm) break;
      for (let j = 0; j < d; j++) next[j] = next[j]! / norm;
      w = next;
    }
    // знак оси — чтобы самая большая по модулю составляющая была положительной (картинка не «переворачивается»)
    let big = 0;
    for (let j = 0; j < d; j++) if (Math.abs(w[j]!) > Math.abs(w[big]!)) big = j;
    if (w[big]! < 0) for (let j = 0; j < d; j++) w[j] = -w[j]!;
    axes.push(w);
  }
  return { mean, axes };
}

/** Координаты точки в осях облака. */
export function projectPoint(v: ArrayLike<number>, basis: { mean: Float64Array; axes: Float64Array[] }): number[] {
  return basis.axes.map((axis) => {
    let p = 0;
    for (let j = 0; j < axis.length; j++) p += (v[j]! - basis.mean[j]!) * axis[j]!;
    return p;
  });
}

/** Масштаб координат в [-1, 1] по самому дальнему выбросу (общий для всех осей — пропорции сохраняются). */
export function scaleToUnit(points: number[][]): { points: number[][]; scale: number } {
  let max = 0;
  for (const p of points) for (const x of p) max = Math.max(max, Math.abs(x));
  const scale = max ? 1 / max : 1;
  return { points: points.map((p) => p.map((x) => x * scale)), scale };
}
