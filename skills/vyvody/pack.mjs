// Сборка навыка «Выводы» в zip для загрузки в приложение Claude:
// npm run skill:pack → skills/vyvody/dist/vyvody.zip (в репозиторий не попадает).
// В архиве — папка навыка с SKILL.md и references/. Перед сборкой проверяются
// фронтматтер SKILL.md и все примеры записей из references/format.md.
// Без зависимостей: zip пишется встроенным zlib.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { parseRecord } from './record.mjs';

const root = dirname(fileURLToPath(import.meta.url));
export const SKILL = 'vyvody';

/** Проверка SKILL.md: фронтматтер с name и description, как требует приложение Claude. */
export function checkSkill(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match) throw new Error('SKILL.md: нет фронтматтера между строками ---');
  const fields = Object.fromEntries(
    match[1]
      .split(/\r?\n/)
      .map((line) => /^(\w+):\s*(.*)$/.exec(line))
      .filter(Boolean)
      .map((found) => [found[1], found[2].trim()]),
  );
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fields.name ?? '') || fields.name.length > 64) {
    throw new Error('SKILL.md: name — строчная латиница, цифры и дефис, до 64 знаков');
  }
  if (!fields.description || fields.description.length > 1024) {
    throw new Error('SKILL.md: description обязателен, до 1024 знаков');
  }
  return fields;
}

/** Примеры записей из блоков ```markdown — все должны проходить проверку формата. */
export function exampleRecords(text) {
  return [...text.matchAll(/```markdown\r?\n([\s\S]*?)```/g)].map((found) => found[1]);
}

// CRC-32 для zip (zlib.crc32 есть не во всех версиях Node 22)
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Zip-архив: имена в UTF-8, сжатие deflate, дата файлов постоянная —
 * одинаковый навык даёт одинаковый архив.
 * @param {Record<string, Uint8Array>} entries — путь в архиве → содержимое
 */
export function zip(entries) {
  const time = 0;
  const date = ((2026 - 1980) << 9) | (10 << 5) | 15;
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [path, data] of Object.entries(entries)) {
    const name = Buffer.from(path, 'utf8');
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6);
    head.writeUInt16LE(8, 8);
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(date, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(name.length, 26);
    head.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(head, name, packed);
    centrals.push(central, name);
    offset += head.length + name.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function filesOf(folder) {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? filesOf(path) : [path];
  });
}

function pack() {
  const source = join(root, SKILL);
  const fields = checkSkill(readFileSync(join(source, 'SKILL.md'), 'utf8'));
  if (fields.name !== SKILL) throw new Error(`SKILL.md: name должен быть ${SKILL}`);

  const examples = exampleRecords(readFileSync(join(source, 'references', 'format.md'), 'utf8'));
  examples.forEach((example, index) => {
    const { errors } = parseRecord(example);
    if (errors.length) throw new Error(`format.md, пример ${index + 1}: ${errors.join('; ')}`);
  });

  const entries = {};
  for (const path of filesOf(source)) {
    const inside = relative(source, path).split(sep).join('/');
    entries[`${SKILL}/${inside}`] = new Uint8Array(readFileSync(path));
  }
  const out = join(root, 'dist');
  mkdirSync(out, { recursive: true });
  const target = join(out, `${SKILL}.zip`);
  writeFileSync(target, zip(entries));
  console.log(
    `Навык собран: ${relative(process.cwd(), target)} (файлов: ${Object.keys(entries).length}, примеров проверено: ${examples.length})`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) pack();
