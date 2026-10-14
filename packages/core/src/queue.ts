// Очередь модерации (docs/spec.md, раздел 5.6): не таблица, а порядок.
// 1) противоречия — старые выше; 2) на модерации и уже нужные агентам — по счётчику
// запросов; 3) остальные на модерации — старые выше.
import type { Status } from './enums.ts';

export interface QueueItem {
  number: number;
  status: Status | (string & {});
  requestsCount: number;
  created: Date;
}

export const inQueue = (status: string) => status === 'pending' || status === 'disputed';

function group(item: QueueItem): number {
  if (item.status === 'disputed') return 0;
  return item.requestsCount > 0 ? 1 : 2;
}

export function queueOrder<T extends QueueItem>(items: T[]): T[] {
  return items
    .filter((item) => inQueue(item.status))
    .sort((a, b) => {
      const ga = group(a);
      const gb = group(b);
      if (ga !== gb) return ga - gb;
      if (ga === 1 && a.requestsCount !== b.requestsCount) return b.requestsCount - a.requestsCount;
      return a.created.getTime() - b.created.getTime() || a.number - b.number;
    });
}
