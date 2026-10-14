import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // адрес базы нужен только командам, которые к ней подключаются
  datasource: { url: process.env['DATABASE_URL'] ?? '' },
});
