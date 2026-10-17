// Экран «Граф» по согласованному макету (2026-10-16): слева режимы, поиск и фильтры;
// в центре граф (fcose, группы ядер без рамок, текст — при приближении, наведение — соседи);
// справа запись целиком, её связи и решение модератора. На телефоне — список «Проблемы».
import cytoscape, { type Core, type NodeSingular } from 'cytoscape';
import fcose from 'cytoscape-fcose';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, KIND, type Me, type RecordView } from './api.ts';
import {
  around,
  CORE_COLOR,
  CORE_NAME,
  defaultState,
  elements,
  type GraphData,
  type GraphState,
  type KindKey,
  type Mode,
  problems,
  type StateKey,
} from './graph-elements.ts';

cytoscape.use(fcose);

const LINK_FROM: Record<string, string> = {
  contradicts: 'противоречит',
  answers: 'отвечает на',
  derived_from: 'выведена из',
  replaces: 'заменяет',
  merged_into: 'объединена с',
};
const LINK_TO: Record<string, string> = {
  contradicts: 'противоречит',
  answers: 'есть ответ',
  derived_from: 'из неё выведена',
  replaces: 'заменена записью',
  merged_into: 'с ней объединена',
};

const STYLE: cytoscape.StylesheetJson = [
  {
    selector: 'node',
    style: {
      'background-color': 'data(color)',
      width: 'data(size)',
      height: 'data(size)',
      label: 'data(num)',
      'font-family': 'Inter Variable, Segoe UI, Arial, sans-serif',
      'font-size': 10,
      'text-valign': 'bottom',
      'text-margin-y': 4,
      color: '#1a1d21',
      'border-width': 2,
      'border-color': '#ffffff',
      'text-wrap': 'wrap',
      'text-max-width': '150px',
      'min-zoomed-font-size': 6,
    },
  },
  { selector: 'node.rule', style: { shape: 'round-rectangle' } },
  { selector: 'node.question', style: { shape: 'diamond', 'background-color': '#ffffff', 'border-color': 'data(color)', 'border-width': 3 } },
  { selector: 'node.hypothesis', style: { 'border-style': 'dashed', 'border-color': 'data(color)', 'border-width': 3, 'background-opacity': 0.35 } },
  { selector: 'node.pending', style: { 'background-color': '#ffffff', 'border-color': 'data(color)', 'border-width': 3, 'border-style': 'dotted' } },
  { selector: 'node.check', style: { 'outline-width': 3, 'outline-color': '#d99100', 'outline-offset': 2 } },
  { selector: 'node.faded', style: { opacity: 0.3 } },
  { selector: 'node.context', style: { opacity: 0.45 } },
  { selector: 'node.center', style: { 'outline-width': 4, 'outline-color': '#1b3fd1', 'outline-offset': 3 } },
  { selector: 'node.big', style: { label: 'data(full)' } },
  {
    selector: 'node.core',
    style: {
      'background-opacity': 0,
      'border-width': 0,
      label: 'data(label)',
      'text-valign': 'top',
      'font-size': 13,
      'font-weight': 600,
      color: '#8a9096',
      padding: '22px',
      shape: 'round-rectangle',
    },
  },
  { selector: 'node:selected', style: { 'outline-width': 4, 'outline-color': '#1b3fd1', 'outline-offset': 3 } },
  { selector: '.dim', style: { opacity: 0.12 } },
  {
    selector: 'edge',
    style: {
      width: 1.5,
      'line-color': '#8a9096',
      'target-arrow-color': '#8a9096',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier',
      'arrow-scale': 0.9,
    },
  },
  { selector: 'edge.contradicts', style: { 'line-color': '#d32f2f', 'line-style': 'dashed', 'target-arrow-shape': 'none', width: 2.5 } },
  { selector: 'edge.answers', style: { 'line-color': '#0e7c63', 'target-arrow-color': '#0e7c63', width: 2 } },
  { selector: 'edge.replaces', style: { 'line-style': 'dotted' } },
  { selector: 'edge.merged_into', style: { 'line-color': '#c9ced2', 'target-arrow-color': '#c9ced2' } },
  {
    selector: 'edge.hl',
    style: {
      label: 'data(label)',
      'font-size': 10,
      'text-background-color': '#ffffff',
      'text-background-opacity': 1,
      'text-background-padding': '2px',
      color: '#5f6469',
    },
  },
];

