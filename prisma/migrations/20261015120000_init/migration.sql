-- Первая схема Schema Brain (docs/spec.md, разделы 2–3).
-- Создана prisma migrate diff из prisma/schema.prisma; ниже «Дополнения» — то, чего Prisma
-- не знает: вычисляемый search_vector, проверки перечислений, индекс поиска, ядра на старте.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "core" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "core_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project" (
    "id" SERIAL NOT NULL,
    "external_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token" (
    "id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "client" TEXT NOT NULL,
    "scopes" TEXT[],
    "hash" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "created" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used" TIMESTAMPTZ(3),
    "revoked" TIMESTAMPTZ(3),

    CONSTRAINT "token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "person_id" UUID NOT NULL,
    "token_id" UUID NOT NULL,
    "created" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "kind" TEXT,
    "text" TEXT NOT NULL,
    "core_id" INTEGER NOT NULL,
    "project_id" INTEGER,
    "software_version" TEXT,
    "not_applicable" TEXT,
    "source" TEXT NOT NULL,
    "refs" JSONB NOT NULL DEFAULT '[]',
    "author_id" UUID NOT NULL,
    "author_client" TEXT NOT NULL,
    "confirmed_by_author" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL,
    "requests_count" INTEGER NOT NULL DEFAULT 0,
    "asked_count" INTEGER NOT NULL DEFAULT 0,
    "worked" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "needs_check" BOOLEAN NOT NULL DEFAULT false,
    "import_hash" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "search_vector" tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('russian', "text"), 'A') ||
        setweight(to_tsvector('russian', coalesce("not_applicable", '') || ' ' || coalesce("software_version", '')), 'B')
    ) STORED,
    "created" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "link" (
    "id" UUID NOT NULL,
    "from_id" UUID NOT NULL,
    "to_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback" (
    "id" UUID NOT NULL,
    "record_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "client" TEXT NOT NULL,
    "worked" BOOLEAN NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "software_version" TEXT,
    "created" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record_event" (
    "id" BIGSERIAL NOT NULL,
    "record_id" UUID NOT NULL,
    "person_id" UUID,
    "client" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "record_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "software_current" (
    "product" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "changed" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "software_current_pkey" PRIMARY KEY ("product")
);

-- CreateIndex
CREATE UNIQUE INDEX "core_code_key" ON "core"("code");

-- CreateIndex
CREATE UNIQUE INDEX "project_external_id_key" ON "project"("external_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_code_key" ON "project"("code");

-- CreateIndex
CREATE UNIQUE INDEX "person_label_key" ON "person"("label");

-- CreateIndex
CREATE UNIQUE INDEX "token_hash_key" ON "token"("hash");

-- CreateIndex
CREATE INDEX "token_person_id_idx" ON "token"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "record_number_key" ON "record"("number");

-- CreateIndex
CREATE UNIQUE INDEX "record_import_hash_key" ON "record"("import_hash");

-- CreateIndex
CREATE INDEX "record_status_idx" ON "record"("status");

-- CreateIndex
CREATE INDEX "record_core_id_idx" ON "record"("core_id");

-- CreateIndex
CREATE INDEX "record_project_id_idx" ON "record"("project_id");

-- CreateIndex
CREATE INDEX "link_to_id_idx" ON "link"("to_id");

-- CreateIndex
CREATE UNIQUE INDEX "link_from_id_to_id_type_key" ON "link"("from_id", "to_id", "type");

-- CreateIndex
CREATE INDEX "feedback_record_id_idx" ON "feedback"("record_id");

-- CreateIndex
CREATE INDEX "record_event_record_id_idx" ON "record_event"("record_id");

-- AddForeignKey
ALTER TABLE "token" ADD CONSTRAINT "token_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record" ADD CONSTRAINT "record_core_id_fkey" FOREIGN KEY ("core_id") REFERENCES "core"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record" ADD CONSTRAINT "record_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record" ADD CONSTRAINT "record_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link" ADD CONSTRAINT "link_from_id_fkey" FOREIGN KEY ("from_id") REFERENCES "record"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link" ADD CONSTRAINT "link_to_id_fkey" FOREIGN KEY ("to_id") REFERENCES "record"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "record"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_event" ADD CONSTRAINT "record_event_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "record"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Дополнения ---------------------------------------------------------------

-- поиск: русская морфология, вес A — текст, B — «когда не применимо» и версия
CREATE INDEX "record_search_vector_idx" ON "record" USING GIN ("search_vector");

-- перечисления — коды из packages/core/src/enums.ts
ALTER TABLE "record" ADD CONSTRAINT "record_type_check" CHECK ("type" IN ('conclusion', 'question'));
ALTER TABLE "record" ADD CONSTRAINT "record_kind_check" CHECK (
    ("type" = 'conclusion' AND "kind" IN ('fact', 'rule', 'hypothesis')) OR ("type" = 'question' AND "kind" IS NULL));
ALTER TABLE "record" ADD CONSTRAINT "record_status_check" CHECK (
    ("type" = 'conclusion' AND "status" IN ('pending', 'disputed', 'accepted', 'rejected', 'merged', 'replaced')) OR
    ("type" = 'question' AND "status" IN ('open', 'answered', 'closed', 'rejected')));
ALTER TABLE "record" ADD CONSTRAINT "record_text_check" CHECK (char_length("text") BETWEEN 1 AND 300);
ALTER TABLE "record" ADD CONSTRAINT "record_confirmed_check" CHECK ("confirmed_by_author");
ALTER TABLE "record" ADD CONSTRAINT "record_counts_check" CHECK (
    "worked" >= 0 AND "failed" >= 0 AND "requests_count" >= 0 AND "asked_count" >= 0);
ALTER TABLE "link" ADD CONSTRAINT "link_type_check" CHECK (
    "type" IN ('contradicts', 'answers', 'derived_from', 'replaces', 'merged_into'));
ALTER TABLE "link" ADD CONSTRAINT "link_self_check" CHECK ("from_id" <> "to_id");
ALTER TABLE "token" ADD CONSTRAINT "token_client_check" CHECK (
    "client" IN ('web', 'claude', 'chatgpt', 'codex', 'local', 'import'));
ALTER TABLE "token" ADD CONSTRAINT "token_scopes_check" CHECK (
    "scopes" <@ ARRAY['read', 'propose', 'feedback', 'moderate']::text[] AND cardinality("scopes") > 0);

-- ядра на старте (решение 10)
INSERT INTO "core" ("code", "name", "description", "sort") VALUES
    ('design', 'Проектирование', '', 1),
    ('bim', 'BIM и Revit', '', 2),
    ('process', 'Процессы бюро', '', 3),
    ('tools', 'Инструменты', 'Плагины, навыки, MCP', 4);
