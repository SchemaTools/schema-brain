// Экран «Память» (решение 2026-11-06) — по визуализации RAG из личного хаба:
// облако записей по смыслу с поиском и переходом по связям, сфера вопроса, объём 3D.
// Слева — вопрос и найденное, в центре — вид, справа — запись целиком.
import { lazy, type FormEvent, Suspense, useEffect, useMemo, useState } from 'react';
import { api, KIND } from './api.ts';
import { CORE_COLOR, CORE_NAME } from './graph-elements.ts';
import { answerLinks, type MemoryAnswer, type MemoryData, type MemoryNode, radar, roleOf, scoreText } from './memory-view.ts';

const Memory3D = lazy(() => import('./Memory3D.tsx').then((m) => ({ default: m.Memory3D })));

type View = 'cloud' | 'radar' | 'volume';
const VIEWS: [View, string, string][] = [
  ['cloud', 'Облако', 'записи по смыслу'],
  ['radar', 'Сфера вопроса', 'взгляд из вопроса'],
  ['volume', 'Объём 3D', 'вращение мышью'],
];
const HINT: Record<View, string> = {
  cloud: 'Каждая точка — запись; близкие по смыслу лежат рядом. Цвет — ядро. Задайте вопрос: найденные по смыслу — в синей рамке, подтянутые по связям — в пунктирной.',
  radar: 'Вопрос — в центре. Чем ближе к центру, тем ближе по смыслу; круг — порог, внутри него — найденное. Направление — то же, что в облаке.',
  volume: 'То же облако в трёх измерениях: тяните мышью — вращение, колесо — ближе. Щелчок по точке — запись справа.',
};

