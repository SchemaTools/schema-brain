// Записи: отправка, поиск, карточка, отметки, модерация, правка, связи, очередь, граф
// (docs/spec.md, разделы 3–7). Каждое изменение пишется в журнал записи в той же транзакции.
import {
  type AgentRecord,
  agentLines,
  allWords,
  anyWord,
  checkText,
  clampLimit,
  clearsCheck,
  countMarks,
  type Decision,
  decide,
  fromRu,
  initialStatus,
  LINK_TYPES,
  type LinkType,
  linkProblem,
  mergeHits,
  needsCheck,
  parseQuery,
  parseVersion,
  queueOrder,
  type RecordRef,
  RU,
  TRUST,
  trustText,
  validateRecord,
} from '../../../../packages/core/src/index.ts';
import { AppError, type Ctx, conflict, invalid, need, notFound } from '../context.ts';
import type { Db, Tx } from '../db/client.ts';
import { Prisma } from '../generated/prisma/client.ts';

const withRefs = { core: true, project: true, author: { select: { label: true } } } as const;
type Row = Prisma.RecordGetPayload<{ include: typeof withRefs }>;

/** Номер записи из числа, «12», «№ 12». */
export function parseNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(/^\s*№\s*/, '').trim());
  if (!Number.isInteger(n) || n < 1) throw invalid(`Номер записи — целое число: «${String(value)}»`);
  return n;
}

const numbers = (value: unknown): number[] =>
  value === undefined || value === null || value === ''
    ? []
    : (Array.isArray(value) ? value : String(value).split(/[,\s]+/).filter(Boolean)).map(parseNumber);

export interface RecordView {
  number: number;
  type: string;
  kind: string | null;
  core: string;
  coreName: string;
  project: string | null;
  status: string;
  statusName: string;
  text: string;
  softwareVersion: string | null;
  notApplicable: string | null;
  source: string;
  author: string;
  worked: number;
  failed: number;
  trust: string;
  needsCheck: boolean;
  requestsCount: number;
  askedCount: number;
  version: number;
  created: string;
  updated: string;
}

export function view(r: Row): RecordView {
  return {
    number: r.number,
    type: r.type,
    kind: r.kind,
    core: r.core.code,
    coreName: r.core.name,
    project: r.project?.code ?? null,
    status: r.status,
    statusName: RU.status[r.status as keyof typeof RU.status] ?? r.status,
    text: r.text,
    softwareVersion: r.softwareVersion,
    notApplicable: r.notApplicable,
    source: r.source,
    author: r.author.label,
    worked: r.worked,
    failed: r.failed,
    trust: r.type === 'conclusion' ? trustText(r.worked, r.failed) : '',
    needsCheck: r.needsCheck,
    requestsCount: r.requestsCount,
    askedCount: r.askedCount,
    version: r.version,
    created: r.created.toISOString(),
    updated: r.updated.toISOString(),
  };
}

const ref = (r: { type: string; kind: string | null; status: string }): RecordRef => r as RecordRef;

async function byNumber(db: Db | Tx, number: number): Promise<Row> {
  const row = await db.record.findUnique({ where: { number }, include: withRefs });
  if (!row) throw notFound(`Запись № ${number}`);
  return row;
}

async function event(tx: Tx, recordId: string, ctx: Ctx, kind: string, data: object = {}) {
  await tx.recordEvent.create({
    data: { recordId, personId: ctx.personId || null, client: ctx.client, kind, data: data as Prisma.InputJsonValue },
  });
}

async function coreId(db: Db | Tx, code: string): Promise<number> {
  const row = await db.core.findUnique({ where: { code } });
  if (!row) throw invalid(`Ядро «${code}» не найдено`);
  return row.id;
}

async function projectId(db: Db | Tx, code: string | null): Promise<number | null> {
  if (!code) return null;
  const row = await db.project.findUnique({ where: { code } });
  if (!row) throw invalid(`Проект «${code}» не найден — код объекта из Schema Teams (список: brain_projects)`);
  return row.id;
}

// --- поиск -----------------------------------------------------------------

interface Filters {
  type: 'conclusion' | 'question';
  coreId?: number;
  projectId?: number;
  includeFalse?: boolean;
}

const AGENT_STATUSES = { conclusion: ['accepted'], question: ['open', 'answered'] } as const;
const WAITING = ['pending', 'disputed'];

