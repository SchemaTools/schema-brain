# Установка и обновление на сервере

Сервис — два контейнера (база и сервис) в Docker на сервере бюро, в локальной сети. Подключение к серверу — по SSH; адрес и доступ выдаёт руководитель, в репозитории их нет.

Нужно на сервере: Docker с командой `docker compose`, git, 2 ГБ свободного места.

**Первая сборка — с выходом в интернет.** Серверу нужны Docker Hub (образы `node:24-bookworm-slim` и `pgvector/pgvector:pg16`), реестр npm и GitHub. Обновления тоже собираются на сервере и тоже скачивают пакеты. Если выхода в интернет у сервера нет — см. «Без интернета на сервере» ниже.

## Установка

```bash
git clone https://github.com/SchemaTools/schema-brain
```

```bash
cd schema-brain && cp deploy/.env.example deploy/.env
```

Заполнить `deploy/.env`: пароль базы (`openssl rand -base64 32`), свободный порт, часовой пояс.

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Проверка — ответ `{"ok":true,…}`:

```bash
curl -s http://127.0.0.1:<порт>/api/health
```

## Первый модератор и сотрудники

Команды выполняются в контейнере сервиса; токен печатается один раз — передайте его владельцу лично, не в общий чат.

```bash
docker compose -f deploy/docker-compose.yml exec app node apps/server/src/cli.ts moderator "модератор"
```

```bash
docker compose -f deploy/docker-compose.yml exec app node apps/server/src/cli.ts person add "проектировщик АР-2"
```

```bash
docker compose -f deploy/docker-compose.yml exec app node apps/server/src/cli.ts token issue "проектировщик АР-2" claude
```

Ярлык сотрудника — обезличенный («проектировщик АР-2»); кто за ним стоит, знает только модератор. Клиент токена — `claude`, `codex`, `chatgpt`, `web` (вход в веб), `local`. Все команды: `… cli.ts help`.

## Проекты из Schema Teams

Впишите в `deploy/.env` адрес Schema Teams и токен руководителя с правом видеть все объекты (`stt_…`, выпускает администратор Schema Teams) и перезапустите сервис: список объектов будет обновляться раз в час и по кнопке «Обновить из Schema Teams» в настройках. Без этих настроек проекты добавляются командой `project add`.

## Обмен файлами с контейнером

Команды сервиса видят только файлы внутри контейнера. Файлы передаются командой `docker compose cp`; внутри контейнера для них — папка `/tmp` (в остальные сервис писать не может). Команды — из папки репозитория на сервере.

**Импорт md-записей шага 0** — папку выводов одного сотрудника скопировать на сервер в `~/schema-brain-files/inbox` (например, `scp -r`), затем:

```bash
docker compose -f deploy/docker-compose.yml cp ~/schema-brain-files/inbox app:/tmp/inbox
```

```bash
docker compose -f deploy/docker-compose.yml exec app node apps/server/src/cli.ts import-md /tmp/inbox --person "проектировщик АР-2"
```

```bash
docker compose -f deploy/docker-compose.yml exec -u root app rm -rf /tmp/inbox
```

Скопированные файлы принадлежат root, поэтому удаление — с `-u root`. Повторный импорт той же папки безопасен — уже принятые записи пропускаются. Записи каждого сотрудника — отдельной папкой и со своим ярлыком.

**Датасет для дообучения (JSONL)**:

```bash
docker compose -f deploy/docker-compose.yml exec app node apps/server/src/cli.ts export-dataset /tmp/dataset
```

```bash
docker compose -f deploy/docker-compose.yml cp app:/tmp/dataset ~/schema-brain-files/dataset-$(date +%F)
```

```bash
docker compose -f deploy/docker-compose.yml exec app rm -rf /tmp/dataset
```

**Страница справки по ядру** — печатается прямо в файл на сервере, без копирования:

```bash
docker compose -f deploy/docker-compose.yml exec -T app node apps/server/src/cli.ts export-wiki "BIM и Revit" > ~/schema-brain-files/wiki-bim.md
```

Папка `~/schema-brain-files` — вне репозитория, чтобы датасет и страницы в него не попали; создать её один раз: `mkdir -p ~/schema-brain-files`. Файлы в `/tmp` контейнера пропадают при обновлении сервиса.

## Без интернета на сервере

Образы собираются на компьютере с интернетом и Docker и переносятся файлом. Архитектура должна совпадать с сервером (обычно `amd64`; на компьютере с процессором Apple или ARM добавить `--platform linux/amd64` к `docker build` и `docker pull`).

На компьютере с интернетом, в папке репозитория:

```bash
docker build -t schema-brain:latest .
```

```bash
docker pull pgvector/pgvector:pg16
```

```bash
docker save schema-brain:latest pgvector/pgvector:pg16 | gzip > schema-brain-images.tar.gz
```

```bash
git archive --format=tar.gz -o schema-brain-src.tar.gz HEAD
```

Оба архива перенести на сервер (`scp`), распаковать исходники в папку `schema-brain`, заполнить `deploy/.env` (как в «Установке») и загрузить образы:

```bash
gunzip -c schema-brain-images.tar.gz | docker load
```

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --no-build
```

Обновление — так же: новый образ сервиса (`docker save schema-brain:latest`) и новые исходники; образ базы переносить заново не нужно.

## Обновление

```bash
git pull && docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Миграции базы применяются при запуске сервиса; если миграция не применилась, сервис не стартует, а база остаётся прежней.

## Резервная копия

Копия базы — скриптом: он делает дамп, проверяет, что копия читается, и оставляет только последние копии (по умолчанию 14). Папка копий — `~/schema-brain-backups`, вне репозитория; другие значения — `BACKUP_DIR` и `BACKUP_KEEP` в `deploy/.env`.

```bash
deploy/backup.sh
```

Ночная копия — строкой в `crontab -e` пользователя, который запускает Docker (здесь — в 02:30 по времени сервера; `<папка репозитория>` — полный путь):

```
30 2 * * * <папка репозитория>/deploy/backup.sh >> $HOME/schema-brain-backups/backup.log 2>&1
```

Восстановление в работающую базу (данные базы заменяются копией):

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T db pg_restore -U schema_brain -d schema_brain --clean --if-exists < <файл копии>
```
