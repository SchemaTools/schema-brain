// Правила связей и решений модератора (docs/spec.md, разделы 3.2, 4, 5.1, 5.5).
import type { Kind, LinkType, RecordType, Status } from './enums.ts';

export interface RecordRef {
  type: RecordType;
  kind: Kind | null;
  status: Status;
}

/** Почему связь недопустима; пусто — можно. */
export function linkProblem(type: LinkType, from: RecordRef, to: RecordRef, same: boolean): string {
  if (same) return 'запись не может ссылаться на саму себя';
  const conclusions = from.type === 'conclusion' && to.type === 'conclusion';
  switch (type) {
    case 'contradicts':
      if (!conclusions) return '«противоречит» — только между выводами';
      // решение 7: у правила бюро один ответ — соперников нет, только замена
      if (from.kind === 'rule' || to.kind === 'rule') {
        return 'у правила бюро соперников нет: противоречие с правилом решается заменой или отклонением';
      }
      return '';
    case 'answers':
      return from.type === 'conclusion' && to.type === 'question' ? '' : '«отвечает» — от вывода к вопросу';
    case 'derived_from':
      return conclusions ? '' : '«выведена из» — только между выводами';
    case 'replaces':
      return from.kind === 'rule' && to.kind === 'rule' ? '' : '«заменяет» — только правило правило';
    case 'merged_into':
      return from.type === to.type ? '' : 'объединять можно только записи одного типа';
  }
}

/**
 * Состояние новой записи при отправке. Вывод — на модерацию; с противоречием
 * (агент указал contradicts) — сразу «противоречие». Вопрос — открыт без модерации (РВ 10).
 */
export function initialStatus(type: RecordType, hasContradiction: boolean): Status {
  if (type === 'question') return 'open';
  return hasContradiction ? 'disputed' : 'pending';
}

export type Decision = 'accept' | 'reject' | 'merge' | 'replace' | 'reopen' | 'close';

export interface DecisionResult {
  /** новое состояние записи */
  status: Status;
  /** состояние цели (для «заменить»: прежнее правило → replaced) */
  targetStatus?: Status;
  /** связь, которую нужно создать от записи к цели */
  link?: LinkType;
}

/**
 * Что делает решение модератора. Ошибка — решение недопустимо; текст — по-русски,
 * его увидит модератор.
 * @param conflictsWithRule — у записи есть противоречие с правилом бюро (раздел 5.5)
 */
export function decide(
  record: RecordRef,
  decision: Decision,
  target?: RecordRef,
  conflictsWithRule = false,
): DecisionResult {
  const fail = (message: string): never => {
    throw new Error(message);
  };

  if (record.type === 'question') {
    if (decision === 'close' && (record.status === 'open' || record.status === 'answered')) {
      return { status: 'closed' };
    }
    if (decision === 'reject' && record.status !== 'rejected') return { status: 'rejected' };
    if (decision === 'reopen' && (record.status === 'closed' || record.status === 'rejected')) {
      return { status: 'open' };
    }
    return fail('для вопроса — «закрыть», «отклонить» или «открыть снова»');
  }

  const waiting = record.status === 'pending' || record.status === 'disputed';
  switch (decision) {
    case 'accept':
      if (!waiting) return fail('принять можно только запись на модерации');
      if (conflictsWithRule) {
        return fail('запись противоречит правилу бюро: «заменить» правило или «отклонить» запись');
      }
      return { status: 'accepted' };
    case 'reject':
      if (!waiting) return fail('отклонить можно только запись на модерации');
      return { status: 'rejected' };
    case 'reopen':
      if (record.status !== 'rejected') return fail('вернуть на модерацию можно только отклонённую запись');
      return { status: 'pending' };
    case 'merge':
      if (!waiting) return fail('объединить можно только запись на модерации');
      if (!target) return fail('укажите, с какой записью объединить');
      if (target.type !== record.type) return fail('объединять можно только записи одного типа');
      if (target.status !== 'accepted') return fail('объединять можно только с принятой записью');
      return { status: 'merged', link: 'merged_into' };
    case 'replace':
      if (!waiting) return fail('заменить правило может только запись на модерации');
      if (!target) return fail('укажите, какое правило заменяет запись');
      if (record.kind !== 'rule' || target.kind !== 'rule') return fail('заменить можно только правило правилом');
      if (target.status !== 'accepted') return fail('заменить можно только принятое правило');
      return { status: 'accepted', targetStatus: 'replaced', link: 'replaces' };
    case 'close':
      return fail('«закрыть» — только для вопроса');
  }
}
