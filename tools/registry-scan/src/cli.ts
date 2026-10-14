// Разбор реестров проверок альбомов → кандидаты «типовая ошибка».
//
//   node tools/registry-scan/src/cli.ts <папки или файлы xlsx> --out <папка>
//        [--min 3] [--threshold 0.45] [--records 1,4,7] [--date ГГГГ-ММ-ДД]
//
// Пишет в папку --out: кандидаты.md (отчёт для разбора), кандидаты.csv (для Excel);
// с --records — записи шага 0 по выбранным номерам в подпапку «записи».
// Реестры и результаты — данные бюро: держать вне репозитория.
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULTS, findCandidates, suggestionsOf } from './cluster.ts';
import { listFiles, readRegistry, type Registry } from './registry.ts';
import { csv, markdown, recordFile } from './report.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    min: { type: 'string', default: String(DEFAULTS.minAlbums) },
    threshold: { type: 'string', default: String(DEFAULTS.threshold) },
    records: { type: 'string' },
    date: { type: 'string', default: new Date().toLocaleDateString('sv-SE') }, // ГГГГ-ММ-ДД по местному времени
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

if (!positionals.length || !values.out) {
  fail('Укажите реестры и папку результата: node tools/registry-scan/src/cli.ts <папка> --out <папка>');
}
const options = { minAlbums: Number(values.min), threshold: Number(values.threshold) };
if (!Number.isInteger(options.minAlbums) || options.minAlbums < 2) fail('--min — целое число от 2');
if (!(options.threshold > 0 && options.threshold < 1)) fail('--threshold — число от 0 до 1, например 0.45');
const date = values.date ?? '';
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('--date — дата ГГГГ-ММ-ДД');

const registries: Registry[] = [];
for (const file of listFiles(positionals)) {
  try {
    const registry = await readRegistry(file);
    if (registry) registries.push(registry);
    else console.log(`— ${basename(file)}: нет вкладки «Замечания», пропущен`);
  } catch (error) {
    console.log(`✕ ${basename(file)}: ${(error as Error).message}`);
  }
}
if (!registries.length) fail('Реестров с вкладкой «Замечания» не найдено.');

const remarks = registries.flatMap((r) => r.remarks);
const candidates = findCandidates(remarks, options);
const nearly = findCandidates(remarks, { ...options, minAlbums: options.minAlbums - 1 })
  .filter((c) => c.albums.length === options.minAlbums - 1)
  .slice(0, 15);
const summary = { date, registries, candidates, nearly, suggestions: suggestionsOf(registries), options };

const out = values.out!;
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'кандидаты.md'), markdown(summary));
writeFileSync(join(out, 'кандидаты.csv'), csv(candidates));
console.log(
  `Реестров: ${registries.length}, замечаний учтено: ${remarks.length}, кандидатов: ${candidates.length}` +
    ` → ${join(out, 'кандидаты.md')}, кандидаты.csv`,
);

if (values.records) {
  const picked = values.records.split(/[,\s]+/).filter(Boolean).map((n) => Number(n.replace(/^К-/i, '')));
  const folder = join(out, 'записи');
  mkdirSync(folder, { recursive: true });
  for (const id of picked) {
    const candidate = candidates.find((c) => c.id === id);
    if (!candidate) {
      console.log(`✕ К-${id}: нет такого кандидата`);
      continue;
    }
    const { name, content } = recordFile(candidate, date);
    writeFileSync(join(folder, name), content);
    console.log(`✓ ${join('записи', name)}`);
  }
}