async function fts(
  db: Db | Tx,
  tsquery: string,
  f: Filters,
  statuses: readonly string[],
  limit: number,
  exclude?: string,
): Promise<{ id: string; rank: number }[]> {
  const conds = [
    Prisma.sql`r.search_vector @@ to_tsquery('russian', ${tsquery})`,
    Prisma.sql`r.type = ${f.type}`,
    Prisma.sql`r.status IN (${Prisma.join([...statuses])})`,
  ];
  if (f.coreId) conds.push(Prisma.sql`r.core_id = ${f.coreId}`);
  if (f.projectId) conds.push(Prisma.sql`(r.project_id = ${f.projectId} OR r.project_id IS NULL)`);
  if (exclude) conds.push(Prisma.sql`r.id <> ${exclude}::uuid`);
  if (f.type === 'conclusion' && !f.includeFalse) {
    conds.push(
      Prisma.sql`NOT (r.worked + r.failed >= ${TRUST.minMarks} AND r.worked::float8 / (r.worked + r.failed + 1) <= ${TRUST.falseAt})`,
    );
  }
  return db.$queryRaw<{ id: string; rank: number }[]>`
    SELECT r.id::text AS id, ts_rank_cd(r.search_vector, to_tsquery('russian', ${tsquery}))::float8 AS rank
    FROM record r WHERE ${Prisma.join(conds, ' AND ')}
    ORDER BY rank DESC, r.number LIMIT ${limit}`;
}

/** Поиск по формулировкам: сначала «все слова», добор — «любое слово» (раздел 6). */
async function searchIds(
  db: Db | Tx,
  query: string,
  f: Filters,
  statuses: readonly string[],
  limit: number,
  exclude?: string,
) {
  const { phrasings } = parseQuery(query);
  const lists: { id: string; rank: number; strict: boolean }[][] = [];
  for (const words of phrasings) {
    lists.push((await fts(db, allWords(words), f, statuses, limit, exclude)).map((h) => ({ ...h, strict: true })));
    if (words.length > 1) {
      lists.push((await fts(db, anyWord(words), f, statuses, limit, exclude)).map((h) => ({ ...h, strict: false })));
    }
  }
  return mergeHits(lists, limit);
}

async function currentVersions(db: Db | Tx) {
  const rows = await db.softwareCurrent.findMany();
  return new Map(rows.map((r) => [r.product.toLowerCase(), { product: r.product, version: r.version }]));
}

/** Запись для агента: показатель, пометка «проверить», соперники, ответы. */
async function forAgent(db: Db | Tx, rows: Row[]): Promise<AgentRecord[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const links = await db.link.findMany({
    where: { OR: [{ fromId: { in: ids } }, { toId: { in: ids } }], type: { in: ['contradicts', 'answers'] } },
    include: { from: true, to: true },
  });
  const versions = await currentVersions(db);
  return rows.map((r) => {
    const rivals = links
      .filter((l) => l.type === 'contradicts' && (l.fromId === r.id || l.toId === r.id))
      .map((l) => (l.fromId === r.id ? l.to : l.from))
      .filter((o) => o.status === 'accepted')
      .map((o) => ({ number: o.number, worked: o.worked, failed: o.failed }));
    const answers = links
      .filter((l) => l.type === 'answers' && l.toId === r.id && l.from.status === 'accepted')
      .map((l) => l.from.number);
    const product = parseVersion(r.softwareVersion)?.product.toLowerCase();
    return {
      number: r.number,
      type: r.type as AgentRecord['type'],
      kind: r.kind as AgentRecord['kind'],
      core: r.core.code as AgentRecord['core'],
      project: r.project?.code ?? null,
      status: r.status as AgentRecord['status'],
      text: r.text,
      notApplicable: r.notApplicable,
      worked: r.worked,
      failed: r.failed,
      check: r.needsCheck && r.softwareVersion ? checkText(r.softwareVersion, product ? versions.get(product) : undefined) : undefined,
      rivals,
      answers,
    };
  });
}

export interface SearchInput {
  query: string;
  core?: string;
  project?: string;
  type?: string;
  limit?: number;
  includeFalse?: boolean;
}

