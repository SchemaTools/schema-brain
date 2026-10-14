// Проверка папки выводов: node skills/vyvody/check.mjs <папка> [<папка> …]
// Для пилота шага 0: руководитель проверяет папки сотрудников до импорта.
// Печатает по каждому файлу ✓ или ✕ с причинами; код выхода 1, если есть ошибки.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseRecord } from './record.mjs';

const folders = process.argv.slice(2);
if (!folders.length) {
  console.error('Укажите папку выводов: node skills/vyvody/check.mjs <папка>');
  process.exit(2);
}

const files = folders.flatMap((folder) =>
  statSync(folder).isDirectory()
    ? readdirSync(folder)
        .filter((name) => name.toLowerCase().endsWith('.md'))
        .map((name) => join(folder, name))
    : [folder],
);

const count = { ok: 0, bad: 0, conclusion: 0, question: 0 };
for (const file of files) {
  const name = basename(file);
  const { record, errors, warnings } = parseRecord(readFileSync(file, 'utf8'), name);
  if (record) {
    count.ok += 1;
    count[record.type] += 1;
    console.log(`✓ ${name}`);
  } else {
    count.bad += 1;
    console.log(`✕ ${name}`);
  }
  for (const message of errors) console.log(`    ошибка: ${message}`);
  for (const message of warnings) console.log(`    замечание: ${message}`);
}

console.log(
  `\nФайлов: ${files.length}; годных: ${count.ok} (выводов ${count.conclusion}, вопросов ${count.question}); с ошибками: ${count.bad}`,
);
process.exit(count.bad ? 1 : 0);
