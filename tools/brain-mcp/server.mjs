#!/usr/bin/env node
// MCP-пакет Schema Brain: инструменты для агентов (docs/spec.md, раздел 7).
// stdio, строчный JSON-RPC, без зависимостей — как инструмент MCP Schema Teams.
// Ходит в API сервиса по токену; ответы агенту — готовые короткие строки сервиса.
// Настройки: SB_URL — адрес сервиса, SB_TOKEN — токен sbt_… (выдаёт модератор).
// stdout — только протокол; ошибки и отладка — в stderr.
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

export const VERSION = '0.1.0';
const PROTOCOL_VERSION = '2025-06-18';
const TIMEOUT_MS = 30_000;

/** Ошибка, которую агент показывает как есть. */
export class ToolError extends Error {}

/** @param {{ url: string, token: string, fetch?: typeof fetch }} opts */
export function createApi(opts) {
  const base = String(opts.url ?? '').replace(/\/+$/, '');
  const doFetch = opts.fetch ?? fetch;
  /** @returns {Promise<any>} */
  return async function api(method, path, body) {
    if (!base) throw new ToolError('Не задан адрес Schema Brain (SB_URL) в настройках расширения');
    if (!opts.token) throw new ToolError('Не задан токен доступа (SB_TOKEN) — его выдаёт модератор');
    let response;
    try {
      response = await doFetch(base + path, {
        method,
        headers: {
          authorization: `Bearer ${opts.token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new ToolError(
        `Schema Brain не отвечает (${base}). Проверьте, что компьютер в локальной сети бюро и адрес верный. ${error instanceof Error ? error.message : ''}`.trim(),
      );
    }
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) throw new ToolError('Токен доступа недействителен — попросите у модератора новый');
    if (!response.ok) {
      const details = Array.isArray(data.details) && data.details.length ? `\n- ${data.details.join('\n- ')}` : '';
      throw new ToolError(`${data.message ?? `Ошибка ${response.status}`}${details}`);
    }
    return data;
  };
}

// --- аргументы ---------------------------------------------------------------

const str = (args, name, required = false) => {
  const value = args[name];
  if (value === undefined || value === null || value === '') {
    if (required) throw new ToolError(`Не указан параметр ${name}`);
    return undefined;
  }
  if (typeof value !== 'string') throw new ToolError(`Параметр ${name} — строка`);
  return value;
};
const num = (args, name, required = false) => {
  const value = args[name];
  if (value === undefined || value === null || value === '') {
    if (required) throw new ToolError(`Не указан параметр ${name}`);
    return undefined;
  }
  const n = typeof value === 'number' ? value : Number(String(value).replace(/^\s*№\s*/, ''));
  if (!Number.isInteger(n) || n < 1) throw new ToolError(`Параметр ${name} — номер записи (целое число)`);
  return n;
};
const nums = (args, name) => {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  const list = Array.isArray(value) ? value : [value];
  return list.map((v) => num({ v }, 'v', true));
};
const query = (params) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

const CORE = {
  type: 'string',
  description: 'Ядро: «Проектирование», «BIM и Revit», «Процессы бюро» или «Инструменты» (плагины, навыки, MCP)',
};
const PROJECT = { type: 'string', description: 'Код объекта из Schema Teams, если запись только про этот объект' };
const NUMBER = { type: ['integer', 'string'], description: 'Номер записи, например 128' };
const CONFIRMED = {
  type: 'boolean',
  description: 'true — только после явного «ок» сотрудника на показанный ему черновик. Без «ок» не вызывать.',
};

const short = (r) => `№ ${r.number} · ${r.trust || r.statusName} — ${r.text}`;

/**
 * Инструменты. scope — право токена, без которого инструмент не показывается.
 * @param {(method: string, path: string, body?: unknown) => Promise<any>} api
 */
export function tools(api) {
  return [
    {
      name: 'brain_search',
      scope: 'read',
      description:
        'Поиск в общей памяти бюро Schema Brain: выводы коллег и их агентов — факты, правила бюро, гипотезы — с показателем доверия. ' +
        'Искать по ходу задачи, когда упираешься в незнакомое (ошибка, настройка, спорное решение), а не только в начале. ' +
        'Запрос — 2–4 ключевых слова; до трёх формулировок через «|» с синонимами и терминами, как их пишут по-разному: «зона обрезки | crop region | обрезка вида». ' +
        'Гипотезы проверяй, прежде чем опираться. Если применил запись — в конце задачи спроси сотрудника «сработало?» и отметь через brain_feedback.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Ключевые слова; формулировки через «|»' },
          core: CORE,
          project: PROJECT,
          type: { type: 'string', enum: ['вывод', 'вопрос'], description: 'По умолчанию — выводы; «вопрос» — открытые вопросы' },
          limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Сколько записей, по умолчанию 5' },
        },
        required: ['query'],
      },
      run: async (a) =>
        (await api('GET', `/api/search${query({ q: str(a, 'query', true), core: str(a, 'core'), project: str(a, 'project'), type: str(a, 'type'), limit: a.limit })}`)).text,
    },
    {
      name: 'brain_get',
      scope: 'read',
      description: 'Запись Schema Brain целиком по номеру: текст, показатель, пометки, противоречащие записи, ответы на вопрос.',
      inputSchema: { type: 'object', properties: { number: NUMBER }, required: ['number'] },
      run: async (a) => (await api('GET', `/api/records/${num(a, 'number', true)}`)).text,
    },
    {
      name: 'brain_propose',
      scope: 'propose',
      description:
        'Отправить вывод в Schema Brain — на модерацию. Сначала покажи сотруднику черновик целиком и отправляй только после его явного «ок» (confirmed_by_author: true). ' +
        'Не больше трёх записей за сессию. Текст — одна-три фразы, до 300 знаков: условие → что происходит → что делать; понятен без этой сессии; без имён, путей, адресов, паролей. ' +
        'Вид: «факт» — проверено в работе; «правило» — как принято в бюро, только если сотрудник так сказал; «гипотеза» — проверено один раз. ' +
        'В ответе — до трёх похожих записей: если новая повторяет найденную, предложи сотруднику вместо неё отметить существующую (brain_feedback); если противоречит — отправь заново с contradicts.',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['факт', 'правило', 'гипотеза'] },
          text: { type: 'string', maxLength: 300 },
          core: CORE,
          project: PROJECT,
          software_version: { type: 'string', description: 'От чего зависит вывод: «Revit 2026», «Schema.Tools 1.4», «СП 70.13330.2012»' },
          not_applicable: { type: 'string', description: 'Когда вывод не применим — если известно' },
          source: { type: 'string', description: 'Откуда: «сессия ГГГГ-ММ-ДД, задача „…“» — задача в 2–5 словах' },
          confirmed_by_author: CONFIRMED,
          contradicts: { type: 'array', items: NUMBER, description: 'Номера записей, которым вывод противоречит' },
          derived_from: { type: 'array', items: NUMBER, description: 'Номера записей, из которых вывод выведен' },
          answers: { type: 'array', items: NUMBER, description: 'Номера открытых вопросов, на которые вывод отвечает' },
        },
        required: ['kind', 'text', 'core', 'source', 'confirmed_by_author'],
      },
      run: async (a) => {
        const result = await api('POST', '/api/records', {
          type: 'вывод',
          kind: str(a, 'kind', true),
          text: str(a, 'text', true),
          core: str(a, 'core', true),
          project: str(a, 'project'),
          software_version: str(a, 'software_version'),
          not_applicable: str(a, 'not_applicable'),
          source: str(a, 'source', true),
          confirmed_by_author: a.confirmed_by_author,
          contradicts: nums(a, 'contradicts'),
          derived_from: nums(a, 'derived_from'),
          answers: nums(a, 'answers'),
        });
        const lines = [`Отправлено: № ${result.record.number} — ${result.record.statusName}.`];
        if (result.similar?.length) lines.push('Похожие записи в базе — сравни: повтор или противоречие?', ...result.similar.map(short));
        return lines.join('\n');
      },
    },
    {
      name: 'brain_ask',
      scope: 'propose',
      description:
        'Открытый вопрос в Schema Brain — когда ответа нет ни в базе (brain_search), ни у сотрудника, ни в документах. ' +
        'Один конкретный вопрос, на который можно ответить одной записью. Только после «ок» сотрудника. Если такой вопрос уже задан — вернётся его номер.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', maxLength: 300 },
          core: CORE,
          project: PROJECT,
          source: { type: 'string' },
          confirmed_by_author: CONFIRMED,
        },
        required: ['text', 'core', 'source', 'confirmed_by_author'],
      },
      run: async (a) => {
        const result = await api('POST', '/api/records', {
          type: 'вопрос',
          text: str(a, 'text', true),
          core: str(a, 'core', true),
          project: str(a, 'project'),
          source: str(a, 'source', true),
          confirmed_by_author: a.confirmed_by_author,
        });
        return result.existing
          ? `Такой вопрос уже задан: № ${result.record.number} — ${result.record.text}`
          : `Вопрос записан: № ${result.record.number}. Ответ появится в базе после разбора.`;
      },
    },
    {
      name: 'brain_feedback',
      scope: 'feedback',
      description:
        'Отметка «сработало / не сработало» для записи, которую применили в задаче. Спроси сотрудника одним вопросом в конце задачи; ' +
        'отметь по его ответу. software_version — на какой версии проверено, если запись помечена «Проверить».',
      inputSchema: {
        type: 'object',
        properties: {
          number: NUMBER,
          worked: { type: 'boolean' },
          comment: { type: 'string', description: 'Коротко, если не сработало: что пошло не так' },
          software_version: { type: 'string' },
        },
        required: ['number', 'worked'],
      },
      run: async (a) => {
        if (typeof a.worked !== 'boolean') throw new ToolError('Параметр worked — true или false');
        return (
          await api('POST', `/api/records/${num(a, 'number', true)}/feedback`, {
            worked: a.worked,
            comment: str(a, 'comment'),
            software_version: str(a, 'software_version'),
          })
        ).text;
      },
    },
    {
      name: 'brain_cores',
      scope: 'read',
      description: 'Ядра Schema Brain — разделы, к которым относится каждая запись.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => (await api('GET', '/api/cores')).map((c) => `${c.name}${c.description ? ` — ${c.description}` : ''}`).join('\n'),
    },
    {
      name: 'brain_projects',
      scope: 'read',
      description: 'Активные проекты (объекты Schema Teams): код и название — для поля project.',
      inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Часть кода или названия' } } },
      run: async (a) => {
        const list = await api('GET', `/api/projects${query({ q: str(a, 'query') })}`);
        return list.length ? list.map((p) => `${p.code}${p.name ? ` — ${p.name}` : ''}`).join('\n') : 'Проектов не найдено.';
      },
    },
    {
      name: 'brain_queue',
      scope: 'moderate',
      description: 'Очередь модерации: сначала противоречия, затем записи, которые уже запрашивали агенты, затем остальные.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 200 } } },
      run: async (a) => (await api('GET', `/api/queue${query({ limit: a.limit })}`)).text,
    },
    {
      name: 'brain_list',
      scope: 'moderate',
      description:
        'Записи короткими строками, до 200 за раз — для разбора с модератором: найти одно и то же разными словами (объединить), противоречия, ответы на вопросы. ' +
        'Предложения показать модератору и выполнять только после его «да» (brain_moderate, brain_link).',
      inputSchema: {
        type: 'object',
        properties: {
          core: CORE,
          project: PROJECT,
          type: { type: 'string', enum: ['вывод', 'вопрос'] },
          status: { type: 'string', description: '«принята», «на модерации», «открыт» и т. п.' },
          page: { type: 'integer', minimum: 1 },
        },
      },
      run: async (a) =>
        (await api('GET', `/api/records${query({ core: str(a, 'core'), project: str(a, 'project'), type: str(a, 'type'), status: str(a, 'status'), page: a.page })}`)).text,
    },
    {
      name: 'brain_moderate',
      scope: 'moderate',
      description:
        'Решение модератора по записи: accept — принять, reject — отклонить, merge — объединить с принятой target, replace — заменить правило бюро target этим правилом, reopen — вернуть, close — закрыть вопрос. ' +
        'edits — поправки полей до принятия (text, kind, core, project, software_version, not_applicable). Только по явному решению модератора.',
      inputSchema: {
        type: 'object',
        properties: {
          number: NUMBER,
          decision: { type: 'string', enum: ['accept', 'reject', 'merge', 'replace', 'reopen', 'close'] },
          target: NUMBER,
          edits: { type: 'object' },
          comment: { type: 'string' },
        },
        required: ['number', 'decision'],
      },
      run: async (a) =>
        (
          await api('POST', `/api/records/${num(a, 'number', true)}/moderate`, {
            decision: str(a, 'decision', true),
            target: num(a, 'target'),
            edits: a.edits,
            comment: str(a, 'comment'),
          })
        ).text,
    },
    {
      name: 'brain_link',
      scope: 'moderate',
      description:
        'Связь между записями (модератор): contradicts — противоречит (только факты и гипотезы), answers — вывод отвечает на вопрос, derived_from — выведен из. remove: true — снять связь.',
      inputSchema: {
        type: 'object',
        properties: {
          from: NUMBER,
          to: NUMBER,
          type: { type: 'string', enum: ['contradicts', 'answers', 'derived_from'] },
          remove: { type: 'boolean' },
        },
        required: ['from', 'to', 'type'],
      },
      run: async (a) =>
        (await api('POST', '/api/links', { from: num(a, 'from', true), to: num(a, 'to', true), type: str(a, 'type', true), remove: a.remove === true })).text,
    },
  ];
}

// --- протокол --------------------------------------------------------------

/**
 * Обрабатывает одно сообщение JSON-RPC. null — уведомление, отвечать не нужно.
 * @param {unknown} raw
 * @param {ReturnType<typeof tools>} list
 * @param {() => Promise<string[] | null>} scopes — права токена; null — не удалось узнать (показать все)
 */
export async function handle(raw, list, scopes) {
  if (typeof raw !== 'object' || raw === null || raw.jsonrpc !== '2.0' || typeof raw.method !== 'string') {
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
  }
  if (raw.id === undefined) return null;
  const id = raw.id;
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  switch (raw.method) {
    case 'initialize':
      return ok({
        protocolVersion: typeof raw.params?.protocolVersion === 'string' ? raw.params.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'schema-brain', version: VERSION },
      });
    case 'ping':
      return ok({});
    case 'tools/list': {
      const allowed = await scopes();
      return ok({
        tools: list
          .filter((t) => !allowed || allowed.includes(t.scope))
          .map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });
    }
    case 'tools/call': {
      const tool = list.find((t) => t.name === raw.params?.name);
      if (!tool) return { jsonrpc: '2.0', id, error: { code: -32602, message: `Нет инструмента ${String(raw.params?.name)}` } };
      const args = typeof raw.params?.arguments === 'object' && raw.params.arguments !== null ? raw.params.arguments : {};
      try {
        return ok({ content: [{ type: 'text', text: await tool.run(args) }] });
      } catch (error) {
        if (!(error instanceof ToolError)) process.stderr.write(`${tool.name}: ${error instanceof Error ? error.stack : String(error)}\n`);
        return ok({ content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true });
      }
    }
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Метод не поддерживается: ${raw.method}` } };
  }
}

export function serve({ url, token }) {
  const api = createApi({ url, token });
  const list = tools(api);
  let cached;
  const scopes = async () => {
    if (cached === undefined) cached = await api('GET', '/api/me').then((me) => me.scopes, () => null);
    return cached;
  };
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let pending = 0;
  let closed = false;
  const done = () => closed && pending === 0 && setTimeout(() => process.exit(0), 100);
  lines.on('line', (line) => {
    if (!line.trim()) return;
    let raw;
    try {
      raw = JSON.parse(line);
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
      return;
    }
    pending += 1;
    handle(raw, list, scopes)
      .then((response) => response && process.stdout.write(`${JSON.stringify(response)}\n`))
      .finally(() => {
        pending -= 1;
        done();
      });
  });
  lines.on('close', () => {
    closed = true;
    done();
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  serve({ url: process.env.SB_URL ?? '', token: process.env.SB_TOKEN ?? '' });
}