export function MemoryPage() {
  const [data, setData] = useState<MemoryData | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<View>('cloud');
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<MemoryAnswer | null>(null);
  const [asking, setAsking] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    api<MemoryData>('GET', '/api/memory').then(setData, (e: Error) => setError(e.message));
  }, []);

  const byNumber = useMemo(() => new Map((data?.nodes ?? []).map((n) => [n.number, n])), [data]);
  const scoreOf = useMemo(() => new Map((answer?.scores ?? []).map((s) => [s.number, s.score])), [answer]);

  const ask = async (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return setAnswer(null);
    setAsking(true);
    try {
      const a = await api<MemoryAnswer>('GET', `/api/memory/query?q=${encodeURIComponent(q.trim())}`);
      setAnswer(a);
      setPicked(a.found[0] ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAsking(false);
    }
  };

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">Загрузка памяти…</p>;
  if (!data.vectors)
    return (
      <div className="card" style={{ margin: 24 }}>
        <h2>Память</h2>
        <p className="muted">Векторы смысла на сервере выключены — картинка строится по ним. Модель подключается при установке (deploy/README.md).</p>
      </div>
    );

  const pickedNode = picked !== null ? byNumber.get(picked) : undefined;
  const list = (numbers: number[]) =>
    numbers.map((n) => {
      const node = byNumber.get(n);
      if (!node) return null;
      return (
        <button key={n} className={`mrow${picked === n ? ' on' : ''}`} onClick={() => setPicked(n)} onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(null)}>
          <span className="dot" style={{ background: CORE_COLOR[node.core] }} />
          <span className="mnum">№ {n}</span>
          {scoreOf.has(n) ? <span className="mscore">{scoreText(scoreOf.get(n)!)}</span> : null}
          <span className="mtext">{node.text}</span>
        </button>
      );
    });

  return (
    <div className="graph-app memory-app">
      <aside className="gleft">
        <p className="lab">Вид</p>
        <div className="gmodes">
          {VIEWS.map(([v, label, small]) => (
            <button key={v} className={`gmode${view === v ? ' on' : ''}`} onClick={() => setView(v)}>
              {label} <small>{small}</small>
            </button>
          ))}
        </div>
        <p className="lab">Вопрос</p>
        <form className="mask" onSubmit={ask}>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="своими словами, как спросил бы агент" />
          <button className="btn pri" disabled={asking}>
            {asking ? '…' : 'Найти'}
          </button>
        </form>
        {answer ? (
          <>
            <p className="lab">Найдено по смыслу — {answer.found.length}</p>
            {answer.found.length ? list(answer.found) : <p className="muted small">Ничего не похоже настолько, чтобы считаться ответом (порог {scoreText(answer.minScore ?? 0)}).</p>}
            {answer.linked.length ? (
              <>
                <p className="lab">По связям — {answer.linked.length}</p>
                {list(answer.linked)}
              </>
            ) : null}
          </>
        ) : null}
        <p className="lab">Ядро — цвет</p>
        {Object.entries(CORE_NAME).map(([code, name]) => (
          <p key={code} className="check">
            <span className="dot" style={{ background: CORE_COLOR[code] }} /> {name} — {data.nodes.filter((n) => n.core === code).length}
          </p>
        ))}
        <p className="muted small">Записей в облаке: {data.nodes.length} · модель {data.vectors}</p>
      </aside>
      <section className="gcenter">
        {view === 'cloud' ? (
          <Cloud data={data} answer={answer} picked={picked} hover={hover} onPick={setPicked} onHover={setHover} />
        ) : view === 'radar' ? (
          answer ? (
            <Radar data={data} answer={answer} picked={picked} hover={hover} onPick={setPicked} onHover={setHover} />
          ) : (
            <p className="mempty">Задайте вопрос слева — сфера строится вокруг него.</p>
          )
        ) : (
          <Suspense fallback={<p className="mempty">Загрузка объёма…</p>}>
            <Memory3D data={data} answer={answer} onPick={setPicked} />
          </Suspense>
        )}
        {hover !== null && byNumber.get(hover) ? <div className="mtip">№ {hover} · {byNumber.get(hover)!.text}</div> : null}
        <div className="ghint">{HINT[view]}</div>
      </section>
      <aside className="gright">
        {pickedNode ? (
          <div className="mcard">
            <p className="meta">
              <span className="dot" style={{ background: CORE_COLOR[pickedNode.core] }} />
              <span>№ {pickedNode.number}</span>
              <span>{pickedNode.kind ? KIND[pickedNode.kind] : 'вопрос'}</span>
              <span>{pickedNode.coreName}</span>
              <span className={`status s-${pickedNode.status}`}>{pickedNode.statusName}</span>
            </p>
            <p className="mbig">{pickedNode.text}</p>
            <dl>
              {scoreOf.has(pickedNode.number) ? (
                <>
                  <dt>Близость к вопросу</dt>
                  <dd>
                    {scoreText(scoreOf.get(pickedNode.number)!)}
                    {roleOf(pickedNode.number, answer) === 'found' ? ' — найдена' : roleOf(pickedNode.number, answer) === 'linked' ? ' — по связи' : ''}
                  </dd>
                </>
              ) : null}
              {pickedNode.softwareVersion ? (
                <>
                  <dt>Версия</dt>
                  <dd>{pickedNode.softwareVersion}</dd>
                </>
              ) : null}
              {pickedNode.notApplicable ? (
                <>
                  <dt>Не применимо</dt>
                  <dd>{pickedNode.notApplicable}</dd>
                </>
              ) : null}
              <dt>Автор</dt>
              <dd>{pickedNode.author}</dd>
              {pickedNode.type === 'conclusion' ? (
                <>
                  <dt>Отметки</dt>
                  <dd>
                    ✓ {pickedNode.worked} · ✕ {pickedNode.failed}
                  </dd>
                </>
              ) : null}
            </dl>
            {data.links.filter((l) => l.from === pickedNode.number || l.to === pickedNode.number).length ? (
              <>
                <p className="lab">Связи</p>
                {data.links
                  .filter((l) => l.from === pickedNode.number || l.to === pickedNode.number)
                  .map((l) => {
                    const other = l.from === pickedNode.number ? l.to : l.from;
                    return (
                      <button key={`${l.from}-${l.to}-${l.type}`} className="mrow" onClick={() => setPicked(other)}>
                        <span className="mnum">{l.typeName}</span> № {other}
                      </button>
                    );
                  })}
              </>
            ) : null}
            <a className="btn" href={`#/r/${pickedNode.number}`}>
              Карточка записи
            </a>
          </div>
        ) : (
          <p className="muted">Щелчок по точке — запись здесь.</p>
        )}
      </aside>
    </div>
  );
}

interface ViewProps {
  data: MemoryData;
  answer: MemoryAnswer | null;
  picked: number | null;
  hover: number | null;
  onPick: (n: number) => void;
  onHover: (n: number | null) => void;
}

