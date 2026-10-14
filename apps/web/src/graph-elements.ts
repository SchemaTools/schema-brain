// Узлы и рёбра графа из ответа /api/graph — без браузера, с тестами.
import { CORES, type RecordView } from './api.ts';

/** Элемент графа в формате Cytoscape. */
export interface ElementDefinition {
  data: Record<string, string | number>;
  classes?: string;
}

export interface GraphData {
  nodes: RecordView[];
  edges: { from: number; to: number; type: string }[];
}

export const COLOR = { fact: '#1a1d21', rule: '#1b3fd1', hypothesis: '#5f6469', question: '#d99100' } as const;

export function elements(data: GraphData, opts: { core: string; acceptedOnly: boolean }): ElementDefinition[] {
  const shown = data.nodes.filter(
    (r) =>
      (!opts.core || r.core === opts.core) &&
      (!opts.acceptedOnly || ['accepted', 'open', 'answered'].includes(r.status)),
  );
  const numbers = new Set(shown.map((r) => r.number));
  const cores = new Set(shown.map((r) => r.core));
  return [
    ...CORES.filter((c) => cores.has(c.code)).map((c) => ({ data: { id: `core-${c.code}`, label: c.name }, classes: 'core' })),
    ...shown.map((r) => ({
      data: {
        id: `r${r.number}`,
        parent: `core-${r.core}`,
        label: `№ ${r.number}`,
        color: r.type === 'question' ? COLOR.question : COLOR[r.kind ?? 'fact'],
        size: 22 + Math.min(30, r.requestsCount * 3),
      },
      classes: [
        r.kind === 'hypothesis' ? 'hypothesis' : '',
        r.trust.startsWith('ложная') || ['rejected', 'replaced', 'merged'].includes(r.status) ? 'faded' : '',
        r.needsCheck ? 'check' : '',
        r.status === 'pending' || r.status === 'disputed' ? 'waiting' : '',
      ].join(' '),
    })),
    ...data.edges
      .filter((e) => numbers.has(e.from) && numbers.has(e.to))
      .map((e) => ({ data: { id: `e${e.from}-${e.to}-${e.type}`, source: `r${e.from}`, target: `r${e.to}` }, classes: e.type })),
  ];
}

