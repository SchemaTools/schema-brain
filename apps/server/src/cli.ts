// Команды на сервере (в контейнере сервиса): node apps/server/src/cli.ts <команда> …
// Токены печатаются один раз — в базе только хэш.
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { AppError, systemCtx } from './context.ts';
import { loadConfig } from './config.ts';
import { createDb } from './db/client.ts';
import { migrate } from './db/migrate.ts';
import { exportDataset, importFolder, wikiPage } from './services/exchange.ts';
import { addPerson, findPerson, issueToken, listPersons, revokeToken } from './services/people.ts';
import { syncProjects } from './services/projects.ts';
import { setSoftware } from './services/records.ts';

const HELP = `Команды Schema Brain:
  migrate                                   применить миграции базы
  moderator <ярлык>                         первый модератор: сотрудник и веб-токен со всеми правами
  person add <ярлык>                        добавить сотрудника («проектировщик АР-2»)
  person list                               сотрудники и их токены (без самих токенов)
  token issue <ярлык> <клиент> [--scopes read,propose] [--note текст]
                                            выпустить токен: клиент — web, claude, chatgpt, codex, local
  token revoke <id>                         отозвать токен
  project add <код> [название]              добавить проект вручную
  project sync                              проекты из Schema Teams (SCHEMA_TEAMS_URL, SCHEMA_TEAMS_TOKEN)
  software set <продукт> <версия>           текущая версия — пометка «проверить» у записей с другой
  import-md <папка> --person <ярлык>        импорт md-записей шага 0 одного сотрудника
  export-dataset <папка>                    датасет JSONL для дообучения
  export-wiki <ядро> [--out файл]           страница справки по ядру (Markdown)`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    scopes: { type: 'string' },
    note: { type: 'string' },
    person: { type: 'string' },
    out: { type: 'string' },
  },
});

const [command, sub, ...rest] = positionals;
if (!command || command === 'help') {
  console.log(HELP);
  process.exit(0);
}

const config = loadConfig();
const db = createDb(config.databaseUrl);
const arg = (value: string | undefined, name: string) => {
  if (!value) throw new AppError(400, 'invalid', `Не указан ${name}. Справка: node apps/server/src/cli.ts help`);
  return value;
};

try {
  switch (command) {
    case 'migrate': {
      const applied = await migrate(config.databaseUrl, config.migrationsDir);
      console.log(applied.length ? `Применены: ${applied.join(', ')}` : 'База уже на последней схеме');
      break;
    }
    case 'moderator': {
      await migrate(config.databaseUrl, config.migrationsDir);
      const person = await addPerson(db, arg(sub, 'ярлык'));
      const { token } = await issueToken(db, person.id, 'web', ['read', 'propose', 'feedback', 'moderate'], 'модератор');
      console.log(`Модератор «${person.label}». Веб-токен (показывается один раз):\n${token}`);
      break;
    }
    case 'person':
      if (sub === 'add') {
        const person = await addPerson(db, arg(rest[0], 'ярлык'));
        console.log(`Сотрудник «${person.label}» добавлен`);
      } else if (sub === 'list') {
        for (const p of await listPersons(db)) {
          console.log(`${p.label}${p.active ? '' : ' (отключён)'}`);
          for (const t of p.tokens) console.log(`  ${t.id}  ${t.client}  ${t.scopes.join(',')}  ${t.hint}…  ${t.note}`);
        }
      } else console.log(HELP);
      break;
    case 'token':
      if (sub === 'issue') {
        const person = await findPerson(db, arg(rest[0], 'ярлык'));
        const scopes = values.scopes?.split(',').map((s) => s.trim()).filter(Boolean);
        const { token } = await issueToken(db, person.id, arg(rest[1], 'клиент'), scopes, values.note ?? '');
        console.log(`Токен для «${person.label}» (показывается один раз):\n${token}`);
      } else if (sub === 'revoke') {
        await revokeToken(db, null, arg(rest[0], 'id токена'));
        console.log('Токен отозван');
      } else console.log(HELP);
      break;
    case 'project': {
      if (sub === 'sync') {
        if (!config.schemaTeams) throw new AppError(400, 'invalid', 'Не заданы SCHEMA_TEAMS_URL и SCHEMA_TEAMS_TOKEN');
        console.log((await syncProjects(db, config.schemaTeams)).text);
        break;
      }
      if (sub !== 'add') {
        console.log(HELP);
        break;
      }
      const code = arg(rest[0], 'код');
      await db.project.upsert({ where: { code }, create: { code, name: rest.slice(1).join(' ') }, update: { active: true } });
      console.log(`Проект ${code} добавлен`);
      break;
    }
    case 'software': {
      if (sub !== 'set') {
        console.log(HELP);
        break;
      }
      const result = await setSoftware(db, systemCtx('', 'сервис'), arg(rest[0], 'продукт'), arg(rest[1], 'версия'));
      console.log(result.text);
      break;
    }
    case 'import-md': {
      const person = await findPerson(db, arg(values.person, '--person'));
      const report = await importFolder(db, systemCtx(person.id, person.label, ['propose']), arg(sub, 'папка'));
      for (const a of report.accepted) console.log(`✓ ${a.file} → № ${a.number}${a.existing ? ' (такой вопрос уже был)' : ''}`);
      for (const s of report.skipped) console.log(`— ${s.file}: ${s.reason}`);
      for (const f of report.failed) console.log(`✕ ${f.file}: ${f.errors.join('; ')}`);
      console.log(`Принято: ${report.accepted.length}, пропущено: ${report.skipped.length}, с ошибками: ${report.failed.length}`);
      if (report.failed.length) process.exitCode = 1;
      break;
    }
    case 'export-dataset': {
      const meta = await exportDataset(db, arg(sub, 'папка'), config.version);
      console.log(`Датасет: ${JSON.stringify(meta.counts)}`);
      break;
    }
    case 'export-wiki': {
      const page = await wikiPage(db, arg(sub, 'ядро'));
      if (values.out) {
        writeFileSync(values.out, page);
        console.log(`Страница: ${values.out}`);
      } else console.log(page);
      break;
    }
    default:
      console.log(HELP);
      process.exitCode = 2;
  }
} catch (error) {
  const e = error as AppError;
  console.error(`✕ ${e.message}${e.details?.length ? `\n  ${e.details.join('\n  ')}` : ''}`);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