export async function search(db: Db, ctx: Ctx, input: SearchInput) {
  need(ctx, 'read');
  if (!input.query?.trim()) throw invalid('Пустой запрос');
  const type = input.type ? fromRu('type', input.type) : 'conclusion';
  if (!type) throw invalid('type: «вывод» или «вопрос»');
  const coreCode = input.core ? fromRu('core', input.core) : undefined;
  if (input.core && !coreCode) throw invalid(`Ядро «${input.core}» не найдено`);
  const f: Filters = {
    type,
    coreId: coreCode ? await coreId(db, coreCode) : undefined,
    projectId: input.project ? ((await projectId(db, input.project)) ?? undefined) : undefined,
    includeFalse: input.includeFalse,
  };
  const limit = clampLimit(input.limit);
  const hits = await searchIds(db, input.query, f, AGENT_STATUSES[type], limit);
  // записи на модерации агенту не выдаются, но их счётчик растёт — в очереди они выше (раздел 5.6)
  const waiting = type === 'conclusion' ? await searchIds(db, input.query, f, WAITING, limit) : [];
  const rows = await db.record.findMany({ where: { id: { in: hits.map((h) => h.id) } }, include: withRefs });
  const ordered = hits.map((h) => rows.find((r) => r.id === h.id)!).filter(Boolean);
  const bump = [...ordered.map((r) => r.id), ...waiting.map((w) => w.id)];
  if (bump.length) await db.record.updateMany({ where: { id: { in: bump } }, data: { requestsCount: { increment: 1 } } });
  const records = await forAgent(db, ordered);
  return { records, text: records.length ? records.map(agentLines).join('\n\n') : 'Ничего не найдено.' };
}

// --- карточка --------------------------------------------------------------

export async function getRecord(db: Db, ctx: Ctx, number: number, opts: { history?: boolean } = {}) {
  need(ctx, 'read');
  const row = await byNumber(db, number);
  if (ctx.client !== 'web' && row.status === 'accepted') {
    await db.record.update({ where: { id: row.id }, data: { requestsCount: { increment: 1 } } });
  }
  const [agent] = await forAgent(db, [row]);
  const links = await db.link.findMany({
    where: { OR: [{ fromId: row.id }, { toId: row.id }] },
    include: { from: { select: { number: true } }, to: { select: { number: true } } },
    orderBy: { created: 'asc' },
  });
  const events = opts.history
    ? await db.recordEvent.findMany({
        where: { recordId: row.id },
        orderBy: { id: 'asc' },
        select: { kind: true, client: true, data: true, created: true, personId: true },
      })
    : [];
  const people = new Map(
    (await db.person.findMany({ where: { id: { in: events.map((e) => e.personId).filter((x): x is string => !!x) } } })).map((p) => [
      p.id,
      p.label,
    ]),
  );
  return {
    record: view(row),
    refs: row.refs,
    links: links.map((l) => ({ id: l.id, type: l.type, typeName: RU.link[l.type as LinkType], from: l.from.number, to: l.to.number })),
    history: events.map((e) => ({
      kind: e.kind,
      client: e.client,
      who: e.personId ? (people.get(e.personId) ?? '') : '',
      data: e.data,
      created: e.created.toISOString(),
    })),
    text: agentLines(agent),
  };
}

// --- отправка --------------------------------------------------------------

