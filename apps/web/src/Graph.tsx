// Граф связей (docs/adr/001-стек-и-хранение.md, «Как устроен граф»; этап 4 плана).
// Узлы — записи, сгруппированные по ядрам; цвет — вид, размер — сколько раз запрашивали агенты;
// «ложные» — бледные, «проверить» — жёлтая рамка; противоречия — красный пунктир.
import cytoscape, { type Core } from 'cytoscape';
import { useEffect, useRef, useState } from 'react';
import { api, CORES, KIND, LINK, qs, type RecordView } from './api.ts';
import { COLOR, elements, type GraphData } from './graph-elements.ts';

const STYLE: cytoscape.StylesheetJson = [
  {
    selector: 'node',
    style: {
      'background-color': 'data(color)',
      width: 'data(size)',
      height: 'data(size)',
      label: 'data(label)',
      'font-family': 'Inter Variable, Segoe UI, Arial, sans-serif',
      'font-size': 10,
      color: '#1a1d21',
      'text-valign': 'bottom',
      'text-margin-y': 3,
      'border-width': 2,
      'border-color': '#ffffff',
    },
  },
  { selector: 'node.hypothesis', style: { 'border-style': 'dashed', 'border-color': '#1a1d21', 'background-opacity': 0.55 } },
  { selector: 'node.check', style: { 'border-color': '#d99100', 'border-width': 3 } },
  { selector: 'node.waiting', style: { 'background-opacity': 0.35 } },
  { selector: 'node.faded', style: { opacity: 0.35 } },
  {
    selector: 'node.core',
    style: {
      'background-color': '#f2f4f5',
      'background-opacity': 1,
      'border-color': '#d7dbde',
      'border-width': 1,
      shape: 'rectangle',
      label: 'data(label)',
      'text-valign': 'top',
      'text-halign': 'center',
      'font-size': 11,
      'font-weight': 600,
      color: '#5f6469',
      'text-wrap': 'wrap',
      'text-max-width': '110px',
      padding: '18px',
    },
  },
  { selector: 'node:selected', style: { 'border-color': '#1b3fd1', 'border-width': 4 } },
  {
    selector: 'edge',
    style: { width: 1.5, 'line-color': '#8a9096', 'target-arrow-color': '#8a9096', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier' },
  },
  { selector: 'edge.contradicts', style: { 'line-color': '#d32f2f', 'line-style': 'dashed', 'target-arrow-shape': 'none', width: 2 } },
  { selector: 'edge.answers', style: { 'line-color': '#0e7c63', 'target-arrow-color': '#0e7c63', width: 2 } },
  { selector: 'edge.replaces', style: { 'line-style': 'dotted' } },
  { selector: 'edge.merged_into', style: { 'line-color': '#c9ced2', 'target-arrow-color': '#c9ced2' } },
];

export function GraphPage({ params }: { params: URLSearchParams }) {
  const center = params.get('center') ?? '';
  const depth = params.get('depth') ?? '2';
  const box = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);
  const [data, setData] = useState<GraphData>();
  const [error, setError] = useState('');
  const [core, setCore] = useState('');
  const [acceptedOnly, setAcceptedOnly] = useState(false);
  const [picked, setPicked] = useState<RecordView | null>(null);

  useEffect(() => {
    setError('');
    api<GraphData>('GET', `/api/graph${qs({ center, depth: center ? depth : undefined })}`).then(setData, (e: Error) => setError(e.message));
  }, [center, depth]);

  useEffect(() => {
    if (!box.current || !data) return;
    const instance = cytoscape({
      container: box.current,
      elements: elements(data, { core, acceptedOnly }),
      style: STYLE,
      layout: { name: 'cose', animate: false, padding: 24, nodeRepulsion: () => 9000, idealEdgeLength: () => 70, componentSpacing: 120 },
      // при нескольких записях граф не раздувается во весь экран
      maxZoom: 1.4,
      minZoom: 0.2,
      wheelSensitivity: 0.3,
    });
    instance.on('tap', 'node', (event) => {
      const id = String(event.target.id());
      if (!id.startsWith('r')) return;
      setPicked(data.nodes.find((r) => `r${r.number}` === id) ?? null);
    });
    instance.on('dbltap', 'node', (event) => {
      const id = String(event.target.id());
      if (id.startsWith('r')) window.location.hash = `/r/${id.slice(1)}`;
    });
    if (center) instance.$(`#r${center}`).select();
    cy.current = instance;
    return () => instance.destroy();
  }, [data, core, acceptedOnly, center]);

  const counts = data ? { nodes: data.nodes.length, edges: data.edges.length } : null;
  return (
    <>
      <div className="head">
        <h1>{center ? `Граф вокруг № ${center}` : 'Граф связей'}</h1>
        {center ? (
          <a className="btn" href="#/graph">
            Весь граф
          </a>
        ) : null}
      </div>
      <div className="filters">
        <select value={core} onChange={(e) => setCore(e.target.value)}>
          <option value="">Все ядра</option>
          {CORES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
        {center ? (
          <select value={depth} onChange={(e) => (window.location.hash = `/graph${qs({ center, depth: e.target.value })}`)}>
            <option value="1">1 шаг</option>
            <option value="2">2 шага</option>
            <option value="3">3 шага</option>
          </select>
        ) : null}
        <label className="check">
          <input type="checkbox" checked={acceptedOnly} onChange={(e) => setAcceptedOnly(e.target.checked)} />
          только принятые и вопросы
        </label>
        <button className="btn" onClick={() => cy.current?.fit(undefined, 24)}>
          Вписать
        </button>
      </div>
      {error ? <div className="note bad">{error}</div> : null}
      <div className="graph-wrap">
        <div ref={box} className="graph" aria-label="Граф связей записей" />
        <aside className="card graph-side">
          {picked ? (
            <>
              <p className="lab">
                № {picked.number} · {picked.type === 'question' ? 'вопрос' : KIND[picked.kind ?? '']} · {picked.statusName}
              </p>
              <p>{picked.text}</p>
              {picked.type === 'conclusion' ? <p className="muted">{picked.trust}</p> : null}
              <div className="actions">
                <a className="btn" href={`#/r/${picked.number}`}>
                  Карточка
                </a>
                <a className="btn" href={`#/graph?center=${picked.number}&depth=2`}>
                  Граф вокруг
                </a>
              </div>
            </>
          ) : (
            <>
              <p className="lab">Как читать</p>
              <ul className="plain legend">
                <li><span className="dot" style={{ background: COLOR.fact }} /> факт</li>
                <li><span className="dot" style={{ background: COLOR.rule }} /> правило бюро</li>
                <li><span className="dot hyp" /> гипотеза</li>
                <li><span className="dot" style={{ background: COLOR.question }} /> вопрос</li>
                <li><span className="dot" style={{ background: COLOR.fact, boxShadow: '0 0 0 3px #d99100' }} /> проверить на текущей версии</li>
                <li>бледный — на модерации, ложная или заменена</li>
                <li>крупнее — чаще запрашивали агенты</li>
                <li><span className="line red" /> {LINK.contradicts}</li>
                <li><span className="line green" /> {LINK.answers}</li>
                <li><span className="line" /> {LINK.derived_from}, {LINK.replaces}</li>
              </ul>
              <p className="muted">Щелчок — запись; двойной щелчок — карточка.</p>
            </>
          )}
          {counts ? <p className="muted">Записей: {counts.nodes}, связей: {counts.edges}</p> : null}
        </aside>
      </div>
    </>
  );
}
