# Установка и обновление на сервере

Сервис — два контейнера (база и сервис) в Docker на сервере бюро, в локальной сети. Подключение к серверу — по SSH; адрес и доступ выдаёт руководитель, в репозитории их нет.

Нужно на сервере: Docker с командой `docker compose`, git, 2 ГБ свободного места.

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

## Обновление

```bash
git pull && docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Миграции базы применяются при запуске сервиса; если миграция не применилась, сервис не стартует, а база остаётся прежней.

## Резервная копия

```bash
docker compose -f deploy/docker-compose.yml exec -T db pg_dump -U schema_brain -Fc schema_brain > schema-brain-$(date +%F).dump
```

Копии хранить вне папки репозитория.
