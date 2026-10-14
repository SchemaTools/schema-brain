// Веб Schema Brain (docs/spec.md, раздел 11): вход по токену, записи, карточка, новая запись,
// вопросы, очередь модерации, настройки. Адреса — через # (#/r/12), без библиотеки маршрутов.
import { type FormEvent, lazy, type ReactNode, Suspense, useCallback, useEffect, useState } from 'react';
import { api, ApiError, CORES, EVENT, KIND, LINK, type Me, qs, type RecordView } from './api.ts';
// граф — отдельным файлом: библиотека графов грузится, только когда граф открывают
const GraphPage = lazy(() => import('./Graph.tsx').then((m) => ({ default: m.GraphPage })));

// --- маршрут ---------------------------------------------------------------

function useRoute(): [string, URLSearchParams] {
  const read = () => {
    const [path, query] = (window.location.hash.slice(1) || '/').split('?');
    return [path || '/', new URLSearchParams(query ?? '')] as [string, URLSearchParams];
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

const go = (path: string) => {
  window.location.hash = path;
};

function useLoad<T>(load: () => Promise<T>, deps: unknown[]): { data?: T; error?: string; reload: () => void } {
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    load().then(
      (data) => alive && setState({ data }),
      (error: Error) => alive && setState({ error: error.message }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: useCallback(() => setTick((t) => t + 1), []) };
}

// --- общее -----------------------------------------------------------------

function Errors({ error }: { error?: unknown }) {
  if (!error) return null;
  const e = error instanceof ApiError ? error : null;
  return (
    <div className="note bad" role="alert">
      {error instanceof Error ? error.message : String(error)}
      {e?.details.length ? (
        <ul>
          {e.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Badge({ r }: { r: RecordView }) {
  const label = r.type === 'question' ? 'вопрос' : KIND[r.kind ?? ''];
  return <span className={`badge ${r.type === 'question' ? 'question' : r.kind}`}>{label}</span>;
}

function Trust({ r }: { r: RecordView }) {
  if (r.type !== 'conclusion') return null;
  const bad = r.trust.startsWith('ложная');
  return <span className={`trust${bad ? ' bad' : ''}`}>{r.trust}</span>;
}

function Row({ r }: { r: RecordView }) {
  return (
    <a className="row" href={`#/r/${r.number}`}>
      <span className="num">№ {r.number}</span>
      <span className="body">
        <span className="meta">
          <Badge r={r} />
          <span>{r.coreName}</span>
          {r.project ? <span>проект {r.project}</span> : null}
          <span className={`status s-${r.status}`}>{r.statusName}</span>
          <Trust r={r} />
          {r.needsCheck ? <span className="status s-check">проверить</span> : null}
          {r.type === 'question' && r.askedCount ? <span>спросили ещё {r.askedCount}</span> : null}
        </span>
        <span className="text">{r.text}</span>
      </span>
    </a>
  );
}

// --- вход ------------------------------------------------------------------

function Login({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState<unknown>();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('POST', '/api/session', { token: token.trim() });
      onDone();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <main className="login">
      <form onSubmit={submit} className="card">
        <h1>Schema Brain</h1>
        <p className="muted">Общая память ИИ-агентов бюро. Вход — по личному токену, его выдаёт модератор.</p>
        <label>
          Токен доступа
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="sbt_…" autoFocus />
        </label>
        <Errors error={error} />
        <button className="btn pri" disabled={!token.trim()}>
          Войти
        </button>
      </form>
    </main>
  );
}

// --- записи ----------------------------------------------------------------

function Records({ params }: { params: URLSearchParams }) {
  const [q, setQ] = useState(params.get('q') ?? '');
  const filters = {
    q: params.get('q') ?? '',
    core: params.get('core') ?? '',
    type: params.get('type') ?? '',
    status: params.get('status') ?? '',
    needs_check: params.get('needs_check') === 'true',
    page: Number(params.get('page') ?? 1),
  };
  const set = (patch: Partial<typeof filters>) => {
    const next = { ...filters, page: 1, ...patch };
    go(`/${qs(next)}`);
  };
  const { data, error } = useLoad(
    () => api<{ total: number; page: number; records: RecordView[] }>('GET', `/api/records${qs({ ...filters, pageSize: 50 })}`),
    [params.toString()],
  );
  return (
    <>
      <div className="head">
        <h1>Записи</h1>
        <a className="btn pri" href="#/new">
          Новая запись
        </a>
      </div>
      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q });
        }}
      >
        <input className="grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск: слова из записи" />
        <select value={filters.core} onChange={(e) => set({ core: e.target.value })}>
          <option value="">Все ядра</option>
          {CORES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
        <select value={filters.type} onChange={(e) => set({ type: e.target.value })}>
          <option value="">Выводы и вопросы</option>
          <option value="conclusion">Выводы</option>
          <option value="question">Вопросы</option>
        </select>
        <select value={filters.status} onChange={(e) => set({ status: e.target.value })}>
          <option value="">Любое состояние</option>
          <option value="accepted">принята</option>
          <option value="pending">на модерации</option>
          <option value="disputed">противоречие</option>
          <option value="rejected">отклонена</option>
          <option value="open">вопрос открыт</option>
          <option value="answered">есть ответ</option>
        </select>
        <label className="check">
          <input type="checkbox" checked={filters.needs_check} onChange={(e) => set({ needs_check: e.target.checked })} />
          проверить
        </label>
        <button className="btn">Найти</button>
      </form>
      <Errors error={error} />
      {data ? (
        <>
          <p className="lab">Найдено: {data.total}</p>
          <div className="list">
            {data.records.map((r) => (
              <Row key={r.number} r={r} />
            ))}
          </div>
          {data.total > data.page * 50 ? (
            <button className="btn" onClick={() => set({ page: data.page + 1 })}>
              Дальше
            </button>
          ) : null}
        </>
      ) : null}
    </>
  );
}

// --- карточка --------------------------------------------------------------

interface Card {
  record: RecordView;
  links: { id: string; type: string; from: number; to: number }[];
  history: { kind: string; client: string; who: string; data: Record<string, unknown>; created: string }[];
}

function CardPage({ number, me }: { number: number; me: Me }) {
  const { data, error, reload } = useLoad(() => api<Card>('GET', `/api/records/${number}?history=true`), [number]);
  const [action, setAction] = useState<unknown>();
  const [target, setTarget] = useState('');
  const [comment, setComment] = useState('');
  const [edit, setEdit] = useState<Partial<RecordView> | null>(null);
  const moderator = me.scopes.includes('moderate');
  if (error) return <Errors error={error} />;
  if (!data) return <p className="muted">Загрузка…</p>;
  const r = data.record;
  const run = async (fn: () => Promise<unknown>) => {
    setAction(undefined);
    try {
      await fn();
      setEdit(null);
      reload();
    } catch (err) {
      setAction(err);
    }
  };
  const decide = (decision: string) =>
    run(() => api('POST', `/api/records/${number}/moderate`, { decision, target: target || undefined, comment: comment || undefined }));
  const waiting = r.status === 'pending' || r.status === 'disputed';
  return (
    <>
      <div className="head">
        <h1>№ {r.number}</h1>
        <a className="btn" href="#/">
          К списку
        </a>
      </div>
      <section className="card">
        <div className="meta">
          <Badge r={r} />
          <span>{r.coreName}</span>
          {r.project ? <span>проект {r.project}</span> : null}
          <span className={`status s-${r.status}`}>{r.statusName}</span>
          <Trust r={r} />
          {r.needsCheck ? <span className="status s-check">проверить на текущей версии</span> : null}
        </div>
        {edit ? (
          <div className="form">
            <label>
              Текст <span className="muted">({[...(edit.text ?? '')].length} / 300)</span>
              <textarea rows={4} value={edit.text ?? ''} onChange={(e) => setEdit({ ...edit, text: e.target.value })} />
            </label>
            <label>
              Версия ПО или нормы
              <input value={edit.softwareVersion ?? ''} onChange={(e) => setEdit({ ...edit, softwareVersion: e.target.value })} />
            </label>
            <label>
              Когда не применимо
              <input value={edit.notApplicable ?? ''} onChange={(e) => setEdit({ ...edit, notApplicable: e.target.value })} />
            </label>
            <div className="actions">
              <button
                className="btn pri"
                onClick={() =>
                  run(() =>
                    api('PATCH', `/api/records/${number}`, {
                      version: r.version,
                      text: edit.text,
                      software_version: edit.softwareVersion ?? '',
                      not_applicable: edit.notApplicable ?? '',
                    }),
                  )
                }
              >
                Сохранить
              </button>
              <button className="btn" onClick={() => setEdit(null)}>
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <p className="big">{r.text}</p>
        )}
        <dl>
          {r.softwareVersion ? (
            <>
              <dt>Версия</dt>
              <dd>{r.softwareVersion}</dd>
            </>
          ) : null}
          {r.notApplicable ? (
            <>
              <dt>Не применимо</dt>
              <dd>{r.notApplicable}</dd>
            </>
          ) : null}
          <dt>Источник</dt>
          <dd>{r.source}</dd>
          <dt>Автор</dt>
          <dd>{r.author}</dd>
          <dt>Запрашивали агенты</dt>
          <dd>{r.requestsCount}</dd>
        </dl>
        {data.links.length ? (
          <>
            <p className="lab">
              Связи · <a href={`#/graph?center=${r.number}&depth=2`}>на графе</a>
            </p>
            <ul className="plain">
              {data.links.map((l) => (
                <li key={l.id}>
                  <a href={`#/r/${l.from}`}>№ {l.from}</a> {LINK[l.type]} <a href={`#/r/${l.to}`}>№ {l.to}</a>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {r.type === 'question' && r.status !== 'closed' ? (
          <a className="btn" href={`#/new?answers=${r.number}`}>
            Ответить выводом
          </a>
        ) : null}
      </section>

      {r.type === 'conclusion' && r.status === 'accepted' && me.scopes.includes('feedback') ? (
        <section className="card">
          <p className="lab">Применяли эту запись?</p>
          <div className="actions">
            <button className="btn" onClick={() => run(() => api('POST', `/api/records/${number}/feedback`, { worked: true }))}>
              Сработало
            </button>
            <button className="btn" onClick={() => run(() => api('POST', `/api/records/${number}/feedback`, { worked: false }))}>
              Не сработало
            </button>
          </div>
        </section>
      ) : null}

      {moderator ? (
        <section className="card">
          <p className="lab">Модерация</p>
          <div className="form row2">
            <label>
              Номер другой записи — для «объединить» и «заменить»
              <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="например 128" />
            </label>
            <label>
              Комментарий
              <input value={comment} onChange={(e) => setComment(e.target.value)} />
            </label>
          </div>
          <div className="actions">
            {r.type === 'conclusion' && waiting ? (
              <>
                <button className="btn pri" onClick={() => decide('accept')}>
                  Принять
                </button>
                <button className="btn" onClick={() => decide('reject')}>
                  Отклонить
                </button>
                <button className="btn" onClick={() => decide('merge')} disabled={!target}>
                  Объединить с №
                </button>
                {r.kind === 'rule' ? (
                  <button className="btn" onClick={() => decide('replace')} disabled={!target}>
                    Заменить правило №
                  </button>
                ) : null}
              </>
            ) : null}
            {r.type === 'question' && (r.status === 'open' || r.status === 'answered') ? (
              <>
                <button className="btn" onClick={() => decide('close')}>
                  Закрыть вопрос
                </button>
                <button className="btn" onClick={() => decide('reject')}>
                  Отклонить
                </button>
              </>
            ) : null}
            {r.status === 'rejected' || r.status === 'closed' ? (
              <button className="btn" onClick={() => decide('reopen')}>
                Вернуть
              </button>
            ) : null}
            {!edit ? (
              <button className="btn" onClick={() => setEdit({ text: r.text, softwareVersion: r.softwareVersion, notApplicable: r.notApplicable })}>
                Править
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
      <Errors error={action} />

      {data.history.length ? (
        <section className="card">
          <p className="lab">История</p>
          <ul className="plain history">
            {data.history.map((h, i) => (
              <li key={i}>
                <span className="muted">{new Date(h.created).toLocaleString('ru-RU')}</span> {EVENT[h.kind] ?? h.kind}
                {h.who ? ` · ${h.who}` : ''} · {h.client}
                {typeof h.data.comment === 'string' && h.data.comment ? ` — ${h.data.comment}` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

// --- новая запись ----------------------------------------------------------

function NewRecord({ params }: { params: URLSearchParams }) {
  const answers = params.get('answers');
  const [form, setForm] = useState({
    type: 'вывод',
    kind: 'факт',
    core: 'BIM и Revit',
    project: '',
    software_version: '',
    not_applicable: '',
    text: '',
  });
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<unknown>();
  const [similar, setSimilar] = useState<RecordView[]>([]);
  const length = [...form.text].length;
  useEffect(() => {
    if (form.text.trim().length < 12) return setSimilar([]);
    const timer = setTimeout(() => {
      const words = form.text.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4).slice(0, 6).join(' ');
      if (!words) return;
      api<{ records: RecordView[] }>('GET', `/api/records${qs({ q: words, pageSize: 5 })}`).then(
        (d) => setSimilar(d.records),
        () => setSimilar([]),
      );
    }, 500);
    return () => clearTimeout(timer);
  }, [form.text]);
  const field = (name: keyof typeof form) => ({
    value: form[name],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [name]: e.target.value }),
  });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    try {
      const result = await api<{ record: RecordView }>('POST', '/api/records', {
        ...form,
        kind: form.type === 'вопрос' ? '' : form.kind,
        source: `веб-форма, ${new Date().toLocaleDateString('sv-SE')}`,
        confirmed_by_author: confirmed,
        answers: answers ? [Number(answers)] : undefined,
      });
      go(`/r/${result.record.number}`);
    } catch (err) {
      setError(err);
    }
  };
  return (
    <>
      <div className="head">
        <h1>{answers ? `Ответ на вопрос № ${answers}` : 'Новая запись'}</h1>
      </div>
      <form className="card form" onSubmit={submit}>
        <div className="row2">
          {!answers ? (
            <label>
              Тип
              <select {...field('type')}>
                <option>вывод</option>
                <option>вопрос</option>
              </select>
            </label>
          ) : null}
          {form.type === 'вывод' ? (
            <label>
              Вид
              <select {...field('kind')}>
                <option value="факт">факт — проверено в работе</option>
                <option value="правило">правило бюро — так у нас принято</option>
                <option value="гипотеза">гипотеза — проверено один раз</option>
              </select>
            </label>
          ) : null}
          <label>
            Ядро
            <select {...field('core')}>
              {CORES.map((c) => (
                <option key={c.code}>{c.name}</option>
              ))}
            </select>
          </label>
          <label>
            Проект (код объекта, если только про него)
            <input {...field('project')} />
          </label>
        </div>
        <label>
          Текст <span className={length > 300 ? 'bad-text' : 'muted'}>({length} / 300)</span>
          <textarea rows={4} {...field('text')} placeholder="Одна-три фразы: условие → что происходит → что делать. Без имён, путей и адресов." />
        </label>
        {form.type === 'вывод' ? (
          <div className="row2">
            <label>
              Версия ПО или нормы
              <input {...field('software_version')} placeholder="Revit 2026, СП 70.13330.2012" />
            </label>
            <label>
              Когда не применимо
              <input {...field('not_applicable')} />
            </label>
          </div>
        ) : null}
        {similar.length ? (
          <div className="note">
            <p className="lab">Похожие записи — может, это уже есть?</p>
            {similar.map((r) => (
              <Row key={r.number} r={r} />
            ))}
          </div>
        ) : null}
        <label className="check">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          Подтверждаю: запись проверена мной, в ней нет личного
        </label>
        <Errors error={error} />
        <div className="actions">
          <button className="btn pri" disabled={!confirmed || !form.text.trim()}>
            Отправить
          </button>
        </div>
      </form>
    </>
  );
}

// --- вопросы и очередь -----------------------------------------------------

function Questions() {
  const { data, error } = useLoad(() => api<{ records: RecordView[] }>('GET', '/api/records?type=question&status=open'), []);
  const list = [...(data?.records ?? [])].sort((a, b) => b.askedCount - a.askedCount || a.number - b.number);
  return (
    <>
      <div className="head">
        <h1>Открытые вопросы</h1>
      </div>
      <p className="muted">Агенты не нашли ответа в базе. Сверху — те, что спрашивали чаще.</p>
      <Errors error={error} />
      <div className="list">{data ? (list.length ? list.map((r) => <Row key={r.number} r={r} />) : <p className="muted">Открытых вопросов нет.</p>) : null}</div>
    </>
  );
}

function Queue() {
  const { data, error } = useLoad(() => api<{ records: RecordView[] }>('GET', '/api/queue'), []);
  return (
    <>
      <div className="head">
        <h1>Очередь модерации</h1>
      </div>
      <p className="muted">Сначала противоречия, затем записи, которые уже запрашивали агенты, затем остальные.</p>
      <Errors error={error} />
      <div className="list">{data ? (data.records.length ? data.records.map((r) => <Row key={r.number} r={r} />) : <p className="muted">Очередь пуста.</p>) : null}</div>
    </>
  );
}

// --- настройки -------------------------------------------------------------

interface Person {
  id: string;
  label: string;
  active: boolean;
  tokens: { id: string; client: string; scopes: string[]; hint: string; note: string; lastUsed: string | null }[];
}

function Settings() {
  const software = useLoad(() => api<{ product: string; version: string; changed: string }[]>('GET', '/api/software'), []);
  const persons = useLoad(() => api<Person[]>('GET', '/api/persons'), []);
  const [sw, setSw] = useState({ product: '', version: '' });
  const [label, setLabel] = useState('');
  const [issued, setIssued] = useState<{ label: string; token: string } | null>(null);
  const [error, setError] = useState<unknown>();
  const [info, setInfo] = useState('');
  const run = async (fn: () => Promise<unknown>, after: () => void) => {
    setError(undefined);
    setInfo('');
    try {
      await fn();
      after();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <>
      <div className="head">
        <h1>Настройки</h1>
      </div>
      <Errors error={error} />
      {info ? <div className="note">{info}</div> : null}
      {issued ? (
        <div className="note warn">
          Токен для «{issued.label}» — показывается один раз. Передайте его лично, не в общий чат:
          <code className="token">{issued.token}</code>
          <button className="btn" onClick={() => setIssued(null)}>
            Скрыть
          </button>
        </div>
      ) : null}

      <section className="card">
        <p className="lab">Текущие версии ПО</p>
        <p className="muted">Смена версии ставит пометку «проверить» у принятых записей с другой версией этого продукта.</p>
        <ul className="plain">
          {software.data?.map((s) => (
            <li key={s.product}>
              {s.product} {s.version}
            </li>
          ))}
        </ul>
        <form
          className="filters"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () => api<{ text: string }>('PUT', '/api/software', sw).then((r) => setInfo(r.text)),
              () => {
                setSw({ product: '', version: '' });
                software.reload();
              },
            );
          }}
        >
          <input value={sw.product} onChange={(e) => setSw({ ...sw, product: e.target.value })} placeholder="Продукт: Revit" />
          <input value={sw.version} onChange={(e) => setSw({ ...sw, version: e.target.value })} placeholder="Версия: 2027" />
          <button className="btn" disabled={!sw.product || !sw.version}>
            Сохранить
          </button>
        </form>
      </section>

      <section className="card">
        <p className="lab">Проекты</p>
        <p className="muted">Список объектов берётся из Schema Teams раз в час; можно обновить сейчас.</p>
        <button
          className="btn"
          onClick={() => void run(() => api<{ text: string }>('POST', '/api/projects/sync').then((r) => setInfo(r.text)), () => {})}
        >
          Обновить из Schema Teams
        </button>
      </section>

      <section className="card">
        <p className="lab">Сотрудники и токены</p>
        <p className="muted">Ярлык — обезличенный («проектировщик АР-2»). У каждого агента сотрудника — свой токен.</p>
        <form
          className="filters"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api('POST', '/api/persons', { label }), () => {
              setLabel('');
              persons.reload();
            });
          }}
        >
          <input className="grow" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ярлык нового сотрудника" />
          <button className="btn" disabled={!label.trim()}>
            Добавить
          </button>
        </form>
        <table>
          <tbody>
            {persons.data?.map((p) => (
              <tr key={p.id}>
                <td>{p.label}</td>
                <td>
                  {p.tokens.map((t) => (
                    <div key={t.id} className="token-row">
                      {t.client} · {t.scopes.join(', ')} · {t.hint}… {t.note}
                      <button
                        className="btn small"
                        onClick={() => void run(() => api('DELETE', `/api/tokens/${t.id}`), persons.reload)}
                      >
                        Отозвать
                      </button>
                    </div>
                  ))}
                </td>
                <td>
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const client = e.target.value;
                      e.target.value = '';
                      if (!client) return;
                      void run(
                        () =>
                          api<{ token: string }>('POST', `/api/persons/${p.id}/tokens`, { client }).then((r) =>
                            setIssued({ label: p.label, token: r.token }),
                          ),
                        persons.reload,
                      );
                    }}
                  >
                    <option value="">Выпустить токен…</option>
                    <option value="claude">для Claude</option>
                    <option value="codex">для Codex</option>
                    <option value="chatgpt">для ChatGPT</option>
                    <option value="web">для входа в веб</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

// --- каркас ----------------------------------------------------------------

function Shell({ me, children, onLogout }: { me: Me; children: ReactNode; onLogout: () => void }) {
  const moderator = me.scopes.includes('moderate');
  const [path] = useRoute();
  const link = (href: string, label: string, active: boolean) => (
    <a href={href} className={active ? 'active' : ''}>
      {label}
    </a>
  );
  return (
    <div className="shell">
      <header>
        <a className="logo" href="#/">
          Schema Brain
        </a>
        <nav>
          {link('#/', 'Записи', path === '/' || path.startsWith('/r/'))}
          {link('#/new', 'Новая запись', path === '/new')}
          {link('#/questions', 'Вопросы', path === '/questions')}
          {link('#/graph', 'Граф', path === '/graph')}
          {moderator ? link('#/queue', 'Очередь', path === '/queue') : null}
          {moderator ? link('#/settings', 'Настройки', path === '/settings') : null}
        </nav>
        <span className="who">
          {me.label}
          <button className="btn small" onClick={onLogout}>
            Выйти
          </button>
        </span>
      </header>
      <main>{children}</main>
    </div>
  );
}

export function App() {
  const [path, params] = useRoute();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const check = useCallback(() => {
    api<Me>('GET', '/api/me').then(setMe, () => setMe(null));
  }, []);
  useEffect(check, [check]);
  if (me === undefined) return null;
  if (me === null) return <Login onDone={check} />;
  const card = /^\/r\/(\d+)$/.exec(path);
  let page: ReactNode;
  if (card) page = <CardPage number={Number(card[1])} me={me} />;
  else if (path === '/new') page = <NewRecord params={params} />;
  else if (path === '/questions') page = <Questions />;
  else if (path === '/graph')
    page = (
      <Suspense fallback={<p className="muted">Загрузка графа…</p>}>
        <GraphPage params={params} />
      </Suspense>
    );
  else if (path === '/queue') page = <Queue />;
  else if (path === '/settings') page = <Settings />;
  else page = <Records params={params} />;
  return (
    <Shell me={me} onLogout={() => void api('DELETE', '/api/session').finally(() => setMe(null))}>
      {page}
    </Shell>
  );
}