const VERDICT = {
  accept: { label: 'Верно', cls: 'ok' },
  reject: { label: 'Ложное', cls: 'bad' },
  hypothesis: { label: 'Спорное → гипотеза', cls: 'warn' },
} as const;

function useNarrow() {
  const query = '(max-width: 800px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

// --- панель записи --------------------------------------------------------

function RecordPanel({
  r,
  data,
  me,
  onPick,
  onAround,
  onDecided,
}: {
  r: RecordView;
  data: GraphData;
  me: Me;
  onPick: (n: number) => void;
  onAround: (n: number) => void;
  onDecided: () => void;
}) {
  const [error, setError] = useState('');
  const byNumber = useMemo(() => new Map(data.nodes.map((x) => [x.number, x])), [data]);
  const links = data.edges
    .filter((e) => e.from === r.number || e.to === r.number)
    .map((e) => ({ type: e.type, outgoing: e.from === r.number, other: byNumber.get(e.from === r.number ? e.to : e.from) }))
    .filter((l): l is { type: string; outgoing: boolean; other: RecordView } => !!l.other);
  const waiting = r.status === 'pending' || r.status === 'disputed';
  const decide = async (decision: keyof typeof VERDICT) => {
    setError('');
    try {
      await api('POST', `/api/records/${r.number}/moderate`, { decision });
      window.dispatchEvent(new Event('queue-changed'));
      onDecided();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <p className="lab">Запись</p>
      <div className="meta">
        <span className="badge" style={{ borderColor: CORE_COLOR[r.core], color: CORE_COLOR[r.core] }}>
          {r.type === 'question' ? 'вопрос' : KIND[r.kind ?? '']}
        </span>
        <span>{r.coreName}</span>
        {r.project ? <span>проект {r.project}</span> : null}
        <span className={`status s-${r.status}`}>{r.statusName}</span>
        {r.needsCheck ? <span className="status s-check">проверить</span> : null}
      </div>
      <p className="big">
        <b>№ {r.number}.</b> {r.text}
      </p>
      <dl>
        {r.type === 'conclusion' ? (
          <>
            <dt>Отметки</dt>
            <dd>{r.trust}</dd>
          </>
        ) : null}
        <dt>Запрашивали</dt>
        <dd>{r.requestsCount}</dd>
        <dt>Автор</dt>
        <dd>{r.author}</dd>
      </dl>
      {waiting && me.scopes.includes('moderate') ? (
        <>
          <p className="lab">Решение модератора</p>
          <div className="actions">
            {(Object.keys(VERDICT) as (keyof typeof VERDICT)[]).map((v) => (
              <button key={v} className={`btn ${VERDICT[v].cls}`} onClick={() => void decide(v)}>
                {VERDICT[v].label}
              </button>
            ))}
          </div>
        </>
      ) : null}
      {error ? <div className="note bad">{error}</div> : null}
      <div className="actions">
        <button className="btn" onClick={() => onAround(r.number)}>
          Граф вокруг
        </button>
        <a className="btn" href={`#/r/${r.number}`}>
          Карточка
        </a>
      </div>
      <p className="lab">Связи ({links.length})</p>
      {links.length ? (
        links.map((l) => (
          <button key={`${l.type}-${l.other.number}`} className={`gnb ${l.type}`} onClick={() => onPick(l.other.number)}>
            <b>{(l.outgoing ? LINK_FROM : LINK_TO)[l.type] ?? l.type}</b> № {l.other.number} · {l.other.text}
          </button>
        ))
      ) : (
        <p className="muted">Связей нет — запись стоит особняком.</p>
      )}
    </>
  );
}

// --- телефон: список «Проблемы» -------------------------------------------

function ProblemsList({ data }: { data: GraphData }) {
  const p = problems(data);
  const byNumber = new Map(data.nodes.map((r) => [r.number, r]));
  const list = [...p.entries()]
    .map(([n, reasons]) => ({ r: byNumber.get(n)!, reasons }))
    .filter((x) => x.r)
    .sort((a, b) => b.r.requestsCount - a.r.requestsCount || a.r.number - b.r.number);
  return (
    <div className="gmobile">
      <div className="head">
        <h1>Проблемы · {list.length}</h1>
      </div>
      <p className="muted">На телефоне вместо графа — что ждёт решения. Граф — на большом экране.</p>
      <div className="list">
        {list.map(({ r, reasons }) => (
          <a key={r.number} className="row" href={`#/r/${r.number}`}>
            <span className="num">№ {r.number}</span>
            <span className="body">
              <span className="meta">
                {reasons.map((x) => (
                  <span key={x} className="status s-disputed">
                    {x}
                  </span>
                ))}
                <span>{r.coreName}</span>
              </span>
              <span className="text">{r.text}</span>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

// --- экран ------------------------------------------------------------------

const KINDS: [KindKey, string][] = [
  ['rule', 'правило бюро'],
  ['fact', 'факт'],
  ['hypothesis', 'гипотеза'],
  ['question', 'вопрос'],
];
const STATES: [StateKey, string][] = [
  ['accepted', 'принята'],
  ['pending', 'на модерации — пустой'],
  ['check', 'проверить — жёлтое кольцо'],
  ['false', 'ложная — бледная'],
  ['replaced', 'заменена, отклонена — бледная'],
];
const LINKS: [string, string, string][] = [
  ['contradicts', 'противоречит', 'red'],
  ['answers', 'отвечает на вопрос', 'green'],
  ['derived_from', 'выведена из', ''],
  ['replaces', 'заменяет', 'dot'],
];

export function GraphPage({ params, me }: { params: URLSearchParams; me: Me }) {
  const narrow = useNarrow();
  const box = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);
  const [data, setData] = useState<GraphData>();
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [s, setS] = useState<GraphState>(() => {
    const st = defaultState();
    const center = Number(params.get('center'));
    if (center) {
      st.mode = 'around';
      st.center = center;
      st.depth = Number(params.get('depth') ?? 2) || 2;
    }
    return st;
  });
  const [picked, setPicked] = useState<number | null>(s.center);
  const [q, setQ] = useState('');
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);

  useEffect(() => {
    api<GraphData>('GET', '/api/graph').then(setData, (e: Error) => setError(e.message));
  }, [tick]);

  const problemCount = useMemo(() => (data ? problems(data).size : 0), [data]);
  const byNumber = useMemo(() => new Map((data?.nodes ?? []).map((r) => [r.number, r])), [data]);

  useEffect(() => {
    if (narrow || !box.current || !data) return;
    const instance = cytoscape({
      container: box.current,
      elements: elements(data, s).map((e) =>
        e.data.type ? { ...e, data: { ...e.data, label: LINK_FROM[String(e.data.type)] } } : e,
      ),
      style: STYLE,
      minZoom: 0.2,
      maxZoom: 2.5,
      wheelSensitivity: 0.3,
    });
    const labels = () => instance.nodes(':childless').toggleClass('big', instance.zoom() > 1.05);
    const layout = instance.layout(
      s.mode === 'around' && s.center !== null
        ? {
            name: 'concentric',
            concentric: (n: NodeSingular) => 10 - (around(data.edges, s.center!, s.depth, s.links).get(Number(n.id().slice(1))) ?? 9),
            levelWidth: () => 1,
            minNodeSpacing: 40,
            animate: false,
            padding: 40,
          }
        : ({
            name: 'fcose',
            quality: 'proof',
            animate: false,
            padding: 30,
            nodeRepulsion: () => 6500,
            idealEdgeLength: () => 70,
            nestingFactor: 0.4,
            gravity: 0.4,
            gravityCompound: 1.2,
            packComponents: true,
            nodeSeparation: 60,
            randomize: true,
          } as cytoscape.LayoutOptions),
    );
    layout.one('layoutstop', () => {
      instance.fit(undefined, 30);
      // при нескольких записях граф не раздувается во весь экран
      if (instance.zoom() > 1.3) instance.zoom({ level: 1.3, renderedPosition: { x: instance.width() / 2, y: instance.height() / 2 } });
      labels();
      if (picked !== null) instance.$(`#r${picked}`).select();
    });
    layout.run();
    instance.on('zoom', labels);
    instance.on('mouseover', 'node:childless', (event) => {
      const n = event.target as NodeSingular;
      const r = byNumber.get(Number(n.id().slice(1)));
      instance.elements().addClass('dim');
      n.closedNeighborhood().removeClass('dim');
      n.closedNeighborhood().parents().removeClass('dim');
      n.connectedEdges().addClass('hl');
      if (r) setTip({ x: event.renderedPosition.x, y: event.renderedPosition.y, text: `№ ${r.number} · ${r.statusName}\n${r.text}` });
    });
    instance.on('mouseout', 'node:childless', () => {
      instance.elements().removeClass('dim');
      instance.edges().removeClass('hl');
      setTip(null);
    });
    instance.on('tap', 'node:childless', (event) => setPicked(Number(event.target.id().slice(1))));
    instance.on('dbltap', 'node:childless', (event) => setS((x) => ({ ...x, mode: 'around', center: Number(event.target.id().slice(1)) })));
    cy.current = instance;
    // окно или панель поменяли ширину — полотно графа подстраивается
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(box.current);
    return () => {
      observer.disconnect();
      instance.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, s, narrow]);

  // выбранная запись — подсветить без перерисовки
  useEffect(() => {
    const c = cy.current;
    if (!c || picked === null) return;
    c.$(':selected').unselect();
    c.$(`#r${picked}`).select();
  }, [picked]);

  // поиск: найденные подсвечиваются, граф приближается к ним
  useEffect(() => {
    const c = cy.current;
    if (!c) return;
    c.nodes().removeClass('dim');
    const term = q.trim().toLowerCase().replace('№', '').trim();
    if (!term) return;
    const hit = c.nodes(':childless').filter((n) => {
      const r = byNumber.get(Number(n.id().slice(1)));
      return !!r && (String(r.number) === term || r.text.toLowerCase().includes(term));
    });
    if (hit.length) {
      c.nodes(':childless').not(hit).addClass('dim');
      c.animate({ fit: { eles: hit, padding: 80 } }, { duration: 250 });
    }
  }, [q, byNumber]);

  if (error) return <div className="note bad">{error}</div>;
  if (!data) return <p className="muted">Загрузка графа…</p>;
  if (narrow) return <ProblemsList data={data} />;

  const setMode = (mode: Mode) => setS((x) => ({ ...x, mode }));
  const toggle = <K,>(key: 'cores' | 'kinds' | 'states' | 'links', value: K) =>
    setS((x) => {
      const next = new Set(x[key] as Set<K>);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...x, [key]: next };
    });
  const pickedRecord = picked !== null ? byNumber.get(picked) : undefined;
  const hint = {
    problems: 'Что ждёт решения: противоречия, вопросы без ответа, ложные, «проверить», на модерации. Бледные — соседи для контекста.',
    overview: 'Вся база по ядрам. Приблизьте колесом — появится текст записей.',
    around: s.center !== null ? `Вокруг № ${s.center}: по кругам — 1 шаг, 2 шага…` : 'Выберите запись: двойной щелчок по узлу или «Граф вокруг».',
  }[s.mode];

  return (
    <div className="graph-app">
      <aside className="gleft">
        <p className="lab">Режим</p>
        <div className="gmodes">
          <button className={`gmode${s.mode === 'problems' ? ' on' : ''}`} onClick={() => setMode('problems')}>
            Проблемы {problemCount ? <span className="gcnt">{problemCount}</span> : null}
          </button>
          <button className={`gmode${s.mode === 'overview' ? ' on' : ''}`} onClick={() => setMode('overview')}>
            Обзор <small>вся база</small>
          </button>
          <button className={`gmode${s.mode === 'around' ? ' on' : ''}`} onClick={() => setMode('around')}>
            Вокруг записи <small>{s.center !== null ? `№ ${s.center}` : 'выберите узел'}</small>
          </button>
        </div>
        <p className="lab">Поиск</p>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="слова или № записи" />
        <p className="lab">Ядро — цвет</p>
        {Object.entries(CORE_NAME).map(([code, name]) => (
          <label key={code} className="check">
            <input type="checkbox" checked={s.cores.has(code)} onChange={() => toggle('cores', code)} />
            <span className="dot" style={{ background: CORE_COLOR[code] }} /> {name}
          </label>
        ))}
        <p className="lab">Вид — форма</p>
        {KINDS.map(([k, label]) => (
          <label key={k} className="check">
            <input type="checkbox" checked={s.kinds.has(k)} onChange={() => toggle('kinds', k)} />
            <span className={`gshape ${k}`} /> {label}
          </label>
        ))}
        <p className="lab">Состояние</p>
        {STATES.map(([k, label]) => (
          <label key={k} className="check">
            <input type="checkbox" checked={s.states.has(k)} onChange={() => toggle('states', k)} /> {label}
          </label>
        ))}
        <p className="lab">Связи</p>
        {LINKS.map(([k, label, cls]) => (
          <label key={k} className="check">
            <input type="checkbox" checked={s.links.has(k)} onChange={() => toggle('links', k)} />
            <span className={`line ${cls}`} /> {label}
          </label>
        ))}
      </aside>
      <section className="gcenter">
        <div ref={box} className="graph" aria-label="Граф связей записей" />
        {tip ? (
          <div className="gtip" style={{ left: Math.min(tip.x + 16, (box.current?.clientWidth ?? 600) - 330), top: tip.y + 16 }}>
            {tip.text}
          </div>
        ) : null}
        {s.mode === 'around' && s.center !== null ? (
          <div className="gdepth">
            Шагов от записи:
            {[1, 2, 3].map((d) => (
              <button key={d} className={`btn${s.depth === d ? ' pri' : ''}`} onClick={() => setS((x) => ({ ...x, depth: d }))}>
                {d}
              </button>
            ))}
          </div>
        ) : null}
        <div className="ghint">
          {hint}
          <br />
          <span className="muted">Наведение — соседи и текст · щелчок — запись справа · двойной щелчок — граф вокруг</span>
        </div>
        <div className="gtools">
          <button className="btn" onClick={() => cy.current?.zoom({ level: cy.current.zoom() * 1.3, renderedPosition: { x: cy.current.width() / 2, y: cy.current.height() / 2 } })}>
            +
          </button>
          <button className="btn" onClick={() => cy.current?.zoom({ level: cy.current.zoom() / 1.3, renderedPosition: { x: cy.current.width() / 2, y: cy.current.height() / 2 } })}>
            −
          </button>
          <button className="btn" onClick={() => cy.current?.fit(undefined, 30)}>
            Вписать
          </button>
        </div>
      </section>
      <aside className="gright">
        {pickedRecord ? (
          <RecordPanel
            r={pickedRecord}
            data={data}
            me={me}
            onPick={setPicked}
            onAround={(n) => setS((x) => ({ ...x, mode: 'around', center: n }))}
            onDecided={() => setTick((t) => t + 1)}
          />
        ) : (
          <>
            <p className="lab">Запись</p>
            <p className="muted">
              Щёлкните по узлу — здесь появится запись целиком, её связи и, если она ждёт модерации, кнопки «Верно / Ложное / Спорное».
            </p>
            <p className="muted">
              Записей: {data.nodes.length}, связей: {data.edges.length}
            </p>
          </>
        )}
      </aside>
    </div>
  );
}