/** Точка записи: размер — найдена / выбрана, рамка — роль в ответе, бледная — фон при вопросе. */
function Dot({ n, x, y, role, active, picked, onPick, onHover }: { n: MemoryNode; x: number; y: number; role: string; active: boolean; picked: boolean; onPick: (n: number) => void; onHover: (n: number | null) => void }) {
  const pending = n.status === 'pending' || n.status === 'disputed';
  const r = role === 'found' ? 0.03 : role === 'linked' ? 0.025 : 0.018;
  return (
    <g className={`mdot ${role}${active ? '' : ' faded'}${picked ? ' picked' : ''}`} onClick={() => onPick(n.number)} onMouseEnter={() => onHover(n.number)} onMouseLeave={() => onHover(null)}>
      <circle cx={x} cy={y} r={r} fill={pending ? '#fff' : CORE_COLOR[n.core]} stroke={CORE_COLOR[n.core]} strokeWidth={pending ? 0.008 : 0} />
      {role !== 'rest' || picked ? <circle className="mring" cx={x} cy={y} r={r + 0.016} /> : null}
      {role === 'found' || picked ? (
        <text x={x + r + 0.02} y={y + 0.012} className="mlabel">
          {n.number}
        </text>
      ) : null}
    </g>
  );
}

function Cloud({ data, answer, picked, hover, onPick, onHover }: ViewProps) {
  // ось Y экрана — вниз, у облака — вверх
  const pos = (n: { x: number; y: number }) => ({ x: n.x, y: -n.y });
  const byNumber = new Map(data.nodes.map((n) => [n.number, n]));
  const roads = answerLinks(data.links, answer);
  const qp = answer?.point ? pos(answer.point) : null;
  const order = [...data.nodes].sort((a, b) => Number(roleOf(a.number, answer) !== 'rest') - Number(roleOf(b.number, answer) !== 'rest'));
  return (
    <svg className="mview" viewBox="-1.15 -1.15 2.3 2.3" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Облако записей по смыслу">
      {qp && answer
        ? answer.found.map((n) => {
            const t = byNumber.get(n);
            return t ? <line key={`q${n}`} className="mray" x1={qp.x} y1={qp.y} x2={pos(t).x} y2={pos(t).y} /> : null;
          })
        : null}
      {roads.map((l) => {
        const a = byNumber.get(l.from);
        const b = byNumber.get(l.to);
        return a && b ? <line key={`${l.from}-${l.to}-${l.type}`} className="mroad" x1={pos(a).x} y1={pos(a).y} x2={pos(b).x} y2={pos(b).y} /> : null;
      })}
      {order.map((n) => {
        const role = roleOf(n.number, answer);
        return (
          <Dot key={n.number} n={n} {...pos(n)} role={role} active={!answer || role !== 'rest' || hover === n.number} picked={picked === n.number} onPick={onPick} onHover={onHover} />
        );
      })}
      {qp ? (
        <g className="mquery">
          <circle cx={qp.x} cy={qp.y} r={0.035} />
          <text x={qp.x + 0.05} y={qp.y - 0.04}>
            вопрос
          </text>
        </g>
      ) : null}
    </svg>
  );
}

function Radar({ data, answer, picked, hover, onPick, onHover }: ViewProps & { answer: MemoryAnswer }) {
  const r = radar(data.nodes, answer);
  const byNumber = new Map(data.nodes.map((n) => [n.number, n]));
  const rings = [0.95, 0.9, 0.85].filter((s) => r.ring(s) < 1);
  return (
    <svg className="mview" viewBox="-1.15 -1.15 2.3 2.3" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Сфера вопроса">
      {rings.map((s) => (
        <g key={s}>
          <circle className="mgrid" cx={0} cy={0} r={r.ring(s)} />
          <text className="mgridt" x={0.01} y={-r.ring(s) - 0.01}>
            {scoreText(s)}
          </text>
        </g>
      ))}
      <circle className="mthreshold" cx={0} cy={0} r={r.threshold} />
      <text className="mgridt strong" x={r.threshold * 0.71 + 0.02} y={r.threshold * 0.71 + 0.05}>
        порог {scoreText(answer.minScore ?? 0)}
      </text>
      {r.points
        .slice()
        .reverse()
        .map((p) => {
          const n = byNumber.get(p.number);
          if (!n) return null;
          const role = roleOf(p.number, answer);
          return <Dot key={p.number} n={n} x={p.x} y={-p.y} role={role} active={role !== 'rest' || hover === p.number} picked={picked === p.number} onPick={onPick} onHover={onHover} />;
        })}
      <g className="mquery">
        <circle cx={0} cy={0} r={0.035} />
      </g>
    </svg>
  );
}