export async function propose(db: Db, ctx: Ctx, raw: Record<string, unknown>) {
  need(ctx, 'propose');
  const { value, errors } = validateRecord(raw);
  if (!value) throw invalid('Запись не принята — поправьте и отправьте снова', errors);
  const contradicts = numbers(raw.contradicts);
  const derivedFrom = numbers(raw.derived_from ?? raw.derivedFrom);
  const answers = numbers(raw.answers);
  const importHash = typeof raw.import_hash === 'string' ? raw.import_hash : null;

  const cId = await coreId(db, value.core);
  const pId = await projectId(db, value.project);

  // вопрос: если похожий открытый уже есть — не плодить, а поднять его счётчик (раздел 7, brain_ask)
  if (value.type === 'question') {
    const words = parseQuery(value.text).phrasings[0]?.filter((w) => [...w].length >= 4) ?? [];
    if (words.length >= 2) {
      const [same] = await fts(db, allWords(words), { type: 'question' }, ['open', 'answered'], 1);
      if (same) {
        const existing = await db.record.update({
          where: { id: same.id },
          data: { askedCount: { increment: 1 } },
          include: withRefs,
        });
        return { record: view(existing), existing: true, similar: [] as RecordView[] };
      }
    }
  }

  const created = await db.$transaction(async (tx) => {
    const targets = new Map<number, Row>();
    for (const n of [...contradicts, ...derivedFrom, ...answers]) targets.set(n, await byNumber(tx, n));
    const status = initialStatus(value.type, contradicts.length > 0);
    const draft = { type: value.type, kind: value.kind, status } as RecordRef;
    const plan: [LinkType, number][] = [
      ...contradicts.map((n) => ['contradicts', n] as [LinkType, number]),
      ...derivedFrom.map((n) => ['derived_from', n] as [LinkType, number]),
      ...answers.map((n) => ['answers', n] as [LinkType, number]),
    ];
    for (const [type, n] of plan) {
      const problem = linkProblem(type, draft, ref(targets.get(n)!), false);
      if (problem) throw invalid(`Связь с № ${n}: ${problem}`);
    }
    const record = await tx.record.create({
      data: {
        type: value.type,
        kind: value.kind,
        text: value.text,
        coreId: cId,
        projectId: pId,
        softwareVersion: value.softwareVersion,
        notApplicable: value.notApplicable,
        source: value.source,
        authorId: ctx.personId,
        authorClient: ctx.client,
        confirmedByAuthor: true,
        status,
        importHash,
      },
      include: withRefs,
    });
    for (const [type, n] of plan) {
      await tx.link.create({ data: { fromId: record.id, toId: targets.get(n)!.id, type, createdBy: ctx.personId } });
    }
    await event(tx, record.id, ctx, 'created', {
      status,
      links: plan.map(([type, n]) => ({ type, to: n })),
    });
    return record;
  });

  // похожие принятые записи — агенту для сравнения: повтор или противоречие (раздел 5.5)
  let similar: RecordView[] = [];
  if (value.type === 'conclusion') {
    const words = parseQuery(value.text).phrasings[0]?.filter((w) => [...w].length >= 4) ?? [];
    if (words.length) {
      const hits = await fts(db, anyWord(words), { type: 'conclusion', coreId: cId }, ['accepted'], 3, created.id);
      const rows = await db.record.findMany({ where: { id: { in: hits.map((h) => h.id) } }, include: withRefs });
      similar = hits.map((h) => rows.find((r) => r.id === h.id)!).filter(Boolean).map(view);
    }
  }
  return { record: view(created), existing: false, similar };
}

/** Есть ли признак повтора при импорте (одинаковый хэш — тот же файл того же сотрудника). */
export async function imported(db: Db, importHash: string) {
  return !!(await db.record.findUnique({ where: { importHash } }));
}

// --- отметки ---------------------------------------------------------------

export async function feedback(
  db: Db,
  ctx: Ctx,
  number: number,
  input: { worked: unknown; comment?: unknown; software_version?: unknown },
) {
  need(ctx, 'feedback');
  if (typeof input.worked !== 'boolean') throw invalid('worked: true — сработало, false — не сработало');
  const comment = typeof input.comment === 'string' ? input.comment.trim().slice(0, 300) : '';
  const checkedOn = typeof input.software_version === 'string' ? input.software_version.trim().slice(0, 100) || null : null;
  return db.$transaction(async (tx) => {
    const row = await byNumber(tx, number);
    if (row.type !== 'conclusion' || row.status !== 'accepted') {
      throw invalid('Отметить можно только принятый вывод');
    }
    await tx.feedback.create({
      data: { recordId: row.id, personId: ctx.personId, client: ctx.client, worked: input.worked as boolean, comment, softwareVersion: checkedOn },
    });
    const marks = await tx.feedback.findMany({ where: { recordId: row.id }, select: { personId: true, worked: true, created: true } });
    const { n, b } = countMarks(marks, row.authorId);
    const product = parseVersion(row.softwareVersion)?.product.toLowerCase();
    const current = product ? (await currentVersions(tx)).get(product) : undefined;
    const clear = row.needsCheck && clearsCheck(input.worked as boolean, checkedOn, current);
    const updated = await tx.record.update({
      where: { id: row.id },
      data: { worked: n, failed: b, needsCheck: clear ? false : row.needsCheck },
      include: withRefs,
    });
    await event(tx, row.id, ctx, 'feedback', { worked: input.worked, comment, softwareVersion: checkedOn, n, b, clearedCheck: clear });
    return { record: view(updated), text: `№ ${number}: ${trustText(n, b)}${clear ? '; пометка «проверить» снята' : ''}` };
  });
}

