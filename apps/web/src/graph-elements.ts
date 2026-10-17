// Граф связей — логика без браузера, с тестами. Решения руководителя 2026-10-16
// (Согласование «граф связей»): режимы «Проблемы» / «Обзор» / «Вокруг записи»; цвет — ядро,
// форма — вид; подпись — номер, при приближении — начало текста; размер — запросы агентов;
// незаметные группы ядер.
import type { RecordView } from './api.ts';

/** Элемент графа в формате Cytoscape. */
export interface ElementDefinition {
  data: Record<string, string | number | undefined>;
  classes?: string;
}

export interface GraphEdge {
  from: number;
  to: number;
  type: string;
}

export interface GraphData {
  nodes: RecordView[];
  edges: GraphEdge[];
}

export type Mode = 'problems' | 'overview' | 'around';
export type KindKey = 'rule' | 'fact' | 'hypothesis' | 'question';
export type StateKey = 'accepted' | 'pending' | 'check' | 'false' | 'replaced';

export interface GraphState {
  mode: Mode;
  center: number | null;
  depth: number;
  cores: Set<string>;
  kinds: Set<KindKey>;
  states: Set<StateKey>;
  links: Set<string>;
}

export const CORE_COLOR: Record<string, string> = {
  design: '#1b3fd1',
  bim: '#0e7c63',
  process: '#eb6834',
  tools: '#7a4fd1',
};
export const CORE_NAME: Record<string, string> = {
  design: 'Проектирование',
  bim: 'BIM и Revit',
  process: 'Процессы бюро',
  tools: 'Инструменты',
};

export const isFalse = (r: RecordView) => r.type === 'conclusion' && r.trust.startsWith('ложная');
export const kindKey = (r: RecordView): KindKey => (r.type === 'question' ? 'question' : (r.kind ?? 'fact'));
const waiting = (r: RecordView) => r.status === 'pending' || r.status === 'disputed';

/** Состояние записи для фильтра «Состояние». */
export function stateKey(r: RecordView): StateKey {
  if (isFalse(r)) return 'false';
  if (r.status === 'replaced' || r.status === 'merged' || r.status === 'rejected') return 'replaced';
  if (waiting(r)) return 'pending';
  return 'accepted';
}

export type Problem = 'противоречие' | 'вопрос без ответа' | 'ложная' | 'проверить' | 'на модерации';

/** Что ждёт решения: противоречия, вопросы без ответа, ложные, «проверить», на модерации. */
export function problems(data: GraphData): Map<number, Problem[]> {
  const out = new Map<number, Problem[]>();
  const add = (n: number, p: Problem) => out.set(n, [...(out.get(n) ?? []), p]);
  const byNumber = new Map(data.nodes.map((r) => [r.number, r]));
  for (const e of data.edges) {
    if (e.type !== 'contradicts') continue;
    const a = byNumber.get(e.from);
    const b = byNumber.get(e.to);
    // спор, где одна сторона уже отклонена или заменена, решён
    if (a && b && stateKey(a) !== 'replaced' && stateKey(b) !== 'replaced') {
      add(e.from, 'противоречие');
      add(e.to, 'противоречие');
    }
  }
  for (const r of data.nodes) {
    if (r.type === 'question' && r.status === 'open') add(r.number, 'вопрос без ответа');
    if (isFalse(r) && r.status === 'accepted') add(r.number, 'ложная');
    if (r.needsCheck && r.status === 'accepted') add(r.number, 'проверить');
    if (waiting(r)) add(r.number, 'на модерации');
  }
  return out;
}

/** Расстояние от записи по связям нужных типов, не дальше depth шагов. */
export function around(edges: GraphEdge[], center: number, depth: number, links: Set<string>): Map<number, number> {
  const dist = new Map([[center, 0]]);
  let front = [center];
  for (let d = 1; d <= depth && front.length; d += 1) {
    const next: number[] = [];
    for (const e of edges) {
      if (!links.has(e.type)) continue;
      for (const [a, b] of [
        [e.from, e.to],
        [e.to, e.from],
      ]) {
        if (front.includes(a) && !dist.has(b)) {
          dist.set(b, d);
          next.push(b);
        }
      }
    }
    front = next;
  }
  return dist;
}

/** Записи, которые показывает граф в текущем режиме и с фильтрами. */
export function visible(data: GraphData, s: GraphState): RecordView[] {
  let ids: Set<number>;
  if (s.mode === 'around' && s.center !== null) {
    ids = new Set(around(data.edges, s.center, s.depth, s.links).keys());
  } else if (s.mode === 'problems') {
    const p = problems(data);
    ids = new Set(p.keys());
    // соседи проблемных — для контекста
    for (const e of data.edges) {
      if (p.has(e.from) || p.has(e.to)) {
        ids.add(e.from);
        ids.add(e.to);
      }
    }
  } else {
    ids = new Set(data.nodes.map((r) => r.number));
  }
  return data.nodes.filter((r) => {
    if (!ids.has(r.number)) return false;
    if (s.mode === 'around' && r.number === s.center) return true;
    if (!s.cores.has(r.core) || !s.kinds.has(kindKey(r))) return false;
    if (r.type === 'question') return true;
    return s.states.has(stateKey(r)) || (r.needsCheck && s.states.has('check'));
  });
}

const short = (text: string) => (text.length > 42 ? `${text.slice(0, 40).replace(/\s+\S*$/, '')}…` : text);

export function elements(data: GraphData, s: GraphState): ElementDefinition[] {
  const shown = visible(data, s);
  const numbers = new Set(shown.map((r) => r.number));
  const p = s.mode === 'problems' ? problems(data) : null;
  const grouped = s.mode !== 'around';
  const els: ElementDefinition[] = [];
  if (grouped) {
    for (const core of Object.keys(CORE_NAME)) {
      if (shown.some((r) => r.core === core)) els.push({ data: { id: `core-${core}`, label: CORE_NAME[core] }, classes: 'core' });
    }
  }
  for (const r of shown) {
    els.push({
      data: {
        id: `r${r.number}`,
        parent: grouped ? `core-${r.core}` : undefined,
        num: `№ ${r.number}`,
        full: `№ ${r.number}\n${short(r.text)}`,
        color: CORE_COLOR[r.core] ?? '#5f6469',
        size: 26 + Math.min(34, r.requestsCount * 1.6),
      },
      classes: [
        kindKey(r),
        waiting(r) ? 'pending' : '',
        stateKey(r) === 'false' || stateKey(r) === 'replaced' ? 'faded' : '',
        r.needsCheck ? 'check' : '',
        p && !p.has(r.number) ? 'context' : '',
        s.mode === 'around' && r.number === s.center ? 'center' : '',
      ]
        .filter(Boolean)
        .join(' '),
    });
  }
  for (const e of data.edges) {
    if (numbers.has(e.from) && numbers.has(e.to) && s.links.has(e.type)) {
      els.push({ data: { id: `e${e.from}-${e.to}-${e.type}`, source: `r${e.from}`, target: `r${e.to}`, type: e.type }, classes: e.type });
    }
  }
  return els;
}

export function defaultState(): GraphState {
  return {
    mode: 'problems',
    center: null,
    depth: 2,
    cores: new Set(Object.keys(CORE_NAME)),
    kinds: new Set<KindKey>(['rule', 'fact', 'hypothesis', 'question']),
    states: new Set<StateKey>(['accepted', 'pending', 'check', 'false', 'replaced']),
    links: new Set(['contradicts', 'answers', 'derived_from', 'replaces', 'merged_into']),
  };
}
