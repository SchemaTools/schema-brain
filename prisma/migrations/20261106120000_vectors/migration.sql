-- Векторы смысла записей (решение 2026-11-06): модель multilingual-e5-small, 384 числа.
-- Хранятся обычным массивом real[] — сравнение полным перебором на сервере (записей сотни и тысячи);
-- pgvector не нужен, тесты и локальный стенд работают на обычном PostgreSQL.
-- embedding_model и embedded_version — по ним видно, что вектор устарел (сменилась модель или текст).
ALTER TABLE "record" ADD COLUMN "embedding" real[];
ALTER TABLE "record" ADD COLUMN "embedding_model" text;
ALTER TABLE "record" ADD COLUMN "embedded_version" integer;