// --- модерация -------------------------------------------------------------

const EDITABLE = ['text', 'kind', 'core', 'project', 'software_version', 'not_applicable'] as const;

/** Правка модератором: поля проверяются так же, как при отправке; чужая версия — 409. */
async function applyEdits(tx: Tx, ctx: Ctx, row: Row, edits: Record<string, unknown>) {
  const keys = Object.keys(edits).filter((k) => (EDITABLE as readonly string[]).includes(k));
  if (!keys.length) return row;
  const merged = {
    type: row.type,
    kind: row.kind ?? '',
    core: row.core.code,
    project: row.project?.code ?? null,
    software_version: row.softwareVersion,
    not_applicable: row.notApplicable,
    source: row.source,
    text: row.text,
    confirmed_by_author: true,
    ...Object.fromEntries(keys.map((k) => [k, edits[k]])),
  };
  const { value, errors } = validateRecord(merged);
  if (!value) throw invalid('Правка не принята', errors);
  const before = { text: row.text, kind: row.kind, core: row.core.code, project: row.project?.code ?? null, softwareVersion: row.softwareVersion, notApplicable: row.notApplicable };
  const updated = await tx.record.update({
    where: { id: row.id },
    data: {
      text: value.text,
      kind: value.kind,
      coreId: await coreId(tx, value.core),
      projectId: await projectId(tx, value.project),
      softwareVersion: value.softwareVersion,
      notApplicable: value.notApplicable,
      version: { increment: 1 },
    },
    include: withRefs,
  });
  const after = { text: updated.text, kind: updated.kind, core: updated.core.code, project: updated.project?.code ?? null, softwareVersion: updated.softwareVersion, notApplicable: updated.notApplicable };
  await event(tx, row.id, ctx, 'edited', { before, after });
  return updated;
}

export async function edit(db: Db, ctx: Ctx, number: number, edits: Record<string, unknown>, version: unknown) {
  need(ctx, 'moderate');
  return db.$transaction(async (tx) => {
    const row = await byNumber(tx, number);
    if (version !== undefined && version !== row.version) {
      throw conflict(`Запись № ${number} уже изменена (версия ${row.version}) — обновите карточку`);
    }
    return view(await applyEdits(tx, ctx, row, edits));
  });
}

export async function moderate(
  db: Db,
  ctx: Ctx,
  number: number,
  input: { decision: unknown; target?: unknown; edits?: unknown; comment?: unknown },
) {
  need(ctx, 'moderate');
  const decisions: Decision[] = ['accept', 'reject', 'merge', 'replace', 'reopen', 'close'];
  const decision = String(input.decision ?? '') as Decision;
  if (!decisions.includes(decision)) throw invalid(`decision — одно из: ${decisions.join(', ')}`);
  const comment = typeof input.comment === 'string' ? input.comment.trim().slice(0, 500) : '';
  return db.$transaction(async (tx) => {
    let row = await byNumber(tx, number);
    const target = input.target !== undefined && input.target !== null && input.target !== '' ? await byNumber(tx, parseNumber(input.target)) : undefined;
    if (target && target.id === row.id) throw invalid('Запись не может ссылаться на саму себя');
    const ruleConflicts = await tx.link.findMany({
      where: { type: 'contradicts', OR: [{ fromId: row.id }, { toId: row.id }] },
      include: { from: true, to: true },
    });
    const conflictsWithRule = ruleConflicts.some((l) => {
      const other = l.fromId === row.id ? l.to : l.from;
      return other.kind === 'rule' && other.status === 'accepted';
    });
    const result = (() => {
      try {
        return decide(ref(row), decision, target ? ref(target) : undefined, conflictsWithRule && decision === 'accept');
      } catch (error) {
        throw invalid((error as Error).message);
      }
    })();

    if (input.edits && typeof input.edits === 'object') row = await applyEdits(tx, ctx, row, input.edits as Record<string, unknown>);

    await tx.record.update({ where: { id: row.id }, data: { status: result.status, version: { increment: 1 } } });
    if (target && result.link) {
      await tx.link.upsert({
        where: { fromId_toId_type: { fromId: row.id, toId: target.id, type: result.link } },
        create: { fromId: row.id, toId: target.id, type: result.link, createdBy: ctx.personId },
        update: {},
      });
    }
    if (target && result.targetStatus) {
      await tx.record.update({ where: { id: target.id }, data: { status: result.targetStatus, version: { increment: 1 } } });
      // правило заменено — спор с ним снят
      await tx.link.deleteMany({
        where: { type: 'contradicts', OR: [{ fromId: row.id, toId: target.id }, { fromId: target.id, toId: row.id }] },
      });
      await event(tx, target.id, ctx, 'status', { from: target.status, to: result.targetStatus, by: number, comment });
    }
    // принятый вывод, который отвечает на вопрос, — вопрос «есть ответ»
    if (result.status === 'accepted') {
      const answered = await tx.link.findMany({ where: { fromId: row.id, type: 'answers' }, include: { to: true } });
      for (const l of answered.filter((x) => x.to.status === 'open')) {
        await tx.record.update({ where: { id: l.toId }, data: { status: 'answered', version: { increment: 1 } } });
        await event(tx, l.toId, ctx, 'status', { from: 'open', to: 'answered', by: number });
      }
    }
    await event(tx, row.id, ctx, 'moderated', {
      decision,
      from: row.status,
      to: result.status,
      target: target?.number ?? null,
      comment,
    });
    const updated = await byNumber(tx, number);
    return { record: view(updated), text: `№ ${number}: ${RU.status[result.status]}` };
  });
}

