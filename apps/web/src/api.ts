// Обращения к API сервиса. Вход — cookie сеанса после ввода токена (docs/spec.md, раздел 2.4).

export interface RecordView {
  number: number;
  type: 'conclusion' | 'question';
  kind: 'fact' | 'rule' | 'hypothesis' | null;
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

export interface Me {
  label: string;
  client: string;
  scopes: string[];
}

export class ApiError extends Error {
  readonly status: number;
  readonly details: string[];
  constructor(status: number, message: string, details: string[] = []) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.message ?? `Ошибка ${response.status}`, data.details ?? []);
  return data as T;
}

export const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '' && v !== false) q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const KIND: Record<string, string> = { fact: 'факт', rule: 'правило', hypothesis: 'гипотеза' };
export const CORES = [
  { code: 'design', name: 'Проектирование' },
  { code: 'bim', name: 'BIM и Revit' },
  { code: 'process', name: 'Процессы бюро' },
  { code: 'tools', name: 'Инструменты' },
];
export const LINK: Record<string, string> = {
  contradicts: 'противоречит',
  answers: 'отвечает на',
  derived_from: 'выведена из',
  replaces: 'заменяет',
  merged_into: 'объединена с',
};
export const EVENT: Record<string, string> = {
  created: 'создана',
  edited: 'правка',
  moderated: 'решение модератора',
  status: 'смена состояния',
  feedback: 'отметка',
  linked: 'связь',
  unlinked: 'связь снята',
  needs_check: 'пометка «проверить»',
};
