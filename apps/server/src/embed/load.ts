// Подключение модели векторов при запуске сервиса и команд. Нет папки или модель не загрузилась —
// сервис работает дальше, поиск только по словам (так было до векторов).
import { existsSync } from 'node:fs';
import { setEmbedder } from '../services/vectors.ts';
import { E5Embedder, type Embedder } from './e5.ts';

export async function loadEmbedder(dir: string, warn: (message: string) => void): Promise<Embedder | null> {
  if (!dir) return null;
  if (!existsSync(dir)) {
    warn(`векторы выключены: нет папки модели ${dir}`);
    return null;
  }
  try {
    const e = await E5Embedder.load(dir);
    setEmbedder(e);
    return e;
  } catch (error) {
    warn(`векторы выключены: модель не загрузилась — ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