// --- связи -----------------------------------------------------------------

export async function link(db: Db, ctx: Ctx, input: { from: unknown; to: unknown; type: unknown; remove?: unknown }) {
  need(ctx, 'moderate');
  const type = String(input.type ?? '') as LinkType;
  if (!LINK_TYPES.includes(type)) throw invalid(`type — одно из: ${LINK_TYPES.join(', ')}`);
  return db.$transaction(async (tx) => {
    const from = await byNumber(tx, parseNumber(input.from));
    const to = await byNumber(tx, parseNumber(input.to));
    if (input.remove === true) {
      const { count } = await tx.link.deleteMany({
        where: type === 'contradicts' ? { type, OR: [{ fromId: from.id, toId: to.id }, { fromId: to.id, toId: from.id }] } : { type, fromId: from.id, toId: to.id },
      });
      if (!count) throw notFound('Связь');
      await event(tx, from.id, ctx, 'unlinked', { type, to: to.number });
      return { text: `Связь снята: № ${from.number} ${RU.link[type]} № ${to.number}` };
    }
    const problem = linkProblem(type, ref(from), ref(to), from.id === to.id);
    if (problem) throw invalid(problem);
    await tx.link.upsert({
      where: { fromId_toId_type: { fromId: from.id, toId: to.id, type } },
      create: { fromId: from.id, toId: to.id, type, createdBy: ctx.personId },
      update: {},
    });
    await event(tx, from.id, ctx, 'linked', { type, to: to.number });
    return { text: `Связь: № ${from.number} ${RU.link[type]} № ${to.number}` };
  });
}

// --- очередь, список для разбора, граф -------------------------------------

export async function queue(db: Db, ctx: Ctx, limit = 50) {
  need(ctx, 'moderate');
  const rows = await db.record.findMany({ where: { status: { in: WAITING } }, include: withRefs });
  const ordered = queueOrder(rows).slice(0, Math.min(200, Math.max(1, limit)));
  const agent = await forAgent(db, ordered);
  return { records: ordered.map(view), text: agent.length ? agent.map(agentLines).join('\n\n') : 'Очередь пуста.' };
}

export interface ListInput {
  core?: string;
  project?: string;
  type?: string;
  status?: string;
  q?: string;
  page?: number;
  pageSize?: number;
  includeFalse?: boolean;
  needsCheck?: boolean;
}

