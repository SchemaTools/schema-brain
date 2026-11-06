// Модель векторов multilingual-e5-small (ONNX, лицензия MIT) — в папку: node scripts/fetch-model.mjs <папка>.
// Версия на Hugging Face закреплена, файлы проверяются по SHA-256: другой файл — ошибка, модель не ставится.
// Используется при сборке образа (Dockerfile) и для локального стенда (npm run model:fetch).
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const REPO = 'Xenova/multilingual-e5-small';
const REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78';
const FILES = [
  { path: 'onnx/model_quantized.onnx', name: 'model_quantized.onnx', sha256: 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193' },
  { path: 'tokenizer.json', name: 'tokenizer.json', sha256: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39' },
];

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

const dir = process.argv[2];
if (!dir) {
  console.error('Папка: node scripts/fetch-model.mjs <папка>');
  process.exit(2);
}
mkdirSync(dir, { recursive: true });
for (const f of FILES) {
  const target = join(dir, f.name);
  if (existsSync(target) && sha256(target) === f.sha256) {
    console.log(`✓ ${f.name} — уже есть`);
    continue;
  }
  const url = `https://huggingface.co/${REPO}/resolve/${REVISION}/${f.path}`;
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`${f.name}: ${response.status} ${response.statusText}`);
  const part = `${target}.part`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(part));
  const got = sha256(part);
  if (got !== f.sha256) {
    rmSync(part, { force: true });
    throw new Error(`${f.name}: контрольная сумма ${got}, ожидалась ${f.sha256}`);
  }
  renameSync(part, target);
  console.log(`✓ ${f.name}`);
}