/** Список записей — для веба и для разбора с Claude (brain_list, раздел 6.1). */
export async function list(db: Db, ctx: Ctx, input: ListInput) {
  need(ctx, 'read');
  const where: Prisma.RecordWhereInput = {};
  if (input.core) {
    const code = fromRu('core', input.core);
    if (!code) throw invalid(`Ядро «${input.core}» не найдено`);
    where.coreId = await coreId(db, code);
  }
  if (input.project) where.projectId = await projectId(db, input.project);
  if (input.type) {
    const type = fromRu('type', input.type);
    if (!type) throw invalid('type: «вывод» или «вопрос»');
    where.type = type;
  }
  if (input.status) {
    const status = fromRu('status', input.status);
    if (!status) throw invalid(`Состояние «${input.status}» не найдено`);
    where.status = status;
  }
  if (input.needsCheck) where.needsCheck = true;
  if (input.q?.trim()) {
    const words = parseQuery(input.q).phrasings.flat();
    if (words.length) {
      const ids = await db.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM record WHERE search_vector @@ to_tsquery('russian', ${anyWord(words)})`;
      where.id = { in: ids.map((r) => r.id) };
    }
  }
  const pageSize = Math.min(200, Math.max(1, input.pageSize ?? 200));
  const page = Math.max(1, input.page ?? 1);
  const [total, rows] = await Promise.all([
    db.record.count({ where }),
    db.record.findMany({ where, include: withRefs, orderBy: { number: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  const shown = input.includeFalse === false ? rows.filter((r) => !(r.type === 'conclusion' && r.worked + r.failed >= TRUST.minMarks && r.worked / (r.worked + r.failed + 1) <= TRUST.falseAt)) : rows;
  const lines = shown.map(
    (r) =>
      `№ ${r.number} · ${r.kind ? RU.kind[r.kind as keyof typeof RU.kind] : RU.type[r.type as keyof typeof RU.type]} · ${RU.status[r.status as keyof typeof RU.status]}${r.type === 'conclusion' ? ` · ${trustText(r.worked, r.failed)}` : ''} — ${r.text}`,
  );
  const more = page * pageSize < total ? `\n… ещё ${total - page * pageSize}; следующая страница — page: ${page + 1}` : '';
  return { total, page, records: shown.map(view), text: (lines.length ? lines.join('\n') : 'Записей нет.') + more };
}

export async function graph(db: Db, ctx: Ctx, center?: number, depth = 2) {
  need(ctx, 'read');
  const d = Math.min(3, Math.max(1, depth));
  let ids: string[];
  if (center !== undefined) {
    const start = await byNumber(db, center);
    const rows = await db.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE walk(id, depth) AS (
        SELECT ${start.id}::uuid, 0
        UNION
        SELECT CASE WHEN l.from_id = w.id THEN l.to_id ELSE l.from_id END, w.depth + 1
        FROM walk w JOIN link l ON l.from_id = w.id OR l.to_id = w.id
        WHERE w.depth < ${d}
      )
      SELECT DISTINCT id::text AS id FROM walk`;
    ids = rows.map((r) => r.id);
  } else {
    const rows = await db.record.findMany({
      where: { status: { in: ['accepted', 'pending', 'disputed', 'open', 'answered'] } },
      select: { id: true },
      orderBy: { number: 'desc' },
      take: 500,
    });
    ids = rows.map((r) => r.id);
  }
  const [records, links] = await Promise.all([
    db.record.findMany({ where: { id: { in: ids } }, include: withRefs }),
    db.link.findMany({ where: { fromId: { in: ids }, toId: { in: ids } }, include: { from: { select: { number: true } }, to: { select: { number: true } } } }),
  ]);
  return {
    nodes: records.map(view),
    edges: links.map((l) => ({ from: l.from.number, to: l.to.number, type: l.type })),
  };
}

// --- текущие версии ---------------------------------------------------------

/** Смена текущей версии продукта → пометка «проверить» у принятых записей с другой версией (раздел 5.4). */
export async function setSoftware(db: Db, ctx: Ctx, product: string, version: string) {
  need(ctx, 'moderate');
  const p = product.trim();
  const v = version.trim();
  if (!p || !v) throw invalid('Нужны продукт и версия, например «Revit» и «2027»');
  return db.$transaction(async (tx) => {
    await tx.softwareCurrent.upsert({ where: { product: p }, create: { product: p, version: v }, update: { version: v, changed: new Date() } });
    const rows = await tx.record.findMany({ where: { status: 'accepted', softwareVersion: { not: null }, needsCheck: false } });
    const marked = rows.filter((r) => needsCheck(r.softwareVersion, { product: p, version: v }));
    for (const r of marked) {
      await tx.record.update({ where: { id: r.id }, data: { needsCheck: true } });
      await event(tx, r.id, ctx, 'needs_check', { product: p, version: v });
    }
    return { marked: marked.length, text: `Текущая версия: ${p} ${v}; пометка «проверить» — у ${marked.length} записей` };
  });
}

export async function software(db: Db) {
  return db.softwareCurrent.findMany({ orderBy: { product: 'asc' } });
}

export { AppError };
